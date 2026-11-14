/**
 * src/ui/useAutoGrow.js —— 多行输入框随内容长高
 *
 * 浏览器不给 textarea 自动高度，唯一可靠的做法是「先归零再读 scrollHeight」。
 * 提交框与「创建 PR」描述框都要这件事，原先一处量 scrollHeight、另一处按
 * 「每 80 字符一行 × 19px」估算 —— 后者在中文、宽字符、字体变化时全是错位。
 * 这里只有一种量法，两处共用。
 */
import { useEffect } from '../platform.js'

/**
 * 把实测高度夹在 [min, max] 之间并向上取整（避免最后一行被裁掉半像素）。
 * @param {number} scrollHeight 元素实测内容高度
 * @param {number} min 最小高度（px）
 * @param {number} max 最大高度（px），超过后改为输入框内部滚动
 */
export function clampHeight(scrollHeight, min, max) {
  return Math.min(max, Math.max(min, Math.ceil(scrollHeight)))
}

/**
 * @param {{current: HTMLTextAreaElement|null}} ref 输入框
 * @param {string} value 内容（变化即重新测量）
 * @param {{min: number, max: number}} bounds
 */
export function useAutoGrow(ref, value, bounds) {
  const { min, max } = bounds
  useEffect(() => {
    const element = ref.current
    if (element === null) return
    element.style.height = 'auto'
    element.style.height = String(clampHeight(element.scrollHeight, min, max)) + 'px'
  }, [ref, value, min, max])
}
