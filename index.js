/**
 * dsh-git-panel —— Host 半体（纯 ESM，只用 node 内置模块 + host/git.js）
 *
 * 注册方式（平台约束见 docs/ARCHITECTURE.md §3.1）：
 *   ctx.inject(['connection'], (c) => c.effect(() => c.connection.rpc.handle('/dsh-git', handler), label))
 * 通道用单段路径 `/dsh-git`（`/api` 保留，注册会抛错）。
 *
 * handler 契约（host-api.md §2.1）：返回 {ok:true,value} | {ok:false,error:{code,message,details}}；
 * **绝不向外抛** —— 抛出会变成 HTTP 500 纯文本，丢掉错误码。
 *
 * 端点（architecture.md §3，路径一律由 Host 规范化并校验不逃逸出根）：
 *   project/resolve { cwd?, sessionId? }        -> { projectRoot, roots, warnings }
 *   roots/add       { projectRoot, path }       -> { projectRoot, roots, warnings }
 *   roots/remove    { projectRoot, path }       -> { projectRoot, roots, warnings }
 *   roots/hide      { projectRoot, path }       -> { projectRoot, roots, warnings }（持久化隐藏，项目本身不可隐藏）
 *   roots/unhide    { projectRoot, path }       -> { projectRoot, roots, warnings }
 *   status          { rootPath }                -> StatusResult + dirty
 *   diff            { rootPath, path, … }       -> DiffResult
 *   remote/fetch    { rootPath }               -> {url, branch, head, upstream, ahead, behind, fetchedAt}（git fetch，只读）
 *   file/read       { rootPath, path }          -> FileResult（含 hash/bom/eol，保存时要用）
 *   file/write      { rootPath, path, text, expectedHash|force, eol, bom } -> WriteResult
 *   index/stage     { rootPath, path, action }  -> { path, action }（stage = git add，unstage = git restore --staged）
 *   index/stage-group { rootPath, scope }       -> { scope }（stage-unstaged / stage-untracked / unstage）
 *   commit          { rootPath, message }       -> { head, subject }（只提交已暂存内容）
 *   commit/message  { rootPath }                -> { message, model, source }（按设置里的模型生成）
 *   models/list     {}                          -> { models: [{ref, providerName, modelName}] }
 *   settings/get    {}                          -> { commitModel }
 *   settings/set    { commitModel }             -> { commitModel }
 *   tree/list       { rootPath, path }          -> TreeResult
 *
 * v1 没有 Config（不需要 schemastery），也没有 AI-facing tool。
 */
import { stat } from 'node:fs/promises'
import path from 'node:path'

import {
  GitError,
  fetchRemote,
  listDirectory,
  normalizeSlashes,
  readDiff,
  readStatus,
  readTextFile,
  resolveInside,
  resolveRepo,
  stageFile,
  stageGroup,
  commitIndex,
  commitDiffText,
  listBranches,
  switchBranch,
  trackRemoteBranch,
  createBranch,
  writeTextFile,
  prepareReviewBranch,
  cloneForReview,
  findLocalRepoFor,
  originMatches,
  headShaOf
} from './host/git.js'
import { createReviewLog } from './host/review-log.js'
import { createRemotes } from './host/remotes/index.js'
import {
  listModels,
  parseRef,
  readSettings,
  requireModel,
  writeSettings,
  generateCommitMessage
} from './host/models.js'
import { generateReview } from './host/review.js'
import { deepReview } from './host/deep-review.js'
import { findWorkspaceForSession, startSessionReview } from './host/session-review.js'
import { resolveRoots, addExtraRoot, removeExtraRoot, hideRoot, unhideRoot } from './host/roots.js'

export const name = 'dsh-git-panel'

/**
 * 传输层用 `connection.fetch.register` 注册**精确 Fetch 路由**，不用 `connection.rpc.handle`。
 *
 * 原因（已实测，有堆栈）：
 *  · `rpc.handle('dsh-git', fn)` 内部要执行 `owner.effect(() => owner.webServer.register(route))`，
 *    而 `owner`（服务读出的 ctx）解析不到 `webServer` —— 该服务由 dsh-host-webserver 这个 entry
 *    自己的 fiber 提供，不是根级服务，于是抛
 *    `Error: cannot get property "webServer" without inject`，路由永远挂不上 → 客户端 405。
 *  · `connection.fetch.register({ path, methods, fetch })` 的 effect 体只操作连接服务自己的
 *    `fetchRoutes` 表，完全不碰 `webServer`，路由由连接插件的 `/api` carrier 分发。
 *    这也是同环境里正常工作的 dsh-runner 的做法（`/api/dsh-runner/<endpoint>`）。
 *
 * 依赖用命令式 `ctx.inject(['connection'], cb)`：本 App 的宿主 Loader 不把模块导出的
 * `inject` 传进 fiber，只有命令式 inject 才会把服务放进当前 fiber 的 store。
 */

/** 所有路由都挂在框架已授权并鉴权的 `/api` 之下（不能自己注册 `/api` 通道）。 */
export const RPC_CHANNEL = '/api'

/** 本插件的路由命名空间：`/api/dsh-git/<endpoint>`。 */
export const RPC_NAMESPACE = 'dsh-git'

/** 客户端可调用的端点清单（也用于日志）。 */
export const ENDPOINTS = Object.freeze([
  'project/resolve',
  'roots/add',
  'roots/remove',
  'roots/hide',
  'roots/unhide',
  'status',
  'remote/fetch',
  'diff',
  'file/read',
  'file/write',
  'index/stage',
  'index/stage-group',
  'branches/list',
  'branch/switch',
  'branch/track',
  'branch/create',
  'accounts/list',
  'accounts/add',
  'accounts/update',
  'accounts/token',
  'accounts/remove',
  'remote/repos',
  'remote/detail',
  'remote/pr-counts',
  'remote/pull',
  'remote/pull/diff',
  'remote/pull/review',
  'remote/pull/ai-review',
  'remote/pull/prepare-review',
  'remote/pull/deep-review',
  'remote/pull/session-review',
  'remote/pull/clone-for-review',
  'remote/pull/comment',
  'remote/pull/test',
  'remote/pull/pass',
  'remote/pull/merge',
  'remote/clone',
  'commit',
  'commit/message',
  'models/list',
  'settings/get',
  'settings/set',
  'tree/list'
])

/* --------------------------------------------------------------- 状态缓存 */

const STATUS_CACHE_TTL_MS = 1200
const STATUS_CACHE_MAX = 64

/** 进程内小缓存：只有 status 用；file/read 永不缓存（文件可能被编辑）。 */
const statusCache = new Map()

