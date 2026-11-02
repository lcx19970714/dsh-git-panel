/**
 * host/remotes/http.js —— 远端 API 的 HTTP 底座
 *
 * 只做四件事：带超时的 fetch、把失败归一成 GitError、读 JSON、解析分页 Link。
 * 平台的鉴权差异不在这里（各 provider 的 authorize 负责把 token 放对位置）。
 */
import { GitError } from '../git.js'

const API_TIMEOUT_MS = 20000

export function messageOf(error) {
  if (error === null || error === undefined) return '未知错误'
  if (typeof error === 'string') return error
  return typeof error.message === 'string' ? error.message : String(error)
}

/** 从 Link 头里取最后一页的页码；没有 Link 就返回 null（不猜总数）。 */
export function lastPageOf(linkHeader) {
  if (typeof linkHeader !== 'string' || linkHeader === '') return null
  const match = /[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(linkHeader)
  if (match === null) return null
  const page = Number.parseInt(match[1], 10)
  return Number.isFinite(page) && page > 0 ? page : null
}

/** 带超时的 fetch，失败归一成 GitError（调用方只需要关心「失败了，原因是什么」）。 */
export async function request(fetchImpl, url, options, signal) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) throw new GitError('timeout', '访问 ' + url + ' 超时')
    throw new GitError('remote-api-failed', '访问 ' + url + ' 失败：' + messageOf(error))
  } finally {
    clearTimeout(timer)
    if (signal !== undefined) signal.removeEventListener('abort', onAbort)
  }
}

/**
 * 读 JSON，并把「失败」说清楚。
 *
 * **空响应是合法的成功**：`204 No Content` / 长度为 0 的 200 在 REST 里表示
 * 「做完了，没什么可回」。Gitee 的审查通过接口（POST /pulls/{n}/review）就是这样，
 * 之前把它当成「不是 JSON」直接报错，导致审查明明成功却提示失败。
 * 因此这里返回 null 表示「成功但没有响应体」，调用方按需处理。
 *
 * 404 单独成句：Gitee 对「无权访问的私有仓库」返回 404 而不是 401，
 * 只说「找不到」会让人往错的方向查。
 */
export async function readJson(response) {
  const text = await response.text()
  if (!response.ok) {
    let reason
    if (response.status === 401 || response.status === 403) {
      reason = '令牌无效或已过期（HTTP ' + response.status + '）'
    } else if (response.status === 404) {
      reason = 'HTTP 404：仓库或 PR 不存在、已改名/删除，或令牌没有访问它的权限（私有仓库需要项目读权限）'
    } else {
      reason = 'HTTP ' + response.status
    }
    throw new GitError('remote-auth-failed', reason + '：' + text.slice(0, 300))
  }
  const trimmed = text.trim()
  if (trimmed === '') return null
  try {
    return JSON.parse(trimmed)
  } catch {
    throw new GitError('remote-api-failed', '接口返回的不是 JSON：' + trimmed.slice(0, 200))
  }
}

/**
 * 需要对象的响应：空体/非对象视为平台没按约定返回，直接报错。
 * 列表与「只要成功就好」的写接口不走这里。
 */
export async function readObject(response, what) {
  const value = await readJson(response)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new GitError('remote-api-failed', '平台没有返回' + what)
  }
  return value
}

/** 需要数组的响应。 */
export async function readArray(response, what) {
  const value = await readJson(response)
  if (!Array.isArray(value)) {
    throw new GitError('remote-api-failed', '平台没有返回' + what + '列表')
  }
  return value
}
