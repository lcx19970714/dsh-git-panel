/**
 * dsh-git-panel —— Host 半体（纯 ESM，只用 node 内置模块 + host/git.js）
 *
 * 注册方式（见 _recon/notes/host-api.md §2.1）：
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
 *   status          { rootPath }                -> StatusResult + dirty
 *   diff            { rootPath, path, … }       -> DiffResult
 *   remote/fetch    { rootPath }               -> {url, branch, head, upstream, ahead, behind, fetchedAt}（git fetch，只读）
 *   file/read       { rootPath, path }          -> FileResult（含 hash/bom/eol，保存时要用）
 *   file/write      { rootPath, path, text, expectedHash|force, eol, bom } -> WriteResult
 *   tree/list       { rootPath, path }          -> TreeResult
 *
 * v1 没有 Config（不需要 schemastery），也没有 AI-facing tool。
 */
import { stat } from 'node:fs/promises'
import { appendFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
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
  writeTextFile
} from './host/git.js'
import { resolveRoots, addExtraRoot, removeExtraRoot } from './host/roots.js'

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
  'status',
  'remote/fetch',
  'diff',
  'file/read',
  'file/write',
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
  return async function dispatch(endpoint, payload, signal) {
    const request = asObject(payload)
    switch (endpoint) {
      case 'project/resolve':
        return projectResolve(request)
      case 'roots/add':
        return rootsAdd(request)
      case 'roots/remove':
        return rootsRemove(request)
      case 'status':
        return status(request, signal)
      case 'remote/fetch':
        return remoteFetch(request, signal)
      case 'diff':
        return diff(request, signal)
      case 'file/read':
        return fileRead(request, signal)
      case 'file/write':
        return fileWrite(request, signal)
      case 'tree/list':
        return treeList(request, signal)
      default:
        throw new GitError('unknown-endpoint', `未知的 RPC 端点：${String(endpoint)}`)
    }
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
  hostApplyCount += 1
  appendHostLog('apply #' + hostApplyCount + ' inject=' + typeof ctx.inject)

  ctx.inject(['connection'], (scope) => {
    try {
      scope.effect(() => acquireRoutes(scope), `${name}: fetch routes`)
    } catch (error) {
      // 排障：异常原文落到追加日志里，然后照旧抛出（失败必须可见）
      appendHostLog('register-failed: ' + (error && error.stack ? error.stack : describe(error)))
      throw error
    }
    appendHostLog('registered ' + ENDPOINTS.length + ' routes under ' + RPC_CHANNEL + '/' + RPC_NAMESPACE)
    scope.logger?.info?.(`dsh-git-panel: 已注册 ${ENDPOINTS.length} 条 Fetch 路由（${RPC_CHANNEL}/${RPC_NAMESPACE}/*）`)
  })
}

/* ------------------------------------------------- 路由注册（进程内单例） */

let hostApplyCount = 0
let routeRefs = 0
let routeDisposers = []

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

/* ------------------------------------------------------- 启动诊断（排障用） */

/** DSH_HOME（调用时解析，测试会指到临时目录）。 */
function dshHomeDir() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv
  try {
    return path.join(os.homedir(), '.dsh')
  } catch {
    return os.tmpdir()
  }
}

/** 宿主排障日志（放在 DSH_HOME 下，避免被测试进程覆盖）。 */
function hostLogPath() {
  return path.join(dshHomeDir(), 'dsh-git-panel-host.log')
}

/**
 * 模块被 import 时就落一个标记。
 * 有标记 = 模块成功加载；没标记 = 加载器根本没加载到这个包（那是组合层的问题，不是插件代码的问题）。
 */
try {
  writeFileSync(path.join(dshHomeDir(), 'dsh-git-panel-host-import.json'), JSON.stringify({
    pid: process.pid,
    at: new Date().toISOString(),
    dshHome: dshHomeDir(),
    argv: process.argv.slice(0, 3)
  }, null, 2), 'utf8')
} catch {
  /* 诊断不能反过来影响加载 */
}

/**
 * 宿主半体的启动日志（临时排障用，链路确认后删除）。
 *
 * 追加写，所以能看到完整的调用序列 —— 例如 apply 是否被调用了两次：
 *   apply
 *   registered
 *   apply            ← 第二次 apply
 *   register-failed: webserver: duplicate prefix route "/dsh-git"
 */
function appendHostLog(event) {
  try {
    appendFileSync(hostLogPath(), `${new Date().toISOString()} pid=${process.pid} ${event}\n`, 'utf8')
  } catch {
    /* 排障写入失败不能影响插件 */
  }
}


