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
  'no-cwd': 'status.noCwd'
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

/** 把错误渲染成一句用户能懂的话。 */
export function describeError(error, t) {
  const key = MESSAGE_KEYS[error === null || error === undefined ? '' : error.code]
  if (key !== undefined) return t(key)
  const message = error instanceof Error ? error.message : String(error)
  return t('error.generic', { message })
}
