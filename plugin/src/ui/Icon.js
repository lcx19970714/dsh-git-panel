/**
 * src/ui/Icon.js —— 内联 SVG 图标集
 *
 * 不依赖平台的 primitives 包（其导出名不稳定），自带一套 16×16 线性图标。
 * 只保留真正用到的图标；未知名字返回 null 并打印一次错误，不做"静默退回默认图标"。
 */
import { h } from '../platform.js'

/** 线性图标：name -> path 数组（16×16，1.5 描边）。 */
const ICONS = {
  'chevron-right': ['M6 4l4 4-4 4'],
  'chevron-down': ['M4 6l4 4 4-4'],
  refresh: ['M13.5 8a5.5 5.5 0 1 1-1.6-3.9', 'M13.5 2.5V5H11'],
  'git-branch': ['M4 3v10', 'M4 6a3 3 0 0 1 3-3h3', 'M12 9a1.8 1.8 0 1 1 0 .01'],
  'git-merge': ['M4 13V3', 'M4 8a4 4 0 0 0 4 4h3', 'M12 4a1.8 1.8 0 1 1-.01.01'],
  file: ['M4 2h5l3 3v9H4z', 'M9 2v3h3'],
  'file-diff': ['M4 2h5l3 3v9H4z', 'M9 2v3h3', 'M6 8h4', 'M6 11h4'],
  folder: ['M2 4h4l1.5 2H14v7H2z'],
  'folder-open': ['M2 4h4l1.5 2H14v7H2z', 'M2 7h12'],
  check: ['M6 8.5l2 2 3-4'],
  'check-circle': ['M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z', 'M5.6 8.2l1.7 1.7 3-3.2'],
  close: ['M4 4l8 8', 'M12 4l-8 8'],
  plus: ['M8 3v10', 'M3 8h10'],
  minus: ['M3 8h10'],
  search: ['M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10z', 'M10.6 10.6L14 14'],
  warning: ['M8 2l6 11H2z', 'M8 6v3', 'M8 11h.01'],
  info: ['M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z', 'M8 7v4', 'M8 5h.01'],
  unified: ['M2 3h12v10H2z', 'M2 6h12', 'M2 9h12'],
  split: ['M2 3h12v10H2z', 'M8 3v10'],
  wrap: ['M2 4h12', 'M2 8h9a2 2 0 1 1 0 4H8', 'M10 10l-2 2 2 2'],
  trash: ['M3 5h10', 'M6 5V3h4v2', 'M4.5 5l.7 8h5.6l.7-8'],
  clock: ['M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z', 'M8 5v3.5L10.5 10'],
  filter: ['M2 3h12l-4.5 5.5V13L6 11.5V8.5z'],
  sync: ['M13.5 8a5.5 5.5 0 0 1-9.4 3.9', 'M4 12v-3h3', 'M2.5 8a5.5 5.5 0 0 1 9.4-3.9', 'M12 4v3h-3'],
  external: ['M9.5 3H13v3.5', 'M13 3L7.5 8.5', 'M11.5 9.5V13H3V4.5h3.5'],
  sparkle: ['M8 2l1.2 3.3L12.5 6.5 9.2 7.7 8 11 6.8 7.7 3.5 6.5 6.8 5.3z', 'M12.5 10l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z'],
  settings: ['M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z', 'M8 1.8v1.6', 'M8 12.6v1.6', 'M3.2 3.2l1.1 1.1', 'M11.7 11.7l1.1 1.1', 'M1.8 8h1.6', 'M12.6 8h1.6', 'M3.2 12.8l1.1-1.1', 'M11.7 4.3l1.1-1.1']
}

/** 用实心圆点而不是描边的图标。 */
const FILLED_DOTS = {
  more: [[3, 8], [8, 8], [13, 8]]
}

const warned = new Set()

/**
 * 渲染一个图标。
 * @param {{name: string, size?: number, className?: string, title?: string}} props
 */
export function Icon(props) {
  const { name, size = 16, className = '', title } = props
  const filledDots = FILLED_DOTS[name]
  const paths = ICONS[name]

  if (filledDots === undefined && paths === undefined) {
    if (!warned.has(name)) {
      warned.add(name)
      // eslint-disable-next-line no-console
      console.error('[dsh-git-panel] 未知图标: ' + name)
    }
    return null
  }

  const children = filledDots === undefined
    ? paths.map((d, index) => h('path', { key: index, d }))
    : filledDots.map(([cx, cy], index) => h('circle', { key: index, cx, cy, r: 1.2 }))

  return h('svg', {
    className: 'dgp-ico ' + className,
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: filledDots === undefined ? 'none' : 'currentColor',
    stroke: filledDots === undefined ? 'currentColor' : undefined,
    strokeWidth: filledDots === undefined ? 1.5 : undefined,
    strokeLinecap: filledDots === undefined ? 'round' : undefined,
    strokeLinejoin: filledDots === undefined ? 'round' : undefined,
    'aria-hidden': title === undefined ? 'true' : undefined,
    role: title === undefined ? undefined : 'img'
  }, title === undefined ? null : h('title', null, title), children)
}

/** 状态字母徽标（纯文字，颜色由 styles.js 的 [data-status] 决定）。 */
export function StatusLetter(props) {
  const { status, className = '' } = props
  return h('span', {
    className: 'dgp-status-letter ' + className,
    'data-status': status,
    'aria-hidden': 'true'
  }, status === '?' ? 'U' : status)
}
