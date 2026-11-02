/**
 * src/util/openUrl.js —— 在新标签打开外部链接
 *
 * DSH 桌面端与 Web 端都是浏览器环境，`window.open` 是唯一可靠的入口。
 * 它有两个可观测的失败：不存在（非浏览器环境）、被拦截（返回 null）。
 * 这里把「打开成功没有」如实告诉调用方，让界面能给出可操作提示，
 * 而不是点了没反应。
 */
export function openExternalUrl(url) {
  if (typeof window === 'undefined' || typeof window.open !== 'function') {
    return { opened: false, reason: 'unsupported' }
  }
  const handle = window.open(url, '_blank', 'noopener,noreferrer')
  if (handle === null || handle === undefined) return { opened: false, reason: 'blocked' }
  return { opened: true, reason: null }
}
