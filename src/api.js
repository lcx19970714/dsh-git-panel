/**
 * src/api.js —— 宿主 RPC 封装
 *
 * 线上协议：
 *   客户端  ctx.connection.rpc.call('/api', 'dsh-git/<endpoint>', payload, signal)
 *   宿主端  connection.fetch.register({ path: '/api/dsh-git/<endpoint>', … })
 *   返回封套 { ok: true, value } | { ok: false, error: { code, message, details } }
 *
 * 这里只做三件事：拆封套、加超时、把错误归一成带 code 的 RpcError。
 * 不做通道/服务的降级尝试 —— apply(ctx) 的 inject 已保证 connection 存在。
 */
import { getPluginContext } from './platform.js'

const RPC_CHANNEL = '/api'
/** 本插件的路由命名空间：宿主注册为 `/api/dsh-git/<endpoint>`。 */
const RPC_NAMESPACE = 'dsh-git'

const TIMEOUT_MS = 20_000

/** 归一化后的 RPC 错误（渲染层只认 code 与 message）。 */
class RpcError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    this.details = details === undefined || details === null ? {} : details
  }
}

/** 宿主错误码 → 文案 key；没列出的码一律走 error.generic 并带上服务端原文。 */
const MESSAGE_KEYS = {
  'git-missing': 'error.gitMissing',
  'not-a-repository': 'error.notRepository',
  'timeout': 'error.timeout',
  'outside-root': 'error.outsideRoot',
  'forbidden-path': 'error.outsideRoot',
  'no-session': 'status.noSession',
  'no-cwd': 'status.noCwd',
  'no-commit-model': 'commit.noModel',
  'nothing-to-commit': 'commit.nothing',
  'unmerged': 'commit.unmerged',
  'no-llm': 'settings.noLlm',
  'unknown-model': 'settings.unknownModel',
  'model-failed': 'commit.generateFailed'
}

/**
 * 调一个 host 端点。
 * @param {string} endpoint
 * @param {object} payload
 * @param {{signal?: AbortSignal, timeoutMs?: number}} [options]
 */
export async function call(endpoint, payload, options) {
  const opts = options ?? {}
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const forward = () => controller.abort()
  if (opts.signal !== undefined) opts.signal.addEventListener('abort', forward, { once: true })

  let envelope
  try {
    envelope = await getPluginContext().connection.rpc.call(
      RPC_CHANNEL,
      RPC_NAMESPACE + '/' + endpoint,
      payload ?? {},
      controller.signal
    )
  } catch (error) {
    if (opts.signal !== undefined && opts.signal.aborted) throw new RpcError('aborted', '已取消')
    if (controller.signal.aborted) throw new RpcError('timeout', '请求超时')
    throw new RpcError('transport', error instanceof Error ? error.message : String(error))
  } finally {
    clearTimeout(timer)
    if (opts.signal !== undefined) opts.signal.removeEventListener('abort', forward)
  }

  if (envelope.ok === true) return envelope.value
  throw new RpcError(envelope.error.code, envelope.error.message, envelope.error.details)
}

/* ============================ 具体端点 ============================ */

/** 解析项目的 git 根（primary / 浏览根 / discovered / extra）。 */
export function resolveProject(payload, options) {
  return call('project/resolve', payload, options)
}

/** 读某个根的 status。 */
export function readStatus(payload, options) {
  return call('status', payload, options)
}

/** 读单个文件的 diff（path 相对 repoRoot）。 */
export function readDiff(payload, options) {
  return call('diff', payload, options)
}

/** 读文件文本内容（path 相对 rootPath）。 */
export function readFile(payload, options) {
  return call('file/read', payload, options)
}

/** 检测更新：宿主执行 `git fetch` 后返回最新 ahead/behind（只读，不动工作区）。 */
export function fetchRemote(payload, options) {
  return call('remote/fetch', payload, options)
}

