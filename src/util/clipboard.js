/**
 * src/util/clipboard.js —— 复制文本到剪贴板
 *
 * 浏览器只给 `navigator.clipboard`，且在非安全上下文/无权限时会拒绝。
 * 复制失败必须能被界面看见（用户手里那段令牌是唯一副本，不能「点了没反应」）。
 */
export async function copyText(text) {
  const value = typeof text === 'string' ? text : ''
  if (value === '') return { ok: false, reason: 'empty' }
  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (clipboard === undefined || clipboard === null || typeof clipboard.writeText !== 'function') {
    return { ok: false, reason: 'unsupported' }
  }
  try {
    await clipboard.writeText(value)
    return { ok: true, reason: null }
  } catch {
    return { ok: false, reason: 'denied' }
  }
}