function cacheKeyOf(rootPath) {
  const normalized = normalizeSlashes(path.resolve(rootPath))
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function cacheRead(key) {
  const entry = statusCache.get(key)
  if (entry === undefined) return undefined
  if (Date.now() - entry.at > STATUS_CACHE_TTL_MS) {
    statusCache.delete(key)
    return undefined
  }
  return entry.value
}

function pruneCache() {
  const now = Date.now()
  for (const [key, entry] of statusCache) {
    if (now - entry.at > STATUS_CACHE_TTL_MS) statusCache.delete(key)
  }
  while (statusCache.size > STATUS_CACHE_MAX) {
    const oldest = statusCache.keys().next()
    if (oldest.done === true) break
    statusCache.delete(oldest.value)
  }
}

function cacheWrite(key, value) {
  if (statusCache.size > STATUS_CACHE_MAX) pruneCache()
  statusCache.set(key, { at: Date.now(), value })
}

/** 根集合变化 / 测试用：清空 status 缓存。 */
export function clearStatusCache() {
  statusCache.clear()
}

/* ----------------------------------------------------------------- 信封 */

const ok = (value) => ({ ok: true, value })
const fail = (code, message, details = {}) => ({ ok: false, error: { code, message, details } })

/** Node 系统错误 → 稳定的错误码（git 自己的 GitError.code 不经过这张表）。 */
const ERRNO_TO_CODE = Object.freeze({
  ENOENT: 'not-found',
  ENOTDIR: 'not-a-directory',
  EISDIR: 'not-a-file',
  EACCES: 'forbidden-path',
  EPERM: 'forbidden-path',
  ENAMETOOLONG: 'bad-path',
  ELOOP: 'bad-path',
  ENOSPC: 'internal',
  EMFILE: 'internal'
})

function plainDetails(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

/** 把任意异常收敛成 rpcErrorSchema 认得的 {code,message,details}。 */
function mapError(error) {
  if (error instanceof GitError) {
    return {
      code: typeof error.code === 'string' && error.code !== '' ? error.code : 'internal',
      message: typeof error.message === 'string' && error.message !== '' ? error.message : 'git 操作失败',
      details: plainDetails(error.details)
    }
  }
  const code = typeof error?.code === 'string' ? ERRNO_TO_CODE[error.code] : undefined
  const message = error instanceof Error ? error.message || error.name : String(error ?? '未知错误')
  return {
    code: code ?? 'internal',
    message: message === '' ? '未知错误' : message,
    details: code === undefined ? {} : { errno: error.code }
  }
}

/* ----------------------------------------------------------------- 工具 */

async function statOrNull(target) {
  try {
    return await stat(target)
  } catch {
    return null
  }
}

function requireString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new GitError('bad-request', `缺少参数 ${field}`)
  }
  // 不 trim：Windows 允许文件名以空格开头，路径必须原样使用
  return value
}

function requireAbsolute(value, field) {
  const raw = requireString(value, field)
  if (!path.isAbsolute(raw)) {
    throw new GitError('bad-request', `参数 ${field} 必须是绝对路径：${raw}`)
  }
  return path.resolve(raw)
}

function asObject(payload) {
  return payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
}

/** 区分「目录不存在」与「存在但不是仓库」，给客户端更准的提示。 */
async function notARepositoryError(target) {
  const info = await statOrNull(target)
  if (!info) return new GitError('not-found', `目录不存在：${normalizeSlashes(target)}`)
  if (!info.isDirectory()) return new GitError('not-a-directory', `不是目录：${normalizeSlashes(target)}`)
  return new GitError('not-a-repository', `不是 git 仓库：${normalizeSlashes(target)}`)
}

/* ------------------------------------------------------- sessionId -> cwd */

/**
 * 解析项目目录：
 *   1. 显式 cwd（客户端从会话/工作区状态解析后传入）
 *   2. ctx.sessions.get(sessionId)?.header?.cwd（活会话）
 *   3. await ctx.get('sessionPersistence')?.stat(sessionId) → .header.cwd（冷会话）
 *   4. 都没有 → no-session
 * sessionId 是**不透明字符串**（session-<n> 或 UUID），不解析、不校验形状。
 */
async function resolveProjectCwd(ctx, request) {
  const explicit = request.cwd
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    const cwd = requireAbsolute(explicit, 'cwd')
    await assertDirectory(cwd)
    return cwd
  }

  const sessionId = request.sessionId
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new GitError('no-session', '无法确定项目目录：请求既没有 cwd，也没有 sessionId')
  }
  const id = sessionId.trim()

  let cwd
  try {
    const sessions = ctx.sessions ?? ctx.get?.('sessions')
    const header = sessions?.get?.(id)?.header
    if (typeof header?.cwd === 'string' && header.cwd !== '') cwd = header.cwd
  } catch (error) {
    ctx.logger?.warn?.(`dsh-git-panel: 读取会话失败（${id}）：${describe(error)}`)
  }

  if (cwd === undefined) {
    const persistence = ctx.get?.('sessionPersistence')
    if (persistence && typeof persistence.stat === 'function') {
      try {
        const stored = await persistence.stat(id)
        const storedCwd = stored?.header?.cwd
        if (typeof storedCwd === 'string' && storedCwd !== '') cwd = storedCwd
      } catch (error) {
        ctx.logger?.warn?.(`dsh-git-panel: 读取会话持久化记录失败（${id}）：${describe(error)}`)
      }
    }
  }

  if (typeof cwd !== 'string' || cwd === '') {
    throw new GitError('no-session', `无法确定项目目录：会话 ${id} 没有工作区路径`)
  }
  const resolved = requireAbsolute(cwd, 'session cwd')
  await assertDirectory(resolved)
  return resolved
}

async function assertDirectory(target) {
  const info = await statOrNull(target)
  if (!info) throw new GitError('not-found', `项目目录不存在：${normalizeSlashes(target)}`)
  if (!info.isDirectory()) throw new GitError('not-a-directory', `项目目录不是文件夹：${normalizeSlashes(target)}`)
}

function describe(error) {
  if (error instanceof Error) return error.message || error.name
  return String(error)
}

/* ------------------------------------------------------------- 端点实现 */