/** 保存文件内容（path 相对 rootPath；expectedHash 是乐观并发凭据，force 只在确认覆盖后用）。 */
export function writeFile(payload, options) {
  return call('file/write', payload, options)
}

/** 暂存 / 取消暂存单个文件（path 相对仓库根；action 为 stage 或 unstage）。 */
export function stageFile(payload, options) {
  return call('index/stage', payload, options)
}

/** 整组暂存 / 取消暂存（scope 为 stage-unstaged / stage-untracked / unstage）。 */
export function stageGroup(payload, options) {
  return call('index/stage-group', payload, options)
}

/** 代码托管账号列表（列表接口不含 token）。 */
export function listAccounts(payload, options) {
  return call('accounts/list', payload, options)
}

export function addAccount(payload, options) {
  return call('accounts/add', payload, options)
}

/** 改备注名 / 换令牌（换令牌会先验证）。 */
export function updateAccount(payload, options) {
  return call('accounts/update', payload, options)
}

/** 取令牌原文：只在用户点「显示」时调用。 */
export function readAccountToken(payload, options) {
  return call('accounts/token', payload, options)
}

export function removeAccount(payload, options) {
  return call('accounts/remove', payload, options)
}

/** 列某个账号下的仓库（一页 100 条）。 */
export function listRemoteRepos(payload, options) {
  return call('remote/repos', payload, options)
}

/** 仓库详情：代码概况 + 未关闭 issue/PR 数量 + 最近条目。 */
export function remoteDetail(payload, options) {
  return call('remote/detail', payload, options)
}

/** 批量取若干仓库的未合并 PR 数量。 */
export function remotePullCounts(payload, options) {
  return call('remote/pr-counts', payload, options)
}

/** 一个 PR 的详情（含平台能力与审查记录）。 */
export function remotePull(payload, options) {
  return call('remote/pull', payload, options)
}

/** 提交审查结论。 */
export function remotePullReview(payload, options) {
  return call('remote/pull/review', payload, options)
}

/** 标记 PR 测试通过（Gitee 的合并门禁之一）。 */
export function remotePullTest(payload, options) {
  return call('remote/pull/test', payload, options)
}

/** PR 的文件与 patch（AI 审阅的输入）。 */
export function remotePullDiff(payload, options) {
  return call('remote/pull/diff', payload, { ...(options ?? {}), timeoutMs: options?.timeoutMs ?? 60_000 })
}

/** 调审阅模型给出结构化结论。 */
export function remotePullAiReview(payload, options) {
  // 模型调用本身就慢：默认 20s 会让客户端先超时，而宿主还在跑
  return call('remote/pull/ai-review', payload, { ...(options ?? {}), timeoutMs: options?.timeoutMs ?? 240_000 })
}

/** 深度审阅：宿主拉取 PR head 到临时 worktree，读完整文件后再让模型审。 */
export function remotePullPrepareReview(payload, options) {
  // 阶段一：找仓库 / 判断是否已在 PR 提交 / 切分支（必要时才 fetch）
  return call('remote/pull/prepare-review', payload, { ...(options ?? {}), timeoutMs: options?.timeoutMs ?? 600_000 })
}

export function remotePullSessionReview(payload, options) {
  return call('remote/pull/session-review', payload, { ...(options ?? {}), timeoutMs: options?.timeoutMs ?? 600_000 })
}

export function remotePullDeepReview(payload, options) {
  // 阶段二：只读完整文件 + 调模型
  return call('remote/pull/deep-review', payload, { ...(options ?? {}), timeoutMs: options?.timeoutMs ?? 300_000 })
}

/** 把 PR 克隆到指定目录（深度审阅前的准备步骤）。 */
export function remotePullCloneForReview(payload, options) {
  return call('remote/pull/clone-for-review', payload, { ...(options ?? {}), timeoutMs: options?.timeoutMs ?? 900_000 })
}

