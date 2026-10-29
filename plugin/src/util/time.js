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
