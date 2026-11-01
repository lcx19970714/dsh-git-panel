/**
 * src/components/States.js —— 空 / 加载 / 错误 / 骨架 / 行内提示
 *
 * 结构一律按 CONTRACT.md §5 的 class 词汇表输出，样式全部由 src/styles.js 提供。
 * 文案全部走 `t('key')`；`t` 缺失时退化成「回显 key」，保证组件永不崩。
 *
 * props 契约（CONTRACT.md §3）：
 *   EmptyState({ icon, title, description, actions, t })
 *   LoadingState({ label, t })
 *   ErrorState({ message, onRetry, t })
 *   SkeletonRows({ rows })
 *   InlineNote({ tone: 'info'|'warn'|'error', children })
 */
import { h, Fragment } from '../platform.js'
import { Icon } from '../ui/Icon.js'

const TONES = ['info', 'warn', 'error']

/** t 兜底：宿主没给 / 不是函数时回显 key。 */
function safeT(t) {
  if (typeof t === 'function') return t
  return function fallbackT(key) { return String(key) }
}

/** actions 允许单 node 或 node 数组；null / false 直接丢掉，逐个包 keyed Fragment。 */
function normalizeActions(actions) {
  if (actions === null || actions === undefined || actions === false) return []
  const list = Array.isArray(actions) ? actions : [actions]
  const nodes = []
  for (let i = 0; i < list.length; i += 1) {
    const node = list[i]
    if (node === null || node === undefined || node === false) continue
    nodes.push(h(Fragment, { key: i }, node))
  }
  return nodes
}

function isBlank(value) {
  return value === null || value === undefined || value === false || value === ''
}

/**
 * 居中空态。
 * `icon` 既可以传图标名（字符串，内部渲染 `Icon`），也可以传现成的 React node。
 */
export function EmptyState(props) {
  const { icon, title, description, actions } = props ?? {}
  const iconNode = isBlank(icon)
    ? null
    : h('div', { className: 'dgp-state-icon' },
        typeof icon === 'string' ? h(Icon, { name: icon, size: 28 }) : icon)
  const titleNode = isBlank(title) ? null : h('div', { className: 'dgp-state-title' }, title)
  const descNode = isBlank(description) ? null : h('div', { className: 'dgp-state-desc' }, description)
  const actionNodes = normalizeActions(actions)
  const actionBox = actionNodes.length > 0
    ? h('div', { className: 'dgp-state-actions' }, actionNodes)
    : null
  return h('div', { className: 'dgp-state' }, iconNode, titleNode, descNode, actionBox)
}

/** 加载态：小转圈 + 文案（居中同上）。 */
export function LoadingState(props) {
  const { label, t } = props ?? {}
  const T = safeT(t)
  const text = isBlank(label) ? T('status.loading') : label
  return h('div', { className: 'dgp-state', role: 'status', 'aria-live': 'polite' },
    h('span', { className: 'dgp-spinner', 'aria-hidden': 'true' }),
    h('div', { className: 'dgp-state-desc' }, text))
}

/** 错误态：警告图标 + 原因 + 重试按钮。 */
export function ErrorState(props) {
  const { message, onRetry, t } = props ?? {}
  const T = safeT(t)
  const text = isBlank(message) ? '' : String(message)
  const descNode = text === '' ? null : h('div', { className: 'dgp-state-desc' }, text)
  const retry = h('button', {
    type: 'button',
    className: 'dgp-btn',
    'data-variant': 'ghost',
    'data-size': 'sm',
    onClick: function handleRetry() {
      if (typeof onRetry === 'function') onRetry()
    }
  }, h(Icon, { name: 'refresh', size: 14 }), T('action.retry'))
  return h('div', { className: 'dgp-state', role: 'alert' },
    h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'warning', size: 28 })),
    descNode,
    h('div', { className: 'dgp-state-actions' }, retry))
}

const SKELETON_WIDTHS = [92, 74, 86, 62, 88, 70, 95, 58, 80, 66]

/** 骨架屏：`rows` 行，宽度按固定节奏变化（内联 width，样式在 styles.js）。 */
export function SkeletonRows(props) {
  const { rows } = props ?? {}
  const count = (typeof rows === 'number' && Number.isFinite(rows))
    ? Math.max(0, Math.min(40, Math.floor(rows)))
    : 6
  const items = []
  for (let i = 0; i < count; i += 1) {
    const width = SKELETON_WIDTHS[i % SKELETON_WIDTHS.length]
    items.push(h('div', { key: i, className: 'dgp-skel-row' },
      h('span', { className: 'dgp-skel-dot' }),
      h('span', { className: 'dgp-skel-bar', style: { width: width + '%' } })))
  }
  return h('div', { className: 'dgp-skeleton', 'aria-hidden': 'true' }, items)
}

/** 行内提示条（不占满面板；放进内容流里用）。 */
export function InlineNote(props) {
  const { tone, children } = props ?? {}
  const safeTone = TONES.indexOf(tone) === -1 ? 'info' : tone
  return h('div', { className: 'dgp-inline-note', 'data-tone': safeTone }, children)
}