/** 关闭 / 重新打开 PR（state: 'open' | 'closed'）。 */
export function remotePullState(payload, options) {
  return call('remote/pull/state', payload, options)
}

/** 提交用户确认过的 PR 评论。 */
export function remotePullComment(payload, options) {
  return call('remote/pull/comment', payload, options)
}

/** 一键「审查与测试都通过」（按平台能力执行）。 */
export function remotePullPass(payload, options) {
  return call('remote/pull/pass', payload, options)
}

/** 合并 PR。 */
export function remotePullMerge(payload, options) {
  return call('remote/pull/merge', payload, options)
}

/** 把远端仓库克隆到项目根下的子目录。 */
export function cloneRemoteRepo(payload, options) {
  return call('remote/clone', payload, options)
}

/** 从储存库隐藏一个根（持久化；项目本身不可隐藏）。 */
export function hideRoot(payload, options) {
  return call('roots/hide', payload, options)
}

/** 取消隐藏。 */
export function unhideRoot(payload, options) {
  return call('roots/unhide', payload, options)
}

/** 列出本地分支。 */
export function listBranches(payload, options) {
  return call('branches/list', payload, options)
}

/** 把「仅远程」的分支建成本地跟踪分支并切过去。 */
export function trackBranch(payload, options) {
  return call('branch/track', payload, options)
}

/** 切换分支（工作区怎么处理交给 git）。 */
export function switchBranch(payload, options) {
  return call('branch/switch', payload, options)
}

/** 从当前 HEAD 创建分支并立刻切过去。 */
export function createBranch(payload, options) {
  return call('branch/create', payload, options)
}

/** 提交：有暂存只提交暂存，没有则先全部暂存。 */
export function commitChanges(payload, options) {
  return call('commit', payload, options)
}

/** 按设置里的模型生成提交说明。 */
export function commitMessage(payload, options) {
  return call('commit/message', payload, { ...(options ?? {}), timeoutMs: options?.timeoutMs ?? 70_000 })
}

/** 创建 PR 前的准备信息（仓库 / 账号 / 源分支 / 目标分支候选 / 是否已推送）。 */
export function prPrepare(payload, options) {
  return call('pr/prepare', payload, options)
}

/** 用模型生成 PR 标题与描述。 */
export function prGenerate(payload, options) {
  return call('pr/generate', payload, { ...(options ?? {}), timeoutMs: options?.timeoutMs ?? 120_000 })
}

/** 创建 PR。 */
export function prCreate(payload, options) {
  return call('pr/create', payload, { ...(options ?? {}), timeoutMs: options?.timeoutMs ?? 120_000 })
}

/** 模型目录（来自 profile 的 llm-pi-ai 配置）。 */
export function listModels(payload, options) {
  return call('models/list', payload, options)
}

/** 读插件设置。 */
export function readSettings(payload, options) {
  return call('settings/get', payload, options)
}

/** 保存插件设置。 */
export function writeSettings(payload, options) {
  return call('settings/set', payload, options)
}

/** 列目录（path 相对 rootPath）。 */
export function listDirectory(payload, options) {
  return call('tree/list', payload, options)
}

/** 添加外部仓库根。 */
export function addRoot(payload, options) {
  return call('roots/add', payload, options)
}

/** 移除外部仓库根。 */
export function removeRoot(payload, options) {
  return call('roots/remove', payload, options)
}

/**
 * 把错误渲染成一句用户能懂的话。
 *
 * `message` 必须传下去：像「生成提交说明失败：{message}」这种带占位符的文案，
 * 不传就只剩字面的 `{message}`，用户永远看不到真正原因（曾经就是这样）。
 */
export function describeError(error, t) {
  const code = error === null || error === undefined ? '' : error.code
  const message = error instanceof Error
    ? error.message
    : (typeof error === 'string' ? error : String(error ?? ''))
  const key = MESSAGE_KEYS[code]
  if (key !== undefined) return t(key, { message })
  return t('error.generic', { message })
}
