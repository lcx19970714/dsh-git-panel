/**
 * src/ui/useOpenPanel.js —— 「打开 Git 页签」按钮的共用行为
 *
 * 会话标题栏与左侧栏底部是两个入口，但宿主行为是同一个：
 * `openTab` 在没有已挂载会话时会**同步抛错**。原先底部入口自己 catch 并显示红点，
 * 标题栏入口完全不 catch（只在控制台报错），同一个失败有两种表现；而且红点
 * 只在「下次点击成功」时才消失，可能一直挂着。
 *
 * 这里统一成：点击失败 → 标记失败（红点 + 提示文案）→ 5 秒后自动复位。
 * 不需要兼容分支：宿主抛错就是唯一事实。
 */
import { useCallback, useEffect, useState } from '../platform.js'

/** @param {() => void} openPanel */
export function useOpenPanel(openPanel) {
  const [failed, setFailed] = useState(false)

  const activate = useCallback(() => {
    try {
      openPanel()
      if (failed === true) setFailed(false)
    } catch (error) {
      setFailed(true)
      console.error('[dsh-git-panel] 打开 Git 页签失败: ' + error.message)
    }
  }, [openPanel, failed])

  useEffect(() => {
    if (failed !== true) return undefined
    const timer = setTimeout(() => setFailed(false), 5000)
    return () => clearTimeout(timer)
  }, [failed])

  return { failed, activate }
}
