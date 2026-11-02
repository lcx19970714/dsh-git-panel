/**
 * src/util/time.js —— 时间戳格式化（UI 共用）
 *
 * 面板里显示"什么时候"的地方有两处（编辑器保存时间、更新检测时间），
 * 只保留一份实现：`HH:MM:SS` 的 24 小时制，不依赖 locale（避免出现
 * "下午 9:41:07" 这类在窄条里塞不下的形式）。
 */

/** @param {number} timestamp 毫秒时间戳 @returns {string} HH:MM:SS */
export function formatClock(timestamp) {
  const date = new Date(timestamp)
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
}

/**
 * 显示日期 + 时间。
 *
 * 远端数据（PR 更新时间、review 提交时间、issue 创建时间）必须能看出是哪一天，
 * 只显示 HH:MM:SS 会让人误以为是今天。规则：
 *  - 今天：HH:MM
 *  - 今年：MM-DD HH:MM
 *  - 更早：YYYY-MM-DD HH:MM
 *
 * @param {number} timestamp 毫秒时间戳
 * @param {number} now 参考时间（测试用）
 */
export function formatDateTime(timestamp, now = Date.now()) {
  if (!Number.isFinite(timestamp)) return '—'
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return '—'
  const clock = [date.getHours(), date.getMinutes()]
    .map((value) => String(value).padStart(2, '0'))
    .join(':')
  const reference = new Date(now)
  const sameDay = date.getFullYear() === reference.getFullYear()
    && date.getMonth() === reference.getMonth()
    && date.getDate() === reference.getDate()
  if (sameDay) return clock
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  if (date.getFullYear() === reference.getFullYear()) return month + '-' + day + ' ' + clock
  return String(date.getFullYear()) + '-' + month + '-' + day + ' ' + clock
}
