/**
 * src/components/HeaderAction.js —— 会话标题栏最右侧的「Git 变更」按钮
 *
 * 挂在 `conversation.session.header.actions` 槽（session 作用域，官方 jobs 插件同款位置）。
 * 点一下 = 打开当前会话右侧栏的「Git 变更」页签：
 *   sidebarRight.openTabIn(sessionId, 'git')
 * 布局 store 的 openContent 会先执行 planSetExpanded(true)，所以侧栏收起时也会自动展开。
 *
 * 这个按钮的意义：右侧栏可能被收起，光靠「+」菜单里的入口会找不到，标题栏按钮常驻可见。
 */
import { h } from '../platform.js'

/** 与 tab 类型一致的 kind（右侧栏按 kind 找到 tab 定义）。 */
export const TAB_KIND = 'git'

export function GitHeaderAction(props) {
  const { sessionId, t, openPanel } = props
  return h('button', {
    type: 'button',
    className: 'dgp-headerbtn',
    title: t('header.title'),
    'aria-label': t('header.title'),
    'data-dgp-header': TAB_KIND,
    onClick: () => openPanel(sessionId)
  },
  h('svg', {
    width: 14,
    height: 14,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true'
  },
  h('path', { d: 'M4 3v10' }),
  h('path', { d: 'M4 6a3 3 0 0 1 3-3h3' }),
  h('circle', { cx: 4, cy: 3.4, r: 1.5 }),
  h('circle', { cx: 12, cy: 9.2, r: 1.5 }),
  h('path', { d: 'M4 13a3 3 0 0 0 3-3V8.6' })),
  h('span', { className: 'dgp-headerbtn-label' }, t('header.label')))
}
