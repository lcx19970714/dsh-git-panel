/**
 * src/ui/Icon.js —— 内联 SVG 图标集
 *
 * 统一按 24×24 网格绘制、2px 描边、圆角端点；渲染时通过 size 缩放到 12/14/16/24。
 * 这样同一套几何在 12px 的树行和 24px 的空态里都不会忽胖忽瘦。
 *
 * 只保留真正用到的图标；未知名字直接抛错，不做"静默退回默认图标"。
 */
import { h } from '../platform.js'

/**
 * 线性图标：name -> path 数组（24×24，2px 描边）。
 *
 * 画法约定：
 *  - 主体落在 3..21 的安全区，四周至少留 2px，避免小尺寸贴边；
 *  - 圆点用「圆弧路径」而不是单独 circle，保持所有图标都只有 path，渲染路径统一；
 *  - 视觉重心略偏上（y≈12），与 11/12px 的文字基线对齐更稳。
 */
const ICONS = {
  'chevron-right': ['m9 6 6 6-6 6'],
  'chevron-down': ['m6 9 6 6 6-6'],
  refresh: ['M20 12a8 8 0 1 1-2.34-5.66', 'M20 4v4h-4'],
  'git-branch': [
    'M6 3v12',
    'M21 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    'M18 9a9 9 0 0 1-9 9'
  ],
  'git-merge': [
    'M6 21V9a9 9 0 0 0 9 9',
    'M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    'M21 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'
  ],
  file: [
    'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z',
    'M14 3v5h5'
  ],
  'file-diff': [
    'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z',
    'M14 3v5h5',
    'M9 13h6',
    'M9 17h4'
  ],
  folder: [
    'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'
  ],
  'folder-open': [
    'M6 14l1.45-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.55 6a2 2 0 0 1-1.94 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.93a2 2 0 0 1 1.66.9l.82 1.2a2 2 0 0 0 1.66.9H18a2 2 0 0 1 2 2v2'
  ],
  check: ['M20 6 9 17l-5-5'],
  'check-circle': [
    'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
    'm8 12 3 3 5-6'
  ],
  close: ['M18 6 6 18', 'm6 6 12 12'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  search: [
    'M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0z',
    'm20 20-4-4'
  ],
  warning: [
    'M10.3 3.8 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0z',
    'M12 9v4',
    'M12 17h.01'
  ],
  info: [
    'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
    'M12 16v-4',
    'M12 8h.01'
  ],
  unified: [
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    'M7 8h10',
    'M7 12h10',
    'M7 16h10'
  ],
  split: [
    'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    'M12 3v18'
  ],
  wrap: [
    'M3 6h18',
    'M3 12h15a3 3 0 1 1 0 6h-4',
    'm16 16-2 2 2 2',
    'M3 18h7'
  ],
  trash: [
    'M4 7h16',
    'M9 7V4h6v3',
    'M6 7l1 13h10l1-13'
  ],
  eye: [
    'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z',
    'M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z'
  ],
  'eye-off': [
    'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z',
    'M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z',
    'M3 3l18 18'
  ],
  clock: [
    'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
    'M12 7v5l3 2'
  ],
  filter: ['M3 5h18l-7 8.5V20l-4-2v-4.5z'],
  sync: [
    'M20 8a8 8 0 0 0-14.3 3.2',
    'M4 16a8 8 0 0 0 14.3-3.2',
    'M20 3v5h-5',
    'M4 21v-5h5'
  ],
  external: [
    'M14 4h6v6',
    'M20 4 11 13',
    'M18 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5'
  ],
  sparkle: [
    'M12 3c.8 4.6 3.4 7.2 8 8-4.6.8-7.2 3.4-8 8-.8-4.6-3.4-7.2-8-8 4.6-.8 7.2-3.4 8-8z',
    'M19 3c.3 1.4 1 2.1 2.4 2.4-1.4.3-2.1 1-2.4 2.4-.3-1.4-1-2.1-2.4-2.4 1.4-.3 2.1-1 2.4-2.4z'
  ],
  settings: [
    'M4 8h8',
    'M16 8h4',
    'M14 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
    'M4 16h4',
    'M12 16h8',
    'M10 16a2 2 0 1 1-4 0 2 2 0 0 1 4 0z'
  ],
  // 退回改动：一个向左的箭头 + 一条回头的弧（与 VS Code 的 discard 同义）
  discard: [
    'M9 14 4 9l5-5',
    'M4 9h9.5a6 6 0 0 1 0 12H11'
  ]
}

/** 用实心圆点而不是描边的图标。 */
const FILLED_DOTS = {
  more: [[5, 12], [12, 12], [19, 12]]
}

/**
 * 渲染一个图标。
 *
 * 未知名字是编程错误：图标表就是契约，缺了就应该在开发时炸出来，
 * 而不是静默返回 null 让界面少一块（那种「少了个图标」的问题极难发现）。
 *
 * @param {{name: string, size?: number, className?: string, title?: string}} props
 */
export function Icon(props) {
  const { name, size = 16, className = '', title } = props
  const filledDots = FILLED_DOTS[name]
  const paths = ICONS[name]

  if (filledDots === undefined && paths === undefined) {
    throw new Error('[dsh-git-panel] 未知图标: ' + name)
  }

  const children = filledDots === undefined
    ? paths.map((d, index) => h('path', { key: index, d }))
    : filledDots.map(([cx, cy], index) => h('circle', { key: index, cx, cy, r: 2.2 }))

  return h('svg', {
    className: 'dgp-ico ' + className,
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: filledDots === undefined ? 'none' : 'currentColor',
    stroke: filledDots === undefined ? 'currentColor' : undefined,
    strokeWidth: filledDots === undefined ? 2 : undefined,
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