function createDispatcher(ctx) {
  /* project/resolve --------------------------------------------------- */
  async function projectResolve(request) {
    const cwd = await resolveProjectCwd(ctx, request)
    const result = await resolveRoots(cwd, { logger: ctx.logger })
    ctx.logger?.info?.(
      `dsh-git-panel: project/resolve ${result.projectRoot} → ${result.roots.length} 个根` +
        (result.warnings.length > 0 ? `（${result.warnings.length} 条提示）` : '')
    )
    for (const warning of result.warnings) ctx.logger?.warn?.(`dsh-git-panel: ${warning}`)
    return result
  }

  /* roots/add & roots/remove ------------------------------------------ */
  async function rootsAdd(request) {
    const projectRoot = requireAbsolute(request.projectRoot, 'projectRoot')
    const target = requireAbsolute(request.path, 'path')
    const result = await addExtraRoot(projectRoot, target, { logger: ctx.logger })
    clearStatusCache()
    ctx.logger?.info?.(`dsh-git-panel: 已添加外部仓库 ${normalizeSlashes(target)}`)
    for (const warning of result.warnings) ctx.logger?.warn?.(`dsh-git-panel: ${warning}`)
    return result
  }

  async function rootsRemove(request) {
    const projectRoot = requireAbsolute(request.projectRoot, 'projectRoot')
    const target = requireAbsolute(request.path, 'path')
    const result = await removeExtraRoot(projectRoot, target, { logger: ctx.logger })
    clearStatusCache()
    ctx.logger?.info?.(`dsh-git-panel: 已移除外部仓库 ${normalizeSlashes(target)}`)
    return result
  }

  /* roots/hide & roots/unhide ----------------------------------------- */
  /** 隐藏 / 取消隐藏某个根：只持久化「不想在储存库里看到它」，不动仓库本身。 */
  async function rootsHide(request) {
    const projectRoot = requireAbsolute(request.projectRoot, 'projectRoot')
    const target = requireAbsolute(request.path, 'path')
    const result = await hideRoot(projectRoot, target, { logger: ctx.logger })
    clearStatusCache()
    ctx.logger?.info?.(`dsh-git-panel: 已隐藏仓库 ${normalizeSlashes(target)}`)
    return result
  }

  async function rootsUnhide(request) {
    const projectRoot = requireAbsolute(request.projectRoot, 'projectRoot')
    const target = requireAbsolute(request.path, 'path')
    const result = await unhideRoot(projectRoot, target, { logger: ctx.logger })
    clearStatusCache()
    ctx.logger?.info?.(`dsh-git-panel: 已取消隐藏 ${normalizeSlashes(target)}`)
    return result
  }

  /* status ------------------------------------------------------------ */
  async function status(request, signal) {
    const rootPath = requireAbsolute(request.rootPath, 'rootPath')
    const key = cacheKeyOf(rootPath)
    const cached = cacheRead(key)
    if (cached !== undefined) return cached

    const repo = await resolveRepo(rootPath)
    if (!repo?.repoRoot) throw await notARepositoryError(rootPath)
    if (repo.bare) throw new GitError('not-a-repository', `裸仓库没有工作区：${normalizeSlashes(rootPath)}`)

    const repoRoot = normalizeSlashes(repo.repoRoot)
    const result = await readStatus(repoRoot, { withLineCounts: true, signal })
    const value = {
      ...result,
      rootPath: normalizeSlashes(rootPath),
      dirty: result.counts?.total ?? result.files.length
    }
    cacheWrite(key, value)
    return value
  }

  /* remote/fetch ------------------------------------------------------ */
  /**
   * 检测更新：`git fetch` 之后给最新的 ahead/behind。
   * 只更新远端跟踪引用，不改工作区与本地分支 —— 所以它仍是只读操作。
   */
  async function remoteFetch(request, signal) {
    const rootPath = requireAbsolute(request.rootPath, 'rootPath')
    const repo = await resolveRepo(rootPath)
    if (!repo?.repoRoot) throw await notARepositoryError(rootPath)
    return fetchRemote(normalizeSlashes(repo.repoRoot), { signal })
  }

  /* diff -------------------------------------------------------------- */
  async function diff(request, signal) {
    const rootPath = requireAbsolute(request.rootPath, 'rootPath')
    const rawPath = requireString(request.path, 'path')

    const repo = await resolveRepo(rootPath)
    if (!repo?.repoRoot) throw await notARepositoryError(rootPath)
    const repoRoot = normalizeSlashes(repo.repoRoot)

    // resolveInside 负责拒绝 ../ 逃逸与 .git 内部路径；它也接受根内的绝对路径。
    const absolute = resolveInside(repoRoot, rawPath)
    const relPath = normalizeSlashes(path.relative(repoRoot, absolute))
    if (relPath === '' || relPath === '.') {
      throw new GitError('bad-request', 'diff 需要指定具体文件路径，而不是仓库根')
    }

    return readDiff(repoRoot, relPath, {
      staged: request.staged === true,
      contextLines: request.contextLines,
      ignoreWhitespace: request.ignoreWhitespace === true,
      untracked: request.untracked === true,
      signal
    })
  }

  /* index/stage ------------------------------------------------------- */
  /**
   * 暂存 / 取消暂存单个文件。
   * action 由客户端按所在分组显式给出（未暂存/未跟踪 = stage，已暂存 = unstage），
   * 宿主不根据当前状态自行推断 —— 避免点的是哪一行和实际执行的命令对不上。
   */
  async function indexStage(request, signal) {
    const rootPath = requireAbsolute(request.rootPath, 'rootPath')
    const rawPath = requireString(request.path, 'path')
    if (request.action !== 'stage' && request.action !== 'unstage') {
      throw new GitError('bad-request', 'action 必须是 stage 或 unstage')
    }
    const repo = await resolveRepo(rootPath)
    if (!repo?.repoRoot) throw await notARepositoryError(rootPath)
    if (repo.bare) throw new GitError('not-a-repository', `裸仓库没有工作区：${normalizeSlashes(rootPath)}`)
    const result = await stageFile(normalizeSlashes(repo.repoRoot), rawPath, request.action, { signal })
    clearStatusCache()
    return result
  }

  /* index/stage-group ------------------------------------------------- */
  /** 分组头的批量操作。scope 由客户端按分组显式给出。 */
  async function indexStageGroup(request, signal) {
    const rootPath = requireAbsolute(request.rootPath, 'rootPath')
    const repo = await resolveRepo(rootPath)
    if (!repo?.repoRoot) throw await notARepositoryError(rootPath)
    if (repo.bare) throw new GitError('not-a-repository', `裸仓库没有工作区：${normalizeSlashes(rootPath)}`)
    const result = await stageGroup(normalizeSlashes(repo.repoRoot), request.scope, { signal })
    clearStatusCache()
    return result
  }

  /* accounts/* · remote/* ----------------------------------------------- */
  /** 每次调用都现建门面：凭据服务是延迟注入的，不能在模块加载时固定住。 */
  function remotesOf() {
    return createRemotes({ credentials: credentialsService })
  }

  async function accountsList() {
    return remotesOf().listAccounts()
  }

  async function accountsAdd(request, signal) {
    return remotesOf().addAccount({
      provider: requireString(request.provider, 'provider'),
      label: typeof request.label === 'string' ? request.label : '',
      token: requireString(request.token, 'token')
    }, { signal })
  }

  async function accountsUpdate(request, signal) {
    return remotesOf().updateAccount({
      id: requireString(request.id, 'id'),
      label: typeof request.label === 'string' ? request.label : undefined,
      token: typeof request.token === 'string' ? request.token : undefined
    }, { signal })
  }

  async function accountsToken(request) {
    return remotesOf().readToken({ id: requireString(request.id, 'id') })
  }

  async function accountsRemove(request) {
    return remotesOf().removeAccount({ id: requireString(request.id, 'id') })
  }

  async function remoteRepos(request, signal) {
    return remotesOf().listRepos({
      accountId: requireString(request.accountId, 'accountId'),
      page: Number.isInteger(request.page) ? request.page : 1
    }, { signal })
  }

  async function remoteDetail(request, signal) {
    return remotesOf().repoDetail({
      accountId: requireString(request.accountId, 'accountId'),
      fullName: requireString(request.fullName, 'fullName'),
      pageSize: Number.isInteger(request.pageSize) ? request.pageSize : 10
    }, { signal })
  }

  async function remotePullCounts(request, signal) {
    const fullNames = Array.isArray(request.fullNames) ? request.fullNames : []
    return remotesOf().pullCounts({
      accountId: requireString(request.accountId, 'accountId'),
      fullNames
    }, { signal })
  }

  async function remotePull(request, signal) {
    return remotesOf().pullDetail({
      accountId: requireString(request.accountId, 'accountId'),
      fullName: requireString(request.fullName, 'fullName'),
      number: request.number
    }, { signal })
  }

  /** PR 的文件与 patch（AI 审阅的输入，也可给界面预览）。 */
  async function remotePullDiff(request, signal) {
    return remotesOf().pullDiff({
      accountId: requireString(request.accountId, 'accountId'),
      fullName: requireString(request.fullName, 'fullName'),
      number: request.number
    }, { signal })
  }

  /** AI 审阅：读 PR diff → 调 reviewModel → 严格结构化的结论。 */
  async function remotePullAiReview(request, signal) {
    const settings = await readSettings()
    if (settings.reviewModel === null) {
      throw new GitError('no-review-model', '还没有配置 AI 审阅模型（设置页里选「审阅模型」）')
    }
    const accountId = requireString(request.accountId, 'accountId')
    const fullName = requireString(request.fullName, 'fullName')
    const number = request.number
    const detail = await remotesOf().pullDetail({ accountId, fullName, number }, { signal })
    const diff = await remotesOf().pullDiff({ accountId, fullName, number }, { signal })
    return generateReview(llmService, settings.reviewModel, { pull: detail.pull, files: diff.files }, {
      signal,
      filesTruncated: diff.truncated
    })
  }

  /**
   * 深度审阅：把 PR 的 head 拉到临时裸仓库/worktree，读完整文件后再交给模型。
   * 全程不碰用户工作区；临时目录在 finally 里删除。
   */
  /**
   * 准备一个能审阅的真实目录：本地已有就切分支，没有就告诉界面需要克隆。
   * 每一步都写日志（review.log）并回传给界面。
   */
  async function prepareReviewDir(input, signal, log) {
    const { accountId, fullName, number, rootPaths, rootPath, branch } = input
    log.info('读取 PR 详情', fullName + ' #' + number)
    const source = await log.time('读取 PR 详情', fullName + ' #' + number,
      () => remotesOf().reviewSource({ accountId, fullName, number }, { signal }))
    log.info('PR 信息', '标题「' + (source.pull.title || '') + '」，head=' + (source.pull.headBranch || '?')
      + '（' + (source.pull.headRepo || fullName) + '），提交 ' + (source.pull.headSha || '未知').slice(0, 8))

    // 1) 界面已经指定了目录（刚克隆完或复用上次的目录）
    if (typeof rootPath === 'string' && rootPath !== '') {
      const repo = await resolveRepo(requireAbsolute(rootPath, 'rootPath'))
      if (!repo?.repoRoot) throw await notARepositoryError(rootPath)
      const localRoot = normalizeSlashes(repo.repoRoot)
      log.info('使用指定目录', localRoot)
      return { source, localRoot, branch: typeof branch === 'string' ? branch : null, prepared: null }
    }

    // 2) 变更里已有的仓库
    const paths = Array.isArray(rootPaths) ? rootPaths.map((item) => String(item)) : []
    log.info('查找本地仓库', '候选 ' + paths.length + ' 个仓库根')
    const headRepo = typeof source.pull.headRepo === 'string' && source.pull.headRepo !== ''
      ? source.pull.headRepo
      : fullName
    const local = await findLocalRepoFor(paths, fullName)
      ?? await findLocalRepoFor(paths, source.repoUsed ?? fullName)
    if (local === null) {
      log.warn('没有本地仓库', '需要用户确认克隆位置（repo=' + (source.repoUsed ?? fullName) + '）')
      return { source, localRoot: null, branch: null, prepared: null }
    }
    log.info('命中本地仓库', local.rootPath)

    // 3) 当前是不是已经在 PR 的提交上？是的话只切分支，不重复 fetch
    const matched = await originMatches(local.rootPath, [fullName, source.repoUsed ?? fullName])
    const sameRepo = headRepo === fullName || matched.includes(headRepo)
    const current = await log.time('检查当前分支', local.rootPath,
      () => headShaOf(local.rootPath, { signal }))
    const prHead = typeof source.pull.headSha === 'string' ? source.pull.headSha : ''
    const alreadyAtHead = prHead !== '' && current === prHead
    log.info('分支判断', '本地 HEAD ' + current.slice(0, 8) + '，PR head ' + (prHead === '' ? '未知' : prHead.slice(0, 8))
      + '，' + (alreadyAtHead ? '已在 PR 提交上：跳过拉取' : '需要拉取'))
    if (!sameRepo) {
      log.info('fork PR', 'PR 代码在 ' + (source.repoUsed ?? fullName) + '，预检该仓库读权限')
      await log.time('预检 fork 仓库权限', source.repoUsed ?? fullName,
        () => remotesOf().assertRepoAccess({ accountId, fullName: source.repoUsed ?? fullName }, { signal }))
    }
    const prepared = await log.time(alreadyAtHead ? '切换到 PR 分支' : '拉取并切换到 PR 分支',
      sameRepo ? 'origin/' + (source.pull.headBranch || '?') : (source.repoUsed ?? fullName),
      () => prepareReviewBranch(local.rootPath, {
        sameRepo,
        alreadyAtHead,
        headBranch: source.pull.headBranch,
        url: source.url,
        remoteRef: source.remoteRef,
        number,
        user: source.user,
        token: source.token,
        authHint: source.authHint
      }, { signal }))
    log.info('分支已就绪', '当前分支 ' + prepared.branch + '，提交 ' + String(prepared.head).slice(0, 8)
      + (prepared.fetched === false ? '（未重新拉取）' : ''))
    return { source, localRoot: local.rootPath, branch: prepared.branch, prepared }
  }

  /** 阶段一：准备本地目录（查找 / 判断是否已在 PR 提交 / 切分支）。 */
  async function remotePullPrepareReview(request, signal) {
    const accountId = requireString(request.accountId, 'accountId')
    const fullName = requireString(request.fullName, 'fullName')
    const number = request.number
    const log = createReviewLog({ logger: ctx.logger }, fullName + '#' + number)
    log.info('阶段一：准备本地目录', '本地仓库候选 ' + (Array.isArray(request.rootPaths) ? request.rootPaths.length : 0) + ' 个')
    try {
      const prepared = await prepareReviewDir({
        accountId, fullName, number,
        rootPaths: request.rootPaths,
        rootPath: request.rootPath,
        branch: request.branch
      }, signal, log)
      if (prepared.localRoot === null) {
        log.warn('等待确认克隆位置', 'repo=' + (prepared.source.repoUsed ?? fullName))
        return {
          needsClone: true,
          repoUsed: prepared.source.repoUsed ?? fullName,
          headBranch: prepared.source.pull.headBranch,
          suggestedName: String(prepared.source.repoUsed ?? fullName).split('/').pop(),
          url: prepared.source.url,
          steps: log.steps,
          logPath: log.logPath
        }
      }
      log.info('阶段一完成', '目录 ' + prepared.localRoot + '，分支 ' + (prepared.branch ?? '?'))
      return {
        mode: 'local',
        rootPath: prepared.localRoot,
        branch: prepared.branch,
        pull: prepared.source.pull,
        steps: log.steps,
        logPath: log.logPath
      }
    } catch (error) {
      log.error('准备本地目录失败', error instanceof Error ? error.message : String(error))
      if (error instanceof GitError) {
        error.details = { ...(error.details ?? {}), steps: log.steps, logPath: log.logPath }
      }
      throw error
    }
  }

  /** 阶段二：读完整文件 + 调模型（不做任何 git 操作）。 */
  async function remotePullDeepReview(request, signal) {
    const settings = await readSettings()
    if (settings.reviewModel === null) {
      throw new GitError('no-review-model', '还没有配置 AI 审阅模型（设置页里选「审阅模型」）')
    }
    const accountId = requireString(request.accountId, 'accountId')
    const fullName = requireString(request.fullName, 'fullName')
    const number = request.number
    const rootPath = requireAbsolute(request.rootPath, 'rootPath')
    const branch = typeof request.branch === 'string' ? request.branch : null
    const log = createReviewLog({ logger: ctx.logger }, fullName + '#' + number)
    log.info('阶段二：读取文件并审阅', '模型 ' + settings.reviewModel.provider + '/' + settings.reviewModel.model
      + '，目录 ' + rootPath)
    try {
      const repo = await resolveRepo(rootPath)
      if (!repo?.repoRoot) throw await notARepositoryError(rootPath)
      const localRoot = normalizeSlashes(repo.repoRoot)
      const source = await log.time('读取 PR 详情', fullName + ' #' + number,
        () => remotesOf().reviewSource({ accountId, fullName, number }, { signal }))
      const diff = await log.time('读取 PR 文件列表', '最多 300 个文件',
        () => remotesOf().pullDiff({ accountId, fullName, number }, { signal }))
      log.info('文件列表', diff.files.length + ' 个文件' + (diff.truncated ? '（平台只返回部分）' : ''))
      const review = await log.time('读取完整文件并调用模型', '模型 ' + settings.reviewModel.model,
        () => deepReview({
          llm: llmService,
          pair: settings.reviewModel,
          pull: source.pull,
          files: diff.files,
          filesTruncated: diff.truncated,
          localRoot,
          branch,
          signal
        }))
      log.info('完成', '读取完整文件 ' + review.filesRead + ' 个，问题 ' + review.findings.length + ' 条')
      return { ...review, steps: log.steps, logPath: log.logPath }
    } catch (error) {
      log.error('审阅失败', error instanceof Error ? error.message : String(error))
      if (error instanceof GitError) {
        error.details = { ...(error.details ?? {}), steps: log.steps, logPath: log.logPath }
      }
      throw error
    }
  }

  /** 克隆到用户确认的目录，并切到 PR 分支。 */
  /** 会话级深度审阅：准备真实目录（切分支/克隆）→ 新建会话 → 发送审阅指令。 */
  async function remotePullSessionReview(request, signal) {
    const accountId = requireString(request.accountId, 'accountId')
    const fullName = requireString(request.fullName, 'fullName')
    const number = request.number
    if (!Number.isInteger(number) || number <= 0) throw new GitError('bad-request', 'PR 编号不合法')
    const log = createReviewLog({ logger: ctx.logger }, fullName + '#' + number)
    log.info('会话深度审阅：准备本地目录', '候选 ' + (Array.isArray(request.rootPaths) ? request.rootPaths.length : 0) + ' 个仓库根')
    const prepared = await prepareReviewDir({
      accountId,
      fullName,
      number,
      rootPaths: request.rootPaths,
      rootPath: request.rootPath,
      branch: request.branch
    }, signal, log)
    if (prepared.localRoot === null) {
      log.warn('等待确认克隆位置', 'repo=' + (prepared.source.repoUsed ?? fullName))
      return {
        needsClone: true,
        repoUsed: prepared.source.repoUsed ?? fullName,
        headBranch: prepared.source.pull.headBranch,
        suggestedName: String(prepared.source.repoUsed ?? fullName).split('/').pop(),
        steps: log.steps,
        logPath: log.logPath
      }
    }
    const diff = await log.time('读取 PR 文件清单', fullName + ' #' + number,
      () => remotesOf().pullDiff({ accountId, fullName, number }, { signal }))
    // 当前 DSH 会话属于哪个工作区：有就建到该工作区里（界面分组显示），没有才退回 cwd
    const workspace = await log.time('查找当前工作区',
      typeof request.sessionId === 'string' ? '会话 ' + request.sessionId : '未提供 sessionId',
      () => findWorkspaceForSession(workspaceControllerService, request.sessionId, signal))
    if (workspace === null) log.warn('没有找到当前工作区', '将用目录方式建会话（界面里会是未分组）')
    else log.info('工作区', workspace.title + '（' + workspace.path + '）→ ' + workspace.workspaceId)
    const started = await log.time('新建审阅会话并发指令',
      workspace === null ? '目录 ' + prepared.localRoot : '工作区 ' + workspace.title,
      () => startSessionReview({
        sessionController: sessionControllerService,
        localRoot: prepared.localRoot,
        branch: prepared.branch,
        fullName,
        pull: prepared.source.pull,
        files: diff.files,
        filesTruncated: diff.truncated,
        workspaceId: workspace === null ? null : workspace.workspaceId,
        // DSH 的 sessionController 需要 AbortSignal：把本次请求的 signal 传进去
        signal
      }))
    log.info('已新建审阅会话', started.sessionId + '，目录 ' + prepared.localRoot)
    return {
      sessionId: started.sessionId,
      rootPath: prepared.localRoot,
      branch: prepared.branch,
      steps: log.steps,
      logPath: log.logPath
    }
  }

  async function remotePullCloneForReview(request, signal) {
    const accountId = requireString(request.accountId, 'accountId')
    const fullName = requireString(request.fullName, 'fullName')
    const number = request.number
    const targetDir = requireAbsolute(request.targetDir, 'targetDir')
    const log = createReviewLog({ logger: ctx.logger }, fullName + '#' + number)
    log.info('开始克隆（深度审阅准备）', '目标目录 ' + targetDir)
    try {
      const source = await log.time('读取 PR 详情', fullName + ' #' + number,
        () => remotesOf().reviewSource({ accountId, fullName, number }, { signal }))
      // 克隆用的是插件令牌：fork PR 要先确认账号读得到那个仓库
      if (source.repoUsed !== fullName) {
        log.info('fork PR', '预检 ' + source.repoUsed + ' 的读权限')
        await remotesOf().assertRepoAccess({ accountId, fullName: source.repoUsed }, { signal })
      }
      const cloned = await log.time('克隆并切换分支', 'origin/' + (source.pull.headBranch || '?') + ' → ' + targetDir,
        () => cloneForReview(targetDir, {
          url: source.url,
          remoteRef: source.remoteRef,
          number,
          branch: source.pull.headBranch,
          user: source.user,
          token: source.token
        }, { signal }))
      log.info('克隆完成', cloned.path + '（分支 ' + cloned.branch + '）')
      return {
        rootPath: normalizeSlashes(cloned.path),
        branch: cloned.branch,
        head: cloned.head,
        steps: log.steps,
        logPath: log.logPath
      }
    } catch (error) {
      log.error('克隆失败', error instanceof Error ? error.message : String(error))
      if (error instanceof GitError) {
        error.details = { ...(error.details ?? {}), steps: log.steps, logPath: log.logPath }
      }
      throw error
    }
  }

  /** 提交评论：内容由用户在面板里确认/编辑，这里只负责发出去。 */
  async function remotePullComment(request, signal) {
    return remotesOf().commentPull({
      accountId: requireString(request.accountId, 'accountId'),
      fullName: requireString(request.fullName, 'fullName'),
      number: request.number,
      comment: requireString(request.comment, 'comment')
    }, { signal })
  }

  async function remotePullReview(request, signal) {
    return remotesOf().reviewPull({
      accountId: requireString(request.accountId, 'accountId'),
      fullName: requireString(request.fullName, 'fullName'),
      number: request.number,
      verdict: requireString(request.verdict, 'verdict'),
      body: typeof request.body === 'string' ? request.body : ''
    }, { signal })
  }

  async function remotePullPass(request, signal) {
    return remotesOf().passPull({
      accountId: requireString(request.accountId, 'accountId'),
      fullName: requireString(request.fullName, 'fullName'),
      number: request.number,
      body: typeof request.body === 'string' ? request.body : ''
    }, { signal })
  }

  async function remotePullTest(request, signal) {
    return remotesOf().testPull({
      accountId: requireString(request.accountId, 'accountId'),
      fullName: requireString(request.fullName, 'fullName'),
      number: request.number
    }, { signal })
  }

  async function remotePullMerge(request, signal) {
    return remotesOf().mergePull({
      accountId: requireString(request.accountId, 'accountId'),
      fullName: requireString(request.fullName, 'fullName'),
      number: request.number,
      method: typeof request.method === 'string' ? request.method : 'merge',
      deleteBranch: request.deleteBranch === true
    }, { signal })
  }

  async function remoteClone(request, signal) {
    return remotesOf().cloneRepo({
      accountId: requireString(request.accountId, 'accountId'),
      fullName: requireString(request.fullName, 'fullName'),
      cloneUrl: requireString(request.cloneUrl, 'cloneUrl'),
      projectRoot: requireAbsolute(request.projectRoot, 'projectRoot'),
      targetName: typeof request.targetName === 'string' ? request.targetName : ''
    }, { signal })
  }

  /* branches/list · branch/switch -------------------------------------- */
  async function branchesList(request, signal) {
    const rootPath = requireAbsolute(request.rootPath, 'rootPath')
    const repo = await resolveRepo(rootPath)
    if (!repo?.repoRoot) throw await notARepositoryError(rootPath)
    return listBranches(normalizeSlashes(repo.repoRoot), { signal })
  }

  async function branchTrack(request, signal) {
    const rootPath = requireAbsolute(request.rootPath, 'rootPath')
    const remote = requireString(request.remote, 'remote')
    const name = requireString(request.name, 'name')
    const repo = await resolveRepo(rootPath)
    if (!repo?.repoRoot) throw await notARepositoryError(rootPath)
    const result = await trackRemoteBranch(normalizeSlashes(repo.repoRoot), remote, name, { signal })
    clearStatusCache()
    return result
  }

  async function branchSwitch(request, signal) {
    const rootPath = requireAbsolute(request.rootPath, 'rootPath')
    const branch = requireString(request.name, 'name')
    const repo = await resolveRepo(rootPath)
    if (!repo?.repoRoot) throw await notARepositoryError(rootPath)
    if (repo.bare) throw new GitError('not-a-repository', `裸仓库没有工作区：${normalizeSlashes(rootPath)}`)
    const result = await switchBranch(normalizeSlashes(repo.repoRoot), branch, { signal })
    clearStatusCache()
    return result
  }

  async function branchCreate(request, signal) {
    const rootPath = requireAbsolute(request.rootPath, 'rootPath')
    const branch = requireString(request.name, 'name')
    const repo = await resolveRepo(rootPath)
    if (!repo?.repoRoot) throw await notARepositoryError(rootPath)
    if (repo.bare) throw new GitError('not-a-repository', `裸仓库没有工作区：${normalizeSlashes(rootPath)}`)
    const result = await createBranch(normalizeSlashes(repo.repoRoot), branch, { signal })
    clearStatusCache()
    return result
  }

  /* commit ------------------------------------------------------------ */
  /** 提交：有暂存只提交暂存；没有暂存则先把全部改动暂存再提交（smart commit）。 */
  async function commit(request, signal) {
    const rootPath = requireAbsolute(request.rootPath, 'rootPath')
    if (typeof request.message !== 'string') throw new GitError('bad-request', 'message 必须是字符串')
    const repo = await resolveRepo(rootPath)
    if (!repo?.repoRoot) throw await notARepositoryError(rootPath)
    if (repo.bare) throw new GitError('not-a-repository', `裸仓库没有工作区：${normalizeSlashes(rootPath)}`)
    const result = await commitIndex(normalizeSlashes(repo.repoRoot), request.message, { signal })
    clearStatusCache()
    return result
  }

  /* commit/message ---------------------------------------------------- */
  /**
   * 生成提交说明。差异来源按 VS Code 的习惯：有暂存看暂存，没有才看未暂存。
   * 用哪一个模型只认设置里保存的 commitModel。
   */
  async function commitMessage(request, signal) {
    const rootPath = requireAbsolute(request.rootPath, 'rootPath')
    const repo = await resolveRepo(rootPath)
    if (!repo?.repoRoot) throw await notARepositoryError(rootPath)
    const diff = await commitDiffText(normalizeSlashes(repo.repoRoot), { signal })
    if (diff === null) throw new GitError('nothing-to-commit', '没有可生成提交说明的改动')
    const settings = await readSettings()
    if (settings.commitModel === null) {
      throw new GitError('no-commit-model', '还没有配置生成提交说明的模型')
    }
    const generated = await generateCommitMessage(llmService, settings.commitModel, diff.text, { signal })
    return { ...generated, source: diff.source }
  }

  /* models / settings ------------------------------------------------- */
  /** 列出 DSH 当前可用的模型（来自 llm 服务，不读任何配置文件）。 */
  async function modelsList() {
    return listModels(llmService)
  }

  async function settingsGet() {
    return readSettings()
  }

  /** 保存「生成提交说明用的模型」。null 表示清空；非空时必须在当前目录里。 */
  async function settingsSet(request) {
    const patch = {}
    for (const field of ['commitModel', 'reviewModel']) {
      if (!(field in request)) continue
      const raw = request[field]
      if (raw === null) {
        patch[field] = null
        continue
      }
      if (typeof raw !== 'string') {
        throw new GitError('bad-request', field + ' 必须是 "provider/model" 或 null')
      }
      const pair = parseRef(raw)
      if (pair === null) throw new GitError('bad-request', field + ' 必须是 "provider/model"：' + raw)
      await requireModel(llmService, pair)
      patch[field] = pair
    }
    if (Object.keys(patch).length === 0) {
      throw new GitError('bad-request', '没有要修改的模型设置')
    }
    return writeSettings(patch)
  }

  /* file/read --------------------------------------------------------- */
  async function fileRead(request, signal) {
    const rootPath = requireAbsolute(request.rootPath, 'rootPath')
    const rawPath = requireString(request.path, 'path')

    // 契约：file/read 的 path 相对 rootPath（文件浏览模式）；diff 的 path 相对 repoRoot。
    return readTextFile(resolveInside(rootPath, rawPath), { signal })
  }

  /* file/write -------------------------------------------------------- */
  /**
   * 保存编辑器内容。
   *
   * `expectedHash` 是必填的乐观并发凭据（客户端从 file/read 拿到）；只有用户确认过
   * 「覆盖保存」才会带 `force: true`。这样"静默覆盖别人的改动"在不变量层面就不可能发生。
   */
  async function fileWrite(request, signal) {
    const rootPath = requireAbsolute(request.rootPath, 'rootPath')
    const rawPath = requireString(request.path, 'path')
    if (typeof request.text !== 'string') throw new GitError('bad-request', 'text 必须是字符串')
    if (request.eol !== 'lf' && request.eol !== 'crlf') throw new GitError('bad-request', 'eol 必须是 lf 或 crlf')
    if (typeof request.bom !== 'boolean') throw new GitError('bad-request', 'bom 必须是布尔值')
    const force = request.force === true
    if (force !== true && typeof request.expectedHash !== 'string') {
      throw new GitError('bad-request', '缺少 expectedHash（覆盖保存请显式传 force: true）')
    }
    return writeTextFile(resolveInside(rootPath, rawPath), request.text, {
      expectedHash: force ? null : request.expectedHash,
      force,
      eol: request.eol,
      bom: request.bom,
      signal
    })
  }

  /* tree/list --------------------------------------------------------- */
  async function treeList(request, signal) {
    const rootPath = requireAbsolute(request.rootPath, 'rootPath')
    const rawPath = typeof request.path === 'string' ? request.path : ''
    const absolute = resolveInside(rootPath, rawPath)
    return listDirectory(absolute, { signal })
  }

  /* 路由 -------------------------------------------------------------- */

  /**
   * 端点 → 处理函数。与 ENDPOINTS 一一对应：构造时逐个校验，缺一个就立即抛错
   * （注册路由阶段失败，而不是等用户点到那个按钮才暴露）。
   */
  const HANDLERS = {
    'project/resolve': (request, signal) => projectResolve(request),
    'roots/add': (request, signal) => rootsAdd(request),
    'roots/remove': (request, signal) => rootsRemove(request),
    'roots/hide': (request, signal) => rootsHide(request),
    'roots/unhide': (request, signal) => rootsUnhide(request),
    'status': (request, signal) => status(request, signal),
    'remote/fetch': (request, signal) => remoteFetch(request, signal),
    'diff': (request, signal) => diff(request, signal),
    'file/read': (request, signal) => fileRead(request, signal),
    'file/write': (request, signal) => fileWrite(request, signal),
    'index/stage': (request, signal) => indexStage(request, signal),
    'index/stage-group': (request, signal) => indexStageGroup(request, signal),
    'accounts/list': () => accountsList(),
    'accounts/add': (request, signal) => accountsAdd(request, signal),
    'accounts/update': (request, signal) => accountsUpdate(request, signal),
    'accounts/token': (request, signal) => accountsToken(request),
    'accounts/remove': (request, signal) => accountsRemove(request),
    'remote/repos': (request, signal) => remoteRepos(request, signal),
    'remote/detail': (request, signal) => remoteDetail(request, signal),
    'remote/pr-counts': (request, signal) => remotePullCounts(request, signal),
    'remote/pull': (request, signal) => remotePull(request, signal),
    'remote/pull/diff': (request, signal) => remotePullDiff(request, signal),
    'remote/pull/ai-review': (request, signal) => remotePullAiReview(request, signal),
    'remote/pull/prepare-review': (request, signal) => remotePullPrepareReview(request, signal),
    'remote/pull/deep-review': (request, signal) => remotePullDeepReview(request, signal),
    'remote/pull/session-review': (request, signal) => remotePullSessionReview(request, signal),
    'remote/pull/clone-for-review': (request, signal) => remotePullCloneForReview(request, signal),
    'remote/pull/comment': (request, signal) => remotePullComment(request, signal),
    'remote/pull/review': (request, signal) => remotePullReview(request, signal),
    'remote/pull/pass': (request, signal) => remotePullPass(request, signal),
    'remote/pull/test': (request, signal) => remotePullTest(request, signal),
    'remote/pull/merge': (request, signal) => remotePullMerge(request, signal),
    'remote/clone': (request, signal) => remoteClone(request, signal),
    'branches/list': (request, signal) => branchesList(request, signal),
    'branch/switch': (request, signal) => branchSwitch(request, signal),
    'branch/track': (request, signal) => branchTrack(request, signal),
    'branch/create': (request, signal) => branchCreate(request, signal),
    'commit': (request, signal) => commit(request, signal),
    'commit/message': (request, signal) => commitMessage(request, signal),
    'models/list': () => modelsList(),
    'settings/get': () => settingsGet(),
    'settings/set': (request, signal) => settingsSet(request),
    'tree/list': (request, signal) => treeList(request, signal),
  }

  for (const endpoint of ENDPOINTS) {
    if (typeof HANDLERS[endpoint] !== 'function') {
      throw new Error('缺少端点的处理函数：' + endpoint)
    }
  }

  return async function dispatch(endpoint, payload, signal) {
    const handler = HANDLERS[endpoint]
    if (handler === undefined) {
      throw new GitError('unknown-endpoint', `未知的 RPC 端点：${String(endpoint)}`)
    }
    return handler(asObject(payload), signal)
  }
}

