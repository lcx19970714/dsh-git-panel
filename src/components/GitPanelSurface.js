/**
 * src/components/GitPanelSurface.js —— 两个宿主外壳共用的面板入口
 *
 * 面板只挂在右侧栏 tab（`sidebar.right.pane.tab`）：Git 变动与「当前会话所在项目」强绑定，
 * 右侧栏是 session 作用域，框架直接给 `sessionId` 与 `t`，所以这里只做转发。
 *
 * 这一层同时是**面板渲染期异常的唯一出口**。原因不是「要兜底」，而是宿主那条链路会把
 * 逃出去的异常变成一块查不出原因的黑屏：
 *
 *   · 宿主给每个 tab body 套的 slot 错误边界没有 crash face，崩溃时渲染的是
 *     `<div data-slot-error="sidebar.right.pane.tab">` —— 没有文字、没有边框、高度 0；
 *   · 它还会把这次注册标记成 abdicated（`reportEntryError(..., { abdicate: true })`），
 *     之后 `entriesOfSlot` 里就没有这条注册了，页签重开也只能拿到同一个空 div，
 *     只有刷新页面（插件重新注册）才恢复。
 *
 * 所以异常必须在本层被接住，并由面板自己**原样显示**：标题一句话 + 异常原文，
 * 堆栈写进渲染进程 console。这里不做重试、不做降级、不换一条能跑的路径 ——
 * 契约破坏依然是致命的，只是它的表现形式从「黑屏」变成「看得见的错误」。
 * 异常在本层被接住后就不会再逃到宿主那一层，这次注册也不会被退役：
 * 切走再切回来（重新挂载）面板就能继续用。
 */
import { h, Component } from '../platform.js'
import { EmptyState } from './States.js'
import { Panel } from './Panel.js'

/** 异常原文（`throw 'oops'` 这类非 Error 也要能显示）。 */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 面板渲染期的错误边界（React 里只有类组件能做 boundary）。
 *
 * 只接渲染与提交阶段的异常；RPC 失败仍然是各处自己的错误条（`dgp-errorbar`），
 * 它们不是 bug，不该走到这里。
 */
export class PanelRenderBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.error('[dsh-git-panel] 面板渲染失败: '
      + (error instanceof Error && typeof error.stack === 'string' ? error.stack : String(error)))
  }

  render() {
    const { error } = this.state
    if (error === null) return this.props.children
    return h('div', { className: 'dgp-root', 'data-dgp-crash': 'render' },
      h(EmptyState, {
        icon: 'warning',
        title: this.props.t('error.panelCrashed'),
        description: messageOf(error)
      }))
  }
}

export function GitPanelSurface(props) {
  return h(PanelRenderBoundary, { t: props.t },
    h(Panel, { sessionId: props.sessionId, t: props.t }))
}
