/**
 * host/remotes/http.js —— 远端 API 的 HTTP 底座
 *
 * 只做四件事：带超时的 fetch、把失败归一成 GitError、读 JSON、解析分页 Link。
 * 平台的鉴权差异不在这里（各 provider 的 authorize 负责把 token 放对位置）。
 */
import { GitError } from '../git.js'

const API_TIMEOUT_MS = 20000

/**
 * 把 URL 里的令牌打码。
 *
 * Gitee 的 token 放在 query 上（`?access_token=…`），而错误信息会原样带回界面与日志；
 * 一条「访问超时」就把令牌抄进截图里，是实打实的泄漏。所有面向用户的 URL 都先过这里。
 */
function redactUrl(url) {
  return String(url).replace(/([?&](?:access_token|token|api_key|key)=)[^&]*/gi, '$1***')
}

export function messageOf(error) {
  if (error === null || error === undefined) return '未知错误'
  if (typeof error === 'string') return error
  return typeof error.message === 'string' ? error.message : String(error)
}

/** 从 Link 头里取最后一页的页码；没有 Link 就返回 null（不猜总数）。 */
export function lastPageOf(linkHeader) {
  if (typeof linkHeader !== 'string' || linkHeader === '') return null
  // 引号两家不同：GitHub 用 rel="last"，Gitee 用 rel='last'
  const match = /[?&]page=(\d+)[^>]*>;\s*rel=['"]last['"]/.exec(linkHeader)
  if (match === null) return null
  const page = Number.parseInt(match[1], 10)
  return Number.isFinite(page) && page > 0 ? page : null
}

/**
 * 列表总数：优先 Link 的 last 页（page=N 且 per_page=1 时就是总数），
 * 其次 `total_count`（Gitee 的响应头、GitHub search 的响应体）。
 * 两者都没有就返回 null —— 界面显示「数量未知」，不编数字。
 */
export function totalOf(linkHeader, body) {
  const last = lastPageOf(linkHeader)
  if (last !== null) return last
  if (body !== null && body !== undefined && typeof body === 'object' && !Array.isArray(body)) {
    if (typeof body.total_count === 'number' && Number.isFinite(body.total_count)) return body.total_count
  }
  return null
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
    if (controller.signal.aborted) throw new GitError('timeout', '访问 ' + redactUrl(url) + ' 超时')
    // 底层错误（undici / DNS）有时会把整条 URL 抄进 message，这里一起打码
    throw new GitError('remote-api-failed', '访问 ' + redactUrl(url) + ' 失败：' + redactUrl(messageOf(error)))
  } finally {
    clearTimeout(timer)
    if (signal !== undefined) signal.removeEventListener('abort', onAbort)
  }
}

/**
 * 发送 JSON 请求体。
 *
 * 必须显式设置 Content-Type：fetch 对字符串 body 默认 text/plain，
 * Gitee 会以 406 拒绝（The requested content-type 'text/plain' is not supported）。
 * 所有 POST/PUT 都走这里，别再手写 body。
 */
export async function requestJson(fetchImpl, url, init, signal) {
  const headers = { ...init.headers, 'Content-Type': 'application/json;charset=UTF-8' }
  return request(fetchImpl, url, {
    method: init.method,
    headers,
    body: JSON.stringify(init.json === undefined ? {} : init.json)
  }, signal)
}

/**
 * 平台把「业务规则」也塞进 4xx：Gitee 的「此 Pull Request 存在冲突」返回的就是 403，
 * 而且和真正的鉴权失败长得一模一样。只看状态码会把它报成「令牌无效或已过期」，
 * 用户就会去重配令牌 —— 明明要做的只是解决冲突。
 */
const CONFLICT_RE = /存在冲突|有冲突|冲突|merge conflict|pull request is not mergeable|can(?:not|'t) be merged|conflicts? with the base branch/i
const MERGE_GATE_RE = /未通过设置的测试|not passed the configured test/i

/** 从错误响应体里取平台自己写的那句话（两家都是 `{message}`，GitHub 有时是 `{errors:[…]}`）。 */
function serverMessageOf(text) {
  if (typeof text !== 'string' || text.trim() === '') return ''
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return ''
    if (typeof parsed.message === 'string' && parsed.message.trim() !== '') return parsed.message.trim()
    if (Array.isArray(parsed.errors)) {
      const messages = parsed.errors
        .map((item) => (item !== null && typeof item === 'object' && typeof item.message === 'string' ? item.message : ''))
        .filter((item) => item !== '')
      if (messages.length > 0) return messages.join('；')
    }
  } catch {
    // 不是 JSON：调用方退回原始文本
  }
  return ''
}

/**
 * 读 JSON，并把「失败」说清楚。
 *
 * **空响应是合法的成功**：`204 No Content` / 长度为 0 的 200 在 REST 里表示
 * 「做完了，没什么可回」。Gitee 的审查通过接口（POST /pulls/{n}/review）就是这样，
 * 之前把它当成「不是 JSON」直接报错，导致审查明明成功却提示失败。
 * 因此这里返回 null 表示「成功但没有响应体」，调用方按需处理。
 *
 * 失败分三类，界面据此给不同的话：
 *  - `pull-conflict`：PR 有冲突（Gitee 用 403 表达），要先解决冲突；
 *  - `merge-gate`：合并门禁要求先过测试；
 *  - `remote-auth-failed`：401 = 令牌无效/过期，403 = 没权限，404 = 找不到或无权访问。
 */
export async function readJson(response) {
  const text = await response.text()
  if (!response.ok) {
    const serverMessage = serverMessageOf(text)
    // 平台自己的话优先：JSON 外壳（{"message":"…"}）对用户没有意义
    const detail = serverMessage !== '' ? serverMessage : text.trim().slice(0, 300)
    if (response.status !== 401 && CONFLICT_RE.test(detail)) {
      throw new GitError('pull-conflict',
        '平台拒绝了这次操作。解决冲突后再试：把目标分支合进本地分支、解决后推上来，或直接到网页上处理。'
        + '平台原文：' + detail,
        { status: response.status, serverMessage: detail })
    }
    if (MERGE_GATE_RE.test(detail)) {
      throw new GitError('merge-gate', detail, { status: response.status, serverMessage: detail })
    }
    let reason
    if (response.status === 401) {
      reason = '令牌无效或已过期（HTTP 401）'
    } else if (response.status === 403) {
      reason = '没有权限执行这个操作（HTTP 403）'
    } else if (response.status === 404) {
      reason = 'HTTP 404：仓库或 PR 不存在、已改名/删除，或令牌没有访问它的权限（私有仓库需要项目读权限）'
    } else {
      reason = 'HTTP ' + response.status
    }
    throw new GitError('remote-auth-failed', reason + '：' + detail, {
      status: response.status,
      serverMessage: detail
    })
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