/* ---------------------------------------------------------------- 入口 */

/** 构造 handler；apply() 与测试共用。 */
function createHandler(ctx) {
  const dispatch = createDispatcher(ctx)
  return async function handler(endpoint, payload, signal) {
    try {
      return ok(await dispatch(endpoint, payload, signal))
    } catch (error) {
      // 任何失败都必须变成信封；这里再兜一层，避免 mapError 本身出意外把请求打成 500。
      let mapped
      try {
        mapped = mapError(error)
      } catch {
        mapped = { code: 'internal', message: '处理请求时发生未知错误', details: {} }
      }
      try {
        ctx.logger?.warn?.(`dsh-git-panel: ${String(endpoint)} 失败 [${mapped.code}] ${mapped.message}`)
      } catch {
        /* ignore */
      }
      return fail(mapped.code, mapped.message, mapped.details)
    }
  }
}

/**
 * 插件入口。
 *
 * 依赖通过命令式 `ctx.inject(['connection'], cb)` 注入（原因见文件顶部注释），
 * 然后在回调里为每个 endpoint 注册一条精确 Fetch 路由。
 */
export function apply(ctx) {
  // LLM 服务只用于「生成提交说明」：单独注入并留住引用，
  // 这样 profile 没挂 llm 时面板其余功能照常可用，缺失只会在生成时报明确错误。
  ctx.inject(['llm'], (scope) => {
    scope.effect(() => {
      llmService = scope.llm
      return () => {
        llmService = null
      }
    }, `${name}: llm service`)
  })

  // 凭据服务只用于「代码托管账号的令牌」：单独注入并留住引用。
  // 这个组合没有凭据服务时，面板其余功能照常，账号相关端点会明确报 no-credentials。
  ctx.inject(['credentials'], (scope) => {
    scope.effect(() => {
      credentialsService = scope.credentials
      return () => {
        credentialsService = null
      }
    }, `${name}: credentials service`)
  })

  ctx.inject(['workspaceController'], (scope) => {
    scope.effect(() => {
      workspaceControllerService = scope.workspaceController
      return () => {
        workspaceControllerService = null
      }
    }, `${name}: workspace controller service`)
  })

  ctx.inject(['sessionController'], (scope) => {
    scope.effect(() => {
      sessionControllerService = scope.sessionController
      return () => {
        sessionControllerService = null
      }
    }, `${name}: sessionController service`)
  })

  ctx.inject(['connection'], (scope) => {
    scope.effect(() => acquireRoutes(scope), `${name}: fetch routes`)
    scope.logger?.info?.(`dsh-git-panel: 已注册 ${ENDPOINTS.length} 条 Fetch 路由（${RPC_CHANNEL}/${RPC_NAMESPACE}/*）`)
  })
}

