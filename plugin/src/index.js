/**
 * src/index.js —— 客户端插件入口（打包产物 client.js 的源）
 *
 * 注册清单（每条都是"一条路"）：
 *   1. 样式      —— factory 执行期间同步注入（模块顶层已调用 ensureStyles）
 *   2. 字典      —— ctx.locale.register(NS, { zh, en })
 *   3. tab 类型  —— 会话右侧栏：id = 'dsh-git-panel'，kind = 'git'，带 guide 引导项
 *   4. tab body  —— 右侧栏 tab 内容，key 必须等于 tab 类型的 id
 *
 * 为什么只挂在会话右侧栏：Git 变动与「当前会话所在项目」强绑定，右侧栏是 session
 * 作用域，面板能直接拿到当前会话的 sessionId，从而按会话的 cwd 解析项目与仓库。
 *
 * 参考实现：dsh-client-ui-sidebar-browser（tab 类型 + guide + body 槽）。
 */
import { h, setPluginContext } from './platform.js'
import { ensureStyles } from './styles.js'
import { NS, zh, en } from './i18n.js'
import { GitPanelSurface } from './components/GitPanelSurface.js'
import { GitHeaderAction } from './components/HeaderAction.js'

const PLUGIN_ID = 'dsh-git-panel'
const TAB_KIND = 'git'

// 样式注入必须发生在 factory 执行期间（平台据此打 data-plugin 并在卸载时回收）。
ensureStyles()

/** 右侧栏「+」引导页里的插画（40×40，纯 currentColor，深浅色自适应）。 */
function GuideArtworkGit() {
  return h('svg', {
    width: 40,
    height: 40,
    viewBox: '0 0 40 40',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true'
  },
  h('path', { d: 'M8 30V10' }),
  h('path', { d: 'M8 16c0-4.4 3.6-8 8-8h6', opacity: 0.85 }),
  h('path', { d: 'M22 24c-3.3 0-6-2.7-6-6v-2' }),
  h('circle', { cx: 8, cy: 8, r: 2.6 }),
  h('circle', { cx: 30, cy: 8, r: 2.6 }),
  h('circle', { cx: 22, cy: 26, r: 2.6 }),
  h('path', { d: 'M19 31h10', opacity: 0.5 }),
  h('path', { d: 'M19 34h6', opacity: 0.35 }))
}

export const name = PLUGIN_ID

/** 这些服务由宿主 bundle 提供，缺一个就不激活 —— 明确地「要么全有、要么不跑」。 */
export const inject = ['slots', 'locale', 'connection', 'sidebarRightTabs', 'sidebarRight']

export function apply(ctx) {
  try {
    applyRegistrations(ctx)
  } catch (error) {
    // 激活失败必须可见：原文打到渲染进程 console（会被写进 crash-*-web-boot.log）
    console.error('[dsh-git-panel] apply 失败: ' + (error && error.stack ? error.stack : String(error)))
    throw error
  }
}

function applyRegistrations(ctx) {
  setPluginContext(ctx)
  const t = ctx.locale.bind(NS)

  /* ------------------------------ 字典 ------------------------------ */
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), PLUGIN_ID + ': dictionaries')

  /* ------------------- 会话标题栏按钮（常驻入口） ------------------- */
  // 右侧栏可能被收起，光靠「+」菜单会找不到入口，所以标题栏最右侧放一个常驻按钮。
  // 槽位用 `utilities`：会话标题栏四段依次是 lineage(single) → actions(list) →
  // utilities(list) → corner(single，侧栏开关)。utilities 紧挨「打开侧边栏」那些按钮，
  // 在整行的最右侧区域；actions 则紧贴标题、偏左。
  // 点击 = openTabIn(sessionId, 'git')，布局 store 会自动展开右侧栏并聚焦该页签。
  ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
    name: 'conversation.session.header.utilities',
    id: 'git-changes',
    order: 30,
    locale: NS,
    inject: () => ({ openPanel: (sessionId) => ctx.sidebarRight.openTabIn(sessionId, TAB_KIND) })
  }, GitHeaderAction)), PLUGIN_ID + ': header utility')

  /* ------------------- 会话右侧栏 tab 类型（面板本体） ------------------- */
  // Git 变动与「当前会话所在项目」强绑定，所以只挂在 session 作用域的右侧栏：
  // 打开会话 → 右侧栏「+」→「Git 变更」，面板拿到的 sessionId 就是当前会话。
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PLUGIN_ID,
    kind: TAB_KIND,
    priority: 'extension',
    title: () => t('tab.title'),
    guide: [{
      id: 'git-changes',
      order: 62,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
      icon: GuideArtworkGit
    }]
  }), PLUGIN_ID + ': tab type')

  /* ------------------------ 右侧栏 tab body ------------------------ */
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: PLUGIN_ID,
    locale: NS
  }, GitPanelSurface)), PLUGIN_ID + ': tab body')
}
