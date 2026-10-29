/**
 * src/components/GitPanelSurface.js —— 两个宿主外壳共用的面板入口
 *
 * 同一个 Panel 出现在两处：
 *   · 会话视图 tab（`conversation.view`，会话区顶部那排视图标签）
 *   · 右侧栏 tab（`sidebar.right.pane.tab`）
 * 两处都是 session 作用域，框架都直接给 `sessionId` 与 `t`，所以这里只做转发。
 */
import { h } from '../platform.js'
import { Panel } from './Panel.js'

export function GitPanelSurface(props) {
  return h(Panel, { sessionId: props.sessionId, t: props.t })
}