/* ------------------------------------------------- 路由注册（进程内单例） */

let routeRefs = 0
let routeDisposers = []
/** 宿主注入的 LLM 服务；未挂载时为 null（生成时报 no-llm）。 */
let llmService = null
/** 宿主注入的凭据服务；未挂载时为 null（账号相关端点报 no-credentials）。 */
let credentialsService = null
/** 宿主注入的会话控制器：会话级深度审阅用它建会话、发首条提示词。 */
let sessionControllerService = null
/** 宿主注入的工作区控制器：用来把审阅会话建到当前工作区里（而不是未分组）。 */
let workspaceControllerService = null

/** endpoint → 精确路由路径。 */
export function routePathOf(endpoint) {
  return `${RPC_CHANNEL}/${RPC_NAMESPACE}/${endpoint}`
}

/** 客户端 `rpc.call` 里要传的 method（连接服务要求与 endpoint 一致）。 */
function methodOf(endpoint) {
  return `${RPC_NAMESPACE}/${endpoint}`
}

/**
 * 一条 endpoint 路由的 fetch 处理器：校验信封 → 复用 createHandler 的分发/错误映射 → 原样回 rpcId。
 */
function createRouteFetch(endpoint, handle) {
  const method = methodOf(endpoint)
  return async function fetch(request) {
    let body
    try {
      body = await request.json()
    } catch {
      return new Response('body is not JSON', { status: 400 })
    }
    if (body === null || typeof body !== 'object' || body.type !== 'client-request'
      || typeof body.rpcId !== 'string' || typeof body.method !== 'string') {
      return new Response('invalid client-request envelope', { status: 400 })
    }
    if (body.method !== method) {
      return respondEnvelope(body.rpcId, fail('bad-request', `method mismatch: ${body.method}`))
    }
    // createHandler 内部已 try/catch 并把任何异常映射成错误信封
    return respondEnvelope(body.rpcId, await handle(endpoint, body.payload))
  }
}

/** 回包形状与连接服务一致：{ type, rpcId, result }。 */
function respondEnvelope(rpcId, result) {
  return new Response(JSON.stringify({ type: 'server-response', rpcId, result }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

/**
 * Fetch 路由是「进程内唯一」资源：同一路径重复注册会被连接服务拒绝
 * （`connection: exact Fetch route "…" is already registered`），而 apply 可能被
 * 调用多次（HMR 重载）。这里按引用计数持有整组路由：第一次真正的 apply 注册，
 * 最后一个 disposer 执行时才注销。
 */
function acquireRoutes(ctx) {
  if (routeRefs === 0) {
    const handle = createHandler(ctx)
    routeDisposers = ENDPOINTS.map((endpoint) => ctx.connection.fetch.register({
      path: routePathOf(endpoint),
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: createRouteFetch(endpoint, handle)
    }))
  }
  routeRefs += 1

  let released = false
  return () => {
    if (released) return
    released = true
    routeRefs -= 1
    if (routeRefs > 0) return
    const disposers = routeDisposers
    routeDisposers = []
    for (const dispose of disposers) if (typeof dispose === 'function') dispose()
  }
}




