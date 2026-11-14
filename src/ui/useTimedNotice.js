/**
 * src/ui/useTimedNotice.js —— 会自己过期的操作结果提示
 *
 * 面板里有两种「操作结果」：工具条上一句（推送成功 / 检查更新结果 / 建分支结果），
 * 提交框状态行上一句（已提交 / 生成失败）。它们原先各写了一套定时清理，
 * 结果两边的存活时间不一样：提交结果 8 秒后消失，推送结果却一直挂在工具条上。
 *
 * 这里只定义一条规则，两处共用：
 *  · tone === 'info'（做成了什么事）→ 看一眼就够，ttl 后自动消失；
 *  · tone === 'warn' / 'error'（需要用户处理）→ 留着，直到下一次动作或用户自己关掉。
 */
import { useCallback, useEffect, useRef, useState } from '../platform.js'

/**
 * @param {number} ttlMs info 类提示的存活时间
 * @returns {[object|null, (notice: object|null) => void]}
 */
export function useTimedNotice(ttlMs) {
  const [notice, setNotice] = useState(null)
  const timerRef = useRef(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current === null) return
    clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const show = useCallback((next) => {
    clearTimer()
    setNotice(next)
    if (next === null || next.tone !== 'info') return
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setNotice(null)
    }, ttlMs)
  }, [clearTimer, ttlMs])

  // 卸载时别把定时器留在后台（面板会被右侧栏页签切换反复挂载/卸载）。
  useEffect(() => clearTimer, [clearTimer])

  return [notice, show]
}
