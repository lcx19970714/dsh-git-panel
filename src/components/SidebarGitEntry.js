/**
 * src/components/SidebarGitEntry.js —— DSH 左侧栏底部的「代码坞」入口
 *
 * 挂在 `sidebar.footer.action`（root 作用域，位置在设置按钮旁边；侧栏收起时是 56px 图标条）。
 * 点一下 = 给「当前挂载的会话」打开右侧栏的 Git 页签：
 *   ctx.sidebarRight.openTab('git')
 * 这里不传 sessionId：openTab 自己解析当前挂载的会话面（require()）。
 *
 * 没有会话面时 openTab 会抛错 —— 与标题栏入口共用 `../ui/useOpenPanel.js`：
 * 失败时按钮标红并给出原因，5 秒后自动复位，不静默、也不假装打开成功。
 */
import { h } from '../platform.js'
import { useOpenPanel } from '../ui/useOpenPanel.js'

const TAB_KIND = 'git'

/** 彩色图标：主干 + 分支 + 三个提交点（固定配色，不跟随主题灰度）。 */
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
      h('stop', { offset: '0%', 'stop-color': '#6C5CE7' }),
      h('stop', { offset: '100%', 'stop-color': '#3FB6FF' })),
    h('linearGradient', { id: 'dgpDockHead', x1: '0', y1: '0', x2: '1', y2: '1' },
      h('stop', { offset: '0%', 'stop-color': '#FF8A5B' }),
      h('stop', { offset: '100%', 'stop-color': '#FF5C8A' }))),
  // 主干：顶部提交点向下，拐到右下角的黄色节点
  h('path', {
    d: 'M6 4.2v9.2c0 1.8 1.4 3.2 3.2 3.2h6.3',
    stroke: 'url(#dgpDockLine)',
    strokeWidth: 2.4,
    strokeLinecap: 'round'
  }),
  // 分支：从主干向右上方，接到绿色节点
  h('path', {
    d: 'M6 9.2c0-2 1.6-3.6 3.6-3.6h5.9',
    stroke: 'url(#dgpDockLine)',
    strokeWidth: 2.2,
    strokeLinecap: 'round'
  }),
  h('circle', { cx: 6, cy: 4.2, r: 2.5, fill: 'url(#dgpDockHead)' }),
  h('circle', { cx: 15.5, cy: 6.2, r: 2.3, fill: '#2FD36B' }),
  h('circle', { cx: 15.5, cy: 16.6, r: 2.3, fill: '#FFC53D' }))
}

export function SidebarGitEntry(props) {
  const { wide, t, openPanel } = props
  const { failed, activate } = useOpenPanel(openPanel)

  return h('button', {
    type: 'button',
    className: 'dgp-dockbtn',
    'data-dgp-dock': TAB_KIND,
    'data-wide': wide ? 'true' : 'false',
    'data-failed': failed ? 'true' : undefined,
    title: failed ? t('entry.failed') : t('entry.hint'),
    'aria-label': failed ? t('entry.failed') : t('entry.title'),
    onClick: activate
  },
  h(ColorfulGitDock, null),
  wide ? h('span', { className: 'dgp-dockbtn-label' }, t('entry.title')) : null,
  failed
    ? h('span', { className: 'dgp-dockbtn-failed', 'aria-hidden': 'true' })
    : null)
}
