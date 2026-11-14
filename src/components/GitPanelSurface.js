/**
 * src/components/GitPanelSurface.js —— 两个宿主外壳共用的面板入口
 *
 * 面板只挂在右侧栏 tab（`sidebar.right.pane.tab`）：Git 变动与「当前会话所在项目」强绑定，
 * 右侧栏是 session 作用域，框架直接给 `sessionId` 与 `t`，所以这里只做转发。
 */
import { h } from '../platform.js'
import { Panel } from './Panel.js'

export function GitPanelSurface(props) {
  return h(Panel, { sessionId: props.sessionId, t: props.t })
}
