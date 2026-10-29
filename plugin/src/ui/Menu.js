/**
 * src/ui/Menu.js —— 轻量浮层菜单
 *
 * 没有 react-dom（拿不到 createPortal），所以菜单就渲染在面板根内，用 `position: fixed`
 * 定位于锚点附近，并在布局后做视口钳制。祖先若有 transform 会让 fixed 退化，
 * 因此坐标钳制按「锚点相对视口的矩形」计算，最坏情况也只是偏移，不会不可用。
 */
import { h, useEffect, useLayoutEffect, useRef, useState } from '../platform.js'
import { Icon } from './Icon.js'

const MARGIN = 8

/**
 * 浮层容器。
 * @param {{open: boolean, anchorRect: DOMRect|null, onClose: () => void, minWidth?: number, children: any}} props
 */
export function PopupMenu(props) {
  const { open, anchorRect, onClose, minWidth = 200, children } = props
  const menuRef = useRef(null)
  const [placement, setPlacement] = useState(null)

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null)
      return
    }
    const node = menuRef.current
    const viewportW = typeof window === 'undefined' ? 1024 : window.innerWidth
    const viewportH = typeof window === 'undefined' ? 768 : window.innerHeight
    const anchor = anchorRect
    const box = node === null ? { width: minWidth, height: 0 } : node.getBoundingClientRect()
    const width = Math.max(box.width, minWidth)
    const height = box.height

    let left = anchor.left
    if (left + width + MARGIN > viewportW) left = Math.max(MARGIN, viewportW - width - MARGIN)
    let top = anchor.bottom + 4
    if (top + height + MARGIN > viewportH) {
      const above = anchor.top - 4 - height
      top = above >= MARGIN ? above : Math.max(MARGIN, viewportH - height - MARGIN)
    }
    setPlacement({ left, top, width })
  }, [open, anchorRect, minWidth])

  useEffect(() => {
    if (!open) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    const onPointerDown = (event) => {
      const node = menuRef.current
      if (node !== null && node.contains(event.target)) return
      onClose()
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [open, onClose])

  if (!open) return null

  const style = placement === null
    ? { left: -9999, top: -9999, minWidth }
    : { left: placement.left, top: placement.top, minWidth: placement.width }

  return h('div', { className: 'dgp-menu-scrim', 'data-dgp-scrim': 'true' },
    h('div', {
      className: 'dgp-menu',
      ref: menuRef,
      style,
      role: 'menu',
      onPointerDown: (event) => event.stopPropagation()
    }, children))
}

/** 菜单项。 */
export function MenuItem(props) {
  const { icon, label, sub, checked, disabled, onClick, danger } = props
  const left = checked === undefined
    ? (icon === undefined ? null : h(Icon, { name: icon, size: 14 }))
    : h('span', { className: 'dgp-menu-check', style: { width: 14, display: 'flex' } },
      checked ? h(Icon, { name: 'check', size: 14 }) : null)
  return h('button', {
    type: 'button',
    className: 'dgp-menu-item',
    role: 'menuitem',
    'data-checked': checked === true ? 'true' : undefined,
    'data-danger': danger === true ? 'true' : undefined,
    disabled: disabled === true,
    title: label,
    onClick: (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (disabled !== true && typeof onClick === 'function') onClick(event)
    }
  },
  left,
  h('span', { className: 'dgp-menu-item-main' }, label),
  sub === undefined || sub === null ? null : h('span', { className: 'dgp-menu-item-sub' }, sub))
}

/** 菜单分组标题。 */
export function MenuLabel(props) {
  return h('div', { className: 'dgp-menu-label' }, props.children)
}

/** 分隔线。 */
export function MenuSeparator() {
  return h('div', { className: 'dgp-menu-sep', role: 'separator' })
}
