/* eslint-disable */
/* 由 build/build-client.mjs 从 src/ 生成，请勿手工编辑。 */
/* 模块: 42 个 */
window.__ModuleLoader__.load({
  id: "dsh-git-panel",
  factory: (require) => {
    "use strict";
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var __factories = {};
    var __cache = {};
    function __define(id, factory) { __factories[id] = factory; }
    function __m(id) {
      if (Object.prototype.hasOwnProperty.call(__cache, id)) return __cache[id].exports;
      var factory = __factories[id];
      if (factory === undefined) throw new Error("dsh-git-panel: unknown module " + id);
      var mod = { exports: {} };
      __cache[id] = mod;
      factory(mod.exports, mod);
      return mod.exports;
    }
    // react 是平台种子模块，由外层 require 提供
    __define("react", (exports, module) => {
      var seed = require("react");
      module.exports = seed;
      if (seed && seed.default === undefined) {
        try { Object.defineProperty(seed, "default", { value: seed, enumerable: false, configurable: true }); } catch (e) { /* ignore */ }
      }
    });
    __define("./index.js", (exports, module) => {
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
      const { h, setPluginContext } = __m("./platform.js");
      const { ensureStyles } = __m("./styles.js");
      const { NS, zh, en } = __m("./i18n.js");
      const { GitPanelSurface } = __m("./components/GitPanelSurface.js");
      const { GitHeaderAction } = __m("./components/HeaderAction.js");
      const { SidebarGitEntry } = __m("./components/SidebarGitEntry.js");

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

      const name = PLUGIN_ID

      /** 这些服务由宿主 bundle 提供，缺一个就不激活 —— 明确地「要么全有、要么不跑」。 */
      const inject = ['slots', 'locale', 'connection', 'sidebarRightTabs', 'sidebarRight', 'uiWorkspace']

      function apply(ctx) {
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
        // 点击打开「当前挂载会话」的 Git 页签；openTab 不传 sessionId，由 sidebarRight 自己解析。
        ctx.effect(() => ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'git-dock',
          order: 20,
          locale: NS,
          label: () => t('entry.title'),
          inject: () => ({
            openPanel: () => ctx.sidebarRight.openTab(TAB_KIND)
          })
        }, SidebarGitEntry)), PLUGIN_ID + ': sidebar footer entry')

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

      Object.assign(exports, { name, inject, apply });

    });
    __define("./platform.js", (exports, module) => {
      /**
       * src/platform.js —— 与 DSH 客户端运行时的唯一接触面
       *
       * 全插件只从这里拿 react 与宿主 ctx，其它模块一律 `import ... from './platform.js'`。
       * 没有降级分支：这些能力由 index.js 的 `inject` 声明保证存在。
       */
      const react = __m("react").default;

      /** createElement 简写。 */
      const h = react.createElement

      /** 组件片段。 */
      const Fragment = react.Fragment

      /**
       * 类组件基类。
       *
       * 全插件只有一处需要它：面板入口的错误边界（`components/GitPanelSurface.js`）。
       * 渲染期异常只能由最近的 error boundary 接住，而 boundary 在 React 里只能是类组件。
       */
      const Component = react.Component

      /** 只导出实际用到的 hooks。 */
      const useState = react.useState
      const useEffect = react.useEffect
      const useLayoutEffect = react.useLayoutEffect
      const useMemo = react.useMemo
      const useCallback = react.useCallback
      const useRef = react.useRef

      /** apply(ctx) 时写入一次；api.js 用它取 connection 服务。 */
      let pluginContext = null

      function setPluginContext(ctx) {
        pluginContext = ctx
      }

      function getPluginContext() {
        return pluginContext
      }

      Object.assign(exports, { h, Fragment, Component, useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, setPluginContext, getPluginContext });

    });
    __define("./styles.js", (exports, module) => {
      /**
       * src/styles.js —— 面板全部样式
       *
       * 规则（见 docs/CONTRACT.md §4/§6）：
       *  · 颜色/圆角/字体/间距全部取自 DSH 主题令牌（--dsw-* / --dsh-*），**零字面量色值**；
       *  · 深浅色自动跟随（令牌定义在 body 上，暗色由 body[data-ds-dark-theme] 切换），
       *    因此这里不需要写暗色覆写；
       *  · 分隔线一律 .5px 发丝线；
       *  · 样式必须在 factory 执行期间同步注入，平台才会打上 data-plugin 并在卸载时回收。
       */
      const STYLE_ID = 'dsh-git-panel-css'

      const CSS = `
      /* ===================== 1. 容器 ===================== */
      .dgp-root {
        --dgp-left-width: 264px;
        --dgp-gutter-w: 3.5em;
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        box-sizing: border-box;
        height: 100%;
        min-height: 0;
        min-width: 0;
        color: var(--dsw-alias-label-primary);
        font-family: var(--dsw-font-family);
        font-size: var(--dsh-content-font-size-secondary, 13px);
        line-height: 1.5;
        /* 不设背景：右侧栏 tab 宿主已经是页面地面色 */
      }
      .dgp-root *, .dgp-root *::before, .dgp-root *::after { box-sizing: border-box; }
      .dgp-oneline { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dgp-ico { display: block; flex: none; }

      /* ===================== 2. 顶栏（36px，无分隔线） ===================== */
      .dgp-toolbar {
        display: flex;
        flex: none;
        align-items: center;
        gap: 6px;
        height: 36px;
        padding: 0 6px 0 8px;
      }
      .dgp-tbar-row { display: flex; align-items: center; gap: 6px; min-width: 0; width: 100%; }
      .dgp-spacer { flex: 1 1 auto; min-width: 0; }

      /* 计数小胶囊（模式分段按钮上的数字） */
      .dgp-pill-count {
        flex: none;
        min-width: 14px;
        padding: 0 3px;
        border-radius: var(--dsw-radius-xs);
        background: var(--dsw-alias-bg-module-platform);
        color: var(--dsw-alias-label-tertiary);
        font-family: var(--ds-font-family-code);
        font-size: 10px;
        line-height: 14px;
        text-align: center;
      }

      /* 分段控件（变更 | 文件） */
      .dgp-seg { display: inline-flex; flex: none; align-items: center; gap: 2px; }
      .dgp-seg-btn {
        height: 24px;
        padding: 0 8px;
        border: 0;
        border-radius: var(--dsw-radius-xs);
        background: 0 0;
        color: var(--dsw-alias-label-secondary);
        font: inherit;
        font-size: 12px;
        line-height: 18px;
        cursor: pointer;
      }
      .dgp-seg-btn:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .dgp-seg-btn[data-active="true"], .dgp-seg-btn[aria-pressed="true"] {
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-module-platform);
      }

      /* 工具按钮（28×28 / 图标 15×15） */
      .dgp-iconbtn {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 0;
        border-radius: var(--dsw-radius-xs);
        background: 0 0;
        color: var(--dsw-alias-label-secondary);
        line-height: 1;
        cursor: pointer;
      }
      .dgp-iconbtn:hover:not(:disabled) {
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-interactive-bg-hover);
      }
      .dgp-iconbtn[data-active="true"], .dgp-iconbtn[aria-pressed="true"],
      .dgp-iconbtn[data-active="true"], .dgp-iconbtn[aria-pressed="true"] {
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-interactive-bg-hover);
      }
      .dgp-iconbtn:disabled { opacity: .4; cursor: default; }
      .dgp-iconbtn[data-busy="true"] svg { animation: dgp-spin 1s linear infinite; }
      .dgp-iconbtn:focus-visible, .dgp-btn:focus-visible,
      .dgp-seg-btn:focus-visible, .dgp-input:focus-visible,
      .dgp-row:focus-visible, .dgp-group-head:focus-visible {
        outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
        outline-offset: -1px;
      }
      @keyframes dgp-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }

      /* 通用按钮：无描边，用底色分层（hover 只加深一档） */
      .dgp-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        height: 28px;
        padding: 0 10px;
        border: 0;
        border-radius: var(--dsw-radius-xs);
        background: var(--dsw-alias-bg-module-platform);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 12px;
        line-height: 18px;
        cursor: pointer;
        white-space: nowrap;
      }
      .dgp-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-3); }
      .dgp-btn:disabled { opacity: .45; cursor: default; }
      .dgp-btn[data-variant="primary"] {
        background: var(--dsw-alias-state-business-primary);
        color: var(--dsw-alias-label-primary-inverted);
      }
      /* 主按钮 hover 必须在这里再声明一次底色：
         通用规则 .dgp-btn:hover:not(:disabled) 的权重 (0,3,0) 高于
         .dgp-btn[data-variant="primary"] 的 (0,2,0)，只写 filter 的话底色会被那条通用规则
         换成中性 hover 层，而文字仍是反色 —— 日间是白字压浅层、夜间是黑字压深层，
         两边都会变成「指针一移上去按钮就消失」。底色和文字必须成对声明，
         hover、禁用、日间、夜间才对齐。 */
      .dgp-btn[data-variant="primary"]:hover:not(:disabled) {
        background: var(--dsw-alias-state-business-primary);
        filter: brightness(1.06);
      }
      .dgp-btn[data-variant="ghost"] { background: 0 0; }
      .dgp-btn[data-variant="ghost"]:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
      .dgp-btn[data-variant="danger"] { background: 0 0; color: var(--dsw-alias-state-error-primary); }
      .dgp-btn[data-size="sm"] { height: 24px; padding: 0 8px; font-size: 11px; border-radius: var(--dsw-radius-xs); }

      /* 搜索框 */
      .dgp-filter { display: flex; flex: none; align-items: center; gap: 6px; padding: 2px 8px 6px; }
      .dgp-search { position: relative; display: flex; align-items: center; flex: 1 1 auto; min-width: 0; }
      .dgp-search > .dgp-ico { position: absolute; left: 7px; color: var(--dsw-alias-label-tertiary); pointer-events: none; }
      .dgp-input {
        width: 100%;
        height: 26px;
        padding: 0 24px 0 26px;
        border: 0;
        border-radius: var(--dsw-radius-xs);
        background: var(--dsw-alias-bg-module-platform);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 12px;
        line-height: 18px;
      }
      .dgp-input:focus { background: var(--dsw-alias-bg-layer-3); }
      .dgp-input::placeholder { color: var(--dsw-alias-label-tertiary); }
      .dgp-search-clear {
        position: absolute;
        right: 3px;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        padding: 0;
        border: 0;
        border-radius: var(--dsw-radius-xs);
        background: 0 0;
        color: var(--dsw-alias-label-tertiary);
        cursor: pointer;
      }
      .dgp-search-clear:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
      .dgp-hint { padding: 4px 10px; color: var(--dsw-alias-label-tertiary); font-size: 11px; }

      /* ===================== 3. 主区：左列 + 分裂条 + 右栏 ===================== */
      .dgp-body { display: flex; flex: 1 1 auto; min-height: 0; min-width: 0; }
      .dgp-pane-left { display: flex; flex: none; flex-direction: column; width: var(--dgp-left-width, 264px); min-width: 180px; min-height: 0; }
      .dgp-pane-right { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; min-height: 0; }
      /* 变更模式左栏：储存库 + 提交框 + 变更列表（列表自己滚动） */
      .dgp-changes { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; }

      /* 「储存库」区域 */
      .dgp-repolist { display: flex; flex: none; flex-direction: column; padding-bottom: 2px; }
      .dgp-repolist-head { display: flex; align-items: center; gap: 2px; padding: 4px 6px 4px 2px; }
      .dgp-repolist-toggle {
        display: flex;
        flex: 1 1 auto;
        align-items: center;
        gap: 4px;
        min-width: 0;
        height: 22px;
        padding: 0 4px;
        border: 0;
        border-radius: var(--dsw-radius-xs);
        background: 0 0;
        color: var(--dsw-alias-label-tertiary);
        font: inherit;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: .01em;
        text-align: left;
        cursor: pointer;
      }
      .dgp-repolist-toggle:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .dgp-repolist-title { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dgp-repolist-rows { padding-bottom: 4px; }
      .dgp-repo-row { min-height: 26px; padding-top: 3px; padding-bottom: 3px; }
      .dgp-repo-row > .dgp-ico { color: var(--dsw-alias-label-tertiary); }
      /* 「显示已隐藏」开关：图标 + 数字，跟标题行的计数同一档字号 */
      .dgp-repolist-hidden-count {
        font-family: var(--ds-font-family-code);
        font-size: 10px;
        line-height: 1;
        color: var(--dsw-alias-label-tertiary);
      }
      /* 已隐藏的行：弱化，明确「它现在不在列表里」 */
      .dgp-repo-row[data-hidden="true"] .dgp-name { color: var(--dsw-alias-label-tertiary); }
      /* 当前分支：贴在仓库行最右侧的按钮。只有点它才打开分支菜单，点仓库名只选中仓库。 */
      .dgp-repo-branch {
        flex: 0 1 auto;
        min-width: 0;
        max-width: 45%;
        margin-left: auto;
        padding: 1px 6px;
        border: 0;
        border-radius: var(--dsw-radius-xs);
        background: transparent;
        color: var(--dsw-alias-label-tertiary);
        font: inherit;
        font-family: var(--ds-font-family-code);
        font-size: 11px;
        line-height: 18px;
        cursor: pointer;
      }
      .dgp-repo-branch:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .dgp-repo-branch:focus-visible { outline: none; background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      /* 行上的改动规模：文件数 + 增删行数（有改动才出现，编号用等宽） */
      .dgp-repo-stats {
        display: inline-flex;
        flex: 0 0 auto;
        align-items: center;
        gap: 3px;
        max-width: 42%;
        padding-left: 4px;
        overflow: hidden;
        white-space: nowrap;
        font-family: var(--ds-font-family-code);
        font-size: 10px;
        line-height: 1;
        color: var(--dsw-alias-label-tertiary);
      }
      .dgp-repo-stats > .dgp-ico { flex: none; opacity: .8; }
      .dgp-repo-stats-files { color: var(--dsw-alias-label-secondary); }
      .dgp-repo-stats .dgp-add,
      .dgp-repo-stats .dgp-del { font-size: 10px; }
      .dgp-repo-conflict { color: var(--dsw-alias-state-warn-label); font-weight: 600; }

      /* 分支菜单里的筛选框（分支多时才出现） */
      .dgp-branch-filter {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px 6px;
      }
      .dgp-branch-filter > .dgp-ico { flex: none; color: var(--dsw-alias-label-tertiary); }
      .dgp-branch-filter > .dgp-input { flex: 1 1 auto; min-width: 0; height: 24px; padding: 0 6px; }
      /* 分支条目：本地 / 远程 两个小标签，亮 = 有，暗 = 没有 */
      .dgp-menu-badges { display: inline-flex; gap: 4px; flex: none; }
      .dgp-menu-badge {
        padding: 0 5px;
        border-radius: var(--dsw-radius-xs);
        font-size: 10px;
        line-height: 15px;
        color: var(--dsw-alias-label-tertiary);
        background: transparent;
        border: 1px solid var(--dsw-alias-border-l1);
      }
      .dgp-menu-badge[data-active="true"] {
        color: var(--dsw-alias-label-primary);
        border-color: var(--dsw-alias-label-secondary);
        background: var(--dsw-alias-bg-module-platform);
      }

      /* 分支菜单底部：创建区（名字 + 创建基准 + 是否切换 + 现状提示 + 撞车出口） */
      .dgp-branch-create {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 4px 4px 2px;
      }
      .dgp-branch-create-row { display: flex; align-items: center; gap: 4px; }
      .dgp-branch-create-row > .dgp-input {
        flex: 1 1 auto;
        min-width: 0;
        height: 24px;
        padding: 0 8px;
        font-family: var(--ds-font-family-code);
        font-size: 11px;
      }
      .dgp-branch-create-row > .dgp-btn { flex: none; }
      /* 基准选择与「创建后切换」同排：两者都是「怎么建」的参数，放一起才读得通 */
      .dgp-branch-create-opts { display: flex; align-items: center; gap: 6px; min-width: 0; }
      .dgp-branch-base-label { flex: none; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
      .dgp-branch-base {
        flex: 1 1 auto;
        min-width: 0;
        height: 22px;
        padding: 0 4px;
        font-family: var(--ds-font-family-code);
        font-size: 11px;
      }
      .dgp-branch-check {
        display: inline-flex;
        flex: none;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: var(--dsw-alias-label-tertiary);
        white-space: nowrap;
        cursor: pointer;
      }
      .dgp-branch-check > input { margin: 0; }
      .dgp-branch-check:has(> input:disabled) { opacity: .5; cursor: default; }
      /* 撞车：不是错误条，而是「换个选择」的提示块 */
      .dgp-branch-blocked { display: flex; flex-direction: column; gap: 4px; }
      .dgp-branch-blocked .dgp-branch-hint { white-space: pre-line; }
      .dgp-branch-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 4px; }
      .dgp-addform { display: flex; flex-direction: column; gap: 4px; padding: 4px 8px 8px; }
      .dgp-addform-path { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
      .dgp-addform-path > .dgp-input { flex: 1 1 120px; min-width: 0; padding: 0 8px; }
      .dgp-addform-path > .dgp-btn { flex: none; }
      .dgp-addform-actions { display: flex; justify-content: flex-end; gap: 6px; }
      .dgp-list {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        min-height: 0;
        padding: 2px 2px 8px 0;
        overflow: auto;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
      }
      .dgp-divider {
        position: relative;
        z-index: 1;
        flex: none;
        width: 0;
        cursor: col-resize;
        touch-action: none;
      }
      .dgp-divider::before {
        content: "";
        position: absolute;
        top: 0; bottom: 0; left: -.25px;
        width: .5px;
        background: var(--dsw-alias-border-l4);
      }
      .dgp-divider::after {
        content: "";
        position: absolute;
        inset: 0 -4px;
        background: linear-gradient(to bottom, transparent, var(--dsw-alias-label-caption) 50%, transparent) center / 1px 100% no-repeat;
        opacity: 0;
        transition: opacity .12s ease-out;
      }
      .dgp-divider:hover::after, .dgp-divider[data-dragging="true"]::after,
      .dgp-divider:focus-visible { outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }

      /* ===================== 4. 左列：分组与行 ===================== */
      .dgp-level { margin: 0; padding: 0; list-style: none; }
      .dgp-item { margin: 0; padding: 0; }
      /* 左侧栏底部入口：宽栏时图标 + 文案，56px 图标条时只有图标 */
      .dgp-dockbtn {
        display: flex;
        flex: 1 1 auto;
        align-items: center;
        justify-content: flex-start;
        gap: 8px;
        width: 100%;
        min-width: 0;
        height: 36px;
        margin: 0;
        padding: 0 8px;
        border: 0;
        border-radius: var(--dsw-radius-md);
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font: inherit;
        cursor: pointer;
        position: relative;
      }
      .dgp-dockbtn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .dgp-dockbtn:focus-visible { outline: var(--dsw-focus-ring-width) solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
      .dgp-dockbtn > svg { flex: none; }
      .dgp-dockbtn-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .dgp-dockbtn[data-wide="false"] { flex: none; justify-content: center; width: 36px; height: 36px; padding: 0; }
      .dgp-dockbtn-failed {
        position: absolute;
        top: 3px;
        right: 3px;
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--dsw-alias-state-error-primary);
      }
      /* 仓库行：高亮框在整个行上（仓库名 + 分支按钮），分支按钮贴在框内右侧 */
      .dgp-repo-wrap {
        border-radius: var(--dsw-radius-xs);
        padding-right: 2px;
      }
      .dgp-repo-wrap:hover,
      .dgp-repo-wrap[data-active="true"] { background: var(--dsw-alias-interactive-bg-hover); }
      /* 行按钮自己不再画背景：否则高亮到分支按钮前面就断了，看起来像框外的黑块 */
      .dgp-repo-wrap > .dgp-row:hover,
      .dgp-repo-wrap > .dgp-row[data-active="true"] { background: transparent; }
      .dgp-repo-wrap > .dgp-repo-branch {
        flex: 0 0 auto;
        max-width: 48%;
        margin: 0 4px 0 auto;
      }
      .dgp-repo-wrap[data-hidden="true"] { opacity: .6; }
      .dgp-row-wrap {
        display: flex;
        align-items: center;
        min-width: 0;
      }
      .dgp-row-wrap > .dgp-row { flex: 1 1 auto; min-width: 0; width: auto; }
      .dgp-row-wrap > .dgp-row-action { margin-right: 6px; }
      .dgp-row {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        min-height: 28px;
        padding: 4px 10px 4px calc(4px + var(--dgp-depth, 0) * 14px);
        border: 0;
        border-radius: var(--dsw-radius-xs);
        background: 0 0;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
        content-visibility: auto;
        contain-intrinsic-size: auto 28px;
      }
      .dgp-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
      /* 选中态只靠背景色区分：不加左侧色条、不加描边 */
      .dgp-row[data-active="true"], .dgp-row[aria-selected="true"] {
        background: var(--dsw-alias-interactive-bg-hover);
      }
      .dgp-row[data-kind="dir"] { color: var(--dsw-alias-label-secondary); }
      .dgp-row[data-cursor="true"] { background: var(--dsw-alias-interactive-bg-hover); }
      .dgp-caret, .dgp-group-caret {
        display: flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: 14px;
        height: 14px;
        color: var(--dsw-alias-label-tertiary);
        transition: transform .12s ease-out;
      }
      .dgp-caret[data-open="true"], .dgp-group-caret[data-open="true"] { transform: rotate(90deg); }
      .dgp-caret svg, .dgp-group-caret svg { width: 12px; height: 12px; }
      .dgp-name {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--dsw-alias-label-primary);
      }
      .dgp-name-dir { color: var(--dsw-alias-label-secondary); }
      /* 列表模式：文件名优先，父路径吃掉剩余宽度并截断（树形里路径只是补充说明） */
      .dgp-list[data-view="list"] .dgp-sub { flex: 1 1 auto; }
      .dgp-sub {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--dsw-alias-label-tertiary);
        font-size: 11px;
      }
      .dgp-meta {
        display: inline-flex;
        flex: none;
        align-items: center;
        gap: 6px;
        margin-left: auto;
        color: var(--dsw-alias-label-tertiary);
        font-family: var(--ds-font-family-code);
        font-size: 11px;
      }
      .dgp-add { color: var(--dsw-alias-state-success-primary); }
      .dgp-del { color: var(--dsw-alias-state-error-primary); }

      /* 行尾暂存 / 取消暂存：默认收起，悬停或键盘聚焦所在行时出现（VS Code 的行为） */
      .dgp-row-action {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        margin-left: 2px;
        padding: 0;
        border: 0;
        border-radius: var(--dsw-radius-xs);
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
        opacity: 0;
      }
      .dgp-row-wrap:hover .dgp-row-action,
      .dgp-row-wrap:focus-within .dgp-row-action,
      .dgp-row-action:focus-visible { opacity: 1; }
      .dgp-row-action:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .dgp-row-action[data-busy='true'] { opacity: .5; cursor: default; }
      .dgp-row-action:disabled { cursor: default; }

      /* 状态字母 M/A/D/R/C/T/U/? */
      /* 状态字母：只上色、不铺底（一排彩色小方块太碎） */
      .dgp-status-letter {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: 13px;
        height: 16px;
        font-family: var(--ds-font-family-code);
        font-size: 10px;
        font-weight: 600;
        line-height: 1;
        color: var(--dsw-alias-label-tertiary);
      }
      .dgp-status-letter[data-status="M"] { color: var(--dsw-alias-state-warn-label); }
      .dgp-status-letter[data-status="A"] { color: var(--dsw-alias-state-success-primary); }
      .dgp-status-letter[data-status="D"] { color: var(--dsw-alias-state-error-primary); }
      .dgp-status-letter[data-status="R"], .dgp-status-letter[data-status="C"] {
        color: var(--dsw-alias-state-business-primary);
      }
      .dgp-status-letter[data-status="T"] { color: var(--dsw-alias-label-secondary); }
      .dgp-status-letter[data-status="U"] { color: var(--dsw-alias-state-error-secondary); }
      .dgp-status-letter[data-status="?"] { color: var(--dsw-alias-state-success-secondary); }

      /* 分组头 */
      .dgp-group { display: flex; flex-direction: column; }
      .dgp-group-head {
        display: flex;
        align-items: center;
        gap: 4px;
        width: 100%;
        height: 26px;
        margin-top: 2px;
        padding: 0 8px 0 4px;
        border: 0;
        border-radius: var(--dsw-radius-xs);
        background: 0 0;
        color: var(--dsw-alias-label-tertiary);
        font: inherit;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: .01em;
        text-align: left;
        cursor: pointer;
      }
      .dgp-group-head:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .dgp-group-head-wrap { display: flex; align-items: center; }
      .dgp-group-head-wrap > .dgp-group-head { flex: 1 1 auto; min-width: 0; width: auto; }
      .dgp-group-action {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        margin-right: 6px;
        padding: 0;
        border: 0;
        border-radius: var(--dsw-radius-xs);
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        cursor: pointer;
        opacity: 0;
      }
      .dgp-group-head-wrap:hover .dgp-group-action,
      .dgp-group-head-wrap:focus-within .dgp-group-action,
      .dgp-group-action:focus-visible { opacity: 1; }
      .dgp-group-action:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .dgp-group-action[data-busy='true'] { opacity: .5; cursor: default; }
      .dgp-group-title { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dgp-group-count {
        flex: none;
        min-width: 12px;
        padding: 0 2px;
        color: var(--dsw-alias-label-tertiary);
        font-family: var(--ds-font-family-code);
        font-size: 10px;
        font-weight: 500;
        line-height: 15px;
        text-align: center;
      }

      /* 提交框：位于变更列表最上方，输入框右侧内嵌生成按钮 */
      .dgp-commit {
        display: flex;
        flex: none;
        flex-direction: column;
        gap: 6px;
        padding: 8px 8px 6px;
      }
      .dgp-commit-input-wrap { position: relative; }
      .dgp-commit-input {
        width: 100%;
        min-height: 52px;
        max-height: 160px;
        padding: 6px 30px 6px 8px;
        border: 0;
        border-radius: var(--dsw-radius-xs);
        background: var(--dsw-alias-bg-module-platform);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 12px;
        line-height: 1.5;
        /* 高度由内容决定（CommitBox 里按 scrollHeight 算，两行起步、到上限改滚动） */
        resize: none;
        overflow-y: auto;
      }
      .dgp-commit-input:focus { outline: none; background: var(--dsw-alias-bg-layer-3); }
      .dgp-commit-tools {
        position: absolute;
        top: 4px;
        right: 4px;
        display: flex;
        gap: 2px;
      }
      .dgp-commit-generate,
      .dgp-commit-run {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        padding: 0;
        border: 0;
        border-radius: var(--dsw-radius-xs);
        background: transparent;
        color: var(--dsw-alias-label-tertiary);
        cursor: pointer;
      }
      .dgp-commit-generate:hover,
      .dgp-commit-run:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .dgp-commit-generate[data-busy='true'] { opacity: .5; cursor: default; }
      .dgp-commit-run:disabled { opacity: .35; cursor: not-allowed; }
      /* 两个图标出现时给输入框右侧留出位置，文字不会被按钮压住 */
      .dgp-commit-input-wrap[data-actions='two'] .dgp-commit-input { padding-right: 58px; }
      /* 动作行：左边一行状态（提示 / 进度 / 结果），右边「创建 PR」 */
      .dgp-commit-actions { display: flex; align-items: center; gap: 8px; min-height: 24px; }
      .dgp-commit-status {
        display: flex;
        flex: 1 1 auto;
        align-items: center;
        gap: 6px;
        min-width: 0;
        color: var(--dsw-alias-label-tertiary);
        font-size: 11px;
      }
      .dgp-commit-status[data-tone="info"] { color: var(--dsw-alias-label-secondary); }
      .dgp-commit-status[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }
      .dgp-commit-status-text { min-width: 0; }
      /* 错误提示：换行 + 最多 5 行（完整内容仍在 title 上），别让一句「余额不足，去充值或换模型」被省略号吃掉 */
      .dgp-commit-status[data-wrap="true"] { align-items: flex-start; }
      .dgp-commit-status[data-wrap="true"] .dgp-commit-status-text {
        display: -webkit-box;
        -webkit-line-clamp: 5;
        -webkit-box-orient: vertical;
        overflow: hidden;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        line-height: 1.55;
      }
      .dgp-commit-settings { flex: none; }
      .dgp-commit-status .dgp-spinner { width: 11px; height: 11px; border-width: 1.2px; }

      /* 设置页 */
      .dgp-settings { display: flex; flex-direction: column; gap: 14px; padding: 14px 12px; max-width: 520px; }
      .dgp-settings-head { display: flex; align-items: center; gap: 8px; }
      .dgp-settings-title { margin: 0; font-size: 13px; font-weight: 600; }
      .dgp-settings-field { display: flex; flex-direction: column; gap: 6px; }
      .dgp-settings-label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
      .dgp-settings-hint { margin: 0; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
      .dgp-select {
        height: 30px;
        max-width: 420px;
        padding: 0 8px;
        border: 0;
        border-radius: var(--dsw-radius-xs);
        background: var(--dsw-alias-bg-module-platform);
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 12px;
      }

      .dgp-note { margin: 0; padding: 4px 10px; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
      .dgp-note[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }

      /* ===================== 5. 右栏查看器 ===================== */
      .dgp-viewer { display: flex; flex: 1 1 auto; flex-direction: column; min-width: 0; min-height: 0; }
      .dgp-viewer-head {
        display: flex;
        flex: none;
        align-items: center;
        gap: 6px;
        height: 34px;
        padding: 0 6px 0 10px;
      }
      .dgp-viewer-title {
        flex: 0 1 auto;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--dsw-alias-label-primary);
        font-size: 12px;
        line-height: 20px;
      }
      .dgp-viewer-sub {
        display: inline-flex;
        flex: none;
        align-items: center;
        gap: 6px;
        color: var(--dsw-alias-label-tertiary);
        font-family: var(--ds-font-family-code);
        font-size: 11px;
        line-height: 18px;
      }
      .dgp-viewer-actions { display: inline-flex; flex: none; align-items: center; gap: 2px; margin-left: auto; }
      .dgp-scroll {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        min-height: 0;
        overflow: auto;
        overscroll-behavior: contain;
        scrollbar-gutter: stable;
      }

      /* ===================== 6. diff ===================== */
      .dgp-diff {
        --dgp-empty-fill: var(--dsw-alias-bg-skeleton);
        flex: 1 1 auto;
        min-height: 0;
        padding: 8px 0 16px;
        font-family: var(--ds-font-family-code);
        font-size: var(--dsh-code-font-size, 12px);
        line-height: 22px;
      }
      .dgp-hunk { margin-bottom: 6px; }
      .dgp-hunk-head {
        display: flex;
        align-items: baseline;
        gap: 8px;
        min-height: 22px;
        padding: 2px 16px;
        color: var(--dsw-alias-label-tertiary);
        font-family: var(--ds-font-family-code);
        font-size: 11px;
        white-space: pre;
        user-select: none;
      }
      .dgp-hunk-section { color: var(--dsw-alias-label-caption); opacity: .85; }
      .dgp-hunk-head::before, .dgp-hunk-head::after {
        content: "";
        flex: 1 1 auto;
        height: .5px;
        background: var(--dsw-alias-border-l1);
      }
      .dgp-hunk-head > * { flex: none; }

      .dgp-diff-row {
        display: grid;
        grid-template-columns: var(--dgp-gutter-w) var(--dgp-gutter-w) 1.4em minmax(0, 1fr);
        min-height: 22px;
        line-height: 22px;
        white-space: pre;
      }
      .dgp-ln {
        padding: 0 6px 0 0;
        color: var(--dsw-alias-label-tertiary);
        text-align: right;
        user-select: none;
        font-variant-numeric: tabular-nums;
      }
      .dgp-marker { text-align: center; user-select: none; opacity: .85; }
      .dgp-diff-text { padding-right: 16px; color: var(--dsw-alias-label-secondary); }
      .dgp-diff-row[data-kind="add"], .dgp-diff-cell[data-kind="add"] {
        --dgp-gutter: var(--dsw-alias-file-diff-added-gutter);
        --dgp-marker: var(--dsw-alias-file-diff-added-marker, var(--dsw-alias-state-success-primary));
        background: var(--dsw-alias-file-diff-added-bg, color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent));
      }
      .dgp-diff-row[data-kind="del"], .dgp-diff-cell[data-kind="del"] {
        --dgp-gutter: var(--dsw-alias-file-diff-deleted-gutter);
        --dgp-marker: var(--dsw-alias-file-diff-deleted-marker, var(--dsw-alias-state-error-primary));
        background: var(--dsw-alias-file-diff-deleted-bg, color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent));
      }
      .dgp-diff-row[data-kind="add"] .dgp-diff-text { color: var(--dsw-alias-label-primary); }
      .dgp-diff-row[data-kind="del"] .dgp-diff-text { color: var(--dsw-alias-label-primary); }
      .dgp-diff-row[data-kind="add"] .dgp-ln,
      .dgp-diff-row[data-kind="del"] .dgp-ln { background: var(--dgp-gutter, transparent); color: var(--dgp-marker); }
      .dgp-diff-row[data-kind="add"] .dgp-marker,
      .dgp-diff-row[data-kind="del"] .dgp-marker { color: var(--dgp-marker); }
      .dgp-diff-row[data-kind="add"] .dgp-marker::before { content: "+"; }
      .dgp-diff-row[data-kind="del"] .dgp-marker::before { content: "−"; }
      .dgp-diff-row[data-kind="add"] { box-shadow: inset 3px 0 0 var(--dgp-marker); }
      .dgp-diff-row[data-kind="del"] { box-shadow: inset 3px 0 0 var(--dgp-marker); }
      .dgp-diff-mark {
        border-radius: 2px;
        background: var(--dsw-alias-code-diff-added, color-mix(in srgb, var(--dsw-alias-state-success-primary) 28%, transparent));
        color: inherit;
      }
      .dgp-diff-row[data-kind="del"] .dgp-diff-mark,
      .dgp-diff-col[data-side="old"] .dgp-diff-mark {
        background: var(--dsw-alias-code-diff-deleted, color-mix(in srgb, var(--dsw-alias-state-error-primary) 28%, transparent));
      }
      .dgp-diff-truncated {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 10px 16px;
        color: var(--dsw-alias-label-tertiary);
        font-family: var(--dsw-font-family);
        font-size: 12px;
      }

      /* split：左右两列，滚动位置由组件同步 */
      .dgp-diff-columns {
        display: grid;
        flex: 1 1 auto;
        grid-template-columns: minmax(max-content, 1fr) minmax(max-content, 1fr);
        min-height: 0;
        align-items: start;
      }
      /* 换行开启后不再需要按内容撑宽，两列等分 */
      .dgp-diff[data-wrap="true"] .dgp-diff-columns,
      .dgp-diff-columns[data-wrap="true"] { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }

      /* 配对行缺失的一侧（另一半是新增或删除）：用极淡的空槽表示「这里没有对应内容」 */
      .dgp-diff-row[data-kind="empty"] { background: 0 0; box-shadow: none; }
      .dgp-diff-cell[data-empty="true"] {
        background: var(--dgp-empty-fill, var(--dsw-alias-bg-skeleton));
        opacity: .55;
      }
      .dgp-diff-col { display: flex; flex-direction: column; min-width: 0; overflow: hidden; }
      .dgp-diff-col[data-side="old"] { border-right: .5px solid var(--dsw-alias-border-l3); }
      .dgp-diff-col .dgp-hunk-head { padding: 2px 10px; }
      .dgp-diff-cell {
        display: grid;
        grid-template-columns: var(--dgp-gutter-w) minmax(0, 1fr);
        min-height: 22px;
        line-height: 22px;
        white-space: pre;
      }
      .dgp-diff-cell .dgp-diff-text { padding-right: 10px; }
      .dgp-diff-cell[data-kind="empty"] { background: var(--dsw-alias-bg-skeleton); }
      .dgp-diff-cell[data-kind="add"] .dgp-marker::before { content: "+"; }
      .dgp-diff-cell[data-kind="del"] .dgp-marker::before { content: "−"; }

      /* 换行开关 */
      .dgp-diff[data-wrap="true"] .dgp-diff-row,
      .dgp-diff[data-wrap="true"] .dgp-diff-cell { white-space: pre-wrap; overflow-wrap: anywhere; }
      /* ===================== 7. 文件编辑器 =====================
         见文件末尾「文件编辑器」区块（textarea + 行号列 + 脏标记） */

      /* ===================== 8. 状态位 ===================== */
      /* 空/加载/错误：在容器里垂直水平都居中（不靠 height:100%，避免在滚动容器里错位） */
      .dgp-state {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 0;
        padding: 20px;
        color: var(--dsw-alias-label-secondary);
        text-align: center;
        line-height: 1.6;
      }
      .dgp-state-icon { flex: none; margin-bottom: 2px; color: var(--dsw-alias-label-tertiary); opacity: .5; }
      .dgp-state-title { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 500; }
      .dgp-state-desc { margin: 0; max-width: 32ch; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
      .dgp-state-actions { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
      .dgp-spinner {
        display: inline-block;
        flex: none;
        width: 14px;
        height: 14px;
        border: 1.5px solid var(--dsw-alias-border-l3);
        border-top-color: var(--dsw-alias-state-business-primary);
        border-radius: 50%;
        animation: dgp-spin .8s linear infinite;
      }
      .dgp-skeleton { display: flex; flex-direction: column; padding: 6px 8px; }
      .dgp-skel-row { display: flex; align-items: center; gap: 8px; min-height: 30px; padding: 5px 4px; }
      .dgp-skel-dot {
        flex: none;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: var(--dsw-alias-bg-skeleton);
        animation: dgp-pulse 2s cubic-bezier(.36, 0, .64, 1) infinite;
      }
      .dgp-skel-bar { height: 11px; border-radius: var(--dsw-radius-xs); background: var(--dsw-alias-bg-skeleton); animation: dgp-pulse 2s cubic-bezier(.36, 0, .64, 1) infinite; }
      @keyframes dgp-pulse { 0% { opacity: 1; } 40% { opacity: .55; } 80%, 100% { opacity: 1; } }
      .dgp-inline-note {
        display: flex;
        align-items: center;
        gap: 6px;
        margin: 6px 8px;
        padding: 5px 8px;
        border-radius: var(--dsw-radius-xs);
        background: var(--dsw-alias-bg-layer-1);
        color: var(--dsw-alias-label-secondary);
        font-size: 12px;
        line-height: 1.5;
      }
      .dgp-inline-note[data-tone="warn"] { color: var(--dsw-alias-state-warn-label); }
      /* 错误条：一条提示 + 右侧「重试」按钮 */
      .dgp-errorbar { display: flex; align-items: center; gap: 6px; padding-right: 8px; }
      .dgp-errorbar > .dgp-inline-note { flex: 1 1 auto; min-width: 0; margin: 8px 0 8px 10px; }
      .dgp-inline-note[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }

      /* ===================== 9. 菜单 ===================== */
      .dgp-menu-scrim { position: fixed; inset: 0; z-index: 2147483000; }
      .dgp-menu {
        position: fixed;
        z-index: 2147483001;
        min-width: 200px;
        max-width: 320px;
        max-height: 60vh;
        padding: 4px;
        border: 0;
        border-radius: var(--dsw-radius-sm);
        background: var(--dsw-alias-bg-layer-2);
        box-shadow: var(--dsw-shadow-md, 0 8px 24px rgba(0, 0, 0, .18));
        overflow: auto;
        overscroll-behavior: contain;
      }
      .dgp-menu-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        min-height: 28px;
        padding: 4px 8px;
        border: 0;
        border-radius: var(--dsw-radius-xs);
        background: 0 0;
        color: var(--dsw-alias-label-primary);
        font: inherit;
        font-size: 12px;
        text-align: left;
        cursor: pointer;
      }
      .dgp-menu-item:hover:not(:disabled), .dgp-menu-item[data-highlight="true"] { background: var(--dsw-alias-interactive-bg-hover); }
      .dgp-menu-item:disabled { opacity: .45; cursor: default; }
      .dgp-menu-item[data-checked="true"] .dgp-menu-check { color: var(--dsw-alias-state-business-primary); }
      .dgp-menu-item-main { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dgp-menu-item-sub { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
      .dgp-menu-label { padding: 6px 8px 4px; color: var(--dsw-alias-label-tertiary); font-size: 11px; font-weight: 600; }
      .dgp-menu-sep { height: .5px; margin: 4px 6px; background: var(--dsw-alias-border-l2); }

      /* ===================== 10. 自适应 ===================== */
      @media (prefers-reduced-motion: reduce) {
        .dgp-spinner { animation-duration: 2.4s; }
        .dgp-skel-dot, .dgp-skel-bar { animation: none; }
        .dgp-caret, .dgp-group-caret, .dgp-divider::after { transition: none; }
      }
      @media (pointer: coarse) {
        .dgp-row, .dgp-group-head { min-height: 40px; }
        .dgp-iconbtn { width: 32px; height: 32px; }
        .dgp-divider::after { inset: 0 -10px; }
        /* 触屏没有悬停，行尾与分组头的按钮必须一直在 */
        .dgp-row-action, .dgp-group-action { opacity: 1; }
      }

      /* ==================================================================
         会话标题栏按钮（conversation.session.header.actions）
         一颗紧凑的图标+文字按钮，尺寸/圆角跟随标题栏控件，深浅色都用令牌取色
         ================================================================== */

      .dgp-headerbtn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 24px;
        padding: 0 8px;
        border: 0;
        border-radius: var(--dsw-radius-xs);
        background: transparent;
        color: var(--dsw-alias-label-secondary, inherit);
        font: inherit;
        font-size: 12px;
        line-height: 1;
        cursor: pointer;
        white-space: nowrap;
        transition: background-color 120ms ease, color 120ms ease;
      }

      .dgp-headerbtn:hover {
        background: var(--dsw-alias-bg-layer-3, rgba(127, 127, 127, 0.12));
        color: var(--dsw-alias-label-primary, inherit);
      }

      .dgp-headerbtn[data-failed="true"] { color: var(--dsw-alias-state-error-primary); }
      .dgp-headerbtn:active {
        background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, 0.18));
      }

      .dgp-headerbtn:focus-visible {
        outline: 2px solid currentColor;
        outline-offset: 1px;
      }

      .dgp-headerbtn[data-busy='true'] { opacity: 0.6; pointer-events: none; }

      .dgp-headerbtn svg { flex: none; }

      .dgp-headerbtn-label { font-size: 12px; }

      /* 标题栏很窄时只留图标，避免挤掉会话标题 */
      @media (max-width: 720px) {
        .dgp-headerbtn-label { display: none; }
        .dgp-headerbtn { padding: 0 6px; }
      }


      /* 插件版本 chip：显示已安装的插件版本，点击 = 检查插件更新（与本仓库的 git 状态无关） */
      .dgp-version {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        height: 26px;
        padding: 0 7px;
        border: 0;
        border-radius: var(--dsw-radius-xs);
        background: transparent;
        color: var(--dsw-alias-label-secondary, inherit);
        font-family: var(--dsw-alias-font-mono, ui-monospace, Menlo, Consolas, monospace);
        font-size: 11px;
        line-height: 1;
        cursor: pointer;
        white-space: nowrap;
      }

      .dgp-version:hover {
        background: var(--dsw-alias-interactive-bg-hover, transparent);
        color: var(--dsw-alias-label-primary, inherit);
      }

      .dgp-version[data-busy='true'] { opacity: .6; pointer-events: none; }
      .dgp-version:disabled { opacity: .45; cursor: default; }
      .dgp-version-text { letter-spacing: .2px; }

      /* 检测更新的结果：贴在版本号按钮左边，不单独占一行；空间不够时自己截断 */
      .dgp-update-note {
        flex: 0 1 auto;
        min-width: 0;
        max-width: 190px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--dsw-alias-label-tertiary);
        font-size: 11px;
        line-height: 16px;
      }
      .dgp-update-note[data-tone="info"] { color: var(--dsw-alias-label-secondary); }
      .dgp-update-note[data-tone="warn"] { color: var(--dsw-alias-state-warn-label); }
      .dgp-update-note[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }


      /* ==================================================================
         文件编辑器（文件模式右栏）：textarea + 行号列 + 脏标记
         ================================================================== */

      .dgp-viewer-editor { display: flex; flex-direction: column; min-height: 0; }

      .dgp-editor {
        display: flex;
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
        font-family: var(--dsw-alias-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
        font-size: var(--dsh-code-font-size, 12px);
        line-height: 1.55;
      }

      .dgp-editor-gutter {
        flex: none;
        overflow: hidden;
        padding: 8px 8px 8px 10px;
        color: var(--dsw-alias-label-tertiary, rgba(127, 127, 127, 0.9));
        text-align: right;
        user-select: none;
      }

      .dgp-editor-ln { height: 1.55em; }

      .dgp-editor-input {
        flex: 1 1 auto;
        min-width: 0;
        margin: 0;
        padding: 8px 12px 8px 10px;
        border: 0;
        outline: none;
        resize: none;
        background: transparent;
        color: var(--dsw-alias-label-primary, inherit);
        font: inherit;
        line-height: inherit;
        tab-size: 2;
        white-space: pre;
        overflow: auto;
        caret-color: var(--dsw-alias-label-primary, currentColor);
      }

      .dgp-editor[data-wrap='true'] .dgp-editor-input { white-space: pre-wrap; word-break: break-word; }

      .dgp-dirty {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        color: var(--dsw-alias-label-warning, currentColor);
        font-size: 11px;
      }

      .dgp-dirty-dot {
        display: inline-block;
        flex: none;
        width: 6px;
        height: 6px;
        margin-left: 6px;
        border-radius: 50%;
        background: currentColor;
      }

      .dgp-editor-saved {
        color: var(--dsw-alias-label-tertiary, rgba(127, 127, 127, 0.9));
        font-size: 11px;
      }

      /* PR 详情根容器：沿用 .dgp-detail 的排布，这里只补标题行更紧凑的间距 */
      .dgp-pull { gap: 8px; }
      /* PR 门禁状态：审查 / 测试 / 合并状态并排一行 */
      .dgp-gate { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
      .dgp-gate-chip {
        padding: 1px 7px;
        border-radius: var(--dsw-radius-xs);
        background: var(--dsw-alias-bg-module-platform);
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
        line-height: 18px;
      }
      .dgp-gate-chip[data-gate="review"][data-state="approved"],
      .dgp-gate-chip[data-gate="test"][data-state="passed"] { color: var(--dsw-alias-state-success-primary); }
      .dgp-gate-chip[data-gate="review"][data-state="changes-requested"] { color: var(--dsw-alias-state-error-primary); }
      .dgp-gate-chip[data-state="unknown"] { color: var(--dsw-alias-label-tertiary); }
      .dgp-ai-error { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .dgp-ai-error > .dgp-detail-failure { margin: 0; }
      .dgp-pull-confirm { display: inline-flex; gap: 6px; align-items: center; }
      /* 有新版本：版本号按钮提示一下 */
      .dgp-version[data-newer="true"] { color: var(--dsw-alias-state-warn-label); }
      .dgp-update-note-link {
        border: 0;
        background: transparent;
        cursor: pointer;
        padding: 0 2px;
        font: inherit;
        color: inherit;
        display: inline-flex;
        align-items: center;
        gap: 3px;
      }
      .dgp-update-note-link:hover { text-decoration: underline; }
      /* 变更页签：当前分支的 PR 状态卡 */
      .dgp-pr-card {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 8px;
        border: 1px solid var(--dsw-alias-border-secondary);
        border-radius: var(--dsw-radius-sm);
        background: var(--dsw-alias-bg-module-platform);
      }
      .dgp-pr-card-head { display: flex; align-items: baseline; gap: 6px; justify-content: space-between; }
      .dgp-pr-card-title { font-size: 12px; font-weight: 500; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dgp-pr-card-status { flex: none; font-size: 11px; color: var(--dsw-alias-label-tertiary); }
      .dgp-pr-card-status[data-status="changes"] { color: var(--dsw-alias-state-warn-label); }
      .dgp-pr-card-status[data-status="approved"] { color: var(--dsw-alias-state-success-primary); }
      .dgp-pr-card-status[data-status="merged"] { color: var(--dsw-alias-state-success-primary); }
      .dgp-pr-card-meta { display: flex; gap: 8px; font-size: 11px; color: var(--dsw-alias-label-tertiary); flex-wrap: wrap; }
      .dgp-pr-card-unread { color: var(--dsw-alias-state-warn-label); }
      .dgp-pr-card-latest { font-size: 11px; color: var(--dsw-alias-label-secondary); }
      .dgp-pr-card-actions { display: flex; justify-content: flex-end; }
      .dgp-comment-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      /* 创建 PR 表单（右侧面板） */
      .dgp-pr-form { display: flex; flex-direction: column; gap: 10px; padding: 4px 2px; overflow-y: auto; }
      .dgp-pr-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .dgp-pr-row > .dgp-settings-label { min-width: 72px; }
      .dgp-pr-row > .dgp-select { min-width: 160px; }
      .dgp-pr-body { width: 100%; resize: vertical; font-family: var(--ds-font-family-code); font-size: 12px; line-height: 1.6; }
      .dgp-commit-pr { flex: none; }
      /* PR 评论：已有对话 + 常驻输入框 */
      .dgp-comment-body {
        margin: 0;
        font-size: 12px;
        line-height: 1.6;
        color: var(--dsw-alias-label-secondary);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .dgp-comment-compose { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
      .dgp-ai-draft {
        margin: 0;
        padding: 8px;
        border-radius: var(--dsw-radius-xs);
        background: var(--dsw-alias-bg-module-platform);
        font-size: 12px;
        line-height: 1.6;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        max-height: 240px;
        overflow-y: auto;
      }
      /* 深度审阅执行步骤：每一步做了什么、耗时、是否失败 */
      .dgp-ai-steps { display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
      .dgp-step-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 1px; }
      .dgp-step {
        display: flex;
        gap: 8px;
        align-items: baseline;
        font-size: 11px;
        line-height: 1.6;
        color: var(--dsw-alias-label-tertiary);
      }
      .dgp-step[data-level="warn"] { color: var(--dsw-alias-state-warn-label); }
      .dgp-step[data-level="error"] { color: var(--dsw-alias-state-error-primary); }
      .dgp-step-time { flex: none; font-family: var(--ds-font-family-code); min-width: 56px; }
      .dgp-step-name { flex: none; color: var(--dsw-alias-label-secondary); }
      .dgp-step-detail { min-width: 0; overflow-wrap: anywhere; }
      /* 深度审阅前的「拉到哪里」确认框 */
      .dgp-ai-clone {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 8px;
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: var(--dsw-radius-sm);
        background: var(--dsw-alias-bg-module-platform);
      }
      .dgp-ai-clone-custom { display: flex; gap: 6px; align-items: center; }
      .dgp-ai-clone-custom > .dgp-input { flex: 1 1 auto; min-width: 0; }
      /* AI 审阅：平台没返回内容的文件 */
      .dgp-ai-skipped { display: flex; flex-direction: column; gap: 2px; }
      .dgp-skipped-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
      .dgp-skipped-item {
        display: flex;
        gap: 8px;
        align-items: baseline;
        font-size: 11px;
      }
      .dgp-skipped-name {
        font-family: var(--ds-font-family-code);
        color: var(--dsw-alias-label-secondary);
        min-width: 0;
      }
      .dgp-skipped-size { flex: none; color: var(--dsw-alias-label-tertiary); }
      /* AI 审阅：总评 + 编号问题清单 + 评论草稿 */
      .dgp-ai-summary {
        margin: 0;
        color: var(--dsw-alias-label-primary);
        font-size: 12px;
        line-height: 1.6;
        white-space: pre-wrap;
      }
      .dgp-findings {
        margin: 6px 0 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .dgp-finding {
        padding: 6px 8px;
        border-radius: var(--dsw-radius-sm);
        background: var(--dsw-alias-bg-module-platform);
        border-left: 2px solid var(--dsw-alias-border-l1);
      }
      .dgp-finding[data-severity="blocker"] { border-left-color: var(--dsw-alias-state-error-primary); }
      .dgp-finding[data-severity="major"] { border-left-color: var(--dsw-alias-state-error-primary); }
      .dgp-finding[data-severity="minor"] { border-left-color: var(--dsw-alias-label-tertiary); }
      .dgp-finding-head { display: flex; align-items: center; gap: 6px; }
      .dgp-finding-no {
        flex: none;
        font-family: var(--ds-font-family-code);
        font-size: 11px;
        color: var(--dsw-alias-label-tertiary);
      }
      .dgp-severity {
        flex: none;
        padding: 0 5px;
        border-radius: var(--dsw-radius-xs);
        font-size: 10px;
        line-height: 15px;
        background: var(--dsw-alias-bg-module-platform);
        color: var(--dsw-alias-label-secondary);
        border: 1px solid var(--dsw-alias-border-l1);
      }
      .dgp-severity[data-severity="blocker"],
      .dgp-severity[data-severity="major"] {
        color: var(--dsw-alias-state-error-primary);
        border-color: var(--dsw-alias-state-error-primary);
      }
      .dgp-finding-title { font-size: 12px; color: var(--dsw-alias-label-primary); }
      .dgp-finding-loc {
        margin-top: 2px;
        font-family: var(--ds-font-family-code);
        font-size: 11px;
        color: var(--dsw-alias-label-tertiary);
      }
      .dgp-finding-detail,
      .dgp-finding-fix {
        margin-top: 3px;
        font-size: 12px;
        line-height: 1.6;
        color: var(--dsw-alias-label-secondary);
        white-space: pre-wrap;
      }
      .dgp-finding-fix { color: var(--dsw-alias-label-primary); }
      .dgp-ai-comment { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
      .dgp-ai-comment-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .dgp-ai-textarea {
        width: 100%;
        /* 高度由内容决定（组件里按行数算），这里只兜住范围与滚动 */
        min-height: 138px;
        max-height: 60vh;
        overflow-y: auto;
        resize: none;
        font-family: var(--ds-font-family-code);
        font-size: 12px;
        line-height: 1.6;
      }

      /* PR 详情：正文与操作区 */
      .dgp-pull-body {
        margin: 0;
        max-height: 240px;
        padding: 8px 10px;
        overflow: auto;
        border-radius: var(--dsw-radius-xs);
        background: var(--dsw-alias-bg-module-platform);
        color: var(--dsw-alias-label-secondary);
        font-family: var(--ds-font-family-code);
        font-size: 11px;
        line-height: 1.6;
        white-space: pre-wrap;
      }
      .dgp-pull-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 4px; }
      .dgp-pull-note { flex: 1 1 200px; min-width: 0; height: 26px; }
      .dgp-pull-method { flex: none; width: 132px; height: 24px; }
      .dgp-pull-check { display: inline-flex; align-items: center; gap: 4px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
      .dgp-pull-verdict {
        flex: none;
        padding: 0 5px;
        border-radius: var(--dsw-radius-xs);
        background: var(--dsw-alias-bg-module-platform);
        color: var(--dsw-alias-label-tertiary);
        font-size: 10px;
        line-height: 15px;
      }
      .dgp-pull-verdict[data-state="APPROVED"] { color: var(--dsw-alias-state-success-primary); }
      .dgp-pull-verdict[data-state="CHANGES_REQUESTED"] { color: var(--dsw-alias-state-error-primary); }
      /* PR 详情 · 变动的文件：一行一个文件，点开就地看 diff（不再跳走或整页刷新） */
      .dgp-pull-files { display: flex; flex-direction: column; gap: 1px; margin: 0; padding: 0; list-style: none; }
      .dgp-pull-file { display: flex; flex-direction: column; min-width: 0; border-radius: var(--dsw-radius-xs); }
      .dgp-pull-file-row {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        min-height: 28px;
        padding: 0 6px;
        border: 0;
        border-radius: var(--dsw-radius-xs);
        background: 0 0;
        color: var(--dsw-alias-label-primary);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .dgp-pull-file-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .dgp-pull-file-row:focus-visible {
        outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
        outline-offset: -2px;
      }
      .dgp-pull-file-name {
        flex: 1 1 auto;
        min-width: 0;
        font-family: var(--ds-font-family-code);
        font-size: 12px;
      }
      .dgp-pull-file-stat { display: inline-flex; flex: none; gap: 6px; font-size: 11px; font-variant-numeric: tabular-nums; }
      .dgp-pull-file-diff {
        display: flex;
        flex-direction: column;
        min-height: 0;
        max-height: 460px;
        margin: 2px 0 6px;
        overflow: hidden;
        border: .5px solid var(--dsw-alias-border-l1);
        border-radius: var(--dsw-radius-xs);
        background: var(--dsw-alias-bg-module-platform);
      }
      .dgp-pull-file-diff > .dgp-viewer { min-height: 0; }
      .dgp-pull-file-diff > .dgp-detail-meta { margin: 8px; }
      .dgp-pull-file-error { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px; }
      .dgp-pull-file-error > .dgp-detail-failure { flex: 1 1 100%; }
      .dgp-detail-notice { margin: 0; color: var(--dsw-alias-state-success-primary); font-size: 11px; }
      /* 「还没推到远端」的提示：变更页签常驻一条 + 创建 PR 表单里阻断用同一条（PushHint）。
         面板自己不做 push，所以必须把命令摆出来；命令用 user-select: all —— 点一下就能整条复制。 */
      .dgp-push-hint {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin: 0 8px 6px;
        padding: 8px 10px;
        border-left: 2px solid var(--dsw-alias-state-warn-label);
        border-radius: var(--dsw-radius-xs);
        background: var(--dsw-alias-bg-module-platform);
      }
      .dgp-push-hint-title { margin: 0; font-size: 11px; font-weight: 600; color: var(--dsw-alias-label-primary); }
      .dgp-push-hint-why { margin: 0; font-size: 11px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
      .dgp-push-hint-after { margin: 0; font-size: 11px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); }
      /* 命令与「推送到远端」按钮同排：按钮是主路径，命令是失败时能照抄排查的退路 */
      .dgp-push-hint-action { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
      .dgp-push-hint-error {
        margin: 0;
        font-size: 11px;
        line-height: 1.6;
        color: var(--dsw-alias-state-error-primary);
        white-space: pre-line;
      }
      .dgp-command {
        align-self: flex-start;
        max-width: 100%;
        padding: 0 6px;
        font-family: var(--ds-font-family-code);
        font-size: 11px;
        line-height: 1.8;
        color: var(--dsw-alias-label-primary);
        background: var(--dsw-alias-bg-module-platform);
        border: 1px solid var(--dsw-alias-border-l1);
        border-radius: var(--dsw-radius-xs);
        user-select: all;
      }
      /* 远端仓库详情（右侧） */
      .dgp-detail { display: flex; flex-direction: column; gap: 10px; min-height: 0; padding: 12px 14px; overflow: auto; }
      .dgp-detail-top { display: flex; align-items: flex-start; gap: 10px; }
      .dgp-detail-name-row { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; }
      .dgp-detail-name { min-width: 0; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
      .dgp-detail-actions { display: flex; flex: none; gap: 6px; }
      .dgp-detail-desc { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.6; }
      .dgp-detail-meta { display: flex; flex-wrap: wrap; gap: 10px; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
      .dgp-detail-failure { margin: 0; color: var(--dsw-alias-state-warn-label); font-size: 11px; }
      /* PR 详情底部的操作失败块：错误说清 + （冲突时）一条去网页解决的出口 */
      .dgp-pull-error {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        margin-top: 2px;
        padding: 8px 10px;
        border-radius: var(--dsw-radius-xs);
        background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
      }
      .dgp-pull-error > .dgp-detail-failure { flex: 1 1 100%; line-height: 1.6; }
      .dgp-detail-section { display: flex; flex-direction: column; gap: 4px; }
      .dgp-detail-head { display: flex; align-items: center; gap: 8px; }
      .dgp-detail-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
      .dgp-detail-count { flex: 1 1 auto; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
      .dgp-detail-empty { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
      .dgp-detail-list { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
      /* 每项两行：标题在上，作者与时间在下；行高放宽，时间不会被省略号吃掉 */
      .dgp-detail-item {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: 3px;
        min-width: 0;
        padding: 7px 8px;
        border-radius: var(--dsw-radius-xs);
      }
      .dgp-detail-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .dgp-detail-link {
        padding: 0;
        border: 0;
        background: 0 0;
        color: var(--dsw-alias-state-business-primary);
        font: inherit;
        font-size: 13px;
        line-height: 1.5;
        text-align: left;
        cursor: pointer;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .dgp-detail-link:hover { text-decoration: underline; }
      .dgp-detail-item > .dgp-detail-meta {
        display: flex;
        flex-wrap: wrap;
        gap: 2px 10px;
        font-size: 11px;
        line-height: 1.6;
        color: var(--dsw-alias-label-tertiary);
      }
      .dgp-detail-item > .dgp-detail-meta > .dgp-detail-author { color: var(--dsw-alias-label-secondary); }
      .dgp-detail-meta { flex: none; }

      /* ── 远端仓库详情 · 分支区（本地/远端/当前/默认/领先落后/上游状态） ── */
      .dgp-branch-section { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .dgp-branch-head { display: flex; align-items: center; gap: 8px; }
      .dgp-branch-title { flex: none; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
      .dgp-branch-summary { flex: 1 1 auto; min-width: 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dgp-branch-head-actions { display: flex; flex: none; gap: 2px; }
      /* 只补高度与收缩规则，边框/底色沿用 .dgp-input */
      .dgp-branch-filter { flex: none; height: 24px; }
      .dgp-branch-status { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
      .dgp-branch-status[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }
      .dgp-branch-status[data-tone="warn"] { color: var(--dsw-alias-state-warn-label); }
      /* 多行状态/错误/提示容器 */
      .dgp-branch-statuses { display: flex; flex-direction: column; gap: 2px; }
      .dgp-branch-list { display: flex; flex-direction: column; gap: 1px; margin: 0; padding: 0; list-style: none; }
      /* 行与行尾「⋯」并排；删除确认整行换到下一行（flex-basis 100%） */
      .dgp-branch-item { display: flex; flex-wrap: wrap; align-items: center; min-width: 0; border-radius: var(--dsw-radius-xs); }
      .dgp-branch-item[data-current="true"] { background: var(--dsw-alias-bg-module-platform); }
      .dgp-branch-item[data-busy="true"] { opacity: .6; }
      .dgp-branch-row {
        display: flex;
        flex: 1 1 auto;
        align-items: center;
        gap: 6px;
        min-width: 0;
        height: 26px;
        padding: 3px 4px;
        border: 0;
        border-radius: var(--dsw-radius-xs);
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .dgp-branch-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .dgp-branch-row:disabled { cursor: default; }
      .dgp-branch-row:disabled:hover { background: transparent; }
      .dgp-branch-row:focus-visible, .dgp-branch-more:focus-visible {
        outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
        outline-offset: -1px;
      }
      .dgp-branch-ico { flex: none; color: var(--dsw-alias-label-tertiary); }
      .dgp-branch-ico[data-current="true"] { color: var(--dsw-alias-state-business-primary); }
      .dgp-branch-name { flex: 1 1 auto; min-width: 0; color: var(--dsw-alias-label-primary); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .dgp-branch-tags { display: flex; flex: none; align-items: center; gap: 3px; }
      .dgp-branch-tag {
        flex: none;
        padding: 0 4px;
        border: 1px solid var(--dsw-alias-border-l2);
        border-radius: var(--dsw-radius-xs);
        color: var(--dsw-alias-label-tertiary);
        font-size: 10px;
        line-height: 15px;
      }
      .dgp-branch-tag[data-active="true"] {
        border-color: var(--dsw-alias-state-business-primary);
        color: var(--dsw-alias-state-business-primary);
      }
      .dgp-branch-track { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
      /* 20×20 图标按钮：视觉同 .dgp-iconbtn，但独立类名便于分支行内定位 */
      .dgp-branch-more {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        padding: 0;
        border: 0;
        border-radius: var(--dsw-radius-xs);
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        line-height: 1;
        cursor: pointer;
      }
      .dgp-branch-more:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
      .dgp-branch-more:disabled { opacity: .4; cursor: default; }
      .dgp-branch-confirm {
        display: flex;
        flex: 1 0 100%;
        flex-direction: column;
        gap: 4px;
        padding: 6px 8px;
        border-radius: var(--dsw-radius-xs);
        background: var(--dsw-alias-bg-module-platform);
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
      }
      .dgp-branch-confirm-actions { display: flex; justify-content: flex-end; gap: 6px; }
      .dgp-branch-confirm-text { color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.5; }
      .dgp-branch-hint { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 1.5; }
      /* 提示分两档：中性（改动计数 / 同名远端）用 tertiary，需要用户换个选择的（进行中 / 撞车）用 warn */
      .dgp-branch-hint[data-tone="warn"] { color: var(--dsw-alias-state-warn-label); }
      .dgp-branch-empty { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; }

      .dgp-remote-item[data-active="true"] { background: var(--dsw-alias-interactive-bg-hover); }

      /* 远端页签顶部的操作提示（例如合并后自动返回） */
      .dgp-remote-notice {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 8px;
        border-radius: var(--dsw-radius-xs);
        background: var(--dsw-alias-bg-module-platform);
        color: var(--dsw-alias-label-secondary);
        font-size: 11px;
      }
      .dgp-remote-notice > .dgp-oneline { flex: 1 1 auto; min-width: 0; }
      /* 未合并 PR 数量：红点角标 */
      .dgp-remote-prcount {
        flex: none;
        min-width: 16px;
        padding: 0 4px;
        border-radius: 999px;
        background: var(--dsw-alias-state-error-primary);
        color: var(--dsw-alias-label-primary-inverted);
        font-family: var(--ds-font-family-code);
        font-size: 10px;
        line-height: 15px;
        text-align: center;
      }
      /* ── 远端页签：账号 chip、仓库列表、行内克隆表单 ── */
      .dgp-remote { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; gap: 6px; padding: 8px 8px 6px; }
      .dgp-remote-head { display: flex; align-items: center; gap: 6px; min-width: 0; }
      .dgp-remote-head-label { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
      .dgp-remote-chip {
        flex: 0 1 auto;
        min-width: 0;
        max-width: 140px;
        padding: 1px 8px;
        border: 0;
        border-radius: var(--dsw-radius-xs);
        background: transparent;
        color: var(--dsw-alias-label-secondary);
        font: inherit;
        font-size: 11px;
        line-height: 20px;
        cursor: pointer;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dgp-remote-chip:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .dgp-remote-chip[data-active="true"] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .dgp-remote-refresh { flex: none; margin-left: auto; }
      .dgp-remote-filter { flex: none; }
      .dgp-remote-item { display: flex; flex-direction: column; gap: 2px; padding: 5px 6px; border-radius: var(--dsw-radius-xs); }
      .dgp-remote-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .dgp-remote-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
      .dgp-remote-name { flex: 1 1 auto; min-width: 0; font-size: 12px; color: var(--dsw-alias-label-primary); }
      .dgp-remote-badge {
        flex: none;
        padding: 0 4px;
        border-radius: var(--dsw-radius-xs);
        background: var(--dsw-alias-bg-module-platform);
        color: var(--dsw-alias-label-tertiary);
        font-size: 10px;
        line-height: 14px;
      }
      .dgp-remote-action { flex: none; }
      .dgp-remote-meta { color: var(--dsw-alias-label-tertiary); font-size: 11px; }
      .dgp-remote-cloneform { display: flex; align-items: center; gap: 6px; padding: 4px 0 2px; }
      .dgp-remote-cloneform-label { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
      .dgp-remote-cloneform-input { flex: 1 1 auto; min-width: 0; height: 24px; }
      .dgp-remote-status { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 11px; }
      .dgp-remote-status[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }
      .dgp-remote-more { align-self: center; margin: 6px 0; }

      /* ── 设置页：账号列表与添加表单 ── */
      /* 空态里的按钮组（例如没账号时的两个平台入口） */
      .dgp-state-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; margin-top: 4px; }
      /* 按钮保持内容宽度：中文标签一旦被压窄就会溢出边框 */
      .dgp-state-actions .dgp-btn { flex: 0 0 auto; white-space: nowrap; }

      /* 远端页签里就地展开的账号表单 */
      .dgp-account-inline {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 6px;
        padding: 8px 10px;
        border-radius: var(--dsw-radius-xs);
        background: var(--dsw-alias-bg-module-platform);
      }
      .dgp-account-inline-head { display: flex; align-items: center; gap: 8px; }
      .dgp-account-inline .dgp-account-form { margin-top: 0; }
      /* 令牌原文：等宽展示，长了横向滚动（复制按钮在它上面） */
      .dgp-account-token {
        overflow-x: auto;
        padding: 4px 6px;
        border-radius: var(--dsw-radius-xs);
        background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary);
        font-family: var(--ds-font-family-code);
        font-size: 11px;
      }
      .dgp-account-form .dgp-btn { flex: 0 0 auto; white-space: nowrap; }
      /* 设置页：获取令牌的三步引导 */
      .dgp-account-guide {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin: 2px 0 6px;
        padding: 8px 10px;
        border-radius: var(--dsw-radius-xs);
        background: var(--dsw-alias-bg-module-platform);
      }
      .dgp-account-guide-head { display: flex; align-items: center; gap: 8px; }
      .dgp-account-guide-title { flex: 1 1 auto; min-width: 0; color: var(--dsw-alias-label-secondary); font-size: 11px; }
      .dgp-account-steps { margin: 0; padding-left: 18px; color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 1.7; }
      .dgp-account-steps li { margin: 0; }
      .dgp-account-list { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
      .dgp-account-item { display: flex; align-items: center; gap: 8px; padding: 3px 6px; border-radius: var(--dsw-radius-xs); }
      .dgp-account-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
      .dgp-account-name { flex: 0 1 auto; min-width: 0; font-size: 12px; }
      .dgp-account-meta { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
      .dgp-account-form { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 4px; }
      .dgp-account-provider { flex: none; width: 110px; }
      .dgp-account-form .dgp-input { flex: 1 1 140px; min-width: 0; height: 28px; }
      `

      function ensureStyles() {
        if (document.getElementById(STYLE_ID) !== null) return
        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = CSS
        document.head.appendChild(style)
      }

      Object.assign(exports, { CSS, ensureStyles });

    });
    __define("./i18n.js", (exports, module) => {
      /**
       * src/i18n.js —— 内联字典
       *
       * DSH 的运行时文案必须内联注册（`ctx.locale.register(NS, { zh, en })`）；
       * 包内 `locale/*.json` 只用于插件管理页的 meta 标题，不参与 UI。
       */

      const NS = 'dshGitPanel'

      const zh = {
        'toolbar.checkUpdates': '检查插件更新',
        'toolbar.openRemote': '打开 Git 仓库',
        'toolbar.refreshNow': '立即刷新',
        'update.currentVersion': '当前 v{version}',
        'update.latestVersion': '最新 v{version}',
        'update.pluginUpToDate': '插件已是最新（v{version}）',
        'update.pluginNewer': '有新版本 v{version}（当前 v{current}）',
        'update.openRelease': '打开 Release 页面',
        'update.checking': '正在检测更新…',
        'update.upToDate': '已是最新（{upstream}）',
        'update.behind': '落后 {count} 个提交（{upstream}）',
        'update.ahead': '本地领先 {count} 个提交（{upstream}）',
        'update.failed': '检查更新失败：{message}',
        'update.noRemote': '这个仓库没有配置远端',
        'update.checkedAt': '检测于 {time}',
        'entry.title': '代码坞',
        'entry.hint': '打开当前会话的代码坞：变更、提交与 Pull Request',
        'entry.failed': '先打开一个会话，再从代码坞打开面板',
        'tab.title': '变更',
        'header.label': '变更',
        'header.title': '打开 Git 变更面板（当前会话所在项目）',
        'guide.title': 'Git 变更与文件浏览',
        'guide.description': '查看项目改动、逐文件 diff，或直接浏览文件树',

        'mode.changes': '变更',
        'mode.files': '文件',
        'mode.remote': '远端',
        'mode.changesHint': '查看工作区改动',
        'mode.filesHint': '浏览项目文件',
        'mode.remoteHint': '浏览账号里的仓库并拉取到项目',

        'editor.save': '保存',
        'editor.saved': '已保存 {time}',
        'editor.unsaved': '未保存',
        'editor.conflict': '文件在磁盘上已被修改，保存会覆盖别人的改动',
        'editor.reload': '重新加载',
        'editor.overwrite': '覆盖保存',
        'toolbar.autoRefreshOn': '自动刷新：开',
        'toolbar.autoRefreshOff': '自动刷新：关',
        'toolbar.viewAsList': '以列表显示',
        'toolbar.viewAsTree': '以树形显示',
        'toolbar.wrap': '自动换行',
        'toolbar.unified': '统一视图',
        'toolbar.wrapUnavailable': '并排视图下不支持自动换行' ,
        'toolbar.split': '并排视图',
        'toolbar.context': '上下文行数',
        'toolbar.ignoreWhitespace': '忽略空白差异',
        'toolbar.more': '更多',
        'toolbar.addRoot': '添加本机目录…',
        'toolbar.removeRoot': '从列表移除「{name}」',
        'toolbar.collapseAll': '全部折叠',
        'toolbar.resize': '拖动调整宽度（←/→ 调 16px）',

        'filter.placeholder': '筛选文件…',
        'filter.clear': '清除筛选',
        'filter.loadedOnly': '只搜索已展开的目录',

        'roots.hiddenShow': '显示已隐藏的仓库（{count}）',
        'roots.statsTitle': '{files} 个文件 · +{adds} −{dels}',
        'roots.statsTitleBinary': '{files} 个文件（含 {binary} 个二进制）· +{adds} −{dels}',
        'roots.hiddenCollapse': '收起已隐藏的仓库',
        'roots.hide': '隐藏「{name}」（只从储存库移除，不影响仓库本身）',
        'roots.unhide': '取消隐藏「{name}」',

        'root.noBranch': '未命名分支',
        'root.addPlaceholder': '输入本机目录的绝对路径，例如 D:\\code\\my-repo',
        'root.pathLabel': '储存库路径',
        'root.pickPath': '选择路径…',
        'root.picking': '正在选择…',
        'root.pickFailed': '选择路径失败：{message}。可重试或手动输入路径。',
        'root.addConfirm': '添加',
        'root.addCancel': '取消',
        'root.addHint': '只识别这一个目录（它自己必须含 .git）：不向上找上级仓库，也不扫描子目录。粘贴「复制为路径」带引号会自动去掉。',

        'branch.hint': '当前分支 {branch} · 点击切换或新建',
        'branch.title': '分支 · {name}',
        'branch.loading': '正在读取分支…',
        'branch.filterPlaceholder': '筛选分支…',
        'branch.noMatch': '没有匹配「{filter}」的分支',
        'branch.localTag': '本地',
        'branch.remoteTag': '远程',
        'branch.trackHint': '本地还没有这个分支，点一下会创建 {ref} 的本地跟踪分支并切换',
        'branch.pull': '拉取当前分支最新代码',
        'branch.pulling': '正在拉取…',
        'branch.pulled': '已拉取到 {head}',
        'branch.hintHidden': '该仓库已隐藏（分支 {branch}）：点开可取消隐藏',
        'branch.fetch': '获取远程更新',
        'branch.fetching': '正在获取远程更新…',
        'branch.upstreamGone': '上游已删除',
        'branch.empty': '这个仓库还没有任何分支',
        'branch.switching': '正在切换到 {name}…',
        'branch.creating': '正在创建并切换到 {name}…',
        'branch.creatingOnly': '正在创建 {name}（不切换）…',
        'branch.create': '创建',
        'branch.createOnly': '只建分支',
        'branch.createOnlyAction': '只建分支（不切换）',
        'branch.createPlaceholder': '新分支名，回车创建并切换',
        'branch.baseLabel': '从',
        'branch.baseHead': '当前分支 {branch}',
        'branch.baseLocalOption': '{name}（本地）',
        'branch.baseRemoteOption': '{ref}（远端）',
        'branch.baseHint': '新分支从哪里开始：默认「当前分支」= 沿用你现在的工作区，未提交的改动会一起带过去；选别的分支 = 从那个分支的最新提交开始',
        'branch.baseNoteClean': '新分支从 {base} 的最新提交开始',
        'branch.baseNoteDirty': '新分支从 {base} 的最新提交开始；你的 {total} 处改动会跟着一起带过去（和它撞上时，插件会先拦下来让你选）',
        'branch.checkoutLabel': '创建后切换',
        'branch.checkoutHint': '创建后立刻切到新分支；不勾选则只建分支引用，工作区一个字节都不动',
        'branch.dirtyHint': '当前 {branch} · {total} 处改动（{staged} 已暂存）',
        'branch.inProgressHint': '{kind}进行中，git 不允许切换分支，只能选「{action}」',
        'branch.progressMerge': '合并',
        'branch.progressRebase': '变基',
        'branch.progressCherryPick': '拣选',
        'branch.progressRevert': '回退',
        'branch.sameRemoteHint': '远端已有 {ref}：要跟踪它，把「从」选成 {ref}',
        'branch.fromHead': '改为从当前分支创建',
        'branch.created': '已创建并切换到 {name}',
        'branch.createdFollow': '已创建并切换到 {name}；{total} 处改动已跟随（未提交）',
        'branch.createdOnly': '已创建 {name}（未切换）；改动仍留在当前分支的工作区里',
        'branch.failed': '失败：{message}',
        'branch.sectionTitle': '分支',
        'branch.summary': '{total} 个 · 本地 {local}',
        'branch.filter': '筛选分支…',
        'branch.loadFailed': '读取分支失败：{message}',
        'branch.emptyRemote': '远端没有分支',
        'branch.truncated': '远端分支较多，只显示前 {count} 个',
        'branch.notCloned': '本地没有这个仓库：可以查看和删除远端分支，拉取到项目后才能切换',
        'branch.localRepo': '{name} 已克隆到项目',
        'branch.refreshing': '正在刷新分支…',
        'branch.fetchingDone': '已获取远程更新',
        'branch.currentTag': '当前',
        'branch.defaultTag': '默认',
        'branch.protectedTag': '受保护',
        'branch.remoteUpdated': '远端有新提交',
        'branch.aheadBehind': '↑{ahead} ↓{behind}',
        'branch.switchTo': '切换到此分支',
        'branch.switched': '已切换到 {name}',
        'branch.track': '创建本地跟踪分支',
        'branch.tracked': '已创建本地分支 {name}',
        'branch.copy': '复制分支名',
        'branch.copied': '已复制 {name}',
        'branch.openWeb': '在浏览器打开',
        'branch.more': '更多操作',
        'branch.deleteLocal': '删除本地分支',
        'branch.deleteRemote': '删除远端分支',
        'branch.deleteLocalConfirm': '删除本地分支 {name}？未合并的提交会丢。',
        'branch.deleteRemoteConfirm': '删除远端分支 {name}？会真的从平台上删掉，其他人就拉取不到这个分支了。',
        'branch.deleteRun': '删除',
        'branch.deleteForce': '强制删除（有未合并提交）',
        'branch.deleting': '正在删除 {name}…',
        'branch.deletedLocal': '已删除本地分支 {name}',
        'branch.deletedRemote': '已删除远端分支 {name}',
        'branch.currentNoDelete': '当前分支不能删除',
        'branch.defaultNoDelete': '默认分支不能删除',
        'branch.protectedNoDelete': '受保护的分支不能删除',
        'branch.noLocalOps': '本地没有这个仓库，无法执行这个操作',
        'branch.notLocal': '本地没有',
        'branch.remoteUnknown': '远端未知',
        'branch.notOnRemote': '远端没有这个分支',
        'pull.loading': '正在读取 PR #{number}…',
        'pull.failed': '读取 PR 失败',
        'pull.back': '返回仓库',
        'pull.review': '审查',
        'pull.reviewCount': '{count} 条审查记录',
        'pull.reviewUnsupported': '该平台不提供审查记录接口',
        'pull.reviewsUnavailable': '审查记录读取失败：{message}',
        'pull.approve': '通过',
        'pull.requestChanges': '请求修改',
        'pull.comment': '评论',
        'pull.notePlaceholder': '说明（请求修改时必填）',
        'pull.merge': '合并',
        'pull.mergeable': '可以合并',
        'pull.notMergeable': '当前不可合并（冲突或缺少审查）',
        'pull.mergeableUnknown': '平台还在计算能否合并，可以直接尝试',
        'pull.method.merge': '普通合并',
        'pull.method.squash': '压缩为一个提交',
        'pull.method.rebase': '变基合并',
        'pull.deleteBranch': '合并后删除分支 {branch}',
        'settings.reviewModelLabel': 'AI 审阅模型',
        'settings.reviewModelHint': '用于审阅 PR 的模型；建议选能力更强的，审阅比写提交说明难得多。两个模型互不影响。',
        'pull.aiTitle': 'AI 审阅',
        'pull.aiCloneTitle': '本地没有 {repo} 的克隆：要拉到哪里？',
        'pull.aiCloneHint': '拉到项目工作区后，「变更」里也能直接看到它；也可以指定任意目录方便自己调试。',
        'pull.aiCloneWorkspace': '克隆到项目工作区',
        'pull.aiCloneCustom': '克隆到指定目录',
        'pull.aiClonePlaceholder': '输入本机绝对路径，例如 D:\\code\\repo',
        'pull.aiCloneNoPath': '请先填一个绝对路径',
        'pull.aiDeepRun': '深度审阅',
        'pull.aiDeepHint': '把 PR 切到你本机工作区分支，并在新会话里用 Agent 工具审阅（更慢，但能看上下文、能追问、能跑测试）',
        'pull.sessionReviewStarted': '已在新会话中开始深度审阅（{id}），可直接在那里追问或让它继续跑测试。',
        'pull.aiPreparing': '正在准备本地代码：查找仓库、切换分支（已在该提交上会跳过拉取）…',
        'pull.aiReviewing': '正在读取完整文件并审阅…',
        'pull.aiFilesTruncated': '这个 PR 的文件数量超过平台单次上限，文件清单不完整：可能有改动未被审阅。',
        'pull.aiStepsTitle': '执行步骤',
        'pull.aiLogHint': '完整日志：{path}',
        'pull.aiStart': '开始审阅',
        'pull.aiOpenSettings': '去设置模型',
        'pull.aiRerun': '重新审阅',
        'pull.aiRunning': '正在读取 diff 并审阅，可能需要十几秒…',
        'pull.aiSkippedTitle': '有 {count} 个文件平台没有返回内容（二进制或改动过大），这些没有被审阅：',
        'pull.aiSkippedHint': '想让它也被审到，可以把这个文件拆小、把生成物/二进制移出版本库，或分成多个 PR。',
        'pull.aiTruncated': '改动太大，只把前一部分发给了模型：结论可能不完整。',
        'pull.aiNoFindings': '没有发现需要调整的问题。',
        'pull.aiSuggestion': '建议：',
        'pull.aiVerdict.approve': '建议通过',
        'pull.aiVerdict.comment': '有建议',
        'pull.aiVerdict.request-changes': '建议修改后再合',
        'pull.severity.blocker': '阻断',
        'pull.severity.major': '重要',
        'pull.severity.minor': '次要',
        'pull.severity.nit': '细节',
        'pull.commitsTitle': '提交',
        'pull.commitsLimited': '只列出最近 {shown} / {total} 个提交',
        'pull.closeRun': '关闭 PR',
        'pull.closeConfirm': '确认关闭',
        'pull.reopenRun': '重新打开',
        'pull.closedNotice': 'PR 已关闭',
        'pull.reopenedNotice': 'PR 已重新打开',
        'pull.commentsTitle': '评论',
        'pull.commentsEmpty': '还没有评论：在下面写一条给对方留言。',
        'pull.commentPlaceholder': '写给作者的话（支持 Markdown）：确认无误再点发表评论',
        'pull.commentFilled': '已填入评论框，可继续编辑',
        'pull.aiFillComment': '填入评论框',
        'pull.aiCommentLabel': '评论草稿',
        'pull.aiCommentPlaceholder': 'AI 起草，可直接编辑；确认无误再点「提交评论」',
        'pull.aiCommentSubmit': '提交评论',
        'pull.aiCommentSubmitting': '正在提交…',
        'pull.aiCommentDone': '评论已提交',
        'pull.gateReview': '审查',
        'pull.gateTest': '测试',
        'pull.gateMergeState': '合并状态',
        'pull.gateReviewPassed': '已通过',
        'pull.gateReviewChanges': '有人要求修改',
        'pull.gateReviewPending': '等待审查',
        'pull.gateTestPassed': '已通过',
        'pull.gateTestPending': '未通过',
        'pull.gateUnknown': '平台未提供',
        'pull.passAll': '一键通过（审查 + 测试）',
        'pull.passReviewOnly': '通过审查',
        'pull.passAllHint': '按平台能力依次执行：能审查就审查，能标记测试就标记测试',
        'pull.passDone': '已通过：{steps}',
        'pull.testRun': '标记测试通过',
        'pull.testHint': '部分仓库要求 PR 测试通过才允许合并',
        'pull.testDone': '已标记测试通过',
        'pull.passPartial': '已完成：{steps}；没做成：{failures}',
        'pull.conflict': '这个 PR 和目标分支有冲突：{message}',
        'pull.conflictOpenWeb': '到网页上解决冲突',
        'pull.mergeRun': '合并 PR',
        'pull.mergeConfirm': '确认合并（可能删除源分支）',
        'pull.merging': '正在合并…',
        'pull.working': '正在提交…',
        'pull.merged': '已合并',
        'pull.reviewDone': '已提交审查（{verdict}）',
        'pull.mergedDone': '已合并，源分支 {branch}',
        'pull.mergedButBranchKept': '已合并（{branch}），但删源分支失败：{message}',
        'pull.mergedClosed': '已合并 PR #{number}（{branch}），已返回仓库详情',
        'pull.filesChanged': '{count} 个文件',
        'pull.filesTitle': '变动的文件',
        'pull.filesEmpty': '这个 PR 没有改动文件。',
        'pull.filesUnavailable': '读取文件列表失败：{message}',
        'pull.filesTruncated': '文件较多，平台只返回了前 {count} 个：可能还有未列出的改动。',
        'pull.fileDiffLoading': '正在读取这个文件的 diff…',
        'pull.fileDiffFailed': '读取这个文件的 diff 失败',
        'pull.fileDiffUnsupported': '当前面板不支持读取单个文件的 diff',
        'pull.commits': '{count} 个提交',
        'pull.state.open': '打开',
        'pull.state.closed': '已关闭',
        'pull.state.merged': '已合并',
        'pull.state.unknown': '状态未知',
        'detail.pickRepo': '从左侧选一个仓库',
        'detail.pickRepoHint': '右侧会显示它的分支、Issues 与 PR',
        'detail.loading': '正在读取 {name}…',
        'detail.failed': '读取仓库详情失败',
        'detail.created': '创建 {time}',
        'detail.updated': '更新 {time}',
        'detail.issues': 'Issues',
        'detail.pulls': 'Pull Requests',
        'detail.countOf': '{count} 个未关闭',
        'detail.countUnknown': '数量未知',
        'detail.openOnWeb': '打开',
        'detail.noIssues': '没有未关闭的 issue',
        'detail.noPulls': '没有未合并的 PR',
        'detail.sizeKb': '{size} KB',
        'detail.defaultBranch': '默认分支 {name}',
        'detail.stars': '★ {count}',
        'detail.forks': '⑂ {count}',
        'detail.sectionFailed': '{section} 读取失败：{message}',
        'remote.openPulls': '{count} 个未合并的 PR',
        'remote.title': '账号与仓库',
        'remote.addAccount': '添加账号',
        'remote.addAccountOn': '添加 {provider} 账号',
        'remote.noAccounts': '还没有添加代码托管账号',
        'remote.noAccountsHint': '点「添加账号」选平台、粘贴一个只读 token 即可，不用离开这个页签',
        'remote.openSettings': '去设置',
        'remote.loading': '正在读取仓库…',
        'remote.failed': '读取失败：{message}',
        'remote.failedTitle': '读取失败',
        'remote.empty': '这个账号下没有仓库',
        'remote.loadMore': '加载更多',
        'remote.private': '私有',
        'remote.clone': '拉取',
        'remote.cloneTitle': '把这个仓库拉到项目里',
        'remote.cloneFolder': '目标文件夹名',
        'remote.cloneConfirm': '拉取到项目',
        'remote.cloneCancel': '取消',
        'remote.cloning': '正在拉取… {seconds}s',
        'remote.cloned': '已拉取到 {path}',
        'remote.filter': '筛选仓库…',
        'remote.refresh': '重新读取',
        'remote.account': '账号',
        'remote.updatedAt': '更新于 {time}',
        'remote.openWeb': '在浏览器打开',
        'remote.cloneTargetTitle': '拉取到项目目录',
        'remote.cloneTargetDesc': '仓库会被克隆到 {path} 下的子文件夹',
        'roots.title': '储存库',

        'group.conflicted': '冲突',
        'group.staged': '已暂存',
        'group.unstaged': '未暂存',
        'group.untracked': '未跟踪',
        'group.count': '{count}',
        'row.stage': '暂存',
        'row.unstage': '取消暂存',
        'group.stageAll': '暂存全部',
        'group.unstageAll': '取消全部暂存',

        'commit.placeholder': '提交说明',
        'prCard.retry': '重试',
        'prCard.refresh': '刷新状态',
        'prCard.unread': '{count} 条新反馈',
        'prCard.latest': '最近评论（{author}）：',
        'prCard.open': '查看 PR',
        'prCard.status.waiting': '等待评审',
        'prCard.status.changes': '需要修改',
        'prCard.status.approved': '可以合并',
        'prCard.status.merged': '已合并',
        'prCard.status.closed': '已关闭',
        'pull.commentAi': '让 AI 处理',
        'pull.commentAiBusy': '准备会话…',
        'pull.commentAiStarted': '已新建会话 #{id}：先判断这条意见是否成立，再决定改不改；不会自动提交或推送。',
        'pr.open': '创建 PR',
        'pr.title': '创建 PR',
        'pr.loading': '正在读取仓库与分支信息…',
        'pr.repo': '仓库',
        'pr.account': '账号',
        'pr.head': '源分支',
        'pr.base': '目标分支',
        'pr.baseHint': '记住上次选择，下次默认用它',
        'sync.neverTitle': '这条分支还只在你电脑上',
        'sync.aheadTitle': '本地还有 {count} 个提交没推到远端',
        'sync.pushWhy': '远端没有它的最新提交：别人看不到你的改动，也没法在平台上开 PR。',
        'sync.pushRun': '推送到远端',
        'sync.pushing': '正在推送…',
        'sync.pushed': '已推送 {branch}',
        'sync.pushCommand': 'git push -u origin {branch}',
        'sync.pushAfter': '推完这里会自动消失；以后有了新提交，再点一次推送就行。',
        'sync.deletedTitle': '远端分支已被删除（本地还留着 {branch}）',
        'sync.deletedWhy': 'origin 上已经没有这条分支了，通常是 PR 合并后自动删掉的。不要在这里继续推送 —— 那会把已合并的分支重新建出来。',
        'sync.cleanupRun': '收尾：切到默认分支并删除本地分支',
        'sync.cleaning': '正在收尾…',
        'sync.cleaned': '已收尾：切到 {base}，并删除本地分支 {branch}',
        'sync.deletedAfter': '收尾会先取远程更新、切回默认分支，再删掉这条本地分支；如果它还有没合并的提交，会拒绝删除并告诉你。',
        'sync.deletedNext': '要接着改：从最新默认分支新建一个分支，别在这条已合并的分支上提交。',
        'sync.prBlockedPush': '分支还没和远端同步：先在左侧推送，再创建 PR',
        'sync.prBlockedDeleted': '远端分支已被删除：先在左侧「收尾」，再从默认分支新建分支',
        'pr.subject': '标题与描述',
        'pr.generate': '生成标题与描述',
        'pr.generating': '正在生成…',
        'pr.generated': '已根据 {count} 个提交生成，可继续修改',
        'pr.titlePlaceholder': 'PR 标题',
        'pr.bodyPlaceholder': 'PR 描述（Markdown）',
        'pr.create': '创建 PR',
        'pr.creating': '正在创建…',
        'pr.cancel': '取消',
        'pr.done': '完成',
        'pr.openCreated': '打开 PR',
        'pr.createdTitle': 'PR #{number} 已创建',
        'commit.submit': '提交',
        'commit.submitting': '正在提交…',
        'commit.generate': '生成提交说明',
        'commit.regenerate': '重新生成提交说明',
        'commit.generating': '正在生成提交说明…',
        'commit.generatingElapsed': '正在生成… {seconds}s',
        'commit.done': '已提交 {head}',
        'commit.doneSubject': '已提交 {head} · {subject}',
        'commit.hintNoChanges': '没有可提交的改动',
        'commit.hintNoMessage': '填写提交说明后提交',
        'commit.hintStageAll': '没有已暂存的改动，提交时会先暂存全部',
        'commit.noModel': '还没有配置生成提交说明的模型，先到右上角的设置里选一个',
        'commit.nothing': '没有可提交的改动',
        'commit.unmerged': '有未解决的冲突，先把冲突解决掉再提交',
        'commit.openSettings': '去设置换模型',

        'accounts.guideTitle': '怎么拿到令牌',
        'accounts.guideGithub1': '点右上角「获取令牌」，会打开已预填 repo 的令牌创建页',
        'accounts.guideGithub2': '只需要浏览公开仓库的话，public_repo 就够；组织仓库还需要 SSO 授权',
        'accounts.guideGithub3': '生成后复制整串令牌（ghp_ 或 github_pat_ 开头），粘贴到输入框',
        'accounts.guideGitee1': '点右上角「获取令牌」，打开私人令牌页后点「生成新令牌」',
        'accounts.guideGitee2': '勾选 projects（读取仓库列表足够）',
        'accounts.guideGitee3': '生成后复制令牌，粘贴到输入框',
        'accounts.getToken': '获取令牌',
        'accounts.openedPage': '已在浏览器打开，生成后复制粘贴到下面（回车提交）',
        'accounts.blockedPage': '浏览器拦截了新窗口，请手动打开这个地址：',
        'accounts.openTokenPage': '打开令牌页面',
        'accounts.tokenPlaceholder': '粘贴访问令牌',
        'accounts.success': '已连接：{login}',
        'accounts.verifyHint': '添加时会先用这个令牌调一次 /user 验证，失败不会保存',
        'accounts.title': '代码托管账号',
        'accounts.hint': 'token 存在 DSH 凭据服务里，本插件不保存明文；只需要只读权限即可列出仓库',
        'accounts.provider': '平台',
        'accounts.label': '备注名（可选）',
        'accounts.token': '访问令牌',
        'accounts.add': '添加账号',
        'accounts.adding': '正在验证令牌…',
        'accounts.edit': '编辑账号 {name}',
        'accounts.saveLabel': '保存',
        'accounts.saving': '正在保存…',
        'accounts.editLabel': '备注名',
        'accounts.tokenLabel': '令牌',
        'accounts.reveal': '显示令牌',
        'accounts.hide': '隐藏',
        'accounts.copy': '复制令牌',
        'accounts.copied': '已复制到剪贴板',
        'accounts.copyFailed': '无法访问剪贴板，令牌已展开，可手动选中复制',
        'accounts.tokenReplaceHint': '留空表示不改；要换令牌就粘贴新的（会先验证）',
        'accounts.tokenMismatch': '令牌与账号不符',
        'accounts.updated': '已保存',
        'accounts.remove': '移除账号 {name}',
        'accounts.empty': '还没有账号',
        'accounts.failed': '添加失败：{message}',
        'accounts.noCredentials': '当前 DSH 组合没有凭据服务，无法保存账号令牌',
        'settings.title': '设置',
        'settings.back': '返回',
        'settings.open': '设置',
        'settings.untrackedLabel': '未跟踪文件的分组',
        'settings.untrackedMerge': '并进「未暂存」（与 VS Code 一致）',
        'settings.untrackedSeparate': '单列「未跟踪」组',
        'settings.postPushLabel': '提交后自动推送',
        'settings.postPushOn': '开（默认）',
        'settings.postPushOff': '关',
        'settings.postPushHint': '提交成功就把当前分支推到 origin。推送失败不会影响这次提交，原因显示在变更页签的提示条里。',
        'settings.viewLabel': '变更文件的显示方式',
        'settings.viewList': '列表：一行一个文件，文件名在前、路径在后',
        'settings.viewTree': '树形：按文件夹展开/折叠',
        'settings.modelLabel': '生成提交说明的模型',
        'settings.modelHint': '模型来自 DeepSeek Harness 当前配置的模型目录。',
        'settings.modelNone': '未选择',
        'settings.commitThinkingLabel': '提交说明思考模式',
        'settings.thinkingOff': '关闭（默认）',
        'settings.thinkingOn': '开启',
        'settings.commitThinkingHint': '开启后按所选档位思考，可能增加生成时间和用量。',
        'settings.thinkingUnsupported': '该模型未提供可选的思考档位。',
        'settings.thinkingRequired': '该模型不支持关闭思考；需要关闭时请选择支持关闭的模型。',
        'settings.thinkingSelectModel': '请先选择生成提交说明的模型。',
        'settings.commitEffortLabel': '思考档位',
        'settings.effortDefault': '模型默认',
        'settings.saved': '已保存',
        'settings.noLlm': '当前 profile 没有挂载 LLM 服务，无法列出模型',
        'settings.partialModels': '这些 provider 读取失败：{list}',
        'settings.unknownModel': '所选模型不在目录里',
        'settings.loading': '正在读取…',

        'status.clean': '工作区干净',
        'status.cleanHint': '当前仓库没有未提交的改动',
        'status.loading': '正在读取…',
        'status.loadingDiff': '正在生成差异…',
        'status.notRepo': '当前目录不是 Git 仓库',
        'status.notRepoHint': '可以点右上角「添加外部仓库」，或切换到其它根。',
        'status.noSession': '当前没有可用的会话',
        'status.noCwd': '这个会话还没有工作目录',
        'status.noRoots': '没有找到 Git 仓库',
        'status.noRootsHint': '这个项目里没有 Git 仓库。可以手动添加一个外部仓库作为工作区。',
        'status.truncated': '结果过多，只显示了一部分',
        'status.discovering': '正在查找仓库…',
        'status.emptyFilter': '没有匹配「{filter}」的文件',
        'status.emptyDir': '这个目录是空的',

        'viewer.placeholder': '选择左侧的文件查看内容',
        'viewer.placeholderDiff': '选择左侧的改动查看 diff',
        'viewer.binary': '二进制文件，无法以文本显示',
        'viewer.oversized': '文件过大，未加载内容',
        'viewer.missing': '文件不存在或已被删除',
        'viewer.directory': '这是一个目录',
        'viewer.submodule': '这是子模块指针变更，内部改动请进入子仓库查看',
        'viewer.renameOnly': '只有重命名，内容没有变化',
        'viewer.oldPath': '由 {path} 重命名而来',
        'viewer.newFile': '新增文件',
        'viewer.deletedFile': '已删除文件',
        'viewer.lines': '{count} 行',
        'viewer.adds': '+{count}',
        'viewer.dels': '−{count}',
        'viewer.truncated': '内容过长，已省略部分行',
        'viewer.noChanges': '这个文件在此侧没有内容差异',
        'viewer.expandAll': '展开全部',
        'action.retry': '重试',
        'action.cancel': '取消',
        'action.close': '关闭',

        'error.gitMissing': '系统里找不到 git，可执行文件缺失',
        'error.notRepository': '这个目录不是 Git 仓库',
        'error.timeout': '操作超时',
        'error.outsideRoot': '路径超出仓库范围',
        'error.openFailed': '无法打开链接（浏览器拦截或环境不支持）：{url}',
        'error.generic': '出错了：{message}',
        'error.modelFailed': '模型调用失败：{message}',
        /** 面板渲染期异常（插件的 bug）：标题一句话，异常原文由边界作为描述传进来。 */
        'error.panelCrashed': '面板渲染失败'
      }

      const en = {
        'toolbar.checkUpdates': 'Check plugin updates',
        'toolbar.openRemote': 'Open Git repository',
        'toolbar.refreshNow': 'Refresh now',
        'update.currentVersion': 'Current v{version}',
        'update.latestVersion': 'Latest v{version}',
        'update.pluginUpToDate': 'Plugin is up to date (v{version})',
        'update.pluginNewer': 'New version v{version} available (current v{current})',
        'update.openRelease': 'Open release page',
        'update.checking': 'Checking for updates…',
        'update.upToDate': 'Up to date ({upstream})',
        'update.behind': '{count} commits behind ({upstream})',
        'update.ahead': '{count} commits ahead ({upstream})',
        'update.failed': 'Update check failed: {message}',
        'update.noRemote': 'This repository has no remote configured',
        'update.checkedAt': 'Checked at {time}',
        'entry.title': 'Code Dock',
        'entry.hint': 'Open the Code Dock for this conversation: changes, commits and pull requests',
        'entry.failed': 'Open a conversation first, then open the Code Dock',
        'tab.title': 'Changes',
        'header.label': 'Changes',
        'header.title': "Open Git changes for this session's project",
        'guide.title': 'Git changes & file browser',
        'guide.description': 'Review changes with per-file diffs, or browse the project tree',

        'mode.changes': 'Changes',
        'mode.files': 'Files',
        'mode.remote': 'Remote',
        'mode.changesHint': 'Review working tree changes',
        'mode.filesHint': 'Browse project files',
        'mode.remoteHint': 'Browse repositories on your accounts and clone one',

        'editor.save': 'Save',
        'editor.saved': 'Saved {time}',
        'editor.unsaved': 'Unsaved',
        'editor.conflict': 'This file changed on disk; saving would overwrite those changes',
        'editor.reload': 'Reload',
        'editor.overwrite': 'Overwrite',
        'toolbar.autoRefreshOn': 'Auto refresh: on',
        'toolbar.autoRefreshOff': 'Auto refresh: off',
        'toolbar.viewAsList': 'View as list',
        'toolbar.viewAsTree': 'View as tree',
        'toolbar.wrap': 'Wrap lines',
        'toolbar.unified': 'Unified view',
        'toolbar.wrapUnavailable': 'Wrapping is off in split view',
        'toolbar.split': 'Split view',
        'toolbar.context': 'Context lines',
        'toolbar.ignoreWhitespace': 'Ignore whitespace',
        'toolbar.more': 'More',
        'toolbar.addRoot': 'Add a local folder…',
        'toolbar.removeRoot': 'Remove "{name}" from list',
        'toolbar.collapseAll': 'Collapse all',
        'toolbar.resize': 'Drag to resize (←/→ moves 16px)',

        'filter.placeholder': 'Filter files…',
        'filter.clear': 'Clear filter',
        'filter.loadedOnly': 'Only loaded folders are searched',

        'roots.hiddenShow': 'Show hidden repositories ({count})',
        'roots.statsTitle': '{files} files · +{adds} −{dels}',
        'roots.statsTitleBinary': '{files} files ({binary} binary) · +{adds} −{dels}',
        'roots.hiddenCollapse': 'Collapse hidden repositories',
        'roots.hide': 'Hide "{name}" (only from the repository list)',
        'roots.unhide': 'Unhide "{name}"',

        'root.noBranch': 'no branch',
        'root.addPlaceholder': 'Absolute path of a folder, e.g. D:\\code\\my-repo',
        'root.pathLabel': 'Repository path',
        'root.pickPath': 'Browse…',
        'root.picking': 'Choosing…',
        'root.pickFailed': 'Could not choose a folder: {message}. Retry or enter the path manually.',
        'root.addConfirm': 'Add',
        'root.addCancel': 'Cancel',
        'root.addHint': 'Only this folder is used (it must contain .git). No parent lookup, no scanning inside it. Pasted quotes are stripped.',

        'branch.hint': 'On {branch} · click to switch or create',
        'branch.title': 'Branches · {name}',
        'branch.loading': 'Loading branches…',
        'branch.filterPlaceholder': 'Filter branches…',
        'branch.noMatch': 'No branch matches "{filter}"',
        'branch.localTag': 'local',
        'branch.remoteTag': 'remote',
        'branch.trackHint': 'No local branch yet — clicking creates a local tracking branch for {ref}',
        'branch.pull': 'Pull latest for current branch',
        'branch.pulling': 'Pulling…',
        'branch.pulled': 'Pulled to {head}',
        'branch.hintHidden': 'Hidden repository (branch {branch}): open to unhide',
        'branch.fetch': 'Fetch remote updates',
        'branch.fetching': 'Fetching…',
        'branch.upstreamGone': 'upstream gone',
        'branch.empty': 'This repository has no branches yet',
        'branch.switching': 'Switching to {name}…',
        'branch.creating': 'Creating and switching to {name}…',
        'branch.creatingOnly': 'Creating {name} (no switch)…',
        'branch.create': 'Create',
        'branch.createOnly': 'Create only',
        'branch.createOnlyAction': 'Create only (no switch)',
        'branch.createPlaceholder': 'New branch name, Enter to create and switch',
        'branch.baseLabel': 'From',
        'branch.baseHead': 'Current branch {branch}',
        'branch.baseLocalOption': '{name} (local)',
        'branch.baseRemoteOption': '{ref} (remote)',
        'branch.baseHint': 'Where the new branch starts: "current branch" keeps your worktree as-is and carries uncommitted changes along; another branch starts from that branch\u2019s latest commit',
        'branch.baseNoteClean': 'The new branch starts at the latest commit of {base}',
        'branch.baseNoteDirty': 'The new branch starts at the latest commit of {base}; your {total} changes come along (if they collide, the panel asks you first)',
        'branch.checkoutLabel': 'Switch after create',
        'branch.checkoutHint': 'Switch to the new branch right away; unchecked creates only the ref and leaves the worktree untouched',
        'branch.dirtyHint': 'On {branch} · {total} changed ({staged} staged)',
        'branch.inProgressHint': '{kind} in progress — git will not switch branches; "{action}" is the only option',
        'branch.progressMerge': 'Merge',
        'branch.progressRebase': 'Rebase',
        'branch.progressCherryPick': 'Cherry-pick',
        'branch.progressRevert': 'Revert',
        'branch.sameRemoteHint': 'The remote already has {ref}: pick {ref} under "From" to track it',
        'branch.fromHead': 'Create from current branch',
        'branch.created': 'Created and switched to {name}',
        'branch.createdFollow': 'Created and switched to {name}; {total} changed carried over (not committed)',
        'branch.createdOnly': 'Created {name} (not switched); your changes stay in the current worktree',
        'branch.failed': 'Failed: {message}',
        'branch.sectionTitle': 'Branches',
        'branch.summary': '{total} total · {local} local',
        'branch.filter': 'Filter branches…',
        'branch.loadFailed': 'Could not load branches: {message}',
        'branch.emptyRemote': 'No branches on the remote',
        'branch.truncated': 'Showing the first {count} remote branches',
        'branch.notCloned': 'Not cloned locally: you can inspect and delete remote branches; clone it to the project to switch',
        'branch.localRepo': '{name} is cloned into the project',
        'branch.refreshing': 'Refreshing branches…',
        'branch.fetchingDone': 'Fetched remote updates',
        'branch.currentTag': 'current',
        'branch.defaultTag': 'default',
        'branch.protectedTag': 'protected',
        'branch.remoteUpdated': 'remote has newer commits',
        'branch.aheadBehind': '↑{ahead} ↓{behind}',
        'branch.switchTo': 'Switch to this branch',
        'branch.switched': 'Switched to {name}',
        'branch.track': 'Create local tracking branch',
        'branch.tracked': 'Created local branch {name}',
        'branch.copy': 'Copy branch name',
        'branch.copied': 'Copied {name}',
        'branch.openWeb': 'Open in browser',
        'branch.more': 'More actions',
        'branch.deleteLocal': 'Delete local branch',
        'branch.deleteRemote': 'Delete remote branch',
        'branch.deleteLocalConfirm': 'Delete local branch {name}? Unmerged commits will be lost.',
        'branch.deleteRemoteConfirm': 'Delete remote branch {name}? It is really deleted on the remote, so others can no longer fetch it.',
        'branch.deleteRun': 'Delete',
        'branch.deleteForce': 'Force delete (unmerged commits)',
        'branch.deleting': 'Deleting {name}…',
        'branch.deletedLocal': 'Deleted local branch {name}',
        'branch.deletedRemote': 'Deleted remote branch {name}',
        'branch.currentNoDelete': 'The current branch cannot be deleted',
        'branch.defaultNoDelete': 'The default branch cannot be deleted',
        'branch.protectedNoDelete': 'Protected branches cannot be deleted',
        'branch.noLocalOps': 'Not cloned locally: this action needs a local repository',
        'branch.notLocal': 'no local',
        'branch.remoteUnknown': 'remote unknown',
        'branch.notOnRemote': 'not on the remote',
        'pull.loading': 'Loading pull request #{number}…',
        'pull.failed': 'Could not load the pull request',
        'pull.back': 'Back to repository',
        'pull.review': 'Review',
        'pull.reviewCount': '{count} reviews',
        'pull.reviewUnsupported': 'This platform exposes no review list',
        'pull.reviewsUnavailable': 'Could not load reviews: {message}',
        'pull.approve': 'Approve',
        'pull.requestChanges': 'Request changes',
        'pull.comment': 'Comment',
        'pull.notePlaceholder': 'Note (required when requesting changes)',
        'pull.merge': 'Merge',
        'pull.mergeable': 'Ready to merge',
        'pull.notMergeable': 'Not mergeable right now (conflicts or missing reviews)',
        'pull.mergeableUnknown': 'Mergeability still being computed — you can try merging',
        'pull.method.merge': 'Merge commit',
        'pull.method.squash': 'Squash and merge',
        'pull.method.rebase': 'Rebase and merge',
        'pull.deleteBranch': 'Delete branch {branch} after merging',
        'settings.reviewModelLabel': 'AI review model',
        'settings.reviewModelHint': 'Model used to review PRs; pick a stronger one — reviewing is harder than writing a commit message. The two models are independent.',
        'pull.aiTitle': 'AI review',
        'pull.aiCloneTitle': 'No local clone of {repo} — where should it go?',
        'pull.aiCloneHint': 'Cloning into the project workspace also makes it show up in Changes; you can also pick any folder you like.',
        'pull.aiCloneWorkspace': 'Clone into workspace',
        'pull.aiCloneCustom': 'Clone into folder',
        'pull.aiClonePlaceholder': 'Absolute path, e.g. D:\\code\\repo',
        'pull.aiCloneNoPath': 'Enter an absolute path first',
        'pull.aiDeepRun': 'Deep review',
        'pull.aiDeepHint': 'Switch the PR branch in your local workspace and review it in a new Agent session (slower, but sees context, can follow up and run tests)',
        'pull.sessionReviewStarted': 'Deep review started in a new session ({id}); follow up there or ask it to run tests.',
        'pull.aiPreparing': 'Preparing local code: locating the repo and switching branches (skips fetching if already at that commit)…',
        'pull.aiReviewing': 'Reading full files and reviewing…',
        'pull.aiFilesTruncated': 'This PR has more files than the platform returns in one page: the file list is incomplete, so some changes may not have been reviewed.',
        'pull.aiStepsTitle': 'Steps',
        'pull.aiLogHint': 'Full log: {path}',
        'pull.aiStart': 'Start review',
        'pull.aiOpenSettings': 'Choose a model',
        'pull.aiRerun': 'Review again',
        'pull.aiRunning': 'Reading the diff and reviewing — this can take a while…',
        'pull.aiSkippedTitle': '{count} file(s) had no content from the platform (binary or too large) and were not reviewed:',
        'pull.aiSkippedHint': 'To include them: split the file, keep generated/binary files out of the repo, or open smaller PRs.',
        'pull.aiTruncated': 'The change is too large: only the first part was sent to the model, so the review may be incomplete.',
        'pull.aiNoFindings': 'No issues worth changing were found.',
        'pull.aiSuggestion': 'Suggestion: ',
        'pull.aiVerdict.approve': 'looks good',
        'pull.aiVerdict.comment': 'has suggestions',
        'pull.aiVerdict.request-changes': 'changes requested',
        'pull.severity.blocker': 'blocker',
        'pull.severity.major': 'major',
        'pull.severity.minor': 'minor',
        'pull.severity.nit': 'nit',
        'pull.commitsTitle': 'Commits',
        'pull.commitsLimited': 'Showing {shown} of {total} commits',
        'pull.closeRun': 'Close PR',
        'pull.closeConfirm': 'Confirm close',
        'pull.reopenRun': 'Reopen',
        'pull.closedNotice': 'PR closed',
        'pull.reopenedNotice': 'PR reopened',
        'pull.commentsTitle': 'Comments',
        'pull.commentsEmpty': 'No comments yet — write one below.',
        'pull.commentPlaceholder': 'Message for the author (Markdown supported); post when ready',
        'pull.commentFilled': 'Copied into the comment box',
        'pull.aiFillComment': 'Fill comment box',
        'pull.aiCommentLabel': 'Comment draft',
        'pull.aiCommentPlaceholder': 'Drafted by AI — edit freely; post only when you are happy with it',
        'pull.aiCommentSubmit': 'Post comment',
        'pull.aiCommentSubmitting': 'Posting…',
        'pull.aiCommentDone': 'Comment posted',
        'pull.gateReview': 'Review',
        'pull.gateTest': 'Test',
        'pull.gateMergeState': 'Merge state',
        'pull.gateReviewPassed': 'approved',
        'pull.gateReviewChanges': 'changes requested',
        'pull.gateReviewPending': 'awaiting review',
        'pull.gateTestPassed': 'passed',
        'pull.gateTestPending': 'not passed',
        'pull.gateUnknown': 'not exposed by the platform',
        'pull.passAll': 'Pass review + test',
        'pull.passReviewOnly': 'Approve',
        'pull.passAllHint': 'Runs whatever the platform supports: approve and/or mark tested',
        'pull.passDone': 'Passed: {steps}',
        'pull.testRun': 'Mark tested',
        'pull.testHint': 'Some repositories require a passed test before merging',
        'pull.testDone': 'Marked as tested',
        'pull.passPartial': 'Done: {steps}; failed: {failures}',
        'pull.conflict': 'This pull request conflicts with the base branch: {message}',
        'pull.conflictOpenWeb': 'Resolve on the web',
        'pull.mergeRun': 'Merge pull request',
        'pull.mergeConfirm': 'Confirm merge (may delete source branch)',
        'pull.merging': 'Merging…',
        'pull.working': 'Submitting…',
        'pull.merged': 'Merged',
        'pull.reviewDone': 'Review submitted ({verdict})',
        'pull.mergedDone': 'Merged, source branch {branch}',
        'pull.mergedButBranchKept': 'Merged ({branch}), but deleting the source branch failed: {message}',
        'pull.mergedClosed': 'Merged #{number} ({branch}) — back to the repository',
        'pull.filesChanged': '{count} files',
        'pull.filesTitle': 'Changed files',
        'pull.filesEmpty': 'This pull request changes no files.',
        'pull.filesUnavailable': 'Could not load the changed files: {message}',
        'pull.filesTruncated': 'The PR has many files; the platform returned only the first {count}. Some changes may be missing.',
        'pull.fileDiffLoading': 'Loading the diff for this file…',
        'pull.fileDiffFailed': 'Could not load this file’s diff',
        'pull.fileDiffUnsupported': 'This panel cannot load a single file’s diff',
        'pull.commits': '{count} commits',
        'pull.state.open': 'Open',
        'pull.state.closed': 'Closed',
        'pull.state.merged': 'Merged',
        'pull.state.unknown': 'Unknown state',
        'detail.pickRepo': 'Pick a repository on the left',
        'detail.pickRepoHint': 'Its branches, issues and pull requests show up here',
        'detail.loading': 'Loading {name}…',
        'detail.failed': 'Could not load the repository',
        'detail.created': 'opened {time}',
        'detail.updated': 'updated {time}',
        'detail.issues': 'Issues',
        'detail.pulls': 'Pull Requests',
        'detail.countOf': '{count} open',
        'detail.countUnknown': 'count unknown',
        'detail.openOnWeb': 'Open',
        'detail.noIssues': 'No open issues',
        'detail.noPulls': 'No open pull requests',
        'detail.sizeKb': '{size} KB',
        'detail.defaultBranch': 'default {name}',
        'detail.stars': '★ {count}',
        'detail.forks': '⑂ {count}',
        'detail.sectionFailed': 'Could not load {section}: {message}',
        'remote.openPulls': '{count} open pull requests',
        'remote.title': 'Accounts & repositories',
        'remote.addAccount': 'Add account',
        'remote.addAccountOn': 'Add a {provider} account',
        'remote.noAccounts': 'No code hosting account yet',
        'remote.noAccountsHint': 'Click “Add account”, pick a provider and paste a read-only token — no need to leave this tab',
        'remote.openSettings': 'Open settings',
        'remote.loading': 'Loading repositories…',
        'remote.failed': 'Could not load: {message}',
        'remote.failedTitle': 'Could not load',
        'remote.empty': 'No repositories on this account',
        'remote.loadMore': 'Load more',
        'remote.private': 'Private',
        'remote.clone': 'Clone',
        'remote.cloneTitle': 'Clone this repository into the project',
        'remote.cloneFolder': 'Target folder name',
        'remote.cloneConfirm': 'Clone into project',
        'remote.cloneCancel': 'Cancel',
        'remote.cloning': 'Cloning… {seconds}s',
        'remote.cloned': 'Cloned to {path}',
        'remote.filter': 'Filter repositories…',
        'remote.refresh': 'Reload',
        'remote.account': 'Account',
        'remote.updatedAt': 'Updated {time}',
        'remote.openWeb': 'Open in browser',
        'remote.cloneTargetTitle': 'Clone into the project',
        'remote.cloneTargetDesc': 'Repositories are cloned into a subfolder of {path}',
        'roots.title': 'Repositories',

        'group.conflicted': 'Conflicts',
        'group.staged': 'Staged',
        'group.unstaged': 'Changes',
        'group.untracked': 'Untracked',
        'group.count': '{count}',
        'row.stage': 'Stage',
        'row.unstage': 'Unstage',
        'group.stageAll': 'Stage all',
        'group.unstageAll': 'Unstage all',

        'commit.placeholder': 'Commit message',
        'prCard.retry': 'Retry',
        'prCard.refresh': 'Refresh status',
        'prCard.unread': '{count} new comments',
        'prCard.latest': 'Latest ({author}): ',
        'prCard.open': 'View PR',
        'prCard.status.waiting': 'Awaiting review',
        'prCard.status.changes': 'Changes requested',
        'prCard.status.approved': 'Ready to merge',
        'prCard.status.merged': 'Merged',
        'prCard.status.closed': 'Closed',
        'pull.commentAi': 'Let AI handle',
        'pull.commentAiBusy': 'Preparing session…',
        'pull.commentAiStarted': 'Session #{id} created: it first judges whether the comment holds, then decides what to change; it never commits or pushes.',
        'pr.open': 'Create PR',
        'pr.title': 'Create pull request',
        'pr.loading': 'Reading repository and branches…',
        'pr.repo': 'Repository',
        'pr.account': 'Account',
        'pr.head': 'From branch',
        'pr.base': 'Into branch',
        'pr.baseHint': 'Remembers your last choice',
        'sync.neverTitle': 'This branch is not on the remote yet',
        'sync.aheadTitle': '{count} local commits are not on the remote yet',
        'sync.pushWhy': 'The remote does not have its latest commit: nobody else can see your work, and no pull request can be opened.',
        'sync.pushRun': 'Push to remote',
        'sync.pushing': 'Pushing…',
        'sync.pushed': 'Pushed {branch}',
        'sync.pushCommand': 'git push -u origin {branch}',
        'sync.pushAfter': 'This hint disappears once pushed; after more commits just click push again.',
        'sync.deletedTitle': 'The remote branch was deleted (local {branch} remains)',
        'sync.deletedWhy': 'origin no longer has this branch — usually deleted automatically after the pull request was merged. Do not push from here: that would recreate the merged branch.',
        'sync.cleanupRun': 'Clean up: switch to the default branch and delete the local branch',
        'sync.cleaning': 'Cleaning up…',
        'sync.cleaned': 'Cleaned up: switched to {base} and deleted local branch {branch}',
        'sync.deletedAfter': 'Cleanup fetches updates, switches back to the default branch, then deletes this local branch; if it still has unmerged commits, deletion is refused and you are told why.',
        'sync.deletedNext': 'To keep working, create a new branch from the latest default branch instead of committing on this merged one.',
        'sync.prBlockedPush': 'Branch is not in sync with the remote yet: push from the left hint first',
        'sync.prBlockedDeleted': 'The remote branch was deleted: clean up from the left hint, then create a branch from the default branch',
        'pr.subject': 'Title & description',
        'pr.generate': 'Generate title & description',
        'pr.generating': 'Generating…',
        'pr.generated': 'Generated from {count} commits — edit as you like',
        'pr.titlePlaceholder': 'Pull request title',
        'pr.bodyPlaceholder': 'Pull request description (Markdown)',
        'pr.create': 'Create PR',
        'pr.creating': 'Creating…',
        'pr.cancel': 'Cancel',
        'pr.done': 'Done',
        'pr.openCreated': 'Open PR',
        'pr.createdTitle': 'PR #{number} created',
        'commit.submit': 'Commit',
        'commit.submitting': 'Committing…',
        'commit.generate': 'Generate commit message',
        'commit.regenerate': 'Regenerate commit message',
        'commit.generating': 'Generating commit message…',
        'commit.generatingElapsed': 'Generating… {seconds}s',
        'commit.done': 'Committed {head}',
        'commit.doneSubject': 'Committed {head} · {subject}',
        'commit.hintNoChanges': 'Nothing to commit',
        'commit.hintNoMessage': 'Write a message to commit',
        'commit.hintStageAll': 'Nothing staged — all changes will be staged when you commit',
        'commit.noModel': 'No model is configured for commit messages. Pick one in Settings.',
        'commit.nothing': 'Nothing to commit',
        'commit.unmerged': 'Resolve the conflicts before committing',
        'commit.openSettings': 'Choose another model',

        'accounts.guideTitle': 'How to get a token',
        'accounts.guideGithub1': 'Click "Get a token" at the top right; the page opens with the repo scope pre-filled',
        'accounts.guideGithub2': 'For public repositories only, public_repo is enough; organization repositories also need SSO',
        'accounts.guideGithub3': 'Copy the whole token (starts with ghp_ or github_pat_) and paste it below',
        'accounts.guideGitee1': 'Click "Get a token" at the top right, then create a new token',
        'accounts.guideGitee2': 'Select the projects scope (enough to list repositories)',
        'accounts.guideGitee3': 'Copy the token and paste it below',
        'accounts.getToken': 'Get a token',
        'accounts.openedPage': 'Opened in your browser — copy the token here and press Enter',
        'accounts.blockedPage': 'The browser blocked the new window; open this address manually:',
        'accounts.openTokenPage': 'Open token page',
        'accounts.tokenPlaceholder': 'Paste access token',
        'accounts.success': 'Connected: {login}',
        'accounts.verifyHint': 'The token is verified against /user before it is saved; a failed check stores nothing',
        'accounts.title': 'Code hosting accounts',
        'accounts.hint': 'Tokens live in the DSH credential store; this plugin never persists them. Read-only scope is enough to list repositories.',
        'accounts.provider': 'Provider',
        'accounts.label': 'Label (optional)',
        'accounts.token': 'Access token',
        'accounts.add': 'Add account',
        'accounts.adding': 'Validating token…',
        'accounts.edit': 'Edit account {name}',
        'accounts.saveLabel': 'Save',
        'accounts.saving': 'Saving…',
        'accounts.editLabel': 'Label',
        'accounts.tokenLabel': 'Token',
        'accounts.reveal': 'Show token',
        'accounts.hide': 'Hide',
        'accounts.copy': 'Copy token',
        'accounts.copied': 'Copied to clipboard',
        'accounts.copyFailed': 'Clipboard unavailable — the token is shown below, copy it manually',
        'accounts.tokenReplaceHint': 'Leave empty to keep the current token; paste a new one to replace it (it is verified first)',
        'accounts.tokenMismatch': 'Token belongs to a different account',
        'accounts.updated': 'Saved',
        'accounts.remove': 'Remove account {name}',
        'accounts.empty': 'No accounts yet',
        'accounts.failed': 'Could not add: {message}',
        'accounts.noCredentials': 'This DSH composition has no credential service, so account tokens cannot be stored',
        'settings.title': 'Settings',
        'settings.back': 'Back',
        'settings.open': 'Settings',
        'settings.untrackedLabel': 'Untracked files',
        'settings.untrackedMerge': 'Inside Changes (like VS Code)',
        'settings.untrackedSeparate': 'As their own group',
        'settings.postPushLabel': 'Push automatically after commit',
        'settings.postPushOn': 'On (default)',
        'settings.postPushOff': 'Off',
        'settings.postPushHint': 'Pushes the current branch to origin right after a successful commit. A failed push does not undo the commit; the reason shows in the hint on the Changes tab.',
        'settings.viewLabel': 'Changes list layout',
        'settings.viewList': 'List: one file per row, name first then its folder',
        'settings.viewTree': 'Tree: files grouped by folder',
        'settings.modelLabel': 'Model for commit messages',
        'settings.modelHint': 'Models come from the catalog configured in DeepSeek Harness.',
        'settings.modelNone': 'None selected',
        'settings.commitThinkingLabel': 'Commit message thinking mode',
        'settings.thinkingOff': 'Off (default)',
        'settings.thinkingOn': 'On',
        'settings.commitThinkingHint': 'Uses the selected thinking level; generation may take longer and use more tokens.',
        'settings.thinkingUnsupported': 'This model does not offer selectable thinking levels.',
        'settings.thinkingRequired': 'This model cannot turn thinking off. Choose a model that supports off to disable it.',
        'settings.thinkingSelectModel': 'Select a commit message model first.',
        'settings.commitEffortLabel': 'Thinking level',
        'settings.effortDefault': 'Model default',
        'settings.saved': 'Saved',
        'settings.noLlm': 'This profile has no LLM service mounted, so models cannot be listed',
        'settings.partialModels': 'These providers failed: {list}',
        'settings.unknownModel': 'The selected model is not in the catalog',
        'settings.loading': 'Loading…',

        'status.clean': 'Working tree clean',
        'status.cleanHint': 'No uncommitted changes in this repository',
        'status.loading': 'Loading…',
        'status.loadingDiff': 'Building diff…',
        'status.notRepo': 'Not a Git repository',
        'status.notRepoHint': 'Use “Add external repository”, or switch to another root.',
        'status.noSession': 'No active session',
        'status.noCwd': 'This session has no working directory yet',
        'status.noRoots': 'No Git repository found',
        'status.noRootsHint': 'This project contains no Git repository. You can add an external one.',
        'status.truncated': 'Too many results, showing a subset',
        'status.discovering': 'Looking for repositories…',
        'status.emptyFilter': 'No file matches "{filter}"',
        'status.emptyDir': 'This folder is empty',

        'viewer.placeholder': 'Pick a file on the left',
        'viewer.placeholderDiff': 'Pick a changed file on the left',
        'viewer.binary': 'Binary file — no text preview',
        'viewer.oversized': 'File too large to load',
        'viewer.missing': 'File missing or deleted',
        'viewer.directory': 'This is a directory',
        'viewer.submodule': 'Submodule pointer changed — open the submodule for details',
        'viewer.renameOnly': 'Renamed only, content unchanged',
        'viewer.oldPath': 'Renamed from {path}',
        'viewer.newFile': 'New file',
        'viewer.deletedFile': 'Deleted file',
        'viewer.lines': '{count} lines',
        'viewer.adds': '+{count}',
        'viewer.dels': '−{count}',
        'viewer.truncated': 'Content truncated',
        'viewer.noChanges': 'No content difference on this side',
        'viewer.expandAll': 'Show all',
        'action.retry': 'Retry',
        'action.cancel': 'Cancel',
        'action.close': 'Close',

        'error.gitMissing': 'git executable not found',
        'error.notRepository': 'Not a Git repository',
        'error.timeout': 'Operation timed out',
        'error.outsideRoot': 'Path outside the repository',
        'error.openFailed': 'Could not open the link (blocked or unsupported): {url}',
        'error.generic': 'Something went wrong: {message}',
        'error.modelFailed': 'The model call failed: {message}',
        /** A render-time exception (a bug in the panel itself). */
        'error.panelCrashed': 'The panel failed to render'
      }

      Object.assign(exports, { NS, zh, en });

    });
    __define("./components/GitPanelSurface.js", (exports, module) => {
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
      const { h, Component } = __m("./platform.js");
      const { EmptyState } = __m("./components/States.js");
      const { Panel } = __m("./components/Panel.js");

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
      class PanelRenderBoundary extends Component {
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

      function GitPanelSurface(props) {
        return h(PanelRenderBoundary, { t: props.t },
          h(Panel, { sessionId: props.sessionId, t: props.t }))
      }

      Object.assign(exports, { PanelRenderBoundary, GitPanelSurface });

    });
    __define("./components/States.js", (exports, module) => {
      /**
       * src/components/States.js —— 空 / 加载 / 错误 / 骨架 / 行内提示
       *
       * 结构一律按 CONTRACT.md §5 的 class 词汇表输出，样式全部由 src/styles.js 提供。
       * 文案全部走 `t('key')`；`t` 由宿主传入，缺了就是调用方的 bug（直接抛错，不静默降级）。
       *
       * props 契约（CONTRACT.md §3）：
       *   EmptyState({ icon, title, description, actions })
       *   LoadingState({ label, t })
       *   ErrorState({ message, onRetry, t })
       *   SkeletonRows({ rows })
       *   InlineNote({ tone: 'info'|'warn'|'error', children })
       */
      const { h, Fragment } = __m("./platform.js");
      const { Icon } = __m("./ui/Icon.js");

      const TONES = ['info', 'warn', 'error']

      /** 组件都要求宿主传入翻译函数：缺了就是调用方的 bug，直接报出来。 */
      function requireTranslate(t, name) {
        if (typeof t !== 'function') throw new Error(name + ' 缺少 t（翻译函数）')
        return t
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
       * 空态不取 `t`：标题与描述都由调用方翻译好再传进来。
       */
      function EmptyState(props) {
        const { icon, title, description, actions } = props
        const iconNode = isBlank(icon)
          ? null
          : h('div', { className: 'dgp-state-icon' },
              typeof icon === 'string' ? h(Icon, { name: icon, size: 24 }) : icon)
        const titleNode = isBlank(title) ? null : h('div', { className: 'dgp-state-title' }, title)
        const descNode = isBlank(description) ? null : h('div', { className: 'dgp-state-desc' }, description)
        const actionNodes = normalizeActions(actions)
        const actionBox = actionNodes.length > 0
          ? h('div', { className: 'dgp-state-actions' }, actionNodes)
          : null
        return h('div', { className: 'dgp-state' }, iconNode, titleNode, descNode, actionBox)
      }

      /** 加载态：小转圈 + 文案（居中同上）。 */
      function LoadingState(props) {
        const { label, t } = props
        const T = requireTranslate(t, 'LoadingState')
        const text = isBlank(label) ? T('status.loading') : label
        return h('div', { className: 'dgp-state', role: 'status', 'aria-live': 'polite' },
          h('span', { className: 'dgp-spinner', 'aria-hidden': 'true' }),
          h('div', { className: 'dgp-state-desc' }, text))
      }

      /** 错误态：警告图标 + 原因 + 重试按钮。 */
      function ErrorState(props) {
        const { message, onRetry, t } = props
        const T = requireTranslate(t, 'ErrorState')
        const text = isBlank(message) ? '' : String(message)
        const descNode = text === '' ? null : h('div', { className: 'dgp-state-desc' }, text)
        const retry = h('button', {
          type: 'button',
          className: 'dgp-btn',
          'data-variant': 'ghost',
          'data-size': 'sm',
          onClick: onRetry
        }, h(Icon, { name: 'refresh', size: 14 }), T('action.retry'))
        return h('div', { className: 'dgp-state', role: 'alert' },
          h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'warning', size: 24 })),
          descNode,
          h('div', { className: 'dgp-state-actions' }, retry))
      }

      const SKELETON_WIDTHS = [92, 74, 86, 62, 88, 70, 95, 58, 80, 66]

      /** 骨架屏：`rows` 行，宽度按固定节奏变化（内联 width，样式在 styles.js）。 */
      function SkeletonRows(props) {
        const { rows } = props
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
      function InlineNote(props) {
        const { tone, children } = props
        const safeTone = TONES.indexOf(tone) === -1 ? 'info' : tone
        return h('div', { className: 'dgp-inline-note', 'data-tone': safeTone }, children)
      }

      Object.assign(exports, { EmptyState, LoadingState, ErrorState, SkeletonRows, InlineNote });

    });
    __define("./ui/Icon.js", (exports, module) => {
      /**
       * src/ui/Icon.js —— 内联 SVG 图标集
       *
       * 统一按 24×24 网格绘制、2px 描边、圆角端点；渲染时通过 size 缩放到 12/14/16/24。
       * 这样同一套几何在 12px 的树行和 24px 的空态里都不会忽胖忽瘦。
       *
       * 只保留真正用到的图标；未知名字直接抛错，不做"静默退回默认图标"。
       */
      const { h } = __m("./platform.js");

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
      function Icon(props) {
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
      function StatusLetter(props) {
        const { status, className = '' } = props
        return h('span', {
          className: 'dgp-status-letter ' + className,
          'data-status': status,
          'aria-hidden': 'true'
        }, status === '?' ? 'U' : status)
      }

      Object.assign(exports, { Icon, StatusLetter });

    });
    __define("./components/Panel.js", (exports, module) => {
      /**
       * src/components/Panel.js —— 面板主体
       *
       * 职责：所有数据流与交互状态；渲染层尽量薄。
       *
       *   ┌─ toolbar ───────────────────────────────────────────┐
       *   │ [repo pill] [变更|文件]        [⟳] [⋯]              │
       *   ├─ filter ────────────────────────────────────────────┤
       *   │ [🔍 筛选文件…]              [暂存|工作区]（双态文件才出现）│
       *   ├─ body ──────────────────────────────────────────────┤
       *   │ 左列（树/列表）        ‖ 右栏（diff / 文件内容）      │
       *   └──────────────────────────────────────────────────────┘
       *
       * 刷新策略：
       *  · 轮询（8s）/ 窗口重新可见+聚焦 → status + 储存库汇总；status 内容没变就不落状态，
       *    所以也不会连带重取 diff；
       *  · 手动刷新（R / 立即刷新）→ 额外重读当前 diff、文件内容与文件树（外部改动是显式意图）；
       *  · 任何写操作（暂存 / 提交 / 保存 / 分支）→ 一次 refreshRepository（status + 汇总）。
       * 每次请求带序号守护与 AbortController，切根 / 卸载时旧请求会被真正取消。
       */
      const { h, useCallback, useEffect, useMemo, useRef, useState, getPluginContext } = __m("./platform.js");
      const { Icon } = __m("./ui/Icon.js");
      const { PopupMenu, MenuItem, MenuLabel, MenuSeparator } = __m("./ui/Menu.js");
      const { useTimedNotice } = __m("./ui/useTimedNotice.js");
      const { useSnapshotResource } = __m("./ui/useSnapshotResource.js");
      const { RepoList } = __m("./components/RepoList.js");
      const { ChangesList } = __m("./components/ChangesList.js");
      const { FileTree } = __m("./components/FileTree.js");
      const { DiffView } = __m("./components/DiffView.js");
      const { FileEditor } = __m("./components/FileEditor.js");
      const { EmptyState, LoadingState, InlineNote } = __m("./components/States.js");
      const { CommitBox } = __m("./components/CommitBox.js");
      const { CreatePullForm } = __m("./components/CreatePullForm.js");
      const { PushHint } = __m("./components/PushHint.js");
      const { PullStatusCard } = __m("./components/PullStatusCard.js");
      const { SettingsView } = __m("./components/SettingsView.js");
      const { RemotePane } = __m("./components/RemotePane.js");
      const { RemoteDetail } = __m("./components/RemoteDetail.js");
      const { PullDetail } = __m("./components/PullDetail.js");
      const { MODE, readPrefs, writePref, readRemoteAccount, saveRemoteAccount, usePref, useLatestGuard } = __m("./store.js");
      const api = __m("./api.js");
      const { openExternalUrl } = __m("./util/openUrl.js");
      const { reconcileSelection, statusSignature } = __m("./util/changes.js");
      const { readSnapshot, writeSnapshot, snapshotAge } = __m("./util/resource-cache.js");
      const { readDrafts, writeDraft, dropDraft } = __m("./util/draft-cache.js");
      const { webUrlOf } = __m("./util/remote.js");
      const { formatClock } = __m("./util/time.js");

      const POLL_INTERVAL_MS = 8000
      /** 工具条与提交框的信息类提示：看一眼就够，别一直占着位置。 */
      const NOTE_TTL_MS = 8000
      const MIN_LEFT = 180
      const MIN_RIGHT = 280
      /** 需要展示提示条的 sync 状态：该推送的两种 + 远端已被删除（要收尾）。 */
      const SYNC_HINT_STATES = ['never-pushed', 'ahead', 'remote-deleted']

      const NO_ROOTS = { projectRoot: null, roots: [], warnings: [] }

      function documentVisible() {
        return document.visibilityState !== 'hidden'
      }

      function documentFocused() {
        return document.hasFocus()
      }

      /**
       * 两份「改动规模」是否一样。
       *
       * 轮询每 8 秒回来一次，内容一致时不该让整张储存库列表重渲染 —— 那会连带
       * 重新计算行布局，并让「有数字」的视觉稳定感碎掉。
       */
      function sameRootStats(previous, next) {
        const previousKeys = Object.keys(previous)
        if (previousKeys.length !== Object.keys(next).length) return false
        for (const key of previousKeys) {
          const before = previous[key]
          const after = next[key]
          if (after === undefined || before.error !== after.error) return false
          if (before.error !== undefined) continue
          if (before.counts.total !== after.counts.total) return false
          if (before.counts.conflicted !== after.counts.conflicted) return false
          if (before.adds !== after.adds || before.dels !== after.dels || before.binary !== after.binary) return false
        }
        return true
      }

      function Panel(props) {
        const t = props.t
        const tRef = useRef(t)
        tRef.current = t
        /** loadAccounts 定义在 openSettings 之后，这里留一个最新引用供打开设置时调用。 */

        const sessionId = props.sessionId

        /**
         * 首屏快照的键。
         *
         * 切走再切回来时组件会重新挂载：先拿上次的成功结果渲染，再后台刷新。
         * 项目根按会话分键（不同会话可能是不同项目），status 按仓库路径分键
         * （同一仓库被多个会话打开时共用一份快照）。
         */
        const projectKey = 'project:' + String(sessionId)
        const statusKeyOf = (rootPath) => 'status:' + rootPath
        const selectionKeyOf = (rootPath) => 'changes-selection:' + rootPath
        const fileSelectionKeyOf = (rootPath) => 'file-selection:' + rootPath

        /* ------------------------------- 偏好 ------------------------------- */
        const [mode, setMode] = usePref('mode')
        const [diffView, setDiffView] = usePref('diffView')
        const [wrap, setWrap] = usePref('wrap')
        const [contextLines, setContextLines] = usePref('contextLines')
        const [ignoreWhitespace, setIgnoreWhitespace] = usePref('ignoreWhitespace')
        const [autoRefresh, setAutoRefresh] = usePref('autoRefresh')
        const [leftWidth, setLeftWidth] = usePref('leftWidth')
        const [collapsedGroups, setCollapsedGroups] = usePref('collapsedGroups')
        const [repositoriesOpen, setRepositoriesOpen] = usePref('repositoriesOpen')
        const [changesView, setChangesView] = usePref('changesView')
        const [untrackedMode, setUntrackedMode] = usePref('untrackedMode')
        /** 提交成功后自动推送（默认开；对应 VS Code 的 git.postCommitCommand）。 */
        const [postCommitPush, setPostCommitPush] = usePref('postCommitPush')

        /* ------------------------------ 远端账号 ------------------------------ */
        const [accounts, setAccounts] = useState([])
        const [accountsLoaded, setAccountsLoaded] = useState(false)
        const [remoteAccountId, setRemoteAccountId] = useState(null)
        const [remoteRepos, setRemoteRepos] = useState([])
        const [remoteHasMore, setRemoteHasMore] = useState(false)
        const [remoteLoading, setRemoteLoading] = useState(false)
        const [remoteError, setRemoteError] = useState(null)
        const [remoteFilter, setRemoteFilter] = useState('')
        const [cloneState, setCloneState] = useState(null)
        const [cloneNow, setCloneNow] = useState(0)
        const [providers, setProviders] = useState([])
        // 每个远端仓库未合并 PR 数：{ 'owner/name': n }
        const [prCounts, setPrCounts] = useState({})
        // 右侧详情：选中的仓库
        const [remoteSelection, setRemoteSelection] = useState(null)
        // 分支数据是「按账号+仓库」的：记住上次拉的是哪一份，避免切页签/关 PR 时重复请求
        const branchSelectionRef = useRef(null)
        const remoteReposRef = useRef([])
        remoteReposRef.current = remoteRepos
        // 面板内打开的 PR
        const [openPull, setOpenPull] = useState(null)
        const [accountsBusy, setAccountsBusy] = useState(false)
        const [accountsError, setAccountsError] = useState(null)
        const [accountsNotice, setAccountsNotice] = useState(null)
        // 合并后 PR 会自动关闭，提示放在右侧顶部（PullDetail 已卸载，它的本地提示会丢）
        const [remoteNotice, setRemoteNotice] = useState(null)

        /* ------------------------------- 根 ------------------------------- */
        // 挂载时先吃上次的快照：有就零延迟出画面，没有才骨架屏
        const [project, setProject] = useState(() => readSnapshot(projectKey) ?? NO_ROOTS)
        const [activeRootId, setActiveRootId] = useState(null)
        const [rootsLoading, setRootsLoading] = useState(() => readSnapshot(projectKey) === undefined)
        const [rootsError, setRootsError] = useState(null)

        const roots = project.roots
        /** 用户隐藏的根默认不出现，也不参与仓库切换与自动选中；「显示已隐藏」时才由 RepoList 渲染。 */
        const visibleRoots = useMemo(() => roots.filter((root) => root.hidden !== true), [roots])
        /** 真正的仓库（排除只有文件浏览能力的「浏览根」）。变更模式只看这些。 */
        const gitRoots = useMemo(() => visibleRoots.filter((root) => root.isGit === true), [visibleRoots])
        /** 含已隐藏的仓库：储存库列表要能列出它们（带收起按钮），空态判断也用它。 */
        const allGitRoots = useMemo(() => roots.filter((root) => root.isGit === true), [roots])
        const activeRoot = visibleRoots.find((root) => root.id === activeRootId) ?? visibleRoots[0] ?? null
        /**
         * 「当前可操作的仓库」：变更模式里的写操作（暂存 / 提交 / 生成说明 / 建 PR）都只对它生效。
         *
         * `activeRoot` 是「储存库列表里当前高亮的那一行」，它可以是 null：所有仓库都被隐藏时
         * `visibleRoots` 为空，那是一个真实状态（没有可操作的仓库），不是异常。渲染层与回调
         * 一律只看 `activeRepo` 是否为 null，不再各自拼 `activeRoot === null || activeRoot.isGit === false`
         * 这种两段判定 —— 那种写法漏掉一处就是一个渲染期 TypeError，而渲染期异常会被宿主
         * 换成一块没有任何内容的黑屏（`GitPanelSurface.js`）。
         */
        const activeRepo = activeRoot !== null && activeRoot.isGit === true ? activeRoot : null
        /**
         * 文件模式固定浏览项目根（roots[0]：项目仓库根，或项目根不是仓库时的浏览根）。
         * 仓库切换只发生在变更模式的「储存库」列表里，文件模式不再有根选择器。
         */
        const browseRoot = roots[0] ?? null
        const browseRootRef = useRef(browseRoot)
        browseRootRef.current = browseRoot
        const activeRootRef = useRef(activeRoot)
        activeRootRef.current = activeRoot
        const projectRef = useRef(project)
        projectRef.current = project

        /* ------------------------- 远端资源（快照 + 守护） ------------------------- */
        /**
         * 四个「按选中项取数」的资源共用同一套语义，差别只在三个开关：
         *  · 仓库详情 / PR 详情：失败就清空，让错误态独自占屏；
         *  · 分支全貌 / 当前分支 PR 卡片：刷新与失败都保留上一份数据，列表与卡片不闪。
         */
        const remoteDetailResource = useSnapshotResource({
          keyOf: (selection) => 'remote-detail:' + selection.accountId + ':' + selection.fullName,
          // 带上账号 id：同名仓库在不同账号下不能共用一份详情
          load: (selection) => api.remoteDetail({ accountId: selection.accountId, fullName: selection.fullName })
            .then((value) => ({ ...value, accountId: selection.accountId })),
          t
        })
        const remoteBranchesResource = useSnapshotResource({
          keyOf: (selection) => 'remote-branches:' + selection.accountId + ':' + selection.fullName,
          load: (selection) => api.remoteBranches({
            accountId: selection.accountId,
            fullName: selection.fullName,
            rootPaths: allGitRoots.map((root) => root.path)
          }),
          keepPrevious: true,
          keepOnError: true,
          t
        })
        const pullDetailResource = useSnapshotResource({
          keyOf: (selection) => 'pull:' + selection.accountId + ':#' + String(selection.number),
          load: (selection) => api.remotePull({
            accountId: selection.accountId,
            fullName: selection.fullName,
            number: selection.number
          }),
          onLoaded: (selection, data) => {
            // 详情里能看到评论 = 用户已读：记水位供状态卡算未读
            writePref('pullSeen', {
              ...(readPrefs().pullSeen ?? {}),
              [selection.accountId + '#' + selection.number]: data.comments.length
            })
          },
          t
        })
        const linkedPullResource = useSnapshotResource({
          snapshot: false,
          keepPrevious: true,
          keepOnError: true,
          // 仓库是入参而不是闭包：没有活动仓库时这个请求没有意义，调用方必须先把仓库给它
          // （带上的 rootId 让切根后在途的旧结果不会挂到新仓库的卡片上）
          load: (root) => api.prLinked({ rootPath: root.path }).then((value) => ({ ...value, rootId: root.id })),
          t
        })

        const remoteDetail = remoteDetailResource.state
        const remoteBranches = remoteBranchesResource.state
        const pullDetail = pullDetailResource.state
        const linkedPull = linkedPullResource.state
        const loadRemoteDetail = remoteDetailResource.reload
        const loadRemoteBranches = remoteBranchesResource.reload
        const loadPullDetail = pullDetailResource.reload
        const loadLinkedPull = linkedPullResource.reload
        const clearRemoteBranches = remoteBranchesResource.clear
        const clearPullDetail = pullDetailResource.clear
        const remoteBranchesRef = useRef(remoteBranches)
        remoteBranchesRef.current = remoteBranches

        /** 打开某个 PR 时清掉上次合并的提示。 */
        const openPullWith = useCallback((selection) => {
          setRemoteNotice(null)
          setOpenPull(selection)
        }, [])

        /* ------------------------------ status ------------------------------ */
        const [status, setStatus] = useState(null)
        /** 最新 status 的同步引用：判断「要不要显示骨架屏」时不用把它塞进 useCallback 依赖。 */
        const statusRef = useRef(status)
        statusRef.current = status
        const [statusLoading, setStatusLoading] = useState(false)
        const [statusError, setStatusError] = useState(null)
        /** 上一次 status 的内容指纹：没变就不落状态（否则每 8 秒重渲染整张列表并重取 diff）。 */
        const statusSignatureRef = useRef(null)
        /** 储存库列表每行的改动规模：path -> { counts, adds, dels, binary } | { error } */
        const [rootStats, setRootStats] = useState({})
        const rootStatsRef = useRef(rootStats)
        rootStatsRef.current = rootStats
        /** 正在暂存/取消暂存的文件路径；同时只允许一个，避免连点打乱索引。 */
        const [stagePending, setStagePending] = useState(null)
        const stagePendingRef = useRef(null)
        const statusSeq = useLatestGuard()
        const statusAbortRef = useRef(null)
        const statsSeq = useLatestGuard()
        const statsAbortRef = useRef(null)

        /* ----------------------------- 选中状态 ----------------------------- */
        /**
         * 两个页签各有一份选中项，互不迁移。
         *
         * 「变更」里的路径是仓库相对（活动仓库可能是项目里的子仓库），「文件」里的路径是
         * 项目浏览根相对。共用一份状态时，切页签会把一个根下的相对路径套到另一个根上 ——
         * 在单仓库项目里碰巧对，多仓库项目里打开的是另一个同名文件。
         *
         * changesSelection: { rootPath, path, entry, side }
         * fileSelection:    { rootPath, path }
         */
        const [changesSelection, setChangesSelection] = useState(null)
        const [fileSelection, setFileSelection] = useState(null)
        const [filter, setFilter] = useState('')
        const filterRef = useRef(null)

        /* ------------------------------ 右栏数据 ---------------------------- */
        const [diff, setDiff] = useState(null)
        const [diffLoading, setDiffLoading] = useState(false)
        const [diffError, setDiffError] = useState(null)
        const [diffNonce, setDiffNonce] = useState(0)
        const diffSeq = useLatestGuard()

        const [fileData, setFileData] = useState(null)
        const [fileLoading, setFileLoading] = useState(false)
        const [fileError, setFileError] = useState(null)
        const [fileNonce, setFileNonce] = useState(0)
        const fileSeq = useLatestGuard()
        /** 文件树的手动刷新序号：+1 时清空目录缓存并重读（否则外部新建的文件永远看不到）。 */
        const [treeNonce, setTreeNonce] = useState(0)

        /**
         * 远端仓库列表 / 账号列表的序号守护。
         *
         * 它们都「先 setLoading 再 await」：切账号时旧账号的列表不能覆盖新账号的。
         * 详情 / 分支 / PR 详情各自有序号守护，见 useSnapshotResource。
         */
        const remoteReposGuard = useLatestGuard()
        const pullCountsGuard = useLatestGuard()
        const accountsGuard = useLatestGuard()

        /**
         * 编辑器草稿表：path -> { text, savedText, hash, eol, bom }。
         *
         * 为什么按 path 存在面板内存里（而不是只存"当前文件"）：
         *  用户在 A 文件改了几行、切去看 B、再切回 A —— 未保存的内容必须还在。
         *  静默丢弃按键是最不能接受的失败方式，所以草稿的生命周期 = 面板实例的生命周期。
         */
        const [drafts, setDrafts] = useState(() => new Map())
        const draftsRef = useRef(drafts)
        draftsRef.current = drafts
        /** 草稿缓存按「仓库根」分桶：切到别的根再切回来，未保存的改动仍在。 */
        const draftsRootRef = useRef(null)
        const [saveState, setSaveState] = useState({ busy: false, savedAt: 0, error: null, conflict: null })
        const saveSeq = useLatestGuard()
        /**
         * 插件自身版本与更新检查（与本仓库的 git 状态无关）。
         */
        const [pluginState, setPluginState] = useState({
          version: null, busy: false, latestVersion: null, url: '', publishedAt: '', newer: false, checkedAt: 0, error: null
        })
        /** 工具条提示：插件检查结果与上游检查结果共用一条，谁最后动作显示谁。 */
        const [toolbarNote, setToolbarNote] = useTimedNotice(NOTE_TTL_MS)
        const checkSeq = useLatestGuard()

        // 派生值只依赖 state，放在动作之前：checkUpdates/openRemote 要用到它们
        const versionText = pluginState.version === null ? '—' : 'v' + pluginState.version
        const remoteWebUrl = webUrlOf(status === null ? null : status.remoteUrl)
        const versionTitle = buildVersionTitle(pluginState, t)
        const updateNote = toolbarNote

        /* --------------------------- 提交 / 设置 --------------------------- */
        const [commitMessage, setCommitMessage] = useState('')
        const [commitBusy, setCommitBusy] = useState(false)
        const [commitGenerating, setCommitGenerating] = useState(false)
        /** 生成中的已等待毫秒数：每 200ms 刷新一次，让用户看得见它在跑。 */
        const [generateElapsed, setGenerateElapsed] = useState(0)
        const [commitNote, setCommitNote] = useTimedNotice(NOTE_TTL_MS)
        /**
         * 「推送 / 收尾」这类远端动作的状态：{ busy, error }。
         * error 直接显示在提示块里，不弹窗；推送与收尾共用这一份（同一时刻只会做一个）。
         */
        const [remoteAction, setRemoteAction] = useState({ busy: false, error: null })
        const remoteActionRef = useRef(remoteAction)
        remoteActionRef.current = remoteAction
        const [showSettings, setShowSettings] = useState(false)
        /**
         * 创建 PR 表单（右侧面板）：
         * { loading, error, repo, head, bases, accounts, accountId, base, title, body,
         *   generating, creating, created, notice }
         *
         * 这里没有推送状态：「分支与远端的关系」属于仓库状态，唯一来源是 `status.sync`。
         * 表单另存一份快照只会有两个后果 —— 同一屏出现两块同样的提示、以及推送后两边对不上。
         */
        const [pullForm, setPullForm] = useState(null)
        const [settingsState, setSettingsState] = useState({ loading: false, models: [], commitModel: null, reviewModel: null, commitThinking: false, commitReasoningEffort: null, error: null, saved: false })

        const [moreOpen, setMoreOpen] = useState(false)
        const moreAnchorRef = useRef(null)
        const [moreAnchorRect, setMoreAnchorRect] = useState(null)

        const rootRef = useRef(null)
        const bodyRef = useRef(null)
        const dividerRef = useRef(null)

        /* ============================ 解析项目根 ============================ */
        const resolveProject = useCallback(async (signal) => {
          // 有快照时这是「后台重新验证」：不把画面切回骨架屏
          if (readSnapshot(projectKey) === undefined) setRootsLoading(true)
          setRootsError(null)
          try {
            const value = await api.resolveProject({ sessionId }, { signal })
            if (signal !== undefined && signal.aborted) return
            const next = { projectRoot: value.projectRoot, roots: value.roots, warnings: value.warnings }
            writeSnapshot(projectKey, next)
            setProject(next)
            setActiveRootId((previous) => {
              if (typeof previous === 'string' && next.roots.some((root) => root.id === previous)) return previous
              // 变更模式看的是仓库：项目根只是「浏览根」时，默认选中第一个真正的仓库，
              // 否则打开一个多仓库项目会先落到「不是 Git 仓库」的空态上。
              const firstRepo = next.roots.find((root) => root.isGit === true)
              if (firstRepo !== undefined) return firstRepo.id
              return next.roots.length > 0 ? next.roots[0].id : null
            })
          } catch (error) {
            if (signal !== undefined && signal.aborted) return
            setRootsError(api.describeError(error, tRef.current))
          } finally {
            if (!(signal !== undefined && signal.aborted)) setRootsLoading(false)
          }
        }, [sessionId, projectKey])

        useEffect(() => {

          const controller = new AbortController()
          resolveProject(controller.signal)
          return () => controller.abort()
        }, [resolveProject, sessionId])

        /* ============================== 刷新 status ============================== */
        const refreshActiveStatus = useCallback(async () => {
          const root = activeRootRef.current
          if (root === null || root.isGit === false) {
            setStatus(null)
            setStatusError(null)
            setStatusLoading(false)
            return
          }
          const token = statusSeq.begin()
          // 每次刷新都换一个 AbortController：新请求打断旧请求，切根/卸载时也能真正取消
          const controller = new AbortController()
          statusAbortRef.current?.abort()
          statusAbortRef.current = controller
          // 已经有画面时不再显示加载态：轮询每 8 秒一次，闪一下骨架屏比不刷新还糟。
          const showLoading = statusRef.current === null
          if (showLoading) setStatusLoading(true)
          setStatusError(null)
          try {
            const value = await api.readStatus({ rootPath: root.path }, { signal: controller.signal })
            if (!statusSeq.isLatest(token)) return
            // 内容没变就不落状态：否则每一轮轮询都会重渲染整张列表、把选中项换成新对象、
            // 再连带把 diff 重新取一遍 —— 什么都没有变，只是又跑了一圈。
            const signature = statusSignature(value)
            if (signature === statusSignatureRef.current) return
            statusSignatureRef.current = signature
            setStatus(value)
            writeSnapshot(statusKeyOf(root.path), value)
            setChangesSelection((previous) => reconcileSelection(previous, value.files))
          } catch (error) {
            if (!statusSeq.isLatest(token) || error.code === 'aborted') return
            setStatusError(api.describeError(error, tRef.current))
          } finally {
            if (statusAbortRef.current === controller) statusAbortRef.current = null
            if (showLoading && statusSeq.isLatest(token)) setStatusLoading(false)
          }
        }, [statusSeq])

        /* ============================ 刷新储存库汇总 ============================ */
        /**
         * 储存库列表每行要显示「改动文件数 + 增删行数」：一次请求把所有仓库查完，
         * 宿主那边还能命中 status 缓存。内容没变就不落状态（否则列表会跟着轮询重渲染）。
         */
        const refreshRootStats = useCallback(async () => {
          const paths = projectRef.current.roots.filter((root) => root.isGit === true).map((root) => root.path)
          if (paths.length === 0) {
            if (Object.keys(rootStatsRef.current).length > 0) setRootStats({})
            return
          }
          const token = statsSeq.begin()
          const controller = new AbortController()
          statsAbortRef.current?.abort()
          statsAbortRef.current = controller
          try {
            const value = await api.rootStats({ paths }, { signal: controller.signal })
            if (!statsSeq.isLatest(token)) return
            const next = {}
            for (const summary of value.summaries) next[summary.path] = summary
            if (sameRootStats(rootStatsRef.current, next)) return
            setRootStats(next)
          } catch (error) {
            if (!statsSeq.isLatest(token) || error.code === 'aborted') return
            setStatusError(api.describeError(error, tRef.current))
          } finally {
            if (statsAbortRef.current === controller) statsAbortRef.current = null
          }
        }, [statsSeq])

        /** 一次仓库操作之后要同时跟上的两件事：活动仓库的 status、所有仓库的改动规模。 */
        const refreshRepository = useCallback(async () => {
          await Promise.all([refreshActiveStatus(), refreshRootStats()])
        }, [refreshActiveStatus, refreshRootStats])

        /** 根集合本身变了（新增 / 隐藏 / 取消隐藏 / 移除）：汇总数字要跟着换一批。 */
        const gitRootPathsKey = useMemo(
          () => project.roots.filter((root) => root.isGit === true).map((root) => root.path).join('\u0000'),
          [project.roots]
        )
        useEffect(() => {
          refreshRootStats()
        }, [gitRootPathsKey, refreshRootStats])

        /**
         * 用户主动刷新（工具条 / R 键）：重读 status、储存库汇总、当前 diff、文件内容与文件树。
         *
         * 轮询不碰 diff / 文件树：那两样只有内容真的变了才需要重来，而 status 指纹
         * 已经负责判断「变没变」；手动刷新是用户的显式意图，一律重读。
         */
        // 卸载时取消还在跑的汇总请求（status 由根 effect 负责）。
        useEffect(() => () => {
          statsAbortRef.current?.abort()
          statsAbortRef.current = null
        }, [])

        const refreshAll = useCallback(() => {
          setFileNonce((count) => count + 1)
          setDiffNonce((count) => count + 1)
          setTreeNonce((count) => count + 1)
          refreshRepository()
        }, [refreshRepository])

        useEffect(() => {
          // 换根：先把上次看过的快照摆上来，再后台刷新 —— 切回来不再白屏
          const rootPath = activeRepo === null ? null : activeRepo.path
          const cachedStatus = rootPath === null ? undefined : readSnapshot(statusKeyOf(rootPath))
          const cachedSelection = rootPath === null ? undefined : readSnapshot(selectionKeyOf(rootPath))
          statusSignatureRef.current = cachedStatus === undefined ? null : statusSignature(cachedStatus)
          setStatus(cachedStatus ?? null)
          setChangesSelection(reconcileSelection(cachedSelection ?? null, cachedStatus === undefined ? [] : cachedStatus.files))
          setDiff(null)
          // 换仓库 = 换了一份上下文：提交说明、创建 PR 表单、操作结果都不属于新仓库
          setRemoteAction({ busy: false, error: null })
          setCommitMessage('')
          setCommitNote(null)
          setPullForm(null)
          if (activeRepo === null) {
            setStatusLoading(false)
            return undefined
          }
          refreshActiveStatus()
          // 切根/卸载：取消这个根还没回来的 status 请求
          return () => {
            statusAbortRef.current?.abort()
            statusAbortRef.current = null
          }
        }, [activeRootId, activeRepo === null, refreshActiveStatus])

        /* ---------------------------- 选中项快照 ---------------------------- */
        // 切走再切回来时要回到「上次看的那个文件」，否则每次都要重新点一遍
        useEffect(() => {
          if (changesSelection === null) return
          writeSnapshot(selectionKeyOf(changesSelection.rootPath), changesSelection)
        }, [changesSelection])

        useEffect(() => {
          if (fileSelection === null) return
          writeSnapshot(fileSelectionKeyOf(fileSelection.rootPath), fileSelection)
        }, [fileSelection])

        /**
         * 文件页签的根与草稿。
         *
         * 草稿按「浏览根 + 相对路径」存进模块级缓存：切右侧栏页签会卸载组件，
         * 只放在组件 state 里的话，一次 unmount 就把没保存的改动丢光。
         */
        useEffect(() => {
          const browsePath = browseRoot === null ? null : browseRoot.path
          draftsRootRef.current = browsePath
          setDrafts(browsePath === null ? new Map() : readDrafts(browsePath))
          setFileData(null)
          setFileError(null)
          setSaveState({ busy: false, savedAt: 0, error: null, conflict: null })
          if (browsePath !== null) setFileSelection(readSnapshot(fileSelectionKeyOf(browsePath)) ?? null)
        }, [browseRoot === null ? null : browseRoot.path])

        /* ---------------------------- 自适应 refresh ---------------------------- */
        useEffect(() => {
          // 切回窗口/页签时，只有快照已经凉了才真的发请求：
          // 刚挂载时的 refreshRepository 已经发过一次，这里再发就是同一份数据的第二次往返。
          const shouldRefresh = () => {
            const root = activeRootRef.current
            return root === null ? true : snapshotAge(statusKeyOf(root.path)) > 500
          }
          const onFocus = () => {
            if (shouldRefresh()) refreshRepository()
          }
          const onVisibility = () => {
            if (documentVisible() && shouldRefresh()) refreshRepository()
          }
          window.addEventListener('focus', onFocus)
          document.addEventListener('visibilitychange', onVisibility)
          return () => {
            window.removeEventListener('focus', onFocus)
            document.removeEventListener('visibilitychange', onVisibility)
          }
        }, [refreshRepository])

        useEffect(() => {
          if (autoRefresh !== true || mode !== MODE.changes) return undefined
          const timer = setInterval(() => {
            if (documentVisible() && documentFocused()) refreshRepository()
          }, POLL_INTERVAL_MS)
          return () => clearInterval(timer)
        }, [autoRefresh, mode, refreshRepository])

        /**
         * 「储存库」行上的分支名是 project/resolve 的快照，而 status 是活动仓库的实时状态。
         * 两者不一致 = HEAD 在面板之外被切走了（PR 深度审阅会真的切、终端 / VS Code 也会切）；
         * 这时分支菜单（每次重读 branches/list）勾的是新分支、行尾还是旧值，两处对不上。
         *
         * 所以每次 status 更新后对一次：不一致就补一次 resolveProject 让快照跟上。
         * 只依赖 status（解析结果不会反过来改 status），因此不会形成解析循环；
         * 宿主真返回旧值时，最多是下一轮 status 再解析一次，不会变成请求风暴。
         */
        useEffect(() => {
          if (status === null) return
          const root = activeRootRef.current
          if (root === null || root.isGit !== true) return
          if (status.branch === root.branch) return
          resolveProject()
        }, [status, resolveProject])

        /* ============================== 取 diff ============================== */
        /**
         * 依赖是「请求的身份」而不是 selection 对象：决定 diff 的只有
         * `rootPath + path + side + 上下文设置`。轮询换掉了 selection 对象但内容没变时，
         * 这里不会重取（这是把 8 秒一次的 diff 请求彻底关掉的关键）。
         */
        const diffRootPath = changesSelection === null ? '' : changesSelection.rootPath
        const diffPath = changesSelection === null ? '' : changesSelection.path
        const diffSide = changesSelection === null ? '' : changesSelection.side
        useEffect(() => {
          if (mode !== MODE.changes) return undefined
          if (diffPath === '') {
            setDiff(null)
            setDiffLoading(false)
            setDiffError(null)
            return undefined
          }
          const controller = new AbortController()
          const token = diffSeq.begin()
          // 换文件/换侧立刻清空：否则新标题会和上一个文件的 diff 同屏一小会儿
          setDiff(null)
          setDiffLoading(true)
          setDiffError(null)
          api.readDiff({
            rootPath: diffRootPath,
            path: diffPath,
            staged: diffSide === 'staged',
            untracked: diffSide === 'untracked',
            contextLines,
            ignoreWhitespace
          }, { signal: controller.signal })
            .then((value) => {
              if (!diffSeq.isLatest(token)) return
              setDiff(value)
            })
            .catch((error) => {
              if (!diffSeq.isLatest(token) || error.code === 'aborted') return
              setDiffError(api.describeError(error, tRef.current))
            })
            .finally(() => {
              if (diffSeq.isLatest(token)) setDiffLoading(false)
            })
          return () => controller.abort()
        }, [mode, diffRootPath, diffPath, diffSide, contextLines, ignoreWhitespace, diffSeq, diffNonce])

        /* ====================== 编辑器草稿 / 保存（文件模式） ====================== */

        /** 更新一个草稿并同步写进模块级缓存（null = 丢掉这个文件的草稿）。 */
        const patchDraft = useCallback((path, draft) => {
          setDrafts((previous) => {
            const next = new Map(previous)
            if (draft === null) next.delete(path)
            else next.set(path, draft)
            return next
          })
          const root = draftsRootRef.current
          if (draft === null) dropDraft(root, path)
          else writeDraft(root, path, draft)
        }, [])

        /**
         * 读取结果与草稿对账。
         *
         * 规则只有一条主线：**未保存的用户输入永远优先**。
         *  · 磁盘内容与草稿的 hash 相同 → 什么都不用做（草稿可能是脏的，保留）
         *  · 磁盘变了：
         *      - 本地干净 → 直接换成磁盘内容（外部改动可见）
         *      - 本地有改动 → 保留本地，标记冲突，交给用户选（重新加载 / 覆盖保存）
         *  · 读到的不是可编辑文本 → 丢掉该 path 的草稿
         */
        const adoptRead = useCallback((path, value) => {
          const existing = draftsRef.current.get(path)
          if (value.kind !== 'text') {
            if (existing !== undefined) patchDraft(path, null)
            return
          }
          const fresh = {
            text: value.text,
            savedText: value.text,
            hash: value.hash,
            eol: value.eol,
            bom: value.bom
          }
          if (existing === undefined) {
            patchDraft(path, fresh)
            return
          }
          if (existing.hash === value.hash) return
          if (existing.text !== existing.savedText) {
            setSaveState((previous) => ({ ...previous, conflict: { path } }))
            return
          }
          patchDraft(path, fresh)
        }, [patchDraft])

        /** 编辑器输入 → 更新草稿。 */
        const changeDraft = useCallback((path, text) => {
          const draft = draftsRef.current.get(path)
          if (draft === undefined || draft.text === text) return
          patchDraft(path, { ...draft, text })
        }, [patchDraft])

        /**
         * 保存当前文件。
         * `force === true` 只由「覆盖保存」按钮传入 —— 那是用户看过冲突提示后的显式决定。
         */
        const saveDraft = useCallback(async (force) => {
          if (mode !== MODE.files || browseRoot === null || fileSelection === null) return
          const path = fileSelection.path
          const draft = draftsRef.current.get(path)
          if (draft === undefined) return
          if (force !== true && draft.text === draft.savedText) return

          const token = saveSeq.begin()
          setSaveState((previous) => ({ ...previous, busy: true, error: null }))
          const body = { rootPath: browseRoot.path, path, text: draft.text, eol: draft.eol, bom: draft.bom }
          try {
            const result = force === true
              ? await api.writeFile({ ...body, force: true })
              : await api.writeFile({ ...body, expectedHash: draft.hash })
            if (!saveSeq.isLatest(token)) return
            const current = draftsRef.current.get(path)
            if (current !== undefined) patchDraft(path, { ...current, savedText: current.text, hash: result.hash })
            setSaveState({ busy: false, savedAt: Date.now(), error: null, conflict: null })
            // 保存后工作区变了：变更列表与储存库行的数字都要跟上
            refreshRepository()
          } catch (error) {
            if (!saveSeq.isLatest(token)) return
            if (error.code === 'conflict') {
              setSaveState({ busy: false, savedAt: 0, error: null, conflict: { path } })
              return
            }
            if (error.code === 'aborted') {
              setSaveState((previous) => ({ ...previous, busy: false }))
              return
            }
            setSaveState({ busy: false, savedAt: 0, error: api.describeError(error, tRef.current), conflict: null })
          }
        }, [mode, browseRoot, fileSelection, saveSeq, patchDraft, refreshRepository])

        /** 冲突条的「重新加载」：丢掉本地改动，重新从磁盘读。 */
        const reloadDraft = useCallback(() => {
          if (fileSelection === null) return
          patchDraft(fileSelection.path, null)
          setSaveState({ busy: false, savedAt: 0, error: null, conflict: null })
          setFileNonce((count) => count + 1)
        }, [fileSelection, patchDraft])

        /* -------------------------- 检测更新 / 打开仓库 -------------------------- */

        /** 检查插件是否最新（当前安装版本 vs GitHub 最新 release）。 */
        const checkUpdates = useCallback(async () => {
          const token = checkSeq.begin()
          setPluginState((previous) => ({ ...previous, busy: true, error: null }))
          try {
            const value = await api.pluginUpdate()
            if (!checkSeq.isLatest(token)) return
            setPluginState({
              version: value.currentVersion,
              busy: false,
              latestVersion: value.latestVersion,
              url: value.url,
              publishedAt: value.publishedAt,
              newer: value.newer,
              checkedAt: Date.now(),
              error: null
            })
            setToolbarNote(value.newer
              ? {
                tone: 'warn',
                text: tRef.current('update.pluginNewer', { version: value.latestVersion, current: value.currentVersion }),
                url: value.url
              }
              : { tone: 'info', text: tRef.current('update.pluginUpToDate', { version: value.currentVersion }) })
          } catch (error) {
            if (!checkSeq.isLatest(token)) return
            setPluginState((previous) => ({ ...previous, busy: false, error: api.describeError(error, tRef.current) }))
            setToolbarNote({
              tone: 'error',
              text: tRef.current('update.failed', { message: api.describeError(error, tRef.current) })
            })
          }
        }, [checkSeq])

        /** 读一次插件版本（本地 package.json，不联网），让按钮一进来就显示真实版本。 */
        useEffect(() => {
          let alive = true
          api.pluginInfo().then((value) => {
            if (!alive) return
            setPluginState((previous) => ({ ...previous, version: value.version }))
          }, (error) => {
            if (!alive) return
            setPluginState((previous) => ({ ...previous, error: api.describeError(error, tRef.current) }))
          })
          return () => {
            alive = false
          }
        }, [])

        /** 打开远端仓库网页（本地路径类远端没有网页，按钮此时是禁用的）。 */
        const openRemote = useCallback(() => {
          const result = openExternalUrl(remoteWebUrl)
          if (result.opened !== true) {
            setToolbarNote({ tone: 'error', text: tRef.current('error.openFailed', { url: remoteWebUrl }) })
          }
        }, [remoteWebUrl, setToolbarNote])

        /** 有未保存改动的文件（给文件树画脏点）。 */
        const dirtyPaths = useMemo(() => {
          const set = new Set()
          for (const [path, draft] of drafts) if (draft.text !== draft.savedText) set.add(path)
          return set
        }, [drafts])

        /* ============================ 取文件内容 ============================ */
        const filePath = fileSelection === null ? null : fileSelection.path
        useEffect(() => {
          if (mode !== MODE.files) return undefined
          if (filePath === null) {
            setFileData(null)
            setFileLoading(false)
            setFileError(null)
            return undefined
          }
          const controller = new AbortController()
          const token = fileSeq.begin()
          setFileLoading(true)
          setFileError(null)
          api.readFile({ rootPath: browseRoot.path, path: filePath }, { signal: controller.signal })
            .then((value) => {
              if (!fileSeq.isLatest(token)) return
              setFileData(value)
              adoptRead(filePath, value)
            })
            .catch((error) => {
              if (!fileSeq.isLatest(token) || error.code === 'aborted') return
              setFileError(api.describeError(error, tRef.current))
            })
            .finally(() => {
              if (fileSeq.isLatest(token)) setFileLoading(false)
            })
          return () => controller.abort()
        }, [mode, filePath, browseRoot === null ? null : browseRoot.path, fileSeq, fileNonce])

        /* ============================== 交互 ============================== */
        const selectEntry = useCallback((entry, groupKey) => {
          const side = groupKey === 'untracked'
            ? 'untracked'
            : (groupKey === 'staged' && entry.staged === true ? 'staged' : 'unstaged')
          setChangesSelection({ rootPath: activeRootRef.current.path, path: entry.path, entry, side })
        }, [])

        const selectFile = useCallback((relPath) => {
          setFileSelection({ rootPath: browseRootRef.current.path, path: relPath })
        }, [])

        const switchSide = useCallback((side) => {
          setChangesSelection((previous) => (previous === null ? null : { ...previous, side }))
        }, [])

        /**
         * 行尾 + / −：未暂存与未跟踪暂存（git add），已暂存取消暂存（git restore --staged）。
         * 操作只作用于那一个文件；完成后重读 status，分组归属由新状态决定，
         * 所以文件会从下面的未暂存移到上面的已暂存（或反过来）。
         */
        const stageEntry = useCallback(async (relPath, action) => {
          if (activeRepo === null) return
          if (stagePendingRef.current !== null) return
          stagePendingRef.current = relPath
          setStagePending(relPath)
          setStatusError(null)
          try {
            await api.stageFile({ rootPath: activeRepo.path, path: relPath, action })
            await refreshRepository()
            setDiffNonce((previous) => previous + 1)
          } catch (error) {
            if (error.code !== 'aborted') {
              setStatusError(api.describeError(error, tRef.current))
            }
          } finally {
            stagePendingRef.current = null
            setStagePending(null)
          }
        }, [activeRepo, refreshRepository])

        /** 分组头的批量按钮：一次暂存或取消暂存整组。 */
        const stageGroup = useCallback(async (scope) => {
          if (activeRepo === null) return
          if (stagePendingRef.current !== null) return
          stagePendingRef.current = scope
          setStagePending(scope)
          setStatusError(null)
          try {
            await api.stageGroup({ rootPath: activeRepo.path, scope })
            await refreshRepository()
            setDiffNonce((previous) => previous + 1)
          } catch (error) {
            if (error.code !== 'aborted') {
              setStatusError(api.describeError(error, tRef.current))
            }
          } finally {
            stagePendingRef.current = null
            setStagePending(null)
          }
        }, [activeRepo, refreshRepository])

        /**
         * 推送当前分支（`branch/push`）。成功就刷新仓库状态 —— 提示条由 `status.sync` 驱动，
         * 刷新后自己消失/换成别的状态；失败把原因留在提示条里，不弹窗。
         * 正在执行时用 ref 挡住重复点击（state 要等下一遍渲染才生效）。
         */
        const pushBranchNow = useCallback(async () => {
          const root = activeRootRef.current
          if (root === null || root.isGit !== true || remoteActionRef.current.busy === true) return null
          setRemoteAction({ busy: true, error: null })
          try {
            const value = await api.pushBranch({ rootPath: root.path })
            setRemoteAction({ busy: false, error: null })
            setToolbarNote({ tone: 'info', text: tRef.current('sync.pushed', { branch: value.branch }) })
            await refreshRepository()
            return value
          } catch (error) {
            setRemoteAction({ busy: false, error: api.describeError(error, tRef.current) })
            return null
          }
        }, [refreshRepository])

        /**
         * 收尾「远端分支已被删除」的本地分支（`branch/cleanup`）：宿主一次做完
         * 取远程更新 → 切回默认分支 → 快进 → 删本地分支。
         * 成功会切换分支，所以要重新解析根（行尾分支名）并重读 status。
         */
        const cleanupBranchNow = useCallback(async () => {
          const root = activeRootRef.current
          if (root === null || root.isGit !== true || remoteActionRef.current.busy === true) return null
          setRemoteAction({ busy: true, error: null })
          try {
            const value = await api.cleanupBranch({ rootPath: root.path })
            setRemoteAction({ busy: false, error: null })
            setToolbarNote({
              tone: 'info',
              text: tRef.current('sync.cleaned', { branch: value.branch, base: value.base })
            })
            await resolveProject()
            await refreshRepository()
            return value
          } catch (error) {
            setRemoteAction({ busy: false, error: api.describeError(error, tRef.current) })
            return null
          }
        }, [resolveProject, refreshRepository])

        const commitStaged = useCallback(async () => {
          if (activeRepo === null) return
          const message = commitMessage.trim()
          if (message === '' || commitBusy) return
          setCommitBusy(true)
          setCommitNote(null)
          try {
            const result = await api.commitChanges({ rootPath: activeRepo.path, message })
            setCommitMessage('')
            const subject = result.subject.trim()
            setCommitNote({
              tone: 'info',
              text: subject === ''
                ? tRef.current('commit.done', { head: result.head })
                : tRef.current('commit.doneSubject', { head: result.head, subject })
            })
            setDiffNonce((previous) => previous + 1)
            // 提交成功后按偏好自动推送；推送成功时它自己会刷新 status（提示条随之消失/换状态）。
            // 没推或推失败时补一次刷新，让提示条按新的 ahead 状态出现（失败原因会显示在里面）。
            const pushedAfterCommit = postCommitPush === true ? await pushBranchNow() : null
            if (pushedAfterCommit === null) await refreshRepository()
          } catch (error) {
            setCommitNote({ tone: 'error', text: api.describeError(error, tRef.current) })
          } finally {
            setCommitBusy(false)
          }
        }, [activeRepo, commitMessage, commitBusy, refreshRepository, postCommitPush, pushBranchNow])

        /** 改输入就清掉上一次的结果提示：用户已经在写新的说明了。 */
        const changeCommitMessage = useCallback((text) => {
          setCommitMessage(text)
          setCommitNote(null)
        }, [])

        // 生成期间每 200ms 刷新一次已等待时间；结束（成功或失败）立刻归零。
        useEffect(() => {
          if (commitGenerating !== true) {
            setGenerateElapsed(0)
            return undefined
          }
          const started = Date.now()
          setGenerateElapsed(0)
          const timer = setInterval(() => setGenerateElapsed(Date.now() - started), 200)
          return () => clearInterval(timer)
        }, [commitGenerating])

        /** 生成提交说明：有暂存看暂存，否则看未暂存，由宿主决定。 */
        const generateMessage = useCallback(async () => {
          if (activeRepo === null || commitGenerating) return
          setCommitGenerating(true)
          setCommitNote(null)
          try {
            const result = await api.commitMessage({ rootPath: activeRepo.path })
            setCommitMessage(result.message)
          } catch (error) {
            setCommitNote({ tone: 'error', text: api.describeError(error, tRef.current), code: error?.code ?? null })
          } finally {
            setCommitGenerating(false)
          }
        }, [activeRepo, commitGenerating])

        /** 设置里存的是 {provider, model}，下拉框用的是扁平 ref。 */
        const refOfPair = (pair) => (pair === null || pair === undefined ? null : pair.provider + '/' + pair.model)

        /** 打开设置页：同时拉模型目录和当前设置。 */
        /** 目标分支记忆键：按 provider + 仓库全名区分。 */
        const pullTargetKey = (repo) => repo.provider + ':' + repo.fullName

        /** 打开创建 PR 表单：先向宿主要仓库/账号/分支信息。 */
        const openCreatePull = useCallback(async () => {
          if (activeRepo === null) return
          setPullForm({ loading: true, error: null, repo: null, head: '', bases: [], accounts: [], accountId: '', base: '', title: '', body: '', generating: false, creating: false, created: null, notice: null })
          try {
            const prepared = await api.prPrepare({ rootPath: activeRepo.path })
            const remembered = readPrefs().pullTargets?.[pullTargetKey(prepared.repo)] ?? ''
            const base = prepared.bases.includes(remembered) ? remembered : (prepared.bases[0] ?? '')
            setPullForm({
              loading: false,
              error: null,
              repo: prepared.repo,
              head: prepared.head,
              bases: prepared.bases,
              accounts: prepared.accounts,
              accountId: prepared.accounts[0]?.id ?? '',
              base,
              title: '',
              body: '',
              generating: false,
              creating: false,
              created: null,
              notice: null
            })
          } catch (error) {
            setPullForm({ loading: false, error: api.describeError(error, tRef.current), repo: null, head: '', bases: [], accounts: [], accountId: '', base: '', title: '', body: '', generating: false, creating: false, created: null, notice: null })
          }
        }, [activeRepo])

        const closeCreatePull = useCallback(() => setPullForm(null), [])

        const changePullField = useCallback((field, value) => {
          setPullForm((previous) => {
            if (previous === null || previous.created !== null) return previous
            return { ...previous, [field]: value, notice: null }
          })
        }, [])

        /** 用模型生成标题与描述（失败就地显示原因）。 */
        const generatePullText = useCallback(async () => {
          if (pullForm === null || activeRepo === null) return
          // 没有目标分支就不发请求：`{ base: undefined }` 序列化后字段会整个消失，
          // 宿主只会回一句「缺少参数 base」，看起来像生成功能坏了，其实模型根本没被调用。
          if (pullForm.base === '') return
          setPullForm({ ...pullForm, generating: true, error: null, notice: null })
          try {
            const generated = await api.prGenerate({ rootPath: activeRepo.path, base: pullForm.base })
            setPullForm((previous) => (previous === null ? previous : {
              ...previous,
              generating: false,
              title: generated.title,
              body: generated.body,
              notice: tRef.current('pr.generated', { count: generated.commits })
            }))
          } catch (error) {
            setPullForm((previous) => (previous === null ? previous : {
              ...previous, generating: false, error: api.describeError(error, tRef.current)
            }))
          }
        }, [pullForm, activeRepo])

        /** 创建 PR：成功后记住目标分支，供下次默认。 */
        const createPull = useCallback(async () => {
          if (pullForm === null || activeRepo === null) return
          // 同 generatePullText：没有目标分支（或还没准备出 repo）时不发这个注定被拒的请求
          if (pullForm.base === '') return
          if (pullForm.repo === null) return
          setPullForm({ ...pullForm, creating: true, error: null, notice: null })
          try {
            const created = await api.prCreate({
              rootPath: activeRepo.path,
              accountId: pullForm.accountId,
              fullName: pullForm.repo.fullName,
              base: pullForm.base,
              title: pullForm.title,
              body: pullForm.body
            })
            writePref('pullTargets', { ...(readPrefs().pullTargets ?? {}), [pullTargetKey(pullForm.repo)]: pullForm.base })
            await loadLinkedPull(activeRepo)
            await refreshRepository()
            setPullForm((previous) => (previous === null ? previous : { ...previous, creating: false, created }))
          } catch (error) {
            setPullForm((previous) => (previous === null ? previous : {
              ...previous, creating: false, error: api.describeError(error, tRef.current)
            }))
          }
        }, [pullForm, activeRepo, refreshRepository, loadLinkedPull])

        /** 读账号列表（token 不会下发到客户端，只有 id/login/label）。 */
        const loadAccounts = useCallback(async () => {
          const token = accountsGuard.begin()
          try {
            const value = await api.listAccounts({})
            if (!accountsGuard.isLatest(token)) return
            setAccounts(value.accounts)
            setProviders(value.providers)
            setAccountsLoaded(true)
          } catch (error) {
            if (!accountsGuard.isLatest(token)) return
            setAccountsLoaded(true)
            setRemoteError(api.describeError(error, tRef.current))
          }
        }, [accountsGuard])

        const openSettings = useCallback(async () => {
          setShowSettings(true)
          setSettingsState({ loading: true, models: [], commitModel: null, reviewModel: null, commitThinking: false, commitReasoningEffort: null, error: null, saved: false })
          // 设置页也管理账号：进来就确保账号列表是最新的（只读列表接口，很便宜）
          loadAccounts()
          try {
            const [catalog, settings] = await Promise.all([api.listModels({}), api.readSettings({})])
            const modelError = Array.isArray(catalog.failed) && catalog.failed.length > 0
              ? tRef.current('settings.partialModels', { list: catalog.failed.map((item) => item.provider ?? '?').join(', ') })
              : null
            setSettingsState({
              loading: false,
              models: catalog.models,
              commitModel: refOfPair(settings.commitModel),
              reviewModel: refOfPair(settings.reviewModel),
              commitThinking: settings.commitThinking === true,
              commitReasoningEffort: settings.commitReasoningEffort ?? null,
              error: modelError,
              saved: false
            })
          } catch (error) {
            setSettingsState({ loading: false, models: [], commitModel: null, reviewModel: null, commitThinking: false, commitReasoningEffort: null, error: api.describeError(error, tRef.current), saved: false })
          }
        }, [])

        /** 选择模型即保存。空值表示清除。 */
        const changeCommitModel = useCallback(async (ref) => {
          const commitModel = ref === '' ? null : ref
          setSettingsState((previous) => ({ ...previous, commitModel, commitThinking: false, commitReasoningEffort: null, saved: false, error: null }))
          try {
            const saved = await api.writeSettings({ commitModel, commitThinking: false, commitReasoningEffort: null })
            setSettingsState((previous) => ({ ...previous, commitModel: refOfPair(saved.commitModel), commitThinking: saved.commitThinking === true, commitReasoningEffort: saved.commitReasoningEffort ?? null, saved: true }))
          } catch (error) {
            setSettingsState((previous) => ({ ...previous, error: api.describeError(error, tRef.current), saved: false }))
          }
        }, [])

        /** 思考模式与档位单独保存；失败时恢复服务器上的值。 */
        const changeCommitThinking = useCallback(async (patch) => {
          setSettingsState((previous) => ({ ...previous, ...patch, saved: false, error: null }))
          try {
            const saved = await api.writeSettings(patch)
            setSettingsState((previous) => ({ ...previous, commitThinking: saved.commitThinking === true, commitReasoningEffort: saved.commitReasoningEffort ?? null, saved: true }))
          } catch (error) {
            try {
              const settings = await api.readSettings({})
              setSettingsState((previous) => ({ ...previous, commitThinking: settings.commitThinking === true, commitReasoningEffort: settings.commitReasoningEffort ?? null }))
            } catch { /* 保留原始保存错误 */ }
            setSettingsState((previous) => ({ ...previous, error: api.describeError(error, tRef.current), saved: false }))
          }
        }, [])

        /** 选择审阅模型即保存；与提交说明模型互不影响。 */
        const changeReviewModel = useCallback(async (ref) => {
          const reviewModel = ref === '' ? null : ref
          setSettingsState((previous) => ({ ...previous, reviewModel, saved: false, error: null }))
          try {
            const saved = await api.writeSettings({ reviewModel })
            setSettingsState((previous) => ({ ...previous, reviewModel: refOfPair(saved.reviewModel), saved: true }))
          } catch (error) {
            setSettingsState((previous) => ({ ...previous, error: api.describeError(error, tRef.current), saved: false }))
          }
        }, [])

        /**
         * 变更模式必须落在某个工作树上：当前根不是仓库（例如在文件模式选了浏览根）而项目里
         * 确实有仓库时，切到第一个仓库。没有仓库时保持原样，由空态引导。
         */
        useEffect(() => {
          if (mode !== MODE.changes) return
          if (activeRepo !== null) return
          const firstRepo = gitRoots[0]
          if (firstRepo !== undefined) setActiveRootId(firstRepo.id)
        }, [mode, activeRepo, gitRoots])

        const toggleGroup = useCallback((groupKey) => {
          setCollapsedGroups((previous) => {
            const next = { ...previous }
            if (next[groupKey] === true) delete next[groupKey]
            else next[groupKey] = true
            return next
          })
        }, [setCollapsedGroups])

        const selectRoot = useCallback((root) => {
          if (root === null) return
          setActiveRootId(root.id)
        }, [])

        const addExternalRoot = useCallback(async (dir) => {
          const projectRoot = projectRef.current.projectRoot
          if (projectRoot === null || projectRoot === '') {
            throw new Error(tRef.current('status.noCwd'))
          }
          try {
            const value = await api.addRoot({ projectRoot, path: dir })
            const nextRoots = value.roots
            setProject({ projectRoot: value.projectRoot, roots: nextRoots, warnings: value.warnings })
            const added = nextRoots.find((root) => root.path.toLowerCase() === dir.replace(/\\/g, '/').toLowerCase())
            if (added !== undefined) setActiveRootId(added.id)
            else if (nextRoots.length > 0) setActiveRootId(nextRoots[nextRoots.length - 1].id)
            return value
          } catch (error) {
            throw new Error(api.describeError(error, tRef.current))
          }
        }, [])

        const removeExternalRoot = useCallback(async (root) => {
          const projectRoot = projectRef.current.projectRoot
          if (root === null || projectRoot === null) return
          try {
            const value = await api.removeRoot({ projectRoot, path: root.path })
            const nextRoots = value.roots
            setProject({ projectRoot: value.projectRoot, roots: nextRoots, warnings: value.warnings })
            setActiveRootId((previous) => (
              previous === root.id ? (nextRoots.length > 0 ? nextRoots[0].id : null) : previous
            ))
          } catch (error) {
            setRootsError(api.describeError(error, tRef.current))
          }
        }, [])

        /** 隐藏 / 取消隐藏之后，若当前选中的那个根被藏起来了，落到第一个还看得见的根上。 */
        const applyRootsChange = useCallback((value, hiddenRoot) => {
          const nextRoots = value.roots
          setProject({ projectRoot: value.projectRoot, roots: nextRoots, warnings: value.warnings })
          setActiveRootId((previous) => {
            if (previous !== hiddenRoot.id) return previous
            const fallback = nextRoots.find((root) => root.hidden !== true)
            return fallback === undefined ? null : fallback.id
          })
        }, [])

        const hideRoot = useCallback(async (root) => {
          const projectRoot = projectRef.current.projectRoot
          if (root === null || projectRoot === null) return
          try {
            applyRootsChange(await api.hideRoot({ projectRoot, path: root.path }), root)
          } catch (error) {
            setRootsError(api.describeError(error, tRef.current))
          }
        }, [applyRootsChange])

        const unhideRoot = useCallback(async (root) => {
          const projectRoot = projectRef.current.projectRoot
          if (root === null || projectRoot === null) return
          try {
            applyRootsChange(await api.unhideRoot({ projectRoot, path: root.path }), root)
          } catch (error) {
            setRootsError(api.describeError(error, tRef.current))
          }
        }, [applyRootsChange])

        /** 分支菜单：取数由面板做，组件只负责交互。 */
        const loadBranches = useCallback(async (root) => api.listBranches({ rootPath: root.path }), [])

        /** 「仅远程」的分支：建本地跟踪分支并切过去。 */
        const trackBranchAt = useCallback(async (root, branch) => {
          try {
            await api.trackBranch({ rootPath: root.path, remote: branch.remote, name: branch.name })
          } catch (error) {
            throw new Error(api.describeError(error, tRef.current))
          }
          await resolveProject()
          await refreshRepository()
        }, [resolveProject, refreshRepository])

        /** 分支菜单里的「获取远程更新」：git fetch 后重读分支列表。 */
        /** 拉取该仓库当前分支的最新代码（fetch + 只允许快进，不做自动合并）。 */
        const pullBranchNow = useCallback(async (root) => {
          let value
          try {
            value = await api.pullBranch({ rootPath: root.path })
          } catch (error) {
            throw new Error(api.describeError(error, tRef.current))
          }
          setToolbarNote({
            tone: 'info',
            text: tRef.current('branch.pulled', { head: String(value.head).slice(0, 7) })
          })
          await resolveProject()
          await refreshAll()
          return value
        }, [resolveProject, refreshAll])

        const fetchBranches = useCallback(async (root) => {
          let fetched
          try {
            fetched = await api.fetchRemote({ rootPath: root.path })
          } catch (error) {
            throw new Error(api.describeError(error, tRef.current))
          }
          // fetch 只更新远端跟踪引用：把 ahead/behind 报出来，用户才知道要不要真的拉取
          setToolbarNote(buildUpstreamNote(fetched, tRef.current))
          if (activeRoot !== null && activeRoot.id === root.id) refreshRepository()
          return api.listBranches({ rootPath: root.path })
        }, [activeRoot, refreshRepository])

        const switchBranch = useCallback(async (root, name) => {
          try {
            await api.switchBranch({ rootPath: root.path, name })
          } catch (error) {
            throw new Error(api.describeError(error, tRef.current))
          }
          // 切分支会改 HEAD 与工作区：重新解析根（分支名要更新）并重读状态
          await resolveProject()
          await refreshRepository()
        }, [resolveProject, refreshRepository])

        /**
         * 创建分支（可携带未提交改动）。
         *
         * 宿主在动手前会把「能不能建」全部判定完，所以失败时仓库一定没被改过 ——
         * 界面可以放心地把 `would-overwrite` 当成「换个选择再试一次」，而不是「出事了」。
         * 这里把错误码与 details 透传出去（`api.describeError` 只保留一句话，撞车文件清单会丢），
         * RepoList 才能据此摆出两个零风险出口。
         */
        const createBranch = useCallback(async (root, request) => {
          let value
          try {
            value = await api.createBranch({ rootPath: root.path, ...request })
          } catch (error) {
            const wrapped = new Error(api.describeError(error, tRef.current))
            wrapped.code = error.code
            wrapped.details = error.details
            throw wrapped
          }
          setToolbarNote(buildBranchCreatedNote(value, tRef.current))
          // 建/切分支会改 HEAD（可能还改了工作区）：行尾分支名与 status 都要重读
          await resolveProject()
          await refreshRepository()
          return value
        }, [resolveProject, refreshRepository])

        const loadDir = useCallback(async (relPath, signal) => (
          api.listDirectory({ rootPath: browseRootRef.current.path, path: relPath }, { signal })
        ), [])

        /* ------------------------------ 远端账号 ------------------------------ */


        /** 读某个账号的仓库；append 用于「加载更多」。 */
        const loadRepos = useCallback(async (accountId, page, append) => {
          if (accountId === null) return
          const token = remoteReposGuard.begin()
          setRemoteLoading(true)
          if (append !== true) setRemoteError(null)
          try {
            const value = await api.listRemoteRepos({ accountId, page })
            if (!remoteReposGuard.isLatest(token)) return
            setRemoteRepos((previous) => (append === true ? [...previous, ...value.repos] : value.repos))
            setRemoteHasMore(value.hasMore === true)
          } catch (error) {
            if (!remoteReposGuard.isLatest(token)) return
            setRemoteError(api.describeError(error, tRef.current))
            if (append !== true) setRemoteRepos([])
          } finally {
            if (remoteReposGuard.isLatest(token)) setRemoteLoading(false)
          }
        }, [remoteReposGuard])

        /** 批量取当前列表的未合并 PR 数（宿主限制 50 个/次）。 */
        const loadPullCounts = useCallback(async (accountId, repos) => {
          if (accountId === null || repos.length === 0) {
            setPrCounts({})
            return
          }
          const token = pullCountsGuard.begin()
          try {
            const value = await api.remotePullCounts({
              accountId,
              fullNames: repos.map((repo) => repo.fullName)
            })
            if (!pullCountsGuard.isLatest(token)) return
            setPrCounts(value.counts)
          } catch {
            // 计数只是角标：失败就不显示，不打断列表（详情接口会暴露真实错误）
            if (pullCountsGuard.isLatest(token)) setPrCounts({})
          }
        }, [pullCountsGuard])

        /** 从仓库详情点开某个 PR。 */
        const openPullNumber = useCallback((number) => {
          if (remoteSelection === null) return
          const selection = {
            accountId: remoteSelection.accountId,
            fullName: remoteSelection.fullName,
            number
          }
          openPullWith(selection)
          loadPullDetail(selection)
        }, [remoteSelection, loadPullDetail, openPullWith])

        const closePull = useCallback(() => {
          setOpenPull(null)
          clearPullDetail()
        }, [clearPullDetail])

        // 切到变更页签或分支变化时刷新；不轮询（面板没有后台任务）
        useEffect(() => {
          if (mode !== MODE.changes || activeRepo === null) return
          loadLinkedPull(activeRepo)
        }, [mode, status === null ? '' : status.branch, loadLinkedPull, activeRepo])

        /** 从卡片打开 PR：切到远端页签并载入详情，同时记已读。 */
        const openLinkedPull = useCallback(async () => {
          if (linkedPull === null || linkedPull.data === null || linkedPull.data.linked !== true) return
          const data = linkedPull.data
          const selection = { accountId: data.accountId, fullName: data.fullName, number: data.number }
          setMode(MODE.remote)
          setRemoteSelection(selection)
          openPullWith(selection)
          await loadPullDetail(selection)
        }, [linkedPull, setMode, loadPullDetail, openPullWith])

        /**
         * 从 PR 卡片跳进远端页签 / 关掉 PR 回到仓库详情时，补一次仓库详情请求。
         * 只按「账号+仓库」比较，避免同一个仓库名在两个账号下共用一份详情。
         */
        useEffect(() => {
          if (mode !== MODE.remote || openPull !== null || remoteSelection === null) return
          const data = remoteDetail === null ? null : remoteDetail.data
          if (data !== null && data.accountId === remoteSelection.accountId && data.repo.fullName === remoteSelection.fullName) return
          loadRemoteDetail(remoteSelection)
          // 故意不依赖 remoteDetail：失败后等用户点重试，不自动循环请求
          // eslint-disable-next-line -- 只跟随选中项
        }, [mode, openPull, remoteSelection, loadRemoteDetail])

        /* --------------------------- 远端仓库详情 · 分支 --------------------------- */

        /**
         * 选中仓库变了才重拉分支：
         *  - 从 PR 详情关回仓库详情时，选中没变，不重复请求；
         *  - 切到别的仓库（或从 PR 卡片跳进来）时，按 fullName 重新拉一次；
         *  - 切回远端页签不自动刷新（分支有「刷新 / 获取远程更新」按钮，拉网络不该偷偷发生）。
         */
        useEffect(() => {
          if (mode !== MODE.remote) return
          if (remoteSelection === null) {
            branchSelectionRef.current = null
            clearRemoteBranches()
            return
          }
          if (openPull !== null) return
          const key = branchKeyOf(remoteSelection)
          if (branchSelectionRef.current === key) return
          branchSelectionRef.current = key
          // 换了仓库：先把上一个仓库的分支清掉，避免新数据回来前右侧挂着别人的分支
          clearRemoteBranches()
          loadRemoteBranches(remoteSelection)
        }, [mode, openPull, remoteSelection, loadRemoteBranches, clearRemoteBranches])

        /** 分支操作统一返回 { ok, error, code }：组件据 code 判断要不要露出「强制删除」。 */
        const branchFailure = useCallback((error) => ({
          ok: false,
          error: api.describeError(error, tRef.current),
          code: error.code ?? null
        }), [])

        /** 本地没有克隆时，本地分支操作明确报出来，不做无声失败。 */
        const noLocalRepoFailure = useCallback(() => ({
          ok: false,
          error: tRef.current('branch.noLocalOps'),
          code: 'no-local-repo'
        }), [])

        /** 切换分支：本地已有该分支才能切；成功后重新解析根并刷新 status（储存库行的分支名要跟着变）。 */
        const switchRemoteBranch = useCallback(async (branch) => {
          const rootPath = localRootPathOfBranches(remoteBranchesRef.current)
          if (rootPath === null) return noLocalRepoFailure()
          try {
            await api.switchBranch({ rootPath, name: branch.name })
          } catch (error) {
            return branchFailure(error)
          }
          await resolveProject()
          await refreshRepository()
          if (remoteSelection !== null) await loadRemoteBranches(remoteSelection)
          return { ok: true }
        }, [resolveProject, refreshRepository, loadRemoteBranches, remoteSelection, branchFailure, noLocalRepoFailure])

        /** 远端独有的分支：在本地建跟踪分支并切过去（与储存库分支菜单里的行为一致）。 */
        const trackRemoteBranch = useCallback(async (branch) => {
          const rootPath = localRootPathOfBranches(remoteBranchesRef.current)
          if (rootPath === null) return noLocalRepoFailure()
          try {
            await api.trackBranch({ rootPath, remote: 'origin', name: branch.name })
          } catch (error) {
            return branchFailure(error)
          }
          await resolveProject()
          await refreshRepository()
          if (remoteSelection !== null) await loadRemoteBranches(remoteSelection)
          return { ok: true }
        }, [resolveProject, refreshRepository, loadRemoteBranches, remoteSelection, branchFailure, noLocalRepoFailure])

        /** 删除本地分支（force 只会在用户点「强制删除」时传 true）。 */
        const deleteLocalBranchAt = useCallback(async (branch, force) => {
          const rootPath = localRootPathOfBranches(remoteBranchesRef.current)
          if (rootPath === null) return noLocalRepoFailure()
          try {
            await api.deleteLocalBranch({ rootPath, name: branch.name, force: force === true })
          } catch (error) {
            return branchFailure(error)
          }
          await resolveProject()
          await refreshRepository()
          if (remoteSelection !== null) await loadRemoteBranches(remoteSelection)
          return { ok: true }
        }, [resolveProject, refreshRepository, loadRemoteBranches, remoteSelection, branchFailure, noLocalRepoFailure])

        /** 删除远端分支：它是破坏性操作，界面已二次确认过；成功后只重读分支列表。 */
        const deleteRemoteBranchAt = useCallback(async (branch) => {
          if (remoteSelection === null) return { ok: false, error: tRef.current('branch.noLocalOps'), code: null }
          try {
            await api.deleteRemoteBranch({
              accountId: remoteSelection.accountId,
              fullName: remoteSelection.fullName,
              name: branch.name
            })
          } catch (error) {
            return branchFailure(error)
          }
          await loadRemoteBranches(remoteSelection)
          return { ok: true }
        }, [remoteSelection, loadRemoteBranches, branchFailure])

        /** 「获取远程更新」：git fetch --prune（只更新远端跟踪引用，不动工作区/本地分支），然后重读列表。 */
        const fetchRepoBranches = useCallback(async () => {
          const rootPath = localRootPathOfBranches(remoteBranchesRef.current)
          if (rootPath === null) return noLocalRepoFailure()
          try {
            await api.fetchRemote({ rootPath })
          } catch (error) {
            return branchFailure(error)
          }
          await refreshRepository()
          if (remoteSelection !== null) await loadRemoteBranches(remoteSelection)
          return { ok: true }
        }, [refreshRepository, loadRemoteBranches, remoteSelection, branchFailure, noLocalRepoFailure])


        /** PR 里单个文件的 diff：点开文件行时才读，失败就地给 PullDetail 显示。 */
        const pullFile = useCallback(async (input) => {
          try {
            const result = await api.remotePullFile(input)
            return { ok: true, ...result }
          } catch (error) {
            return { ok: false, error: api.describeError(error, tRef.current) }
          }
        }, [])

        /** 审查：统一把失败包成 { ok:false, error, code }，界面就地显示。 */
        const reviewPull = useCallback(async (input) => {
          try {
            const result = await api.remotePullReview(input)
            await loadPullDetail({ accountId: input.accountId, fullName: input.fullName, number: input.number })
            return { ok: true, message: tRef.current('pull.reviewDone', { verdict: input.verdict }) }
          } catch (error) {
            return { ok: false, error: api.describeError(error, tRef.current), code: error?.code ?? null }
          }
        }, [loadPullDetail])

        /** AI 审阅 PR：宿主取 diff、调审阅模型，返回结构化结论与评论草稿。 */
        const aiReviewPull = useCallback(async (input) => {
          try {
            const review = await api.remotePullAiReview(input)
            return { ok: true, ...review }
          } catch (error) {
            return {
              ok: false,
              error: api.describeError(error, tRef.current),
              code: error?.code ?? null,
              details: error?.details ?? null
            }
          }
        }, [])

        /**
         * 深度审阅：宿主会把本地仓库切到 PR 的分支（prepareReviewBranch：fetch + switch），
         * 读完整文件后再判。
         *
         * 切分支发生在面板之外，所以成功后要重新解析根 + 重读 status：
         * 否则「储存库」行上的分支名还是旧的，而分支菜单里新分支已经打了勾 —— 两处对不上。
         */
        /** 深度审阅阶段一：准备本地目录（查找仓库 / 判断是否已在 PR 提交 / 切分支）。 */
        const prepareReviewPull = useCallback(async (input) => {
          try {
            const prepared = await api.remotePullPrepareReview(input)
            if (prepared.mode === 'local') {
              // 切了分支：储存库行的分支名与 status 都要跟着刷新
              await resolveProject()
              await refreshRepository()
            }
            return { ok: true, ...prepared }
          } catch (error) {
            return {
              ok: false,
              error: api.describeError(error, tRef.current),
              code: error?.code ?? null,
              details: error?.details ?? null
            }
          }
        }, [resolveProject, refreshRepository])

        /** 会话级深度审阅：主工作区切分支后新建会话，把审阅指令发过去并自动打开。 */
        const sessionReviewPull = useCallback(async (input) => {
          try {
            // 带上当前 DSH 会话 id：宿主据此找到它所属的工作区，把审阅会话建进去
            const started = await api.remotePullSessionReview({ ...input, sessionId })
            if (started?.sessionId) {
              await resolveProject()
              await refreshRepository()
              getPluginContext()?.uiWorkspace?.openSession?.(started.sessionId)
            }
            return { ok: true, ...started }
          } catch (error) {
            return {
              ok: false,
              error: api.describeError(error, tRef.current),
              code: error?.code ?? null,
              details: error?.details ?? null
            }
          }
        }, [resolveProject, refreshRepository])

        /** 把 PR 克隆到用户选的目录（深度审阅前的准备步骤）。 */
        const cloneForReviewPull = useCallback(async (input) => {
          try {
            const result = await api.remotePullCloneForReview(input)
            // 克隆完成后重新解析项目：如果落在项目里，「变更」会立刻多出这个仓库
            await resolveProject()
            return { ok: true, ...result }
          } catch (error) {
            return { ok: false, error: api.describeError(error, tRef.current) }
          }
        }, [resolveProject])

        /** 关闭 / 重新打开 PR：成功后重读详情（状态、门禁、合并区都会变）。 */
        const setPullState = useCallback(async (input) => {
          try {
            const result = await api.remotePullState(input)
            await loadPullDetail({ accountId: input.accountId, fullName: input.fullName, number: input.number })
            await loadPullCounts(input.accountId, remoteReposRef.current)
            return { ok: true, ...result }
          } catch (error) {
            return {
              ok: false,
              error: api.describeError(error, tRef.current),
              code: error?.code ?? null
            }
          }
        }, [loadPullDetail, loadPullCounts])

        /** 提交评论（内容已由用户在面板里确认过）。 */
        const commentPull = useCallback(async (input) => {
          try {
            const result = await api.remotePullComment(input)
            await loadPullDetail({ accountId: input.accountId, fullName: input.fullName, number: input.number })
            return { ok: true, message: tRef.current('pull.aiCommentDone'), url: result.url }
          } catch (error) {
            return { ok: false, error: api.describeError(error, tRef.current) }
          }
        }, [loadPullDetail])

        /** 一键「审查与测试都通过」：宿主按平台能力依次执行，只要有一项成功就报结果。 */
        const passPull = useCallback(async (input) => {
          try {
            const result = await api.remotePullPass(input)
            await loadPullDetail({ accountId: input.accountId, fullName: input.fullName, number: input.number })
            // 部分成功也要说清哪一步没做成：只报「已通过：review」会让人以为测试也过了
            const failed = Array.isArray(result.failures) ? result.failures : []
            const message = failed.length === 0
              ? tRef.current('pull.passDone', { steps: result.completed.join(' / ') })
              : tRef.current('pull.passPartial', {
                steps: result.completed.join(' / '),
                failures: failed.map((item) => item.message).join('；')
              })
            return { ok: true, message }
          } catch (error) {
            return { ok: false, error: api.describeError(error, tRef.current), code: error?.code ?? null }
          }
        }, [loadPullDetail])

        /** 标记测试通过（Gitee 的合并门禁）：成功后重读详情，让合并按钮可用。 */
        const testPull = useCallback(async (input) => {
          try {
            await api.remotePullTest(input)
            await loadPullDetail({ accountId: input.accountId, fullName: input.fullName, number: input.number })
            return { ok: true, message: tRef.current('pull.testDone') }
          } catch (error) {
            return { ok: false, error: api.describeError(error, tRef.current), code: error?.code ?? null }
          }
        }, [loadPullDetail])

        const mergePull = useCallback(async (input) => {
          try {
            const result = await api.remotePullMerge(input)
            // PR 合并后就关闭了：直接回到仓库详情，不再停在已关闭的 PR 上
            closePull()
            setRemoteNotice(tRef.current('pull.mergedClosed', {
              number: input.number,
              branch: result.headBranch === '' ? '' : result.headBranch
            }))
            await loadRemoteDetail({ accountId: input.accountId, fullName: input.fullName })
            // 合并可以顺带删掉源分支：回到详情时分支区要重读，不能留着已删除的那一行
            branchSelectionRef.current = null
            clearRemoteBranches()
            // 合并后未合并数量会变，角标要跟着刷新
            await loadPullCounts(input.accountId, remoteReposRef.current)
            // closed:true 让 PullDetail 不要在被卸载后再写自己的提示
          return {
            ok: true,
            closed: true,
            message: result.branchDeleteError === null || result.branchDeleteError === undefined
              ? tRef.current('pull.mergedDone', { branch: result.headBranch })
              : tRef.current('pull.mergedButBranchKept', { branch: result.headBranch, message: result.branchDeleteError })
          }
          } catch (error) {
            return { ok: false, error: api.describeError(error, tRef.current), code: error?.code ?? null }
          }
        }, [loadPullDetail, loadRemoteDetail, closePull, clearRemoteBranches, loadPullCounts])

        /** 选中账号：记到当前工作区（切到别的工作区再回来仍是它）。账号 chip 只在面板内容渲染后才会出现，那时 projectRoot 一定有值。 */
        const selectRemoteAccount = useCallback((accountId) => {
          setRemoteAccountId(accountId)
          saveRemoteAccount(projectRef.current.projectRoot, accountId)
        }, [])

        /** 选中仓库：右侧立刻进入加载态再拉数据。 */
        const selectRemoteRepo = useCallback((repo) => {
          const selection = { accountId: repo.accountId, fullName: repo.fullName, name: repo.name }
          setRemoteSelection(selection)
          // 切仓库时关掉上一个仓库里打开的 PR：右栏优先渲染 openPull，
          // 不清的话会出现「左边选 B、右边显示 A 的 PR」。
          setOpenPull(null)
          clearPullDetail()
          setRemoteNotice(null)
          loadRemoteDetail(selection)
          // 点的是已经选中的仓库 = 手动刷新：分支数据按账号+仓库去重，这里显式再读一次
          if (branchSelectionRef.current === branchKeyOf(selection)) loadRemoteBranches(selection)
        }, [loadRemoteDetail, loadRemoteBranches, clearPullDetail])

        const openExternal = useCallback((url) => {
          const result = openExternalUrl(url)
          if (result.opened !== true) {
            setToolbarNote({ tone: 'error', text: tRef.current('error.openFailed', { url }) })
          }
        }, [setToolbarNote])

        /** 进「远端」页签且还没读过账号时读一次。 */
        useEffect(() => {
          if (mode !== MODE.remote || accountsLoaded) return
          loadAccounts()
        }, [mode, accountsLoaded, loadAccounts])

        /** 仓库列表加载完成后批量取 PR 数量。 */
        useEffect(() => {
          if (mode !== MODE.remote) return
          loadPullCounts(remoteAccountId, remoteRepos)
        }, [mode, remoteAccountId, remoteRepos, loadPullCounts])

        /** 仓库列表刷新后：当前选中不在列表里就选第一个，右侧不留空。 */
        useEffect(() => {
          // 正在看某个 PR 时不要因为列表刷新把左栏选中项改掉（右栏仍是那个 PR）
          if (mode !== MODE.remote || openPull !== null || remoteRepos.length === 0) return
          const exists = remoteSelection !== null && remoteRepos.some((repo) => (
            repo.accountId === remoteSelection.accountId && repo.fullName === remoteSelection.fullName
          ))
          if (exists) return
          selectRemoteRepo(remoteRepos[0])
        }, [mode, openPull, remoteRepos, remoteSelection, selectRemoteRepo])

        /** 切账号或首次进入时读第一页。 */
        useEffect(() => {
          if (mode !== MODE.remote || remoteAccountId === null) return
          loadRepos(remoteAccountId, 1, false)
        }, [mode, remoteAccountId, loadRepos])

        /**
         * 选中账号是 (工作区, 账号列表) 的派生：工作区已知、账号到手后，
         * 优先保留当前选中的（仍存在），其次用本工作区上次记下的，最后落第一个账号。
         *
         * 账号列表是全局的，但「用哪个」按工作区记（store.js 的 readRemoteAccount），
         * 所以切去别的工作区再回来、或者重新打开面板，都不会退回第一个账号。
         * 记忆只在用户点选时写（见 selectRemoteAccount），这里只读。
         */
        useEffect(() => {
          if (project.projectRoot === null || accounts.length === 0) return
          setRemoteAccountId((previous) => {
            // 账号 id 一定是非空字符串，所以这里不用先判断 previous/remembered 是不是 null
            if (accounts.some((account) => account.id === previous)) return previous
            const remembered = readRemoteAccount(project.projectRoot)
            if (accounts.some((account) => account.id === remembered)) return remembered
            return accounts[0].id
          })
        }, [project.projectRoot, accounts])

        /** 克隆期间每 200ms 刷新已等待秒数。 */
        useEffect(() => {
          if (cloneState === null || cloneState.error !== null) {
            setCloneNow(0)
            return undefined
          }
          const timer = setInterval(() => setCloneNow(Date.now()), 200)
          return () => clearInterval(timer)
        }, [cloneState])

        /** 把远端仓库克隆到项目根下，成功后重新解析根并切到变更页。 */
        const cloneRepo = useCallback(async (repo, targetName) => {
          const projectRoot = projectRef.current.projectRoot
          if (typeof projectRoot !== 'string' || projectRoot === '') {
            setCloneState({ fullName: repo.fullName, startedAt: 0, error: tRef.current('status.noCwd') })
            return
          }
          setCloneState({ fullName: repo.fullName, startedAt: Date.now(), error: null })
          setCloneNow(Date.now())
          try {
            await api.cloneRemoteRepo({
              accountId: repo.accountId,
              fullName: repo.fullName,
              cloneUrl: repo.cloneUrl,
              projectRoot,
              targetName: targetName ?? ''
            })
            setCloneState(null)
            // 项目里多了这个仓库：下次回到远端页签时分支区要重新判断「本地有没有克隆」
            branchSelectionRef.current = null
            clearRemoteBranches()
            await resolveProject()
            await refreshRepository()
            setMode(MODE.changes)
          } catch (error) {
            setCloneState({ fullName: repo.fullName, startedAt: 0, error: api.describeError(error, tRef.current) })
          }
        }, [resolveProject, refreshRepository, setMode, clearRemoteBranches])

        /** 设置页里新增/移除账号后刷新列表。 */
        const reloadAccounts = useCallback(async () => {
          setRemoteRepos([])
          await loadAccounts()
        }, [loadAccounts])

        const addAccount = useCallback(async (input) => {
          setAccountsBusy(true)
          setAccountsError(null)
          setAccountsNotice(null)
          try {
            const value = await api.addAccount(input)
            setAccountsNotice(tRef.current('accounts.success', { login: value.account.login }))
            await reloadAccounts()
            return { ok: true, account: value.account }
          } catch (error) {
            const message = api.describeError(error, tRef.current)
            setAccountsError(message)
            // 返回而不是抛出：设置页看 accountsError，远端页签的内联表单独看这个返回值
            return { ok: false, error: message }
          } finally {
            setAccountsBusy(false)
          }
        }, [reloadAccounts])

        const updateAccount = useCallback(async (input) => {
          setAccountsError(null)
          setAccountsNotice(null)
          try {
            const value = await api.updateAccount(input)
            setAccountsNotice(tRef.current('accounts.updated'))
            await reloadAccounts()
            return { ok: true, account: value.account }
          } catch (error) {
            const message = api.describeError(error, tRef.current)
            setAccountsError(message)
            return { ok: false, error: message }
          }
        }, [reloadAccounts])

        /** 只在用户点「显示令牌」时取原文；列表接口永远不含 token。 */
        const readAccountToken = useCallback(async (id) => {
          try {
            const value = await api.readAccountToken({ id })
            return { ok: true, token: value.token }
          } catch (error) {
            return { ok: false, error: api.describeError(error, tRef.current) }
          }
        }, [])

        const removeAccount = useCallback(async (id) => {
          setAccountsBusy(true)
          setAccountsError(null)
          try {
            await api.removeAccount({ id })
            await reloadAccounts()
          } catch (error) {
            setAccountsError(api.describeError(error, tRef.current))
          } finally {
            setAccountsBusy(false)
          }
        }, [reloadAccounts])

        /* ------------------------------ 分栏拖拽 ------------------------------ */
        /**
         * 拖拽只把一个 CSS 变量写到 DOM 上，pointerup 才落一次 state（并持久化）。
         *
         * 原先每次 pointermove 都 setLeftWidth：整面板重渲染（最多 5000 行 diff）
         * 加同步写 localStorage，拖起来会抖。拖拽是视觉变换，不是应用状态。
         */
        const dragCleanupRef = useRef(null)
        const dragWidthRef = useRef(leftWidth)

        const beginDrag = useCallback((event) => {
          if (event.button !== 0) return
          event.preventDefault()
          const body = bodyRef.current
          const divider = dividerRef.current
          dragWidthRef.current = leftWidth
          divider.setAttribute('data-dragging', 'true')
          document.body.style.cursor = 'col-resize'
          document.body.style.userSelect = 'none'

          const onMove = (moveEvent) => {
            const rect = body.getBoundingClientRect()
            const max = Math.max(MIN_LEFT, rect.width - MIN_RIGHT)
            const raw = moveEvent.clientX - rect.left
            const next = Math.min(max, Math.max(MIN_LEFT, Math.round(raw)))
            dragWidthRef.current = next
            body.style.setProperty('--dgp-left-width', next + 'px')
          }
          const cleanup = () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            window.removeEventListener('pointercancel', onUp)
            divider.removeAttribute('data-dragging')
            document.body.style.cursor = ''
            document.body.style.userSelect = ''
            dragCleanupRef.current = null
          }
          const onUp = () => {
            cleanup()
            setLeftWidth(dragWidthRef.current)
          }
          dragCleanupRef.current = cleanup
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
          window.addEventListener('pointercancel', onUp)
        }, [leftWidth, setLeftWidth])

        // 卸载时把可能还挂着的拖拽监听收掉（不落 state）。
        useEffect(() => () => {
          dragCleanupRef.current?.()
          document.body.style.cursor = ''
          document.body.style.userSelect = ''
        }, [])

        /** 键盘调宽：同样受「右侧至少 MIN_RIGHT」约束。 */
        const resizeBy = useCallback((delta) => {
          const rect = bodyRef.current.getBoundingClientRect()
          const max = Math.max(MIN_LEFT, rect.width - MIN_RIGHT)
          setLeftWidth(Math.min(max, Math.max(MIN_LEFT, leftWidth + delta)))
        }, [leftWidth, setLeftWidth])

        /* ------------------------------ 键盘 ------------------------------ */
        const onKeyDown = useCallback((event) => {
          const target = event.target
          const inField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable === true
          if (event.key === '/' && !inField) {
            event.preventDefault()
            filterRef.current.focus()
            return
          }
          if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === 's' || event.key === 'S')) {
            // 文件页签的保存：焦点在编辑器里时由 FileEditor 处理（它能拿到光标位置），
            // 这里负责焦点在文件树 / 工具条的情况。任何模式下都不让浏览器弹「保存网页」。
            event.preventDefault()
            if (!inField && mode === MODE.files && fileSelection !== null) saveDraft(false)
            return
          }
          if (inField) return
          if ((event.key === 'r' || event.key === 'R') && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault()
            refreshAll()
          }
        }, [refreshAll, mode, fileSelection, saveDraft])

        /* ------------------------------ 派生 ------------------------------ */
        const selectedChangePath = changesSelection === null ? null : changesSelection.path
        const selectedChangeEntry = changesSelection === null ? null : changesSelection.entry
        const entryHasBothSides = selectedChangeEntry !== null
          && selectedChangeEntry.staged === true
          && selectedChangeEntry.unstaged === true
        const counts = status === null ? null : status.counts
        const warnings = useMemo(() => {
          const list = []
          for (const warning of project.warnings) {
            if (warning !== '') list.push(warning)
          }
          if (activeRoot !== null && activeRoot.error !== null) list.push(activeRoot.error)
          return list
        }, [project.warnings, activeRoot])

        /* ------------------------------ 渲染 ------------------------------ */
        // 仓库切换只发生在变更模式的「储存库」列表里；文件模式固定浏览项目根，不放选择器。
        const toolbar = h('div', { className: 'dgp-toolbar' },
          h('div', { className: 'dgp-tbar-row' },
            h('div', { className: 'dgp-seg', role: 'tablist' },
              h('button', {
                type: 'button',
                className: 'dgp-seg-btn',
                role: 'tab',
                'data-active': mode === MODE.changes ? 'true' : undefined,
                'aria-selected': mode === MODE.changes ? 'true' : 'false',
                title: t('mode.changesHint'),
                disabled: showSettings,
                onClick: () => setMode(MODE.changes)
              }, t('mode.changes'), counts !== null && counts.total > 0
                ? h('span', { className: 'dgp-pill-count', style: { marginLeft: 4 } }, String(counts.total))
                : null),
              h('button', {
                type: 'button',
                className: 'dgp-seg-btn',
                role: 'tab',
                'data-active': mode === MODE.files ? 'true' : undefined,
                'aria-selected': mode === MODE.files ? 'true' : 'false',
                title: t('mode.filesHint'),
                disabled: showSettings,
                onClick: () => setMode(MODE.files)
              }, t('mode.files')),
              h('button', {
                type: 'button',
                className: 'dgp-seg-btn',
                role: 'tab',
                'data-active': mode === MODE.remote ? 'true' : undefined,
                'aria-selected': mode === MODE.remote ? 'true' : 'false',
                'data-dgp-tab': 'remote',
                title: t('mode.remoteHint'),
                disabled: showSettings,
                onClick: () => setMode(MODE.remote)
              }, t('mode.remote'))),
            h('div', { className: 'dgp-spacer' }),
            // 检测更新的结果贴在版本号左边，不单独占一行（宽度不够时自己截断，全文在 title 里）
            updateNote === null
              ? null
              : (updateNote.url === undefined || updateNote.url === ''
                ? h('span', {
                  className: 'dgp-update-note',
                  'data-update-note': updateNote.tone,
                  'data-tone': updateNote.tone,
                  title: updateNote.text
                }, updateNote.text)
                : h('button', {
                  type: 'button',
                  className: 'dgp-update-note dgp-update-note-link',
                  'data-dgp-version': 'note-link',
                  'data-update-note': updateNote.tone,
                  'data-tone': updateNote.tone,
                  title: t('update.openRelease'),
                  onClick: () => openExternalUrl(updateNote.url)
                }, updateNote.text, h(Icon, { name: 'external', size: 12 }))),
            h('button', {
              type: 'button',
              className: 'dgp-version',
              title: versionTitle,
              'aria-label': t('toolbar.checkUpdates'),
              'data-action': 'check-updates',
              'data-busy': pluginState.busy ? 'true' : undefined,
              'data-newer': pluginState.newer ? 'true' : undefined,
              disabled: pluginState.busy,
              onClick: checkUpdates
            }, h(Icon, { name: 'sync', size: 12 }), h('span', { className: 'dgp-version-text' }, versionText)),
            h('button', {
              type: 'button',
              className: 'dgp-iconbtn',
              title: remoteWebUrl === null ? t('update.noRemote') : t('toolbar.openRemote'),
              'aria-label': t('toolbar.openRemote'),
              'data-action': 'open-remote',
              disabled: remoteWebUrl === null,
              onClick: openRemote
            }, h(Icon, { name: 'external', size: 16 })),
            h('button', {
              type: 'button',
              className: 'dgp-iconbtn',
              title: t('settings.open'),
              'aria-label': t('settings.open'),
              'data-action': 'open-settings',
              onClick: openSettings
            }, h(Icon, { name: 'settings', size: 16 })),
            h('button', {
              type: 'button',
              className: 'dgp-iconbtn',
              title: t('toolbar.more'),
              'data-action': 'more',
              'aria-expanded': moreOpen ? 'true' : 'false',
              onClick: () => {
                const node = moreAnchorRef.current
                setMoreAnchorRect(node === null ? null : node.getBoundingClientRect())
                setMoreOpen((previous) => !previous)
              },
              ref: moreAnchorRef
            }, h(Icon, { name: 'more', size: 16 }))))

        const filterRow = showSettings || mode === MODE.remote
          ? null
          : h('div', { className: 'dgp-filter' },
          h('div', { className: 'dgp-search' },
            h(Icon, { name: 'search', size: 14 }),
            h('input', {
              ref: filterRef,
              className: 'dgp-input',
              type: 'search',
              placeholder: t('filter.placeholder'),
              value: filter,
              spellCheck: false,
              onChange: (event) => setFilter(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setFilter('')
                  event.target.blur()
                }
              }
            }),
            filter === ''
              ? null
              : h('button', {
                type: 'button',
                className: 'dgp-search-clear',
                title: t('filter.clear'),
                onClick: () => setFilter('')
              }, h(Icon, { name: 'close', size: 12 }))),
          entryHasBothSides
            ? h('div', { className: 'dgp-seg', style: { flex: 'none' } },
              h('button', {
                type: 'button',
                className: 'dgp-seg-btn',
                'data-active': changesSelection.side === 'unstaged' ? 'true' : undefined,
                title: t('group.unstaged'),
                onClick: () => switchSide('unstaged')
              }, t('group.unstaged')),
              h('button', {
                type: 'button',
                className: 'dgp-seg-btn',
                'data-active': changesSelection.side === 'staged' ? 'true' : undefined,
                title: t('group.staged'),
                onClick: () => switchSide('staged')
              }, t('group.staged')))
            : null)

        const stagedCount = status === null ? 0 : status.counts.staged
        /** 只要有改动就能提交（没有暂存时提交会先把全部改动暂存）。 */
        const changeCount = status === null ? 0 : status.counts.total

        /** 远端页签的仓库列表：本地筛选只作用在已拉取的那几页上。 */
        const visibleRemoteRepos = remoteFilter.trim() === ''
          ? remoteRepos
          : remoteRepos.filter((repo) => {
            const needle = remoteFilter.trim().toLowerCase()
            return repo.fullName.toLowerCase().includes(needle)
              || repo.description.toLowerCase().includes(needle)
              || repo.language.toLowerCase().includes(needle)
          })

        let leftPane
        if (mode === MODE.remote) {
          leftPane = h(RemotePane, {
            accounts,
            accountId: remoteAccountId,
            repos: visibleRemoteRepos,
            loading: remoteLoading,
            error: remoteError,
            hasMore: remoteHasMore,
            filter: remoteFilter,
            clone: cloneState,
            now: cloneNow,
            onSelectAccount: (account) => selectRemoteAccount(account.id),
            onRefresh: () => loadRepos(remoteAccountId, 1, false),
            onLoadMore: () => loadRepos(remoteAccountId, Math.floor(remoteRepos.length / 100) + 1, true),
            onFilterChange: setRemoteFilter,
            onOpenSettings: () => {
              setShowSettings(true)
              loadAccounts()
            },
            onClone: cloneRepo,
            prCounts,
            selectedFullName: remoteSelection === null ? null : remoteSelection.fullName,
            onSelectRepo: selectRemoteRepo,
            providers,
            onAddAccount: addAccount,
            t
          })
        } else if (mode === MODE.changes) {
          if (allGitRoots.length === 0) {
            // 整个项目里没有任何工作树：变更列表无从谈起，但文件浏览照常可用。
            leftPane = h(EmptyState, {
              icon: 'git-branch',
              title: t('status.notRepo'),
              description: t('status.notRepoHint'),
              actions: [h('button', {
                key: 'browse',
                type: 'button',
                className: 'dgp-btn',
                'data-size': 'sm',
                onClick: () => setMode(MODE.files)
              }, t('mode.files'))]
            })
          } else {
            // VS Code 的排布：上面「储存库」，下面「变更」（提交框 + 分组）。
            leftPane = h('div', { className: 'dgp-changes' },
              h(RepoList, {
                roots: allGitRoots,
                activeRootId: activeRoot === null ? null : activeRoot.id,
                open: repositoriesOpen === true,
                onToggleOpen: () => setRepositoriesOpen(repositoriesOpen !== true),
                onSelect: selectRoot,
                onAdd: addExternalRoot,
                onRemove: removeExternalRoot,
                onHide: hideRoot,
                onUnhide: unhideRoot,
                onLoadBranches: loadBranches,
                onSwitchBranch: switchBranch,
                onFetchBranches: fetchBranches,
                onPullBranch: pullBranchNow,
                onTrackBranch: trackBranchAt,
                onCreateBranch: createBranch,
                stats: rootStats,
                t
              }),
              linkedPull !== null && (linkedPull.data === null || linkedPull.data.rootId === (activeRoot === null ? null : activeRoot.id))
                ? h(PullStatusCard, {
                  card: linkedPull,
                  unread: linkedPull.data !== null && linkedPull.data.linked === true
                    ? Math.max(0, (Array.isArray(linkedPull.data.comments) ? linkedPull.data.comments.length : 0)
                      - (readPrefs().pullSeen?.[linkedPull.data.accountId + '#' + linkedPull.data.number] ?? 0))
                    : 0,
                  onOpen: openLinkedPull,
                  // 卡片只在「发起请求的那个仓库就是当前仓库」时渲染，所以这里一定有可操作的仓库
                  onRefresh: () => loadLinkedPull(activeRepo),
                  t
                })
                : null,
              /**
               * 本地分支与远端不同步时的常驻提示。三种状态各自下一步不同：
               *   never-pushed / ahead → 推送（带按钮）
               *   remote-deleted       → 收尾（切回默认分支并删除本地分支，绝不普通推送重建已合并分支）
               *   behind / diverged    → 不提示推送（那是该拉取/处理分叉），交给分支菜单的「拉取」。
               * synced / unknown 什么都不显示。
               */
              status !== null && SYNC_HINT_STATES.includes(status.sync.state)
                ? h(PushHint, {
                  branch: status.branch,
                  sync: status.sync,
                  t,
                  onPush: pushBranchNow,
                  onCleanup: cleanupBranchNow,
                  busy: remoteAction.busy,
                  error: remoteAction.error
                })
                : null,
              // 提交框只在「有可操作的仓库」时存在：没有仓库时它既没有提交对象，
              // 也没有「创建 PR」可言 —— 那不是禁用状态，是这个控件本来就不该出现。
              activeRepo === null
                ? null
                : h(CommitBox, {
                  message: commitMessage,
                  stagedCount,
                  changeCount,
                  busy: commitBusy,
                  generating: commitGenerating,
                  elapsedMs: generateElapsed,
                  note: commitNote,
                  onChange: changeCommitMessage,
                  onCommit: commitStaged,
                  onGenerate: generateMessage,
                  onOpenSettings: openSettings,
                  onCreatePull: openCreatePull,
                  t
                }),
              h(ChangesList, {
                status,
                loading: statusLoading && status === null,
                view: changesView,
                untrackedMode,
                selectedPath: selectedChangePath,
                onSelect: selectEntry,
                filter,
                collapsedGroups,
                onToggleGroup: toggleGroup,
                onStage: stageEntry,
                pendingPath: stagePending,
                onStageGroup: stageGroup,
                pendingGroup: stagePending,
                t
              }))
          }
        } else {
          leftPane = h(FileTree, {
            rootPath: browseRoot === null ? null : browseRoot.path,
            selectedPath: fileSelection === null ? null : fileSelection.path,
            onSelectFile: selectFile,
            filter,
            loadDir,
            dirtyPaths,
            reloadNonce: treeNonce,
            t
          })
        }

        let rightPane
        if (mode === MODE.changes && pullForm !== null) {
          rightPane = h(CreatePullForm, {
            form: pullForm,
            onCancel: closeCreatePull,
            onChangeBase: (value) => changePullField('base', value),
            onChangeAccount: (value) => changePullField('accountId', value),
            onChangeTitle: (value) => changePullField('title', value),
            onChangeBody: (value) => changePullField('body', value),
            onGenerate: generatePullText,
            onCreate: createPull,
            onOpenUrl: openExternal,
            // 创建 PR 只认「本地与远端一致」：不一致时表单说明原因，左侧提示条给下一步动作
            synced: status !== null && status.sync.state === 'synced',
            syncState: status === null ? 'unknown' : status.sync.state,
            t
          })
        } else if (mode === MODE.remote && openPull !== null) {
          rightPane = h(PullDetail, {
            // 每个 PR 一份独立的本地状态（AI 结果、评论草稿），切 PR 时重置
            key: openPull.fullName + '#' + String(openPull.number),
            selection: openPull,
            detail: pullDetail,
            onBack: closePull,
            onRetry: () => loadPullDetail(openPull),
            onReview: reviewPull,
            onTest: testPull,
            onPass: passPull,
            onAiReview: aiReviewPull,
            onPullFile: pullFile,
            onPrepareReview: prepareReviewPull,
            onSessionReview: sessionReviewPull,
            onCommentSession: sessionReviewPull,
            onCloneForReview: cloneForReviewPull,
            projectRoot: project.projectRoot,
            // 深度审阅会拿这些仓库逐个比对 origin，命中就复用它的对象库（快很多）
            localRepoRoots: gitRoots.map((root) => root.path),
            onComment: commentPull,
            onSetPullState: setPullState,
            onOpenSettings: openSettings,
            onMerge: mergePull,
            onChanged: () => loadPullDetail(openPull),
            onOpenUrl: openExternal,
            t
          })
        } else if (mode === MODE.remote) {
          rightPane = h(RemoteDetail, {
            selection: remoteSelection,
            detail: remoteDetail,
            // 分支区：数据 + 各类操作都走 Panel，组件只做交互与错误呈现
            branchState: remoteBranches,
            onReloadBranches: () => loadRemoteBranches(remoteSelection),
            onFetchBranches: fetchRepoBranches,
            onSwitchBranch: switchRemoteBranch,
            onTrackBranch: trackRemoteBranch,
            onDeleteLocalBranch: deleteLocalBranchAt,
            onDeleteRemoteBranch: deleteRemoteBranchAt,
            onRetry: () => loadRemoteDetail(remoteSelection),
            onClone: (selection) => cloneRepo({
              accountId: selection.accountId,
              fullName: selection.fullName,
              name: selection.name
            }, ''),
            onOpenUrl: openExternal,
            onOpenPull: openPullNumber,
            t
          })
        } else if (mode === MODE.changes) {
          if (changesSelection === null) {
            // 和 DiffView 用同一个容器壳，空态与有内容时的几何完全一致（居中，不贴左上角）
            rightPane = h('div', { className: 'dgp-viewer' },
              h(EmptyState, {
                icon: 'file-diff',
                title: t('viewer.placeholderDiff')
              }))
          } else {
            rightPane = h(DiffView, {
              diff,
              loading: diffLoading,
              error: diffError,
              path: changesSelection.path,
              entry: changesSelection.entry,
              view: diffView,
              wrap: wrap === true && diffView === 'unified',
              onRetry: () => setDiffNonce((previous) => previous + 1),
              t
            })
          }
        } else if (fileSelection === null) {
          rightPane = h('div', { className: 'dgp-viewer' },
            h(EmptyState, {
              icon: 'file',
              title: t('viewer.placeholder')
            }))
        } else {
          const path = fileSelection.path
          const draft = drafts.get(path)
          const conflict = saveState.conflict !== null && saveState.conflict.path === path ? saveState.conflict : null
          rightPane = h(FileEditor, {
            record: fileData,
            // 编辑器显示的是草稿内容；草稿还没有时退回磁盘内容
            text: draft === undefined ? null : draft.text,
            loading: fileLoading,
            error: fileError,
            path,
            wrap,
            dirty: draft !== undefined && draft.text !== draft.savedText,
            busy: saveState.busy,
            conflict,
            savedAt: saveState.savedAt,
            saveError: saveState.error,
            onChange: (text) => changeDraft(path, text),
            onSave: () => saveDraft(false),
            onOverwrite: () => saveDraft(true),
            onReload: reloadDraft,
            onRetry: () => setFileNonce((previous) => previous + 1),
            t
          })
        }

        const moreMenu = h(PopupMenu, {
          open: moreOpen,
          anchorRect: moreAnchorRect,
          onClose: () => setMoreOpen(false),
          minWidth: 236
        },
        h(MenuItem, {
          icon: 'refresh',
          label: t('toolbar.refreshNow'),
          onClick: () => {
            refreshAll()
            setMoreOpen(false)
          }
        }),
        h(MenuSeparator),
        h(MenuLabel, null, t('mode.changes')),
        h(MenuItem, {
          label: t('toolbar.unified'),
          checked: diffView === 'unified',
          onClick: () => {
            setDiffView('unified')
            setMoreOpen(false)
          }
        }),
        h(MenuItem, {
          label: t('toolbar.split'),
          checked: diffView === 'split',
          onClick: () => {
            setDiffView('split')
            setMoreOpen(false)
          }
        }),
        h(MenuItem, {
          label: t('toolbar.wrap'),
          // 并排视图下两列各自堆叠，折行长度不同会导致行错位；宿主自己也是统一视图才允许换行。
          sub: diffView === 'split' ? t('toolbar.wrapUnavailable') : undefined,
          checked: wrap === true && diffView !== 'split',
          disabled: diffView === 'split',
          onClick: () => setWrap(!wrap)
        }),
        h(MenuSeparator),
        h(MenuLabel, null, t('toolbar.context')),
        ...[1, 3, 6, 12].map((value) => h(MenuItem, {
          key: 'ctx-' + String(value),
          label: String(value),
          checked: contextLines === value,
          onClick: () => {
            setContextLines(value)
            setMoreOpen(false)
          }
        })),
        h(MenuSeparator),
        h(MenuItem, {
          label: t('toolbar.ignoreWhitespace'),
          checked: ignoreWhitespace === true,
          onClick: () => setIgnoreWhitespace(!ignoreWhitespace)
        }),
        h(MenuItem, {
          icon: 'clock',
          label: autoRefresh === true ? t('toolbar.autoRefreshOn') : t('toolbar.autoRefreshOff'),
          checked: autoRefresh === true,
          onClick: () => setAutoRefresh(!autoRefresh)
        }),
        h(MenuItem, {
          icon: changesView === 'tree' ? 'file' : 'folder',
          label: changesView === 'tree' ? t('toolbar.viewAsList') : t('toolbar.viewAsTree'),
          'data-action': 'toggle-changes-view',
          onClick: () => {
            setChangesView(changesView === 'tree' ? 'list' : 'tree')
            setMoreOpen(false)
          }
        }),
        h(MenuItem, {
          icon: 'minus',
          label: t('toolbar.collapseAll'),
          onClick: () => {
            setCollapsedGroups({ conflicted: true, staged: true, unstaged: true, untracked: true })
            setMoreOpen(false)
          }
        }))

        const body = h('div', {
          className: 'dgp-body',
          ref: bodyRef,
          style: { '--dgp-left-width': String(leftWidth) + 'px' }
        },
        h('div', { className: 'dgp-pane-left' }, leftPane),
        h('div', {
          className: 'dgp-divider',
          ref: dividerRef,
          role: 'separator',
          'aria-orientation': 'vertical',
          'aria-valuenow': leftWidth,
          'aria-valuemin': MIN_LEFT,
          tabIndex: 0,
          title: t('toolbar.resize'),
          onPointerDown: beginDrag,
          onKeyDown: (event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault()
              resizeBy(-16)
            } else if (event.key === 'ArrowRight') {
              event.preventDefault()
              resizeBy(16)
            }
          }
        }),
        h('div', { className: 'dgp-pane-right' },
          mode === MODE.remote && remoteNotice !== null
            ? h('div', { className: 'dgp-remote-notice', 'data-dgp-remote': 'notice' },
              h('span', { className: 'dgp-oneline' }, remoteNotice),
              h('button', {
                type: 'button',
                className: 'dgp-row-action',
                'data-dgp-remote': 'notice-dismiss',
                title: t('action.close'),
                onClick: () => setRemoteNotice(null)
              }, h(Icon, { name: 'close', size: 12 })))
            : null,
          rightPane))

        let content
        if (rootsLoading && roots.length === 0) {
          content = h(LoadingState, { label: t('status.discovering'), t })
        } else if (rootsError !== null && roots.length === 0) {
          content = h(EmptyState, {
            icon: 'warning',
            title: t('error.generic', { message: '' }),
            description: rootsError,
            actions: [h('button', {
              key: 'retry',
              type: 'button',
              className: 'dgp-btn',
              onClick: () => resolveProject(undefined)
            }, t('action.retry'))]
          })
        } else if (roots.length === 0) {
          content = h(EmptyState, {
            icon: 'git-branch',
            title: t('status.noRoots'),
            description: t('status.noRootsHint'),
            actions: [h('button', {
              key: 'retry',
              type: 'button',
              className: 'dgp-btn',
              onClick: () => resolveProject(undefined)
            }, t('action.retry'))]
          })
        } else {
          content = body
        }

        if (showSettings) {
          content = h(SettingsView, {
            models: settingsState.models,
            commitModel: settingsState.commitModel,
            commitThinking: settingsState.commitThinking === true,
            commitReasoningEffort: settingsState.commitReasoningEffort,
            onChangeCommitThinking: changeCommitThinking,
            reviewModel: settingsState.reviewModel,
            onChangeReviewModel: changeReviewModel,
            loading: settingsState.loading,
            error: settingsState.error,
            saved: settingsState.saved,
            onChangeModel: changeCommitModel,
            changesView,
            onChangeChangesView: setChangesView,
            untrackedMode,
            onChangeUntrackedMode: setUntrackedMode,
            postCommitPush,
            onChangePostCommitPush: setPostCommitPush,
            accounts,
            providers,
            accountsBusy,
            accountsError,
            accountsNotice,
            onAddAccount: addAccount,
            onUpdateAccount: updateAccount,
            onReadToken: readAccountToken,
            onRemoveAccount: removeAccount,
            onBack: () => setShowSettings(false),
            t
          })
        }

        return h('div', {
          className: 'dgp-root',
          ref: rootRef,
          'data-mode': mode,
          onKeyDown
        },
        toolbar,
        filterRow,
        warnings.length === 0
          ? null
          : h(InlineNote, { tone: 'warn' }, warnings.join(' · ')),
        statusError !== null && roots.length > 0
          ? h('div', { className: 'dgp-errorbar' },
            h(InlineNote, { tone: 'error' }, statusError),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              onClick: () => refreshRepository()
            }, t('action.retry')))
          : null,
        content,
        moreMenu)
      }

      /** 版本号按钮的 tooltip：插件版本 · 最新版本 · 检测时间（与仓库状态无关）。 */
      function buildVersionTitle(pluginState, t) {
        const parts = [t('toolbar.checkUpdates')]
        if (pluginState.version !== null) parts.push(t('update.currentVersion', { version: pluginState.version }))
        if (pluginState.checkedAt > 0 && pluginState.error === null) {
          parts.push(pluginState.newer
            ? t('update.latestVersion', { version: pluginState.latestVersion })
            : t('update.pluginUpToDate', { version: pluginState.version }))
          parts.push(t('update.checkedAt', { time: formatClock(pluginState.checkedAt) }))
        }
        return parts.join(' \u00b7 ')
      }

      /**
       * 上游检查的一句话结果。
       * 落后优先于领先：同时有分叉时更重要的是"你落后了"。
       */
      function buildUpstreamNote(value, t) {
        const upstream = value.upstream === null ? '' : value.upstream
        if (value.behind > 0) return { tone: 'warn', text: t('update.behind', { count: value.behind, upstream }) }
        if (value.ahead > 0) return { tone: 'info', text: t('update.ahead', { count: value.ahead, upstream }) }
        return { tone: 'info', text: t('update.upToDate', { upstream }) }
      }

      /**
       * 创建分支后的那句话。
       *
       * 用户最不确定的就是「我的改动去哪了」，所以这里必须把三种结局分开说：
       * 切过去并带走了改动 / 切过去但本来就没有改动 / 只建了分支没切换（改动留在原处）。
       */
      function buildBranchCreatedNote(value, t) {
        if (value.switched !== true) return { tone: 'info', text: t('branch.createdOnly', { name: value.branch }) }
        if (value.carried.total > 0) {
          return { tone: 'info', text: t('branch.createdFollow', { name: value.branch, total: value.carried.total }) }
        }
        return { tone: 'info', text: t('branch.created', { name: value.branch }) }
      }

      /** 分支数据的去重键：同一个仓库名在不同账号下是两份数据。 */
      function branchKeyOf(selection) {
        return selection.accountId + '#' + selection.fullName
      }

      /**
       * remote/branches 的状态 → 本地仓库根。
       * 没有本地克隆（或还没读到）时返回 null：分支区的本地操作一律以它为前提。
       */
      function localRootPathOfBranches(state) {
        if (state === null) return null
        if (state.data === null) return null
        const local = state.data.local
        if (local === null) return null
        return typeof local.rootPath === 'string' && local.rootPath !== '' ? local.rootPath : null
      }

      Object.assign(exports, { Panel });

    });
    __define("./ui/Menu.js", (exports, module) => {
      /**
       * src/ui/Menu.js —— 轻量浮层菜单
       *
       * 没有 react-dom（拿不到 createPortal），所以菜单就渲染在面板根内，用 `position: fixed`
       * 定位于锚点附近，并在布局后做视口钳制。祖先若有 transform 会让 fixed 退化，
       * 因此坐标钳制按「锚点相对视口的矩形」计算，最坏情况也只是偏移，不会不可用。
       */
      const { h, useEffect, useLayoutEffect, useRef, useState } = __m("./platform.js");
      const { Icon } = __m("./ui/Icon.js");

      const MARGIN = 8

      /**
       * 浮层容器。
       * @param {{open: boolean, anchorRect: DOMRect|null, onClose: () => void, minWidth?: number, children: any}} props
       */
      function PopupMenu(props) {
        const { open, anchorRect, onClose, minWidth = 200, children } = props
        const menuRef = useRef(null)
        const [placement, setPlacement] = useState(null)

        useLayoutEffect(() => {
          if (!open) {
            setPlacement(null)
            return
          }
          const node = menuRef.current
          const viewportW = window.innerWidth
          const viewportH = window.innerHeight
          const anchor = anchorRect
          const box = node.getBoundingClientRect()
          const width = Math.max(box.width, minWidth)
          const height = box.height

          let left = anchor.left
          if (left + width + MARGIN > viewportW) left = Math.max(MARGIN, viewportW - width - MARGIN)
          let top = anchor.bottom + 4
          if (top + height + MARGIN > viewportH) {
            const above = anchor.top - 4 - height
            top = above >= MARGIN ? above : Math.max(MARGIN, viewportH - height - MARGIN)
          }
          setPlacement({ left, top, width })
        }, [open, anchorRect, minWidth])

        useEffect(() => {
          if (!open) return undefined
          const onKeyDown = (event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              onClose()
            }
          }
          const onPointerDown = (event) => {
            const node = menuRef.current
            if (node !== null && node.contains(event.target)) return
            onClose()
          }
          window.addEventListener('keydown', onKeyDown, true)
          window.addEventListener('pointerdown', onPointerDown, true)
          return () => {
            window.removeEventListener('keydown', onKeyDown, true)
            window.removeEventListener('pointerdown', onPointerDown, true)
          }
        }, [open, onClose])

        if (!open) return null

        const style = placement === null
          ? { left: -9999, top: -9999, minWidth }
          : { left: placement.left, top: placement.top, minWidth: placement.width }

        return h('div', { className: 'dgp-menu-scrim', 'data-dgp-scrim': 'true' },
          h('div', {
            className: 'dgp-menu',
            ref: menuRef,
            style,
            role: 'menu',
            onPointerDown: (event) => event.stopPropagation()
          }, children))
      }

      /** 菜单项。`checked` 有值时显示勾选位（此时不再画 icon）；两种标记不要同时传。 */
      function MenuItem(props) {
        const { icon, label, sub, checked, disabled, onClick, danger, dataKey, badges } = props
        const left = checked === undefined
          ? (icon === undefined ? null : h(Icon, { name: icon, size: 14 }))
          : h('span', { className: 'dgp-menu-check', style: { width: 14, display: 'flex' } },
            checked ? h(Icon, { name: 'check', size: 14 }) : null)
        return h('button', {
          type: 'button',
          className: 'dgp-menu-item',
          role: 'menuitem',
          'data-checked': checked === true ? 'true' : undefined,
          'data-menu-key': dataKey === undefined ? undefined : dataKey,
          'data-danger': danger === true ? 'true' : undefined,
          disabled: disabled === true,
          title: props.title === undefined ? label : props.title,
          onClick: (event) => {
            event.preventDefault()
            event.stopPropagation()
            if (disabled !== true) onClick(event)
          }
        },
        left,
        h('span', { className: 'dgp-menu-item-main' }, label),
        // 分支这类条目用两个小标签表示「本地有 / 远程有」：亮 = 有，暗 = 没有
        Array.isArray(badges) && badges.length > 0
          ? h('span', { className: 'dgp-menu-badges' }, badges.map((badge) => h('span', {
            key: badge.label,
            className: 'dgp-menu-badge',
            'data-active': badge.active === true ? 'true' : 'false'
          }, badge.label)))
          : null,
        sub === undefined || sub === null ? null : h('span', { className: 'dgp-menu-item-sub' }, sub))
      }

      /** 菜单分组标题。 */
      function MenuLabel(props) {
        return h('div', { className: 'dgp-menu-label' }, props.children)
      }

      /** 分隔线。 */
      function MenuSeparator() {
        return h('div', { className: 'dgp-menu-sep', role: 'separator' })
      }

      Object.assign(exports, { PopupMenu, MenuItem, MenuLabel, MenuSeparator });

    });
    __define("./ui/useTimedNotice.js", (exports, module) => {
      /**
       * src/ui/useTimedNotice.js —— 会自己过期的操作结果提示
       *
       * 面板里有两种「操作结果」：工具条上一句（推送成功 / 检查更新结果 / 建分支结果），
       * 提交框状态行上一句（已提交 / 生成失败）。它们原先各写了一套定时清理，
       * 结果两边的存活时间不一样：提交结果 8 秒后消失，推送结果却一直挂在工具条上。
       *
       * 这里只定义一条规则，两处共用：
       *  · tone === 'info'（做成了什么事）→ 看一眼就够，ttl 后自动消失；
       *  · tone === 'warn' / 'error'（需要用户处理）→ 留着，直到下一次动作或用户自己关掉。
       */
      const { useCallback, useEffect, useRef, useState } = __m("./platform.js");

      /**
       * @param {number} ttlMs info 类提示的存活时间
       * @returns {[object|null, (notice: object|null) => void]}
       */
      function useTimedNotice(ttlMs) {
        const [notice, setNotice] = useState(null)
        const timerRef = useRef(null)

        const clearTimer = useCallback(() => {
          if (timerRef.current === null) return
          clearTimeout(timerRef.current)
          timerRef.current = null
        }, [])

        const show = useCallback((next) => {
          clearTimer()
          setNotice(next)
          if (next === null || next.tone !== 'info') return
          timerRef.current = setTimeout(() => {
            timerRef.current = null
            setNotice(null)
          }, ttlMs)
        }, [clearTimer, ttlMs])

        // 卸载时别把定时器留在后台（面板会被右侧栏页签切换反复挂载/卸载）。
        useEffect(() => clearTimer, [clearTimer])

        return [notice, show]
      }

      Object.assign(exports, { useTimedNotice });

    });
    __define("./ui/useSnapshotResource.js", (exports, module) => {
      /**
       * src/ui/useSnapshotResource.js —— 一个「有首屏快照、有请求序号、失败留在原地」的资源
       *
       * 远端详情、分支全貌、PR 详情、当前分支 PR 卡片原先各写了一遍同样的代码：
       * 读快照 → 置 loading → await → 序号守护 → 写快照 → catch 转人话。
       * 四份实现里已经有细微漂移（错误该不该保留上一份数据、loading 该不该保留旧画面）。
       * 这里把语义定死成三个开关，调用方只描述「key 怎么算、怎么取数、取到后做什么」：
       *
       *   snapshot     有快照就先渲染（默认 true）
       *   keepPrevious 刷新时保留上一份数据，列表/卡片不会先消失再出现
       *   keepOnError  失败时保留上一份数据（否则清空，让错误态独自占屏）
       *
       * 请求序号用 `useLatestGuard`：切仓库/切 PR 时，晚到的旧响应不会写进新选中项。
       * 快照只存成功结果（失败进缓存会把错误画面当成首屏）。
       */
      const { useCallback, useRef, useState } = __m("./platform.js");
      const { readSnapshot, writeSnapshot } = __m("./util/resource-cache.js");
      const { useLatestGuard } = __m("./store.js");
      const { describeError } = __m("./api.js");

      /**
       * @param {{
       *   keyOf?: (input: any) => string,        // 快照键；不传 = 不用快照
       *   load: (input: any) => Promise<any>,    // 取数；失败时抛 RpcError
       *   snapshot?: boolean,                     // 默认 true
       *   keepPrevious?: boolean,                 // 默认 false
       *   keepOnError?: boolean,                  // 默认 false
       *   onLoaded?: (input: any, data: any) => void,
       *   t: (key: string, params?: object) => string
       * }} options
       * @returns {{ state: {loading: boolean, error: string|null, data: any}|null, reload: (input: any) => Promise<any|null>, clear: () => void }}
       */
      function useSnapshotResource(options) {
        const { keyOf, load, snapshot = true, keepPrevious = false, keepOnError = false, onLoaded, t } = options
        const [state, setState] = useState(null)
        const stateRef = useRef(state)
        stateRef.current = state
        /**
         * 同步更新 state 与它的 ref。
         * 同一轮里先 clear() 再 reload() 时，reload 必须看到「已经清空」，
         * 否则 keepPrevious 会把上一个仓库的数据当成这一份继续渲染。
         */
        const apply = useCallback((next) => {
          stateRef.current = next
          setState(next)
        }, [])
        const guard = useLatestGuard()

        // 回调与翻译函数放进 ref：reload 的引用必须稳定，否则依赖它的 effect 每次渲染都重跑。
        const keyOfRef = useRef(keyOf)
        keyOfRef.current = keyOf
        const loadRef = useRef(load)
        loadRef.current = load
        const onLoadedRef = useRef(onLoaded)
        onLoadedRef.current = onLoaded
        const tRef = useRef(t)
        tRef.current = t

        const reload = useCallback(async (input) => {
          const token = guard.begin()
          if (input === null) {
            apply(null)
            return null
          }
          const key = keyOfRef.current === undefined ? null : keyOfRef.current(input)
          const cached = snapshot && key !== null ? readSnapshot(key) : undefined
          const previous = stateRef.current
          const previousData = keepPrevious && previous !== null ? previous.data : null
          const data = cached === undefined ? previousData : cached
          apply({ loading: data === null, error: null, data })
          try {
            const value = await loadRef.current(input)
            if (!guard.isLatest(token)) return null
            if (key !== null) writeSnapshot(key, value)
            if (onLoadedRef.current !== undefined) onLoadedRef.current(input, value)
            apply({ loading: false, error: null, data: value })
            return value
          } catch (error) {
            if (!guard.isLatest(token)) return null
            apply({
              loading: false,
              error: describeError(error, tRef.current),
              data: keepOnError ? previousData : null
            })
            return null
          }
        }, [guard, snapshot, keepPrevious, keepOnError, apply])

        // clear 也要让在途请求作废，否则旧响应会在清空之后把状态又写回来。
        const clear = useCallback(() => {
          guard.begin()
          apply(null)
        }, [guard, apply])

        return { state, reload, clear }
      }

      Object.assign(exports, { useSnapshotResource });

    });
    __define("./util/resource-cache.js", (exports, module) => {
      /**
       * src/util/resource-cache.js —— 首屏快照缓存（内存，模块级）
       *
       * 解决的是「切走再切回来」的卡顿：
       *   右侧栏 tab 被切走时组件会卸载，切回来时重新挂载 —— 状态全部归零，
       *   于是先骨架屏、再等 `project/resolve`、再等 `status`，一屏白两次。
       *
       * 这里存的是**上次成功结果的快照**：挂载时先同步渲染旧画面（零延迟），
       * 同时在后台重新验证。只有「从来没有过快照」时才显示骨架屏。
       *
       * 三条硬约束：
       *  1. 只放内存，不落 localStorage（快照是缓存，不是持久化数据）；
       *  2. 只存成功结果（失败不进缓存，否则会把错误画面当成首屏）；
       *  3. 有上限，满了淘汰最旧的键（Map 的插入序 + 重新 set 刷新位置）。
       */

      /** 缓存的键数量上限：面板一次会话也就几十个键，120 足够，且不会无限增长。 */
      const MAX_ENTRIES = 120

      /** key -> { value, at } */
      const entries = new Map()

      /** 读快照；没有就是 undefined（调用方据此决定要不要显示骨架屏）。 */
      function readSnapshot(key) {
        const entry = entries.get(key)
        return entry === undefined ? undefined : entry.value
      }

      /** 写入快照（成功结果才写）。已存在的键会被移到队尾，等价于 LRU 的「最近使用」。 */
      function writeSnapshot(key, value) {
        if (entries.has(key)) entries.delete(key)
        else if (entries.size >= MAX_ENTRIES) {
          const oldest = entries.keys().next()
          if (oldest.done !== true) entries.delete(oldest.value)
        }
        entries.set(key, { value, at: Date.now() })
      }

      /** 删除一个快照（例如根被移除、账号被删）。 */
      function dropSnapshot(key) {
        entries.delete(key)
      }

      /** 快照年龄（毫秒）；没有快照返回 Infinity。 */
      function snapshotAge(key) {
        const entry = entries.get(key)
        return entry === undefined ? Infinity : Date.now() - entry.at
      }

      /** 清空（测试用：保证每个用例从「没有快照」开始）。 */
      function clearSnapshots() {
        entries.clear()
      }

      Object.assign(exports, { readSnapshot, writeSnapshot, dropSnapshot, snapshotAge, clearSnapshots });

    });
    __define("./store.js", (exports, module) => {
      /**
       * src/store.js —— 显示偏好 + 每个工作区记住的选中项 + 两个通用 hook
       *
       * 放两类「跨会话应该记住」的东西：
       *   · 显示偏好（mode/diffView/leftWidth…）：全局一份，见 usePref；
       *   · 每个工作区自己的选中项（目前是「远端」页签选中的账号）：按项目根分开记，
       *     见 readRemoteAccount / saveRemoteAccount。
       * status/diff 数据与文件/仓库选中项都是每次重新取的组件状态，不进这里。
       *
       * 都存在 localStorage 里；读取时只做「结构校验 + 数值钳制」，
       * 保证手改/旧版本残留的坏数据不会把面板布局搞坏。
       */
      const { useCallback, useEffect, useMemo, useRef, useState } = __m("./platform.js");

      const MODE = { changes: 'changes', files: 'files', remote: 'remote' }

      /** 三个页签的顺序（工具条与偏好校验共用）。 */
      const MODES = [MODE.changes, MODE.files, MODE.remote]

      const STORAGE_KEY = 'dsh-git-panel:prefs:v1'

      const DEFAULTS = {
        mode: MODE.changes,
        diffView: 'unified',
        wrap: false,
        contextLines: 3,
        ignoreWhitespace: false,
        autoRefresh: true,
        leftWidth: 264,
        collapsedGroups: {},
        /** 「储存库」区域的展开状态（只在有多个仓库时出现）。 */
        repositoriesOpen: true,
        /** 变更列表显示方式：list = 一行一个文件（文件名 + 弱化路径），tree = 按文件夹展开。 */
        changesView: 'list',
        /** 未跟踪文件：merge = 并进「未暂存」（VS Code 行为），separate = 单列「未跟踪」组。 */
        untrackedMode: 'merge',
        /** 提交成功后是否自动推送当前分支（对应 VS Code 的 git.postCommitCommand，默认开）。 */
        postCommitPush: true,
        /** 创建 PR 时上次选的目标分支：{ '<provider>:<owner/repo>': 'dev' } */
        pullTargets: {},
        /** 已读评论水位：{ '<accountId>#<number>': 已读条数 } */
        pullSeen: {}
      }

      /** 未跟踪文件的两种呈现方式（设置页与分组逻辑共用）。 */
      const UNTRACKED_MODES = ['merge', 'separate']

      /** 变更列表的两种显示方式（设置页与 ⋯ 菜单共用）。 */
      const CHANGES_VIEWS = ['list', 'tree']

      const GROUPS = ['conflicted', 'staged', 'unstaged', 'untracked']

      /** 把任意输入收敛成合法的偏好对象。 */
      function sanitize(input) {
        const out = { ...DEFAULTS }
        if (MODES.includes(input.mode)) out.mode = input.mode
        if (input.diffView === 'unified' || input.diffView === 'split') out.diffView = input.diffView
        if (typeof input.wrap === 'boolean') out.wrap = input.wrap
        if (typeof input.ignoreWhitespace === 'boolean') out.ignoreWhitespace = input.ignoreWhitespace
        if (typeof input.autoRefresh === 'boolean') out.autoRefresh = input.autoRefresh
        if (Number.isFinite(input.contextLines)) {
          out.contextLines = Math.min(20, Math.max(0, Math.round(input.contextLines)))
        }
        if (Number.isFinite(input.leftWidth)) {
          out.leftWidth = Math.min(720, Math.max(180, Math.round(input.leftWidth)))
        }
        if (typeof input.repositoriesOpen === 'boolean') out.repositoriesOpen = input.repositoriesOpen
        if (CHANGES_VIEWS.includes(input.changesView)) out.changesView = input.changesView
        if (UNTRACKED_MODES.includes(input.untrackedMode)) out.untrackedMode = input.untrackedMode
        if (typeof input.postCommitPush === 'boolean') out.postCommitPush = input.postCommitPush
        if (input.pullSeen !== null && typeof input.pullSeen === 'object' && !Array.isArray(input.pullSeen)) {
          const seen = {}
          for (const [key, value] of Object.entries(input.pullSeen)) {
            if (typeof key === 'string' && key !== '' && Number.isInteger(value) && value >= 0) seen[key] = value
          }
          out.pullSeen = seen
        }
        if (input.pullTargets !== null && typeof input.pullTargets === 'object' && !Array.isArray(input.pullTargets)) {
          const targets = {}
          for (const [key, value] of Object.entries(input.pullTargets)) {
            if (typeof key === 'string' && key !== '' && typeof value === 'string' && value !== '') targets[key] = value
          }
          out.pullTargets = targets
        }
        if (input.collapsedGroups && typeof input.collapsedGroups === 'object') {
          const groups = {}
          for (const key of GROUPS) if (input.collapsedGroups[key] === true) groups[key] = true
          out.collapsedGroups = groups
        }
        return out
      }

      /** 读全部偏好（含默认值兜底由 loadPrefs 内部处理）。 */
      function readPrefs() {
        return loadPrefs()
      }

      /** 写一个偏好键（与已有值合并）。 */
      function writePref(key, value) {
        savePrefs({ [key]: value })
      }

      function loadPrefs() {
        let raw = null
        try {
          raw = localStorage.getItem(STORAGE_KEY)
        } catch {
          return { ...DEFAULTS }
        }
        if (raw === null) return { ...DEFAULTS }
        try {
          return sanitize(JSON.parse(raw))
        } catch {
          return { ...DEFAULTS }
        }
      }

      function savePrefs(patch) {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadPrefs(), ...patch }))
        } catch {
          /* 隐私模式/配额满时静默：偏好存不下不影响当前会话 */
        }
      }

      /**
       * 一个会持久化到 localStorage 的 state。
       *
       * 持久化放在 effect 里而不是 setter 的 updater 里：updater 必须是纯函数
       * （并发渲染 / StrictMode 下会被重复执行），而且拖拽分栏时每一次 pointermove
       * 都写一遍整个偏好 JSON 会直接拖慢拖动。effect 在一次提交后只跑一次。
       *
       * @param {string} key DEFAULTS 的键
       */
      function usePref(key) {
        const [value, setValue] = useState(() => loadPrefs()[key])
        useEffect(() => {
          savePrefs({ [key]: value })
        }, [key, value])
        return [value, setValue]
      }

      /* ==================== 每个工作区记住的远端账号 ==================== */

      /**
       * 「远端」页签选中的账号按工作区记：`{ "<projectRoot>": "<accountId>" }`。
       *
       * 为什么按工作区：账号列表是全局的（DSH 凭据服务里一份），但每个项目日常用的账号
       * 往往不同（工作号 / 私人号 / 内网 Gitee）。只存组件状态的话，切到别的工作区再回来、
       * 或者重新打开面板，都会退回账号列表的第一个 —— 每切一次就要重选一次。
       *
       * 工作区身份直接用宿主下发的 projectRoot：它已经是 `path.resolve` + 正斜杠的绝对路径，
       * 同一工作区每次解析都是同一个值。客户端不再自己折叠大小写 / 斜杠 —— 那是宿主的事，
       * 在这边猜反而会出现「同一目录两个键」。
       *
       * 只存账号 id（`provider:login`），不存任何令牌。localStorage 可能被手改 / 写坏，
       * 读的时候只保留「非空字符串 → 非空字符串」的条目；坏数据当作没记过，不抛异常。
       */
      const REMOTE_ACCOUNTS_KEY = 'dsh-git-panel:remote-accounts:v1'

      function readRemoteAccounts() {
        let raw = null
        try {
          raw = localStorage.getItem(REMOTE_ACCOUNTS_KEY)
        } catch {
          return {}
        }
        if (raw === null) return {}
        let parsed
        try {
          parsed = JSON.parse(raw)
        } catch {
          return {}
        }
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
        const out = {}
        for (const [workspace, accountId] of Object.entries(parsed)) {
          if (typeof accountId !== 'string' || accountId === '') continue
          out[workspace] = accountId
        }
        return out
      }

      /**
       * 某个工作区上次在「远端」页签选中的账号 id。
       * @param {string} projectRoot 宿主下发的项目根
       * @returns {string|null} 没记过时返回 null
       */
      function readRemoteAccount(projectRoot) {
        const accountId = readRemoteAccounts()[projectRoot]
        return accountId === undefined ? null : accountId
      }

      /**
       * 记住某个工作区在「远端」页签选中的账号。
       * @param {string} projectRoot 宿主下发的项目根
       * @param {string} accountId 账号 id（`provider:login`）
       */
      function saveRemoteAccount(projectRoot, accountId) {
        const accounts = readRemoteAccounts()
        accounts[projectRoot] = accountId
        try {
          localStorage.setItem(REMOTE_ACCOUNTS_KEY, JSON.stringify(accounts))
        } catch {
          /* 隐私模式/配额满：记不住不影响当前会话 */
        }
      }

      /**
       * 只保留最新一次异步结果的守护器。
       *
       * 返回对象必须**引用稳定**：调用方普遍写成
       *   const refresh = useCallback(..., [guard]);  useEffect(..., [refresh])
       * 每次返回新对象会让 refresh 每次渲染都变，effect 就会每渲染重跑 ——
       * 那会变成「取数 → 渲染 → 再取数」的死循环。
       */
      function useLatestGuard() {
        const seqRef = useRef(0)
        const begin = useCallback(() => {
          seqRef.current += 1
          return seqRef.current
        }, [])
        const isLatest = useCallback((token) => token === seqRef.current, [])
        return useMemo(() => ({ begin, isLatest }), [begin, isLatest])
      }

      Object.assign(exports, { MODE, readPrefs, writePref, usePref, readRemoteAccount, saveRemoteAccount, useLatestGuard });

    });
    __define("./api.js", (exports, module) => {
      /**
       * src/api.js —— 宿主 RPC 封装
       *
       * 线上协议：
       *   客户端  ctx.connection.rpc.call('/api', 'dsh-git/<endpoint>', payload, signal)
       *   宿主端  connection.fetch.register({ path: '/api/dsh-git/<endpoint>', … })
       *   返回封套 { ok: true, value } | { ok: false, error: { code, message, details } }
       *
       * 这里只做三件事：拆封套、加超时、把错误归一成带 code 的 RpcError。
       * 不做通道/服务的降级尝试 —— apply(ctx) 的 inject 已保证 connection 存在。
       */
      const { getPluginContext } = __m("./platform.js");

      const RPC_CHANNEL = '/api'
      /** 本插件的路由命名空间：宿主注册为 `/api/dsh-git/<endpoint>`。 */
      const RPC_NAMESPACE = 'dsh-git'

      const TIMEOUT_MS = 20_000

      /** 归一化后的 RPC 错误（渲染层只认 code 与 message）。 */
      class RpcError extends Error {
        constructor(code, message, details) {
          super(message)
          this.name = 'RpcError'
          this.code = code
          this.details = details === undefined || details === null ? {} : details
        }
      }

      /** 宿主错误码 → 文案 key；没列出的码一律走 error.generic 并带上服务端原文。 */
      const MESSAGE_KEYS = {
        'git-missing': 'error.gitMissing',
        'not-a-repository': 'error.notRepository',
        'timeout': 'error.timeout',
        'outside-root': 'error.outsideRoot',
        'forbidden-path': 'error.outsideRoot',
        'no-session': 'status.noSession',
        'no-cwd': 'status.noCwd',
        'no-commit-model': 'commit.noModel',
        'nothing-to-commit': 'commit.nothing',
        'unmerged': 'commit.unmerged',
        'no-llm': 'settings.noLlm',
        'unknown-model': 'settings.unknownModel',
        // 模型失败的原因由宿主翻成人话（余额不足 / 密钥 / 限流 / 断网…），
        // 这里只加一句上下文；不用提交说明专用的文案，因为同一个码也会出现在 AI 审阅与 PR 文案里。
        'model-failed': 'error.modelFailed',
        'model-truncated': 'error.modelFailed',
        // PR 有冲突不是「鉴权失败」：Gitee 用 403 表达冲突，宿主已按响应体区分成 pull-conflict
        'pull-conflict': 'pull.conflict'
      }

      /**
       * 调一个 host 端点。
       * @param {string} endpoint
       * @param {object} payload
       * @param {{signal?: AbortSignal, timeoutMs?: number}} [options]
       */
      async function call(endpoint, payload, options) {
        const opts = options ?? {}
        const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        const forward = () => controller.abort()
        if (opts.signal !== undefined) opts.signal.addEventListener('abort', forward, { once: true })

        let envelope
        try {
          envelope = await getPluginContext().connection.rpc.call(
            RPC_CHANNEL,
            RPC_NAMESPACE + '/' + endpoint,
            payload ?? {},
            controller.signal
          )
        } catch (error) {
          if (opts.signal !== undefined && opts.signal.aborted) throw new RpcError('aborted', '已取消')
          if (controller.signal.aborted) throw new RpcError('timeout', '请求超时')
          throw new RpcError('transport', error instanceof Error ? error.message : String(error))
        } finally {
          clearTimeout(timer)
          if (opts.signal !== undefined) opts.signal.removeEventListener('abort', forward)
        }

        if (envelope.ok === true) return envelope.value
        throw new RpcError(envelope.error.code, envelope.error.message, envelope.error.details)
      }

      /** 给单个端点一个更长的超时；调用方显式传了 timeoutMs 就以它为准。 */
      function withTimeout(options, timeoutMs) {
        return { ...(options ?? {}), timeoutMs: options?.timeoutMs ?? timeoutMs }
      }

      /* ============================ 具体端点 ============================ */

      /** 解析项目的 git 根（primary / 浏览根 / discovered / extra）。 */
      function resolveProject(payload, options) {
        return call('project/resolve', payload, options)
      }

      /** 读某个根的 status。 */
      function readStatus(payload, options) {
        return call('status', payload, options)
      }

      /** 读单个文件的 diff（path 相对 repoRoot）。 */
      function readDiff(payload, options) {
        return call('diff', payload, options)
      }

      /** 读文件文本内容（path 相对 rootPath）。 */
      function readFile(payload, options) {
        return call('file/read', payload, options)
      }

      /** 检测更新：宿主执行 `git fetch` 后返回最新 ahead/behind（只读，不动工作区）。 */
      function fetchRemote(payload, options) {
        return call('remote/fetch', payload, options)
      }

      /** 保存文件内容（path 相对 rootPath；expectedHash 是乐观并发凭据，force 只在确认覆盖后用）。 */
      function writeFile(payload, options) {
        return call('file/write', payload, options)
      }

      /** 暂存 / 取消暂存单个文件（path 相对仓库根；action 为 stage 或 unstage）。 */
      function stageFile(payload, options) {
        return call('index/stage', payload, options)
      }

      /** 整组暂存 / 取消暂存（scope 为 stage-unstaged / stage-untracked / unstage）。 */
      function stageGroup(payload, options) {
        return call('index/stage-group', payload, options)
      }

      /** 代码托管账号列表（列表接口不含 token）。 */
      function listAccounts(payload, options) {
        return call('accounts/list', payload, options)
      }

      function addAccount(payload, options) {
        return call('accounts/add', payload, options)
      }

      /** 改备注名 / 换令牌（换令牌会先验证）。 */
      function updateAccount(payload, options) {
        return call('accounts/update', payload, options)
      }

      /** 取令牌原文：只在用户点「显示」时调用。 */
      function readAccountToken(payload, options) {
        return call('accounts/token', payload, options)
      }

      function removeAccount(payload, options) {
        return call('accounts/remove', payload, options)
      }

      /** 列某个账号下的仓库（一页 100 条）。 */
      function listRemoteRepos(payload, options) {
        return call('remote/repos', payload, options)
      }

      /** 仓库详情：代码概况 + 未关闭 issue/PR 数量 + 最近条目。 */
      function remoteDetail(payload, options) {
        return call('remote/detail', payload, options)
      }

      /** 批量取若干仓库的未合并 PR 数量。 */
      function remotePullCounts(payload, options) {
        return call('remote/pr-counts', payload, options)
      }

      /** 一个 PR 的详情（含平台能力与审查记录；也带回变动文件清单，最多 300 个）。 */
      function remotePull(payload, options) {
        // 详情现在会顺带读文件清单（最多 6 页）：默认 20s 对慢网络不够
        return call('remote/pull', payload, withTimeout(options, 60_000))
      }

      /** 提交审查结论。 */
      function remotePullReview(payload, options) {
        return call('remote/pull/review', payload, options)
      }

      /** 标记 PR 测试通过（Gitee 的合并门禁之一）。 */
      function remotePullTest(payload, options) {
        return call('remote/pull/test', payload, options)
      }

      /** PR 里单个文件的 diff（点开文件行时按需读；返回已解析的 hunk）。 */
      function remotePullFile(payload, options) {
        return call('remote/pull/file', payload, withTimeout(options, 60_000))
      }

      /** 调审阅模型给出结构化结论。 */
      function remotePullAiReview(payload, options) {
        // 模型调用本身就慢：默认 20s 会让客户端先超时，而宿主还在跑
        return call('remote/pull/ai-review', payload, withTimeout(options, 240_000))
      }

      /** 深度审阅：宿主拉取 PR head 到临时 worktree，读完整文件后再让模型审。 */
      function remotePullPrepareReview(payload, options) {
        // 阶段一：找仓库 / 判断是否已在 PR 提交 / 切分支（必要时才 fetch）
        return call('remote/pull/prepare-review', payload, withTimeout(options, 600_000))
      }

      function remotePullSessionReview(payload, options) {
        return call('remote/pull/session-review', payload, withTimeout(options, 600_000))
      }

      /** 把 PR 克隆到指定目录（深度审阅前的准备步骤）。 */
      function remotePullCloneForReview(payload, options) {
        return call('remote/pull/clone-for-review', payload, withTimeout(options, 900_000))
      }

      /** 关闭 / 重新打开 PR（state: 'open' | 'closed'）。 */
      function remotePullState(payload, options) {
        return call('remote/pull/state', payload, options)
      }

      /** 提交用户确认过的 PR 评论。 */
      function remotePullComment(payload, options) {
        return call('remote/pull/comment', payload, options)
      }

      /** 一键「审查与测试都通过」（按平台能力执行）。 */
      function remotePullPass(payload, options) {
        return call('remote/pull/pass', payload, options)
      }

      /** 合并 PR。 */
      function remotePullMerge(payload, options) {
        return call('remote/pull/merge', payload, options)
      }

      /** 把远端仓库克隆到项目根下的子目录。 */
      function cloneRemoteRepo(payload, options) {
        return call('remote/clone', payload, options)
      }

      /** 从储存库隐藏一个根（持久化；项目本身不可隐藏）。 */
      function hideRoot(payload, options) {
        return call('roots/hide', payload, options)
      }

      /** 取消隐藏。 */
      function unhideRoot(payload, options) {
        return call('roots/unhide', payload, options)
      }

      /**
       * 「储存库」行的改动规模：每个仓库的改动文件数与增删行数。
       *
       * 一次请求查完所有仓库（宿主内部限并发，并能命中 status 缓存）；单个仓库失败只影响它自己那一行。
       */
      function rootStats(payload, options) {
        return call('roots/stats', payload, withTimeout(options, 60_000))
      }

      /** 列出本地分支 + 分支菜单需要的仓库现状（`state`：HEAD / 进行中操作 / 脏计数）。 */
      function listBranches(payload, options) {
        return call('branches/list', payload, options)
      }

      /**
       * 远端仓库的分支全貌：远端分支（平台 API）+ 本地同名分支状态（rootPaths 里 origin
       * 匹配到的本地仓库），合成一条列表。远端/本地任一侧失败只记在 failures 里。
       */
      function remoteBranches(payload, options) {
        return call('remote/branches', payload, options)
      }

      /** 删除本地分支（force 只在用户确认「强制删除」后用）。 */
      function deleteLocalBranch(payload, options) {
        return call('branch/delete', payload, options)
      }

      /** 删除远端分支（破坏性，界面上必须二次确认）。 */
      function deleteRemoteBranch(payload, options) {
        return call('remote/branch/delete', payload, options)
      }

      /** 把「仅远程」的分支建成本地跟踪分支并切过去。 */
      function trackBranch(payload, options) {
        return call('branch/track', payload, options)
      }

      /** 切换分支（工作区怎么处理交给 git）。 */
      function switchBranch(payload, options) {
        return call('branch/switch', payload, options)
      }

      /**
       * 创建分支：`base` 是创建基准、`checkout` 决定建完是否切过去。
       *
       * 基准是当前 HEAD 时未提交改动原样跟随（git 只写 ref 与 HEAD，不碰工作区）；
       * 跨基准撞车时宿主报 `would-overwrite`（details 里有文件清单，且仓库没被改动），
       * 界面据此换成「从当前分支创建」或「只建分支」再试一次。
       */
      function createBranch(payload, options) {
        return call('branch/create', payload, options)
      }

      /**
       * 推送当前分支到 origin（`git push --set-upstream origin <当前分支>`，用本机 git 凭据）。
       *
       * 网络写操作：超时给到 5 分钟。认证失败（`git-auth-failed`）与「远端有你没有的提交」
       * （`not-fast-forward`）都带可操作原因，界面直接显示宿主原文。
       */
      function pushBranch(payload, options) {
        return call('branch/push', payload, withTimeout(options, 300_000))
      }

      /**
       * 收尾「远端分支已被删除」的本地分支：`fetch --prune` → 切回默认分支 → 快进 → 删本地分支。
       * 是一串网络 + 本地写操作，超时给足；失败时会把已完成的步骤一起返回，界面如实显示。
       */
      function cleanupBranch(payload, options) {
        return call('branch/cleanup', payload, withTimeout(options, 300_000))
      }

      /** 提交：有暂存只提交暂存，没有则先全部暂存。 */
      function commitChanges(payload, options) {
        return call('commit', payload, options)
      }

      /** 按设置里的模型生成提交说明。 */
      function commitMessage(payload, options) {
        return call('commit/message', payload, withTimeout(options, 130_000))
      }

      /** 创建 PR 前的准备信息（仓库 / 账号 / 源分支 / 目标分支候选 / 是否已推送）。 */
      function prPrepare(payload, options) {
        return call('pr/prepare', payload, options)
      }

      /** 拉取当前分支最新代码（fetch + 只允许快进）。 */
      function pullBranch(payload, options) {
        return call('branch/pull', payload, withTimeout(options, 300_000))
      }

      /** 当前安装的插件版本（本地读，不联网）。 */
      function pluginInfo(payload, options) {
        return call('plugin/info', payload, options)
      }

      /** 检查插件是否有新版本（GitHub 最新 release）。 */
      function pluginUpdate(payload, options) {
        return call('plugin/update', payload, withTimeout(options, 30_000))
      }

      /** 当前分支关联的 PR 摘要（没有关联 PR 时 linked:false + reason）。 */
      function prLinked(payload, options) {
        return call('pr/linked', payload, options)
      }

      /** 用模型生成 PR 标题与描述。 */
      function prGenerate(payload, options) {
        return call('pr/generate', payload, withTimeout(options, 120_000))
      }

      /** 创建 PR。 */
      function prCreate(payload, options) {
        return call('pr/create', payload, withTimeout(options, 120_000))
      }

      /** 模型目录（来自 profile 的 llm-pi-ai 配置）。 */
      function listModels(payload, options) {
        return call('models/list', payload, options)
      }

      /** 读插件设置。 */
      function readSettings(payload, options) {
        return call('settings/get', payload, options)
      }

      /** 保存插件设置。 */
      function writeSettings(payload, options) {
        return call('settings/set', payload, options)
      }

      /** 列目录（path 相对 rootPath）。 */
      function listDirectory(payload, options) {
        return call('tree/list', payload, options)
      }

      /** 添加外部仓库根。 */
      function addRoot(payload, options) {
        return call('roots/add', payload, options)
      }

      /** 移除外部仓库根。 */
      function removeRoot(payload, options) {
        return call('roots/remove', payload, options)
      }

      /**
       * 把错误渲染成一句用户能懂的话。
       *
       * `message` 必须传下去：像「生成提交说明失败：{message}」这种带占位符的文案，
       * 不传就只剩字面的 `{message}`，用户永远看不到真正原因（曾经就是这样）。
       */
      function describeError(error, t) {
        const code = error === null || error === undefined ? '' : error.code
        const message = error instanceof Error
          ? error.message
          : (typeof error === 'string' ? error : String(error ?? ''))
        const key = MESSAGE_KEYS[code]
        if (key !== undefined) return t(key, { message })
        return t('error.generic', { message })
      }

      Object.assign(exports, { call, resolveProject, readStatus, readDiff, readFile, fetchRemote, writeFile, stageFile, stageGroup, listAccounts, addAccount, updateAccount, readAccountToken, removeAccount, listRemoteRepos, remoteDetail, remotePullCounts, remotePull, remotePullReview, remotePullTest, remotePullFile, remotePullAiReview, remotePullPrepareReview, remotePullSessionReview, remotePullCloneForReview, remotePullState, remotePullComment, remotePullPass, remotePullMerge, cloneRemoteRepo, hideRoot, unhideRoot, rootStats, listBranches, remoteBranches, deleteLocalBranch, deleteRemoteBranch, trackBranch, switchBranch, createBranch, pushBranch, cleanupBranch, commitChanges, commitMessage, prPrepare, pullBranch, pluginInfo, pluginUpdate, prLinked, prGenerate, prCreate, listModels, readSettings, writeSettings, listDirectory, addRoot, removeRoot, describeError });

    });
    __define("./components/RepoList.js", (exports, module) => {
      /**
       * src/components/RepoList.js —— 「储存库」区域（VS Code 的 Repositories）
       *
       * 结构：
       *   div.dgp-repolist
       *   ├─ div.dgp-repolist-head
       *   │  ├─ button.dgp-repolist-toggle   ← 折叠/展开，带数量
       *   │  ├─ button[data-dgp-repolist-hidden] ← 有隐藏仓库时才出现：展开/收起它们
       *   │  └─ button[data-action=add-root] ← 添加外部仓库
       *   ├─ ul.dgp-level
       *   │  └─ li > div.dgp-row-wrap
       *   │     ├─ button.dgp-repo-row[data-dgp-repo][data-hidden] ← 只选中该仓库，不打开分支菜单
       *   │     ├─ span.dgp-repo-stats[data-dgp-repo-stats]        ← 改动文件数 + 增删行数（有改动才出现）
       *   │     ├─ button.dgp-repo-branch[data-dgp-branch] ← 贴在行的最右侧；只有点它才打开分支菜单
       *   │     └─ AddRootForm / 分支菜单（菜单里也能隐藏 / 取消隐藏 / 移除）
       *
       * 分支菜单的取数、切换与创建都通过 props 交给 Panel：这里只负责交互与错误呈现，
       * 切换失败（例如本地改动会被覆盖）原样显示 git 的话，让用户自己决定怎么处理。
       */
      const { h, useRef, useState } = __m("./platform.js");
      const { Icon } = __m("./ui/Icon.js");
      const { MenuItem, MenuLabel, PopupMenu } = __m("./ui/Menu.js");
      const { AddRootForm } = __m("./components/AddRootForm.js");
      const { stripWrappingQuotes } = __m("./util/paths.js");

      /**
       * 分支菜单的初始状态。
       *
       * 打开菜单与「根操作失败后重开菜单」共用这一份：字段集合（尤其 `state` / `base` /
       * `checkout` / `blocked`）只在这里定义一次，不至于两处各写一遍慢慢长歪。
       */
      function emptyBranchMenu(root, rect, seq) {
        return {
          root,
          rect,
          seq,
          list: [],
          current: null,      // branches/list 的 current：当前分支名（游离 HEAD 时为 null）
          state: null,        // branches/list 的 state：head / detached / unborn / inProgress / dirty
          loading: true,
          switching: null,
          creating: false,
          fetching: false,
          pulling: false,
          name: '',
          base: 'HEAD',       // 创建基准；'HEAD' = 从当前 HEAD 建（零风险路径）
          checkout: true,     // 建完是否立刻切过去
          blocked: null,      // 撞车说明（would-overwrite 的 message），非空时只给两个出口
          error: null,
          filter: ''
        }
      }

      /**
       * 「从哪开新分支」的候选：当前分支 + 其它本地分支 + 远端分支。
       *
       * 数据全部来自 `branches/list`，所以切换它不需要任何额外请求。
       * 选项带上「（本地）/（远端）」后缀：只写 `origin/dev` 对不熟 git 的人等于天书。
       */
      function baseOptionsOf(branches, current, t) {
        const options = [{ ref: 'HEAD', label: t('branch.baseHead', { branch: current ?? t('root.noBranch') }) }]
        const seen = new Set(['HEAD'])
        // 先本地分支、再远端引用：本地分支是更常用的起点，混在一起会把列表打散
        for (const branch of branches) {
          if (branch.local !== true || branch.current === true || seen.has(branch.name)) continue
          seen.add(branch.name)
          options.push({ ref: branch.name, label: t('branch.baseLocalOption', { name: branch.name }) })
        }
        for (const branch of branches) {
          if (branch.remote === null) continue
          const ref = branch.remote + '/' + branch.name
          if (seen.has(ref)) continue
          seen.add(ref)
          options.push({ ref, label: t('branch.baseRemoteOption', { ref }) })
        }
        return options
      }

      /** 输入的名字恰好是一个「仅远端」分支时，返回 `origin/x`（提示用，不改变默认行为）。 */
      function sameRemoteOf(branches, name) {
        if (name === '') return null
        for (const branch of branches) {
          if (branch.name !== name || branch.local === true) continue
          if (branch.remote !== null) return branch.remote + '/' + name
        }
        return null
      }

      /** 进行中的多步操作 → 文案 key。 */
      const PROGRESS_KEYS = {
        merge: 'branch.progressMerge',
        rebase: 'branch.progressRebase',
        'cherry-pick': 'branch.progressCherryPick',
        revert: 'branch.progressRevert'
      }

      /** 分支多到这个数才放筛选框：少数分支时它只是噪音。 */
      const BRANCH_FILTER_THRESHOLD = 8

      function RepoList(props) {
        const { roots, activeRootId, open, stats, onToggleOpen, onSelect, onAdd, onHide, onUnhide, onRemove, onLoadBranches, onSwitchBranch, onTrackBranch, onPullBranch, onFetchBranches, onCreateBranch, t } = props
        const [formOpen, setFormOpen] = useState(false)
        /** 已隐藏的仓库默认收起；这里只记「要不要放出来看」，持久化的是隐藏列表本身。 */
        const [showHidden, setShowHidden] = useState(false)
        const [branchMenu, setBranchMenu] = useState(null)
        /** 菜单世代号：晚到的响应只能写回「发起它的那一次打开」的菜单。 */
        const menuSeqRef = useRef(0)

        if (roots.length === 0) return null

        const visibleRoots = roots.filter((root) => root.hidden !== true)
        const hiddenRoots = roots.filter((root) => root.hidden === true)
        const listedRoots = showHidden ? visibleRoots.concat(hiddenRoots) : visibleRoots

        const closeForm = () => setFormOpen(false)
        const closeBranches = () => setBranchMenu(null)

        /**
         * 打开一份新菜单：seq 自增一次。
         * 之后所有异步结果都带着这个 seq 回来，只写回同一次打开的菜单 ——
         * 否则「点 A 建分支 → 关掉 → 再打开 A → 旧响应落地」会把旧错误/旧列表画上去。
         */
        const openBranches = (root, rect) => {
          menuSeqRef.current += 1
          setBranchMenu(emptyBranchMenu(root, rect, menuSeqRef.current))
        }

        /** 同步修补当前菜单（输入框、勾选框这类只可能属于屏幕上这一份菜单的操作）。 */
        const patchMenu = (patch) => {
          setBranchMenu((previous) => (previous === null ? null : { ...previous, ...patch }))
        }

        /** 异步结果：只写给「发起它的同一份菜单」。 */
        const patchMenuFor = (menu, patch) => {
          setBranchMenu((previous) => (previous !== null && previous.seq === menu.seq ? { ...previous, ...patch } : previous))
        }

        /** 异步成功：只有菜单还停在发起它的那一份时才关掉。 */
        const closeMenuFor = (menu) => {
          setBranchMenu((previous) => (previous !== null && previous.seq === menu.seq ? null : previous))
        }

        /** 隐藏 / 取消隐藏 / 移除：都从分支菜单触发，执行后关掉菜单；失败就把菜单重开在最上面报错。 */
        const runRootAction = (handler, root) => {
          closeBranches()
          handler(root).catch((error) => {
            menuSeqRef.current += 1
            setBranchMenu({
              ...emptyBranchMenu(root, null, menuSeqRef.current),
              loading: false,
              error: error.message
            })
          })
        }

        const loadBranches = (root, rect) => {
          openBranches(root, rect)
          const menu = { root, seq: menuSeqRef.current }
          onLoadBranches(root).then((value) => {
            patchMenuFor(menu, {
              list: value.branches,
              current: value.current,
              state: value.state,
              loading: false,
              // 合并 / 变基进行中 git 不允许切分支：默认就落在「只建分支」上，不摆一个必然失败的勾选
              checkout: value.state.inProgress === null
            })
          }, (error) => {
            patchMenuFor(menu, { loading: false, error: error.message })
          })
        }

        const chooseBranch = (menu, name) => {
          patchMenu({ switching: name, error: null })
          onSwitchBranch(menu.root, name).then(() => closeMenuFor(menu), (error) => {
            patchMenuFor(menu, { switching: null, error: error.message })
          })
        }

        /**
         * 拉取当前分支最新代码（真正的 pull）。
         * 与「获取远程更新」不同：那只是 fetch（更新远端跟踪引用），不会改工作区文件。
         */
        const pullCurrent = (menu) => {
          patchMenu({ pulling: true, error: null })
          onPullBranch(menu.root).then(() => closeMenuFor(menu), (error) => {
            patchMenuFor(menu, { pulling: false, error: error.message })
          })
        }

        /** 拉取远程更新（git fetch）后重读分支列表：别人新推的分支这时才会出现。 */
        const fetchRemote = (menu) => {
          patchMenu({ fetching: true, error: null, blocked: null })
          onFetchBranches(menu.root).then((value) => {
            patchMenuFor(menu, {
              fetching: false,
              list: value.branches,
              current: value.current,
              state: value.state
            })
          }, (error) => {
            patchMenuFor(menu, { fetching: false, error: error.message })
          })
        }

        /** 「仅远程」的分支：建本地跟踪分支并切过去。 */
        const trackBranch = (menu, branch) => {
          patchMenu({ switching: branch.ref, error: null })
          onTrackBranch(menu.root, branch).then(() => closeMenuFor(menu), (error) => {
            patchMenuFor(menu, { switching: null, error: error.message })
          })
        }

        const changeCreateName = (value) => patchMenu({ name: value, error: null, blocked: null })
        const changeBase = (value) => patchMenu({ base: value, error: null, blocked: null })
        const changeCheckout = (value) => patchMenu({ checkout: value, error: null, blocked: null })

        /**
         * 创建分支：默认从当前 HEAD 建并切过去。
         *
         * `overrides` 是撞车后两个出口用的（改为从当前分支创建 / 只建分支），
         * 它们都是「同一件事换个参数重试一次」，所以共用这一条路径。
         */
        const runCreate = (menu, overrides = {}) => {
          const name = stripWrappingQuotes(menu.name)
          if (name === '' || menu.creating || menu.switching !== null) return
          const base = overrides.base ?? menu.base
          const checkout = overrides.checkout ?? menu.checkout
          patchMenuFor(menu, { ...overrides, name, creating: true, error: null, blocked: null })
          onCreateBranch(menu.root, { name, base, checkout }).then(() => closeMenuFor(menu), (error) => {
            patchMenuFor(menu, {
              creating: false,
              error: error.message,
              // 撞车不是「失败」而是「需要换个选择」：单独呈现，并给出两个零风险出口
              blocked: error.code === 'would-overwrite' ? error.message : null
            })
          })
        }

        const menuBranches = branchMenu === null ? [] : branchMenu.list
        /** 副标题只留会变化的信息：↑n ↓m，或上游被删 */
        const branchMeta = (branch) => {
          const parts = []
          if (branch.upstreamGone === true) parts.push(t('branch.upstreamGone'))
          if (branch.ahead > 0) parts.push('↑' + branch.ahead)
          if (branch.behind > 0) parts.push('↓' + branch.behind)
          return parts.join(' ')
        }
        const branchBadges = (branch) => [
          { label: t('branch.localTag'), active: branch.local === true },
          { label: t('branch.remoteTag'), active: branch.remote !== null }
        ]

        const menuBusy = branchMenu !== null && (branchMenu.switching !== null || branchMenu.creating || branchMenu.fetching || branchMenu.pulling)
        const createName = branchMenu === null ? '' : stripWrappingQuotes(branchMenu.name)
        /**
         * 创建区的现状提示。三件事各自独立，所以分开渲染而不是拼一坨：
         *  · 有合并 / 变基在跑 → git 不允许切分支，只能只建分支；
         *  · 工作区脏 → 说清有多少改动会跟着走（base=HEAD 时这是零风险路径）；
         *  · 输入的名字恰好是已有远端分支 → 提示要跟踪该选哪个基准。
         */
        const branchState = branchMenu === null ? null : branchMenu.state
        const inProgress = branchState === null ? null : branchState.inProgress
        const progressKey = inProgress === null ? null : PROGRESS_KEYS[inProgress]
        const sameRemote = branchMenu === null ? null : sameRemoteOf(branchMenu.list, createName)
        const baseOptions = branchMenu === null ? [] : baseOptionsOf(branchMenu.list, branchMenu.current, t)
        const dirtyHint = branchState === null || branchState.dirty.total === 0
          ? null
          : t('branch.dirtyHint', {
            branch: branchMenu.current ?? t('root.noBranch'),
            total: branchState.dirty.total,
            staged: branchState.dirty.staged
          })
        /**
         * 选了「不是当前分支」当起点时，用一句人话说明后果。
         * 这个下拉框对不熟 git 的人很难自解释，只靠 tooltip 不够 —— 选项一改就把话说出来。
         */
        const baseIsHead = branchMenu === null || branchMenu.base === 'HEAD'
        const baseNote = baseIsHead
          ? null
          : (branchState !== null && branchState.dirty.total > 0
            ? t('branch.baseNoteDirty', { base: branchMenu.base, total: branchState.dirty.total })
            : t('branch.baseNoteClean', { base: branchMenu.base }))
        const branchFilter = branchMenu === null ? '' : branchMenu.filter.trim().toLowerCase()
        const listedBranches = branchFilter === ''
          ? menuBranches
          : menuBranches.filter((branch) => branch.name.toLowerCase().includes(branchFilter))
        const branchMenuNode = branchMenu === null
          ? null
          : h(PopupMenu, { open: true, anchorRect: branchMenu.rect, onClose: closeBranches, minWidth: 240 },
            h(MenuLabel, null, t('branch.title', { name: branchMenu.root.name })),
            h(MenuItem, {
              icon: 'refresh',
              label: branchMenu.pulling ? t('branch.pulling') : t('branch.pull'),
              disabled: menuBusy,
              dataKey: 'pull-branch',
              onClick: () => pullCurrent(branchMenu)
            }),
            h(MenuItem, {
              icon: 'sync',
              label: branchMenu.fetching ? t('branch.fetching') : t('branch.fetch'),
              disabled: menuBusy,
              dataKey: 'fetch-branches',
              onClick: () => fetchRemote(branchMenu)
            }),
            h('div', { className: 'dgp-menu-sep', role: 'separator' }),
            menuBranches.length > BRANCH_FILTER_THRESHOLD
              ? h('div', { className: 'dgp-branch-filter' },
                h(Icon, { name: 'search', size: 12 }),
                h('input', {
                  className: 'dgp-input',
                  type: 'search',
                  'data-dgp-branch-filter': 'true',
                  placeholder: t('branch.filterPlaceholder'),
                  value: branchMenu.filter,
                  spellCheck: false,
                  onChange: (event) => patchMenu({ filter: event.target.value }),
                  onKeyDown: (event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      event.stopPropagation()
                      patchMenu({ filter: '' })
                    }
                  }
                }))
              : null,
            branchMenu.loading ? h(MenuLabel, null, t('branch.loading')) : null,
            listedBranches.map((branch) => h(MenuItem, {
              key: branch.name,
              label: branch.name,
              badges: branchBadges(branch),
              sub: branchMeta(branch),
              checked: branch.current,
              disabled: menuBusy,
              dataKey: 'branch:' + branch.name,
              // 只有远程的行：点一下在本地创建并切过去（不写长文案，放 title 里）
              title: branch.local !== true ? t('branch.trackHint', { ref: branch.remote + '/' + branch.name }) : undefined,
              onClick: () => {
                if (branch.current) closeBranches()
                else if (branch.local === true) chooseBranch(branchMenu, branch.name)
                else trackBranch(branchMenu, branch)
              }
            })),
            menuBranches.length > 0 && listedBranches.length === 0
              ? h(MenuLabel, null, t('branch.noMatch', { filter: branchMenu.filter }))
              : null,
            branchMenu.list.length === 0 && branchMenu.loading !== true
              ? h(MenuLabel, null, t('branch.empty'))
              : null,
            h('div', { className: 'dgp-menu-sep', role: 'separator' }),
            h('form', {
              className: 'dgp-branch-create',
              'data-dgp-branch-create': 'true',
              onSubmit: (event) => {
                event.preventDefault()
                runCreate(branchMenu)
              }
            },
            h('div', { className: 'dgp-branch-create-row' },
              h('input', {
                className: 'dgp-input',
                'data-dgp-branch-name': 'true',
                value: branchMenu.name,
                placeholder: t('branch.createPlaceholder'),
                spellCheck: false,
                disabled: menuBusy,
                onChange: (event) => changeCreateName(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    closeBranches()
                  }
                }
              }),
              h('button', {
                type: 'submit',
                className: 'dgp-btn',
                'data-size': 'sm',
                'data-variant': 'primary',
                'data-dgp-branch-create-submit': 'true',
                disabled: menuBusy || createName === '',
                title: t(branchMenu.checkout ? 'branch.create' : 'branch.createOnly')
              }, t(branchMenu.checkout ? 'branch.create' : 'branch.createOnly'))),
            h('div', { className: 'dgp-branch-create-opts' },
              h('span', { className: 'dgp-branch-base-label' }, t('branch.baseLabel')),
              h('select', {
                className: 'dgp-input dgp-branch-base',
                'data-dgp-branch-base': 'true',
                value: branchMenu.base,
                disabled: menuBusy,
                title: t('branch.baseHint'),
                onChange: (event) => changeBase(event.target.value)
              }, baseOptions.map((option) => h('option', { key: option.ref, value: option.ref }, option.label))),
              h('label', { className: 'dgp-branch-check', title: t('branch.checkoutHint') },
                h('input', {
                  type: 'checkbox',
                  'data-dgp-branch-checkout': 'true',
                  checked: branchMenu.checkout,
                  disabled: menuBusy || inProgress !== null,
                  onChange: (event) => changeCheckout(event.target.checked)
                }),
                t('branch.checkoutLabel'))),
            baseNote === null
              ? null
              : h('p', {
                className: 'dgp-branch-hint',
                'data-dgp-branch-base-note': branchMenu.base
              }, baseNote),
            progressKey === null
              ? null
              : h('p', {
                className: 'dgp-branch-hint',
                'data-dgp-branch-dirty': 'in-progress',
                'data-tone': 'warn'
              }, t('branch.inProgressHint', {
                kind: t(progressKey),
                action: t('branch.createOnlyAction')
              })),
            dirtyHint === null
              ? null
              : h('p', { className: 'dgp-branch-hint', 'data-dgp-branch-dirty': 'dirty' }, dirtyHint),
            sameRemote === null
              ? null
              : h('p', {
                className: 'dgp-branch-hint',
                'data-dgp-branch-same-remote': sameRemote
              }, t('branch.sameRemoteHint', { ref: sameRemote })),
            // 撞车 = 「需要换个选择」，不是失败：说清冲突文件，并只给两个零风险出口
            branchMenu.blocked === null
              ? null
              : h('div', { className: 'dgp-branch-blocked', 'data-dgp-branch-blocked': 'true' },
                h('p', { className: 'dgp-branch-hint', 'data-tone': 'warn' }, branchMenu.blocked),
                h('div', { className: 'dgp-branch-actions' },
                  h('button', {
                    type: 'button',
                    className: 'dgp-btn',
                    'data-size': 'sm',
                    'data-dgp-branch-from-head': 'true',
                    disabled: menuBusy,
                    onClick: () => runCreate(branchMenu, { base: 'HEAD', checkout: true })
                  }, t('branch.fromHead')),
                  h('button', {
                    type: 'button',
                    className: 'dgp-btn',
                    'data-size': 'sm',
                    'data-dgp-branch-only': 'true',
                    disabled: menuBusy,
                    onClick: () => runCreate(branchMenu, { checkout: false })
                  }, t('branch.createOnlyAction'))))),
            branchMenu.switching === null
              ? null
              : h(MenuLabel, null, t('branch.switching', { name: branchMenu.switching })),
            branchMenu.creating !== true
              ? null
              : h(MenuLabel, null, t(branchMenu.checkout ? 'branch.creating' : 'branch.creatingOnly', { name: createName })),
            branchMenu.error === null || branchMenu.blocked !== null
              ? null
              : h(MenuLabel, null, t('branch.failed', { message: branchMenu.error })),
            branchMenu.root.kind === 'primary'
              ? null
              : h('div', { className: 'dgp-menu-sep', role: 'separator' }),
            branchMenu.root.kind === 'primary'
              ? null
              : (branchMenu.root.hidden === true
                ? h(MenuItem, {
                  icon: 'eye',
                  label: t('roots.unhide', { name: branchMenu.root.name }),
                  dataKey: 'repo-unhide',
                  onClick: () => runRootAction(onUnhide, branchMenu.root)
                })
                : h(MenuItem, {
                  icon: 'eye-off',
                  label: t('roots.hide', { name: branchMenu.root.name }),
                  dataKey: 'repo-hide',
                  onClick: () => runRootAction(onHide, branchMenu.root)
                })),
            branchMenu.root.kind === 'extra'
              ? h(MenuItem, {
                icon: 'trash',
                label: t('toolbar.removeRoot', { name: branchMenu.root.name }),
                dataKey: 'repo-remove',
                onClick: () => runRootAction(onRemove, branchMenu.root)
              })
              : null)

        /**
         * 行上的改动规模：只显示「有改动」的仓库。
         * 单个仓库失败给一个可悬停的 `!`，不把整张列表变成错误态。
         */
        const renderStats = (root) => {
          const summary = stats[root.path]
          if (summary === undefined) return null
          if (summary.error !== undefined) {
            return h('span', {
              className: 'dgp-repo-stats',
              'data-dgp-repo-stats': 'error',
              title: summary.error
            }, '!')
          }
          const { counts, adds, dels, binary } = summary
          if (counts.total === 0) return null
          const title = binary > 0
            ? t('roots.statsTitleBinary', { files: counts.total, binary, adds, dels })
            : t('roots.statsTitle', { files: counts.total, adds, dels })
          return h('span', {
            className: 'dgp-repo-stats',
            'data-dgp-repo-stats': String(counts.total),
            title,
            'aria-label': title
          },
          h(Icon, { name: 'file', size: 12 }),
          h('span', { className: 'dgp-repo-stats-files' }, String(counts.total)),
          adds > 0 ? h('span', { className: 'dgp-add' }, '+' + adds) : null,
          dels > 0 ? h('span', { className: 'dgp-del' }, '−' + dels) : null,
          counts.conflicted > 0
            ? h('span', { className: 'dgp-repo-conflict', title: t('group.conflicted') }, '!')
            : null)
        }

        return h('div', { className: 'dgp-repolist', 'data-dgp-repolist': 'true' },
          h('div', { className: 'dgp-repolist-head' },
            h('button', {
              type: 'button',
              className: 'dgp-repolist-toggle',
              'data-dgp-repolist-toggle': 'true',
              'data-open': open ? 'true' : 'false',
              'aria-expanded': open,
              onClick: onToggleOpen
            },
            h('span', { className: 'dgp-caret', 'data-open': open ? 'true' : 'false' },
              h(Icon, { name: 'chevron-right', size: 12 })),
            h('span', { className: 'dgp-repolist-title' }, t('roots.title')),
            h('span', { className: 'dgp-group-count' }, String(visibleRoots.length))),
            hiddenRoots.length === 0
              ? null
              : h('button', {
                type: 'button',
                className: 'dgp-iconbtn',
                style: { width: 22, height: 22, gap: 2 },
                'data-dgp-repolist-hidden': showHidden ? 'true' : 'false',
                'aria-pressed': showHidden,
                title: t(showHidden ? 'roots.hiddenCollapse' : 'roots.hiddenShow', { count: hiddenRoots.length }),
                'aria-label': t(showHidden ? 'roots.hiddenCollapse' : 'roots.hiddenShow', { count: hiddenRoots.length }),
                onClick: () => setShowHidden((previous) => !previous)
              },
              h(Icon, { name: showHidden ? 'eye-off' : 'eye', size: 14 }),
              h('span', { className: 'dgp-repolist-hidden-count' }, String(hiddenRoots.length))),
            h('button', {
              type: 'button',
              className: 'dgp-iconbtn',
              style: { width: 22, height: 22 },
              'data-action': 'add-root',
              title: t('toolbar.addRoot'),
              'aria-label': t('toolbar.addRoot'),
              onClick: () => setFormOpen((previous) => !previous)
            }, h(Icon, { name: 'plus', size: 14 }))),

          open
            ? h('ul', { className: 'dgp-level dgp-repolist-rows', role: 'none' },
              listedRoots.map((root) => {
                const hidden = root.hidden === true
                const hasBranch = root.branch !== null && root.branch !== ''
                return h('li', { key: root.id, className: 'dgp-item' },
                  h('div', {
                    className: 'dgp-row-wrap dgp-repo-wrap',
                    'data-active': !hidden && root.id === activeRootId ? 'true' : 'false',
                    'data-hidden': hidden ? 'true' : undefined
                  },
                  h('button', {
                    type: 'button',
                    className: 'dgp-row dgp-repo-row',
                    'data-dgp-repo': root.id,
                    'data-active': !hidden && root.id === activeRootId ? 'true' : 'false',
                    'data-hidden': hidden ? 'true' : undefined,
                    'aria-current': !hidden && root.id === activeRootId ? 'true' : undefined,
                    title: root.path,
                    onClick: () => {
                      // 已隐藏的行不参与切换：先取消隐藏，才能重新成为当前仓库
                      if (hidden) return
                      onSelect(root)
                    }
                  },
                  h(Icon, { name: 'git-branch', size: 14 }),
                  h('span', { className: 'dgp-name dgp-oneline' }, root.name)),
                  // 改动规模：有改动才出现，没有改动时保持行安静
                  renderStats(root),
                  // 分支按钮是所有仓库操作（分支 / 拉取 / 隐藏 / 移除）的入口
                  h('button', {
                    type: 'button',
                    className: 'dgp-repo-branch dgp-oneline',
                    'data-dgp-branch': root.id,
                    title: t(hidden ? 'branch.hintHidden' : 'branch.hint', {
                      branch: hasBranch ? root.branch : t('root.noBranch')
                    }),
                    onClick: (event) => {
                      event.stopPropagation()
                      loadBranches(root, event.currentTarget.getBoundingClientRect())
                    }
                  }, hasBranch ? root.branch : t('root.noBranch'))))
              })
            )
            : null,

          open && formOpen
            ? h(AddRootForm, {
              t,
              onCancel: closeForm,
              onAdd: async (dir) => {
                await onAdd(dir)
                setFormOpen(false)
              }
            })
            : null,

          branchMenuNode)
      }

      Object.assign(exports, { RepoList });

    });
    __define("./components/AddRootForm.js", (exports, module) => {
      /**
       * src/components/AddRootForm.js —— 「添加本机目录」的内联表单
       *
       * 语义很简单：加的是用户给的那一个目录，它自己必须含 .git。
       * 不向上找上级仓库、不向下扫描子仓库 —— 校验失败的原因就地显示。
       */
      const { h, useCallback, useRef, useState, getPluginContext } = __m("./platform.js");
      const { stripWrappingQuotes } = __m("./util/paths.js");

      function AddRootForm(props) {
        const source = props
        const translate = source.t
        const onAdd = source.onAdd
        const onCancel = source.onCancel

        const [value, setValue] = useState('')
        const [error, setError] = useState(null)
        const [submitting, setSubmitting] = useState(false)
        const [picking, setPicking] = useState(false)
        const busy = useRef(false)
        const inputRef = useRef(null)

        const choosePath = useCallback(async () => {
          if (busy.current) return
          busy.current = true
          setPicking(true)
          setError(null)
          try {
            // 与宿主一致：桌面桥优先，否则使用宿主 RPC 的本机目录选择器。
            const desktop = globalThis.__DSH_DIRECTORY_PICKER__
            const path = await (desktop === undefined
              ? getPluginContext().uiWorkspace.pickDirectory()
              : desktop.pick())
            if (path !== null) {
              setValue(path)
              inputRef.current?.focus()
            }
          } catch (failure) {
            setError(translate('root.pickFailed', { message: failure instanceof Error ? failure.message : String(failure) }))
          } finally {
            busy.current = false
            setPicking(false)
          }
        }, [translate])

        const submit = useCallback(async () => {
          if (busy.current) return
          // 粘贴「复制为路径」会带引号，先剥掉再提交
          const dir = stripWrappingQuotes(value)
          if (dir === '') return
          busy.current = true
          setSubmitting(true)
          setError(null)
          try {
            await onAdd(dir)
            setValue('')
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure))
          } finally {
            busy.current = false
            setSubmitting(false)
          }
        }, [value, onAdd])

        return h('div', {
          className: 'dgp-addform',
          'data-dgp-addform': 'true',
          onKeyDown: (event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              onCancel()
            }
          }
        },
          h('div', { className: 'dgp-addform-path' },
          h('input', {
            ref: inputRef,
            className: 'dgp-input',
            'aria-label': translate('root.pathLabel'),
            disabled: picking || submitting,
            placeholder: translate('root.addPlaceholder'),
            value,
            autoFocus: true,
            spellCheck: false,
            onChange: (event) => setValue(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              } else if (event.key === 'Escape') {
                event.preventDefault()
                onCancel()
              }
            }
          }),
          h('button', {
            type: 'button',
            className: 'dgp-btn',
            'data-dgp-addform-browse': 'true',
            disabled: picking || submitting,
            'aria-busy': picking,
            onClick: choosePath
          }, translate(picking ? 'root.picking' : 'root.pickPath'))),
          h('div', { className: 'dgp-hint' }, translate('root.addHint')),
          error === null ? null : h('div', { className: 'dgp-note', 'data-tone': 'error', role: 'alert' }, error),
          h('div', { className: 'dgp-addform-actions' },
            h('button', {
                type: 'button',
                className: 'dgp-btn',
                'data-size': 'sm',
                onClick: onCancel
              }, translate('root.addCancel')),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-variant': 'primary',
              'data-dgp-addform-confirm': 'true',
              disabled: submitting || picking || stripWrappingQuotes(value) === '',
              onClick: submit
            }, translate('root.addConfirm'))))
      }

      Object.assign(exports, { AddRootForm });

    });
    __define("./util/paths.js", (exports, module) => {
      /**
       * src/util/paths.js —— 纯路径/显示工具
       *
       * 全部纯函数，不依赖 react 或 DOM，可以直接在 Node 里单测。
       * 约定：插件内部一切「仓库内相对路径」都是正斜杠、无前导斜杠。
       */

      const QUOTE_PAIRS = [
        ['"', '"'],
        ["'", "'"],
        ['“', '”'],
        ['‘', '’']
      ]

      /**
       * 去掉首尾成对的引号（只剥一对）。
       *
       * 典型输入来自资源管理器的「复制为路径」：`"H:\my-repo"`。
       * 首尾不成对、或引号在中间时原样返回；纯空白返回空串。
       */
      function stripWrappingQuotes(value) {
        const text = String(value === null || value === undefined ? '' : value).trim()
        if (text.length < 2) return text
        for (const [open, close] of QUOTE_PAIRS) {
          if (text.startsWith(open) && text.endsWith(close)) {
            return text.slice(open.length, text.length - close.length).trim()
          }
        }
        return text
      }

      /** 取路径最后一段。 */
      function basename(p) {
        if (!p) return ''
        const clean = String(p).replace(/[\\/]+$/, '')
        const parts = clean.split(/[\\/]/)
        return parts[parts.length - 1] || ''
      }

      /** 取父路径（保留正斜杠）。 */
      function dirname(p) {
        if (!p) return ''
        const clean = String(p).replace(/\\/g, '/').replace(/\/+$/, '')
        const index = clean.lastIndexOf('/')
        return index === -1 ? '' : clean.slice(0, index)
      }


      /** 拆成段数组。 */
      function segments(p) {
        return String(p || '').replace(/\\/g, '/').split('/').filter(Boolean)
      }

      /** 从根到该路径的祖先链（不含自身）：'a/b/c' -> ['a', 'a/b']。 */
      function parentChain(relPath) {
        const parts = segments(relPath)
        const out = []
        for (let i = 1; i < parts.length; i += 1) out.push(parts.slice(0, i).join('/'))
        return out
      }

      /** 自然序、忽略大小写的比较。 */
      function naturalCompare(a, b) {
        return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
      }

      /**
       * 把一串路径压成树，并把「只有一个目录子节点」的链折叠成 `a/b/c`。
       *
       * @param {Array<{path: string} & Record<string, any>>} entries
       * @returns {{ nodes: TreeNode[], byPath: Map<string, TreeNode> }}
       *
       * TreeNode = {
       *   name: string, path: string, type: 'dir'|'file',
       *   children: TreeNode[], entry?: object, depth?: number
       * }
       */
      function buildTree(entries) {
        const root = { name: '', path: '', type: 'dir', children: [] }
        const byPath = new Map()

        for (const entry of entries) {
          const parts = segments(entry.path)
          if (parts.length === 0) continue
          let cursor = root
          for (let i = 0; i < parts.length - 1; i += 1) {
            const name = parts[i]
            const path = parts.slice(0, i + 1).join('/')
            let next = cursor.children.find((child) => child.type === 'dir' && child.name === name)
            if (next === undefined) {
              next = { name, path, type: 'dir', children: [] }
              cursor.children.push(next)
              byPath.set(path, next)
            }
            cursor = next
          }
          const fileName = parts[parts.length - 1]
          const filePath = parts.join('/')
          const fileNode = { name: fileName, path: filePath, type: 'file', children: [], entry }
          cursor.children.push(fileNode)
          byPath.set(filePath, fileNode)
        }

        sortTree(root)
        return { nodes: root.children, byPath }
      }

      function sortTree(node) {
        node.children.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
          return naturalCompare(a.name, b.name)
        })
        for (const child of node.children) {
          if (child.children.length > 0) sortTree(child)
        }
      }

      /**
       * 把单链目录折叠：'src/a/b'（每层只有一个目录子节点）显示成一行。
       * @returns {{ displayName: string, node: TreeNode, chain: TreeNode[] }}
       */
      function compactChain(node) {
        const chain = [node]
        let cursor = node
        while (
          cursor.type === 'dir'
          && cursor.children.length === 1
          && cursor.children[0].type === 'dir'
        ) {
          cursor = cursor.children[0]
          chain.push(cursor)
        }
        const displayName = chain.map((item) => item.name).join('/')
        return { displayName, node: cursor, chain }
      }

      /** 扁平化树为渲染行（含每个节点的展开状态）。 */
      function flattenTree(nodes, isExpanded, depth = 0, out = []) {
        for (const node of nodes) {
          if (node.type === 'dir') {
            const { displayName, node: last, chain } = compactChain(node)
            out.push({ kind: 'dir', node: last, chain, displayName, path: last.path, depth })
            if (isExpanded(last.path)) flattenTree(last.children, isExpanded, depth + 1, out)
          } else {
            out.push({ kind: 'file', node, displayName: node.name, path: node.path, depth })
          }
        }
        return out
      }

      /** 收集树上所有目录路径（用于「全部折叠/展开」与自动展开到选中项）。 */
      function collectDirPaths(nodes, out = []) {
        for (const node of nodes) {
          if (node.type !== 'dir') continue
          const { node: last } = compactChain(node)
          out.push(last.path)
          collectDirPaths(last.children, out)
        }
        return out
      }

      /** 过滤：命中文件名或完整路径（不区分大小写）。 */
      function matchesFilter(relPath, filter) {
        if (!filter) return true
        const needle = String(filter).toLowerCase().trim()
        if (needle === '') return true
        return String(relPath).toLowerCase().includes(needle)
      }


      /** 数字格式化：1234 -> 1.2k。 */
      function formatCount(value) {
        const n = Number(value) || 0
        if (n < 1000) return String(n)
        if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
        return Math.round(n / 1000) + 'k'
      }


      Object.assign(exports, { stripWrappingQuotes, basename, dirname, segments, parentChain, naturalCompare, buildTree, compactChain, flattenTree, collectDirPaths, matchesFilter, formatCount });

    });
    __define("./components/ChangesList.js", (exports, module) => {
      /**
       * src/components/ChangesList.js —— 「变更」模式的树
       *
       * 结构（与 src/styles.js 的 `.dgp-*` 选择器一一对应）：
       *
       *   div.dgp-list[role=tree]                      ← 滚动容器 + 键盘焦点
       *   ├─ div.dgp-group[data-dgp-group=key]         ← 冲突 / 已暂存 / 未暂存 / 未跟踪
       *   │  ├─ button.dgp-group-head[data-open]       ← 点击 = onToggleGroup(key)
       *   │  │  ├─ span.dgp-group-caret[data-open]
       *   │  │  ├─ span.dgp-group-title
       *   │  │  └─ span.dgp-group-count
       *   │  └─ ul.dgp-level[role=none]
       *   │     └─ li.dgp-item[role=treeitem][aria-level]
       *   │        └─ button.dgp-row[data-kind=dir|file][data-active][data-cursor]
       *   └─ ...
       *
       * 纯逻辑（分组、压树、折叠单链、过滤、自动展开链）全在 `../util/changes.js`，
       * 那里可以在 Node 里单测（见 `test/tree.test.mjs`）。键盘游标与「文件」树共用
       * `../ui/useTreeCursor.js`。
       *
       * 筛选时的展开规则：命中项必须看得见。所以只要筛选框非空，所有分组与目录
       * 一律按展开处理 —— 否则用户输入关键词，看到的却是一排折叠的分组标题。
       */
      const { h, useEffect, useMemo, useState } = __m("./platform.js");
      const { Icon, StatusLetter } = __m("./ui/Icon.js");
      const { useTreeCursor } = __m("./ui/useTreeCursor.js");
      const { dirname, formatCount } = __m("./util/paths.js");
      const { ancestorsFor, buildGroupRows, buildListRows, countFilesUnder, filterEntries, groupChanges, groupActionOf, rowActionOf } = __m("./util/changes.js");
      const { EmptyState, SkeletonRows } = __m("./components/States.js");

      function ChangesList(props) {
        const {
          status,
          loading = false,
          selectedPath = null,
          onSelect,
          filter = '',
          collapsedGroups = {},
          onToggleGroup,
          view = 'list',
          untrackedMode = 'merge',
          onStage,
          pendingPath = null,
          onStageGroup,
          pendingGroup = null,
          t
        } = props

        const files = status === null ? [] : status.files
        const filtering = filter.trim() !== ''

        const [expanded, setExpanded] = useState(() => new Set())

        const filteredFiles = useMemo(() => filterEntries(files, filter), [files, filter])
        const groups = useMemo(() => groupChanges(filteredFiles, { untrackedMode }), [filteredFiles, untrackedMode])

        /** 分组可见性 + 每组要渲染的行（offset 是跨分组的扁平行序号基数）。 */
        const layout = useMemo(() => {
          const out = []
          let offset = 0
          for (const group of groups) {
            const open = filtering || collapsedGroups[group.key] !== true
            const rows = open
              ? (view === 'tree'
                ? buildGroupRows(group.entries, (dirPath) => filtering || expanded.has(dirPath))
                : buildListRows(group.entries))
              : []
            out.push({ key: group.key, entries: group.entries, open, rows, offset })
            if (open) offset += rows.length
          }
          return out
        }, [groups, collapsedGroups, expanded, view, filtering])

        /** 键盘游标走查的扁平行序列（跨分组：冲突 → 已暂存 → 未暂存 → 未跟踪）。 */
        const flatRows = useMemo(() => {
          const out = []
          for (const group of layout) {
            if (!group.open) continue
            for (let index = 0; index < group.rows.length; index += 1) {
              out.push({ group: group.key, row: group.rows[index], index: group.offset + index })
            }
          }
          return out
        }, [layout])

        function toggleDirPath(dirPath) {
          setExpanded((previous) => {
            const next = new Set(previous)
            if (next.has(dirPath)) next.delete(dirPath)
            else next.add(dirPath)
            return next
          })
        }

        function activateRow(item) {
          if (item.row.kind === 'file') onSelect(item.row.node.entry, item.group)
          else toggleDirPath(item.row.path)
        }

        const cursorState = useTreeCursor({
          rows: flatRows,
          isDir: (item) => item.row.kind === 'dir',
          isOpen: (item) => expanded.has(item.row.path),
          onToggle: (item) => toggleDirPath(item.row.path),
          onActivate: activateRow
        })
        const { cursor, rowRefs, focusRow, handleKeyDown } = cursorState

        // 把选中文件的目录链自动展开，保证选中项可见（Panel 可能在外部改 selectedPath）。
        // 列表模式没有目录行，不需要展开任何东西。
        useEffect(() => {
          if (view !== 'tree' || selectedPath === null) return
          setExpanded((previous) => {
            let next = null
            for (const group of groups) {
              for (const dirPath of ancestorsFor(group.entries, selectedPath)) {
                if (previous.has(dirPath)) continue
                if (next === null) next = new Set(previous)
                next.add(dirPath)
              }
            }
            return next === null ? previous : next
          })
        }, [selectedPath, groups, view])

        // 外部（Panel / 鼠标）改了选中项时，键盘光标跟随它。
        useEffect(() => {
          if (selectedPath === null) return
          const index = flatRows.findIndex((item) => item.row.kind === 'file' && item.row.path === selectedPath)
          if (index >= 0) focusRow(index)
        }, [selectedPath, flatRows])

        /* ------------------------------ 渲染 ------------------------------ */

        function renderRow(group, row, index) {
          const depth = row.depth
          const style = { '--dgp-depth': depth }
          const isActive = selectedPath !== null && row.path === selectedPath
          const isCursor = cursor === index
          const common = {
            type: 'button',
            className: 'dgp-row',
            style,
            'data-dgp-path': row.path,
            'data-active': isActive ? 'true' : 'false',
            'aria-selected': isActive ? 'true' : 'false',
            'data-cursor': isCursor ? 'true' : undefined,
            'data-dgp-row': row.kind,
            title: row.path,
            ref: (element) => {
              rowRefs.current[index] = element
            }
          }

          if (row.kind === 'dir') {
            const open = expanded.has(row.path)
            const count = countFilesUnder(group.entries, row.path)
            return h('li', {
              key: 'dir:' + row.path,
              className: 'dgp-item',
              role: 'treeitem',
              'aria-level': depth + 1,
              'aria-expanded': open
            },
            h('button', {
              ...common,
              'data-kind': 'dir',
              'data-dgp-entry': 'dir',
              'aria-expanded': open,
              'data-open': open ? 'true' : 'false',
              onClick: () => {
                focusRow(index)
                toggleDirPath(row.path)
              }
            },
            h('span', { className: 'dgp-caret', 'data-open': open ? 'true' : 'false' },
              h(Icon, { name: 'chevron-right', size: 12 })),
            h(Icon, { name: open ? 'folder-open' : 'folder', size: 14 }),
            h('span', { className: 'dgp-name dgp-name-dir dgp-oneline' }, row.displayName),
            count > 0 ? h('span', { className: 'dgp-meta' }, formatCount(count)) : null))
          }

          const entry = row.node.entry
          const parent = dirname(row.path)
          const sideStats = group.key === 'staged' ? entry.stagedStats : entry.unstagedStats
          const stats = sideStats ?? entry
          const counts = []
          if (stats.adds >= 0) {
            counts.push(h('span', { key: 'add', className: 'dgp-add' }, t('viewer.adds', { count: String(stats.adds) })))
          }
          if (stats.dels >= 0) {
            counts.push(h('span', { key: 'del', className: 'dgp-del' }, t('viewer.dels', { count: String(stats.dels) })))
          }

          // 行尾操作只由所在分组决定：已暂存 = 取消暂存，未暂存/未跟踪 = 暂存，冲突不给按钮。
          const action = rowActionOf(group.key)
          const busy = pendingPath !== null && pendingPath === row.path
          const actionButton = action === null
            ? null
            : h('button', {
              type: 'button',
              className: 'dgp-row-action',
              'data-dgp-action': action,
              'data-busy': busy ? 'true' : undefined,
              disabled: busy,
              title: t(action === 'stage' ? 'row.stage' : 'row.unstage'),
              'aria-label': t(action === 'stage' ? 'row.stage' : 'row.unstage'),
              onClick: (event) => {
                event.preventDefault()
                event.stopPropagation()
                onStage(row.path, action)
              }
            }, h(Icon, { name: action === 'stage' ? 'plus' : 'minus', size: 14 }))

          return h('li', {
            key: 'file:' + row.path,
            className: 'dgp-item',
            role: 'treeitem',
            'aria-level': depth + 1,
            'aria-selected': isActive ? 'true' : 'false'
          },
          h('div', { className: 'dgp-row-wrap' },
            h('button', {
              ...common,
              'data-kind': 'file',
              'data-dgp-entry': 'file',
              onClick: () => {
                focusRow(index)
                activateRow({ group: group.key, row })
              }
            },
            h(StatusLetter, { status: entry.status }),
            h('span', { className: 'dgp-name dgp-oneline' }, row.displayName),
            parent === '' ? null : h('span', { className: 'dgp-sub dgp-oneline' }, parent),
            counts.length === 0 ? null : h('span', { className: 'dgp-meta' }, counts)),
            actionButton))
        }

        function renderGroup(group) {
          const action = groupActionOf(group.key, untrackedMode)
          const busy = pendingGroup !== null && pendingGroup === action
          const actionButton = action === null
            ? null
            : h('button', {
              type: 'button',
              className: 'dgp-group-action',
              'data-dgp-group-action': action,
              'data-busy': busy ? 'true' : undefined,
              disabled: busy,
              title: t(action === 'unstage' ? 'group.unstageAll' : 'group.stageAll'),
              'aria-label': t(action === 'unstage' ? 'group.unstageAll' : 'group.stageAll'),
              onClick: (event) => {
                event.preventDefault()
                event.stopPropagation()
                onStageGroup(action)
              }
            }, h(Icon, { name: action === 'unstage' ? 'minus' : 'plus', size: 14 }))
          return h('div', {
            key: group.key,
            className: 'dgp-group',
            'data-dgp-group': group.key
          },
          h('div', { className: 'dgp-group-head-wrap' },
            h('button', {
              type: 'button',
              className: 'dgp-group-head',
              'data-open': group.open ? 'true' : 'false',
              'aria-expanded': group.open,
              onClick: () => {
                onToggleGroup(group.key)
              }
            },
            h('span', { className: 'dgp-group-caret', 'data-open': group.open ? 'true' : 'false' },
              h(Icon, { name: 'chevron-right', size: 12 })),
            h('span', { className: 'dgp-group-title' }, t('group.' + group.key)),
            h('span', { className: 'dgp-group-count' }, formatCount(group.entries.length))),
            actionButton),
          group.open
            ? h('ul', { className: 'dgp-level', role: 'none' },
              group.rows.map((row, index) => renderRow(group, row, group.offset + index)))
            : null)
        }

        const container = (children) => h('div', {
          className: 'dgp-list',
          role: 'tree',
          tabIndex: 0,
          'aria-label': t('mode.changes'),
          'data-dgp-list': 'changes',
          'data-view': view,
          onKeyDown: handleKeyDown
        }, children)

        /* --- 没有 status：加载 / 空仓库 --- */
        if (status === null) {
          if (loading) return container(h(SkeletonRows, { rows: 6 }))
          return container(h(EmptyState, {
            icon: 'git-branch',
            title: t('status.noRoots'),
            description: t('status.noRootsHint')
          }))
        }

        /* --- 工作区干净 --- */
        if (files.length === 0) {
          return container(h(EmptyState, {
            icon: 'check-circle',
            title: t('status.clean'),
            description: t('status.cleanHint')
          }))
        }

        /* --- 有改动，但被过滤词筛空了 --- */
        if (groups.length === 0) {
          return container(h(EmptyState, {
            icon: 'search',
            title: t('status.emptyFilter', { filter })
          }))
        }

        return container(layout.map((group) => renderGroup(group)))
      }

      Object.assign(exports, { ChangesList });

    });
    __define("./ui/useTreeCursor.js", (exports, module) => {
      /**
       * src/ui/useTreeCursor.js —— 树/列表共用的键盘游标
       *
       * 「变更」树与「文件」树本来就是同一种交互：一组扁平行、一个游标、↑↓ 移动、
       * Enter 激活、←→ 展开/折叠目录、移动时把行滚进可视区。两边原先各写了一遍
       * （连 clamp 与 focus 收尾都逐行相同），这里收成一处；组件只回答两件事：
       * 哪些行是目录、目录怎么开合。
       *
       * 约定：
       *  - 事件处理函数挂在列表容器上；到达这里的 keydown 必然来自容器或其后代，
       *    所以不需要 contains 判断 —— 只有「Enter 由容器自己处理还是交给行 button」
       *    需要区分 target 是不是容器。
       *  - 行节点由组件通过 ref 收集进 `rowRefs`，索引与扁平行数组一致。
       *  - **`rowRefs.current[i]` 有三种值**：行已挂载（元素）、行还没挂载过（`undefined`）、
       *    行被卸载（React 会把 ref 回调传成 `null`）。游标移动时行可能刚好被卸载
       *    （折叠分组 / 过滤 / 提交后列表变短 / 暂存后文件换组），所以「有没有元素」必须
       *    同时认 `null` 和 `undefined` —— 少认一种就是对着 `null` 调 `scrollIntoView`。
       */
      const { useEffect, useRef, useState } = __m("./platform.js");

      /** 这些键由游标消费，不再冒泡给 Panel 的全局快捷键。 */
      function consume(event) {
        event.preventDefault()
        event.stopPropagation()
      }

      /**
       * 游标该落在哪一行：行数变少时收敛到最后一行，还没选行（-1）与空列表都返回 -1。
       *
       * 单独拿出来是因为**状态收敛（effect 里的 setCursor）要下一遍渲染才生效**，
       * 而同一提交里的滚动 effect 读的还是这一遍的旧游标 —— 读之前必须自己按当前行数收敛，
       * 否则就会读到一个已经不存在的行号。
       */
      function clampCursor(cursor, total) {
        if (total <= 0 || cursor < 0) return -1
        return cursor >= total ? total - 1 : cursor
      }

      /**
       * 游标对应的行元素；没有就返回 `null`。
       *
       * 行被卸载时 React 写进 `rowRefs` 的是 `null`（挂载前是 `undefined`），两种都表示
       * 「这一行现在不在 DOM 里」，调用方拿到 `null` 就不该再碰它。
       */
      function cursorElement(rowRefs, cursor, total) {
        const index = clampCursor(cursor, total)
        if (index < 0) return null
        const element = rowRefs[index]
        return element === undefined || element === null ? null : element
      }

      /**
       * @param {{
       *   rows: object[],
       *   isDir: (row: object) => boolean,
       *   isOpen: (row: object) => boolean,
       *   onToggle: (row: object) => void,
       *   onActivate: (row: object) => void
       * }} options
       */
      function useTreeCursor(options) {
        const { rows, isDir, isOpen, onToggle, onActivate } = options
        const [cursor, setCursor] = useState(-1)
        const rowRefs = useRef([])
        const wantFocusRef = useRef(false)

        // 行数变少（折叠分组 / 过滤 / 切目录）时把游标收敛回最后一行。
        useEffect(() => {
          setCursor((previous) => clampCursor(previous, rows.length))
        }, [rows.length])

        // 游标移动：滚进可视区；键盘移动时把真实焦点也带过去（Enter 由原生 click 处理）。
        // 这里按「当前行数」重新收敛一次：状态收敛要下一遍渲染才生效，而这一遍的行里
        // 可能已经有行被卸载、ref 变成了 null。
        useEffect(() => {
          const element = cursorElement(rowRefs.current, cursor, rows.length)
          if (element === null) return
          element.scrollIntoView({ block: 'nearest' })
          if (wantFocusRef.current === true) {
            wantFocusRef.current = false
            element.focus()
          }
        }, [cursor, rows])

        /** 鼠标点行 / 外部选中项变化时让游标跟上（不动焦点）。 */
        function focusRow(index) {
          setCursor(index)
        }

        function moveBy(delta) {
          const total = rows.length
          if (total === 0) return
          wantFocusRef.current = true
          setCursor((previous) => {
            if (previous < 0 || previous >= total) return 0
            return Math.min(total - 1, Math.max(0, previous + delta))
          })
        }

        function handleKeyDown(event) {
          const onContainer = event.target === event.currentTarget

          if (event.key === 'ArrowDown') {
            consume(event)
            moveBy(1)
            return
          }

          if (event.key === 'ArrowUp') {
            consume(event)
            moveBy(-1)
            return
          }

          if (event.key === 'Enter') {
            // 行上的 Enter 由原生 button click 处理，避免重复激活。
            if (onContainer !== true) return
            const row = rows[cursor]
            if (row === undefined) return
            consume(event)
            onActivate(row)
            return
          }

          if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
          const row = rows[cursor]
          if (row === undefined || isDir(row) !== true) return
          const open = isOpen(row)
          if ((event.key === 'ArrowRight') === open) return
          consume(event)
          onToggle(row)
        }

        return { cursor, rowRefs, focusRow, handleKeyDown }
      }

      Object.assign(exports, { clampCursor, cursorElement, useTreeCursor });

    });
    __define("./util/changes.js", (exports, module) => {
      /**
       * src/util/changes.js —— 「变更」分组与树行构造的纯函数
       *
       * 这里只放**纯逻辑**：不依赖 react、不依赖 DOM、不碰宿主桥接。
       * 这样 `plugin/test/tree.test.mjs` 可以直接 `import` 本文件在 Node 里单测，
       * 而 ChangesList（「变更」树）/ FileTree（「文件」树）只负责把它们渲染成 DOM。
       *
       * 约定：
       * - 所有路径都是「正斜杠、无前导斜杠」的仓库内相对路径（见 util/paths.js 文件头）。
       * - 入参一律做防御：可能拿到 null / undefined / 非数组（宿主或测试给不到数据）。
       */
      const { basename, buildTree, flattenTree, matchesFilter, naturalCompare, parentChain } = __m("./util/paths.js");

      /** 分组固定顺序：冲突 → 已暂存 → 未暂存 → 未跟踪（与 i18n 的 group.* 键一一对应）。 */
      const GROUP_ORDER = ['conflicted', 'staged', 'unstaged', 'untracked']

      /**
       * 未跟踪文件的呈现方式：
       *   merge    —— 并进「未暂存」（VS Code 的默认行为，「Changes」里同时有改动和新文件）
       *   separate —— 单列「未跟踪」组
       */
      const UNTRACKED_MODES = ['merge', 'separate']

      /** 单个文件归属的分组；冲突文件只进「冲突」组（与 VSCode 的 Merge Changes 一致）。 */
      function groupsOfFile(file, untrackedMode = 'merge') {
        if (file === null || file === undefined || typeof file !== 'object') return []
        if (file.conflicted === true) return ['conflicted']
        const out = []
        if (file.staged === true) out.push('staged')
        if (file.unstaged === true) out.push('unstaged')
        if (file.untracked === true) out.push(untrackedMode === 'merge' ? 'unstaged' : 'untracked')
        return out
      }

      /**
       * 把 `status.files` 拆成 4 个固定顺序的分组，空分组丢弃。
       *
       * 同一个文件可以同时出现在多个分组里（`MM` = 已暂存 + 未暂存），
       * 因为右侧 diff 要看哪一侧取决于用户点的是哪一组的行。
       *
       * @param {Array<{path: string, staged?: boolean, unstaged?: boolean, untracked?: boolean, conflicted?: boolean}>} files
       * @param {{untrackedMode?: 'merge'|'separate'}} [options] 未跟踪文件是并进未暂存还是单列一组
       * @returns {Array<{key: 'conflicted'|'staged'|'unstaged'|'untracked', entries: object[]}>}
       */
      function groupChanges(files, options = {}) {
        const untrackedMode = options.untrackedMode === 'separate' ? 'separate' : 'merge'
        const list = Array.isArray(files) ? files : []
        const buckets = new Map()
        for (const key of GROUP_ORDER) buckets.set(key, [])
        for (const file of list) {
          for (const key of groupsOfFile(file, untrackedMode)) {
            const bucket = buckets.get(key)
            if (bucket !== undefined) bucket.push(file)
          }
        }
        const out = []
        for (const key of GROUP_ORDER) {
          const entries = buckets.get(key)
          if (entries !== undefined && entries.length > 0) out.push({ key, entries })
        }
        return out
      }

      /**
       * 一行该放哪个索引操作按钮。
       *
       * 规则跟 VS Code 的 SCM 行一致，并且**只由所在分组决定**（同一文件可以同时出现在两组）：
       *   staged             → unstage（减号，取消暂存，文件回到未暂存）
       *   unstaged/untracked → stage（加号，暂存，文件进入已暂存）
       *   conflicted         → null（冲突要先解决再暂存，行上不给一键操作）
       * 其它分组一律 null，调用方据此不渲染按钮。
       */
      function rowActionOf(groupKey) {
        if (groupKey === 'staged') return 'unstage'
        if (groupKey === 'unstaged' || groupKey === 'untracked') return 'stage'
        return null
      }

      /**
       * 分组头右侧的批量操作。与行尾按钮同一套规则，作用范围是**整组**，
       * 所以必须跟着分组内容走：
       *   staged    → unstage（取消暂存全部已暂存）
       *   unstaged  → 合并模式：组里还有未跟踪文件 → stage-all（全部加进来）
       *               分开模式：组里只有已跟踪改动 → stage-unstaged（git add -u）
       *   untracked → stage-untracked（只暂存未跟踪文件）
       *   conflicted → null
       */
      function groupActionOf(groupKey, untrackedMode = 'merge') {
        if (groupKey === 'staged') return 'unstage'
        if (groupKey === 'unstaged') return untrackedMode === 'merge' ? 'stage-all' : 'stage-unstaged'
        if (groupKey === 'untracked') return 'stage-untracked'
        return null
      }

      /** 分组里只有一个文件时，直接渲染成文件行（不造目录行）：返回那个条目，否则 null。 */
      function singleFileShortcut(entries) {
        return entries.length === 1 ? entries[0] : null
      }

      /** 路径归一化：反斜杠 → 正斜杠、去掉前导 `./`、去掉末尾斜杠。 */
      function normalizeRelPath(value) {
        return String(value === undefined || value === null ? '' : value)
          .replace(/\\/g, '/')
          .replace(/^(?:\.\/)+/, '')
          .replace(/\/+$/, '')
      }

      /**
       * 算出子项相对浏览根的路径。
       *
       * 宿主 `tree/list` 只返回条目名（相对被列举目录），这里拼上父路径就是根相对路径。
       *
       * @param {string} parentRel 父目录的相对路径（'' = 根）
       * @param {{name?: string}} entry
       */
      function childPath(parentRel, entry) {
        const parent = normalizeRelPath(parentRel)
        const raw = entry !== null && entry !== undefined && typeof entry.name === 'string' ? entry.name : ''
        const rel = normalizeRelPath(raw)
        if (rel === '') return parent
        if (parent === '') return rel
        if (rel === parent || rel.startsWith(parent + '/')) return rel
        return parent + '/' + rel
      }

      /** 单个条目是否命中过滤词：文件名 / 完整路径 / 重命名前路径，任一命中即可。 */
      function matchesEntry(entry, filter) {
        if (entry === null || entry === undefined || typeof entry !== 'object') return false
        if (filter === undefined || filter === null || filter === '') return true
        if (matchesFilter(entry.path, filter)) return true
        if (typeof entry.name === 'string' && matchesFilter(entry.name, filter)) return true
        if (typeof entry.oldPath === 'string' && entry.oldPath !== '' && matchesFilter(entry.oldPath, filter)) return true
        return false
      }

      /** 过滤条目；`filter` 为空串时**不过滤**（返回全部，而不是全部过滤掉）。 */
      function filterEntries(entries, filter) {
        const list = Array.isArray(entries) ? entries : []
        if (filter === undefined || filter === null || filter === '') return list.slice()
        return list.filter((entry) => matchesEntry(entry, filter))
      }

      /** 构造一条文件行（与 flattenTree 输出的行形状保持一致）。 */
      function fileRow(entry, depth) {
        const path = normalizeRelPath(entry === null || entry === undefined ? '' : entry.path)
        const name = basename(path)
        return {
          kind: 'file',
          node: { name, path, type: 'file', children: [], entry },
          displayName: name,
          path,
          depth
        }
      }

      /**
       * 把一个分组的条目压成可直接渲染的行数组（已折叠单子节点目录链）。
       *
       * - 分组只有 1 个条目 → 直接一行文件（depth 0），不造目录行。
       * - 其它情况 → `buildTree` + `flattenTree`（后者内部调用 `compactChain`），
       *   `a/b/c` 这种单链会合并成一行显示。
       *
       * @param {object[]} entries
       * @param {(dirPath: string) => boolean} isExpanded 目录是否展开
       * @returns {Array<{kind:'dir'|'file', path: string, depth: number, displayName: string}>}
       */
      function buildGroupRows(entries, isExpanded) {
        const list = Array.isArray(entries) ? entries : []
        const only = singleFileShortcut(list)
        if (only !== null) return [fileRow(only, 0)]
        const { nodes } = buildTree(list)
        const expanded = typeof isExpanded === 'function' ? isExpanded : () => false
        return flattenTree(nodes, expanded)
      }

      /**
       * 把一个分组的条目压成**扁平行**（列表模式：不造目录行，一行一个文件）。
       *
       * 文件名是主体，父路径在行内弱化显示（VS Code 的 List 视图）。
       * 排序按完整路径的自然序，同一目录的文件相邻。
       *
       * @param {object[]} entries
       * @returns {Array<{kind:'file', path: string, depth: number, displayName: string}>}
       */
      function buildListRows(entries) {
        const list = Array.isArray(entries) ? entries : []
        const rows = []
        for (const entry of list) {
          if (entry === null || entry === undefined || typeof entry.path !== 'string' || entry.path === '') continue
          rows.push(fileRow(entry, 0))
        }
        rows.sort((left, right) => naturalCompare(left.path, right.path))
        return rows
      }

      /**
       * 选中文件所在分组里，需要展开的目录链（用于「自动展开到选中项」）。
       * 分组只有 1 个条目时没有目录行，返回空数组。
       *
       * @param {object[]} entries
       * @param {string} targetPath
       * @returns {string[]} 目录相对路径，由浅到深
       */
      function ancestorsFor(entries, targetPath) {
        const list = Array.isArray(entries) ? entries : []
        const target = normalizeRelPath(targetPath)
        if (target === '' || list.length <= 1) return []
        const { byPath } = buildTree(list)
        const out = []
        for (const dirPath of parentChain(target)) {
          const node = byPath.get(dirPath)
          if (node !== undefined && node !== null && node.type === 'dir') out.push(node.path)
        }
        return out
      }

      /** 目录下的文件数（目录行的计数提示）。`dirPath` 为空 = 整个分组。 */
      function countFilesUnder(entries, dirPath) {
        const list = Array.isArray(entries) ? entries : []
        const dir = normalizeRelPath(dirPath)
        const prefix = dir === '' ? '' : dir + '/'
        let count = 0
        for (const entry of list) {
          if (entry === null || entry === undefined || typeof entry.path !== 'string') continue
          const path = normalizeRelPath(entry.path)
          if (prefix === '' ? path !== '' : path.startsWith(prefix)) count += 1
        }
        return count
      }

      /** 目录列举结果的排序：目录优先，其次自然序（`file2` 在 `file10` 前）。 */
      function orderTreeEntries(entries) {
        const list = Array.isArray(entries) ? entries : []
        return list.slice().sort((left, right) => {
          const leftDir = left !== null && left !== undefined && left.type === 'dir'
          const rightDir = right !== null && right !== undefined && right.type === 'dir'
          if (leftDir !== rightDir) return leftDir ? -1 : 1
          return naturalCompare(nameOf(left), nameOf(right))
        })
      }

      function nameOf(entry) {
        if (entry === null || entry === undefined) return ''
        if (typeof entry.name === 'string' && entry.name !== '') return entry.name
        return normalizeRelPath(entry.path)
      }

      /**
       * status 刷新后校正当前选中项（只针对「变更」页签的选中项）。
       *
       * 选中项的 `side` 是「用户当时点的是哪一组」，但文件本身会移动（暂存、取消暂存、
       * 提交）。若刷新后还按旧 side 取 diff，宿主的 `git diff` 会返回空 —— 用户刚点完
       * 「暂存」，右栏却变成「无改动」。所以 side 必须按新条目的实际状态校正：
       * 原 side 仍成立就保留（MM 文件停在用户选的那一侧），否则落到仍然存在的那一侧。
       *
       * 「文件」页签的选中项是路径语义，不经过这里（两个页签的状态彼此独立）。
       *
       * @param {{rootPath: string, path: string, entry: object, side: string}|null} selection
       * @param {Array<object>} files status.files
       * @returns {{rootPath: string, path: string, entry: object, side: string}|null}
       */
      function reconcileSelection(selection, files) {
        if (selection === null) return null
        const entry = files.find((file) => file.path === selection.path)
        if (entry === undefined) return null
        return {
          rootPath: selection.rootPath,
          path: entry.path,
          entry,
          side: sideForEntry(entry, selection.side)
        }
      }

      /** 条目当前仍然成立的一侧；优先保留用户原来选的那一侧。 */
      function sideForEntry(entry, preferred) {
        if (preferred === 'staged' && entry.staged === true) return 'staged'
        if (preferred === 'untracked' && entry.untracked === true) return 'untracked'
        if (preferred === 'unstaged' && entry.unstaged === true) return 'unstaged'
        if (entry.unstaged === true) return 'unstaged'
        if (entry.staged === true) return 'staged'
        return 'untracked'
      }

      /**
       * status 的内容指纹：只要它没变，就没有任何理由让界面重新渲染、重新取 diff。
       *
       * 轮询每 8 秒回来一次，而 `status` 每次都是新对象。直接 `setStatus` 会让整张
       * 变更列表重渲染、让 selection 换成新对象、连带把 diff 重新取一遍 —— 什么都没变，
       * 只是又跑了一圈。指纹覆盖所有会被界面读到的事实（分支 / 同步态 / 每个文件的
       * 状态与行数），变了才落状态。
       */
      function statusSignature(status) {
        const parts = [
          status.repoRoot,
          status.branch,
          status.head,
          status.detached === true ? 'detached' : 'attached',
          status.ahead,
          status.behind,
          status.sync.state,
          status.sync.ahead,
          status.sync.behind,
          status.truncated === true ? 'truncated' : 'complete',
          String(status.counts.total)
        ]
        for (const file of status.files) {
          parts.push([
            file.path,
            file.status,
            file.staged === true ? 's' : '',
            file.unstaged === true ? 'u' : '',
            file.untracked === true ? '?' : '',
            file.conflicted === true ? 'c' : '',
            file.binary === true ? 'b' : '',
            file.adds,
            file.dels,
            file.oldPath ?? ''
          ].join('\u0001'))
        }
        return parts.join('\u0000')
      }

      Object.assign(exports, { GROUP_ORDER, groupsOfFile, groupChanges, rowActionOf, groupActionOf, singleFileShortcut, normalizeRelPath, childPath, matchesEntry, filterEntries, buildGroupRows, buildListRows, ancestorsFor, countFilesUnder, orderTreeEntries, reconcileSelection, sideForEntry, statusSignature });

    });
    __define("./components/FileTree.js", (exports, module) => {
      /**
       * src/components/FileTree.js —— 「文件」模式的浏览树（懒加载）
       *
       * 结构（与 src/styles.js 的 `.dgp-*` 选择器一一对应）：
       *
       *   div.dgp-list[role=tree]                    ← 滚动容器 + 键盘焦点
       *   └─ ul.dgp-level[role=none]
       *      └─ li.dgp-item[role=treeitem][aria-level]
       *         └─ button.dgp-row[data-kind=dir|file][data-active][data-cursor]
       *
       * 每个目录只在第一次展开时调用 `loadDir(relPath, signal)`；结果按 `relPath` 缓存在 useRef(Map) 里，
       * 每个请求一个 AbortController：根切换 / 卸载 / 手动刷新时全部 abort，晚到的响应不会再写回缓存。
       *
       * `reloadNonce` 由 Panel 在「立即刷新 / R」时 +1：清空已加载的目录缓存、保留展开状态并重读 ——
       * 否则外部新建/删除的文件在面板里永远看不到（目录缓存命中就直接返回）。
       *
       * 键盘游标与「变更」树共用 `../ui/useTreeCursor.js`。
       */
      const { h, useEffect, useMemo, useRef, useState } = __m("./platform.js");
      const { Icon } = __m("./ui/Icon.js");
      const { useTreeCursor } = __m("./ui/useTreeCursor.js");
      const { basename, matchesFilter, parentChain } = __m("./util/paths.js");
      const { childPath, orderTreeEntries } = __m("./util/changes.js");
      const { describeError } = __m("./api.js");
      const { EmptyState, InlineNote } = __m("./components/States.js");

      function FileTree(props) {
        const { rootPath, selectedPath, onSelectFile, filter, loadDir, dirtyPaths, reloadNonce, t } = props
        const hasRoot = rootPath !== null
        const filtering = filter.trim() !== ''

        /** relPath -> { status:'loading'|'ok'|'failed', entries, truncated, message } */
        const levelsRef = useRef(new Map())
        /** relPath -> AbortController */
        const controllersRef = useRef(new Map())
        /** 根切换 / 刷新的世代号：晚到的响应据此丢弃。 */
        const generationRef = useRef(0)
        const previousRootRef = useRef(rootPath)

        const [tick, setTick] = useState(0)
        const [expanded, setExpanded] = useState(() => new Set())

        const bump = () => setTick((value) => value + 1)

        /* ------------------------------ 取目录 ------------------------------ */

        function abortAll() {
          for (const controller of controllersRef.current.values()) controller.abort()
          controllersRef.current.clear()
        }

        function request(relPath) {
          const key = relPath
          const cached = levelsRef.current.get(key)
          if (cached !== undefined && (cached.status === 'loading' || cached.status === 'ok')) return
          controllersRef.current.get(key)?.abort()

          const controller = new AbortController()
          controllersRef.current.set(key, controller)
          const generation = generationRef.current
          levelsRef.current.set(key, { status: 'loading', entries: [], truncated: false, message: null })
          bump()

          loadDir(key, controller.signal).then((result) => {
            if (generation !== generationRef.current) return
            levelsRef.current.set(key, {
              status: 'ok',
              entries: result.entries,
              truncated: result.truncated,
              message: null
            })
            controllersRef.current.delete(key)
            bump()
          }, (error) => {
            if (generation !== generationRef.current) return
            levelsRef.current.set(key, {
              status: 'failed',
              entries: [],
              truncated: false,
              message: describeError(error, t)
            })
            controllersRef.current.delete(key)
            bump()
          })
        }

        /* ------------------------------ 副作用 ------------------------------ */

        // 根变化：清缓存、清展开状态、重读根目录；手动刷新（同一根）：保留展开状态重读。
        // 卸载时同样 abort 掉全部在途请求。
        useEffect(() => {
          generationRef.current += 1
          abortAll()
          levelsRef.current.clear()

          const rootChanged = previousRootRef.current !== rootPath
          previousRootRef.current = rootPath

          if (rootChanged) {
            setExpanded(new Set())
            if (hasRoot) request('')
            else setTick((value) => value + 1)
            return abortAll
          }
          request('')
          for (const dirPath of expanded) request(dirPath)
          return abortAll
          // eslint-disable-next-line -- 只跟随根与手动刷新序号
        }, [rootPath, reloadNonce])

        // 任何「已展开但还没缓存」的目录都在渲染后补一次请求（展开、自动展开、临时失败重试都走这里）。
        useEffect(() => {
          if (!hasRoot) return
          for (const dirPath of expanded) {
            if (dirPath === '') continue
            if (!levelsRef.current.has(dirPath)) request(dirPath)
          }
        }, [expanded, tick, hasRoot])

        // 外部改 selectedPath 时，把它的祖先链展开（缺失的层级由上面的副作用加载）。
        useEffect(() => {
          if (!hasRoot || selectedPath === null) return
          const ancestors = parentChain(selectedPath)
          if (ancestors.length === 0) return
          setExpanded((previous) => {
            let next = null
            for (const dirPath of ancestors) {
              if (previous.has(dirPath)) continue
              if (next === null) next = new Set(previous)
              next.add(dirPath)
            }
            return next === null ? previous : next
          })
        }, [rootPath, selectedPath, hasRoot])

        /* ------------------------------ 行模型 ------------------------------ */

        /**
         * 过滤判定：条目自身（名字 / 根相对路径）命中，或**已加载**的子项里有命中
         * （这样 `src/app.js` 命中时祖先目录 `src` 仍然显示，用户能点进去）。
         * 只看已加载的层级，不做服务端搜索。
         */
        function entryMatches(relPath, entry) {
          const rel = childPath(relPath, entry)
          if (matchesFilter(rel, filter) || matchesFilter(entry.name, filter)) return true
          if (entry.type !== 'dir') return false
          const level = levelsRef.current.get(rel)
          if (level === undefined || level.status !== 'ok') return false
          return level.entries.some((child) => entryMatches(rel, child))
        }

        /**
         * 把「已加载 + 已展开」的部分压成一个扁平行数组（深度优先）。
         * 筛选时把所有已加载目录都当成展开：命中项不能藏在折叠的目录里。
         */
        function collectLevel(relPath, depth, out) {
          const level = levelsRef.current.get(relPath)
          const baseKey = relPath === '' ? 'root' : relPath
          if (level === undefined || level.status === 'loading') {
            out.push({ kind: 'note', key: baseKey + ':loading', tone: 'info', text: t('status.loading'), depth })
            return
          }
          if (level.status === 'failed') {
            out.push({ kind: 'note', key: baseKey + ':failed', tone: 'error', text: level.message, depth })
            return
          }

          const visible = filtering ? level.entries.filter((entry) => entryMatches(relPath, entry)) : level.entries
          const ordered = orderTreeEntries(visible)

          if (ordered.length === 0) {
            const text = filtering ? t('status.emptyFilter', { filter }) : t('status.emptyDir')
            out.push({ kind: 'note', key: baseKey + ':empty', tone: 'info', text, depth })
          }

          for (const entry of ordered) {
            const rel = childPath(relPath, entry)
            const type = entry.type === 'dir' ? 'dir' : (entry.type === 'file' ? 'file' : 'other')
            const name = entry.name !== '' ? entry.name : basename(rel)
            if (type === 'dir') {
              const open = filtering || expanded.has(rel)
              out.push({ kind: 'dir', key: 'dir:' + rel, path: rel, name, depth, open })
              if (open) collectLevel(rel, depth + 1, out)
            } else {
              out.push({ kind: 'file', key: type + ':' + rel, path: rel, name, depth, other: type === 'other' })
            }
          }

          if (level.truncated === true) {
            out.push({ kind: 'note', key: baseKey + ':truncated', tone: 'info', text: t('status.truncated'), depth })
          }
        }

        const rows = useMemo(() => {
          const out = []
          if (hasRoot) collectLevel('', 0, out)
          return out
          // eslint-disable-next-line -- tick 让 ref 缓存的变化进入依赖
        }, [hasRoot, rootPath, tick, expanded, filter, t])

        const rootLevel = hasRoot ? levelsRef.current.get('') : undefined
        const rootFailed = rootLevel !== undefined && rootLevel.status === 'failed'
        const rootReady = rootLevel !== undefined && rootLevel.status === 'ok'
        const hasVisibleRows = rows.some((row) => row.kind === 'dir' || row.kind === 'file')
        const filterNote = filtering ? t('filter.loadedOnly') : null
        const filterEmpty = filtering && rootReady && !hasVisibleRows

        /* ------------------------------ 交互 ------------------------------ */

        function toggleDir(dirPath) {
          setExpanded((previous) => {
            const next = new Set(previous)
            if (next.has(dirPath)) next.delete(dirPath)
            else next.add(dirPath)
            return next
          })
        }

        function activateRow(row) {
          if (row.kind === 'note') return
          if (row.kind === 'dir') toggleDir(row.path)
          else if (row.other !== true) onSelectFile(row.path)
        }

        const cursorState = useTreeCursor({
          rows,
          isDir: (row) => row.kind === 'dir',
          isOpen: (row) => expanded.has(row.path),
          onToggle: (row) => toggleDir(row.path),
          onActivate: activateRow
        })
        const { cursor, rowRefs, focusRow, handleKeyDown } = cursorState

        // 外部选中项变化 → 键盘游标跟随。
        useEffect(() => {
          if (selectedPath === null) return
          const index = rows.findIndex((row) => row.kind === 'file' && row.path === selectedPath)
          if (index >= 0) focusRow(index)
        }, [selectedPath, rows])

        /* ------------------------------ 渲染 ------------------------------ */

        function renderRow(row, index) {
          const depth = row.depth

          if (row.kind === 'note') {
            return h('li', { key: row.key, className: 'dgp-item', role: 'none' },
              h('span', {
                className: 'dgp-note',
                'data-tone': row.tone,
                'data-dgp-note': row.key,
                // 提示文字缩进跟层级走（唯一允许的内联布局属性）
                style: { paddingLeft: String(8 + depth * 14) + 'px' }
              }, row.text))
          }

          const isCursor = cursor === index
          if (row.kind === 'dir') {
            const open = expanded.has(row.path)
            return h('li', {
              key: row.key,
              className: 'dgp-item',
              role: 'treeitem',
              'aria-level': depth + 1,
              'aria-expanded': open
            },
            h('button', {
              type: 'button',
              className: 'dgp-row',
              style: { '--dgp-depth': depth },
              'data-kind': 'dir',
              'data-dgp-entry': 'dir',
              'data-dgp-path': row.path,
              'data-dgp-row': 'dir',
              'data-open': open ? 'true' : 'false',
              'data-cursor': isCursor ? 'true' : undefined,
              title: row.path,
              'aria-expanded': open,
              ref: (element) => {
                rowRefs.current[index] = element
              },
              onClick: () => {
                focusRow(index)
                toggleDir(row.path)
              }
            },
            h('span', { className: 'dgp-caret', 'data-open': open ? 'true' : 'false' },
              h(Icon, { name: 'chevron-right', size: 12 })),
            h(Icon, { name: open ? 'folder-open' : 'folder', size: 14 }),
            h('span', { className: 'dgp-name dgp-name-dir dgp-oneline' }, row.name)))
          }

          const isActive = selectedPath !== null && row.path === selectedPath
          const dirty = dirtyPaths.has(row.path) === true
          return h('li', {
            key: row.key,
            className: 'dgp-item',
            role: 'treeitem',
            'aria-level': depth + 1,
            'aria-selected': isActive ? 'true' : 'false'
          },
          h('button', {
            type: 'button',
            className: 'dgp-row',
            style: { '--dgp-depth': depth },
            'data-kind': 'file',
            'data-dgp-entry': 'file',
            'data-dgp-path': row.path,
            'data-dgp-row': 'file',
            'data-active': isActive ? 'true' : 'false',
            'aria-selected': isActive ? 'true' : 'false',
            'data-dirty': dirty === true ? 'true' : undefined,
            'data-cursor': isCursor ? 'true' : undefined,
            'aria-disabled': row.other === true ? 'true' : undefined,
            title: row.path,
            ref: (element) => {
              rowRefs.current[index] = element
            },
            onClick: () => {
              focusRow(index)
              activateRow(row)
            }
          },
          h(Icon, { name: 'file', size: 14 }),
          h('span', { className: 'dgp-name dgp-oneline' }, row.name),
          dirty === true
            ? h('span', { className: 'dgp-dirty-dot', 'data-dirty': 'true', 'aria-label': t('editor.unsaved') })
            : null))
        }

        const container = (children) => h('div', {
          className: 'dgp-list',
          role: 'tree',
          tabIndex: 0,
          'aria-label': t('mode.files'),
          'data-dgp-list': 'files',
          onKeyDown: handleKeyDown
        }, children)

        if (!hasRoot) {
          return container(h(EmptyState, {
            icon: 'folder',
            title: t('status.noRoots'),
            description: t('status.noRootsHint')
          }))
        }

        if (rootFailed) return container(h(InlineNote, { tone: 'error' }, rootLevel.message))

        if (filterEmpty) {
          return container([
            filterNote === null ? null : h(InlineNote, { key: 'filter-note', tone: 'info' }, filterNote),
            h(EmptyState, {
              key: 'empty',
              icon: 'search',
              title: t('status.emptyFilter', { filter })
            })
          ])
        }

        return container([
          filterNote === null ? null : h(InlineNote, { key: 'filter-note', tone: 'info' }, filterNote),
          h('ul', { key: 'level', className: 'dgp-level', role: 'none' }, rows.map((row, index) => renderRow(row, index)))
        ])
      }

      Object.assign(exports, { FileTree });

    });
    __define("./components/DiffView.js", (exports, module) => {
      /**
       * src/components/DiffView.js —— 右侧 diff 查看器（统一 / 并排）
       *
       * 只负责「把 Hunk[] 画成 DOM」：行几何全部来自 `../util/diff.js`（纯函数、可单测），
       * 这里只做 memo 化、状态分派、词级高亮贴片和无障碍钩子。
       *
       * DOM 结构（与 CONTRACT.md §5 的 class 词汇表一一对应）：
       *
       *   div.dgp-viewer
       *     ├─ div.dgp-viewer-head                 38px：状态字母 / 文件名 / 父路径 / +N −N
       *     └─ div.dgp-scroll[role=region][data-wrap]      ← 真正的滚动容器（overflow:auto）
       *          └─ div.dgp-diff[data-view][data-wrap]
       *               ├─（unified）div.dgp-hunk + div.dgp-diff-row[data-kind] × N
       *               └─（split）  div.dgp-diff-columns
       *                              ├─ div.dgp-diff-col[data-side=old]
       *                              └─ div.dgp-diff-col[data-side=new]
       *
       * 硬约束（Lead 的 styles.css 已按此实现）：
       *   - `.dgp-scroll` 是滚动容器（flex column + overflow:auto），`.dgp-diff` 是它里面的内容块
       *     （`flex:1 1 auto; min-height:0`，与 FileView 的 `.dgp-scroll > .dgp-file` 同构）。
       *     **不要**把两个类放在同一个节点上：`.dgp-diff-col{overflow:hidden}` 会把超长列表裁掉，
       *     导致 split 视图无法纵向滚动。
       *   - `.dgp-diff-row` 是 4 列 grid，所以 unified 行的直接子元素必须是
       *     `.dgp-ln` / `.dgp-ln` / `.dgp-marker` / `.dgp-diff-text`，不能再包一层容器，否则 grid 列会错位。
       *   - `.dgp-diff-cell` 是 2 列 grid，子元素顺序固定为 `.dgp-ln` + `.dgp-diff-text`。
       *   - `.dgp-hunk-head` 是 flex + 两侧 filler，`.dgp-hunk-section` 必须是它的**子元素**才能同行。
       *   - `+` / `−` 符号由 CSS 的 `::before` 负责，`.dgp-marker` 里只放空内容。
       *   - 行底色/正文色只靠 `data-kind`，diff 行禁止使用 `dgp-add` / `dgp-del` 类（那两个是计数色）。
       */
      const { h, useState, useEffect, useMemo, useRef } = __m("./platform.js");
      const { MAX_DIFF_ROWS, buildSplitRows, buildUnifiedRows, budgetRows, diffStats, highlightWordDiff } = __m("./util/diff.js");
      const { basename, dirname } = __m("./util/paths.js");
      const { Icon, StatusLetter } = __m("./ui/Icon.js");
      const { EmptyState, ErrorState, InlineNote, LoadingState } = __m("./components/States.js");

      /** 空 hunk 列表的稳定引用（避免每次渲染都造新数组，把 memo 打穿）。 */
      const EMPTY_HUNKS = []

      const SIDE_OLD = 'old'
      const SIDE_NEW = 'new'

      /** 空/加载/错误态用的图标节点（States.EmptyState 的 icon 是 React 节点）。 */
      function stateIcon(name) {
        return h(Icon, { name, size: 24 })
      }

      /** 取第一个「已知」的计数：负数表示宿主没给数字（二进制/统计失败），不能当成 0 也不能显示出来。 */
      function pickCount(...values) {
        for (const value of values) {
          if (typeof value === 'number' && value >= 0) return value
        }
        return 0
      }

      // ---------------------------------------------------------------------------
      // 词级高亮：把「配对好的行」标出同一行内的差异片段
      // ---------------------------------------------------------------------------

      /**
       * unified 视图的行是顺序排列的：一段 del 后面跟一段 add。这里用与 split 相同的
       * run 配对规则（按下标）把 del/add 行配起来，返回 rowIndex → segments 的两张表。
       */
      function buildUnifiedMarks(rows) {
        const oldMarks = new Map()
        const newMarks = new Map()
        let delIndexes = []
        let addIndexes = []

        const flush = () => {
          const total = delIndexes.length > addIndexes.length ? delIndexes.length : addIndexes.length
          for (let at = 0; at < total; at += 1) {
            if (at >= delIndexes.length || at >= addIndexes.length) continue
            const delAt = delIndexes[at]
            const addAt = addIndexes[at]
            const pair = highlightWordDiff(rows[delAt].text, rows[addAt].text)
            oldMarks.set(delAt, pair.oldSegments)
            newMarks.set(addAt, pair.newSegments)
          }
          delIndexes = []
          addIndexes = []
        }

        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index]
          if (row.type !== 'line') {
            flush()
            continue
          }
          if (row.kind === 'del') delIndexes.push(index)
          else if (row.kind === 'add') addIndexes.push(index)
          else flush()
        }
        flush()
        return { oldMarks, newMarks }
      }

      /** split 视图的每一行本身就是一个已配对的 pair，直接按行算即可。 */
      function buildSplitMarks(rows) {
        const oldMarks = new Map()
        const newMarks = new Map()
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index]
          if (row.type !== 'pair') continue
          const left = row.left
          const right = row.right
          if (left === null || left === undefined || right === null || right === undefined) continue
          if (left.kind !== 'del' || right.kind !== 'add') continue
          const pair = highlightWordDiff(left.text, right.text)
          oldMarks.set(index, pair.oldSegments)
          newMarks.set(index, pair.newSegments)
        }
        return { oldMarks, newMarks }
      }

      // ---------------------------------------------------------------------------
      // 行渲染（模块级纯渲染函数，避免每次渲染重建闭包）
      // ---------------------------------------------------------------------------

      function lineNumberNode(side, line) {
        const text = line === undefined || line === null ? null : String(line)
        return h('span', { className: 'dgp-ln', 'data-side': side }, text)
      }

      function diffTextNode(text, segments) {
        if (segments === undefined || segments === null || segments.length === 0) {
          return h('span', { className: 'dgp-diff-text' }, text === '' || text === undefined || text === null ? null : text)
        }
        const children = []
        for (let index = 0; index < segments.length; index += 1) {
          const segment = segments[index]
          if (segment.changed) {
            children.push(h('mark', { key: index, className: 'dgp-diff-mark' }, segment.text))
          } else {
            children.push(segment.text)
          }
        }
        return h('span', { className: 'dgp-diff-text' }, children)
      }

      function hunkNode(row, index, keyBase) {
        const sectionNode = typeof row.section === 'string' && row.section !== ''
          ? h('span', { className: 'dgp-hunk-section' }, row.section)
          : null
        // section 必须放在 head 里面：head 是 flex + 两侧 filler，放外面会掉到第二行
        return h(
          'div',
          { key: keyBase + ':' + index, className: 'dgp-hunk' },
          h('div', { className: 'dgp-hunk-head' }, row.header, sectionNode)
        )
      }

      /**
       * 统一视图的一行。
       * 注意：直接子元素就是 4 列 grid 的 4 个格子。
       */
      function unifiedRowNode(row, index, keyBase, marks) {
        let segments
        if (row.kind === 'add') segments = marks.newMarks.get(index)
        else if (row.kind === 'del') segments = marks.oldMarks.get(index)
        return h(
          'div',
          { key: keyBase + ':' + index, className: 'dgp-diff-row', 'data-kind': row.kind },
          lineNumberNode(SIDE_OLD, row.oldLine),
          lineNumberNode(SIDE_NEW, row.newLine),
          h('span', { className: 'dgp-marker', 'aria-hidden': 'true' }),
          diffTextNode(row.text, segments)
        )
      }

      /** 并排视图某一侧的一行；该侧没有内容时给一个空槽（data-kind="empty"）。 */
      function splitSideRowNode(row, index, side, marks, keyBase) {
        const cell = side === SIDE_OLD ? row.left : row.right
        const key = keyBase + ':' + side + ':' + index
        if (cell === null || cell === undefined) {
          return h(
            'div',
            { key, className: 'dgp-diff-row', 'data-kind': 'empty' },
            h('span', { className: 'dgp-diff-cell', 'data-side': side, 'data-kind': 'empty', 'data-empty': 'true' })
          )
        }
        const segments = side === SIDE_OLD ? marks.oldMarks.get(index) : marks.newMarks.get(index)
        return h(
          'div',
          { key, className: 'dgp-diff-row', 'data-kind': cell.kind },
          h(
            'span',
            { className: 'dgp-diff-cell', 'data-side': side, 'data-kind': cell.kind },
            lineNumberNode(side, cell.line),
            diffTextNode(cell.text, segments)
          )
        )
      }

      /** 截断提示行：说明 + 省略的行数 + 「展开全部」。 */
      function truncatedNode(count, key, t, onExpand) {
        return h(
          'div',
          { key, className: 'dgp-diff-truncated' },
          h('span', { className: 'dgp-hint' }, t('viewer.truncated')),
          h('span', { className: 'dgp-meta' }, t('viewer.lines', { count })),
          h(
            'button',
            {
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-variant': 'ghost',
              type: 'button',
              onClick: onExpand
            },
            t('viewer.expandAll')
          )
        )
      }

      // ---------------------------------------------------------------------------
      // 组件
      // ---------------------------------------------------------------------------

      /**
       * @param {object} props
       * @param {object|null} props.diff      DiffResult | null
       * @param {boolean} props.loading
       * @param {string|null} props.error
       * @param {string|null} props.path      显示用路径（相对 repoRoot）
       * @param {object|null} props.entry     FileEntry（状态字母 / 重命名前路径 / 计数兜底）
       * @param {'unified'|'split'} props.view
       * @param {boolean} props.wrap
       * @param {Function} props.onRetry
       * @param {Function} props.t
       */
      function DiffView(props) {
        const { diff, loading, error, path, entry, view, wrap, onRetry, t } = props

        const split = view === 'split'
        const filePath = path
        const hasFile = filePath !== '' || entry !== null
        const hunks = diff === null ? EMPTY_HUNKS : diff.hunks

        const [expanded, setExpanded] = useState(false)
        const scrollRef = useRef(null)

        // 换文件 / 换布局：回到顶部并收起「全部展开」
        useEffect(() => {
          setExpanded(false)
        }, [filePath, view])

        // 只有真的画出滚动容器时才需要回到顶部（加载 / 空态 / 占位态没有它）。
        useEffect(() => {
          if (scrollRef.current === null) return
          scrollRef.current.scrollTo({ top: 0 })
        }, [diff, filePath, view])

        // 行构建 + 预算 + 词级高亮：只依赖 diff / view（以及本地的展开开关）
        const built = useMemo(() => {
          const sourceRows = split ? buildSplitRows(hunks) : buildUnifiedRows(hunks)
          const budgeted = expanded
            ? { rows: sourceRows, truncatedCount: 0 }
            : budgetRows(sourceRows, MAX_DIFF_ROWS)
          return {
            rows: budgeted.rows,
            truncatedCount: budgeted.truncatedCount,
            marks: split ? buildSplitMarks(budgeted.rows) : buildUnifiedMarks(budgeted.rows)
          }
        }, [diff, view, expanded])

        // 头部计数：diff.stats 是宿主给的权威值；没给时才退回文件条目与本地统计。
        const computedStats = diffStats(hunks)
        const adds = pickCount(diff === null ? undefined : diff.stats.adds, entry === null ? undefined : entry.adds, computedStats.adds)
        const dels = pickCount(diff === null ? undefined : diff.stats.dels, entry === null ? undefined : entry.dels, computedStats.dels)

        const keyBase = filePath + '|' + (split ? 'split' : 'unified')
        const regionLabel = t(split ? 'toolbar.split' : 'toolbar.unified')

        // ---- 头部：状态字母 + 文件名 + 父路径（+ 重命名来源）+ 计数 ----
        let headNode = null
        if (hasFile) {
          const headChildren = []
          if (entry !== null) headChildren.push(h(StatusLetter, { key: 'status', status: entry.status }))
          const titleChildren = [
            h('span', { key: 'name', className: 'dgp-name dgp-oneline' }, basename(filePath))
          ]
          const parentPath = dirname(filePath)
          if (parentPath !== '') {
            titleChildren.push(h('span', { key: 'parent', className: 'dgp-viewer-sub dgp-oneline' }, parentPath))
          }
          if (entry !== null && entry.oldPath !== null && entry.oldPath !== undefined) {
            titleChildren.push(h(
              'span',
              { key: 'oldPath', className: 'dgp-viewer-sub dgp-oneline' },
              t('viewer.oldPath', { path: entry.oldPath })
            ))
          }
          headChildren.push(h('div', { key: 'title', className: 'dgp-viewer-title' }, titleChildren))
          headChildren.push(h(
            'div',
            { key: 'actions', className: 'dgp-viewer-actions' },
            h('span', { key: 'adds', className: 'dgp-add' }, t('viewer.adds', { count: adds })),
            h('span', { key: 'dels', className: 'dgp-del' }, t('viewer.dels', { count: dels }))
          ))
          headNode = h('div', { className: 'dgp-viewer-head' }, headChildren)
        }

        // ---- 主体：加载 / 错误 / 各种「不能画 diff」的 kind / 正常渲染 ----
        let bodyNode = null

        if (error !== null) {
          bodyNode = h(ErrorState, { message: error, onRetry, t })
        } else if (loading === true) {
          bodyNode = h(LoadingState, { label: t('status.loadingDiff'), t })
        } else if (diff === null) {
          bodyNode = h(EmptyState, {
            icon: stateIcon('file-diff'),
            title: t('viewer.placeholderDiff')
          })
        } else {
          const message = diff.message ?? ''
          const kind = diff.kind

          if (kind === 'binary') {
            bodyNode = h(EmptyState, { icon: stateIcon('file'), title: t('viewer.binary') })
          } else if (kind === 'oversized') {
            bodyNode = h(EmptyState, {
              icon: stateIcon('file'),
              title: t('viewer.oversized'),
              description: message === '' ? undefined : message
            })
          } else if (kind === 'directory') {
            bodyNode = h(EmptyState, { icon: stateIcon('folder'), title: t('viewer.directory') })
          } else if (kind === 'submodule') {
            bodyNode = h(EmptyState, { icon: stateIcon('git-merge'), title: t('viewer.submodule') })
          } else if (kind === 'error') {
            bodyNode = h(ErrorState, { message, onRetry, t })
          } else if (kind === 'deleted' && hunks.length === 0) {
            bodyNode = h(EmptyState, { icon: stateIcon('trash'), title: t('viewer.deletedFile') })
          } else if (hunks.length === 0) {
            const renamed = entry !== null && entry.oldPath !== null && entry.oldPath !== undefined
            let title = t('viewer.noChanges')
            if (renamed) title = t('viewer.renameOnly')
            else if (diff.newFile === true) title = t('viewer.newFile')
            bodyNode = h(EmptyState, {
              icon: stateIcon(diff.newFile === true ? 'plus' : 'file-diff'),
              title,
              description: message === '' ? undefined : message
            })
          } else {
            const rows = built.rows
            const content = []

            if (diff.truncated === true) {
              content.push(h(InlineNote, { key: 'host-truncated', tone: 'warn' }, t('viewer.truncated')))
            }
            if (diff.newFile === true) {
              content.push(h(InlineNote, { key: 'new-file', tone: 'info' }, t('viewer.newFile')))
            }

            if (split) {
              const columns = []
              const sides = [SIDE_OLD, SIDE_NEW]
              for (let at = 0; at < sides.length; at += 1) {
                const side = sides[at]
                const cells = []
                for (let index = 0; index < rows.length; index += 1) {
                  const row = rows[index]
                  if (row.type === 'hunk') cells.push(hunkNode(row, index, keyBase))
                  else cells.push(splitSideRowNode(row, index, side, built.marks, keyBase))
                }
                columns.push(h('div', { key: side, className: 'dgp-diff-col', 'data-side': side }, cells))
              }
              content.push(h('div', { key: 'columns', className: 'dgp-diff-columns' }, columns))
            } else {
              for (let index = 0; index < rows.length; index += 1) {
                const row = rows[index]
                if (row.type === 'hunk') content.push(hunkNode(row, index, keyBase))
                else content.push(unifiedRowNode(row, index, keyBase, built.marks))
              }
            }

            if (built.truncatedCount > 0) {
              content.push(truncatedNode(built.truncatedCount, 'truncated', t, () => setExpanded(true)))
            }

            bodyNode = h(
              'div',
              {
                className: 'dgp-scroll',
                ref: scrollRef,
                role: 'region',
                'aria-label': regionLabel,
                'aria-busy': loading === true ? 'true' : undefined,
                'data-wrap': wrap === true ? 'true' : undefined
              },
              // .dgp-diff 是滚动容器里的内容块（与 FileView 的 .dgp-scroll > .dgp-file 同构）；
              // data-wrap 同时挂两层，让 .dgp-diff[data-wrap=\"true\"] 这类选择器都能命中。
              h(
                'div',
                {
                  className: 'dgp-diff',
                  'data-view': split ? 'split' : 'unified',
                  'data-wrap': wrap === true ? 'true' : undefined
                },
                content
              )
            )
          }
        }

        return h(
          'div',
          { className: 'dgp-viewer', 'data-dgp-path': filePath !== '' ? filePath : undefined },
          headNode,
          bodyNode
        )
      }

      Object.assign(exports, { DiffView });

    });
    __define("./util/diff.js", (exports, module) => {
      /**
       * src/util/diff.js —— diff 的纯函数层（无 react / 无 DOM）
       *
       * 输入是 Host 侧 `parseUnifiedDiff()` 产出的 `Hunk[]`（形状见 CONTRACT.md §2）：
       *
       *   Hunk = { header, section, oldStart, oldLines, newStart, newLines,
       *            lines: DiffLine[] }
       *   DiffLine = { kind: 'add'|'del'|'ctx', oldLine?, newLine?, text, noNewline? }
       *
       * 这一层只做「hunk → 行数组」的几何变换，渲染（React）与样式都在 DiffView.js。
       * 全部函数都是纯函数、对空值/缺字段宽容，可以直接在 Node 里单测（test/diff.test.mjs）。
       */

      /** 全局行预算：一次渲染最多画这么多行，防止超大 patch 冻住浏览器。 */
      const MAX_DIFF_ROWS = 5000

      /** 词级高亮的单行字符上限；超过则整行标记为 changed（不做逐字比对，保证 O(n)）。 */
      const MAX_WORD_DIFF_CHARS = 2000

      // ---------------------------------------------------------------------------
      // 内部小工具
      // ---------------------------------------------------------------------------

      /**
       * 像不像一个 hunk：有 lines 数组，或至少有非空 header。
       * 用来把 null / 数字 / 空对象这类脏数据挡在外面，而不是渲染出一个假的 hunk 头。
       */
      function isHunkLike(value) {
        if (!value || typeof value !== 'object') return false
        if (Array.isArray(value.lines)) return true
        return typeof value.header === 'string' && value.header !== ''
      }

      /** 把各种可能的行类型写法归一化成 add | del | ctx | nonewline。 */
      function normalizeKind(kind) {
        if (kind === 'add' || kind === '+' || kind === 'insert') return 'add'
        if (kind === 'del' || kind === '-' || kind === 'delete' || kind === 'remove') return 'del'
        if (kind === 'nonewline' || kind === 'no-newline' || kind === 'noNewline') return 'nonewline'
        // 'ctx' / 'context' / ' ' / 未知值 一律当上下文，保证解析异常时不丢行
        return 'ctx'
      }

      /** 转整数，失败给 0（hunk 头缺字段时用）。 */function asInteger(value) {
        const number = typeof value === 'number' ? value : Number(value)
        return Number.isFinite(number) ? Math.trunc(number) : 0
      }

      /** 行号：合法数字就用它，否则退回游标（缺 oldLine/newLine 时的兜底）。 */
      function asLineNumber(value, fallback) {
        if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
        return fallback
      }

      /** 正文：null/undefined → ''，并去掉行尾的 CR（Host 可能留下 CRLF 的 \r）。 */
      function asText(value) {
        if (value === undefined || value === null) return ''
        const text = String(value)
        return text.charCodeAt(text.length - 1) === 13 ? text.slice(0, -1) : text
      }

      /**
       * 拆 hunk 头：`@@ -a,b +c,d @@ section` → { header: '@@ -a,b +c,d @@', section: 'section' }。
       * Host 的 `header` 是整行（含 section），这里必须拆开，否则 UI 上会重复显示一次 section。
       */
      function splitHeader(hunk) {
        const raw = typeof hunk.header === 'string' ? hunk.header : ''
        const close = raw.indexOf(' @@')
        let head = raw
        let tail = ''
        if (close !== -1) {
          head = raw.slice(0, close + 3)
          tail = raw.slice(close + 3).trim()
        }
        if (head === '') {
          head = '@@ -' + asInteger(hunk.oldStart) + ',' + asInteger(hunk.oldLines)
            + ' +' + asInteger(hunk.newStart) + ',' + asInteger(hunk.newLines) + ' @@'
        }
        const section = typeof hunk.section === 'string' && hunk.section !== '' ? hunk.section : tail
        return { header: head, section }
      }

      /**
       * 把一个 hunk 的 lines 走一遍，补全行号、剔除 `\ No newline at end of file` 标记行。
       * 返回 [{ kind, oldLine, newLine, text, noNewline }]，顺序与 git 输出一致。
       *
       * 行号策略：优先用 Host 给的 oldLine/newLine；缺字段时用 hunk 头 + 游标推算，
       * 这样一个字段缺失的 hunk 也不会出现「整列空号」。
       */
      function hunkLines(hunk) {
        const entries = []
        if (!hunk || typeof hunk !== 'object') return entries
        const lines = Array.isArray(hunk.lines) ? hunk.lines : []
        let oldNo = asInteger(hunk.oldStart)
        let newNo = asInteger(hunk.newStart)

        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index]
          if (!line || typeof line !== 'object') continue
          const kind = normalizeKind(line.kind)

          // `\ No newline at end of file` 不是内容行：标记挂到上一行上，不单独成行
          if (kind === 'nonewline') {
            const previous = entries.length > 0 ? entries[entries.length - 1] : null
            if (previous !== null) previous.noNewline = true
            continue
          }

          const text = asText(line.text)
          const marked = line.noNewline === true

          if (kind === 'add') {
            const newLine = asLineNumber(line.newLine, newNo)
            newNo = newLine + 1
            entries.push({ kind: 'add', oldLine: undefined, newLine, text, noNewline: marked })
            continue
          }
          if (kind === 'del') {
            const oldLine = asLineNumber(line.oldLine, oldNo)
            oldNo = oldLine + 1
            entries.push({ kind: 'del', oldLine, newLine: undefined, text, noNewline: marked })
            continue
          }
          const oldLine = asLineNumber(line.oldLine, oldNo)
          const newLine = asLineNumber(line.newLine, newNo)
          oldNo = oldLine + 1
          newNo = newLine + 1
          entries.push({ kind: 'ctx', oldLine, newLine, text, noNewline: marked })
        }
        return entries
      }

      /** 并列视图的一个格子；side 空缺时由调用方写 null。 */
      function makeCell(kind, line, text, noNewline) {
        return { kind, line, text, noNewline: noNewline === true }
      }

      // ---------------------------------------------------------------------------
      // 统一视图
      // ---------------------------------------------------------------------------

      /**
       * hunk 列表 → 统一视图的扁平行数组。
       *
       * Row = { type:'hunk', header, section }
       *     | { type:'line', kind:'add'|'del'|'ctx', oldLine, newLine, text, noNewline }
       *
       * @param {Array<object>|null|undefined} hunks
       * @returns {Array<object>}
       */
      function buildUnifiedRows(hunks) {
        const rows = []
        const list = Array.isArray(hunks) ? hunks : []
        for (let index = 0; index < list.length; index += 1) {
          const hunk = list[index]
          if (!isHunkLike(hunk)) continue
          const head = splitHeader(hunk)
          rows.push({ type: 'hunk', header: head.header, section: head.section })
          const entries = hunkLines(hunk)
          for (let at = 0; at < entries.length; at += 1) {
            const entry = entries[at]
            rows.push({
              type: 'line',
              kind: entry.kind,
              oldLine: entry.oldLine,
              newLine: entry.newLine,
              text: entry.text,
              noNewline: entry.noNewline
            })
          }
        }
        return rows
      }

      // ---------------------------------------------------------------------------
      // 并列视图
      // ---------------------------------------------------------------------------

      /**
       * 把一个 hunk 的改动块配对成「左/右」行。
       *
       * 算法（与 DSH 自己的 FileDiff.splitRows 对齐）：
       *   1. 顺序扫行，连续的 del 收集成 del-run、连续的 add 收集成 add-run；
       *   2. 遇到 ctx 或 hunk 结束就 flush：两个 run 按**下标**逐行配对，长的一边多出的行另一侧补 null；
       *   3. ctx 行直接生成左右同文、各自行号的配对。
       *
       * 所以 `-a -b -c +x` 会得到三行：(-a,+x)、(-b,null)、(-c,null)，而不是把 -c 和 +x 错位。
       *
       * @param {object|null|undefined} hunk
       * @returns {Array<{left: object|null, right: object|null}>} cell = { kind, line, text, noNewline }
       */
      function pairChangedRuns(hunk) {
        const pairs = []
        const dels = []
        const adds = []

        const flush = () => {
          const total = dels.length > adds.length ? dels.length : adds.length
          for (let at = 0; at < total; at += 1) {
            const left = at < dels.length ? dels[at] : null
            const right = at < adds.length ? adds[at] : null
            pairs.push({ left, right })
          }
          dels.length = 0
          adds.length = 0
        }

        const entries = hunkLines(hunk)
        for (let index = 0; index < entries.length; index += 1) {
          const entry = entries[index]
          if (entry.kind === 'add') {
            adds.push(makeCell('add', entry.newLine, entry.text, entry.noNewline))
            continue
          }
          if (entry.kind === 'del') {
            dels.push(makeCell('del', entry.oldLine, entry.text, entry.noNewline))
            continue
          }
          flush()
          pairs.push({
            left: makeCell('ctx', entry.oldLine, entry.text, entry.noNewline),
            right: makeCell('ctx', entry.newLine, entry.text, entry.noNewline)
          })
        }
        flush()
        return pairs
      }

      /**
       * hunk 列表 → 并列视图的行数组。
       *
       * Row = { type:'hunk', header, section }
       *     | { type:'pair', left: {kind,line,text}|null, right: {kind,line,text}|null }
       *
       * @param {Array<object>|null|undefined} hunks
       * @returns {Array<object>}
       */
      function buildSplitRows(hunks) {
        const rows = []
        const list = Array.isArray(hunks) ? hunks : []
        for (let index = 0; index < list.length; index += 1) {
          const hunk = list[index]
          if (!isHunkLike(hunk)) continue
          const head = splitHeader(hunk)
          rows.push({ type: 'hunk', header: head.header, section: head.section })
          const pairs = pairChangedRuns(hunk)
          for (let at = 0; at < pairs.length; at += 1) {
            const pair = pairs[at]
            rows.push({ type: 'pair', left: pair.left, right: pair.right })
          }
        }
        return rows
      }

      // ---------------------------------------------------------------------------
      // 词级高亮
      // ---------------------------------------------------------------------------

      /**
       * 一段文本切成 [{ text, changed }]：去掉公共前后缀，把中间那段标成 changed。
       * 不做 LCS，代价 O(n)；超过 MAX_WORD_DIFF_CHARS 的行直接整行 changed，避免长行卡死。
       *
       * @param {string|null|undefined} oldText
       * @param {string|null|undefined} newText
       * @returns {{oldSegments: Array<{text: string, changed: boolean}>,
       *            newSegments: Array<{text: string, changed: boolean}>}}
       */
      function highlightWordDiff(oldText, newText) {
        const before = asText(oldText)
        const after = asText(newText)

        if (before.length > MAX_WORD_DIFF_CHARS || after.length > MAX_WORD_DIFF_CHARS) {
          return {
            oldSegments: before === '' ? [] : [{ text: before, changed: true }],
            newSegments: after === '' ? [] : [{ text: after, changed: true }]
          }
        }

        const shortest = before.length < after.length ? before.length : after.length
        let prefix = 0
        while (prefix < shortest && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1

        const ceiling = shortest - prefix
        let suffix = 0
        while (
          suffix < ceiling
          && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
        ) {
          suffix += 1
        }

        const beforeMiddle = before.length - prefix - suffix
        const afterMiddle = after.length - prefix - suffix
        return {
          oldSegments: segmentsOf(before, prefix, beforeMiddle),
          newSegments: segmentsOf(after, prefix, afterMiddle)
        }
      }

      /** 按 [prefix, middle, rest] 三段切（空段不产出）。 */
      function segmentsOf(text, prefixLength, middleLength) {
        const segments = []
        if (prefixLength > 0) segments.push({ text: text.slice(0, prefixLength), changed: false })
        if (middleLength > 0) {
          segments.push({ text: text.slice(prefixLength, prefixLength + middleLength), changed: true })
        }
        const rest = text.slice(prefixLength + middleLength)
        if (rest !== '') segments.push({ text: rest, changed: false })
        return segments
      }

      // ---------------------------------------------------------------------------
      // 统计 / 预算
      // ---------------------------------------------------------------------------

      /**
       * 统计新增/删除行数。`\ No newline` 标记行、未知 kind 都不计数。
       * @param {Array<object>|null|undefined} hunks
       * @returns {{adds: number, dels: number}}
       */
      function diffStats(hunks) {
        const stats = { adds: 0, dels: 0 }
        const list = Array.isArray(hunks) ? hunks : []
        for (let index = 0; index < list.length; index += 1) {
          const hunk = list[index]
          if (!hunk || typeof hunk !== 'object') continue
          const lines = Array.isArray(hunk.lines) ? hunk.lines : []
          for (let at = 0; at < lines.length; at += 1) {
            const line = lines[at]
            if (!line || typeof line !== 'object') continue
            const kind = normalizeKind(line.kind)
            if (kind === 'add') stats.adds += 1
            else if (kind === 'del') stats.dels += 1
          }
        }
        return stats
      }

      /**
       * 按全局行预算裁剪行数组。
       *
       * 规则：
       *   - 以 **整个 hunk** 为单位保留：一个 hunk 放不下就整块丢弃，绝不把 hunk 从中间切开，
       *     以免并列视图（buildSplitRows）的配对在截断处错位；
       *   - 唯一的例外：第一个 hunk 本身就超过预算时（例如 10k 行的纯新增文件只有一个 hunk），
       *     为了不出现「一片空白 + 已截断」的页面，退化为在**行边界**上截取前 budget 行。
       *     行是原子的（split 的每一行已经是一对），因此在行边界截断不会撕裂配对；
       *   - 返回被丢弃的行数，供 DiffView 显示 `.dgp-diff-truncated` 提示。
       *
       * @param {Array<object>|null|undefined} rows 已经构建好的行（unified 或 split）
       * @param {number} [budget] 默认 MAX_DIFF_ROWS
       * @returns {{rows: Array<object>, truncatedCount: number}}
       */
      function budgetRows(rows, budget) {
        const list = Array.isArray(rows) ? rows : []
        const limit = typeof budget === 'number' && Number.isFinite(budget)
          ? Math.max(0, Math.floor(budget))
          : MAX_DIFF_ROWS

        if (list.length <= limit) return { rows: list, truncatedCount: 0 }
        if (limit === 0) return { rows: [], truncatedCount: list.length }

        const kept = []
        let cursor = 0
        while (cursor < list.length) {
          const start = cursor
          cursor += 1
          // 一个 hunk = hunk 行 + 后续所有非 hunk 行；裸行（没有 hunk 头）自成一组
          while (cursor < list.length && list[cursor] && list[cursor].type !== 'hunk') cursor += 1
          const size = cursor - start
          if (kept.length + size > limit) break
          for (let at = start; at < cursor; at += 1) kept.push(list[at])
        }

        if (kept.length === 0) {
          // 第一个 hunk 就超预算：只能在行边界上截断（见函数注释的例外条款）
          const head = list.slice(0, limit)
          return { rows: head, truncatedCount: list.length - head.length }
        }
        return { rows: kept, truncatedCount: list.length - kept.length }
      }

      Object.assign(exports, { MAX_DIFF_ROWS, buildUnifiedRows, pairChangedRuns, buildSplitRows, highlightWordDiff, diffStats, budgetRows });

    });
    __define("./components/FileEditor.js", (exports, module) => {
      /**
       * src/components/FileEditor.js —— 「文件」模式右栏：可编辑的文本查看器
       *
       * 设计要点（第一性原理：浏览器里编辑文本 = textarea，其余都是它的外壳）：
       *  1. 文本用原生 `<textarea>`：输入法、撤销、选区、剪贴板、无障碍全部由浏览器负责，
       *     不自己实现编辑器内核，也就没有"半套编辑器"的兼容分支。
       *  2. 行号是**独立的一列**，随 textarea 竖向滚动同步；换行（wrap）开启时行号与折行
       *     对不齐，所以那时直接不画行号 —— 不假装对齐。
       *  3. 非文本（二进制/过大/缺失/目录/出错）没有可编辑语义，仍走占位态，不显示输入框。
       *  4. Tab / Shift+Tab / Enter 只做三件事（缩进、反缩进、沿用上一行缩进），
       *     全部通过 `setRangeText` 落到原生输入上，因此**不会破坏原生撤销栈**。
       *  5. 保存的并发安全在宿主侧（内容哈希）；这里只负责把 `expectedHash` 带上，
       *     冲突就交给用户显式选择「重新加载 / 覆盖保存」。
       */
      const { h, useMemo, useRef } = __m("./platform.js");
      const { basename, dirname } = __m("./util/paths.js");
      const { formatClock } = __m("./util/time.js");
      const { Icon } = __m("./ui/Icon.js");
      const { EmptyState, ErrorState, InlineNote, LoadingState } = __m("./components/States.js");

      /** 行号最多画这么多行：再多就不画（textarea 自身仍然可以编辑整篇）。 */
      const MAX_GUTTER_LINES = 5000
      /** 缩进单位。 */
      const INDENT = '  '

      function isBlank(value) {
        return value === null || value === ''
      }

      /** 逻辑行数（结尾换行不算多一行）。 */
      function countLines(text) {
        if (text === '') return 1
        const breaks = text.split('\n').length
        return text.endsWith('\n') ? breaks - 1 : breaks
      }

      function formatSize(size) {
        if (size <= 0) return ''
        if (size < 1024) return size + ' B'
        if (size < 1024 * 1024) return (size / 1024).toFixed(size < 10 * 1024 ? 1 : 0) + ' KB'
        return (size / (1024 * 1024)).toFixed(1) + ' MB'
      }

      /* ------------------------------ 编辑动作 ------------------------------ */

      /** 选区覆盖到的整行范围 [from, to)。 */
      function lineRange(value, start, end) {
        const from = value.lastIndexOf('\n', start - 1) + 1
        const found = value.indexOf('\n', end)
        return { from, to: found === -1 ? value.length : found }
      }

      /**
       * 缩进 / 反缩进选区覆盖的所有行，并把选区一起平移。
       * 一次性替换整块，避免多次 setRangeText 把撤销栈切碎。
       */
      function indentBlock(node, onChange, outdent) {
        const { selectionStart, selectionEnd, value } = node
        const { from, to } = lineRange(value, selectionStart, selectionEnd)
        const block = value.slice(from, to)
        let firstDelta = 0
        let totalDelta = 0
        const next = block.split('\n').map((row, index) => {
          let delta = INDENT.length
          let text = INDENT + row
          if (outdent) {
            const removed = row.startsWith(INDENT) ? INDENT.length : (row.startsWith(' ') ? 1 : 0)
            delta = -removed
            text = row.slice(removed)
          }
          if (index === 0) firstDelta = delta
          totalDelta += delta
          return text
        }).join('\n')

        if (next === block) return
        node.setRangeText(next, from, to, 'preserve')
        node.setSelectionRange(
          Math.max(from, selectionStart + firstDelta),
          Math.max(from, selectionEnd + totalDelta)
        )
        onChange(node.value)
      }

      /** 回车：沿用当前行的前导空白。 */
      function insertNewline(node, onChange) {
        const { selectionStart, selectionEnd, value } = node
        const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
        const leading = /^[ \t]*/.exec(value.slice(lineStart, selectionStart))[0]
        node.setRangeText('\n' + leading, selectionStart, selectionEnd, 'end')
        onChange(node.value)
      }

      /* ------------------------------ 占位态 ------------------------------ */

      /** 不可编辑的读取结果 → 占位态（二进制 / 过大 / 缺失 / 目录 / 出错）。 */
      function placeholderFor(record, kind, sizeText, relPath, onRetry, t) {
        if (kind === 'binary' || kind === 'oversized') {
          return h(EmptyState, {
            icon: 'file',
            title: t(kind === 'binary' ? 'viewer.binary' : 'viewer.oversized'),
            description: isBlank(sizeText) ? undefined : sizeText
          })
        }
        if (kind === 'directory') {
          return h(EmptyState, { icon: 'folder', title: t('viewer.directory') })
        }
        if (kind === 'missing') {
          return h(EmptyState, {
            icon: 'warning',
            title: t('viewer.missing'),
            description: isBlank(relPath) ? undefined : relPath,
            actions: retryAction(t, onRetry)
          })
        }
        const message = record.message !== undefined && record.message !== ''
          ? record.message
          : t('viewer.placeholder')
        if (kind === 'error') return h(ErrorState, { message, onRetry, t })
        return h(EmptyState, {
          icon: 'info',
          title: message,
          description: isBlank(sizeText) ? undefined : sizeText,
          actions: retryAction(t, onRetry)
        })
      }

      function retryAction(t, onRetry) {
        return h('button', {
          type: 'button',
          className: 'dgp-btn',
          'data-variant': 'ghost',
          'data-size': 'sm',
          'data-action': 'retry',
          onClick: onRetry
        }, h(Icon, { name: 'refresh', size: 14 }), t('action.retry'))
      }

      /* ------------------------------ 组件 ------------------------------ */

      function FileEditor(props) {
        const {
          record, loading, error, path: relPath, wrap,
          dirty, busy, conflict, savedAt, saveError,
          onChange, onSave, onReload, onOverwrite, onRetry, t
        } = props

        const inputRef = useRef(null)
        const gutterRef = useRef(null)

        // 编辑器显示的内容：优先用草稿（props.text），没有草稿才退回磁盘内容
        const text = props.text !== null ? props.text : (record === null ? null : record.text ?? null)
        const kind = record === null ? null : record.kind
        const name = basename(relPath)
        const parent = dirname(relPath)
        const sizeText = formatSize(record === null ? 0 : record.size)
        const lineCount = useMemo(() => (text === null ? 0 : countLines(text)), [text])
        const showGutter = wrap !== true && text !== null && lineCount <= MAX_GUTTER_LINES
        const gutterNumbers = useMemo(() => {
          if (showGutter !== true) return null
          const numbers = []
          for (let index = 1; index <= lineCount; index += 1) numbers.push(index)
          return numbers
        }, [showGutter, lineCount])

        const editable = text !== null && loading !== true && error === null

        const subParts = []
        if (text !== null && record !== null && record.language !== undefined && record.language !== 'text') {
          subParts.push(record.language)
        }
        if (text !== null) subParts.push(t('viewer.lines', { count: lineCount }))
        if (!isBlank(sizeText)) subParts.push(sizeText)

        const head = h('div', { className: 'dgp-viewer-head' },
          name === '' ? null : h('span', { className: 'dgp-viewer-title' }, name),
          parent === '' ? null : h('span', { className: 'dgp-sub' }, parent),
          h('span', { className: 'dgp-spacer' }),
          subParts.length === 0 ? null : h('span', { className: 'dgp-viewer-sub' }, subParts.join(' \u00b7 ')),
          dirty === true
            ? h('span', { className: 'dgp-dirty', 'data-dirty': 'true', title: t('editor.unsaved') },
              h('span', { className: 'dgp-dirty-dot', 'aria-hidden': 'true' }), t('editor.unsaved'))
            : (savedAt > 0
              ? h('span', { className: 'dgp-editor-saved' }, t('editor.saved', { time: formatClock(savedAt) }))
              : null),
          h('button', {
            type: 'button',
            className: 'dgp-btn',
            'data-size': 'sm',
            'data-action': 'save',
            disabled: dirty !== true || busy === true,
            title: t('editor.save'),
            onClick: onSave
          }, t('editor.save')))

        const conflictBar = conflict === null
          ? null
          : h('div', { className: 'dgp-errorbar', 'data-conflict': 'true' },
            h(InlineNote, { tone: 'warn' }, t('editor.conflict')),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-action': 'reload',
              onClick: onReload
            }, t('editor.reload')),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-tone': 'danger',
              'data-action': 'overwrite',
              onClick: onOverwrite
            }, t('editor.overwrite')))

        const saveErrorBar = saveError === null
          ? null
          : h('div', { className: 'dgp-errorbar' },
            h(InlineNote, { tone: 'error' }, String(saveError)),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              onClick: onSave
            }, t('action.retry')))

        let body = null
        if (loading) {
          body = h(LoadingState, { label: t('status.loading'), t })
        } else if (error !== null) {
          body = h(ErrorState, { message: error, onRetry, t })
        } else if (record === null) {
          body = h(EmptyState, {
            icon: 'file',
            title: t('viewer.placeholder'),
            description: isBlank(relPath) ? undefined : relPath,
            t
          })
        } else if (kind !== 'text') {
          body = placeholderFor(record, kind, sizeText, relPath, onRetry, t)
        } else {
          body = h('div', { className: 'dgp-editor', 'data-wrap': wrap === true ? 'true' : 'false' },
            showGutter
              ? h('div', { className: 'dgp-editor-gutter', ref: gutterRef, 'aria-hidden': 'true' },
                gutterNumbers.map((number) => h('div', { key: number, className: 'dgp-editor-ln' }, String(number))))
              : null,
            h('textarea', {
              ref: inputRef,
              className: 'dgp-editor-input',
              value: text,
              spellCheck: false,
              autoCapitalize: 'off',
              autoCorrect: 'off',
              wrap: wrap === true ? 'soft' : 'off',
              'data-role': 'editor',
              'aria-label': name === '' ? t('viewer.placeholder') : name,
              onChange: (event) => onChange(event.target.value),
              onScroll: (event) => {
                if (gutterRef.current !== null) gutterRef.current.scrollTop = event.target.scrollTop
              },
              onKeyDown: (event) => {
                const node = event.currentTarget
                if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === 's' || event.key === 'S')) {
                  event.preventDefault()
                  if (dirty === true && busy !== true) onSave()
                  return
                }
                if (event.key === 'Tab') {
                  event.preventDefault()
                  indentBlock(node, onChange, event.shiftKey === true)
                  return
                }
                if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
                  event.preventDefault()
                  insertNewline(node, onChange)
                }
              }
            }))
        }

        return h('div', {
          className: 'dgp-viewer dgp-viewer-editor',
          'data-editable': editable ? 'true' : 'false'
        }, head, conflictBar, saveErrorBar, body)
      }


      Object.assign(exports, { FileEditor });

    });
    __define("./util/time.js", (exports, module) => {
      /**
       * src/util/time.js —— 时间戳格式化（UI 共用）
       *
       * 面板里显示"什么时候"的地方有两处（编辑器保存时间、更新检测时间），
       * 只保留一份实现：`HH:MM:SS` 的 24 小时制，不依赖 locale（避免出现
       * "下午 9:41:07" 这类在窄条里塞不下的形式）。
       */

      /** @param {number} timestamp 毫秒时间戳 @returns {string} HH:MM:SS */
      function formatClock(timestamp) {
        const date = new Date(timestamp)
        return [date.getHours(), date.getMinutes(), date.getSeconds()]
          .map((value) => String(value).padStart(2, '0'))
          .join(':')
      }

      /**
       * 显示日期 + 时间。
       *
       * 远端数据（PR 更新时间、review 提交时间、issue 创建时间）必须能看出是哪一天，
       * 只显示 HH:MM:SS 会让人误以为是今天。规则：
       *  - 今天：HH:MM
       *  - 今年：MM-DD HH:MM
       *  - 更早：YYYY-MM-DD HH:MM
       *
       * @param {number} timestamp 毫秒时间戳
       * @param {number} now 参考时间（测试用）
       */
      function formatDateTime(timestamp, now = Date.now()) {
        if (!Number.isFinite(timestamp)) return '—'
        const date = new Date(timestamp)
        if (!Number.isFinite(date.getTime())) return '—'
        const clock = [date.getHours(), date.getMinutes()]
          .map((value) => String(value).padStart(2, '0'))
          .join(':')
        const reference = new Date(now)
        const sameDay = date.getFullYear() === reference.getFullYear()
          && date.getMonth() === reference.getMonth()
          && date.getDate() === reference.getDate()
        if (sameDay) return clock
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        if (date.getFullYear() === reference.getFullYear()) return month + '-' + day + ' ' + clock
        return String(date.getFullYear()) + '-' + month + '-' + day + ' ' + clock
      }

      Object.assign(exports, { formatClock, formatDateTime });

    });
    __define("./components/CommitBox.js", (exports, module) => {
      /**
       * src/components/CommitBox.js —— 变更列表顶部的提交框
       *
       * 布局只有三块，纵向紧凑：
       *
       *   [ 提交说明（多行）                ✦ / ↻ ✓ ]
       *   [ 状态一行（提示 / 进度 / 结果）              ]
       *
       * 设计要点：
       *  - **状态只有一行**，按「结果 > 生成中 > 提交中 > 无法提交的原因」取一个显示，
       *    所以成功/失败/进度都不会把下面的变更列表顶下去，也不会并排堆三条提示。
       *  - **生成与提交都在输入框右上角**：没有说明时只有「生成」；有说明后变成「重新生成 + 提交」两个图标，
       *    用户点完生成不用移动鼠标就能接着提交。说明为空时不渲染提交按钮（没有可提交的内容）。
       *  - 提交图标不可用时，状态行会说清**为什么**（没改动 / 提交中 / 生成中），不做无声禁用。
       *  - 生成期间输入框禁用：模型结果会直接写进输入框，边等边打字再被覆盖是最糟的体验。
       *  - 输入框随内容长高：高度由实测 scrollHeight 决定（与「创建 PR」描述框共用
       *    `../ui/useAutoGrow.js`），长到上限就停止长高、改为内部滚动。
       */
      const { h, useRef } = __m("./platform.js");
      const { Icon } = __m("./ui/Icon.js");
      const { useAutoGrow } = __m("./ui/useAutoGrow.js");

      /** 输入框的最小高度（两行）与最大高度（约七行）：到上限就不再长高，改成内部滚动。 */
      const COMMIT_INPUT_MIN_HEIGHT = 52
      const COMMIT_INPUT_MAX_HEIGHT = 160

      /**
       * 这些错误码是「模型本身有问题」：余额、密钥、限流、模型不存在、输出被截断。
       * 共同点是**换个模型就能继续**，所以提示旁边给一个直达设置页的按钮，而不是让用户自己找齿轮。
       */
      const MODEL_NOTE_CODES = new Set(['model-failed', 'model-truncated', 'unknown-model', 'no-commit-model'])

      function CommitBox(props) {
        const {
          message,
          stagedCount,
          changeCount,
          busy,
          generating,
          elapsedMs,
          note,
          onChange,
          onCommit,
          onGenerate,
          onOpenSettings,
          onCreatePull,
          t
        } = props

        const inputRef = useRef(null)
        useAutoGrow(inputRef, message, { min: COMMIT_INPUT_MIN_HEIGHT, max: COMMIT_INPUT_MAX_HEIGHT })

        const hasMessage = message.trim() !== ''
        const hasChanges = changeCount > 0
        // 有改动 + 有说明就能提交：没有暂存时，提交会先把全部改动暂存（smart commit）
        const canCommit = hasMessage && hasChanges && busy !== true && generating !== true
        // 说明为空时不渲染提交按钮：用户还没东西可提交，不要给一个永远点不动的图标。
        const showCommit = hasMessage

        // 错误提示要能读：换行显示（最多 5 行），并在「换模型就能解决」时给一个直达设置页的按钮
        const noteIsError = note !== null && note.tone === 'error'
        const noteOffersSettings = noteIsError && MODEL_NOTE_CODES.has(note.code)

        // 状态行只显示一件事：结果 > 生成中 > 提交中 > 不能提交的原因
        let statusKind = null
        let statusText = null
        if (note !== null) {
          statusKind = 'note'
          statusText = note.text
        } else if (generating) {
          statusKind = 'progress'
          statusText = t('commit.generatingElapsed', { seconds: (elapsedMs / 1000).toFixed(1) })
        } else if (busy) {
          statusKind = 'busy'
          statusText = t('commit.submitting')
        } else if (!hasChanges) {
          statusKind = 'hint'
          statusText = t('commit.hintNoChanges')
        } else if (!hasMessage) {
          statusKind = 'hint'
          statusText = t('commit.hintNoMessage')
        } else if (stagedCount === 0) {
          statusKind = 'hint'
          statusText = t('commit.hintStageAll')
        }

        return h('div', { className: 'dgp-commit' },
          h('div', { className: 'dgp-commit-input-wrap', 'data-actions': showCommit ? 'two' : 'one' },
            h('textarea', {
              ref: inputRef,
              className: 'dgp-commit-input',
              'data-dgp-commit': 'input',
              rows: 2,
              placeholder: t('commit.placeholder'),
              value: message,
              disabled: busy === true || generating === true,
              onChange: (event) => {
                onChange(event.target.value)
              },
              onKeyDown: (event) => {
                if ((event.ctrlKey === true || event.metaKey === true) && event.key === 'Enter' && canCommit) {
                  event.preventDefault()
                  onCommit()
                }
              }
            }),
            h('div', { className: 'dgp-commit-tools', 'data-dgp-commit': 'tools' },
              h('button', {
                type: 'button',
                className: 'dgp-commit-generate',
                'data-dgp-commit': 'generate',
                'data-mode': hasMessage ? 'regenerate' : 'generate',
                'data-busy': generating ? 'true' : undefined,
                disabled: generating || busy,
                title: t(generating ? 'commit.generating' : hasMessage ? 'commit.regenerate' : 'commit.generate'),
                'aria-label': t(hasMessage ? 'commit.regenerate' : 'commit.generate'),
                onClick: () => {
                  onGenerate()
                }
              },
              // 生成中把图标换成转圈：一眼就能看出还在跑
              generating ? h('span', { className: 'dgp-spinner' }) : h(Icon, { name: hasMessage ? 'refresh' : 'sparkle', size: 14 })),
              // 两个图标都在输入框右上角：生成完成后提交就在这里，不需要把鼠标移到底部
              showCommit
                ? h('button', {
                  type: 'button',
                  className: 'dgp-commit-run',
                  'data-dgp-commit': 'submit',
                  disabled: canCommit !== true,
                  title: canCommit
                    ? t('commit.submit')
                    : (busy ? t('commit.submitting') : (generating ? t('commit.generating') : t('commit.hintNoChanges'))),
                  'aria-label': t('commit.submit'),
                  onClick: () => {
                    onCommit()
                  }
                }, h(Icon, { name: 'check', size: 14 }))
                : null)),

          h('div', { className: 'dgp-commit-actions' },
            statusKind === null
              ? null
              : h('div', {
                className: 'dgp-commit-status',
                'data-dgp-commit': 'status',
                'data-kind': statusKind,
                'data-tone': note === null ? undefined : (note.tone === 'error' ? 'error' : 'info'),
                // 错误提示换行显示（其余状态仍然单行省略，避免列表被顶下去）
                'data-wrap': noteIsError ? 'true' : undefined,
                title: statusText
              },
              statusKind === 'progress' ? h('span', { className: 'dgp-spinner' }) : null,
              h('span', { className: 'dgp-commit-status-text' + (noteIsError ? '' : ' dgp-oneline') }, statusText),
              noteOffersSettings
                ? h('button', {
                  type: 'button',
                  className: 'dgp-btn dgp-commit-settings',
                  'data-size': 'sm',
                  'data-variant': 'ghost',
                  'data-dgp-commit': 'open-settings',
                  onClick: () => onOpenSettings()
                }, t('commit.openSettings'))
                : null),
            onCreatePull === undefined
              ? null
              : h('button', {
                type: 'button',
                className: 'dgp-btn dgp-commit-pr',
                'data-variant': 'ghost',
                'data-size': 'sm',
                'data-dgp-commit': 'create-pr',
                disabled: busy,
                onClick: () => onCreatePull()
              }, t('pr.open'))))
      }

      Object.assign(exports, { COMMIT_INPUT_MIN_HEIGHT, COMMIT_INPUT_MAX_HEIGHT, CommitBox });

    });
    __define("./ui/useAutoGrow.js", (exports, module) => {
      /**
       * src/ui/useAutoGrow.js —— 多行输入框随内容长高
       *
       * 浏览器不给 textarea 自动高度，唯一可靠的做法是「先归零再读 scrollHeight」。
       * 提交框与「创建 PR」描述框都要这件事，原先一处量 scrollHeight、另一处按
       * 「每 80 字符一行 × 19px」估算 —— 后者在中文、宽字符、字体变化时全是错位。
       * 这里只有一种量法，两处共用。
       */
      const { useEffect } = __m("./platform.js");

      /**
       * 把实测高度夹在 [min, max] 之间并向上取整（避免最后一行被裁掉半像素）。
       * @param {number} scrollHeight 元素实测内容高度
       * @param {number} min 最小高度（px）
       * @param {number} max 最大高度（px），超过后改为输入框内部滚动
       */
      function clampHeight(scrollHeight, min, max) {
        return Math.min(max, Math.max(min, Math.ceil(scrollHeight)))
      }

      /**
       * @param {{current: HTMLTextAreaElement|null}} ref 输入框
       * @param {string} value 内容（变化即重新测量）
       * @param {{min: number, max: number}} bounds
       */
      function useAutoGrow(ref, value, bounds) {
        const { min, max } = bounds
        useEffect(() => {
          const element = ref.current
          if (element === null) return
          element.style.height = 'auto'
          element.style.height = String(clampHeight(element.scrollHeight, min, max)) + 'px'
        }, [ref, value, min, max])
      }

      Object.assign(exports, { clampHeight, useAutoGrow });

    });
    __define("./components/CreatePullForm.js", (exports, module) => {
      /**
       * src/components/CreatePullForm.js —— 变更 Tab 的「创建 PR」表单（渲染在右侧面板）
       *
       * 交互顺序按用户真实操作：
       *   仓库与源分支（只读）→ 目标分支（记住上次）→ 生成标题与描述 → 自己改 → 创建 PR
       *
       * 「分支与远端不同步」的完整解释和动作只有一处：左栏的 PushHint，
       * 打开本表单时它就在同一屏里。表单只回答「创建按钮为什么是灰的」，不重复那块内容。
       * `synced` 取宿主的 `status.sync`（唯一事实源），不再从 pr/prepare 另拿一份快照。
       */
      const { h, useRef } = __m("./platform.js");
      const { Icon } = __m("./ui/Icon.js");
      const { useAutoGrow } = __m("./ui/useAutoGrow.js");

      function CreatePullForm(props) {
        const { form, synced, syncState, t } = props
        const bodyRef = useRef(null)
        useAutoGrow(bodyRef, form.body, { min: 138, max: 594 })

        const repoName = form.repo === null ? '' : form.repo.fullName
        const header = h('div', { className: 'dgp-detail-top' },
          h('div', { className: 'dgp-detail-name-row' },
            h('span', { className: 'dgp-detail-name dgp-oneline' },
              repoName === '' ? t('pr.title') : t('pr.title') + ' · ' + repoName)),
          h('button', {
            type: 'button',
            className: 'dgp-btn',
            'data-size': 'sm',
            'data-dgp-pr': 'cancel',
            onClick: () => props.onCancel()
          }, t('pr.cancel')))

        if (form.loading) {
          return h('div', { className: 'dgp-detail dgp-pr-form', 'data-dgp-pr': 'form' },
            header,
            h('p', { className: 'dgp-detail-meta' }, t('pr.loading')))
        }
        if (form.error !== null) {
          return h('div', { className: 'dgp-detail dgp-pr-form', 'data-dgp-pr': 'form' },
            header,
            h('p', { className: 'dgp-detail-failure', 'data-dgp-pr': 'error' }, form.error))
        }

        /* 创建成功后：只显示结果与打开入口 */
        if (form.created !== null) {
          return h('div', { className: 'dgp-detail dgp-pr-form', 'data-dgp-pr': 'form' },
            header,
            h('div', { className: 'dgp-detail-section' },
              h('p', { className: 'dgp-detail-title' }, t('pr.createdTitle', { number: form.created.number })),
              h('p', { className: 'dgp-detail-meta' }, form.head + ' → ' + form.base),
              h('div', { className: 'dgp-pull-actions' },
                h('button', {
                  type: 'button',
                  className: 'dgp-btn',
                  'data-size': 'sm',
                  'data-variant': 'primary',
                  'data-dgp-pr': 'open-created',
                  onClick: () => props.onOpenUrl(form.created.url)
                }, t('pr.openCreated'), h(Icon, { name: 'external', size: 12 })),
                h('button', {
                  type: 'button',
                  className: 'dgp-btn',
                  'data-size': 'sm',
                  'data-dgp-pr': 'done',
                  onClick: () => props.onCancel()
                }, t('pr.done')))))
        }

        const baseOptions = form.bases
        const accountOptions = form.accounts
        /**
         * 目标分支是「生成」和「创建」共同的前置条件，两处用同一把锁。
         *
         * 只判断 `=== ''` 是不够的：`pr/prepare` 没给出候选目标分支时，客户端把
         * `bases[0]`（undefined）当成 base，而 `{ base: undefined }` 序列化后这个字段会**整个消失**，
         * 宿主只会回一句「缺少参数 base」——那次请求连模型都没调，却看起来像功能坏了。
         * 所以这里用「非空字符串」这一个判据，把没有目标分支的表单变成两个按钮都点不了。
         */
        const baseReady = form.base !== ''

        return h('div', { className: 'dgp-detail dgp-pr-form', 'data-dgp-pr': 'form' },
          header,
          h('div', { className: 'dgp-pr-row' },
            h('span', { className: 'dgp-settings-label' }, t('pr.repo')),
            h('span', { className: 'dgp-detail-meta' }, form.repo.fullName + '（' + form.repo.provider + '）')),
          h('div', { className: 'dgp-pr-row' },
            h('span', { className: 'dgp-settings-label' }, t('pr.head')),
            h('span', { className: 'dgp-detail-meta' }, form.head)),
          accountOptions.length > 1
            ? h('div', { className: 'dgp-pr-row' },
              h('span', { className: 'dgp-settings-label' }, t('pr.account')),
              h('select', {
                className: 'dgp-select',
                'data-dgp-pr': 'account',
                value: form.accountId,
                onChange: (event) => props.onChangeAccount(event.target.value)
              }, accountOptions.map((account) => h('option', { key: account.id, value: account.id },
                account.label + '（' + account.id + '）'))))
            : null,
          h('div', { className: 'dgp-pr-row' },
            h('span', { className: 'dgp-settings-label' }, t('pr.base')),
            h('select', {
              className: 'dgp-select',
              'data-dgp-pr': 'base',
              value: form.base,
              onChange: (event) => props.onChangeBase(event.target.value)
            }, baseOptions.map((branch) => h('option', { key: branch, value: branch }, branch))),
            h('span', { className: 'dgp-settings-hint' }, t('pr.baseHint'))),

          h('div', { className: 'dgp-pr-row' },
            h('span', { className: 'dgp-settings-label' }, t('pr.subject')),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-dgp-pr': 'generate',
              disabled: form.generating || form.creating || baseReady !== true,
              onClick: () => props.onGenerate()
            }, t(form.generating ? 'pr.generating' : 'pr.generate'))),
          h('input', {
            className: 'dgp-input',
            'data-dgp-pr': 'title',
            placeholder: t('pr.titlePlaceholder'),
            value: form.title,
            spellCheck: false,
            onChange: (event) => props.onChangeTitle(event.target.value)
          }),
          h('textarea', {
            ref: bodyRef,
            className: 'dgp-input dgp-pr-body',
            'data-dgp-pr': 'body',
            placeholder: t('pr.bodyPlaceholder'),
            value: form.body,
            spellCheck: false,
            onChange: (event) => props.onChangeBody(event.target.value)
          }),
          h('div', { className: 'dgp-pull-actions' },
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-variant': 'primary',
              'data-dgp-pr': 'create',
              disabled: form.creating || synced !== true || form.title.trim() === '' || baseReady !== true,
              onClick: () => props.onCreate()
            }, t(form.creating ? 'pr.creating' : 'pr.create')),
            synced
              ? null
              : h('span', { className: 'dgp-detail-failure', 'data-dgp-pr': 'blocked' },
                t(syncState === 'remote-deleted' ? 'sync.prBlockedDeleted' : 'sync.prBlockedPush')),
            form.notice === null ? null : h('span', { className: 'dgp-detail-notice', 'data-dgp-pr': 'notice' }, form.notice)))
      }

      Object.assign(exports, { CreatePullForm });

    });
    __define("./components/PushHint.js", (exports, module) => {
      /**
       * src/components/PushHint.js —— 「本地分支与远端不同步」时的提示条
       *
       * 由宿主 `status.sync.state` 驱动，只有两种形态，对应两种完全不同的下一步：
       *   · never-pushed / ahead → 该推送：说明 + 命令 + 「推送到远端」按钮
       *   · remote-deleted       → 远端分支已被删除（PR 合并后删分支是常态）：
       *                            **不能**再普通推送（那会把已合并的分支重新建出来），
       *                            只能「收尾」：取远程更新 → 切回默认分支 → 删除这条本地分支
       *
       * behind / diverged 不在这里处理：那是「该拉取 / 处理分叉」，不是推送问题。
       */
      const { h } = __m("./platform.js");

      function PushHint(props) {
        const { branch, sync, t, onPush, onCleanup, busy, error } = props
        const deleted = sync.state === 'remote-deleted'

        const body = deleted
          ? h('div', { className: 'dgp-push-hint-action' },
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-variant': 'primary',
              'data-dgp-cleanup-run': 'true',
              disabled: busy === true,
              onClick: () => onCleanup()
            }, t(busy === true ? 'sync.cleaning' : 'sync.cleanupRun')))
          : h('div', { className: 'dgp-push-hint-action' },
            h('code', { className: 'dgp-command', 'data-dgp-push-command': 'true' }, t('sync.pushCommand', { branch })),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-variant': 'primary',
              'data-dgp-push-run': 'true',
              disabled: busy === true,
              onClick: () => onPush()
            }, t(busy === true ? 'sync.pushing' : 'sync.pushRun')))

        return h('div', { className: 'dgp-push-hint', 'data-dgp-sync': sync.state },
          h('p', { className: 'dgp-push-hint-title' },
            deleted
              ? t('sync.deletedTitle', { branch })
              : (sync.state === 'ahead' ? t('sync.aheadTitle', { count: sync.ahead }) : t('sync.neverTitle'))),
          h('p', { className: 'dgp-push-hint-why' }, deleted ? t('sync.deletedWhy') : t('sync.pushWhy')),
          body,
          h('p', { className: 'dgp-push-hint-after' }, deleted ? t('sync.deletedAfter') : t('sync.pushAfter')),
          deleted ? h('p', { className: 'dgp-push-hint-after' }, t('sync.deletedNext')) : null,
          error === null
            ? null
            : h('p', { className: 'dgp-push-hint-error', 'data-dgp-sync-error': 'true' }, error))
      }

      Object.assign(exports, { PushHint });

    });
    __define("./components/PullStatusCard.js", (exports, module) => {
      /**
       * src/components/PullStatusCard.js —— 变更页签顶部：当前分支的 PR 状态
       *
       * 只在「有 PR」或「查询失败」时出现：
       *  - 没有关联 PR / 没有账号 / origin 不是平台仓库：**什么都不显示**
       *    （此时「创建 PR」按钮就是唯一的下一步，不需要一张空卡片占地方）
       *  - 查询失败：显示错误 + 重试（这是用户真正需要知道的信息，不能吞）
       *  - 有 PR：状态、未读反馈、最近评论、查看/刷新
       */
      const { h } = __m("./platform.js");
      const { Icon } = __m("./ui/Icon.js");

      function statusOf(pull, gate) {
        if (pull.merged === true) return 'merged'
        if (pull.state === 'closed') return 'closed'
        if (gate?.review?.state === 'changes-requested') return 'changes'
        if (gate?.review?.state === 'approved') return 'approved'
        if (pull.mergeable === true) return 'approved'
        return 'waiting'
      }

      function PullStatusCard(props) {
        const source = props
        const t = source.t
        const card = source.card

        if (card === null) return null

        if (card.error !== null) {
          return h('div', { className: 'dgp-pr-card', 'data-dgp-pr-card': 'error' },
            h('p', { className: 'dgp-detail-failure', 'data-dgp-pr-card': 'error-message' }, card.error),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-dgp-pr-card': 'retry',
              disabled: card.loading === true,
              onClick: () => source.onRefresh()
            }, t('prCard.retry')))
        }

        const data = card.data
        // 还在读，或者根本没有 PR：不占位
        if (data === null || data.linked !== true) return null

        const pull = data.pull
        const status = statusOf(pull, data.gate)
        const latest = Array.isArray(data.comments) && data.comments.length > 0
          ? data.comments[data.comments.length - 1]
          : null
        const unread = Number.isInteger(source.unread) && source.unread > 0 ? source.unread : 0

        return h('div', { className: 'dgp-pr-card', 'data-dgp-pr-card': status },
          h('div', { className: 'dgp-pr-card-head' },
            h('span', { className: 'dgp-pr-card-title' }, '#' + String(data.number) + ' ' + pull.title),
            h('span', { className: 'dgp-pr-card-status', 'data-status': status }, t('prCard.status.' + status))),
          h('div', { className: 'dgp-pr-card-meta' },
            h('span', { className: 'dgp-oneline' }, data.fullName),
            h('span', null, pull.baseBranch + ' ← ' + pull.headBranch),
            unread > 0
              ? h('span', { className: 'dgp-pr-card-unread', 'data-dgp-pr-card': 'unread' }, t('prCard.unread', { count: unread }))
              : null),
          latest === null
            ? null
            : h('p', { className: 'dgp-pr-card-latest dgp-oneline', title: latest.body },
              t('prCard.latest', { author: latest.author }) + ' ' + latest.body.split('\n')[0]),
          h('div', { className: 'dgp-pr-card-actions' },
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-variant': 'ghost',
              'data-dgp-pr-card': 'refresh',
              disabled: card.loading === true,
              onClick: () => source.onRefresh()
            }, t('prCard.refresh')),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-variant': 'primary',
              'data-dgp-pr-card': 'open',
              onClick: () => source.onOpen()
            }, t('prCard.open'), h(Icon, { name: 'external', size: 12 }))))
      }

      Object.assign(exports, { PullStatusCard });

    });
    __define("./components/SettingsView.js", (exports, module) => {
      /**
       * src/components/SettingsView.js —— 插件设置页
       *
       * 三段：生成提交说明的模型、变更区显示偏好、代码托管账号。
       * 选项一律来自宿主读到的事实（模型目录、已保存账号），读不到就只展示错误，
       * 不给一个假的默认项。
       */
      const { h, useEffect, useRef, useState } = __m("./platform.js");
      const { openExternalUrl } = __m("./util/openUrl.js");
      const { copyText } = __m("./util/clipboard.js");
      const { Icon } = __m("./ui/Icon.js");
      const { InlineNote } = __m("./components/States.js");

      function SettingsView(props) {
        const { models, accounts, providers, loading, error, saved, accountsBusy, accountsError, accountsNotice, commitModel: commitModelRef, reviewModel, commitThinking, commitReasoningEffort, changesView, untrackedMode, postCommitPush, t } = props
        /** 回调集中在 props 上，渲染代码只关心「点了会发生什么」。 */
        const source = props
        const translate = t

        const commitModel = models.find((model) => model.ref === commitModelRef)
        const reasoning = commitModel === undefined || commitModel.reasoning === undefined ? null : commitModel.reasoning
        const efforts = reasoning === null || reasoning.efforts === undefined ? [] : reasoning.efforts.filter((effort) => effort.id !== 'off')
        const thinkingSupported = reasoning !== null && reasoning.supported === true && efforts.length > 0
        const thinkingHint = commitModel === undefined ? 'settings.thinkingSelectModel'
          : !thinkingSupported ? 'settings.thinkingUnsupported'
            : reasoning.toggleable !== true ? 'settings.thinkingRequired' : 'settings.commitThinkingHint'

        // 初始 provider 为空：平台列表是异步读到的，等它到了再选第一个（不在列表里也重新选）。
        const [provider, setProvider] = useState('')
        const [label, setLabel] = useState('')
        const [token, setToken] = useState('')
        // 点过「获取令牌」之后给什么提示：'opened' 或拦截时的地址
        const [tokenHint, setTokenHint] = useState(null)
        /** 添加账号失败的原因：显示在表单下方（不只看页面顶部的账号区错误）。 */
        const [addError, setAddError] = useState(null)
        const [addBusy, setAddBusy] = useState(false)
        // 正在编辑的账号：{ id, label, token, tokenText, revealed, busy, error, notice }
        const [editing, setEditing] = useState(null)
        /** 编辑区的世代号：关闭 / 换账号后，旧的令牌读取结果不能再把编辑区「复活」。 */
        const editAttemptRef = useRef(0)

        useEffect(() => {
          setProvider((previous) => (providers.some((item) => item.id === previous) ? previous : (providers[0]?.id ?? '')))
        }, [providers])

        // 被删掉的账号不能继续留在编辑区（否则再点保存会报「账号不存在」）。
        useEffect(() => {
          if (editing === null) return
          if (accounts.some((account) => account.id === editing.id)) return
          setEditing(null)
        }, [accounts, editing])

        const selected = providers.find((item) => item.id === provider) ?? null
        // 每个平台的三步都不同（菜单路径、scope 名都不一样），文案按平台 id 取
        const steps = provider === 'gitee'
          ? ['accounts.guideGitee1', 'accounts.guideGitee2', 'accounts.guideGitee3'].map((key) => translate(key))
          : ['accounts.guideGithub1', 'accounts.guideGithub2', 'accounts.guideGithub3'].map((key) => translate(key))

        const submitAccount = async () => {
          if (token.trim() === '' || provider === '' || addBusy || accountsBusy) return
          setAddError(null)
          setAddBusy(true)
          try {
            const result = await source.onAddAccount({ provider, label: label.trim(), token: token.trim() })
            if (result.ok) {
              setToken('')
              setLabel('')
              return
            }
            setAddError(result.error)
          } finally {
            setAddBusy(false)
          }
        }

        /* ------------------------------ 账号编辑区 ------------------------------ */

        const patchEditing = (patch) => {
          setEditing((previous) => (previous === null ? null : { ...previous, ...patch }))
        }

        const openEditing = (account) => {
          editAttemptRef.current += 1
          setEditing({
            id: account.id,
            label: account.label,
            token: '',
            tokenText: null,
            revealed: false,
            busy: false,
            error: null,
            notice: null
          })
        }

        const closeEditing = () => {
          editAttemptRef.current += 1
          setEditing(null)
        }

        const readToken = async () => {
          if (editing === null || editing.busy) return
          const attempt = editAttemptRef.current
          patchEditing({ busy: true, error: null })
          const result = await source.onReadToken(editing.id)
          if (editAttemptRef.current !== attempt) return
          if (result.ok === true) {
            patchEditing({ busy: false, revealed: true, tokenText: result.token })
            return
          }
          patchEditing({ busy: false, error: result.error })
        }

        const copyToken = async () => {
          if (editing === null || editing.tokenText === null) return
          const attempt = editAttemptRef.current
          const copied = await copyText(editing.tokenText)
          if (editAttemptRef.current !== attempt) return
          patchEditing({
            notice: copied.ok ? translate('accounts.copied') : translate('accounts.copyFailed'),
            error: null
          })
        }

        const saveEditing = async () => {
          if (editing === null || editing.busy) return
          const attempt = editAttemptRef.current
          const submitted = { id: editing.id, label: editing.label, token: editing.token }
          patchEditing({ busy: true, error: null, notice: null })
          const result = await source.onUpdateAccount(submitted)
          if (editAttemptRef.current !== attempt) return
          if (result.ok === true) {
            patchEditing({ busy: false, token: '', notice: translate('accounts.updated') })
            return
          }
          patchEditing({ busy: false, error: result.error })
        }

        return h('div', { className: 'dgp-settings', 'data-dgp-view': 'settings' },
          h('div', { className: 'dgp-settings-head' },
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-dgp-settings': 'back',
              onClick: () => {
                source.onBack()
              }
            }, translate('settings.back')),
            h('h2', { className: 'dgp-settings-title' }, translate('settings.title'))),
          loading
            ? h(InlineNote, { tone: 'info' }, translate('settings.loading'))
            : null,
          error !== null
            ? h(InlineNote, { tone: 'error' }, error)
            : null,
          loading || error !== null
            ? null
            : h('div', { className: 'dgp-settings-field' },
              h('label', { className: 'dgp-settings-label' }, translate('settings.modelLabel')),
              h('select', {
                className: 'dgp-select',
                'data-dgp-settings': 'model',
                value: commitModelRef ?? '',
                onChange: (event) => {
                  source.onChangeModel(event.target.value)
                }
              },
              h('option', { value: '' }, translate('settings.modelNone')),
              models.map((model) => h('option', { key: model.ref, value: model.ref },
                model.providerLabel + ' · ' + model.modelLabel))),
              h('p', { className: 'dgp-settings-hint' }, translate('settings.modelHint')),
              h('label', { className: 'dgp-settings-field dgp-settings-label' },
                h('span', null, translate('settings.commitThinkingLabel')),
                h('select', {
                  className: 'dgp-select',
                  'data-dgp-settings': 'commit-thinking',
                  value: commitThinking ? 'on' : 'off',
                  disabled: !thinkingSupported,
                  onChange: (event) => source.onChangeCommitThinking({ commitThinking: event.target.value === 'on' })
                },
                h('option', { value: 'off' }, translate('settings.thinkingOff')),
                h('option', { value: 'on' }, translate('settings.thinkingOn')))),
              h('p', { className: 'dgp-settings-hint' }, translate(thinkingHint)),
              commitThinking && thinkingSupported
                ? h('label', { className: 'dgp-settings-field dgp-settings-label' },
                  h('span', null, translate('settings.commitEffortLabel')),
                  h('select', {
                    className: 'dgp-select',
                    'data-dgp-settings': 'commit-reasoning-effort',
                    value: commitReasoningEffort ?? '',
                    onChange: (event) => source.onChangeCommitThinking({ commitReasoningEffort: event.target.value || null })
                  },
                  h('option', { value: '' }, translate('settings.effortDefault')),
                  efforts.map((effort) => h('option', { key: effort.id, value: effort.id, title: effort.description }, effort.name))))
                : null),
            h('div', { className: 'dgp-settings-field' },
              h('label', { className: 'dgp-settings-label' }, translate('settings.reviewModelLabel')),
              h('select', {
                className: 'dgp-select',
                'data-dgp-settings': 'review-model',
                value: reviewModel ?? '',
                onChange: (event) => {
                  source.onChangeReviewModel(event.target.value)
                }
              },
              h('option', { value: '' }, translate('settings.modelNone')),
              models.map((model) => h('option', { key: model.ref, value: model.ref },
                model.providerLabel + ' · ' + model.modelLabel))),
              h('p', { className: 'dgp-settings-hint' }, translate('settings.reviewModelHint')),
              saved ? h(InlineNote, { tone: 'info' }, translate('settings.saved')) : null),
          h('div', { className: 'dgp-settings-field' },
            h('label', { className: 'dgp-settings-label' }, translate('settings.viewLabel')),
            h('select', {
              className: 'dgp-select',
              'data-dgp-settings': 'changes-view',
              value: changesView === 'tree' ? 'tree' : 'list',
              onChange: (event) => {
                source.onChangeChangesView(event.target.value)
              }
            },
            h('option', { value: 'list' }, translate('settings.viewList')),
            h('option', { value: 'tree' }, translate('settings.viewTree')))),
          h('div', { className: 'dgp-settings-field' },
            h('label', { className: 'dgp-settings-label' }, translate('settings.untrackedLabel')),
            h('select', {
              className: 'dgp-select',
              'data-dgp-settings': 'untracked-mode',
              value: untrackedMode === 'separate' ? 'separate' : 'merge',
              onChange: (event) => {
                source.onChangeUntrackedMode(event.target.value)
              }
            },
            h('option', { value: 'merge' }, translate('settings.untrackedMerge')),
            h('option', { value: 'separate' }, translate('settings.untrackedSeparate')))),
          h('div', { className: 'dgp-settings-field' },
            h('label', { className: 'dgp-settings-label' }, translate('settings.postPushLabel')),
            h('select', {
              className: 'dgp-select',
              'data-dgp-settings': 'post-commit-push',
              value: postCommitPush ? 'on' : 'off',
              onChange: (event) => {
                source.onChangePostCommitPush(event.target.value === 'on')
              }
            },
            h('option', { value: 'on' }, translate('settings.postPushOn')),
            h('option', { value: 'off' }, translate('settings.postPushOff'))),
            h('p', { className: 'dgp-settings-hint' }, translate('settings.postPushHint'))),

          /* ------------------------------ 代码托管账号 ------------------------------ */
          h('div', { className: 'dgp-settings-field' },
            h('label', { className: 'dgp-settings-label' }, translate('accounts.title')),
            h('p', { className: 'dgp-settings-hint' }, translate('accounts.hint')),
            accounts.length === 0
              ? h('p', { className: 'dgp-settings-hint', 'data-dgp-accounts': 'empty' }, translate('accounts.empty'))
              : h('ul', { className: 'dgp-account-list', 'data-dgp-accounts': 'list' },
                accounts.map((account) => h('li', { key: account.id, className: 'dgp-account-item' },
                  h('span', { className: 'dgp-account-name dgp-oneline' }, account.label),
                  h('span', { className: 'dgp-account-meta' }, account.providerLabel + ' · ' + account.login),
                  h('button', {
                    type: 'button',
                    className: 'dgp-row-action',
                    'data-dgp-account-edit': account.id,
                    title: translate('accounts.edit', { name: account.label }),
                    'aria-label': translate('accounts.edit', { name: account.label }),
                    onClick: () => openEditing(account)
                  }, h(Icon, { name: 'file', size: 14 })),
                  h('button', {
                    type: 'button',
                    className: 'dgp-row-action',
                    'data-dgp-account-remove': account.id,
                    title: translate('accounts.remove', { name: account.label }),
                    'aria-label': translate('accounts.remove', { name: account.label }),
                    onClick: () => {
                      source.onRemoveAccount(account.id)
                    }
                  }, h(Icon, { name: 'trash', size: 14 }))))),
            editing === null
              ? null
              : h('div', {
                className: 'dgp-account-inline',
                'data-dgp-accounts': 'editor',
                onKeyDown: (event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    closeEditing()
                    return
                  }
                  if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
                    event.preventDefault()
                    saveEditing()
                  }
                }
              },
                h('div', { className: 'dgp-account-inline-head' },
                  h('span', { className: 'dgp-account-guide-title' },
                    translate('accounts.edit', { name: editing.label })),
                  h('button', {
                    type: 'button',
                    className: 'dgp-btn',
                    'data-size': 'sm',
                    'data-variant': 'ghost',
                    'data-dgp-accounts': 'hide-token',
                    onClick: () => patchEditing({ revealed: false, tokenText: null })
                  }, translate('accounts.hide'))),
                h('div', { className: 'dgp-account-form' },
                  h('input', {
                    className: 'dgp-input',
                    'data-dgp-accounts': 'edit-label',
                    placeholder: translate('accounts.editLabel'),
                    value: editing.label,
                    disabled: editing.busy,
                    onChange: (event) => patchEditing({ label: event.target.value })
                  }),
                  h('input', {
                    className: 'dgp-input',
                    'data-dgp-accounts': 'edit-token',
                    placeholder: translate('accounts.tokenReplaceHint'),
                    value: editing.token,
                    disabled: editing.busy,
                    onChange: (event) => patchEditing({ token: event.target.value })
                  }),
                  h('button', {
                    type: 'button',
                    className: 'dgp-btn',
                    'data-size': 'sm',
                    'data-dgp-accounts': 'reveal-token',
                    disabled: editing.busy,
                    onClick: () => {
                      if (editing.revealed) {
                        patchEditing({ revealed: false, tokenText: null })
                        return
                      }
                      readToken()
                    }
                  }, translate(editing.revealed ? 'accounts.hide' : 'accounts.reveal')),
                  h('button', {
                    type: 'button',
                    className: 'dgp-btn',
                    'data-size': 'sm',
                    'data-dgp-accounts': 'copy-token',
                    disabled: editing.tokenText === null,
                    onClick: () => copyToken()
                  }, translate('accounts.copy')),
                  h('button', {
                    type: 'button',
                    className: 'dgp-btn',
                    'data-size': 'sm',
                    'data-variant': 'primary',
                    'data-dgp-accounts': 'save-account',
                    disabled: editing.busy,
                    onClick: () => saveEditing()
                  }, translate(editing.busy ? 'accounts.saving' : 'accounts.saveLabel')),
                  h('button', {
                    type: 'button',
                    className: 'dgp-btn',
                    'data-size': 'sm',
                    onClick: closeEditing
                  }, translate('remote.cloneCancel'))),
                editing.revealed && editing.tokenText !== null
                  ? h('code', {
                    className: 'dgp-account-token dgp-oneline',
                    'data-dgp-accounts': 'token-value',
                    title: editing.tokenText
                  }, editing.tokenText)
                  : null,
                editing.notice !== null
                  ? h('div', { className: 'dgp-remote-status', 'data-dgp-accounts': 'editor-notice' },
                    h('span', null, editing.notice))
                  : null,
                editing.error !== null
                  ? h('div', { className: 'dgp-remote-status', 'data-tone': 'error' }, h('span', null, editing.error))
                  : null),

            accountsError !== null
              ? h(InlineNote, { tone: 'error' }, accountsError)
              : null,
            accountsNotice === null
              ? null
              : h(InlineNote, { tone: 'info' }, accountsNotice),
            /* 引导：按当前平台给三步 + 一键打开令牌页（平台列表还没读到时整块不渲染） */
            selected === null ? null : h('div', { className: 'dgp-account-guide', 'data-dgp-accounts': 'guide' },
              h('div', { className: 'dgp-account-guide-head' },
                h('span', { className: 'dgp-account-guide-title' },
                  translate('accounts.guideTitle') + ' · ' + selected.label),
                selected.tokenUrl === undefined
                  ? null
                  : h('button', {
                    type: 'button',
                    className: 'dgp-btn',
                    'data-size': 'sm',
                    'data-dgp-accounts': 'open-token-page',
                    onClick: () => {
                      const result = openExternalUrl(selected.tokenUrl)
                      setTokenHint(result.opened ? 'opened' : selected.tokenUrl)
                    }
                  }, translate('accounts.getToken'), h(Icon, { name: 'external', size: 12 }))),
              h('ol', { className: 'dgp-account-steps' },
                steps.map((step, index) => h('li', { key: String(index) }, step))),
              h('p', { className: 'dgp-settings-hint' }, translate('accounts.verifyHint'))),

            h('div', { className: 'dgp-account-form' },
              h('select', {
                className: 'dgp-select dgp-account-provider',
                'data-dgp-accounts': 'provider',
                value: provider,
                onChange: (event) => setProvider(event.target.value)
              },
              providers.map((item) => h('option', { key: item.id, value: item.id }, item.label))),
              h('input', {
                className: 'dgp-input',
                'data-dgp-accounts': 'label',
                placeholder: translate('accounts.label'),
                value: label,
                onChange: (event) => setLabel(event.target.value)
              }),
              h('input', {
                className: 'dgp-input',
                'data-dgp-accounts': 'token',
                type: 'password',
                placeholder: translate('accounts.tokenPlaceholder'),
                value: token,
                disabled: addBusy,
                onChange: (event) => setToken(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && !accountsBusy && token.trim() !== '') submitAccount()
                }
              }),
              h('button', {
                type: 'button',
                className: 'dgp-btn',
                'data-size': 'sm',
                'data-variant': 'primary',
                'data-dgp-accounts': 'add',
                disabled: accountsBusy || addBusy || provider === '' || token.trim() === '',
                onClick: submitAccount
              }, translate(addBusy ? 'accounts.adding' : 'accounts.add')),
            addError === null
              ? null
              : h('div', { className: 'dgp-remote-status', 'data-tone': 'error' }, h('span', null, addError))),

            tokenHint === null
              ? null
              : h('p', { className: 'dgp-settings-hint', 'data-dgp-accounts': 'token-hint' },
                tokenHint === 'opened'
                  ? translate('accounts.openedPage')
                  : translate('accounts.blockedPage') + ' ' + tokenHint)))
      }

      Object.assign(exports, { SettingsView });

    });
    __define("./util/openUrl.js", (exports, module) => {
      /**
       * src/util/openUrl.js —— 在新标签打开外部链接
       *
       * DSH 桌面端与 Web 端都是浏览器环境，`window.open` 是唯一可靠的入口。
       * 它有两个可观测的失败：不存在（非浏览器环境）、被拦截（返回 null）。
       * 这里把「打开成功没有」如实告诉调用方，让界面能给出可操作提示，
       * 而不是点了没反应。
       */
      function openExternalUrl(url) {
        if (typeof window === 'undefined' || typeof window.open !== 'function') {
          return { opened: false, reason: 'unsupported' }
        }
        const handle = window.open(url, '_blank', 'noopener,noreferrer')
        if (handle === null || handle === undefined) return { opened: false, reason: 'blocked' }
        return { opened: true, reason: null }
      }

      Object.assign(exports, { openExternalUrl });

    });
    __define("./util/clipboard.js", (exports, module) => {
      /**
       * src/util/clipboard.js —— 复制文本到剪贴板
       *
       * 浏览器只给 `navigator.clipboard`，且在非安全上下文/无权限时会拒绝。
       * 复制失败必须能被界面看见（用户手里那段令牌是唯一副本，不能「点了没反应」）。
       */
      async function copyText(text) {
        const value = typeof text === 'string' ? text : ''
        if (value === '') return { ok: false, reason: 'empty' }
        const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
        if (clipboard === undefined || clipboard === null || typeof clipboard.writeText !== 'function') {
          return { ok: false, reason: 'unsupported' }
        }
        try {
          await clipboard.writeText(value)
          return { ok: true, reason: null }
        } catch {
          return { ok: false, reason: 'denied' }
        }
      }

      Object.assign(exports, { copyText });

    });
    __define("./components/RemotePane.js", (exports, module) => {
      /**
       * src/components/RemotePane.js —— 「远端」页签：账号里的仓库，一键拉到项目里
       *
       * 结构：
       *   div.dgp-remote
       *   ├─ div.dgp-remote-head        账号行（每个账号一个 chip）+ 重新读取
       *   ├─ input.dgp-remote-filter     本地筛选
       *   ├─ div.dgp-remote-list         仓库行（名称 / 私有标记 / 描述 / 语言 / 更新时间 / 拉取按钮）
       *   └─ 空态 / 加载 / 错误（同一处，避免三套布局）
       *
       * 拉取走行内表单：点「拉取」展开目标文件夹名（默认仓库名），确认后交给 Panel 执行；
       * 克隆期间这一行显示已等待秒数，失败原因直接显示在该行下方。
       *
       * 添加账号同样就地完成：没账号时空态里直接给两个平台按钮，有账号时账号行尾是 ＋；
       * 表单里有「打开令牌页面」，提交结果就地显示（设置页那份引导仍然保留）。
       */
      const { h, useRef, useState } = __m("./platform.js");
      const { Icon } = __m("./ui/Icon.js");
      const { formatDateTime } = __m("./util/time.js");
      const { openExternalUrl } = __m("./util/openUrl.js");

      /** 秒数保留一位小数，避免每次 tick 都跳一大截。 */
      function secondsOf(startedAt, now) {
        if (startedAt === 0) return '0.0'
        return ((now - startedAt) / 1000).toFixed(1)
      }

      function RemotePane(props) {
        const { accounts, accountId, repos, loading, error, hasMore, filter, selectedFullName, prCounts, clone, now, providers, t } = props
        /** 回调集中在 props 上：渲染代码里只关心「点了会发生什么」，不重新包装一层。 */
        const source = props
        const translate = t
        const [folderFor, setFolderFor] = useState(null)
        const [folderName, setFolderName] = useState('')
        // 添加账号的行内表单：{ provider, label, token, busy, error }
        const [form, setForm] = useState(null)
        // 点过「获取令牌」后的提示：'opened' 或拦截时的地址
        const [tokenHint, setTokenHint] = useState(null)
        /** 表单的世代号：关闭 / 重新打开后，旧请求的结果不能把表单「复活」。 */
        const formAttemptRef = useRef(0)

        /** 账号 id（provider:login）→ 平台 id。 */
        const providerIdOfAccount = (id) => {
          const account = accounts.find((item) => item.id === id) ?? accounts[0]
          return account.provider
        }
        /** 平台 id → 平台定义（下拉框里的值一定来自 providers）。 */
        const providerOf = (id) => providers.find((item) => item.id === id) ?? providers[0]

        const openForm = (providerId) => {
          if (providers.length === 0) return
          formAttemptRef.current += 1
          setTokenHint(null)
          // null = 从空态「添加账号」进来：默认选第一个平台
          setForm({ provider: providerId === null ? providers[0].id : providerId, label: '', token: '', busy: false, error: null })
        }

        const closeForm = () => {
          formAttemptRef.current += 1
          setForm(null)
        }

        const submitForm = async () => {
          if (form.token.trim() === '' || form.busy) return
          const attempt = formAttemptRef.current
          const submitted = form
          setForm({ ...submitted, busy: true, error: null })
          const result = await source.onAddAccount({
            provider: submitted.provider,
            label: submitted.label.trim(),
            token: submitted.token.trim()
          })
          if (formAttemptRef.current !== attempt) return
          if (result.ok === true) {
            setForm(null)
            return
          }
          setForm((previous) => (previous === null ? null : { ...previous, busy: false, error: result.error }))
        }

        const beginClone = (repo) => {
          setFolderFor(repo.fullName)
          setFolderName(repo.name)
        }

        const cancelClone = () => {
          setFolderFor(null)
          setFolderName('')
        }

        const confirmClone = (repo) => {
          setFolderFor(null)
          source.onClone(repo, folderName.trim())
        }

        const formNode = form === null
          ? null
          : h('div', {
            className: 'dgp-account-inline',
            'data-dgp-remote': 'account-form',
            onKeyDown: (event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                closeForm()
              }
            }
          },
            h('div', { className: 'dgp-account-inline-head' },
              h('span', { className: 'dgp-account-guide-title' },
                translate('remote.addAccountOn', { provider: providerOf(form.provider).label })),
              providerOf(form.provider).tokenUrl === undefined
                ? null
                : h('button', {
                  type: 'button',
                  className: 'dgp-btn',
                  'data-size': 'sm',
                  'data-dgp-remote': 'open-token-page',
                  onClick: () => {
                    const result = openExternalUrl(providerOf(form.provider).tokenUrl)
                    setTokenHint(result.opened ? 'opened' : providerOf(form.provider).tokenUrl)
                  }
                }, translate('accounts.getToken'), h(Icon, { name: 'external', size: 12 }))),
            h('div', { className: 'dgp-account-form' },
              h('select', {
                className: 'dgp-select dgp-account-provider',
                'data-dgp-remote': 'account-provider',
                value: form.provider,
                disabled: form.busy,
                onChange: (event) => setForm({ ...form, provider: event.target.value })
              },
              providers.map((item) => h('option', { key: item.id, value: item.id }, item.label))),
              h('input', {
                className: 'dgp-input',
                'data-dgp-remote': 'account-label',
                placeholder: translate('accounts.label'),
                value: form.label,
                disabled: form.busy,
                onChange: (event) => setForm({ ...form, label: event.target.value })
              }),
              h('input', {
                className: 'dgp-input',
                'data-dgp-remote': 'account-token',
                type: 'password',
                placeholder: translate('accounts.tokenPlaceholder'),
                value: form.token,
                disabled: form.busy,
                onChange: (event) => setForm({ ...form, token: event.target.value }),
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && !form.busy) submitForm()
                }
              }),
              h('button', {
                type: 'button',
                className: 'dgp-btn',
                'data-size': 'sm',
                'data-variant': 'primary',
                'data-dgp-remote': 'account-submit',
                disabled: form.busy || form.token.trim() === '',
                onClick: submitForm
              }, translate(form.busy ? 'accounts.adding' : 'accounts.add')),
              h('button', {
                type: 'button',
                className: 'dgp-btn',
                'data-size': 'sm',
                'data-dgp-remote': 'account-cancel',
                onClick: closeForm
              }, translate('remote.cloneCancel'))),
            tokenHint === null
              ? null
              : h('div', { className: 'dgp-remote-status', 'data-dgp-remote': 'token-hint' },
                h('span', null, tokenHint === 'opened'
                  ? translate('accounts.openedPage')
                  : translate('accounts.blockedPage') + ' ' + tokenHint)),
            form.error === null
              ? null
              : h('div', { className: 'dgp-remote-status', 'data-tone': 'error' },
                h('span', null, translate('accounts.failed', { message: form.error }))))

        let body = null
        if (error !== null) {
          body = h('div', { className: 'dgp-state', 'data-dgp-remote': 'error' },
            h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'warning', size: 24 })),
            h('div', { className: 'dgp-state-title' }, translate('remote.failedTitle')),
            h('div', { className: 'dgp-state-desc' }, error),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              onClick: () => {
                source.onRefresh()
              }
            }, translate('remote.refresh')))
        } else if (accounts.length === 0) {
          body = h('div', { className: 'dgp-state', 'data-dgp-remote': 'no-accounts' },
            h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'external', size: 24 })),
            h('div', { className: 'dgp-state-title' }, translate('remote.noAccounts')),
            h('div', { className: 'dgp-state-desc' }, translate('remote.noAccountsHint')),
            h('div', { className: 'dgp-state-actions' },
              h('button', {
                type: 'button',
                className: 'dgp-btn',
                'data-variant': 'primary',
                'data-dgp-remote': 'add-account',
                onClick: () => openForm(null)
              }, translate('remote.addAccount')),
              h('button', {
                  type: 'button',
                  className: 'dgp-btn',
                  'data-variant': 'ghost',
                  'data-dgp-remote': 'open-settings',
                  onClick: () => source.onOpenSettings()
                }, translate('accounts.guideTitle'))))
        } else if (loading && repos.length === 0) {
          body = h('div', { className: 'dgp-state', 'data-dgp-remote': 'loading' },
            h('div', { className: 'dgp-state-icon' }, h('span', { className: 'dgp-spinner' })),
            h('div', { className: 'dgp-state-title' }, translate('remote.loading')))
        } else if (repos.length === 0) {
          body = h('div', { className: 'dgp-state', 'data-dgp-remote': 'empty' },
            h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'folder-open', size: 24 })),
            h('div', { className: 'dgp-state-title' }, translate('remote.empty')))
        } else {
          body = h('div', { className: 'dgp-list', 'data-dgp-remote': 'list', role: 'list' },
            repos.map((repo) => {
              const cloning = clone !== null && clone.fullName === repo.fullName && clone.error === null
              return h('div', {
                key: repo.fullName,
                className: 'dgp-remote-item',
                role: 'listitem',
                'data-dgp-remote-item': repo.fullName,
                'data-active': repo.fullName === selectedFullName ? 'true' : undefined,
                onClick: () => {
                  source.onSelectRepo(repo)
                }
              },
                h('div', { className: 'dgp-remote-row' },
                  h('span', { className: 'dgp-remote-name dgp-oneline', title: repo.fullName }, repo.name),
                  prCounts[repo.fullName] > 0
                    ? h('span', {
                      className: 'dgp-remote-prcount',
                      'data-dgp-pr-count': repo.fullName,
                      title: translate('remote.openPulls', { count: prCounts[repo.fullName] })
                    }, String(prCounts[repo.fullName]))
                    : null,
                  repo.private === true
                    ? h('span', { className: 'dgp-remote-badge' }, translate('remote.private'))
                    : null,
                  h('button', {
                    type: 'button',
                    className: 'dgp-btn dgp-remote-action',
                    'data-size': 'sm',
                    'data-dgp-remote-clone': repo.fullName,
                    disabled: cloning || folderFor !== null,
                    title: translate('remote.cloneTitle'),
                    onClick: (event) => {
                      event.stopPropagation()
                      beginClone(repo)
                    }
                  }, translate('remote.clone'))),
                h('div', { className: 'dgp-remote-meta dgp-oneline' },
                  repo.description !== '' ? repo.description + ' · ' : '',
                  repo.language !== '' ? repo.language + ' · ' : '',
                  repo.updatedAt !== '' ? translate('remote.updatedAt', { time: formatDateTime(Date.parse(repo.updatedAt)) }) : ''),
                folderFor === repo.fullName
                  ? h('div', {
                    className: 'dgp-remote-cloneform',
                    onClick: (event) => event.stopPropagation(),
                    onKeyDown: (event) => {
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        cancelClone()
                      }
                    }
                  },
                    h('label', { className: 'dgp-remote-cloneform-label' }, translate('remote.cloneFolder')),
                    h('input', {
                      className: 'dgp-input dgp-remote-cloneform-input',
                      'data-dgp-remote-folder': repo.fullName,
                      value: folderName,
                      onChange: (event) => setFolderName(event.target.value),
                      onKeyDown: (event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          confirmClone(repo)
                        }
                      }
                    }),
                    h('button', {
                      type: 'button',
                      className: 'dgp-btn',
                      'data-size': 'sm',
                      'data-variant': 'primary',
                      'data-dgp-remote-confirm': repo.fullName,
                      onClick: () => confirmClone(repo)
                    }, translate('remote.cloneConfirm')),
                    h('button', {
                      type: 'button',
                      className: 'dgp-btn',
                      'data-size': 'sm',
                      onClick: cancelClone
                    }, translate('remote.cloneCancel')))
                  : null,
                cloning
                  ? h('div', { className: 'dgp-remote-status', 'data-dgp-remote-cloning': repo.fullName },
                    h('span', { className: 'dgp-spinner' }),
                    h('span', null, translate('remote.cloning', { seconds: secondsOf(clone.startedAt, now) })))
                  : null,
                clone !== null && clone.error !== null && clone.fullName === repo.fullName
                  ? h('div', { className: 'dgp-remote-status', 'data-tone': 'error' },
                    h('span', null, clone.error),
                    h('button', {
                      type: 'button',
                      className: 'dgp-btn',
                      'data-size': 'sm',
                      'data-dgp-remote-retry': repo.fullName,
                      onClick: (event) => {
                        event.stopPropagation()
                        beginClone(repo)
                      }
                    }, translate('action.retry')))
                  : null)
            }),
            hasMore
              ? h('button', {
                type: 'button',
                className: 'dgp-btn dgp-remote-more',
                'data-size': 'sm',
                disabled: loading,
                onClick: () => {
                  source.onLoadMore()
                }
              }, translate('remote.loadMore'))
              : null)
        }

        return h('div', { className: 'dgp-remote', 'data-dgp-view': 'remote' },
          formNode,
          accounts.length === 0
            ? null
            : h('div', { className: 'dgp-remote-head' },
              h('span', { className: 'dgp-remote-head-label' }, translate('remote.account')),
              accounts.map((account) => h('button', {
                key: account.id,
                type: 'button',
                className: 'dgp-remote-chip',
                'data-dgp-account': account.id,
                'data-active': account.id === accountId ? 'true' : undefined,
                title: account.providerLabel + ' · ' + account.login,
                onClick: () => {
                  source.onSelectAccount(account)
                }
              }, account.label)),
              h('button', {
                type: 'button',
                className: 'dgp-iconbtn dgp-remote-refresh',
                title: translate('remote.addAccount'),
                'aria-label': translate('remote.addAccount'),
                'data-dgp-remote': 'add-account',
                onClick: () => openForm(providerIdOfAccount(accountId))
              }, h(Icon, { name: 'plus', size: 16 })),
              h('button', {
                type: 'button',
                className: 'dgp-iconbtn',
                title: translate('remote.refresh'),
                'aria-label': translate('remote.refresh'),
                onClick: () => {
                  source.onRefresh()
                }
              }, h(Icon, { name: 'refresh', size: 16 }))),
          accounts.length === 0
            ? null
            : h('input', {
              className: 'dgp-input dgp-remote-filter',
              'data-dgp-remote-filter': 'true',
              placeholder: translate('remote.filter'),
              value: filter,
              onChange: (event) => {
                source.onFilterChange(event.target.value)
              }
            }),
          body)
      }

      Object.assign(exports, { RemotePane });

    });
    __define("./components/RemoteDetail.js", (exports, module) => {
      /**
       * src/components/RemoteDetail.js —— 远端仓库右侧详情：分支 / Issues / PR
       *
       * 只负责展示：数据由 Panel 拉（remote/detail 与 remote/branches），这里把
       * 「代码概况、分支、数量、最近条目、打开网页」几件事排清楚；拿不到总数的区块
       * 如实写「数量未知」。
       *
       * 分支区（BranchList）是这一版新增的主角：远端仓库的所有分支、本地有没有、
       * 远端有没有、当前/默认/领先落后都在这一个列表里，操作也都在行上完成。
       * 原先单独的「代码」块与顶部 meta 行重复（语言 / 大小 / 默认分支两处都写），
       * 已合并进 meta，把纵向空间让给分支列表。
       */
      const { h } = __m("./platform.js");
      const { Icon } = __m("./ui/Icon.js");
      const { formatDateTime } = __m("./util/time.js");
      const { BranchList } = __m("./components/BranchList.js");

      function Section(props) {
        const { title, total, items, emptyLabel, openLabel, onOpen, t, kind } = props
        const countText = total === null ? t('detail.countUnknown') : t('detail.countOf', { count: total })
        return h('section', { className: 'dgp-detail-section', 'data-dgp-section': kind },
          h('div', { className: 'dgp-detail-head' },
            h('span', { className: 'dgp-detail-title' }, title),
            h('span', { className: 'dgp-detail-count', 'data-dgp-count': kind }, countText),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-variant': 'ghost',
              'data-dgp-open': kind,
              onClick: () => onOpen()
            }, openLabel, h(Icon, { name: 'external', size: 12 }))),
          items.length === 0
            ? h('p', { className: 'dgp-detail-empty' }, emptyLabel)
            : h('ul', { className: 'dgp-detail-list' },
              items.map((item, index) => h('li', { key: String(item.number ?? index), className: 'dgp-detail-item' },
                h('button', {
                  type: 'button',
                  className: 'dgp-detail-link',
                  title: item.title,
                  'data-dgp-item': kind,
                  onClick: () => {
                    if (kind === 'pulls' && item.number !== null) {
                      props.onOpenPull(item.number)
                      return
                    }
                    onOpen(item.url)
                  }
                }, (item.number === null ? '' : '#' + item.number + ' ') + item.title),
                h('span', { className: 'dgp-detail-meta' },
                  item.author === '' ? null : h('span', { className: 'dgp-detail-author' }, item.author),
                  // 明确区分：创建 = 提交 PR 的时间，更新 = 最后一次有动静
                  item.createdAt !== ''
                    ? h('span', null, t('detail.created', { time: formatDateTime(Date.parse(item.createdAt)) }))
                    : null,
                  // 只有确实给了更新时间、且与创建时间不同才显示；缺失就不显示（不要占位符）
                  item.updatedAt !== '' && item.updatedAt !== item.createdAt
                    ? h('span', null, t('detail.updated', { time: formatDateTime(Date.parse(item.updatedAt)) }))
                    : null)))))
      }

      function RemoteDetail(props) {
        const { selection, detail, branchState, t } = props

        if (selection === null) {
          return h('div', { className: 'dgp-viewer' },
            h('div', { className: 'dgp-state', 'data-dgp-detail': 'empty' },
              h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'file-diff', size: 24 })),
              h('div', { className: 'dgp-state-title' }, t('detail.pickRepo')),
              h('div', { className: 'dgp-state-desc' }, t('detail.pickRepoHint'))))
        }

        if (detail === null || detail.loading) {
          return h('div', { className: 'dgp-viewer' },
            h('div', { className: 'dgp-state', 'data-dgp-detail': 'loading' },
              h('div', { className: 'dgp-state-icon' }, h('span', { className: 'dgp-spinner' })),
              h('div', { className: 'dgp-state-title' }, t('detail.loading', { name: selection.fullName }))))
        }

        if (detail.error !== null) {
          return h('div', { className: 'dgp-viewer' },
            h('div', { className: 'dgp-state', 'data-dgp-detail': 'error' },
              h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'warning', size: 24 })),
              h('div', { className: 'dgp-state-title' }, t('detail.failed')),
              h('div', { className: 'dgp-state-desc' }, detail.error),
              h('button', {
                type: 'button',
                className: 'dgp-btn',
                'data-size': 'sm',
                onClick: () => {
                  props.onRetry()
                }
              }, t('action.retry'))))
        }

        const data = detail.data
        // 切仓库时旧数据还在手里：不属于当前选中的一份按加载中处理，绝不画在别的标题下。
        if (data.accountId !== selection.accountId || data.repo.fullName !== selection.fullName) {
          return h('div', { className: 'dgp-viewer' },
            h('div', { className: 'dgp-state', 'data-dgp-detail': 'loading' },
              h('div', { className: 'dgp-state-icon' }, h('span', { className: 'dgp-spinner' })),
              h('div', { className: 'dgp-state-title' }, t('detail.loading', { name: selection.fullName }))))
        }
        const repo = data.repo
        const sizeText = repo.sizeKb > 0 ? t('detail.sizeKb', { size: repo.sizeKb }) : ''
        // 语言 / 大小只在这里说一次；「默认分支」唯一来源是分支区（remote/branches 的 default 标签），不在两处各存一份快照。
        const meta = [repo.language, sizeText]
          .filter((part) => part !== '').join(' · ')

        return h('div', { className: 'dgp-detail', 'data-dgp-detail': 'repo' },
          h('div', { className: 'dgp-detail-top' },
            h('div', { className: 'dgp-detail-name-row' },
              h('span', { className: 'dgp-detail-name dgp-oneline', title: repo.fullName }, repo.fullName),
              repo.private === true ? h('span', { className: 'dgp-remote-badge' }, t('remote.private')) : null),
            h('div', { className: 'dgp-detail-actions' },
              h('button', {
                type: 'button',
                className: 'dgp-btn',
                'data-size': 'sm',
                'data-variant': 'primary',
                'data-dgp-detail-clone': repo.fullName,
                onClick: () => {
                  props.onClone(selection)
                }
              }, t('remote.clone')),
              h('button', {
                type: 'button',
                className: 'dgp-btn',
                'data-size': 'sm',
                'data-dgp-detail-open': 'repo',
                onClick: () => {
                  props.onOpenUrl(repo.htmlUrl)
                }
              }, t('remote.openWeb'), h(Icon, { name: 'external', size: 12 })))),
          repo.description === '' ? null : h('p', { className: 'dgp-detail-desc' }, repo.description),
          h('div', { className: 'dgp-detail-meta' },
            meta === '' ? null : h('span', null, meta),
            h('span', null, t('detail.stars', { count: repo.stars })),
            h('span', null, t('detail.forks', { count: repo.forks })),
            repo.updatedAt === '' ? null : h('span', null, t('remote.updatedAt', { time: formatDateTime(Date.parse(repo.updatedAt)) }))),

          data.failures.map((failure) => h('p', {
            key: failure.section,
            className: 'dgp-detail-failure'
          }, t('detail.sectionFailed', { section: t('detail.' + failure.section), message: failure.message }))),

          h(BranchList, {
            key: selection.accountId + '#' + selection.fullName,
            selection,
            state: branchState,
            onReloadBranches: props.onReloadBranches,
            onFetchBranches: props.onFetchBranches,
            onSwitchBranch: props.onSwitchBranch,
            onTrackBranch: props.onTrackBranch,
            onDeleteLocalBranch: props.onDeleteLocalBranch,
            onDeleteRemoteBranch: props.onDeleteRemoteBranch,
            onOpenUrl: props.onOpenUrl,
            t
          }),

          h(Section, {
            kind: 'issues',
            title: t('detail.issues'),
            total: data.issues.total,
            items: data.issues.items,
            emptyLabel: t('detail.noIssues'),
            openLabel: t('detail.openOnWeb'),
            onOpen: (url) => {
              props.onOpenUrl(url || repo.issuesUrl)
            },
            t
          }),
          h(Section, {
            kind: 'pulls',
            title: t('detail.pulls'),
            total: data.pulls.total,
            items: data.pulls.items,
            emptyLabel: t('detail.noPulls'),
            openLabel: t('detail.openOnWeb'),
            onOpen: (url) => {
              props.onOpenUrl(url || repo.pullsUrl)
            },
            onOpenPull: props.onOpenPull,
            t
          }))
      }

      Object.assign(exports, { RemoteDetail });

    });
    __define("./components/BranchList.js", (exports, module) => {
      /**
       * src/components/BranchList.js —— 「远端」页签仓库详情里的「分支」区
       *
       * 解决的是远端仓库详情只能看代码 / Issues / PR、看不到分支的问题：
       *   · 远端有哪些分支、本地有没有同名分支、哪个是当前分支/默认分支；
       *   · 本地相对上游领先/落后多少、上游是否已被删除、远端是否已有本地还没 fetch 的新提交；
       *   · 快速操作：切换、建本地跟踪分支、复制分支名、打开网页、删除本地分支、删除远端分支。
       *
       * 数据由 Panel 取（remote/branches：远端 API + 本地 git 合成一条），这里只负责
       * 交互与错误呈现。删除是破坏性操作，一律先出二次确认；本地分支有未合并提交时
       * 只把「强制删除」按钮露出来，不默认 force。
       */
      const { h, useEffect, useState } = __m("./platform.js");
      const { Icon } = __m("./ui/Icon.js");
      const { MenuItem, MenuLabel, PopupMenu } = __m("./ui/Menu.js");
      const { copyText } = __m("./util/clipboard.js");

      /** 分支行右侧的两个小标签：本地 / 远端。远端未知（API 失败）时用第三种表达。 */
      function branchTags(row, translate) {
        return h('span', { className: 'dgp-branch-tags' },
          h('span', {
            className: 'dgp-branch-tag',
            'data-active': row.local === true ? 'true' : 'false',
            'data-kind': 'local'
          }, translate('branch.localTag')),
          h('span', {
            className: 'dgp-branch-tag',
            'data-active': row.remote === true ? 'true' : 'false',
            'data-kind': 'remote',
            // true/false/null 三态：null = 远端列表没读到，不能画成「没有」
            'data-unknown': row.remote === null ? 'true' : 'false',
            title: row.remote === null ? translate('branch.remoteUnknown') : undefined
          }, translate('branch.remoteTag')),
          row.default === true
            ? h('span', { className: 'dgp-branch-tag', 'data-active': 'false', 'data-kind': 'default' },
              translate('branch.defaultTag'))
            : null)
      }

      /** 分支的完整情况放进 title：窄面板里行内放不下，但鼠标停一下要能看到全部事实。 */
      function branchTitle(row, translate) {
        const parts = [row.name]
        if (row.current === true) parts.push(translate('branch.currentTag'))
        if (row.default === true) parts.push(translate('branch.defaultTag'))
        if (row.protected === true) parts.push(translate('branch.protectedTag'))
        parts.push(translate(row.local === true ? 'branch.localTag' : 'branch.notLocal'))
        if (row.remote === true) parts.push(translate('branch.remoteTag'))
        else if (row.remote === null) parts.push(translate('branch.remoteUnknown'))
        else parts.push(translate('branch.notOnRemote'))
        if (row.upstreamGone === true || row.upstreamMissing === true) parts.push(translate('branch.upstreamGone'))
        if (row.ahead > 0 || row.behind > 0) {
          parts.push(translate('branch.aheadBehind', { ahead: row.ahead, behind: row.behind }))
        }
        if (row.remoteUpdated === true) parts.push(translate('branch.remoteUpdated'))
        return parts.join(' · ')
      }

      /** 领先/落后：两边都有值时用一条完整文案，只有一边时只画那一边（不写 ↓0 这种噪音）。 */
      function aheadBehindText(row, translate) {
        if (row.ahead > 0 && row.behind > 0) return translate('branch.aheadBehind', { ahead: row.ahead, behind: row.behind })
        if (row.ahead > 0) return '↑' + row.ahead
        return '↓' + row.behind
      }

      /** 这一行点下去会发生什么；没有主操作时点行 = 打开菜单。 */
      function primaryActionOf(row, hasLocalRepo) {
        if (row.current === true) return null
        if (row.local === true) return 'switch'
        if (hasLocalRepo && row.remote === true) return 'track'
        return null
      }

      function BranchList(props) {
        const source = props
        const translate = source.t
        const state = source.state
        const rawData = state === null ? null : state.data
        const selection = source.selection
        /**
         * 数据是「按仓库」的：切到另一个仓库而新数据还没回来时，手里这份是上一个仓库的分支。
         * 这种情况当加载中处理，不能把别人的分支列表画在标题下面。
         */
        const belongs = rawData !== null && (selection === null || rawData.fullName === selection.fullName)
        const data = belongs ? rawData : null
        const loading = (state !== null && state.loading === true) || (rawData !== null && belongs !== true)
        const loadError = state === null ? null : state.error
        const branches = data === null ? [] : data.branches
        const hasLocalRepo = data !== null && data.local !== null
        const localRootPath = hasLocalRepo ? data.local.rootPath : null
        // 分支少时不放筛选框；此时残留的筛选词也必须失效，否则列表看着被过滤却找不到筛选框
        const showFilter = branches.length > 8

        const [filter, setFilter] = useState('')
        // 行尾「⋯」菜单：{ row, rect }
        const [menu, setMenu] = useState(null)
        // 删除确认：{ row, kind: 'local'|'remote', force, error }
        const [confirm, setConfirm] = useState(null)
        // 正在执行操作的物理行名（切换/跟踪/删除共用）
        const [busy, setBusy] = useState(null)
        const [fetching, setFetching] = useState(false)
        // 最近一次操作的结果：{ tone: 'info'|'error', text }
        const [note, setNote] = useState(null)

        const closeMenu = () => setMenu(null)
        const closeConfirm = () => setConfirm(null)

        // 换仓库时把筛选 / 菜单 / 确认 / 提示全部清掉：它们都属于上一个仓库的上下文
        const dataRepo = data === null ? null : data.fullName
        useEffect(() => {
          setFilter('')
          setMenu(null)
          setConfirm(null)
          setNote(null)
          setBusy(null)
          setFetching(false)
        }, [dataRepo])

        const needle = showFilter ? filter.trim().toLowerCase() : ''
        const visible = needle === ''
          ? branches
          : branches.filter((row) => row.name.toLowerCase().includes(needle))

        const openMenu = (row, target) => {
          setNote(null)
          setMenu({ row, rect: target.getBoundingClientRect() })
        }

        const runPrimary = (row, action) => {
          if (busy !== null) return
          setBusy(row.name)
          setNote(null)
          const started = action === 'switch'
            ? source.onSwitchBranch(row)
            : source.onTrackBranch(row)
          Promise.resolve(started)
            .then((result) => {
              setBusy(null)
              if (result.ok === true) {
                setNote({
                  tone: 'info',
                  text: translate(action === 'switch' ? 'branch.switched' : 'branch.tracked', { name: row.name })
                })
                return
              }
              setNote({ tone: 'error', text: translate('branch.failed', { message: result.error }) })
            })
            .catch((error) => {
              setBusy(null)
              setNote({ tone: 'error', text: translate('branch.failed', { message: error && error.message ? error.message : String(error) }) })
            })
        }

        const startDelete = (row, kind) => {
          setMenu(null)
          setNote(null)
          setConfirm({ row, kind, force: false, error: null })
        }

        const runDelete = (force) => {
          if (confirm === null || busy !== null) return
          const { row, kind } = confirm
          setBusy(row.name)
          setNote(null)
          const started = kind === 'local'
            ? source.onDeleteLocalBranch(row, force)
            : source.onDeleteRemoteBranch(row)
          Promise.resolve(started)
            .then((result) => {
              if (result.ok === true) {
                setBusy(null)
                setConfirm(null)
                setNote({
                  tone: 'info',
                  text: translate(kind === 'local' ? 'branch.deletedLocal' : 'branch.deletedRemote', { name: row.name })
                })
                return
              }
              const error = translate('branch.failed', { message: result.error })
              // 未合并的本地分支：把「强制删除」按钮放出来，让用户明确决定，不默认 force
              if (kind === 'local' && result.code === 'branch-unmerged') {
                setBusy(null)
                setConfirm({ row, kind, force: true, error })
                return
              }
              setBusy(null)
              setConfirm({ row, kind, force: false, error })
            })
            .catch((error) => {
              setBusy(null)
              setConfirm({
                row,
                kind,
                force: false,
                error: translate('branch.failed', { message: error && error.message ? error.message : String(error) })
              })
            })
        }

        const runFetch = () => {
          if (fetching === true) return
          setFetching(true)
          setNote(null)
          Promise.resolve(source.onFetchBranches())
            .then((result) => {
              setFetching(false)
              if (result.ok === true) {
                setNote({ tone: 'info', text: translate('branch.fetchingDone') })
                return
              }
              setNote({ tone: 'error', text: translate('branch.failed', { message: result.error }) })
            })
            .catch((error) => {
              setFetching(false)
              setNote({ tone: 'error', text: translate('branch.failed', { message: error && error.message ? error.message : String(error) }) })
            })
        }

        const copyName = (row) => {
          setMenu(null)
          Promise.resolve(copyText(row.name)).then((result) => {
            setNote(result.ok === true
              ? { tone: 'info', text: translate('branch.copied', { name: row.name }) }
              : { tone: 'error', text: translate('branch.failed', { message: String(result.reason) }) })
          })
        }

        const openWeb = (row) => {
          setMenu(null)
          if (data === null || typeof data.htmlUrl !== 'string' || data.htmlUrl === '') return
          source.onOpenUrl(data.htmlUrl + '/tree/' + row.name.split('/').map(encodeURIComponent).join('/'))
        }

        const summary = data !== null && data.localKnown === true
          ? translate('branch.summary', { total: branches.length, local: data.counts.local })
          : null
        const remoteShown = branches.filter((row) => row.remote === true).length

        const failures = data !== null && Array.isArray(data.failures) ? data.failures : []

        const statusNodes = []
        if (loadError !== null) {
          statusNodes.push(h('div', { key: 'error', className: 'dgp-branch-status', 'data-tone': 'error' },
            h('span', { className: 'dgp-oneline' }, translate('branch.loadFailed', { message: loadError })),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-variant': 'ghost',
              'data-dgp-branch-retry': 'true',
              disabled: loading,
              onClick: () => {
                setNote(null)
                source.onReloadBranches()
              }
            }, translate('action.retry'))))
        } else if (loading === true && data === null) {
          statusNodes.push(h('div', { key: 'loading', className: 'dgp-branch-status' },
            h('span', { className: 'dgp-spinner' }),
            h('span', null, translate('branch.loading'))))
        } else if (loading === true) {
          statusNodes.push(h('div', { key: 'refreshing', className: 'dgp-branch-status' },
            h('span', { className: 'dgp-spinner' }),
            h('span', null, translate('branch.refreshing'))))
        }
        for (const failure of failures) {
          statusNodes.push(h('div', { key: 'failure-' + String(failure.section), className: 'dgp-branch-status', 'data-tone': 'warn' },
            h('span', null, translate('detail.sectionFailed', {
              section: translate(failure.section === 'local' ? 'branch.localTag' : 'branch.remoteTag'),
              message: String(failure.message)
            }))))
        }
        if (note !== null) {
          statusNodes.push(h('div', { key: 'note', className: 'dgp-branch-status', 'data-tone': note.tone === 'error' ? 'error' : 'info' },
            h('span', { className: 'dgp-oneline' }, note.text)))
        }

        const hints = []
        if (data !== null && data.localKnown === true && data.local === null) {
          hints.push(h('div', { key: 'not-cloned', className: 'dgp-branch-hint' }, translate('branch.notCloned')))
        } else if (hasLocalRepo === true) {
          const folder = String(localRootPath).split(/[\\/]/).filter(Boolean).pop()
          hints.push(h('div', { key: 'local-repo', className: 'dgp-branch-hint' }, translate('branch.localRepo', { name: folder })))
        }
        if (data !== null && data.truncated === true) {
          hints.push(h('div', { key: 'truncated', className: 'dgp-branch-hint' },
            translate('branch.truncated', { count: remoteShown })))
        }
        if (data !== null && data.remoteKnown === true && remoteShown === 0) {
          hints.push(h('div', { key: 'remote-empty', className: 'dgp-branch-hint' }, translate('branch.emptyRemote')))
        }

        const rows = visible.map((row) => {
          const action = primaryActionOf(row, hasLocalRepo === true)
          const rowBusy = busy === row.name
          const confirmHere = confirm !== null && confirm.row.name === row.name
          return h('li', {
            key: row.name,
            className: 'dgp-branch-item',
            'data-current': row.current === true ? 'true' : undefined,
            'data-busy': rowBusy ? 'true' : undefined
          },
          h('button', {
            type: 'button',
            className: 'dgp-branch-row',
            'data-dgp-branch-row': row.name,
            title: branchTitle(row, translate),
            disabled: rowBusy,
            onClick: (event) => {
              const target = event.currentTarget
              if (action === null) {
                openMenu(row, target)
                return
              }
              runPrimary(row, action)
            }
          },
          h('span', {
            className: 'dgp-branch-ico',
            'data-current': row.current === true ? 'true' : undefined
          }, h(Icon, { name: row.current === true ? 'check' : 'git-branch', size: 14 })),
          h('span', { className: 'dgp-branch-name dgp-oneline' }, row.name),
          row.ahead > 0 || row.behind > 0
            ? h('span', { className: 'dgp-branch-track' }, aheadBehindText(row, translate))
            : null,
          branchTags(row, translate)),
          h('button', {
            type: 'button',
            className: 'dgp-branch-more',
            'data-dgp-branch-more': row.name,
            title: translate('branch.more'),
            'aria-label': translate('branch.more'),
            disabled: rowBusy,
            onClick: (event) => {
              event.stopPropagation()
              openMenu(row, event.currentTarget)
            }
          }, rowBusy ? h('span', { className: 'dgp-spinner' }) : h(Icon, { name: 'more', size: 14 })),
          confirmHere
            ? h('div', { className: 'dgp-branch-confirm', 'data-dgp-branch-confirm': confirm.kind },
              h('div', { className: 'dgp-branch-confirm-text' },
                translate(confirm.kind === 'local' ? 'branch.deleteLocalConfirm' : 'branch.deleteRemoteConfirm', { name: row.name })),
              confirm.error === null
                ? null
                : h('div', { className: 'dgp-branch-status', 'data-tone': 'error' }, h('span', null, confirm.error)),
              h('div', { className: 'dgp-branch-confirm-actions' },
                h('button', {
                  type: 'button',
                  className: 'dgp-btn',
                  'data-size': 'sm',
                  'data-variant': 'ghost',
                  disabled: busy !== null,
                  onClick: closeConfirm
                }, translate('action.cancel')),
                confirm.force === true
                  ? h('button', {
                    type: 'button',
                    className: 'dgp-btn',
                    'data-size': 'sm',
                    'data-variant': 'danger',
                    'data-dgp-branch-delete-force': row.name,
                    disabled: busy !== null,
                    onClick: () => runDelete(true)
                  }, translate('branch.deleteForce'))
                  : null,
                h('button', {
                  type: 'button',
                  className: 'dgp-btn',
                  'data-size': 'sm',
                  'data-variant': 'danger',
                  'data-dgp-branch-delete-run': row.name,
                  disabled: busy !== null,
                  onClick: () => runDelete(false)
                }, translate('branch.deleteRun'))))
            : null)
        })

        const menuRow = menu === null ? null : menu.row
        const menuNode = menuRow === null
          ? null
          : h(PopupMenu, { open: true, anchorRect: menu.rect, onClose: closeMenu, minWidth: 220 },
            h(MenuLabel, null, menuRow.name),
            menuRow.current === true
              ? null
              : (menuRow.local === true
                ? h(MenuItem, {
                  icon: 'git-branch',
                  label: translate('branch.switchTo', { name: menuRow.name }),
                  dataKey: 'branch-switch',
                  disabled: busy !== null,
                  onClick: () => {
                    setMenu(null)
                    runPrimary(menuRow, 'switch')
                  }
                })
                : (hasLocalRepo === true && menuRow.remote === true
                  ? h(MenuItem, {
                    icon: 'plus',
                    label: translate('branch.track'),
                    dataKey: 'branch-track',
                    disabled: busy !== null,
                    onClick: () => {
                      setMenu(null)
                      runPrimary(menuRow, 'track')
                    }
                  })
                  : h(MenuLabel, null, translate('branch.noLocalOps')))),
            h('div', { className: 'dgp-menu-sep', role: 'separator' }),
            h(MenuItem, {
              icon: 'file',
              label: translate('branch.copy'),
              dataKey: 'branch-copy',
              onClick: () => copyName(menuRow)
            }),
            h(MenuItem, {
              icon: 'external',
              label: translate('branch.openWeb'),
              dataKey: 'branch-open',
              disabled: data === null || typeof data.htmlUrl !== 'string' || data.htmlUrl === '',
              onClick: () => openWeb(menuRow)
            }),
            h('div', { className: 'dgp-menu-sep', role: 'separator' }),
            canDeleteMenuLocal(menuRow)
              ? h(MenuItem, {
                icon: 'trash',
                label: translate('branch.deleteLocal'),
                dataKey: 'branch-delete-local',
                danger: true,
                disabled: busy !== null,
                onClick: () => startDelete(menuRow, 'local')
              })
              : h(MenuItem, {
                icon: 'trash',
                label: translate('branch.deleteLocal'),
                dataKey: 'branch-delete-local-disabled',
                sub: canDeleteLocalReason(menuRow, translate),
                disabled: true
              }),
            canDeleteMenuRemote(menuRow)
              ? h(MenuItem, {
                icon: 'trash',
                label: translate('branch.deleteRemote'),
                dataKey: 'branch-delete-remote',
                danger: true,
                disabled: busy !== null,
                onClick: () => startDelete(menuRow, 'remote')
              })
              : h(MenuItem, {
                icon: 'trash',
                label: translate('branch.deleteRemote'),
                dataKey: 'branch-delete-remote-disabled',
                sub: canDeleteRemoteReason(menuRow, translate),
                disabled: true
              }))

        if (data === null && loadError === null && loading !== true) return null

        return h('section', { className: 'dgp-branch-section', 'data-dgp-branch': 'section' },
          h('div', { className: 'dgp-branch-head' },
            h('span', { className: 'dgp-branch-title' }, translate('branch.sectionTitle')),
            summary === null ? null : h('span', { className: 'dgp-branch-summary dgp-oneline' }, summary),
            h('div', { className: 'dgp-branch-head-actions' },
              hasLocalRepo
                ? h('button', {
                  type: 'button',
                  className: 'dgp-iconbtn',
                  style: { width: 22, height: 22 },
                  title: translate('branch.fetch'),
                  'aria-label': translate('branch.fetch'),
                  'data-dgp-branch-fetch': 'true',
                  disabled: fetching,
                  onClick: runFetch
                }, fetching ? h('span', { className: 'dgp-spinner' }) : h(Icon, { name: 'sync', size: 14 }))
                : null,
              h('button', {
                type: 'button',
                className: 'dgp-iconbtn',
                style: { width: 22, height: 22 },
                title: translate('remote.refresh'),
                'aria-label': translate('remote.refresh'),
                'data-dgp-branch-refresh': 'true',
                disabled: loading,
                onClick: () => {
                  setNote(null)
                  source.onReloadBranches()
                }
              }, h(Icon, { name: 'refresh', size: 14 })))),
          showFilter
            ? h('input', {
              className: 'dgp-input dgp-branch-filter',
              'data-dgp-branch-filter': 'true',
              placeholder: translate('branch.filter'),
              spellCheck: false,
              value: filter,
              onChange: (event) => setFilter(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setFilter('')
                }
              }
            })
            : null,
          statusNodes.length > 0 ? h('div', { className: 'dgp-branch-statuses' }, statusNodes) : null,
          data !== null && visible.length === 0
            ? h('div', { className: 'dgp-branch-empty' }, branches.length === 0 ? translate('branch.empty') : '')
            : h('ul', { className: 'dgp-branch-list', role: 'list' }, rows),
          hints.length > 0 ? h('div', null, hints) : null,
          menuNode)
      }

      /** 删除本地分支：当前分支不能删；只读行（无本地仓库）没有这个动作的来源。 */
      function canDeleteMenuLocal(row) {
        return row.local === true && row.current !== true
      }

      function canDeleteLocalReason(row, translate) {
        if (row.local !== true) return translate('branch.noLocalOps')
        return translate('branch.currentNoDelete')
      }

      /** 删除远端分支：远端已知且存在，并且不是默认 / 受保护分支。 */
      function canDeleteMenuRemote(row) {
        return row.remote === true && row.default !== true && row.protected !== true
      }

      function canDeleteRemoteReason(row, translate) {
        if (row.remote === null) return translate('branch.remoteUnknown')
        if (row.remote !== true) return translate('branch.notOnRemote')
        if (row.default === true) return translate('branch.defaultNoDelete')
        return translate('branch.protectedNoDelete')
      }

      Object.assign(exports, { BranchList });

    });
    __define("./components/PullDetail.js", (exports, module) => {
      /**
       * src/components/PullDetail.js —— 单个 PR 的详情与操作（审查 / 合并）
       *
       * 能力来自宿主返回的 capabilities：Gitee 只有「通过」一种结论、合并方式两种，
       * GitHub 三种都有。界面只渲染平台真正支持的动作，不做「点了才发现不支持」。
       */
      const { h, useState, useRef } = __m("./platform.js");
      const { Icon, StatusLetter } = __m("./ui/Icon.js");
      const { DiffView } = __m("./components/DiffView.js");
      const { formatDateTime } = __m("./util/time.js");

      const VERDICT_LABEL = {
        approve: 'pull.approve',
        'request-changes': 'pull.requestChanges',
        comment: 'pull.comment'
      }

      /** 平台给的是 added / modified / removed / renamed 这类词，界面要单个字母。 */
      const FILE_LETTER = {
        added: 'A',
        copied: 'C',
        changed: 'M',
        deleted: 'D',
        modified: 'M',
        removed: 'D',
        renamed: 'R',
        unchanged: 'M'
      }

      const fileLetter = (status) => {
        if (typeof status !== 'string' || status === '') return '?'
        return FILE_LETTER[status] ?? status.slice(0, 1).toUpperCase()
      }

      /** PR 状态 → 文案 key。平台给了没见过的状态就原样显示，不拼一个不存在的 key。 */
      const PULL_STATE_KEYS = {
        open: 'pull.state.open',
        closed: 'pull.state.closed',
        merged: 'pull.state.merged'
      }

      const pullStateLabel = (t, state) => {
        const key = PULL_STATE_KEYS[state]
        if (key !== undefined) return t(key)
        return typeof state === 'string' && state !== '' ? state : t('pull.state.unknown')
      }

      function PullDetail(props) {
        const source = props
        const t = source.t
        const selection = source.selection
        const detail = source.detail
        const [note, setNote] = useState('')
        const [mergeMethod, setMergeMethod] = useState('merge')
        const [deleteBranch, setDeleteBranch] = useState(true)
        // 合并是破坏性操作（可能连源分支一起删）：两步确认，与关闭 PR 同口径
        const [mergeConfirm, setMergeConfirm] = useState(false)
        const [busy, setBusy] = useState(null)
        const [error, setError] = useState(null)
        const [notice, setNotice] = useState(null)
        // AI 审阅：idle / loading / done(result) / error
        const [ai, setAi] = useState({ status: 'idle', mode: 'diff', result: null, error: null, steps: [], logPath: null })
        // 本地没有这个仓库时：{ repoUsed, suggestedName, headBranch, target, customPath, busy, error }
        const [clonePrompt, setClonePrompt] = useState(null)
        // 评论草稿：AI 生成后填入，用户可改，只有点「提交评论」才发出去
        const [draft, setDraft] = useState('')
        const [commentBusy, setCommentBusy] = useState(false)
        const [commentNotice, setCommentNotice] = useState(null)
        // 常驻评论框：人工审阅后也能随时给对方留言
        const [commentDraft, setCommentDraft] = useState('')
        // 评论转会话：{ busyId, error, notice }
        const [commentAi, setCommentAi] = useState({ busyId: null, error: null, notice: null })
        // 关闭 PR 是两步操作：先确认再发，避免误点
        const [closeConfirm, setCloseConfirm] = useState(false)
        const [stateBusy, setStateBusy] = useState(false)
        // 变动文件：当前展开的文件、每个文件按需读到的 diff（filename -> { status, diff, error }）
        const [openFile, setOpenFile] = useState(null)
        const [fileLoads, setFileLoads] = useState({})
        // 已读到的 diff 与正在读的文件：折叠再展开不重复请求，连点也不会发两次
        const fileCache = useRef(new Map())
        const filePending = useRef(new Set())

        if (selection === null) return null

        const back = () => {
          source.onBack()
        }

        if (detail === null || detail.loading === true) {
          return h('div', { className: 'dgp-viewer' },
            h('div', { className: 'dgp-state', 'data-dgp-pull': 'loading' },
              h('div', { className: 'dgp-state-icon' }, h('span', { className: 'dgp-spinner' })),
              h('div', { className: 'dgp-state-title' }, t('pull.loading', { number: selection.number }))))
        }

        if (detail.error !== null) {
          return h('div', { className: 'dgp-viewer' },
            h('div', { className: 'dgp-state', 'data-dgp-pull': 'error' },
              h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'warning', size: 24 })),
              h('div', { className: 'dgp-state-title' }, t('pull.failed')),
              h('div', { className: 'dgp-state-desc' }, detail.error),
              h('div', { className: 'dgp-state-actions' },
                h('button', {
                  type: 'button',
                  className: 'dgp-btn',
                  'data-size': 'sm',
                  onClick: () => {
                    source.onRetry()
                  }
                }, t('action.retry')),
                h('button', {
                  type: 'button',
                  className: 'dgp-btn',
                  'data-size': 'sm',
                  'data-variant': 'ghost',
                  onClick: back
                }, t('pull.back')))))
        }

        const data = detail.data
        const pull = data.pull
        const gate = data.gate ?? { review: { state: 'unknown' }, test: { state: 'unknown' }, mergeState: null }
        const gateLabel = (kind, state) => {
          if (kind === 'review') {
            if (state === 'approved') return t('pull.gateReviewPassed')
            if (state === 'changes-requested') return t('pull.gateReviewChanges')
            if (state === 'pending') return t('pull.gateReviewPending')
            return t('pull.gateUnknown')
          }
          if (state === 'passed') return t('pull.gateTestPassed')
          if (state === 'pending') return t('pull.gateTestPending')
          return t('pull.gateUnknown')
        }
        const caps = data.capabilities
        const canMerge = pull.state === 'open' && pull.merged !== true
        // mergeable：true 可以、false 明确不行、null 表示平台还在算 —— null 不该禁用按钮
        const mergeBlocked = pull.mergeable === false
        const mergeableText = pull.mergeable === true
          ? t('pull.mergeable')
          : (pull.mergeable === false ? t('pull.notMergeable') : t('pull.mergeableUnknown'))
        // 平台不一定给增删行/文件数，缺了显示 —— 而不是 0
        const statText = (value) => (pull.statsComplete === true ? String(value) : '—')

        /* ---------------------- 变动文件：按需读单个文件的 diff ---------------------- */

        /** 读一个文件的 diff（已读过就用缓存；同一文件正在读时不重复发请求）。 */
        const loadFileDiff = async (file) => {
          const name = file.filename
          const cached = fileCache.current.get(name)
          if (cached !== undefined) {
            setFileLoads((previous) => ({ ...previous, [name]: cached }))
            return
          }
          if (filePending.current.has(name)) return
          filePending.current.add(name)
          setFileLoads((previous) => ({ ...previous, [name]: { status: 'loading' } }))
          let result
          try {
            result = await source.onPullFile({
              accountId: selection.accountId,
              fullName: selection.fullName,
              number: pull.number,
              filename: name
            })
          } catch (caught) {
            result = { ok: false, error: caught instanceof Error ? caught.message : String(caught) }
          } finally {
            filePending.current.delete(name)
          }
          if (result.ok === true) {
            const entry = { status: 'done', diff: result.diff }
            fileCache.current.set(name, entry)
            setFileLoads((previous) => ({ ...previous, [name]: entry }))
            return
          }
          setFileLoads((previous) => ({
            ...previous,
            [name]: {
              status: 'error',
              error: result.error
            }
          }))
        }

        /** 点一行：展开 / 收起；第一次展开时读 diff。 */
        const toggleFile = (file) => {
          const name = file.filename
          if (openFile === name) {
            setOpenFile(null)
            return
          }
          setOpenFile(name)
          void loadFileDiff(file)
        }

        /** 读失败后重试：先丢掉缓存（错误结果本来也不进缓存）。 */
        const retryFile = (file) => {
          fileCache.current.delete(file.filename)
          setFileLoads((previous) => ({ ...previous, [file.filename]: { status: 'loading' } }))
          void loadFileDiff(file)
        }

        /** 展开区的内容：加载中 / 失败 + 重试 / DiffView。 */
        const renderFileDiff = (file) => {
          const load = fileLoads[file.filename]
          if (load === undefined || load.status === 'loading') {
            return h('p', { className: 'dgp-detail-meta', 'data-dgp-pull': 'file-loading' }, t('pull.fileDiffLoading'))
          }
          if (load.status === 'error') {
            return h('div', { className: 'dgp-pull-file-error' },
              h('p', { className: 'dgp-detail-failure', 'data-dgp-pull': 'file-error' }, load.error),
              h('button', {
                type: 'button',
                className: 'dgp-btn',
                'data-size': 'sm',
                'data-variant': 'ghost',
                'data-dgp-pull': 'file-retry',
                onClick: () => retryFile(file)
              }, t('action.retry')))
          }
          return h(DiffView, {
            diff: load.diff,
            loading: false,
            error: null,
            path: file.filename,
            entry: {
              status: fileLetter(file.status),
              adds: file.additions,
              dels: file.deletions
            },
            view: 'unified',
            wrap: false,
            onRetry: () => retryFile(file),
            t
          })
        }

        /**
         * 评论草稿的可见行数：按换行切分，长行按每行约 80 字符折算。
         * 最少 6 行、最多 30 行 —— 内容多时输入框自己长高，不用手动拉。
         */
        const commentLines = commentDraft.split('\n').reduce(
          (sum, line) => sum + Math.max(1, Math.ceil(line.length / 80)),
          0
        )
        const commentHeight = Math.min(Math.max(commentLines, 4), 20) * 19 + 24 + 'px'

        const run = async (kind, action) => {
          setBusy(kind)
          setError(null)
          setNotice(null)
          const result = await action()
          setBusy(null)
          // 合并成功时宿主已经把详情关掉了（closed:true），这里不再写任何提示
          if (result.ok === true && result.closed === true) return
          if (result.ok === true) {
            setNotice(result.message ?? null)
            return
          }
          setError({ text: result.error, code: result.code ?? null })
        }

        /** 执行步骤列表（宿主回传）：每一步做了什么、耗时、是否失败。 */
        const renderSteps = (steps, logPath) => {
          if (!Array.isArray(steps) || steps.length === 0) return null
          return h('div', { className: 'dgp-ai-steps', 'data-dgp-pull': 'ai-steps' },
            h('p', { className: 'dgp-settings-label' }, t('pull.aiStepsTitle')),
            h('ul', { className: 'dgp-step-list' },
              steps.map((step, index) => h('li', {
                key: String(index),
                className: 'dgp-step',
                'data-level': step.level ?? 'info',
                'data-step': step.step
              },
              h('span', { className: 'dgp-step-time' }, '+' + String(step.at ?? 0) + 'ms'),
              h('span', { className: 'dgp-step-name' }, step.step),
              step.detail === '' ? null : h('span', { className: 'dgp-step-detail' }, step.detail)))),
            logPath === null
              ? null
              : h('p', { className: 'dgp-settings-hint' }, t('pull.aiLogHint', { path: logPath })))
        }

        /** 跑一次 AI 审阅（宿主负责取 diff 与调模型）。 */
        const runAi = async (mode, prepared = null) => {
          setCommentNotice(null)
          setClonePrompt(null)
          if (mode === 'session') setAi({ status: 'loading', mode, result: null, error: null, steps: [], logPath: null, phase: 'prepare' })
          else setAi({ status: 'loading', mode, result: null, error: null, steps: [], logPath: null, phase: null })

          const base = { accountId: selection.accountId, fullName: selection.fullName, number: pull.number }
          let result

          if (mode === 'session') {
            let target = prepared
            if (target === null) {
              const prep = await source.onPrepareReview({
                ...base,
                rootPaths: source.localRepoRoots
              })
              if (prep.ok !== true) {
                setAi({
                  status: 'error', mode, result: null,
                  error: prep.error,
                  code: prep.code ?? null,
                  steps: prep.details?.steps ?? [],
                  logPath: prep.details?.logPath ?? null,
                  phase: null
                })
                return
              }
              if (prep.needsClone === true) {
                setAi({ status: 'idle', mode, result: null, error: null, steps: [], logPath: null, phase: null })
                setClonePrompt({
                  repoUsed: prep.repoUsed,
                  suggestedName: prep.suggestedName,
                  headBranch: prep.headBranch,
                  customPath: '',
                  busy: false,
                  error: null
                })
                return
              }
              target = { rootPath: prep.rootPath, branch: prep.branch, steps: prep.steps ?? [], logPath: prep.logPath ?? null }
            }
            // 阶段二：会话级审阅（新开会话 + Agent 工具）。这是唯一实现，没有本地退路。
            setAi({ status: 'loading', mode, result: null, error: null, steps: target.steps ?? [], logPath: target.logPath ?? null, phase: 'review' })
            const started = await source.onSessionReview({ ...base, rootPath: target.rootPath, branch: target.branch })
            if (started.ok === true && typeof started.sessionId === 'string') {
              setAi({ status: 'done', mode: 'session', result: started, error: null, steps: [], logPath: started.logPath ?? null, phase: null })
              setCommentNotice(t('pull.sessionReviewStarted', { id: started.sessionId }))
              return
            }
            setAi({
              status: 'error',
              mode: 'session',
              result: null,
              error: started.error,
              code: started.code ?? null,
              steps: started.details?.steps ?? target.steps,
              logPath: started.details?.logPath ?? target.logPath,
              phase: null
            })
            return
          } else {
            result = await source.onAiReview({ ...base })
          }

          if (result.ok === true) {
            setAi({
              status: 'done', mode, result, error: null,
              steps: result.steps ?? [],
              logPath: result.logPath ?? null,
              phase: null
            })
            setDraft(result.comment ?? '')
            return
          }
          setAi({
            status: 'error',
            mode,
            result: null,
            error: result.error,
            code: result.code ?? null,
            steps: result.details?.steps ?? [],
            logPath: result.details?.logPath ?? null,
            phase: null
          })
        }

        /** 确认克隆位置：workspace = 项目工作区；custom = 用户填的绝对路径。 */
        /**
         * 把一条评论交给会话处理：宿主准备目录 → 新建会话（先判断再改，不自动 push）。
         * 本地没有仓库时复用克隆确认框，克隆完继续处理同一条评论。
         */
        const runCommentAi = async (comment) => {
          if (commentAi.busyId !== null) return
          setCommentAi({ busyId: comment.id ?? 0, error: null, notice: null })
          const result = await source.onCommentSession({
            accountId: selection.accountId,
            fullName: selection.fullName,
            number: pull.number,
            rootPaths: source.localRepoRoots,
            comment: {
              id: comment.id,
              author: comment.author,
              body: comment.body,
              createdAt: comment.createdAt
            }
          })
          if (result.ok === true && result.needsClone === true) {
            setCommentAi({ busyId: null, error: null, notice: null })
            setClonePrompt({
              repoUsed: result.repoUsed,
              suggestedName: result.suggestedName,
              headBranch: result.headBranch,
              customPath: '',
              busy: false,
              error: null,
              intent: 'comment',
              comment
            })
            return
          }
          if (result.ok === true) {
            setCommentAi({ busyId: null, error: null, notice: t('pull.commentAiStarted', { id: result.sessionId }) })
            return
          }
          setCommentAi({ busyId: null, error: result.error, notice: null })
        }

        const startClone = async (target) => {
          if (clonePrompt === null) return
          const targetDir = target === 'workspace'
            ? (source.projectRoot === null ? '' : source.projectRoot + '/' + clonePrompt.suggestedName)
            : clonePrompt.customPath.trim()
          if (targetDir === '') {
            setClonePrompt((previous) => (previous === null ? previous : { ...previous, error: t('pull.aiCloneNoPath') }))
            return
          }
          setClonePrompt((previous) => (previous === null ? previous : { ...previous, busy: true, error: null }))
          const result = await source.onCloneForReview({
            accountId: selection.accountId,
            fullName: selection.fullName,
            number: pull.number,
            targetDir
          })
          if (result.ok !== true) {
            setClonePrompt((previous) => (previous === null ? previous : { ...previous, busy: false, error: result.error }))
            return
          }
          if (clonePrompt.intent === 'comment' && clonePrompt.comment !== undefined) {
            // 克隆完继续处理那条评论（用刚准备好的目录）
            const comment = clonePrompt.comment
            setClonePrompt(null)
            const handled = await source.onCommentSession({
              accountId: selection.accountId,
              fullName: selection.fullName,
              number: pull.number,
              rootPath: result.rootPath,
              branch: result.branch,
              comment: { id: comment.id, author: comment.author, body: comment.body, createdAt: comment.createdAt }
            })
            if (handled.ok === true) {
              setCommentAi({ busyId: null, error: null, notice: t('pull.commentAiStarted', { id: handled.sessionId }) })
            } else {
              setCommentAi({ busyId: null, error: handled.error, notice: null })
            }
            return
          }
          await runAi('session', { rootPath: result.rootPath, branch: result.branch })
        }

        /** 关闭 / 重新打开。关闭需要二次确认；重新打开直接执行（无破坏性）。 */
        const changeState = async (nextState) => {
          if (stateBusy) return
          setStateBusy(true)
          const result = await source.onSetPullState({
            accountId: selection.accountId,
            fullName: selection.fullName,
            number: pull.number,
            state: nextState
          })
          setStateBusy(false)
          setCloseConfirm(false)
          if (result.ok === true) {
            setNotice(t(nextState === 'closed' ? 'pull.closedNotice' : 'pull.reopenedNotice'))
            return
          }
          setError({ text: result.error, code: result.code ?? null })
        }

        const submitComment = async () => {
          if (commentBusy) return
          setCommentBusy(true)
          setCommentNotice(null)
          const result = await source.onComment({
            accountId: selection.accountId,
            fullName: selection.fullName,
            number: pull.number,
            comment: commentDraft
          })
          setCommentBusy(false)
          if (result.ok === true) {
            // 发出去之后清空输入框：否则内容留在框里，用户会以为没发出去
            setCommentDraft('')
            setCommentNotice(result.message ?? t('pull.aiCommentDone'))
            return
          }
          setCommentNotice(result.error)
        }

        const submitReview = (verdict) => run('review', () => source.onReview({
          accountId: selection.accountId,
          fullName: selection.fullName,
          number: pull.number,
          verdict,
          body: note
        }))

        const submitPass = () => run('pass', () => source.onPass({
          accountId: selection.accountId,
          fullName: selection.fullName,
          number: pull.number,
          body: note
        }))

        const submitTest = () => run('test', () => source.onTest({
          accountId: selection.accountId,
          fullName: selection.fullName,
          number: pull.number
        }))

        const submitMerge = () => run('merge', () => source.onMerge({
          accountId: selection.accountId,
          fullName: selection.fullName,
          number: pull.number,
          method: mergeMethod,
          deleteBranch
        }))

        /* --------------------------- 变动文件 --------------------------- */
        // 宿主在 pullDetail 里带回文件清单（不含 patch）：点开某一行时才去读那个文件的 diff。
        const files = data.files
        const filesUnavailable = data.filesUnavailable
        // 数量以平台给的总数为准：文件列表可能读失败或被截断，此时列表条数不是真实改动数。
        const filesCount = filesUnavailable !== null || data.filesTruncated === true ? statText(pull.changedFiles) : files.length
        const filesSection =
          h('section', { className: 'dgp-detail-section', 'data-dgp-pull': 'files' },
            h('div', { className: 'dgp-detail-head' },
              h('span', { className: 'dgp-detail-title' }, t('pull.filesTitle')),
              h('span', { className: 'dgp-detail-count' }, t('pull.filesChanged', { count: filesCount }))),
            filesUnavailable === null
              ? null
              : h('p', { className: 'dgp-detail-failure', 'data-dgp-pull': 'files-error' },
                t('pull.filesUnavailable', { message: filesUnavailable })),
            files.length === 0
              ? (filesUnavailable === null
                ? h('p', { className: 'dgp-detail-empty' }, t('pull.filesEmpty'))
                : null)
              : h('ul', { className: 'dgp-pull-files' },
                files.map((file) => {
                  const open = openFile === file.filename
                  return h('li', {
                    key: file.filename,
                    className: 'dgp-pull-file',
                    'data-dgp-file': file.filename,
                    'data-open': open ? 'true' : undefined
                  },
                  h('button', {
                    type: 'button',
                    className: 'dgp-pull-file-row',
                    'data-dgp-pull': 'file-row',
                    'data-file': file.filename,
                    'aria-expanded': open ? 'true' : 'false',
                    onClick: () => toggleFile(file)
                  },
                  h(StatusLetter, { status: fileLetter(file.status) }),
                  h('span', { className: 'dgp-pull-file-name dgp-oneline', title: file.filename }, file.filename),
                  h('span', { className: 'dgp-pull-file-stat' },
                    h('span', { className: 'dgp-add' }, '+' + String(file.additions)),
                    h('span', { className: 'dgp-del' }, '−' + String(file.deletions))),
                  h(Icon, { name: open ? 'chevron-down' : 'chevron-right', size: 12 })),
                  open
                    ? h('div', {
                      className: 'dgp-pull-file-diff',
                      'data-dgp-pull': 'file-diff',
                      'data-file': file.filename
                    }, renderFileDiff(file))
                    : null)
                })),
            data.filesTruncated === true
              ? h('p', { className: 'dgp-detail-notice', 'data-dgp-pull': 'files-truncated' },
                t('pull.filesTruncated', { count: files.length }))
              : null)

        return h('div', { className: 'dgp-detail dgp-pull', 'data-dgp-pull': 'detail' },
          h('div', { className: 'dgp-detail-top' },
            h('div', { className: 'dgp-detail-name-row' },
              h('button', {
                type: 'button',
                className: 'dgp-btn',
                'data-size': 'sm',
                'data-variant': 'ghost',
                'data-dgp-pull': 'back',
                onClick: back
              }, t('pull.back')),
              h('span', { className: 'dgp-detail-name dgp-oneline', title: pull.title },
                '#' + pull.number + ' ' + pull.title)),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-dgp-pull': 'open-web',
              onClick: () => {
                source.onOpenUrl(pull.htmlUrl)
              }
            }, t('remote.openWeb'), h(Icon, { name: 'external', size: 12 })),
            pull.state === 'open'
              ? (closeConfirm
                ? h('span', { className: 'dgp-pull-confirm', 'data-dgp-pull': 'close-confirm' },
                  h('button', {
                    type: 'button',
                    className: 'dgp-btn',
                    'data-size': 'sm',
                    'data-variant': 'ghost',
                    disabled: stateBusy,
                    onClick: () => setCloseConfirm(false)
                  }, t('action.cancel')),
                  h('button', {
                    type: 'button',
                    className: 'dgp-btn',
                    'data-size': 'sm',
                    'data-dgp-pull': 'close-run',
                    disabled: stateBusy,
                    onClick: () => changeState('closed')
                  }, t('pull.closeConfirm')))
                : h('button', {
                  type: 'button',
                  className: 'dgp-btn',
                  'data-size': 'sm',
                  'data-dgp-pull': 'close-pull',
                  disabled: stateBusy,
                  onClick: () => setCloseConfirm(true)
                }, t('pull.closeRun')))
              : (pull.merged === true
                ? null
                : h('button', {
                  type: 'button',
                  className: 'dgp-btn',
                  'data-size': 'sm',
                  'data-dgp-pull': 'reopen-pull',
                  disabled: stateBusy,
                  onClick: () => changeState('open')
                }, t('pull.reopenRun')))),

          /* 门禁状态：审查与测试并排一行，状态一眼可见 */
          h('div', { className: 'dgp-gate', 'data-dgp-pull': 'gate' },
            h('span', { className: 'dgp-gate-chip', 'data-gate': 'review', 'data-state': gate.review.state },
              t('pull.gateReview'), '：', gateLabel('review', gate.review.state)),
            h('span', { className: 'dgp-gate-chip', 'data-gate': 'test', 'data-state': gate.test.state },
              t('pull.gateTest'), '：', gateLabel('test', gate.test.state)),
            gate.mergeState === null ? null : h('span', { className: 'dgp-gate-chip', 'data-gate': 'merge-state' },
              t('pull.gateMergeState'), '：', gate.mergeState)),

          h('div', { className: 'dgp-detail-meta' },
            h('span', { 'data-dgp-pull-state': pull.state }, pullStateLabel(t, pull.state)),
            pull.merged === true ? h('span', null, t('pull.merged')) : null,
            h('span', null, pull.author),
            h('span', null, pull.headBranch + ' → ' + pull.baseBranch),
            h('span', null, '+' + statText(pull.additions) + ' / −' + statText(pull.deletions)),
            h('span', null, t('pull.filesChanged', { count: statText(pull.changedFiles) })),
            h('span', null, t('pull.commits', { count: pull.commits })),
            typeof pull.createdAt === 'string' && pull.createdAt !== ''
              ? h('span', null, t('detail.created', { time: formatDateTime(Date.parse(pull.createdAt)) }))
              : null,
            typeof pull.updatedAt === 'string' && pull.updatedAt !== ''
              ? h('span', null, t('detail.updated', { time: formatDateTime(Date.parse(pull.updatedAt)) }))
              : null),

          pull.body === ''
            ? null
            : h('pre', { className: 'dgp-pull-body', 'data-dgp-pull': 'body' }, pull.body),

          filesSection,

          /* --------------------------- AI 审阅 --------------------------- */
          h('section', { className: 'dgp-detail-section', 'data-dgp-pull': 'ai' },
            h('div', { className: 'dgp-detail-head' },
              h('span', { className: 'dgp-detail-title' }, t('pull.aiTitle')),
              ai.status === 'done'
                ? h('span', { className: 'dgp-detail-count', 'data-dgp-pull': 'ai-verdict', 'data-verdict': ai.result.verdict },
                  t('pull.aiVerdict.' + ai.result.verdict))
                : null,
              h('button', {
                type: 'button',
                className: 'dgp-btn',
                'data-size': 'sm',
                'data-dgp-pull': 'ai-run',
                disabled: ai.status === 'loading' || busy !== null,
                onClick: () => runAi('diff')
              }, t(ai.status === 'done' && ai.mode === 'diff' ? 'pull.aiRerun' : 'pull.aiStart')),
              h('button', {
                type: 'button',
                className: 'dgp-btn',
                'data-size': 'sm',
                'data-dgp-pull': 'ai-deep-run',
                disabled: ai.status === 'loading' || busy !== null,
                title: t('pull.aiDeepHint'),
                onClick: () => runAi('session')
              }, t('pull.aiDeepRun'))),
            ai.status === 'loading'
              ? h('p', { className: 'dgp-detail-meta', 'data-dgp-pull': 'ai-loading' },
                t(ai.mode !== 'session' ? 'pull.aiRunning' : (ai.phase === 'prepare' ? 'pull.aiPreparing' : 'pull.aiReviewing')))
              : null,
            clonePrompt === null ? null : h('div', { className: 'dgp-ai-clone', 'data-dgp-pull': 'clone-prompt' },
              h('p', { className: 'dgp-ai-summary' }, t('pull.aiCloneTitle', { repo: clonePrompt.repoUsed })),
              h('p', { className: 'dgp-detail-meta' }, t('pull.aiCloneHint')),
              clonePrompt.error === null
                ? null
                : h('p', { className: 'dgp-detail-failure' }, clonePrompt.error),
              h('div', { className: 'dgp-pull-actions' },
                h('button', {
                  type: 'button',
                  className: 'dgp-btn',
                  'data-size': 'sm',
                  'data-variant': 'primary',
                  'data-dgp-pull': 'clone-workspace',
                  disabled: clonePrompt.busy,
                  onClick: () => startClone('workspace')
                }, t('pull.aiCloneWorkspace')),
                h('button', {
                  type: 'button',
                  className: 'dgp-btn',
                  'data-size': 'sm',
                  'data-variant': 'ghost',
                  'data-dgp-pull': 'clone-cancel',
                  disabled: clonePrompt.busy,
                  onClick: () => setClonePrompt(null)
                }, t('action.cancel'))),
              h('div', { className: 'dgp-ai-clone-custom' },
                h('input', {
                  className: 'dgp-input',
                  'data-dgp-pull': 'clone-path',
                  placeholder: t('pull.aiClonePlaceholder'),
                  value: clonePrompt.customPath,
                  spellCheck: false,
                  disabled: clonePrompt.busy,
                  onChange: (event) => setClonePrompt((previous) => (previous === null
                    ? previous
                    : { ...previous, customPath: event.target.value, error: null }))
                }),
                h('button', {
                  type: 'button',
                  className: 'dgp-btn',
                  'data-size': 'sm',
                  'data-dgp-pull': 'clone-custom',
                  disabled: clonePrompt.busy || clonePrompt.customPath.trim() === '',
                  onClick: () => startClone('custom')
                }, t('pull.aiCloneCustom')))),
            ai.status === 'error'
              ? h('div', { className: 'dgp-ai-error' },
                h('p', { className: 'dgp-detail-failure', 'data-dgp-pull': 'ai-error' }, ai.error),
                ai.code === 'no-review-model'
                  ? h('button', {
                    type: 'button',
                    className: 'dgp-btn',
                    'data-size': 'sm',
                    'data-dgp-pull': 'ai-open-settings',
                    onClick: () => source.onOpenSettings()
                  }, t('pull.aiOpenSettings'))
                  : null,
                renderSteps(ai.steps, ai.logPath))
              : null,
            ai.status !== 'done' ? null
              : ai.mode === 'session'
                ? h('div', { 'data-dgp-pull': 'ai-session' },
                  h('p', { className: 'dgp-detail-notice' }, t('pull.sessionReviewStarted', { id: ai.result.sessionId })))
                : h('div', { 'data-dgp-pull': 'ai-result' },
              ai.result.truncated === true
                ? h('p', { className: 'dgp-detail-notice', 'data-dgp-pull': 'ai-truncated' }, t('pull.aiTruncated'))
                : null,
              ai.result.filesTruncated === true
                ? h('p', { className: 'dgp-detail-notice', 'data-dgp-pull': 'ai-files-truncated' }, t('pull.aiFilesTruncated'))
                : null,
              Array.isArray(ai.result.skippedFiles) && ai.result.skippedFiles.length > 0
                ? h('div', { className: 'dgp-ai-skipped', 'data-dgp-pull': 'ai-skipped' },
                  h('p', { className: 'dgp-detail-notice' },
                    t('pull.aiSkippedTitle', { count: ai.result.skippedFiles.length })),
                  h('ul', { className: 'dgp-skipped-list' },
                    ai.result.skippedFiles.map((file) => h('li', {
                      key: file.filename,
                      className: 'dgp-skipped-item',
                      'data-dgp-skipped': file.filename
                    },
                    h('span', { className: 'dgp-skipped-name dgp-oneline', title: file.filename }, file.filename),
                    h('span', { className: 'dgp-skipped-size' },
                      '+' + file.additions + ' / −' + file.deletions + (Number.isFinite(file.changes) ? '（' + file.changes + ' 行）' : ''))))),
                  h('p', { className: 'dgp-settings-hint' }, t('pull.aiSkippedHint')))
                : null,
              h('p', { className: 'dgp-ai-summary', 'data-dgp-pull': 'ai-summary' }, ai.result.summary),
              ai.result.findings.length === 0
                ? h('p', { className: 'dgp-detail-meta' }, t('pull.aiNoFindings'))
                : h('ol', { className: 'dgp-findings' },
                  ai.result.findings.map((finding, index) => h('li', {
                    key: String(finding.file) + '#' + String(index),
                    className: 'dgp-finding',
                    'data-dgp-finding': String(index + 1),
                    'data-severity': finding.severity
                  },
                  h('div', { className: 'dgp-finding-head' },
                    h('span', { className: 'dgp-finding-no' }, String(index + 1) + '.'),
                    h('span', { className: 'dgp-severity', 'data-severity': finding.severity }, t('pull.severity.' + finding.severity)),
                    h('span', { className: 'dgp-finding-title' }, finding.title)),
                  h('div', { className: 'dgp-finding-loc' },
                    finding.file + (finding.line === null ? '' : ':' + String(finding.line))),
                  h('div', { className: 'dgp-finding-detail' }, finding.detail),
                  h('div', { className: 'dgp-finding-fix' }, t('pull.aiSuggestion'), finding.suggestion)))),
              h('div', { className: 'dgp-ai-comment' },
                h('div', { className: 'dgp-ai-comment-head' },
                  h('span', { className: 'dgp-settings-label' }, t('pull.aiCommentLabel')),
                  h('button', {
                    type: 'button',
                    className: 'dgp-btn',
                    'data-size': 'sm',
                    'data-variant': 'primary',
                    'data-dgp-pull': 'ai-fill-comment',
                    disabled: draft.trim() === '',
                    onClick: () => {
                      setCommentDraft(draft)
                      setCommentNotice(t('pull.commentFilled'))
                    }
                  }, t('pull.aiFillComment'))),
                h('pre', { className: 'dgp-ai-draft', 'data-dgp-pull': 'ai-comment' }, draft)),
              renderSteps(ai.steps, ai.logPath))),

          /* ------------------------------ 提交 ------------------------------ */
          data.commits.length === 0 && data.commitsUnavailable === null
            ? null
            : h('section', { className: 'dgp-detail-section', 'data-dgp-pull': 'commits' },
              h('div', { className: 'dgp-detail-head' },
                h('span', { className: 'dgp-detail-title' }, t('pull.commitsTitle')),
                h('span', { className: 'dgp-detail-count' }, data.commitsUnavailable === null ? statText(pull.commits) : '—')),
              data.commitsUnavailable === null
                ? null
                : h('p', { className: 'dgp-detail-failure', 'data-dgp-pull': 'commits-error' }, data.commitsUnavailable),
              data.commits.length < pull.commits
                ? h('p', { className: 'dgp-detail-notice', 'data-dgp-pull': 'commits-limited' },
                  t('pull.commitsLimited', { shown: data.commits.length, total: pull.commits }))
                : null,
              h('ul', { className: 'dgp-detail-list' },
                data.commits.map((commit) => h('li', {
                  key: commit.sha,
                  className: 'dgp-detail-item',
                  'data-dgp-commit-row': commit.sha
                },
                h('span', { className: 'dgp-detail-link dgp-oneline', title: commit.message }, commit.message.split('\n')[0]),
                h('span', { className: 'dgp-detail-meta' },
                  h('span', { className: 'dgp-detail-author' }, commit.sha.slice(0, 7)),
                  commit.author === '' ? null : h('span', null, commit.author),
                  commit.date === '' ? null : h('span', null, formatDateTime(Date.parse(commit.date)))))))),

          /* ------------------------------ 评论 ------------------------------ */
          h('section', { className: 'dgp-detail-section', 'data-dgp-pull': 'comments' },
            h('div', { className: 'dgp-detail-head' },
              h('span', { className: 'dgp-detail-title' }, t('pull.commentsTitle')),
              h('span', { className: 'dgp-detail-count' },
                data.commentsUnavailable === null ? data.comments.length : '—')),
            data.commentsUnavailable === null
              ? null
              : h('p', { className: 'dgp-detail-failure', 'data-dgp-pull': 'comments-error' }, data.commentsUnavailable),
            data.comments.length === 0
              ? h('p', { className: 'dgp-detail-empty' }, t('pull.commentsEmpty'))
              : h('ul', { className: 'dgp-detail-list' },
                data.comments.map((comment, index) => h('li', {
                  key: String(comment.id ?? index),
                  className: 'dgp-detail-item',
                  'data-dgp-comment': String(comment.id ?? index)
                },
                h('div', { className: 'dgp-comment-head' },
                  h('span', { className: 'dgp-detail-meta' },
                    h('span', { className: 'dgp-detail-author' }, comment.author),
                    comment.createdAt === '' ? null : h('span', null, formatDateTime(Date.parse(comment.createdAt)))),
                  h('button', {
                    type: 'button',
                    className: 'dgp-btn',
                    'data-size': 'sm',
                    'data-variant': 'ghost',
                    'data-dgp-pull': 'comment-ai',
                    disabled: commentAi.busyId !== null,
                    onClick: () => runCommentAi(comment)
                  }, t(commentAi.busyId === (comment.id ?? 0) ? 'pull.commentAiBusy' : 'pull.commentAi'))),
                h('pre', { className: 'dgp-comment-body' }, comment.body)))),
            commentAi.notice === null
              ? null
              : h('p', { className: 'dgp-detail-notice', 'data-dgp-pull': 'comment-ai-notice' }, commentAi.notice),
            commentAi.error === null
              ? null
              : h('p', { className: 'dgp-detail-failure', 'data-dgp-pull': 'comment-ai-error' }, commentAi.error),
            h('div', { className: 'dgp-comment-compose' },
              h('textarea', {
                className: 'dgp-input dgp-ai-textarea',
                'data-dgp-pull': 'comment-draft',
                placeholder: t('pull.commentPlaceholder'),
                value: commentDraft,
                spellCheck: false,
                style: { height: commentHeight },
                onChange: (event) => setCommentDraft(event.target.value)
              }),
              h('div', { className: 'dgp-pull-actions' },
                h('button', {
                  type: 'button',
                  className: 'dgp-btn',
                  'data-size': 'sm',
                  'data-variant': 'primary',
                  'data-dgp-pull': 'comment-submit',
                  disabled: commentBusy || commentDraft.trim() === '',
                  onClick: submitComment
                }, t(commentBusy ? 'pull.aiCommentSubmitting' : 'pull.aiCommentSubmit')))),
            commentNotice === null
              ? null
              : h('p', { className: 'dgp-detail-notice', 'data-dgp-pull': 'comment-notice' }, commentNotice)),

          /* ------------------------------ 审查 ------------------------------ */
          h('section', { className: 'dgp-detail-section', 'data-dgp-pull': 'review' },
            h('div', { className: 'dgp-detail-head' },
              h('span', { className: 'dgp-detail-title' }, t('pull.review')),
              h('span', { className: 'dgp-detail-count' },
                caps.reviews !== true
                  ? t('pull.reviewUnsupported')
                  : (data.reviewsUnavailable === null ? t('pull.reviewCount', { count: data.reviews.length }) : '—'))),
            data.reviewsUnavailable === null
              ? null
              : h('p', { className: 'dgp-detail-failure', 'data-dgp-pull': 'reviews-error' },
                t('pull.reviewsUnavailable', { message: data.reviewsUnavailable })),
            data.reviews.length === 0
              ? null
              : h('ul', { className: 'dgp-detail-list' },
                data.reviews.map((review, index) => h('li', { key: String(index), className: 'dgp-detail-item' },
                  h('span', { className: 'dgp-pull-verdict', 'data-state': review.state }, review.state),
                  h('span', { className: 'dgp-detail-meta dgp-oneline' },
                    review.author + (review.submittedAt === '' ? '' : ' · ' + formatDateTime(Date.parse(review.submittedAt))),
                    review.body === '' ? '' : ' · ' + review.body)))),
            canMerge
              ? h('div', { className: 'dgp-pull-actions' },
                h('input', {
                  className: 'dgp-input dgp-pull-note',
                  'data-dgp-pull': 'note',
                  placeholder: t('pull.notePlaceholder'),
                  value: note,
                  onChange: (event) => setNote(event.target.value)
                }),
                caps.verdicts.map((verdict) => h('button', {
                  key: verdict,
                  type: 'button',
                  className: 'dgp-btn',
                  'data-size': 'sm',
                  'data-variant': verdict === 'approve' ? 'primary' : undefined,
                  'data-dgp-pull': 'verdict-' + verdict,
                  disabled: busy !== null,
                  onClick: () => submitReview(verdict)
                }, t(VERDICT_LABEL[verdict]))))
              : null),

          /* ------------------------------ 合并 ------------------------------ */
          canMerge
            ? h('section', { className: 'dgp-detail-section', 'data-dgp-pull': 'merge' },
              h('div', { className: 'dgp-detail-head' },
                h('span', { className: 'dgp-detail-title' }, t('pull.merge')),
                h('span', { className: 'dgp-detail-count' }, mergeableText)),
              h('div', { className: 'dgp-pull-actions' },
                h('button', {
                  type: 'button',
                  className: 'dgp-btn',
                  'data-size': 'sm',
                  'data-variant': 'primary',
                  'data-dgp-pull': 'pass-all',
                  disabled: busy !== null,
                  title: t('pull.passAllHint'),
                  onClick: submitPass
                }, t(caps.test === true ? 'pull.passAll' : 'pull.passReviewOnly')),
                caps.test === true
                  ? h('button', {
                    type: 'button',
                    className: 'dgp-btn',
                    'data-size': 'sm',
                    'data-dgp-pull': 'test-gate',
                    disabled: busy !== null,
                    title: t('pull.testHint'),
                    onClick: submitTest
                  }, t('pull.testRun'))
                  : null,
                h('select', {
                  className: 'dgp-select dgp-pull-method',
                  'data-dgp-pull': 'merge-method',
                  value: mergeMethod,
                  onChange: (event) => {
                    setMergeMethod(event.target.value)
                    setMergeConfirm(false)
                  }
                },
                caps.mergeMethods.map((method) => h('option', { key: method, value: method }, t('pull.method.' + method)))),
                h('label', { className: 'dgp-pull-check' },
                  h('input', {
                    type: 'checkbox',
                    'data-dgp-pull': 'delete-branch',
                    checked: deleteBranch,
                    onChange: (event) => {
                      setDeleteBranch(event.target.checked)
                      setMergeConfirm(false)
                    }
                  }),
                  t('pull.deleteBranch', { branch: pull.headBranch })),
                mergeConfirm
                  ? h('span', { className: 'dgp-pull-confirm', 'data-dgp-pull': 'merge-confirm' },
                    h('button', {
                      type: 'button',
                      className: 'dgp-btn',
                      'data-size': 'sm',
                      'data-variant': 'ghost',
                      disabled: busy !== null,
                      onClick: () => setMergeConfirm(false)
                    }, t('action.cancel')),
                    h('button', {
                      type: 'button',
                      className: 'dgp-btn',
                      'data-size': 'sm',
                      'data-variant': 'primary',
                      'data-dgp-pull': 'merge-confirm-run',
                      disabled: busy !== null || mergeBlocked,
                      onClick: () => run('merge', () => source.onMerge({
                        accountId: selection.accountId,
                        fullName: selection.fullName,
                        number: pull.number,
                        method: mergeMethod,
                        deleteBranch
                      }))
                    }, t(busy === 'merge' ? 'pull.merging' : 'pull.mergeConfirm')))
                  : h('button', {
                    type: 'button',
                    className: 'dgp-btn',
                    'data-size': 'sm',
                    'data-variant': 'primary',
                    'data-dgp-pull': 'merge-run',
                    disabled: busy !== null || mergeBlocked,
                    onClick: () => setMergeConfirm(true)
                  }, t('pull.mergeRun'))))
            : null,

          busy === null ? null : h('p', { className: 'dgp-detail-meta' }, t('pull.working')),
          notice === null ? null : h('p', { className: 'dgp-detail-notice', 'data-dgp-pull': 'notice' }, notice),
          error === null ? null : h('div', { className: 'dgp-pull-error', 'data-dgp-pull': 'error' },
            h('p', { className: 'dgp-detail-failure' }, error.text),
            // 冲突是「可以去网页上解决」的状态问题，不是一个死胡同：给一条直达 PR 的出口
            error.code === 'pull-conflict'
              ? h('button', {
                type: 'button',
                className: 'dgp-btn',
                'data-size': 'sm',
                'data-variant': 'ghost',
                'data-dgp-pull': 'conflict-open-web',
                onClick: () => {
                  source.onOpenUrl(pull.htmlUrl)
                }
              }, t('pull.conflictOpenWeb'), h(Icon, { name: 'external', size: 12 }))
              : null))
      }

      Object.assign(exports, { PullDetail });

    });
    __define("./util/draft-cache.js", (exports, module) => {
      /**
       * src/util/draft-cache.js —— 编辑器草稿（内存，模块级）
       *
       * 编辑器草稿的生命周期必须比组件长：切到右侧栏别的页签、关掉面板再打开，
       * 没保存的改动都应该还在。原先草稿只存在 Panel 组件的 state 里，一次 unmount
       * 就静默丢光 —— 那是最不能接受的失败方式，所以它需要和 resource-cache（首屏快照）
       * 一样，活在模块级。
       *
       * 三条硬约束（与 resource-cache 一致）：
       *  1. 只在内存里，不落 localStorage：草稿是编辑现场，不是配置；
       *  2. 键 = 仓库根 + 文件相对路径：同一个相对路径在不同项目/仓库里是不同文件；
       *  3. 有上限（条数 + 总字符数）：淘汰最久没写过的，避免长会话里攒出几百 MB。
       */

      /** 最多保留多少个文件的草稿。 */
      const MAX_ENTRIES = 60
      /** 所有草稿正文加起来的字符上限（约 8MB，按 UTF-16 字符数算）。 */
      const MAX_CHARS = 4_000_000

      /** key -> { rootPath, path, draft } */
      const entries = new Map()
      let totalChars = 0

      function keyOf(rootPath, path) {
        return rootPath + '\u0000' + path
      }

      function charsOf(draft) {
        return draft.text.length + draft.savedText.length
      }

      /** 读某个仓库根下所有草稿：Map<相对路径, draft>。 */
      function readDrafts(rootPath) {
        const out = new Map()
        for (const entry of entries.values()) {
          if (entry.rootPath === rootPath) out.set(entry.path, entry.draft)
        }
        return out
      }

      /** 写一个草稿（覆盖同名）。 */
      function writeDraft(rootPath, path, draft) {
        const key = keyOf(rootPath, path)
        const existing = entries.get(key)
        if (existing !== undefined) {
          totalChars -= charsOf(existing.draft)
          entries.delete(key)
        }
        entries.set(key, { rootPath, path, draft })
        totalChars += charsOf(draft)

        while (entries.size > MAX_ENTRIES || totalChars > MAX_CHARS) {
          const oldest = entries.keys().next()
          if (oldest.done === true) break
          const dropped = entries.get(oldest.value)
          entries.delete(oldest.value)
          totalChars -= charsOf(dropped.draft)
        }
      }

      /** 丢掉一个草稿（重新加载 / 文件变成不可编辑 / 已保存并清理时）。 */
      function dropDraft(rootPath, path) {
        const key = keyOf(rootPath, path)
        const existing = entries.get(key)
        if (existing === undefined) return
        entries.delete(key)
        totalChars -= charsOf(existing.draft)
      }

      /** 清空（测试用：保证每个用例从「没有草稿」开始）。 */
      function clearDrafts() {
        entries.clear()
        totalChars = 0
      }

      Object.assign(exports, { readDrafts, writeDraft, dropDraft, clearDrafts });

    });
    __define("./util/remote.js", (exports, module) => {
      /**
       * src/util/remote.js —— 远端地址 → 可打开的网页地址
       *
       * 面板上的「打开 Git 仓库」按钮需要把 `git remote get-url origin` 的原始形式
       * 转成浏览器能开的 https 地址。支持的形式：
       *
       *   git@github.com:owner/repo.git          → https://github.com/owner/repo
       *   ssh://git@host:22/owner/repo.git       → https://host/owner/repo
       *   https://host/owner/repo.git            → https://host/owner/repo
       *   http://host/owner/repo                 → http://host/owner/repo
       *   git://host/owner/repo.git              → https://host/owner/repo
       *
       * 本地路径（`C:\\repos\\x`、`/home/me/x`、`file://…`）没有网页可开，返回 null ——
       * 调用方据此把按钮禁用，而不是弹一个必然失败的窗口。
       */

      /** 去掉尾部斜杠与 `.git` 后缀。 */
      function normalizeWebPath(value) {
        const cleaned = value.replace(/\/+$/, '').replace(/\.git$/, '').replace(/\/+$/, '')
        return cleaned === '' ? null : cleaned
      }

      /**
       * @param {string|null|undefined} remoteUrl `git config --get remote.origin.url` 的原始值
       * @returns {string|null} 可在浏览器打开的地址；无法转换时为 null
       */
      function webUrlOf(remoteUrl) {
        if (typeof remoteUrl !== 'string') return null
        const raw = remoteUrl.trim()
        if (raw === '') return null

        // scp 形式：user@host:path（注意本地 Windows 路径不含 @，不会走到这里）
        const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(raw)
        if (scp !== null) return normalizeWebPath(`https://${scp[1]}/${scp[2].replace(/^\/+/, '')}`)

        let url
        try {
          url = new URL(raw)
        } catch {
          return null
        }

        if (url.protocol === 'http:' || url.protocol === 'https:') {
          // 丢掉 userinfo 与查询串：不要把凭据带进浏览器地址栏
          return normalizeWebPath(`${url.protocol}//${url.host}${url.pathname}`)
        }
        if (url.protocol === 'ssh:' || url.protocol === 'git:') {
          const pathname = url.pathname.replace(/^\/+/, '')
          return pathname === '' ? null : normalizeWebPath(`https://${url.hostname}/${pathname}`)
        }
        return null
      }

      Object.assign(exports, { webUrlOf });

    });
    __define("./components/HeaderAction.js", (exports, module) => {
      /**
       * src/components/HeaderAction.js —— 会话标题栏最右侧的「Git 变更」按钮
       *
       * 挂在 `conversation.session.header.utilities` 槽（session 作用域，整行最右侧区域）。
       * 点一下 = 打开当前会话右侧栏的「Git 变更」页签：
       *   sidebarRight.openTabIn(sessionId, 'git')
       * 布局 store 的 openContent 会先执行 planSetExpanded(true)，所以侧栏收起时也会自动展开。
       *
       * 这个按钮的意义：右侧栏可能被收起，光靠「+」菜单里的入口会找不到，标题栏按钮常驻可见。
       * 失败（没有已挂载会话）与左侧栏「代码坞」共用 `../ui/useOpenPanel.js` 的表现。
       */
      const { h } = __m("./platform.js");
      const { Icon } = __m("./ui/Icon.js");
      const { useOpenPanel } = __m("./ui/useOpenPanel.js");

      /** 与 tab 类型一致的 kind（右侧栏按 kind 找到 tab 定义）。 */
      const TAB_KIND = 'git'

      function GitHeaderAction(props) {
        const { sessionId, t, openPanel } = props
        const { failed, activate } = useOpenPanel(() => openPanel(sessionId))
        return h('button', {
          type: 'button',
          className: 'dgp-headerbtn',
          title: failed ? t('entry.failed') : t('header.title'),
          'aria-label': failed ? t('entry.failed') : t('header.title'),
          'data-dgp-header': TAB_KIND,
          'data-failed': failed ? 'true' : undefined,
          onClick: activate
        },
        h(Icon, { name: 'git-branch', size: 16 }),
        h('span', { className: 'dgp-headerbtn-label' }, t('header.label')))
      }

      Object.assign(exports, { GitHeaderAction });

    });
    __define("./ui/useOpenPanel.js", (exports, module) => {
      /**
       * src/ui/useOpenPanel.js —— 「打开 Git 页签」按钮的共用行为
       *
       * 会话标题栏与左侧栏底部是两个入口，但宿主行为是同一个：
       * `openTab` 在没有已挂载会话时会**同步抛错**。原先底部入口自己 catch 并显示红点，
       * 标题栏入口完全不 catch（只在控制台报错），同一个失败有两种表现；而且红点
       * 只在「下次点击成功」时才消失，可能一直挂着。
       *
       * 这里统一成：点击失败 → 标记失败（红点 + 提示文案）→ 5 秒后自动复位。
       * 不需要兼容分支：宿主抛错就是唯一事实。
       */
      const { useCallback, useEffect, useState } = __m("./platform.js");

      /** @param {() => void} openPanel */
      function useOpenPanel(openPanel) {
        const [failed, setFailed] = useState(false)

        const activate = useCallback(() => {
          try {
            openPanel()
            if (failed === true) setFailed(false)
          } catch (error) {
            setFailed(true)
            console.error('[dsh-git-panel] 打开 Git 页签失败: ' + error.message)
          }
        }, [openPanel, failed])

        useEffect(() => {
          if (failed !== true) return undefined
          const timer = setTimeout(() => setFailed(false), 5000)
          return () => clearTimeout(timer)
        }, [failed])

        return { failed, activate }
      }

      Object.assign(exports, { useOpenPanel });

    });
    __define("./components/SidebarGitEntry.js", (exports, module) => {
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
      const { h } = __m("./platform.js");
      const { useOpenPanel } = __m("./ui/useOpenPanel.js");

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

      function SidebarGitEntry(props) {
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

      Object.assign(exports, { SidebarGitEntry });

    });
    var api = __m("./index.js");
    // 测试钩子：冒烟测试可借它直接取任意模块（生产运行路径不使用）
    if (api !== null && typeof api === "object") { try { api.__modules = __m; } catch (e) { /* frozen */ } }
    return api;
  }
});
