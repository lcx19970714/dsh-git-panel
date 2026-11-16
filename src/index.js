/**
 * src/index.js —— 客户端插件入口（打包产物 client.js 的源）
 *
 * 注册清单（每条都是"一条路"）：
 *   1. 样式      —— factory 执行期间同步注入（模块顶层已调用 ensureStyles）
 *   2. 字典      —— ctx.locale.register(NS, { zh, en })
 *   3. tab 类型  —— 会话右侧栏：id = 'dsh-git-panel'，kind = 'git'，带 guide 引导项
 *   4. tab body  —— 右侧栏 tab 内容，key 必须等于 tab 类型的 id
 *
 * 两个入口共用 Panel：会话右侧栏以 sessionId 解析目录；代码坞主页面独立选择工作区，
 * 直接传工作区 cwd，不要求打开会话。
 *
 * 参考实现：dsh-client-ui-sidebar-browser（tab 类型 + guide + body 槽）。
 */
import { h, setPluginContext } from './platform.js'
import { ensureStyles } from './styles.js'
import { NS, zh, en } from './i18n.js'
import { GitPanelSurface } from './components/GitPanelSurface.js'
import { GitHeaderAction } from './components/HeaderAction.js'
import { SidebarGitEntry } from './components/SidebarGitEntry.js'
import { GitDockSurface } from './components/GitDockSurface.js'

const PLUGIN_ID = 'dsh-git-panel'
const TAB_KIND = 'git'

// 样式注入必须发生在 factory 执行期间（平台据此打 data-plugin 并在卸载时回收）。
ensureStyles()

/** 右侧栏「+」引导页里的插画：40×40，纯 currentColor，与图标集同一套圆角线。 */
function GuideArtworkGit() {
  return h('svg', {
    width: 40,
    height: 40,
    viewBox: '0 0 40 40',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': 'true'
  },
  // 面板轮廓
  h('rect', { x: 5, y: 6, width: 30, height: 28, rx: 5 }),
  // 一条主干 + 一个分支 + 三个提交点
  h('path', { d: 'M13 12v16' }),
  h('path', { d: 'M13 18c0-2.2 1.8-4 4-4h6' }),
  h('circle', { cx: 13, cy: 12, r: 2.2 }),
  h('circle', { cx: 13, cy: 28, r: 2.2 }),
  h('circle', { cx: 25, cy: 14, r: 2.2 }),
  // 右侧的 diff 行：一条长、一条短
  h('path', { d: 'M22 23h8' }),
  h('path', { d: 'M22 27h5' }))
}

export const name = PLUGIN_ID

/** 这些服务由宿主 bundle 提供，缺一个就不激活 —— 明确地「要么全有、要么不跑」。 */
export const inject = ['slots', 'locale', 'connection', 'sidebarRightTabs', 'sidebarRight', 'uiWorkspace', 'layout']

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

  /* ------------------- 左侧栏入口（常驻「代码坞」按钮） ------------------- */
  // 位置：左侧栏底部、设置按钮旁边（root 作用域，侧栏收起时只剩图标）。
  // 点击打开独立主页面，不依赖会话；当前会话只用于确定初始工作区。
  ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'git-dock',
    order: 20,
    locale: NS,
    label: () => t('entry.title'),
    inject: () => ({
      openPanel: () => ctx.layout.selectPanel(PLUGIN_ID)
    })
  }, SidebarGitEntry)), PLUGIN_ID + ': sidebar footer entry')

  /* ------------------------ 独立代码坞主页面 ------------------------ */
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PLUGIN_ID,
    locale: NS
  }, GitDockSurface)), PLUGIN_ID + ': dock main page')

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
