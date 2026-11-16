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
 *  - rows 只包含渲染可聚焦按钮的行，加载/错误/空目录等提示不参与导航。
 *  - 游标在渲染期收敛到当前行号，或 -1（还没选行 / 没有行）。
 *    DOM 引用仍遵循挂载/卸载生命周期，滚动前需检查元素是否存在。
 */
import { useEffect, useRef, useState } from '../platform.js'

/** 这些键由游标消费，不再冒泡给 Panel 的全局快捷键。 */
function consume(event) {
  event.preventDefault()
  event.stopPropagation()
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
  /** 存下来的是「用户上次落点」的下标，它不保证还在 rows 里。 */
  const [stored, setCursor] = useState(-1)
  /**
   * 有效游标 = 存下来的下标按**当前行数**收敛，在渲染期算出来。
   *
   * 这是整个 hook 的唯一一条不变式：游标永远落在本遍渲染画出来的行里。
   * 行数会独立于游标变化（折叠分组 / 过滤 / 提交 / 暂存换组 / 切仓库），
   * 而「把游标改回合法值」如果放在 effect 里，状态要到下一遍渲染才生效 ——
   * 同一提交里的滚动 effect 读到的仍是旧下标，那个下标的行可能刚被卸载
   * （React 卸载行时把 ref 回调传成 `null`），`null.scrollIntoView` 就是那次崩溃。
   * 渲染期收敛消除旧下标；调用方还必须保证 rows 与绑定 ref 的按钮一一对应。
   * 下标有效不等于 DOM 已挂载，因此滚动副作用单独检查引用生命周期。
   */
  const cursor = Math.min(stored, rows.length - 1)
  const rowRefs = useRef([])
  const wantFocusRef = useRef(false)

  // 游标移动：滚进可视区；键盘移动时把真实焦点也带过去（Enter 由原生 click 处理）。
  useEffect(() => {
    if (cursor < 0) return
    const element = rowRefs.current[cursor]
    if (element === null || element === undefined) return
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
      if (onContainer !== true || cursor < 0) return
      consume(event)
      onActivate(rows[cursor])
      return
    }

    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
    if (cursor < 0) return
    const row = rows[cursor]
    if (isDir(row) !== true) return
    const open = isOpen(row)
    if ((event.key === 'ArrowRight') === open) return
    consume(event)
    onToggle(row)
  }

  return { cursor, rowRefs, focusRow, handleKeyDown }
}
