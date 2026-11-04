/**
 * src/components/SidebarGitEntry.js —— DSH 左侧栏底部的「代码坞」入口
 *
 * 挂在 `sidebar.footer.action`（root 作用域，位置在设置按钮旁边；侧栏收起时是 56px 图标条）。
 * 点一下 = 给「当前挂载的会话」打开右侧栏的 Git 页签：
 *   ctx.sidebarRight.openTab('git')
 * 这里不传 sessionId：openTab 自己解析当前挂载的会话面（require()）。
 *
 * 没有会话面时 openTab 会抛错 —— 那种情况下按钮自己标红并给出原因，
 * 不静默、也不假装打开成功。
 */
import { h, useState } from '../platform.js'

export const TAB_KIND = 'git'

/** 彩色图标：分支线 + 两个提交点 + 一点高光（固定配色，不跟随主题灰度）。 */
function ColorfulGitDock() {
  return h('svg', {
    width: 18,
    height: 18,
    viewBox: '0 0 20 20',
    fill: 'none',
    'aria-hidden': 'true'
  },
  h('defs', null,
    h('linearGradient', { id: 'dgpDockLine', x1: '0', y1: '0', x2: '1', y2: '1' },
      h('stop', { offset: '0%', 'stop-color': '#7C6BFF' }),
      h('stop', { offset: '100%', 'stop-color': '#3FB6FF' })),
    h('linearGradient', { id: 'dgpDockHead', x1: '0', y1: '0', x2: '1', y2: '1' },
      h('stop', { offset: '0%', 'stop-color': '#FF8A5B' }),
      h('stop', { offset: '100%', 'stop-color': '#FF5C8A' }))),
  h('path', {
    d: 'M5.5 4.6v9.2c0 1.8 1.4 3.2 3.2 3.2h1.6',
    stroke: 'url(#dgpDockLine)',
    strokeWidth: 2,
    strokeLinecap: 'round'
  }),
  h('circle', { cx: 5.5, cy: 4.4, r: 2.4, fill: 'url(#dgpDockHead)' }),
  h('circle', { cx: 15.2, cy: 8.4, r: 2.2, fill: '#2FD36B' }),
  h('path', {
    d: 'M5.5 9.2c0-1.6 1.3-2.9 2.9-2.9h4.2c1 0 1.8.8 1.8 1.8v.6',
    stroke: 'url(#dgpDockLine)',
    strokeWidth: 1.8,
    strokeLinecap: 'round'
  }),
  h('path', { d: 'M12.4 15.6h4.2', stroke: '#FFC53D', strokeWidth: 1.8, strokeLinecap: 'round' }))
}

export function SidebarGitEntry(props) {
  const { wide, t, openPanel } = props
  const [failed, setFailed] = useState(false)

  const activate = () => {
    try {
      openPanel()
      setFailed(false)
    } catch (error) {
      setFailed(true)
      console.error('[dsh-git-panel] 打开代码坞失败: ' + (error && error.message ? error.message : String(error)))
    }
  }

  return h('button', {
    type: 'button',
    className: 'dgp-dockbtn',
    'data-dgp-dock': TAB_KIND,
    'data-wide': wide ? 'true' : undefined,
    'data-failed': failed ? 'true' : undefined,
    title: failed ? t('entry.failed') : t('entry.hint'),
    'aria-label': t('entry.title'),
    onClick: activate
  },
  h(IconSlot, null),
  wide ? h('span', { className: 'dgp-dockbtn-label' }, t('entry.title')) : null,
  failed
    ? h('span', { className: 'dgp-dockbtn-failed', 'aria-hidden': 'true' })
    : null)
}

/** 单独包一层，方便测试按组件名找到图标（也避免把 svg 直接塞进按钮属性里）。 */
function IconSlot() {
  return ColorfulGitDock()
}
