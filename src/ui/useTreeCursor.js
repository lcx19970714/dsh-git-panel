/**
 * src/ui/useTreeCursor.js —— 树/列表共用的键盘游标
 *
 * 「变更」树与「文件」树本来就是同一种交互：一组扁平行、一个游标、↑↓ 移动、
 * Enter 激活、←→ 展开/折叠目录、移动时把行滚进可视区。两边原先各写了一遍
 * （连 clamp 与 focus 收尾都逐行相同），这里收成一处；组件只回答两件事：
 * 哪些行是目录、目录怎么开合。
 *
 * 约定：
 *  - 事件处理函数挂在列表容器上；到达这里的 keydown 必然来自容器或其后代，
 *    所以不需要 contains 判断 —— 只有「Enter 由容器自己处理还是交给行 button」
 *    需要区分 target 是不是容器。
 *  - 行节点由组件通过 ref 收集进 `rowRefs`，索引与扁平行数组一致。
 *  - **`rowRefs.current[i]` 有三种值**：行已挂载（元素）、行还没挂载过（`undefined`）、
 *    行被卸载（React 会把 ref 回调传成 `null`）。游标移动时行可能刚好被卸载
 *    （折叠分组 / 过滤 / 提交后列表变短 / 暂存后文件换组），所以「有没有元素」必须
 *    同时认 `null` 和 `undefined` —— 少认一种就是对着 `null` 调 `scrollIntoView`。
 */
import { useEffect, useRef, useState } from '../platform.js'

/** 这些键由游标消费，不再冒泡给 Panel 的全局快捷键。 */
function consume(event) {
  event.preventDefault()
  event.stopPropagation()
}

/**
 * 游标该落在哪一行：行数变少时收敛到最后一行，还没选行（-1）与空列表都返回 -1。
 *
 * 单独拿出来是因为**状态收敛（effect 里的 setCursor）要下一遍渲染才生效**，
 * 而同一提交里的滚动 effect 读的还是这一遍的旧游标 —— 读之前必须自己按当前行数收敛，
 * 否则就会读到一个已经不存在的行号。
 */
export function clampCursor(cursor, total) {
  if (total <= 0 || cursor < 0) return -1
  return cursor >= total ? total - 1 : cursor
}

/**
 * 游标对应的行元素；没有就返回 `null`。
 *
 * 行被卸载时 React 写进 `rowRefs` 的是 `null`（挂载前是 `undefined`），两种都表示
 * 「这一行现在不在 DOM 里」，调用方拿到 `null` 就不该再碰它。
 */
export function cursorElement(rowRefs, cursor, total) {
  const index = clampCursor(cursor, total)
  if (index < 0) return null
  const element = rowRefs[index]
  return element === undefined || element === null ? null : element
}

/**
 * @param {{
 *   rows: object[],
 *   isDir: (row: object) => boolean,
 *   isOpen: (row: object) => boolean,
 *   onToggle: (row: object) => void,
 *   onActivate: (row: object) => void
 * }} options
 */
export function useTreeCursor(options) {
  const { rows, isDir, isOpen, onToggle, onActivate } = options
  const [cursor, setCursor] = useState(-1)
  const rowRefs = useRef([])
  const wantFocusRef = useRef(false)

  // 行数变少（折叠分组 / 过滤 / 切目录）时把游标收敛回最后一行。
  useEffect(() => {
    setCursor((previous) => clampCursor(previous, rows.length))
  }, [rows.length])

  // 游标移动：滚进可视区；键盘移动时把真实焦点也带过去（Enter 由原生 click 处理）。
  // 这里按「当前行数」重新收敛一次：状态收敛要下一遍渲染才生效，而这一遍的行里
  // 可能已经有行被卸载、ref 变成了 null。
  useEffect(() => {
    const element = cursorElement(rowRefs.current, cursor, rows.length)
    if (element === null) return
    element.scrollIntoView({ block: 'nearest' })
    if (wantFocusRef.current === true) {
      wantFocusRef.current = false
      element.focus()
    }
  }, [cursor, rows])

  /** 鼠标点行 / 外部选中项变化时让游标跟上（不动焦点）。 */
  function focusRow(index) {
    setCursor(index)
  }

  function moveBy(delta) {
    const total = rows.length
    if (total === 0) return
    wantFocusRef.current = true
    setCursor((previous) => {
      if (previous < 0 || previous >= total) return 0
      return Math.min(total - 1, Math.max(0, previous + delta))
    })
  }

  function handleKeyDown(event) {
    const onContainer = event.target === event.currentTarget

    if (event.key === 'ArrowDown') {
      consume(event)
      moveBy(1)
      return
    }

    if (event.key === 'ArrowUp') {
      consume(event)
      moveBy(-1)
      return
    }

    if (event.key === 'Enter') {
      // 行上的 Enter 由原生 button click 处理，避免重复激活。
      if (onContainer !== true) return
      const row = rows[cursor]
      if (row === undefined) return
      consume(event)
      onActivate(row)
      return
    }

    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    const row = rows[cursor]
    if (row === undefined || isDir(row) !== true) return
    const open = isOpen(row)
    if ((event.key === 'ArrowRight') === open) return
    consume(event)
    onToggle(row)
  }

  return { cursor, rowRefs, focusRow, handleKeyDown }
}
