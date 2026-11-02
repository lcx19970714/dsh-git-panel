/* eslint-disable */
/* 由 build/build-client.mjs 从 src/ 生成，请勿手工编辑。 */
/* 模块: 30 个 */
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

      const name = PLUGIN_ID

      /** 这些服务由宿主 bundle 提供，缺一个就不激活 —— 明确地「要么全有、要么不跑」。 */
      const inject = ['slots', 'locale', 'connection', 'sidebarRightTabs', 'sidebarRight']

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

      Object.assign(exports, { h, Fragment, useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, setPluginContext, getPluginContext });

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
      .dgp-iconbtn svg { width: 15px; height: 15px; }
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
      .dgp-btn[data-variant="primary"]:hover:not(:disabled) { filter: brightness(1.06); }
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

      /* 分支菜单底部：输入名字后创建并切过去 */
      .dgp-branch-create {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 4px 2px;
      }
      .dgp-branch-create > .dgp-input {
        flex: 1 1 auto;
        min-width: 0;
        height: 24px;
        padding: 0 8px;
        font-family: var(--ds-font-family-code);
        font-size: 11px;
      }
      .dgp-branch-create > .dgp-btn { flex: none; }
      .dgp-addform { display: flex; flex-direction: column; gap: 4px; padding: 4px 8px 8px; }
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
      .dgp-commit-generate {
        position: absolute;
        top: 4px;
        right: 4px;
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
      .dgp-commit-generate:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
      .dgp-commit-generate[data-busy='true'] { opacity: .5; cursor: default; }
      /* 动作行：左边一行状态（提示 / 进度 / 结果），右边提交按钮 */
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
      .dgp-commit-status .dgp-spinner { width: 11px; height: 11px; border-width: 1.2px; }
      .dgp-commit-submit { flex: none; min-width: 64px; }

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
      .dgp-state-icon svg { width: 22px; height: 22px; }
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
      .dgp-root[data-narrow="true"] .dgp-meta,
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


      /* 版本号 chip：显示当前提交短 SHA，点击 = 检测更新 */
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
      .dgp-ai-textarea {
        width: 100%;
        resize: vertical;
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
      .dgp-detail-notice { margin: 0; color: var(--dsw-alias-state-success-primary); font-size: 11px; }
      /* 远端仓库详情（右侧） */
      .dgp-detail { display: flex; flex-direction: column; gap: 10px; min-height: 0; padding: 12px 14px; overflow: auto; }
      .dgp-detail-top { display: flex; align-items: flex-start; gap: 10px; }
      .dgp-detail-name-row { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; }
      .dgp-detail-name { min-width: 0; font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
      .dgp-detail-actions { display: flex; flex: none; gap: 6px; }
      .dgp-detail-desc { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 1.6; }
      .dgp-detail-meta { display: flex; flex-wrap: wrap; gap: 10px; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
      .dgp-detail-failure { margin: 0; color: var(--dsw-alias-state-warn-label); font-size: 11px; }
      .dgp-detail-code { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: var(--dsw-radius-xs); background: var(--dsw-alias-bg-module-platform); }
      .dgp-detail-section { display: flex; flex-direction: column; gap: 4px; }
      .dgp-detail-head { display: flex; align-items: center; gap: 8px; }
      .dgp-detail-title { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
      .dgp-detail-count { flex: 1 1 auto; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
      .dgp-detail-empty { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
      .dgp-detail-list { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
      .dgp-detail-item { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .dgp-detail-link { flex: 1 1 auto; min-width: 0; padding: 0; border: 0; background: 0 0; color: var(--dsw-alias-state-business-primary); font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
      .dgp-detail-link:hover { text-decoration: underline; }
      .dgp-detail-meta { flex: none; }
      .dgp-remote-item[data-active="true"] { background: var(--dsw-alias-interactive-bg-hover); }

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
        'toolbar.checkUpdates': '检测更新',
        'toolbar.openRemote': '打开 Git 仓库',
        'toolbar.refreshNow': '立即刷新',
        'update.checking': '正在检测更新…',
        'update.upToDate': '已是最新（{upstream}）',
        'update.behind': '落后 {count} 个提交（{upstream}）',
        'update.ahead': '本地领先 {count} 个提交（{upstream}）',
        'update.failed': '检测更新失败：{message}',
        'update.noRemote': '这个仓库没有配置远端',
        'update.checkedAt': '检测于 {time}',
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

        'filter.placeholder': '筛选文件…',
        'filter.clear': '清除筛选',
        'filter.loadedOnly': '只搜索已展开的目录',

        'roots.hiddenShow': '显示已隐藏的仓库（{count}）',
        'roots.hiddenCollapse': '收起已隐藏的仓库',
        'roots.hide': '隐藏「{name}」（只从储存库移除，不影响仓库本身）',
        'roots.unhide': '取消隐藏「{name}」',

        'root.noBranch': '未命名分支',
        'root.addPlaceholder': '输入本机目录的绝对路径，例如 D:\\code\\my-repo',
        'root.addConfirm': '添加',
        'root.addCancel': '取消',
        'root.addHint': '只识别这一个目录（它自己必须含 .git）：不向上找上级仓库，也不扫描子目录。粘贴「复制为路径」带引号会自动去掉。',

        'branch.hint': '当前分支 {branch} · 点击切换或新建',
        'branch.title': '分支 · {name}',
        'branch.loading': '正在读取分支…',
        'branch.localTag': '本地',
        'branch.remoteTag': '远程',
        'branch.trackHint': '本地还没有这个分支，点一下会创建 {ref} 的本地跟踪分支并切换',
        'branch.fetch': '获取远程更新',
        'branch.fetching': '正在获取远程更新…',
        'branch.upstreamGone': '上游已删除',
        'branch.empty': '这个仓库还没有任何分支',
        'branch.switching': '正在切换到 {name}…',
        'branch.creating': '正在创建并切换到 {name}…',
        'branch.create': '创建',
        'branch.createPlaceholder': '新分支名，回车创建并切换',
        'branch.failed': '失败：{message}',
        'pull.loading': '正在读取 PR #{number}…',
        'pull.failed': '读取 PR 失败',
        'pull.back': '返回仓库',
        'pull.review': '审查',
        'pull.reviewCount': '{count} 条审查记录',
        'pull.reviewUnsupported': '该平台不提供审查记录接口',
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
        'pull.aiRun': 'AI 审阅',
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
        'pull.aiCommentLabel': '评论草稿',
        'pull.aiCommentHint': 'AI 起草的内容，提交前请自己核对：只有点「提交评论」才会发到这个 PR。',
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
        'pull.mergeRun': '合并 PR',
        'pull.merging': '正在合并…',
        'pull.working': '正在提交…',
        'pull.merged': '已合并',
        'pull.reviewDone': '已提交审查（{verdict}）',
        'pull.mergedDone': '已合并，源分支 {branch}',
        'pull.filesChanged': '{count} 个文件',
        'pull.commits': '{count} 个提交',
        'pull.state.open': '打开',
        'pull.state.closed': '已关闭',
        'pull.state.merged': '已合并',
        'pull.state.unknown': '状态未知',
        'detail.pickRepo': '从左侧选一个仓库',
        'detail.pickRepoHint': '右侧会显示它的代码概况、Issues 与 PR',
        'detail.loading': '正在读取 {name}…',
        'detail.failed': '读取仓库详情失败',
        'detail.code': '代码',
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
        'commit.submit': '提交',
        'commit.submitting': '正在提交…',
        'commit.generate': '生成提交说明',
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
        'commit.generateFailed': '生成提交说明失败：{message}',

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
        'settings.viewLabel': '变更文件的显示方式',
        'settings.viewList': '列表：一行一个文件，文件名在前、路径在后',
        'settings.viewTree': '树形：按文件夹展开/折叠',
        'settings.modelLabel': '生成提交说明的模型',
        'settings.modelHint': '模型来自 DeepSeek Harness 当前配置的模型目录。',
        'settings.modelNone': '未选择',
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

        'error.gitMissing': '系统里找不到 git，可执行文件缺失',
        'error.notRepository': '这个目录不是 Git 仓库',
        'error.timeout': '操作超时',
        'error.outsideRoot': '路径超出仓库范围',
        'error.openFailed': '无法打开链接（浏览器拦截或环境不支持）：{url}',
        'error.generic': '出错了：{message}'
      }

      const en = {
        'toolbar.checkUpdates': 'Check for updates',
        'toolbar.openRemote': 'Open Git repository',
        'toolbar.refreshNow': 'Refresh now',
        'update.checking': 'Checking for updates…',
        'update.upToDate': 'Up to date ({upstream})',
        'update.behind': '{count} commits behind ({upstream})',
        'update.ahead': '{count} commits ahead ({upstream})',
        'update.failed': 'Update check failed: {message}',
        'update.noRemote': 'This repository has no remote configured',
        'update.checkedAt': 'Checked at {time}',
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

        'filter.placeholder': 'Filter files…',
        'filter.clear': 'Clear filter',
        'filter.loadedOnly': 'Only loaded folders are searched',

        'roots.hiddenShow': 'Show hidden repositories ({count})',
        'roots.hiddenCollapse': 'Collapse hidden repositories',
        'roots.hide': 'Hide "{name}" (only from the repository list)',
        'roots.unhide': 'Unhide "{name}"',

        'root.noBranch': 'no branch',
        'root.addPlaceholder': 'Absolute path of a folder, e.g. D:\\code\\my-repo',
        'root.addConfirm': 'Add',
        'root.addCancel': 'Cancel',
        'root.addHint': 'Only this folder is used (it must contain .git). No parent lookup, no scanning inside it. Pasted quotes are stripped.',

        'branch.hint': 'On {branch} · click to switch or create',
        'branch.title': 'Branches · {name}',
        'branch.loading': 'Loading branches…',
        'branch.localTag': 'local',
        'branch.remoteTag': 'remote',
        'branch.trackHint': 'No local branch yet — clicking creates a local tracking branch for {ref}',
        'branch.fetch': 'Fetch remote updates',
        'branch.fetching': 'Fetching…',
        'branch.upstreamGone': 'upstream gone',
        'branch.empty': 'This repository has no branches yet',
        'branch.switching': 'Switching to {name}…',
        'branch.creating': 'Creating and switching to {name}…',
        'branch.create': 'Create',
        'branch.createPlaceholder': 'New branch name, Enter to create and switch',
        'branch.failed': 'Failed: {message}',
        'pull.loading': 'Loading pull request #{number}…',
        'pull.failed': 'Could not load the pull request',
        'pull.back': 'Back to repository',
        'pull.review': 'Review',
        'pull.reviewCount': '{count} reviews',
        'pull.reviewUnsupported': 'This platform exposes no review list',
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
        'pull.aiRun': 'Review with AI',
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
        'pull.aiCommentLabel': 'Comment draft',
        'pull.aiCommentHint': 'Drafted by AI — please check it yourself; nothing is posted until you click submit.',
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
        'pull.mergeRun': 'Merge pull request',
        'pull.merging': 'Merging…',
        'pull.working': 'Submitting…',
        'pull.merged': 'Merged',
        'pull.reviewDone': 'Review submitted ({verdict})',
        'pull.mergedDone': 'Merged, source branch {branch}',
        'pull.filesChanged': '{count} files',
        'pull.commits': '{count} commits',
        'pull.state.open': 'Open',
        'pull.state.closed': 'Closed',
        'pull.state.merged': 'Merged',
        'pull.state.unknown': 'Unknown state',
        'detail.pickRepo': 'Pick a repository on the left',
        'detail.pickRepoHint': 'Its code overview, issues and pull requests show up here',
        'detail.loading': 'Loading {name}…',
        'detail.failed': 'Could not load the repository',
        'detail.code': 'Code',
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
        'commit.submit': 'Commit',
        'commit.submitting': 'Committing…',
        'commit.generate': 'Generate commit message',
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
        'commit.generateFailed': 'Could not generate a commit message: {message}',

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
        'settings.viewLabel': 'Changes list layout',
        'settings.viewList': 'List: one file per row, name first then its folder',
        'settings.viewTree': 'Tree: files grouped by folder',
        'settings.modelLabel': 'Model for commit messages',
        'settings.modelHint': 'Models come from the catalog configured in DeepSeek Harness.',
        'settings.modelNone': 'None selected',
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

        'error.gitMissing': 'git executable not found',
        'error.notRepository': 'Not a Git repository',
        'error.timeout': 'Operation timed out',
        'error.outsideRoot': 'Path outside the repository',
        'error.openFailed': 'Could not open the link (blocked or unsupported): {url}',
        'error.generic': 'Something went wrong: {message}'
      }

      Object.assign(exports, { NS, zh, en });

    });
    __define("./components/GitPanelSurface.js", (exports, module) => {
      /**
       * src/components/GitPanelSurface.js —— 两个宿主外壳共用的面板入口
       *
       * 同一个 Panel 出现在两处：
       *   · 会话视图 tab（`conversation.view`，会话区顶部那排视图标签）
       *   · 右侧栏 tab（`sidebar.right.pane.tab`）
       * 两处都是 session 作用域，框架都直接给 `sessionId` 与 `t`，所以这里只做转发。
       */
      const { h } = __m("./platform.js");
      const { Panel } = __m("./components/Panel.js");

      function GitPanelSurface(props) {
        return h(Panel, { sessionId: props.sessionId, t: props.t })
      }

      Object.assign(exports, { GitPanelSurface });

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
       * 刷新策略：挂载 / 切根 / 切模式 / 窗口重新可见+聚焦 / 手动 ⟳ / 可选 8s 轮询；
       * 每次请求带序号守护，切根时 abort 掉旧请求。
       */
      const { h, useCallback, useEffect, useMemo, useRef, useState } = __m("./platform.js");
      const { Icon } = __m("./ui/Icon.js");
      const { PopupMenu, MenuItem, MenuLabel, MenuSeparator } = __m("./ui/Menu.js");
      const { RepoList } = __m("./components/RepoList.js");
      const { ChangesList } = __m("./components/ChangesList.js");
      const { FileTree } = __m("./components/FileTree.js");
      const { DiffView } = __m("./components/DiffView.js");
      const { FileEditor } = __m("./components/FileEditor.js");
      const { EmptyState, LoadingState, InlineNote } = __m("./components/States.js");
      const { CommitBox } = __m("./components/CommitBox.js");
      const { SettingsView } = __m("./components/SettingsView.js");
      const { RemotePane } = __m("./components/RemotePane.js");
      const { RemoteDetail } = __m("./components/RemoteDetail.js");
      const { PullDetail } = __m("./components/PullDetail.js");
      const { MODE, usePref, useLatestGuard } = __m("./store.js");
      const api = __m("./api.js");
      const { openExternalUrl } = __m("./util/openUrl.js");
      const { reconcileSelection } = __m("./util/changes.js");
      const { webUrlOf } = __m("./util/remote.js");
      const { formatClock } = __m("./util/time.js");

      const POLL_INTERVAL_MS = 8000
      /** 提交成功提示的存活时间：看一眼就够，别一直占着位置。 */
      const COMMIT_NOTE_TTL_MS = 8000
      const MIN_LEFT = 180
      const MIN_RIGHT = 280

      function documentVisible() {
        return document.visibilityState !== 'hidden'
      }

      function documentFocused() {
        return document.hasFocus()
      }


      function initialSide(entry) {
        if (entry === null) return 'unstaged'
        if (entry.untracked) return 'untracked'
        if (entry.unstaged) return 'unstaged'
        return 'staged'
      }

      function Panel(props) {
        const t = props.t
        const tRef = useRef(t)
        tRef.current = t
        /** loadAccounts 定义在 openSettings 之后，这里留一个最新引用供打开设置时调用。 */
        const loadAccountsRef = useRef(null)

        const sessionId = props.sessionId

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
        // 右侧详情：选中的仓库与它的数据
        const [remoteSelection, setRemoteSelection] = useState(null)
        const [remoteDetail, setRemoteDetail] = useState(null)
        const remoteReposRef = useRef([])
        remoteReposRef.current = remoteRepos
        // 面板内打开的 PR：{ number } + 它的详情
        const [openPull, setOpenPull] = useState(null)
        const [pullDetail, setPullDetail] = useState(null)
        const [accountsBusy, setAccountsBusy] = useState(false)
        const [accountsError, setAccountsError] = useState(null)
        const [accountsNotice, setAccountsNotice] = useState(null)

        /* ------------------------------- 根 ------------------------------- */
        const [project, setProject] = useState({ projectRoot: null, roots: [], warnings: [] })
        const [activeRootId, setActiveRootId] = useState(null)
        const [rootsLoading, setRootsLoading] = useState(true)
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

        /* ------------------------------ status ------------------------------ */
        const [status, setStatus] = useState(null)
        const [statusLoading, setStatusLoading] = useState(false)
        const [statusError, setStatusError] = useState(null)
        /** 正在暂存/取消暂存的文件路径；同时只允许一个，避免连点打乱索引。 */
        const [stagePending, setStagePending] = useState(null)
        const stagePendingRef = useRef(null)
        const statusSeq = useLatestGuard()
        const statusAbortRef = useRef(null)

        /* ----------------------------- 选中状态 ----------------------------- */
        const [selection, setSelection] = useState(null) // { path, entry, side }
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

        /**
         * 编辑器草稿表：path -> { text, savedText, hash, eol, bom }。
         *
         * 为什么按 path 存在面板内存里（而不是只存"当前文件"）：
         *  用户在 A 文件改了几行、切去看 B、再切回 A —— 未保存的内容必须还在。
         *  静默丢弃按键是最不能接受的失败方式，所以草稿的生命周期 = 面板实例的生命周期。
         */
        const [drafts, setDrafts] = useState(() => new Map())
        const [saveState, setSaveState] = useState({ busy: false, savedAt: 0, error: null, conflict: null })
        const saveSeq = useLatestGuard()
        /**
         * 检测更新（git fetch）的状态。
         * fetchedAt 为 0 表示还没检测过；checkSeq 保证只有最新一次结果落地。
         */
        const [updateState, setUpdateState] = useState({ busy: false, fetchedAt: 0, ahead: 0, behind: 0, upstream: null, remoteUrl: null, error: null })
        const checkSeq = useLatestGuard()

        // 下面四个派生值只依赖 state，放在动作之前：checkUpdates/openRemote 要用到它们
        // 版本号 = 当前提交的短 SHA（status.head 已经是 --short 的结果）
        const versionText = status !== null && status.head !== null ? status.head : '—'
        const remoteWebUrl = webUrlOf(status === null ? null : status.remoteUrl)
        const versionTitle = buildVersionTitle(activeRoot, status, updateState, remoteWebUrl, t)
        const updateNote = buildUpdateNote(updateState, t)
        const draftsRef = useRef(drafts)
        draftsRef.current = drafts

        /* --------------------------- 提交 / 设置 --------------------------- */
        const [commitMessage, setCommitMessage] = useState('')
        const [commitBusy, setCommitBusy] = useState(false)
        const [commitGenerating, setCommitGenerating] = useState(false)
        /** 生成中的已等待毫秒数：每 200ms 刷新一次，让用户看得见它在跑。 */
        const [generateElapsed, setGenerateElapsed] = useState(0)
        const [commitNote, setCommitNote] = useState(null)
        const [showSettings, setShowSettings] = useState(false)
        const [settingsState, setSettingsState] = useState({ loading: false, models: [], commitModel: null, reviewModel: null, error: null, saved: false })

        const [moreOpen, setMoreOpen] = useState(false)
        const moreAnchorRef = useRef(null)
        const [moreAnchorRect, setMoreAnchorRect] = useState(null)

        const rootRef = useRef(null)
        const bodyRef = useRef(null)
        const [dragging, setDragging] = useState(false)

        /* ============================ 解析项目根 ============================ */
        const resolveProject = useCallback(async (signal) => {
          setRootsLoading(true)
          setRootsError(null)
          try {
            const value = await api.resolveProject({ sessionId }, { signal })
            if (signal !== undefined && signal.aborted) return
            const next = { projectRoot: value.projectRoot, roots: value.roots, warnings: value.warnings }
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
        }, [sessionId])

        useEffect(() => {

          const controller = new AbortController()
          resolveProject(controller.signal)
          return () => controller.abort()
        }, [resolveProject, sessionId])

        /* ============================== 刷新 status ============================== */
        const refreshStatus = useCallback(async () => {
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
          const previousController = statusAbortRef.current
          statusAbortRef.current = controller
          if (previousController !== null && typeof previousController.abort === 'function') {
            try {
              previousController.abort()
            } catch {
              /* ignore */
            }
          }
          setStatusLoading(true)
          setStatusError(null)
          try {
            const value = await api.readStatus({ rootPath: root.path }, { signal: controller.signal })
            if (!statusSeq.isLatest(token)) return
            setStatus(value)
            setSelection((previous) => reconcileSelection(previous, value.files))
          } catch (error) {
            if (!statusSeq.isLatest(token)) return
            if (error !== null && error !== undefined && error.code === 'aborted') return
            setStatusError(api.describeError(error, tRef.current))
          } finally {
            if (statusAbortRef.current === controller) statusAbortRef.current = null
            if (statusSeq.isLatest(token)) setStatusLoading(false)
          }
        }, [statusSeq])

        /**
         * 用户主动刷新（工具条按钮 / R 键）：除了 status，还要重读"当前正在看的内容"。
         *
         * - 变更模式：status 刷新后 `reconcileSelection` 会给出**新的** selection 对象，
         *   diff 的 effect 依赖 selection 身份，所以 diff 自动重取 —— 这里不需要额外动作。
         * - 文件模式：选中项代表一个路径，`reconcileSelection` 原样返回同一个对象（这是对的，
         *   否则未修改的文件会被清空），因此文件内容必须靠 fileNonce 显式重读。
         */
        const refreshAll = useCallback(() => {
          setFileNonce((count) => count + 1)
          refreshStatus()
        }, [refreshStatus])

        useEffect(() => {
          setStatus(null)
          setSelection(null)
          setDiff(null)
          setFileData(null)
          // 换根 = 换了一批文件：草稿（按相对路径存）不再有意义
          setDrafts(new Map())
          setSaveState({ busy: false, savedAt: 0, error: null, conflict: null })
          if (activeRoot === null || activeRoot.isGit === false) {
            setStatusLoading(false)
            return undefined
          }
          refreshStatus()
          // 切根/卸载：取消这个根还没回来的 status 请求
          return () => {
            const controller = statusAbortRef.current
            if (controller !== null && typeof controller.abort === 'function') {
              try {
                controller.abort()
              } catch {
                /* ignore */
              }
            }
            statusAbortRef.current = null
          }
        }, [activeRootId, activeRoot === null ? null : activeRoot.isGit, refreshStatus])

        /* ---------------------------- 自适应 refresh ---------------------------- */
        useEffect(() => {
          const onFocus = () => refreshStatus()
          const onVisibility = () => {
            if (documentVisible()) refreshStatus()
          }
          window.addEventListener('focus', onFocus)
          document.addEventListener('visibilitychange', onVisibility)
          return () => {
            window.removeEventListener('focus', onFocus)
            document.removeEventListener('visibilitychange', onVisibility)
          }
        }, [refreshStatus])

        useEffect(() => {
          if (autoRefresh !== true || mode !== MODE.changes) return undefined
          const timer = setInterval(() => {
            if (documentVisible() && documentFocused()) refreshStatus()
          }, POLL_INTERVAL_MS)
          return () => clearInterval(timer)
        }, [autoRefresh, mode, refreshStatus])

        /* ============================== 取 diff ============================== */
        useEffect(() => {
          if (mode !== MODE.changes) return undefined
          if (selection === null || activeRoot === null) {
            setDiff(null)
            setDiffLoading(false)
            setDiffError(null)
            return undefined
          }
          const controller = new AbortController()
          const token = diffSeq.begin()
          setDiffLoading(true)
          setDiffError(null)
          api.readDiff({
            rootPath: activeRoot.path,
            path: selection.path,
            staged: selection.side === 'staged',
            untracked: selection.side === 'untracked',
            contextLines,
            ignoreWhitespace
          }, { signal: controller.signal })
            .then((value) => {
              if (!diffSeq.isLatest(token)) return
              setDiff(value)
            })
            .catch((error) => {
              if (!diffSeq.isLatest(token)) return
              if (error && error.code === 'aborted') return
              setDiffError(api.describeError(error, tRef.current))
            })
            .finally(() => {
              if (diffSeq.isLatest(token)) setDiffLoading(false)
            })
          return () => controller.abort()
        }, [mode, selection, activeRootId, contextLines, ignoreWhitespace, diffSeq, diffNonce])

        /* ====================== 编辑器草稿 / 保存（文件模式） ====================== */

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
          const editable = value !== null && typeof value === 'object'
            && value.kind === 'text' && typeof value.text === 'string'
          const existing = draftsRef.current.get(path)
          if (editable !== true) {
            if (existing === undefined) return
            const cleaned = new Map(draftsRef.current)
            cleaned.delete(path)
            setDrafts(cleaned)
            return
          }
          const fresh = {
            text: value.text,
            savedText: value.text,
            hash: value.hash,
            eol: value.eol,
            bom: value.bom === true
          }
          if (existing === undefined) {
            const created = new Map(draftsRef.current)
            created.set(path, fresh)
            setDrafts(created)
            return
          }
          if (existing.hash === value.hash) return
          const dirty = existing.text !== existing.savedText
          const next = new Map(draftsRef.current)
          next.set(path, dirty ? existing : fresh)
          setDrafts(next)
          if (dirty) setSaveState((previous) => ({ ...previous, conflict: { path } }))
        }, [])

        /** 编辑器输入 → 更新草稿。 */
        const changeDraft = useCallback((path, text) => {
          setDrafts((previous) => {
            const draft = previous.get(path)
            if (draft === undefined || draft.text === text) return previous
            const next = new Map(previous)
            next.set(path, { ...draft, text })
            return next
          })
        }, [])

        /**
         * 保存当前文件。
         * `force === true` 只由「覆盖保存」按钮传入 —— 那是用户看过冲突提示后的显式决定。
         */
        const saveDraft = useCallback(async (force) => {
          if (mode !== MODE.files || browseRoot === null || selection === null) return
          const path = selection.path
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
            setDrafts((previous) => {
              const current = previous.get(path)
              if (current === undefined) return previous
              const next = new Map(previous)
              next.set(path, { ...current, savedText: current.text, hash: result.hash })
              return next
            })
            setSaveState({ busy: false, savedAt: Date.now(), error: null, conflict: null })
            // 保存后工作区变了：刷新 status，让变更列表/计数跟上（选中项是路径型，不会被清掉）
            refreshStatus()
          } catch (error) {
            if (!saveSeq.isLatest(token)) return
            if (error !== null && error !== undefined && error.code === 'conflict') {
              setSaveState({ busy: false, savedAt: 0, error: null, conflict: { path } })
              return
            }
            if (error !== null && error !== undefined && error.code === 'aborted') {
              setSaveState((previous) => ({ ...previous, busy: false }))
              return
            }
            setSaveState({ busy: false, savedAt: 0, error: api.describeError(error, tRef.current), conflict: null })
          }
        }, [mode, browseRoot, selection, saveSeq, refreshStatus])

        /** 冲突条的「重新加载」：丢掉本地改动，重新从磁盘读。 */
        const reloadDraft = useCallback(() => {
          if (selection === null) return
          const path = selection.path
          setDrafts((previous) => {
            if (!previous.has(path)) return previous
            const next = new Map(previous)
            next.delete(path)
            return next
          })
          setSaveState({ busy: false, savedAt: 0, error: null, conflict: null })
          setFileNonce((count) => count + 1)
        }, [selection])

        /* -------------------------- 检测更新 / 打开仓库 -------------------------- */

        /**
         * 检测更新 = 让宿主执行一次 git fetch，再回来看 ahead/behind。
         * 这是只读操作（只更新远端跟踪引用），所以不需要二次确认。
         */
        const checkUpdates = useCallback(async () => {
          if (activeRoot === null || activeRoot.isGit === false) return
          const token = checkSeq.begin()
          setUpdateState((previous) => ({ ...previous, busy: true, error: null }))
          try {
            const value = await api.fetchRemote({ rootPath: activeRoot.path })
            if (!checkSeq.isLatest(token)) return
            setUpdateState({
              busy: false,
              fetchedAt: value.fetchedAt,
              ahead: value.ahead,
              behind: value.behind,
              upstream: value.upstream,
              remoteUrl: value.url,
              error: null
            })
            // fetch 改了远端跟踪引用：status 里的 ahead/behind 也要跟上
            refreshStatus()
          } catch (error) {
            if (!checkSeq.isLatest(token)) return
            if (error !== null && error !== undefined && error.code === 'aborted') {
              setUpdateState((previous) => ({ ...previous, busy: false }))
              return
            }
            setUpdateState({
              busy: false,
              fetchedAt: Date.now(),
              ahead: 0,
              behind: 0,
              upstream: null,
              remoteUrl: null,
              error: api.describeError(error, tRef.current)
            })
          }
        }, [activeRoot, checkSeq, refreshStatus])

        /** 打开远端仓库网页（本地路径类远端没有网页，按钮此时是禁用的）。 */
        const openRemote = useCallback(() => {
          if (remoteWebUrl === null) return
          window.open(remoteWebUrl, '_blank', 'noopener,noreferrer')
        }, [remoteWebUrl])


        /** 有未保存改动的文件（给文件树画脏点）。 */
        const dirtyPaths = useMemo(() => {
          const set = new Set()
          for (const [path, draft] of drafts) if (draft.text !== draft.savedText) set.add(path)
          return set
        }, [drafts])
        /* ============================ 取文件内容 ============================ */
        useEffect(() => {
          if (mode !== MODE.files) return undefined
          if (selection === null || activeRoot === null) {
            setFileData(null)
            setFileLoading(false)
            setFileError(null)
            return undefined
          }
          const controller = new AbortController()
          const token = fileSeq.begin()
          setFileLoading(true)
          setFileError(null)
          const path = selection.path
          api.readFile({ rootPath: browseRoot.path, path }, { signal: controller.signal })
            .then((value) => {
              if (!fileSeq.isLatest(token)) return
              setFileData(value)
              adoptRead(path, value)
            })
            .catch((error) => {
              if (!fileSeq.isLatest(token)) return
              if (error && error.code === 'aborted') return
              setFileError(api.describeError(error, tRef.current))
            })
            .finally(() => {
              if (fileSeq.isLatest(token)) setFileLoading(false)
            })
          return () => controller.abort()
        }, [mode, selection, browseRoot === null ? null : browseRoot.id, fileSeq, fileNonce])

        /* ============================== 交互 ============================== */
        const selectEntry = useCallback((entry, groupKey) => {
          if (entry === null || entry === undefined) return
          const side = groupKey === 'staged' && entry.staged === true
            ? 'staged'
            : groupKey === 'unstaged' && entry.unstaged === true
              ? 'unstaged'
              : groupKey === 'untracked'
                ? 'untracked'
                : initialSide(entry)
          setSelection({ path: entry.path, entry, side })
        }, [])

        const selectFile = useCallback((relPath) => {
          if (typeof relPath !== 'string' || relPath === '') return
          setSelection({ path: relPath, entry: null, side: 'unstaged' })
        }, [])

        const switchSide = useCallback((side) => {
          setSelection((previous) => (previous === null ? previous : { ...previous, side }))
        }, [])

        /**
         * 行尾 + / −：未暂存与未跟踪暂存（git add），已暂存取消暂存（git restore --staged）。
         * 操作只作用于那一个文件；完成后重读 status，分组归属由新状态决定，
         * 所以文件会从下面的未暂存移到上面的已暂存（或反过来）。
         */
        const stageEntry = useCallback(async (relPath, action) => {
          if (activeRoot === null || activeRoot.isGit === false) return
          if (typeof relPath !== 'string' || relPath === '') return
          if (action !== 'stage' && action !== 'unstage') return
          if (stagePendingRef.current !== null) return
          stagePendingRef.current = relPath
          setStagePending(relPath)
          setStatusError(null)
          try {
            await api.stageFile({ rootPath: activeRoot.path, path: relPath, action })
            await refreshStatus()
            setDiffNonce((previous) => previous + 1)
          } catch (error) {
            if (error === null || error === undefined || error.code !== 'aborted') {
              setStatusError(api.describeError(error, tRef.current))
            }
          } finally {
            stagePendingRef.current = null
            setStagePending(null)
          }
        }, [activeRoot, refreshStatus])

        /** 分组头的批量按钮：一次暂存或取消暂存整组。 */
        const stageGroup = useCallback(async (scope) => {
          if (activeRoot === null || activeRoot.isGit === false) return
          if (scope !== 'stage-unstaged' && scope !== 'stage-untracked' && scope !== 'stage-all' && scope !== 'unstage') return
          if (stagePendingRef.current !== null) return
          stagePendingRef.current = scope
          setStagePending(scope)
          setStatusError(null)
          try {
            await api.stageGroup({ rootPath: activeRoot.path, scope })
            await refreshStatus()
            setDiffNonce((previous) => previous + 1)
          } catch (error) {
            if (error === null || error === undefined || error.code !== 'aborted') {
              setStatusError(api.describeError(error, tRef.current))
            }
          } finally {
            stagePendingRef.current = null
            setStagePending(null)
          }
        }, [activeRoot, refreshStatus])

        /** 提交已暂存内容。未暂存的改动不参与。 */
        const commitStaged = useCallback(async () => {
          if (activeRoot === null || activeRoot.isGit === false) return
          const message = commitMessage.trim()
          if (message === '' || commitBusy) return
          setCommitBusy(true)
          setCommitNote(null)
          try {
            const result = await api.commitChanges({ rootPath: activeRoot.path, message })
            setCommitMessage('')
            const subject = typeof result.subject === 'string' ? result.subject.trim() : ''
            setCommitNote({
              tone: 'info',
              text: subject === ''
                ? tRef.current('commit.done', { head: result.head })
                : tRef.current('commit.doneSubject', { head: result.head, subject })
            })
            await refreshStatus()
            setDiffNonce((previous) => previous + 1)
          } catch (error) {
            setCommitNote({ tone: 'error', text: api.describeError(error, tRef.current) })
          } finally {
            setCommitBusy(false)
          }
        }, [activeRoot, commitMessage, commitBusy, refreshStatus])

        /** 改输入就清掉上一次的结果提示：用户已经在写新的说明了。 */
        const changeCommitMessage = useCallback((text) => {
          setCommitMessage(text)
          setCommitNote(null)
        }, [])

        /**
         * 提交成功的提示会自己消失（8s）；错误提示留着，用户读完自己动手再试。
         */
        useEffect(() => {
          if (commitNote === null || commitNote.tone === 'error') return undefined
          const timer = setTimeout(() => setCommitNote(null), COMMIT_NOTE_TTL_MS)
          return () => clearTimeout(timer)
        }, [commitNote])

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
          if (activeRoot === null || activeRoot.isGit === false || commitGenerating) return
          setCommitGenerating(true)
          setCommitNote(null)
          try {
            const result = await api.commitMessage({ rootPath: activeRoot.path })
            setCommitMessage(result.message)
          } catch (error) {
            setCommitNote({ tone: 'error', text: api.describeError(error, tRef.current) })
          } finally {
            setCommitGenerating(false)
          }
        }, [activeRoot, commitGenerating])

        /** 设置里存的是 {provider, model}，下拉框用的是扁平 ref。 */
        const refOfPair = (pair) => (pair === null || pair === undefined ? null : pair.provider + '/' + pair.model)

        /** 打开设置页：同时拉模型目录和当前设置。 */
        const openSettings = useCallback(async () => {
          setShowSettings(true)
          setSettingsState({ loading: true, models: [], commitModel: null, reviewModel: null, error: null, saved: false })
          // 设置页也管理账号：进来就确保账号列表是最新的（只读列表接口，很便宜）
          loadAccountsRef.current?.()
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
              error: modelError,
              saved: false
            })
          } catch (error) {
            setSettingsState({ loading: false, models: [], commitModel: null, reviewModel: null, error: api.describeError(error, tRef.current), saved: false })
          }
        }, [])

        /** 选择模型即保存。空值表示清除。 */
        const changeCommitModel = useCallback(async (ref) => {
          const commitModel = ref === '' ? null : ref
          setSettingsState((previous) => ({ ...previous, commitModel, saved: false, error: null }))
          try {
            const saved = await api.writeSettings({ commitModel })
            setSettingsState((previous) => ({ ...previous, commitModel: refOfPair(saved.commitModel), saved: true }))
          } catch (error) {
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
          if (activeRoot !== null && activeRoot.isGit === true) return
          const firstRepo = gitRoots[0]
          if (firstRepo !== undefined) setActiveRootId(firstRepo.id)
        }, [mode, activeRoot, gitRoots])

        const toggleGroup = useCallback((groupKey) => {
          setCollapsedGroups((previous) => {
            const next = { ...(previous && typeof previous === 'object' ? previous : {}) }
            if (next[groupKey] === true) delete next[groupKey]
            else next[groupKey] = true
            return next
          })
        }, [setCollapsedGroups])

        const selectRoot = useCallback((root) => {
          if (root === null || root === undefined) return
          setActiveRootId(root.id)
        }, [])

        const addExternalRoot = useCallback(async (dir) => {
          const projectRoot = projectRef.current.projectRoot
          if (typeof projectRoot !== 'string' || projectRoot === '') {
            throw new Error(tRef.current('status.noCwd'))
          }
          try {
            const value = await api.addRoot({ projectRoot, path: dir })
            const nextRoots = value.roots
            setProject({ projectRoot: value.projectRoot, roots: nextRoots, warnings: value.warnings })
            const added = nextRoots.find((root) => typeof root.path === 'string' && root.path.toLowerCase() === dir.replace(/\\/g, '/').toLowerCase())
            if (added !== undefined) setActiveRootId(added.id)
            else if (nextRoots.length > 0) setActiveRootId(nextRoots[nextRoots.length - 1].id)
            return value
          } catch (error) {
            throw new Error(api.describeError(error, tRef.current))
          }
        }, [])

        const removeExternalRoot = useCallback(async (root) => {
          const projectRoot = projectRef.current.projectRoot
          if (root === null || typeof projectRoot !== 'string') return
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
          if (root === null || typeof projectRoot !== 'string') return
          try {
            applyRootsChange(await api.hideRoot({ projectRoot, path: root.path }), root)
          } catch (error) {
            setRootsError(api.describeError(error, tRef.current))
          }
        }, [applyRootsChange])

        const unhideRoot = useCallback(async (root) => {
          const projectRoot = projectRef.current.projectRoot
          if (root === null || typeof projectRoot !== 'string') return
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
          await refreshStatus()
        }, [resolveProject, refreshStatus])

        /** 分支菜单里的「获取远程更新」：git fetch 后重读分支列表。 */
        const fetchBranches = useCallback(async (root) => {
          try {
            await api.fetchRemote({ rootPath: root.path })
          } catch (error) {
            throw new Error(api.describeError(error, tRef.current))
          }
          return api.listBranches({ rootPath: root.path })
        }, [])

        const switchBranch = useCallback(async (root, name) => {
          try {
            await api.switchBranch({ rootPath: root.path, name })
          } catch (error) {
            throw new Error(api.describeError(error, tRef.current))
          }
          // 切分支会改 HEAD 与工作区：重新解析根（分支名要更新）并重读状态
          await resolveProject()
          await refreshStatus()
        }, [resolveProject, refreshStatus])

        /** 创建分支后直接切过去：宿主一次做完 `git switch -c`，面板只负责刷新。 */
        const createBranch = useCallback(async (root, name) => {
          try {
            await api.createBranch({ rootPath: root.path, name })
          } catch (error) {
            throw new Error(api.describeError(error, tRef.current))
          }
          await resolveProject()
          await refreshStatus()
        }, [resolveProject, refreshStatus])

        const loadDir = useCallback(async (relPath, signal) => {
          const root = browseRootRef.current
          if (root === null) return { entries: [], truncated: false }
          return api.listDirectory({ rootPath: root.path, path: relPath ?? '' }, { signal })
        }, [])

        /* ------------------------------ 远端账号 ------------------------------ */

        /** 读账号列表（token 不会下发到客户端，只有 id/login/label）。 */
        const loadAccounts = useCallback(async () => {
          try {
            const value = await api.listAccounts({})
            setAccounts(value.accounts)
            setProviders(value.providers)
            setAccountsLoaded(true)
            setRemoteAccountId((previous) => {
              if (previous !== null && value.accounts.some((account) => account.id === previous)) return previous
              return value.accounts.length > 0 ? value.accounts[0].id : null
            })
          } catch (error) {
            setAccountsLoaded(true)
            setRemoteError(api.describeError(error, tRef.current))
          }
        }, [])
        loadAccountsRef.current = loadAccounts

        /** 读某个账号的仓库；append 用于「加载更多」。 */
        const loadRepos = useCallback(async (accountId, page, append) => {
          if (typeof accountId !== 'string') return
          setRemoteLoading(true)
          if (append !== true) setRemoteError(null)
          try {
            const value = await api.listRemoteRepos({ accountId, page })
            setRemoteRepos((previous) => (append === true ? [...previous, ...value.repos] : value.repos))
            setRemoteHasMore(value.hasMore === true)
          } catch (error) {
            setRemoteError(api.describeError(error, tRef.current))
            if (append !== true) setRemoteRepos([])
          } finally {
            setRemoteLoading(false)
          }
        }, [])

        /** 批量取当前列表的未合并 PR 数（宿主限制 50 个/次）。 */
        const loadPullCounts = useCallback(async (accountId, repos) => {
          if (typeof accountId !== 'string' || repos.length === 0) {
            setPrCounts({})
            return
          }
          try {
            const value = await api.remotePullCounts({
              accountId,
              fullNames: repos.map((repo) => repo.fullName)
            })
            setPrCounts(value.counts ?? {})
          } catch {
            // 计数只是角标：失败就不显示，不打断列表（详情接口会暴露真实错误）
            setPrCounts({})
          }
        }, [])

        /** 读选中仓库的详情（代码 / issues / PR）。 */
        const loadRemoteDetail = useCallback(async (selection) => {
          if (selection === null) {
            setRemoteDetail(null)
            return
          }
          setRemoteDetail({ loading: true, error: null, data: null })
          try {
            const data = await api.remoteDetail({ accountId: selection.accountId, fullName: selection.fullName })
            setRemoteDetail({ loading: false, error: null, data })
          } catch (error) {
            setRemoteDetail({ loading: false, error: api.describeError(error, tRef.current), data: null })
          }
        }, [])

        /** 读一个 PR 的详情（含平台能力与审查记录）。 */
        const loadPullDetail = useCallback(async (selection) => {
          if (selection === null) {
            setPullDetail(null)
            return
          }
          setPullDetail({ loading: true, error: null, data: null })
          try {
            const data = await api.remotePull({
              accountId: selection.accountId,
              fullName: selection.fullName,
              number: selection.number
            })
            setPullDetail({ loading: false, error: null, data })
          } catch (error) {
            setPullDetail({ loading: false, error: api.describeError(error, tRef.current), data: null })
          }
        }, [])

        /** 从仓库详情点开某个 PR。 */
        const openPullNumber = useCallback((number) => {
          if (remoteSelection === null) return
          const selection = {
            accountId: remoteSelection.accountId,
            fullName: remoteSelection.fullName,
            number
          }
          setOpenPull(selection)
          loadPullDetail(selection)
        }, [remoteSelection, loadPullDetail])

        const closePull = useCallback(() => {
          setOpenPull(null)
          setPullDetail(null)
        }, [])

        /** 审查：统一把失败包成 { ok:false, error }，界面就地显示。 */
        const reviewPull = useCallback(async (input) => {
          try {
            const result = await api.remotePullReview(input)
            await loadPullDetail({ accountId: input.accountId, fullName: input.fullName, number: input.number })
            return { ok: true, message: tRef.current('pull.reviewDone', { verdict: input.verdict }) }
          } catch (error) {
            return { ok: false, error: api.describeError(error, tRef.current) }
          }
        }, [loadPullDetail])

        /** AI 审阅 PR：宿主取 diff、调审阅模型，返回结构化结论与评论草稿。 */
        const aiReviewPull = useCallback(async (input) => {
          try {
            const review = await api.remotePullAiReview(input)
            return { ok: true, ...review }
          } catch (error) {
            return { ok: false, error: api.describeError(error, tRef.current) }
          }
        }, [])

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
            return { ok: true, message: tRef.current('pull.passDone', { steps: result.completed.join(' / ') }) }
          } catch (error) {
            return { ok: false, error: api.describeError(error, tRef.current) }
          }
        }, [loadPullDetail])

        /** 标记测试通过（Gitee 的合并门禁）：成功后重读详情，让合并按钮可用。 */
        const testPull = useCallback(async (input) => {
          try {
            await api.remotePullTest(input)
            await loadPullDetail({ accountId: input.accountId, fullName: input.fullName, number: input.number })
            return { ok: true, message: tRef.current('pull.testDone') }
          } catch (error) {
            return { ok: false, error: api.describeError(error, tRef.current) }
          }
        }, [loadPullDetail])

        const mergePull = useCallback(async (input) => {
          try {
            const result = await api.remotePullMerge(input)
            await loadPullDetail({ accountId: input.accountId, fullName: input.fullName, number: input.number })
            await loadRemoteDetail({ accountId: input.accountId, fullName: input.fullName })
            // 合并后未合并数量会变，角标要跟着刷新
            await loadPullCounts(input.accountId, remoteReposRef.current)
            return { ok: true, message: tRef.current('pull.mergedDone', { branch: result.headBranch }) }
          } catch (error) {
            return { ok: false, error: api.describeError(error, tRef.current) }
          }
        }, [loadPullDetail, loadRemoteDetail])

        /** 选中仓库：右侧立刻进入加载态再拉数据。 */
        const selectRemoteRepo = useCallback((repo) => {
          const selection = { accountId: repo.accountId, fullName: repo.fullName, name: repo.name }
          setRemoteSelection(selection)
          loadRemoteDetail(selection)
        }, [loadRemoteDetail])

        const openExternal = useCallback((url) => {
          const result = openExternalUrl(url)
          if (result.opened !== true) setStatusError(tRef.current('error.openFailed', { url }))
        }, [])

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
          if (mode !== MODE.remote || remoteRepos.length === 0) return
          const exists = remoteSelection !== null && remoteRepos.some((repo) => repo.fullName === remoteSelection.fullName)
          if (exists) return
          selectRemoteRepo(remoteRepos[0])
        }, [mode, remoteRepos, remoteSelection, selectRemoteRepo])

        /** 切账号或首次进入时读第一页。 */
        useEffect(() => {
          if (mode !== MODE.remote || remoteAccountId === null) return
          loadRepos(remoteAccountId, 1, false)
        }, [mode, remoteAccountId, loadRepos])

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
            await resolveProject()
            await refreshStatus()
            setMode(MODE.changes)
          } catch (error) {
            setCloneState({ fullName: repo.fullName, startedAt: 0, error: api.describeError(error, tRef.current) })
          }
        }, [resolveProject, refreshStatus, setMode])

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
        const beginDrag = useCallback((event) => {
          if (event.button !== undefined && event.button !== 0) return
          event.preventDefault()
          setDragging(true)
        }, [])

        useEffect(() => {
          if (!dragging) return undefined
          const onMove = (event) => {
            const body = bodyRef.current
            if (body === null) return
            const rect = body.getBoundingClientRect()
            const raw = event.clientX - rect.left
            const max = Math.max(MIN_LEFT, rect.width - MIN_RIGHT)
            const next = Math.min(max, Math.max(MIN_LEFT, Math.round(raw)))
            setLeftWidth(next)
          }
          const onUp = () => setDragging(false)
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
          window.addEventListener('pointercancel', onUp)
          const previousCursor = document.body.style.cursor
          const previousSelect = document.body.style.userSelect
          document.body.style.cursor = 'col-resize'
          document.body.style.userSelect = 'none'
          return () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            window.removeEventListener('pointercancel', onUp)
            document.body.style.cursor = previousCursor
            document.body.style.userSelect = previousSelect
          }
        }, [dragging, setLeftWidth])

        /* ------------------------------ 键盘 ------------------------------ */
        const onKeyDown = useCallback((event) => {
          const target = event.target
          const inField = target !== null && (
            target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable === true
          )
          if (event.key === '/' && !inField) {
            event.preventDefault()
            const node = filterRef.current
            if (node !== null && node.focus !== undefined) node.focus()
            return
          }
          if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === 's' || event.key === 'S')) {
            // 焦点在编辑器里时由 FileEditor 处理（它能拿到光标位置）；这里管"焦点在文件树/工具条"的情况
            if (inField || mode !== MODE.files) return
            event.preventDefault()
            if (selection !== null) saveDraft(false)
            return
          }
          if (inField) return
          if ((event.key === 'r' || event.key === 'R') && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault()
            refreshAll()
          }
        }, [refreshAll, mode])


      /** 版本号按钮的 tooltip：检测更新 · 分支 · 提交 · 上游 · 上次检测时间。 */
      function buildVersionTitle(activeRoot, status, updateState, remoteWebUrl, t) {
        const parts = [t('toolbar.checkUpdates')]
        if (status !== null) {
          if (status.branch !== null) parts.push(status.branch)
          if (status.head !== null) parts.push(status.head)
          if (status.upstream !== null) parts.push(status.upstream)
        }
        if (activeRoot !== null && activeRoot.isGit === false) parts.push(t('update.noRemote'))
        else if (remoteWebUrl === null) parts.push(t('update.noRemote'))
        if (updateState.fetchedAt > 0 && updateState.error === null) {
          parts.push(t('update.checkedAt', { time: formatClock(updateState.fetchedAt) }))
        }
        return parts.join(' \u00b7 ')
      }

      /**
       * 检测更新的一句话结果。返回 null 表示还没有结果可报（从未检测过）。
       * 落后优先于领先：同时有分叉时更重要的是"你落后了"。
       */
      function buildUpdateNote(updateState, t) {
        if (updateState.busy === true) return { tone: 'info', text: t('update.checking') }
        if (updateState.error !== null) return { tone: 'error', text: t('update.failed', { message: updateState.error }) }
        if (updateState.fetchedAt === 0) return null
        const upstream = updateState.upstream === null ? '' : updateState.upstream
        if (updateState.behind > 0) return { tone: 'warn', text: t('update.behind', { count: updateState.behind, upstream }) }
        if (updateState.ahead > 0) return { tone: 'info', text: t('update.ahead', { count: updateState.ahead, upstream }) }
        return { tone: 'info', text: t('update.upToDate', { upstream }) }
      }


        /* ------------------------------ 派生 ------------------------------ */
        const selectedPath = selection === null ? null : selection.path
        const selectedEntry = selection === null ? null : selection.entry
        const entryHasBothSides = selectedEntry !== null
          && selectedEntry.staged === true
          && selectedEntry.unstaged === true
        const counts = status === null ? null : status.counts
        const isNarrow = typeof leftWidth === 'number' && leftWidth < 220
        const warnings = useMemo(() => {
          const list = []
          for (const warning of project.warnings) {
            if (warning !== '') list.push(warning)
          }
          if (activeRoot !== null && typeof activeRoot.error === 'string' && activeRoot.error !== '') {
            list.push(activeRoot.error)
          }
          return list
        }, [project.warnings, activeRoot])

        /* ------------------------------ 渲染 ------------------------------ */
        const noSession = typeof sessionId !== 'string'

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
                onClick: () => setMode(MODE.remote)
              }, t('mode.remote'))),
            h('div', { className: 'dgp-spacer' }),
            // 检测更新的结果贴在版本号左边，不单独占一行（宽度不够时自己截断，全文在 title 里）
            updateNote === null
              ? null
              : h('span', {
                className: 'dgp-update-note',
                'data-update-note': updateNote.tone,
                'data-tone': updateNote.tone,
                title: updateNote.text
              }, updateNote.text),
            h('button', {
              type: 'button',
              className: 'dgp-version',
              title: versionTitle,
              'aria-label': t('toolbar.checkUpdates'),
              'data-action': 'check-updates',
              'data-busy': updateState.busy ? 'true' : undefined,
              disabled: activeRoot === null || activeRoot.isGit === false,
              onClick: checkUpdates
            }, h(Icon, { name: 'sync', size: 13 }), h('span', { className: 'dgp-version-text' }, versionText)),
            h('button', {
              type: 'button',
              className: 'dgp-iconbtn',
              title: remoteWebUrl === null ? t('update.noRemote') : t('toolbar.openRemote'),
              'aria-label': t('toolbar.openRemote'),
              'data-action': 'open-remote',
              disabled: remoteWebUrl === null,
              onClick: openRemote
            }, h(Icon, { name: 'external', size: 15 })),
            h('button', {
              type: 'button',
              className: 'dgp-iconbtn',
              title: t('settings.open'),
              'aria-label': t('settings.open'),
              'data-action': 'open-settings',
              onClick: openSettings
            }, h(Icon, { name: 'settings', size: 15 })),
            h('button', {
              type: 'button',
              className: 'dgp-iconbtn',
              title: t('toolbar.more'),
              'aria-expanded': moreOpen ? 'true' : 'false',
              onClick: () => {
                const node = moreAnchorRef.current
                setMoreAnchorRect(node === null ? null : node.getBoundingClientRect())
                setMoreOpen((previous) => !previous)
              },
              ref: moreAnchorRef
            }, h(Icon, { name: 'more', size: 15 }))))

        const filterRow = h('div', { className: 'dgp-filter' },
          h('div', { className: 'dgp-search' },
            h(Icon, { name: 'search', size: 13 }),
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
                  if (event.target && event.target.blur) event.target.blur()
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
                'data-active': selection.side === 'unstaged' ? 'true' : undefined,
                title: t('group.unstaged'),
                onClick: () => switchSide('unstaged')
              }, t('group.unstaged')),
              h('button', {
                type: 'button',
                className: 'dgp-seg-btn',
                'data-active': selection.side === 'staged' ? 'true' : undefined,
                title: t('group.staged'),
                onClick: () => switchSide('staged')
              }, t('group.staged')))
            : null)

        const stagedCount = status !== null && status.counts !== null && status.counts !== undefined
          ? status.counts.staged
          : 0
        /** 只要有改动就能提交（没有暂存时提交会先把全部改动暂存）。 */
        const changeCount = status !== null && status.counts !== null && status.counts !== undefined
          ? status.counts.total
          : 0

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
            onSelectAccount: (account) => setRemoteAccountId(account.id),
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
              }, t('mode.files'))],
              t
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
                onTrackBranch: trackBranchAt,
                onCreateBranch: createBranch,
                t
              }),
              h(CommitBox, {
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
                t
              }),
              h(ChangesList, {
                status,
                loading: statusLoading && status === null,
                error: null,
                view: changesView,
                untrackedMode,
                selectedPath,
                onSelect: selectEntry,
                filter,
                onFilterChange: setFilter,
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
            selectedPath,
            onSelectFile: selectFile,
            filter,
            onFilterChange: setFilter,
            loadDir,
            dirtyPaths,
            t
          })
        }

        let rightPane
        if (mode === MODE.remote && openPull !== null) {
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
            onComment: commentPull,
            onMerge: mergePull,
            onChanged: () => loadPullDetail(openPull),
            onOpenUrl: openExternal,
            t
          })
        } else if (mode === MODE.remote) {
          rightPane = h(RemoteDetail, {
            selection: remoteSelection,
            detail: remoteDetail,
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
          if (selection === null) {
            // 和 DiffView 用同一个容器壳，空态与有内容时的几何完全一致（居中，不贴左上角）
            rightPane = h('div', { className: 'dgp-viewer' },
              h(EmptyState, {
                icon: 'file-diff',
                title: t('viewer.placeholderDiff'),
                description: activeRoot === null ? t('status.noRootsHint') : undefined,
                t
              }))
          } else {
            rightPane = h(DiffView, {
              diff,
              loading: diffLoading,
              error: diffError,
              path: selection.path,
              entry: selection.entry,
              view: diffView,
              wrap: wrap === true && diffView === 'unified',
              onRetry: () => setDiffNonce((previous) => previous + 1),
              t
            })
          }
        } else if (selection === null) {
          rightPane = h('div', { className: 'dgp-viewer' },
            h(EmptyState, {
              icon: 'file',
              title: t('viewer.placeholder'),
              description: activeRoot === null ? t('status.noRootsHint') : undefined,
              t
            }))
        } else {
          const path = selection.path
          const draft = drafts.get(path)
          const conflict = saveState.conflict !== null && saveState.conflict !== undefined && saveState.conflict.path === path
            ? saveState.conflict
            : null
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
          icon: 'unified',
          label: t('toolbar.unified'),
          checked: diffView === 'unified',
          onClick: () => {
            setDiffView('unified')
            setMoreOpen(false)
          }
        }),
        h(MenuItem, {
          icon: 'split',
          label: t('toolbar.split'),
          checked: diffView === 'split',
          onClick: () => {
            setDiffView('split')
            setMoreOpen(false)
          }
        }),
        h(MenuItem, {
          icon: 'wrap',
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
          icon: 'filter',
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
          role: 'separator',
          'aria-orientation': 'vertical',
          'aria-valuenow': leftWidth,
          'data-dragging': dragging ? 'true' : undefined,
          tabIndex: 0,
          title: 'Drag to resize',
          onPointerDown: beginDrag,
          onKeyDown: (event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault()
              setLeftWidth(Math.max(MIN_LEFT, leftWidth - 16))
            } else if (event.key === 'ArrowRight') {
              event.preventDefault()
              setLeftWidth(leftWidth + 16)
            }
          }
        }),
        h('div', { className: 'dgp-pane-right' }, rightPane))

        let content
        if (noSession) {
          content = h(EmptyState, { icon: 'warning', title: t('status.noSession'), t })
        } else if (rootsLoading && roots.length === 0) {
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
            }, t('action.retry'))],
            t
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
            }, t('action.retry'))],
            t
          })
        } else {
          content = body
        }

        if (showSettings) {
          content = h(SettingsView, {
            models: settingsState.models,
            commitModel: settingsState.commitModel,
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
          'data-narrow': isNarrow ? 'true' : undefined,
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
              onClick: () => refreshStatus()
            }, t('action.retry')))
          : null,
        content,
        moreMenu)
      }

      Object.assign(exports, { Panel });

    });
    __define("./ui/Icon.js", (exports, module) => {
      /**
       * src/ui/Icon.js —— 内联 SVG 图标集
       *
       * 不依赖平台的 primitives 包（其导出名不稳定），自带一套 16×16 线性图标。
       * 只保留真正用到的图标；未知名字返回 null 并打印一次错误，不做"静默退回默认图标"。
       */
      const { h } = __m("./platform.js");

      /** 线性图标：name -> path 数组（16×16，1.5 描边）。 */
      const ICONS = {
        'chevron-right': ['M6 4l4 4-4 4'],
        'chevron-down': ['M4 6l4 4 4-4'],
        refresh: ['M13.5 8a5.5 5.5 0 1 1-1.6-3.9', 'M13.5 2.5V5H11'],
        'git-branch': ['M4 3v10', 'M4 6a3 3 0 0 1 3-3h3', 'M12 9a1.8 1.8 0 1 1 0 .01'],
        'git-merge': ['M4 13V3', 'M4 8a4 4 0 0 0 4 4h3', 'M12 4a1.8 1.8 0 1 1-.01.01'],
        file: ['M4 2h5l3 3v9H4z', 'M9 2v3h3'],
        'file-diff': ['M4 2h5l3 3v9H4z', 'M9 2v3h3', 'M6 8h4', 'M6 11h4'],
        folder: ['M2 4h4l1.5 2H14v7H2z'],
        'folder-open': ['M2 4h4l1.5 2H14v7H2z', 'M2 7h12'],
        check: ['M6 8.5l2 2 3-4'],
        'check-circle': ['M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z', 'M5.6 8.2l1.7 1.7 3-3.2'],
        close: ['M4 4l8 8', 'M12 4l-8 8'],
        plus: ['M8 3v10', 'M3 8h10'],
        minus: ['M3 8h10'],
        search: ['M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10z', 'M10.6 10.6L14 14'],
        warning: ['M8 2l6 11H2z', 'M8 6v3', 'M8 11h.01'],
        info: ['M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z', 'M8 7v4', 'M8 5h.01'],
        unified: ['M2 3h12v10H2z', 'M2 6h12', 'M2 9h12'],
        split: ['M2 3h12v10H2z', 'M8 3v10'],
        wrap: ['M2 4h12', 'M2 8h9a2 2 0 1 1 0 4H8', 'M10 10l-2 2 2 2'],
        trash: ['M3 5h10', 'M6 5V3h4v2', 'M4.5 5l.7 8h5.6l.7-8'],
        eye: ['M1.5 8S4 4 8 4s6.5 4 6.5 4S12 12 8 12 1.5 8 1.5 8z', 'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
        'eye-off': ['M1.5 8S4 4 8 4s6.5 4 6.5 4S12 12 8 12 1.5 8 1.5 8z', 'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M3 13L13 3'],
        clock: ['M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12z', 'M8 5v3.5L10.5 10'],
        filter: ['M2 3h12l-4.5 5.5V13L6 11.5V8.5z'],
        sync: ['M13.5 8a5.5 5.5 0 0 1-9.4 3.9', 'M4 12v-3h3', 'M2.5 8a5.5 5.5 0 0 1 9.4-3.9', 'M12 4v3h-3'],
        external: ['M9.5 3H13v3.5', 'M13 3L7.5 8.5', 'M11.5 9.5V13H3V4.5h3.5'],
        sparkle: ['M8 2l1.2 3.3L12.5 6.5 9.2 7.7 8 11 6.8 7.7 3.5 6.5 6.8 5.3z', 'M12.5 10l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z'],
        settings: ['M8 10.2a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4z', 'M8 1.8v1.6', 'M8 12.6v1.6', 'M3.2 3.2l1.1 1.1', 'M11.7 11.7l1.1 1.1', 'M1.8 8h1.6', 'M12.6 8h1.6', 'M3.2 12.8l1.1-1.1', 'M11.7 4.3l1.1-1.1']
      }

      /** 用实心圆点而不是描边的图标。 */
      const FILLED_DOTS = {
        more: [[3, 8], [8, 8], [13, 8]]
      }

      const warned = new Set()

      /**
       * 渲染一个图标。
       * @param {{name: string, size?: number, className?: string, title?: string}} props
       */
      function Icon(props) {
        const { name, size = 16, className = '', title } = props
        const filledDots = FILLED_DOTS[name]
        const paths = ICONS[name]

        if (filledDots === undefined && paths === undefined) {
          if (!warned.has(name)) {
            warned.add(name)
            // eslint-disable-next-line no-console
            console.error('[dsh-git-panel] 未知图标: ' + name)
          }
          return null
        }

        const children = filledDots === undefined
          ? paths.map((d, index) => h('path', { key: index, d }))
          : filledDots.map(([cx, cy], index) => h('circle', { key: index, cx, cy, r: 1.2 }))

        return h('svg', {
          className: 'dgp-ico ' + className,
          width: size,
          height: size,
          viewBox: '0 0 16 16',
          fill: filledDots === undefined ? 'none' : 'currentColor',
          stroke: filledDots === undefined ? 'currentColor' : undefined,
          strokeWidth: filledDots === undefined ? 1.5 : undefined,
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
          const viewportW = typeof window === 'undefined' ? 1024 : window.innerWidth
          const viewportH = typeof window === 'undefined' ? 768 : window.innerHeight
          const anchor = anchorRect
          const box = node === null ? { width: minWidth, height: 0 } : node.getBoundingClientRect()
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

      /** 菜单项。 */
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
            if (disabled !== true && typeof onClick === 'function') onClick(event)
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
       *   │     ├─ button.dgp-repo-branch[data-dgp-branch] ← 贴在行的最右侧；只有点它才打开分支菜单
       *   │     ├─ button.dgp-row-action[data-dgp-repo-hide]   ← 从储存库隐藏（项目本身不可隐藏）
       *   │     ├─ button.dgp-row-action[data-dgp-repo-unhide] ← 已隐藏的行：取消隐藏
       *   │     └─ button.dgp-row-action[data-dgp-repo-remove] ← 仅外部仓库：移除
       *   ├─ AddRootForm（展开时）
       *   └─ PopupMenu（分支菜单：切换已有分支，或输入名字创建并切过去）
       *
       * 分支菜单的取数、切换与创建都通过 props 交给 Panel：这里只负责交互与错误呈现，
       * 切换失败（例如本地改动会被覆盖）原样显示 git 的话，让用户自己决定怎么处理。
       */
      const { h, useState } = __m("./platform.js");
      const { Icon } = __m("./ui/Icon.js");
      const { MenuItem, MenuLabel, PopupMenu } = __m("./ui/Menu.js");
      const { AddRootForm } = __m("./components/AddRootForm.js");
      const { stripWrappingQuotes } = __m("./util/paths.js");

      function RepoList(props) {
        const source = props
        const translate = source.t
        const roots = Array.isArray(source.roots) ? source.roots : []
        const activeRootId = typeof source.activeRootId === 'string' ? source.activeRootId : null
        const open = source.open !== false
        const [formOpen, setFormOpen] = useState(false)
        /** 已隐藏的仓库默认收起；这里只记「要不要放出来看」，持久化的是隐藏列表本身。 */
        const [showHidden, setShowHidden] = useState(false)
        // 分支菜单：{ root, rect, list, loading, switching, creating, name, error }
        const [branchMenu, setBranchMenu] = useState(null)

        if (roots.length === 0) return null

        const visibleRoots = roots.filter((root) => root.hidden !== true)
        const hiddenRoots = roots.filter((root) => root.hidden === true)
        const listedRoots = showHidden ? visibleRoots.concat(hiddenRoots) : visibleRoots

        const closeForm = () => setFormOpen(false)
        const closeBranches = () => setBranchMenu(null)

        const loadBranches = (root, rect) => {
          setBranchMenu({ root, rect, list: [], loading: true, switching: null, creating: false, fetching: false, name: '', error: null })
          Promise.resolve(source.onLoadBranches(root))
            .then((value) => {
              setBranchMenu((previous) => (previous === null || previous.root.id !== root.id
                ? previous
                : { ...previous, list: value.branches, loading: false }))
            })
            .catch((error) => {
              setBranchMenu((previous) => (previous === null || previous.root.id !== root.id
                ? previous
                : { ...previous, loading: false, error: error && error.message ? error.message : String(error) }))
            })
        }

        const chooseBranch = (menu, name) => {
          setBranchMenu({ ...menu, switching: name, error: null })
          Promise.resolve(source.onSwitchBranch(menu.root, name))
            .then(() => setBranchMenu(null))
            .catch((error) => {
              setBranchMenu((previous) => (previous === null
                ? previous
                : { ...previous, switching: null, error: error && error.message ? error.message : String(error) }))
            })
        }

        /** 拉取远程更新（git fetch）后重读分支列表：别人新推的分支这时才会出现。 */
        const fetchRemote = (menu) => {
          if (typeof source.onFetchBranches !== 'function') return
          setBranchMenu({ ...menu, fetching: true, error: null })
          Promise.resolve(source.onFetchBranches(menu.root))
            .then((value) => {
              setBranchMenu((previous) => (previous === null
                ? previous
                : { ...previous, fetching: false, list: value.branches, loading: false }))
            })
            .catch((error) => {
              setBranchMenu((previous) => (previous === null
                ? previous
                : { ...previous, fetching: false, error: error && error.message ? error.message : String(error) }))
            })
        }

        /** 「仅远程」的分支：建本地跟踪分支并切过去。 */
        const trackBranch = (menu, branch) => {
          setBranchMenu({ ...menu, switching: branch.ref, error: null })
          Promise.resolve(source.onTrackBranch(menu.root, branch))
            .then(() => setBranchMenu(null))
            .catch((error) => {
              setBranchMenu((previous) => (previous === null
                ? previous
                : { ...previous, switching: null, error: error && error.message ? error.message : String(error) }))
            })
        }

        const changeCreateName = (value) => {
          setBranchMenu((previous) => (previous === null ? previous : { ...previous, name: value, error: null }))
        }

        const createBranch = (menu) => {
          const name = stripWrappingQuotes(menu.name)
          if (name === '' || menu.creating === true || menu.switching !== null) return
          setBranchMenu({ ...menu, name, creating: true, error: null })
          Promise.resolve(source.onCreateBranch(menu.root, name))
            .then(() => setBranchMenu(null))
            .catch((error) => {
              setBranchMenu((previous) => (previous === null
                ? previous
                : { ...previous, creating: false, error: error && error.message ? error.message : String(error) }))
            })
        }

        const menuBranches = branchMenu === null ? [] : branchMenu.list
        /** 副标题只留会变化的信息：↑n ↓m，或上游被删 */
        const branchMeta = (branch) => {
          const parts = []
          if (branch.upstreamGone === true) parts.push(translate('branch.upstreamGone'))
          if (typeof branch.ahead === 'number' && branch.ahead > 0) parts.push('↑' + branch.ahead)
          if (typeof branch.behind === 'number' && branch.behind > 0) parts.push('↓' + branch.behind)
          return parts.join(' ')
        }
        const branchBadges = (branch) => [
          { label: translate('branch.localTag'), active: branch.local === true },
          { label: translate('branch.remoteTag'), active: branch.remote !== null && branch.remote !== undefined }
        ]

        const menuBusy = branchMenu !== null && (branchMenu.switching !== null || branchMenu.creating === true || branchMenu.fetching === true)
        const createName = branchMenu === null ? '' : stripWrappingQuotes(branchMenu.name)
        const branchMenuNode = branchMenu === null
          ? null
          : h(PopupMenu, { open: true, anchorRect: branchMenu.rect, onClose: closeBranches, minWidth: 240 },
            h(MenuLabel, null, translate('branch.title', { name: branchMenu.root.name })),
            h(MenuItem, {
              icon: 'sync',
              label: branchMenu.fetching === true ? translate('branch.fetching') : translate('branch.fetch'),
              disabled: menuBusy,
              dataKey: 'fetch-branches',
              onClick: () => fetchRemote(branchMenu)
            }),
            h('div', { className: 'dgp-menu-sep', role: 'separator' }),
            branchMenu.loading ? h(MenuLabel, null, translate('branch.loading')) : null,
            menuBranches.map((branch) => h(MenuItem, {
              key: branch.name,
              label: branch.name,
              badges: branchBadges(branch),
              sub: branchMeta(branch),
              checked: branch.current,
              disabled: menuBusy,
              dataKey: 'branch:' + branch.name,
              // 只有远程的行：点一下在本地创建并切过去（不写长文案，放 title 里）
              title: branch.local !== true ? translate('branch.trackHint', { ref: branch.remote + '/' + branch.name }) : undefined,
              onClick: () => {
                if (branch.current) closeBranches()
                else if (branch.local === true) chooseBranch(branchMenu, branch.name)
                else trackBranch(branchMenu, branch)
              }
            })),
            branchMenu.list.length === 0 && branchMenu.loading !== true
              ? h(MenuLabel, null, translate('branch.empty'))
              : null,
            h('div', { className: 'dgp-menu-sep', role: 'separator' }),
            h('form', {
              className: 'dgp-branch-create',
              'data-dgp-branch-create': 'true',
              onSubmit: (event) => {
                event.preventDefault()
                createBranch(branchMenu)
              }
            },
            h('input', {
              className: 'dgp-input',
              'data-dgp-branch-name': 'true',
              value: branchMenu.name,
              placeholder: translate('branch.createPlaceholder'),
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
              title: translate('branch.create')
            }, translate('branch.create'))),
            branchMenu.switching === null
              ? null
              : h(MenuLabel, null, translate('branch.switching', { name: branchMenu.switching })),
            branchMenu.creating !== true
              ? null
              : h(MenuLabel, null, translate('branch.creating', { name: createName })),
            branchMenu.error === null
              ? null
              : h(MenuLabel, null, translate('branch.failed', { message: branchMenu.error })))

        return h('div', { className: 'dgp-repolist', 'data-dgp-repolist': 'true' },
          h('div', { className: 'dgp-repolist-head' },
            h('button', {
              type: 'button',
              className: 'dgp-repolist-toggle',
              'data-dgp-repolist-toggle': 'true',
              'data-open': open ? 'true' : 'false',
              'aria-expanded': open,
              onClick: () => {
                if (typeof source.onToggleOpen === 'function') source.onToggleOpen()
              }
            },
            h('span', { className: 'dgp-caret', 'data-open': open ? 'true' : 'false' },
              h(Icon, { name: 'chevron-right', size: 12 })),
            h('span', { className: 'dgp-repolist-title' }, translate('roots.title')),
            h('span', { className: 'dgp-group-count' }, String(visibleRoots.length))),
            hiddenRoots.length === 0
              ? null
              : h('button', {
                type: 'button',
                className: 'dgp-iconbtn',
                style: { width: 22, height: 22, gap: 2 },
                'data-dgp-repolist-hidden': showHidden ? 'true' : 'false',
                'aria-pressed': showHidden,
                title: translate(showHidden ? 'roots.hiddenCollapse' : 'roots.hiddenShow', { count: hiddenRoots.length }),
                'aria-label': translate(showHidden ? 'roots.hiddenCollapse' : 'roots.hiddenShow', { count: hiddenRoots.length }),
                onClick: () => setShowHidden((previous) => !previous)
              },
              h(Icon, { name: showHidden ? 'eye-off' : 'eye', size: 13 }),
              h('span', { className: 'dgp-repolist-hidden-count' }, String(hiddenRoots.length))),
            h('button', {
              type: 'button',
              className: 'dgp-iconbtn',
              style: { width: 22, height: 22 },
              'data-action': 'add-root',
              title: translate('toolbar.addRoot'),
              'aria-label': translate('toolbar.addRoot'),
              onClick: () => setFormOpen((previous) => !previous)
            }, h(Icon, { name: 'plus', size: 13 }))),

          open
            ? h('ul', { className: 'dgp-level dgp-repolist-rows', role: 'none' },
              listedRoots.map((root) => {
                const hidden = root.hidden === true
                const hasBranch = typeof root.branch === 'string' && root.branch !== ''
                return h('li', { key: root.id, className: 'dgp-item' },
                  h('div', { className: 'dgp-row-wrap' },
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
                        if (typeof source.onSelect === 'function') source.onSelect(root)
                      }
                    },
                    h(Icon, { name: 'git-branch', size: 13 }),
                    h('span', { className: 'dgp-name dgp-oneline' }, root.name)),
                    // 隐藏的行不提供分支菜单：它不参与切换，点开也只会让人以为切过去了
                    hidden
                      ? null
                      : h('button', {
                        type: 'button',
                        className: 'dgp-repo-branch dgp-oneline',
                        'data-dgp-branch': root.id,
                        title: translate('branch.hint', { branch: hasBranch ? root.branch : translate('root.noBranch') }),
                        onClick: (event) => {
                          event.stopPropagation()
                          loadBranches(root, event.currentTarget.getBoundingClientRect())
                        }
                      }, hasBranch ? root.branch : translate('root.noBranch')),
                    root.kind === 'primary'
                      ? null
                      : h('button', {
                        type: 'button',
                        className: 'dgp-row-action',
                        'data-dgp-repo-hide': root.id,
                        title: translate('roots.hide', { name: root.name }),
                        'aria-label': translate('roots.hide', { name: root.name }),
                        onClick: (event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          if (typeof source.onHide === 'function') source.onHide(root)
                        }
                      }, h(Icon, { name: 'eye-off', size: 13 })),
                    hidden
                      ? h('button', {
                        type: 'button',
                        className: 'dgp-row-action',
                        'data-dgp-repo-unhide': root.id,
                        title: translate('roots.unhide', { name: root.name }),
                        'aria-label': translate('roots.unhide', { name: root.name }),
                        onClick: (event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          if (typeof source.onUnhide === 'function') source.onUnhide(root)
                        }
                      }, h(Icon, { name: 'eye', size: 13 }))
                      : null,
                    root.kind === 'extra'
                      ? h('button', {
                        type: 'button',
                        className: 'dgp-row-action',
                        'data-dgp-repo-remove': root.id,
                        title: translate('toolbar.removeRoot', { name: root.name }),
                        'aria-label': translate('toolbar.removeRoot', { name: root.name }),
                        onClick: (event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          if (typeof source.onRemove === 'function') source.onRemove(root)
                        }
                      }, h(Icon, { name: 'trash', size: 13 }))
                      : null))
              })
            )
            : null,

          open && formOpen
            ? h(AddRootForm, {
              t: translate,
              onCancel: closeForm,
              onAdd: async (dir) => {
                if (typeof source.onAdd !== 'function') return
                await source.onAdd(dir)
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
      const { h, useCallback, useState } = __m("./platform.js");
      const { stripWrappingQuotes } = __m("./util/paths.js");

      function AddRootForm(props) {
        const source = props
        const translate = source.t
        const onAdd = typeof source.onAdd === 'function' ? source.onAdd : null
        const onCancel = typeof source.onCancel === 'function' ? source.onCancel : null

        const [value, setValue] = useState('')
        const [error, setError] = useState(null)
        const [submitting, setSubmitting] = useState(false)

        const submit = useCallback(async () => {
          // 粘贴「复制为路径」会带引号，先剥掉再提交
          const dir = stripWrappingQuotes(value)
          if (dir === '' || onAdd === null) return
          setSubmitting(true)
          setError(null)
          try {
            await onAdd(dir)
            setValue('')
          } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure))
          } finally {
            setSubmitting(false)
          }
        }, [value, onAdd])

        return h('div', { className: 'dgp-addform', 'data-dgp-addform': 'true' },
          h('input', {
            className: 'dgp-input',
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
                if (onCancel !== null) onCancel()
              }
            }
          }),
          h('div', { className: 'dgp-hint' }, translate('root.addHint')),
          error === null ? null : h('div', { className: 'dgp-note', 'data-tone': 'error' }, error),
          h('div', { className: 'dgp-addform-actions' },
            onCancel === null
              ? null
              : h('button', {
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
              disabled: submitting || stripWrappingQuotes(value) === '',
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
       * 典型输入来自资源管理器的「复制为路径」：`"H:\invitation-system-backend"`。
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
       * 那里可以在 Node 里单测（见 `test/tree.test.mjs`）。
       */
      const { h, useEffect, useMemo, useRef, useState } = __m("./platform.js");
      const { Icon, StatusLetter } = __m("./ui/Icon.js");
      const { basename, dirname, formatCount } = __m("./util/paths.js");
      const { ancestorsFor, buildGroupRows, buildListRows, countFilesUnder, filterEntries, groupChanges, groupActionOf, rowActionOf } = __m("./util/changes.js");
      const { EmptyState, InlineNote, SkeletonRows } = __m("./components/States.js");

      /** 把 props 里可能出现的各种 error 形状收敛成一个字符串或 null。 */
      function toErrorText(error) {
        if (error === null || error === undefined || error === '') return null
        if (typeof error === 'string') return error
        if (typeof error.message === 'string' && error.message !== '') return error.message
        return String(error)
      }

      function ChangesList(props) {
        const source = props
        const status = source.status === undefined ? null : source.status
        const loading = source.loading === true
        const selectedPath = typeof source.selectedPath === 'string' && source.selectedPath !== ''
          ? source.selectedPath
          : null
        const filter = typeof source.filter === 'string' ? source.filter : ''
        const collapsedGroups = source.collapsedGroups !== null && typeof source.collapsedGroups === 'object'
          ? source.collapsedGroups
          : null
        const onSelect = typeof source.onSelect === 'function' ? source.onSelect : null
        const onToggleGroup = typeof source.onToggleGroup === 'function' ? source.onToggleGroup : null
        const onStage = typeof source.onStage === 'function' ? source.onStage : null
        const onStageGroup = typeof source.onStageGroup === 'function' ? source.onStageGroup : null
        const pendingPath = typeof source.pendingPath === 'string' && source.pendingPath !== ''
          ? source.pendingPath
          : null
        const pendingGroup = typeof source.pendingGroup === 'string' && source.pendingGroup !== ''
          ? source.pendingGroup
          : null
        /** 显示方式：list = 一行一个文件（文件名 + 弱化路径）；tree = 按文件夹展开。 */
        const view = source.view === 'tree' ? 'tree' : 'list'
        /** 未跟踪文件：merge = 并进「未暂存」，separate = 单列一组。 */
        const untrackedMode = source.untrackedMode === 'separate' ? 'separate' : 'merge'
        const translate = source.t
        // 注意：`onFilterChange` 归 Panel 管（它渲染筛选输入框），这里只消费 `filter`。

        const errorText = toErrorText(source.error)
        const files = status !== null && status !== undefined && Array.isArray(status.files) ? status.files : []

        const [expanded, setExpanded] = useState(() => new Set())
        const [cursor, setCursor] = useState(-1)
        const rowRefs = useRef([])
        const wantFocusRef = useRef(false)

        /* ------------------------------ 派生数据 ------------------------------ */

        const filteredFiles = useMemo(() => filterEntries(files, filter), [files, filter])
        const groups = useMemo(() => groupChanges(filteredFiles, { untrackedMode }), [filteredFiles, untrackedMode])

        /** 分组可见性 + 每组要渲染的行（含固定顺序的扁平序号基数）。 */
        const layout = useMemo(() => {
          const out = []
          let offset = 0
          for (const group of groups) {
            const open = !(collapsedGroups !== null && collapsedGroups[group.key] === true)
            let rows = []
            if (open) {
              rows = view === 'tree'
                ? buildGroupRows(group.entries, (dirPath) => expanded.has(dirPath))
                : buildListRows(group.entries)
            }
            out.push({ key: group.key, entries: group.entries, open, rows, offset })
            if (open) offset += rows.length
          }
          return out
        }, [groups, collapsedGroups, expanded, view])

        /** 键盘光标走查的扁平行序列（跨分组：冲突 → 已暂存 → 未暂存 → 未跟踪）。 */
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

        /* ------------------------------ 副作用 ------------------------------ */

        // 把选中文件的目录链自动展开，保证选中项可见（Panel 可能在外部改 selectedPath）。
        // 列表模式没有目录行，不需要展开任何东西。
        useEffect(() => {
          if (view !== 'tree') return
          if (selectedPath === null) return
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
          if (index >= 0) setCursor(index)
        }, [selectedPath, flatRows])

        // 行数变少（折叠分组 / 过滤）时收敛光标。
        useEffect(() => {
          setCursor((previous) => (previous >= flatRows.length ? flatRows.length - 1 : previous))
        }, [flatRows.length])

        // 光标行滚进可视区；键盘移动时顺带把真实焦点也移过去（Enter 由原生 click 处理）。
        useEffect(() => {
          const element = rowRefs.current[cursor]
          if (element === null || element === undefined) return
          try {
            if (typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest' })
          } catch {
            /* 老宿主/测试环境里没有 scrollIntoView，忽略 */
          }
          if (wantFocusRef.current) {
            wantFocusRef.current = false
            try {
              if (typeof element.focus === 'function') element.focus()
            } catch {
              /* 忽略 */
            }
          }
        }, [cursor])

        /* ------------------------------ 交互 ------------------------------ */

        const toggleDirPath = (dirPath) => {
          setExpanded((previous) => {
            const next = new Set(previous)
            if (next.has(dirPath)) next.delete(dirPath)
            else next.add(dirPath)
            return next
          })
        }

        const selectRow = (row, groupKey) => {
          if (row === null || row === undefined || onSelect === null) return
          const node = row.node
          const entry = node !== null && node !== undefined && node.entry !== undefined ? node.entry : null
          if (entry === null || entry === undefined) return
          onSelect(entry, groupKey)
        }

        const consume = (event) => {
          try {
            event.preventDefault()
            event.stopPropagation()
          } catch {
            /* 忽略 */
          }
        }

        const handleKeyDown = (event) => {
          if (event === null || event === undefined || typeof event.key !== 'string') return
          const container = event.currentTarget
          const target = event.target
          const onContainer = target !== null && target !== undefined && target === container
          const inside = !onContainer
            && container !== null && container !== undefined
            && typeof container.contains === 'function'
            && target !== null && target !== undefined
            && container.contains(target)
          // 只在「列表自身」范围内响应按键，绝不抢 Panel 的全局快捷键。
          if (!onContainer && !inside) return

          const key = event.key
          const total = flatRows.length

          if (key === 'ArrowDown') {
            consume(event)
            if (total === 0) return
            wantFocusRef.current = true
            setCursor((previous) => {
              if (previous < 0 || previous >= total) return 0
              return Math.min(previous + 1, total - 1)
            })
            return
          }

          if (key === 'ArrowUp') {
            consume(event)
            if (total === 0) return
            wantFocusRef.current = true
            setCursor((previous) => {
              if (previous <= 0) return 0
              return Math.min(previous - 1, total - 1)
            })
            return
          }

          if (key === 'Enter') {
            // 行上的 Enter 交给原生 button click（避免重复 onSelect）。
            if (!onContainer) return
            const item = flatRows[cursor]
            if (item === undefined) return
            consume(event)
            if (item.row.kind === 'file') selectRow(item.row, item.group)
            else toggleDirPath(item.row.path)
            return
          }

          if (key === 'ArrowRight' || key === 'ArrowLeft') {
            const item = flatRows[cursor]
            if (item === undefined || item.row.kind !== 'dir') return
            const open = expanded.has(item.row.path)
            if (key === 'ArrowRight' && !open) {
              consume(event)
              toggleDirPath(item.row.path)
            } else if (key === 'ArrowLeft' && open) {
              consume(event)
              toggleDirPath(item.row.path)
            }
          }
        }

        /* ------------------------------ 渲染 ------------------------------ */

        const renderRow = (group, row, index) => {
          const depth = typeof row.depth === 'number' && row.depth > 0 ? row.depth : 0
          const style = { '--dgp-depth': depth }
          const isActive = selectedPath !== null && row.path === selectedPath
          const isCursor = cursor === index
          const displayName = typeof row.displayName === 'string' && row.displayName !== ''
            ? row.displayName
            : basename(row.path)
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
              key: index,
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
                setCursor(index)
                toggleDirPath(row.path)
              }
            },
            h('span', { className: 'dgp-caret', 'data-open': open ? 'true' : 'false' },
              h(Icon, { name: 'chevron-right', size: 12 })),
            h(Icon, { name: open ? 'folder-open' : 'folder', size: 14 }),
            h('span', { className: 'dgp-name dgp-name-dir dgp-oneline' }, displayName),
            count > 0 ? h('span', { className: 'dgp-meta' }, formatCount(count)) : null))
          }

          const entry = row.node !== null && row.node !== undefined && row.node.entry !== undefined
            ? row.node.entry
            : null
          const parent = dirname(row.path)
          const adds = entry !== null && entry !== undefined && typeof entry.adds === 'number' ? entry.adds : -1
          const dels = entry !== null && entry !== undefined && typeof entry.dels === 'number' ? entry.dels : -1
          const counts = []
          if (adds > 0) {
            counts.push(h('span', { key: 'add', className: 'dgp-add' }, translate('viewer.adds', { count: formatCount(adds) })))
          }
          if (dels > 0) {
            counts.push(h('span', { key: 'del', className: 'dgp-del' }, translate('viewer.dels', { count: formatCount(dels) })))
          }

          // 行尾操作只由所在分组决定：已暂存 = 取消暂存，未暂存/未跟踪 = 暂存，冲突不给按钮。
          const action = rowActionOf(group.key)
          const busy = pendingPath !== null && pendingPath === row.path
          const actionButton = action === null || onStage === null
            ? null
            : h('button', {
              type: 'button',
              className: 'dgp-row-action',
              'data-dgp-action': action,
              'data-busy': busy ? 'true' : undefined,
              disabled: busy,
              title: translate(action === 'stage' ? 'row.stage' : 'row.unstage'),
              'aria-label': translate(action === 'stage' ? 'row.stage' : 'row.unstage'),
              onClick: (event) => {
                if (event !== null && event !== undefined) {
                  event.preventDefault()
                  event.stopPropagation()
                }
                onStage(row.path, action)
              }
            }, h(Icon, { name: action === 'stage' ? 'plus' : 'minus', size: 13 }))

          return h('li', {
            key: index,
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
                setCursor(index)
                selectRow(row, group.key)
              }
            },
            entry !== null && entry !== undefined
              ? h(StatusLetter, { status: entry.status })
              : null,
            h('span', { className: 'dgp-name dgp-oneline' }, displayName),
            parent === '' ? null : h('span', { className: 'dgp-sub dgp-oneline' }, parent),
            counts.length === 0 ? null : h('span', { className: 'dgp-meta' }, counts)),
            actionButton))
        }

        const renderGroup = (group) => {
          const action = groupActionOf(group.key, untrackedMode)
          const busy = pendingGroup !== null && pendingGroup === action
          const actionButton = action === null || onStageGroup === null
            ? null
            : h('button', {
              type: 'button',
              className: 'dgp-group-action',
              'data-dgp-group-action': action,
              'data-busy': busy ? 'true' : undefined,
              disabled: busy,
              title: translate(action === 'unstage' ? 'group.unstageAll' : 'group.stageAll'),
              'aria-label': translate(action === 'unstage' ? 'group.unstageAll' : 'group.stageAll'),
              onClick: (event) => {
                if (event !== null && event !== undefined) {
                  event.preventDefault()
                  event.stopPropagation()
                }
                onStageGroup(action)
              }
            }, h(Icon, { name: action === 'unstage' ? 'minus' : 'plus', size: 13 }))
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
                if (onToggleGroup !== null) onToggleGroup(group.key)
              }
            },
            h('span', { className: 'dgp-group-caret', 'data-open': group.open ? 'true' : 'false' },
              h(Icon, { name: 'chevron-right', size: 12 })),
            h('span', { className: 'dgp-group-title' }, translate('group.' + group.key)),
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
          'aria-label': translate('mode.changes'),
          'data-dgp-list': 'changes',
          'data-view': view,
          onKeyDown: handleKeyDown
        }, children)

        /* --- 状态分支（没有 status：加载 / 出错 / 无仓库） --- */
        if (status === null || status === undefined) {
          if (errorText !== null) {
            return container(h(InlineNote, { tone: 'error' }, translate('error.generic', { message: errorText })))
          }
          if (loading) return container(h(SkeletonRows, { rows: 6 }))
          return container(h(EmptyState, {
            icon: 'git-branch',
            title: translate('status.noRoots'),
            description: translate('status.noRootsHint'),
            t: translate
          }))
        }

        /* --- 工作区干净 --- */
        if (files.length === 0) {
          return container(h(EmptyState, {
            icon: 'check-circle',
            title: translate('status.clean'),
            description: translate('status.cleanHint'),
            t: translate
          }))
        }

        /* --- 有改动，但被过滤词筛空了 --- */
        if (groups.length === 0) {
          if (filter === '') {
            return container(h(EmptyState, {
              icon: 'check-circle',
              title: translate('status.clean'),
              description: translate('status.cleanHint'),
              t: translate
            }))
          }
          return container(h(EmptyState, {
            icon: 'search',
            title: translate('status.emptyFilter', { filter }),
            t: translate
          }))
        }

        // 注意：status 有值时的 statusError 由 Panel 统一渲染（避免重复提示），这里只在「没有 status」时自己提示。
        return container(layout.map((group) => renderGroup(group)))
      }

      Object.assign(exports, { ChangesList });

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
        const list = Array.isArray(entries) ? entries : []
        return list.length === 1 ? list[0] : null
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
       * status 刷新后校正当前选中项。
       *
       * 选中项有两种语义，不能混为一谈：
       *  · 来自变更列表（`entry !== null`）——代表"某个变更"。文件从 status 里消失（被还原/被提交）
       *    就该清掉选中；还在就换成最新一次 status 里的 entry（diff 会据此重取）。
       *  · 来自文件浏览树（`entry === null`）——代表"某个路径"。它跟 status 无关（未修改的文件本来
       *    就不在 status.files 里），所以刷新时必须原样返回，否则会凭空清空正在浏览的文件。
       *
       * @param {{path: string, entry: object|null, side: string}|null} selection
       * @param {Array<object>} files status.files
       * @returns {object|null} 新的选中项，或 null（该清空）
       */
      function reconcileSelection(selection, files) {
        if (selection === null) return null
        if (selection.entry === null) return selection
        const entry = files.find((file) => file.path === selection.path)
        if (entry === undefined) return null
        return { path: entry.path, entry, side: selection.side }
      }
      Object.assign(exports, { GROUP_ORDER, UNTRACKED_MODES, groupsOfFile, groupChanges, rowActionOf, groupActionOf, singleFileShortcut, normalizeRelPath, childPath, matchesEntry, filterEntries, buildGroupRows, buildListRows, ancestorsFor, countFilesUnder, orderTreeEntries, reconcileSelection });

    });
    __define("./components/States.js", (exports, module) => {
      /**
       * src/components/States.js —— 空 / 加载 / 错误 / 骨架 / 行内提示
       *
       * 结构一律按 CONTRACT.md §5 的 class 词汇表输出，样式全部由 src/styles.js 提供。
       * 文案全部走 `t('key')`；`t` 由宿主传入，缺了就是调用方的 bug（直接抛错，不静默降级）。
       *
       * props 契约（CONTRACT.md §3）：
       *   EmptyState({ icon, title, description, actions, t })
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
       */
      function EmptyState(props) {
        const { icon, title, description, actions } = props
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
       * 每个请求一个 AbortController：根切换 / 卸载时全部 abort，晚到的响应不会再写回缓存。
       *
       * 注意：`onFilterChange` 由 Panel 消费（它渲染筛选输入框），这里只读 `filter`。
       */
      const { h, useEffect, useMemo, useRef, useState } = __m("./platform.js");
      const { Icon } = __m("./ui/Icon.js");
      const { basename, matchesFilter, parentChain } = __m("./util/paths.js");
      const { childPath, orderTreeEntries } = __m("./util/changes.js");
      const { describeError } = __m("./api.js");
      const { EmptyState, InlineNote } = __m("./components/States.js");

      function messageOf(error, translate) {
        const text = describeError(error, translate)
        return typeof text === 'string' && text !== '' ? text : translate('error.generic', { message: '' })
      }

      function FileTree(props) {
        const source = props
        const rootPath = typeof source.rootPath === 'string' && source.rootPath !== '' ? source.rootPath : null
        const selectedPath = typeof source.selectedPath === 'string' && source.selectedPath !== ''
          ? source.selectedPath
          : null
        const filter = typeof source.filter === 'string' ? source.filter : ''
        const onSelectFile = typeof source.onSelectFile === 'function' ? source.onSelectFile : null
        const loadDir = typeof source.loadDir === 'function' ? source.loadDir : null
        const translate = source.t
        /** 有未保存改动的文件路径集合（文件模式编辑器草稿）。 */
        const dirtyPaths = source.dirtyPaths instanceof Set ? source.dirtyPaths : null

        const hasRoot = rootPath !== null

        /** relPath -> { status:'loading'|'ok'|'failed', entries, truncated, message } */
        const levelsRef = useRef(new Map())
        /** relPath -> AbortController */
        const controllersRef = useRef(new Map())
        /** 根切换的世代号：晚到的响应据此丢弃。 */
        const generationRef = useRef(0)
        const rootRef = useRef(rootPath)
        const rowRefs = useRef([])
        const wantFocusRef = useRef(false)

        const [tick, setTick] = useState(0)
        const [expanded, setExpanded] = useState(() => new Set())
        const [cursor, setCursor] = useState(-1)

        const bump = () => setTick((value) => value + 1)

        /* ------------------------------ 取目录 ------------------------------ */

        function request(relPath) {
          const key = typeof relPath === 'string' ? relPath : ''
          const cached = levelsRef.current.get(key)
          if (cached !== undefined && (cached.status === 'loading' || cached.status === 'ok')) return
          if (loadDir === null) {
            levelsRef.current.set(key, { status: 'failed', entries: [], truncated: false, message: messageOf(null, translate) })
            bump()
            return
          }

          const previous = controllersRef.current.get(key)
          if (previous !== undefined && previous !== null && typeof previous.abort === 'function') {
            try {
              previous.abort()
            } catch {
              /* 忽略 */
            }
          }
          const controller = typeof AbortController === 'function' ? new AbortController() : null
          if (controller !== null) controllersRef.current.set(key, controller)
          const generation = generationRef.current
          const rootAtRequest = rootPath
          levelsRef.current.set(key, { status: 'loading', entries: [], truncated: false, message: null })
          bump()

          let pending
          try {
            pending = loadDir(key, controller === null ? undefined : controller.signal)
          } catch (error) {
            pending = Promise.reject(error)
          }

          Promise.resolve(pending).then((result) => {
            if (generation !== generationRef.current) return
            if (rootRef.current !== rootAtRequest) return
            if (controller !== null && controller.signal.aborted) return
            const entries = result !== null && result !== undefined && Array.isArray(result.entries)
              ? result.entries
              : []
            levelsRef.current.set(key, {
              status: 'ok',
              entries,
              truncated: result !== null && result !== undefined && result.truncated === true,
              message: null
            })
            controllersRef.current.delete(key)
            bump()
          }, (error) => {
            if (generation !== generationRef.current) return
            if (rootRef.current !== rootAtRequest) return
            if (controller !== null && controller.signal.aborted) return
            levelsRef.current.set(key, {
              status: 'failed',
              entries: [],
              truncated: false,
              message: messageOf(error, translate)
            })
            controllersRef.current.delete(key)
            bump()
          })
        }

        /* ------------------------------ 副作用 ------------------------------ */

        // 根变化：清缓存、abort 全部在途请求、重新读根目录；卸载时同样 abort。
        useEffect(() => {
          generationRef.current += 1
          rootRef.current = rootPath
          for (const controller of controllersRef.current.values()) {
            if (controller !== null && controller !== undefined && typeof controller.abort === 'function') {
              try {
                controller.abort()
              } catch {
                /* 忽略 */
              }
            }
          }
          controllersRef.current.clear()
          levelsRef.current.clear()
          setExpanded(new Set())
          setCursor(-1)
          if (hasRoot) request('')
          else setTick((value) => value + 1)
          return () => {
            generationRef.current += 1
            for (const controller of controllersRef.current.values()) {
              if (controller !== null && controller !== undefined && typeof controller.abort === 'function') {
                try {
                  controller.abort()
                } catch {
                  /* 忽略 */
                }
              }
            }
            controllersRef.current.clear()
            levelsRef.current.clear()
          }
          // eslint-disable-next-line -- 只跟随根变化
        }, [rootPath])

        // 任何「已展开但还没缓存」的目录都在渲染后补一次请求（展开、自动展开、重试都走这里）。
        useEffect(() => {
          if (!hasRoot || loadDir === null) return
          for (const dirPath of expanded) {
            if (dirPath === '') continue
            if (!levelsRef.current.has(dirPath)) request(dirPath)
          }
        })

        // 外部改 selectedPath 时，把它的祖先链展开（缺失的层级由上一条副作用加载）。
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
        function entryMatches(relPath, entry, guard) {
          const depth = typeof guard === 'number' ? guard : 0
          if (depth > 64) return false
          const rel = childPath(relPath, entry)
          const name = entry !== null && entry !== undefined && typeof entry.name === 'string' ? entry.name : ''
          if (matchesFilter(rel, filter) || matchesFilter(name, filter)) return true
          if (entry === null || entry === undefined || entry.type !== 'dir') return false
          const level = levelsRef.current.get(rel)
          if (level === undefined || level.status !== 'ok' || !Array.isArray(level.entries)) return false
          return level.entries.some((child) => entryMatches(rel, child, depth + 1))
        }

        /**
         * 把「已加载 + 已展开」的部分压成一个扁平行数组（深度优先）。
         * 不在 tree 里做虚拟列表：单侧栏规模下扁平数组最简单，也最好做键盘走查。
         */
        function collectLevel(relPath, depth, out) {
          const level = levelsRef.current.get(relPath)
          const baseKey = relPath === '' ? 'root' : relPath
          if (level === undefined || level.status === 'loading') {
            out.push({ kind: 'note', key: baseKey + ':loading', tone: 'info', text: translate('status.loading'), depth })
            return
          }
          if (level.status === 'failed') {
            out.push({ kind: 'note', key: baseKey + ':failed', tone: 'error', text: level.message, depth })
            return
          }

          const all = Array.isArray(level.entries) ? level.entries : []
          const visible = filter === '' ? all : all.filter((entry) => entryMatches(relPath, entry))
          const ordered = orderTreeEntries(visible)

          if (ordered.length === 0) {
            let text = null
            if (filter !== '') text = translate('status.emptyFilter', { filter })
            else text = translate('status.emptyDir')
            if (text !== null) out.push({ kind: 'note', key: baseKey + ':empty', tone: 'info', text, depth })
          }

          for (const entry of ordered) {
            const rel = childPath(relPath, entry)
            const type = entry !== null && entry !== undefined && entry.type === 'dir'
              ? 'dir'
              : (entry !== null && entry !== undefined && entry.type === 'file' ? 'file' : 'other')
            const name = entry !== null && entry !== undefined && typeof entry.name === 'string' && entry.name !== ''
              ? entry.name
              : basename(rel)
            if (type === 'dir') {
              const open = expanded.has(rel)
              out.push({ kind: 'dir', key: 'dir:' + rel, path: rel, name, depth, open })
              if (open) collectLevel(rel, depth + 1, out)
            } else {
              out.push({ kind: 'file', key: type + ':' + rel, path: rel, name, depth, other: type === 'other' })
            }
          }

          if (level.truncated === true) {
            out.push({ kind: 'note', key: baseKey + ':truncated', tone: 'info', text: translate('status.truncated'), depth })
          }
        }

        const rows = useMemo(() => {
          const out = []
          if (hasRoot) collectLevel('', 0, out)
          return out
          // eslint-disable-next-line -- tick 让 ref 缓存的变化进入依赖
        }, [hasRoot, rootPath, tick, expanded, filter, translate])

        const rootLevel = hasRoot ? levelsRef.current.get('') : undefined
        const rootFailed = rootLevel !== undefined && rootLevel !== null && rootLevel.status === 'failed'
        const rootReady = rootLevel !== undefined && rootLevel !== null && rootLevel.status === 'ok'
        const hasVisibleRows = rows.some((row) => row.kind === 'dir' || row.kind === 'file')
        const filterNote = filter !== '' ? translate('filter.loadedOnly') : null
        const filterEmpty = filter !== '' && rootReady && !hasVisibleRows

        /* ------------------------------ 副作用（光标） ------------------------------ */

        useEffect(() => {
          if (selectedPath === null) return
          const index = rows.findIndex((row) => row.kind === 'file' && row.path === selectedPath)
          if (index >= 0) setCursor(index)
        }, [selectedPath, rows])

        useEffect(() => {
          setCursor((previous) => (previous >= rows.length ? rows.length - 1 : previous))
        }, [rows.length])

        useEffect(() => {
          const element = rowRefs.current[cursor]
          if (element === null || element === undefined) return
          try {
            if (typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest' })
          } catch {
            /* 忽略 */
          }
          if (wantFocusRef.current) {
            wantFocusRef.current = false
            try {
              if (typeof element.focus === 'function') element.focus()
            } catch {
              /* 忽略 */
            }
          }
        }, [cursor, rows])

        /* ------------------------------ 交互 ------------------------------ */

        const toggleDir = (dirPath) => {
          setExpanded((previous) => {
            const next = new Set(previous)
            if (next.has(dirPath)) next.delete(dirPath)
            else next.add(dirPath)
            return next
          })
        }

        const openFile = (row) => {
          if (row === null || row === undefined || row.other === true || onSelectFile === null) return
          onSelectFile(row.path)
        }

        const consume = (event) => {
          try {
            event.preventDefault()
            event.stopPropagation()
          } catch {
            /* 忽略 */
          }
        }

        const handleKeyDown = (event) => {
          if (event === null || event === undefined || typeof event.key !== 'string') return
          const container = event.currentTarget
          const target = event.target
          const onContainer = target !== null && target !== undefined && target === container
          const inside = !onContainer
            && container !== null && container !== undefined
            && typeof container.contains === 'function'
            && target !== null && target !== undefined
            && container.contains(target)
          // 只在列表内部消费按键，绝不抢 Panel 的全局快捷键。
          if (!onContainer && !inside) return

          const key = event.key
          const total = rows.length

          if (key === 'ArrowDown') {
            consume(event)
            if (total === 0) return
            wantFocusRef.current = true
            setCursor((previous) => {
              if (previous < 0 || previous >= total) return 0
              return Math.min(previous + 1, total - 1)
            })
            return
          }

          if (key === 'ArrowUp') {
            consume(event)
            if (total === 0) return
            wantFocusRef.current = true
            setCursor((previous) => {
              if (previous <= 0) return 0
              return Math.min(previous - 1, total - 1)
            })
            return
          }

          if (key === 'Enter') {
            // 行上的 Enter 交给原生 button click，避免重复回调。
            if (!onContainer) return
            const row = rows[cursor]
            if (row === undefined || row.kind === 'note') return
            consume(event)
            if (row.kind === 'dir') toggleDir(row.path)
            else openFile(row)
            return
          }

          if (key === 'ArrowRight' || key === 'ArrowLeft') {
            const row = rows[cursor]
            if (row === undefined || row.kind !== 'dir') return
            if (key === 'ArrowRight' && !expanded.has(row.path)) {
              consume(event)
              toggleDir(row.path)
            } else if (key === 'ArrowLeft' && expanded.has(row.path)) {
              consume(event)
              toggleDir(row.path)
            }
          }
        }

        /* ------------------------------ 渲染 ------------------------------ */

        const renderRow = (row, index) => {
          const depth = typeof row.depth === 'number' && row.depth > 0 ? row.depth : 0

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
                setCursor(index)
                toggleDir(row.path)
              }
            },
            h('span', { className: 'dgp-caret', 'data-open': open ? 'true' : 'false' },
              h(Icon, { name: 'chevron-right', size: 12 })),
            h(Icon, { name: open ? 'folder-open' : 'folder', size: 14 }),
            h('span', { className: 'dgp-name dgp-name-dir dgp-oneline' }, row.name)))
          }

          const isActive = selectedPath !== null && row.path === selectedPath
          const dirty = dirtyPaths !== null && dirtyPaths.has(row.path) === true
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
              setCursor(index)
              openFile(row)
            }
          },
          h(Icon, { name: 'file', size: 14 }),
          h('span', { className: 'dgp-name dgp-oneline' }, row.name),
          dirty === true
            ? h('span', { className: 'dgp-dirty-dot', 'data-dirty': 'true', 'aria-label': translate('editor.unsaved') })
            : null))
        }

        const container = (children) => h('div', {
          className: 'dgp-list',
          role: 'tree',
          tabIndex: 0,
          'aria-label': translate('mode.files'),
          'data-dgp-list': 'files',
          onKeyDown: handleKeyDown
        }, children)

        /* --- 没有根：不崩，给空态 --- */
        if (!hasRoot) {
          return container(h(EmptyState, {
            icon: 'folder',
            title: translate('status.noRoots'),
            description: translate('status.noRootsHint'),
            t: translate
          }))
        }

        /* --- 根目录读取失败 --- */
        if (rootFailed) {
          return container(h(InlineNote, { tone: 'error' }, rootLevel.message))
        }

        /* --- 过滤后没有任何已加载的命中项 --- */
        if (filterEmpty) {
          return container([
            filterNote === null ? null : h(InlineNote, { key: 'filter-note', tone: 'info' }, filterNote),
            h(EmptyState, {
              key: 'empty',
              icon: 'search',
              title: translate('status.emptyFilter', { filter }),
              t: translate
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
        'model-failed': 'commit.generateFailed'
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

      /** 一个 PR 的详情（含平台能力与审查记录）。 */
      function remotePull(payload, options) {
        return call('remote/pull', payload, options)
      }

      /** 提交审查结论。 */
      function remotePullReview(payload, options) {
        return call('remote/pull/review', payload, options)
      }

      /** 标记 PR 测试通过（Gitee 的合并门禁之一）。 */
      function remotePullTest(payload, options) {
        return call('remote/pull/test', payload, options)
      }

      /** PR 的文件与 patch（AI 审阅的输入）。 */
      function remotePullDiff(payload, options) {
        return call('remote/pull/diff', payload, options)
      }

      /** 调审阅模型给出结构化结论。 */
      function remotePullAiReview(payload, options) {
        return call('remote/pull/ai-review', payload, options)
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

      /** 列出本地分支。 */
      function listBranches(payload, options) {
        return call('branches/list', payload, options)
      }

      /** 把「仅远程」的分支建成本地跟踪分支并切过去。 */
      function trackBranch(payload, options) {
        return call('branch/track', payload, options)
      }

      /** 切换分支（工作区怎么处理交给 git）。 */
      function switchBranch(payload, options) {
        return call('branch/switch', payload, options)
      }

      /** 从当前 HEAD 创建分支并立刻切过去。 */
      function createBranch(payload, options) {
        return call('branch/create', payload, options)
      }

      /** 提交：有暂存只提交暂存，没有则先全部暂存。 */
      function commitChanges(payload, options) {
        return call('commit', payload, options)
      }

      /** 按设置里的模型生成提交说明。 */
      function commitMessage(payload, options) {
        return call('commit/message', payload, { ...(options ?? {}), timeoutMs: options?.timeoutMs ?? 70_000 })
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

      Object.assign(exports, { call, resolveProject, readStatus, readDiff, readFile, fetchRemote, writeFile, stageFile, stageGroup, listAccounts, addAccount, updateAccount, readAccountToken, removeAccount, listRemoteRepos, remoteDetail, remotePullCounts, remotePull, remotePullReview, remotePullTest, remotePullDiff, remotePullAiReview, remotePullComment, remotePullPass, remotePullMerge, cloneRemoteRepo, hideRoot, unhideRoot, listBranches, trackBranch, switchBranch, createBranch, commitChanges, commitMessage, listModels, readSettings, writeSettings, listDirectory, addRoot, removeRoot, describeError });

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

      /** 宿主或测试没给 t() 时的降级：原样回显 key，绝不抛错。 */
      function missingT(key) {
        return String(key)
      }

      /** 空/加载/错误态用的图标节点（States.EmptyState 的 icon 是 React 节点）。 */
      function stateIcon(name) {
        return h(Icon, { name, size: 16 })
      }

      /** 取第一个合法数字（diff.stats > entry > 本地统计）。 */
      function firstNumber(first, second, fallback) {
        if (typeof first === 'number' && Number.isFinite(first)) return first
        if (typeof second === 'number' && Number.isFinite(second)) return second
        return typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : 0
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
        const { diff, loading, error, path, entry, view, wrap, onRetry, t: tProp } = props ?? {}
        const t = typeof tProp === 'function' ? tProp : missingT

        const split = view === 'split'
        const filePath = typeof path === 'string' ? path : ''
        const hasFile = filePath !== '' || (entry !== null && entry !== undefined)
        const hunks = diff !== null && diff !== undefined && Array.isArray(diff.hunks) ? diff.hunks : EMPTY_HUNKS

        const [expanded, setExpanded] = useState(false)
        const scrollRef = useRef(null)

        // 换文件 / 换布局：回到顶部并收起「全部展开」
        useEffect(() => {
          setExpanded(false)
        }, [filePath, view])

        useEffect(() => {
          const element = scrollRef.current
          if (element === null || element === undefined) return
          if (typeof element.scrollTo === 'function') element.scrollTo(0, 0)
          else element.scrollTop = 0
        }, [filePath, view])

        // 行构建 + 预算 + 词级高亮：只依赖 diff / view（以及本地的展开开关）
        const built = useMemo(() => {
          const source = diff !== null && diff !== undefined && Array.isArray(diff.hunks) ? diff.hunks : EMPTY_HUNKS
          const sourceRows = split ? buildSplitRows(source) : buildUnifiedRows(source)
          const budgeted = expanded
            ? { rows: sourceRows, truncatedCount: 0 }
            : budgetRows(sourceRows, MAX_DIFF_ROWS)
          return {
            rows: budgeted.rows,
            truncatedCount: budgeted.truncatedCount,
            marks: split ? buildSplitMarks(budgeted.rows) : buildUnifiedMarks(budgeted.rows)
          }
        }, [diff, view, expanded])

        const computedStats = diffStats(hunks)
        const diffAdds = diff !== null && diff !== undefined && diff.stats ? diff.stats.adds : undefined
        const diffDels = diff !== null && diff !== undefined && diff.stats ? diff.stats.dels : undefined
        const adds = firstNumber(diffAdds, entry ? entry.adds : undefined, computedStats.adds)
        const dels = firstNumber(diffDels, entry ? entry.dels : undefined, computedStats.dels)

        const keyBase = filePath + '|' + (split ? 'split' : 'unified')
        const regionLabel = t(split ? 'toolbar.split' : 'toolbar.unified')

        // ---- 头部：状态字母 + 文件名 + 父路径（+ 重命名来源）+ 计数 ----
        let headNode = null
        if (hasFile) {
          const headChildren = []
          if (entry !== null && entry !== undefined && entry.status) {
            headChildren.push(h(StatusLetter, { key: 'status', status: entry.status }))
          }
          const titleChildren = [
            h('span', { key: 'name', className: 'dgp-name dgp-oneline' }, basename(filePath))
          ]
          const parentPath = dirname(filePath)
          if (parentPath !== '') {
            titleChildren.push(h('span', { key: 'parent', className: 'dgp-viewer-sub dgp-oneline' }, parentPath))
          }
          if (entry !== null && entry !== undefined && typeof entry.oldPath === 'string' && entry.oldPath !== '') {
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

        if (error !== null && error !== undefined && error !== '') {
          bodyNode = h(ErrorState, { message: String(error), onRetry, t })
        } else if (loading === true && (diff === null || diff === undefined)) {
          bodyNode = h(LoadingState, { label: t('status.loadingDiff'), t })
        } else if (diff === null || diff === undefined) {
          bodyNode = h(EmptyState, {
            icon: stateIcon('file-diff'),
            title: t('viewer.placeholderDiff'),
            t
          })
        } else {
          const kind = typeof diff.kind === 'string' ? diff.kind : 'text'
          const message = typeof diff.message === 'string' ? diff.message : ''

          if (kind === 'binary') {
            bodyNode = h(EmptyState, { icon: stateIcon('file'), title: t('viewer.binary'), t })
          } else if (kind === 'oversized') {
            bodyNode = h(EmptyState, {
              icon: stateIcon('file'),
              title: t('viewer.oversized'),
              description: message !== '' ? message : undefined,
              t
            })
          } else if (kind === 'directory') {
            bodyNode = h(EmptyState, { icon: stateIcon('folder'), title: t('viewer.directory'), t })
          } else if (kind === 'submodule') {
            bodyNode = h(EmptyState, { icon: stateIcon('git-merge'), title: t('viewer.submodule'), t })
          } else if (kind === 'error') {
            bodyNode = h(ErrorState, {
              message: message !== '' ? message : t('error.generic', { message: '' }),
              onRetry,
              t
            })
          } else if (kind === 'deleted' && hunks.length === 0) {
            bodyNode = h(EmptyState, { icon: stateIcon('trash'), title: t('viewer.deletedFile'), t })
          } else if (hunks.length === 0) {
            const renamed = entry !== null && entry !== undefined
              && typeof entry.oldPath === 'string' && entry.oldPath !== ''
            let title = t('viewer.noChanges')
            if (renamed) title = t('viewer.renameOnly')
            else if (diff.newFile === true) title = t('viewer.newFile')
            bodyNode = h(EmptyState, {
              icon: stateIcon(diff.newFile === true ? 'plus' : 'file-diff'),
              title,
              description: message !== '' ? message : undefined,
              t
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
              content.push(truncatedNode(
                built.truncatedCount,
                'truncated',
                t,
                () => setExpanded(true)
              ))
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
              // data-wrap 同时挂两层，让 `.dgp-diff[data-wrap="true"]` 这类选择器都能命中。
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

        // 两个子节点分开传（而不是塞进数组），避免 React 要求数组 child 带 key
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
        return value === undefined || value === null || value === ''
      }

      /** 逻辑行数（结尾换行不算多一行）。 */
      function countLines(text) {
        if (text === '') return 1
        const breaks = text.split('\n').length
        return text.endsWith('\n') ? breaks - 1 : breaks
      }

      function formatSize(size) {
        if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return ''
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
            description: isBlank(sizeText) ? undefined : sizeText,
            t
          })
        }
        if (kind === 'directory') {
          return h(EmptyState, { icon: 'folder', title: t('viewer.directory'), t })
        }
        if (kind === 'missing') {
          return h(EmptyState, {
            icon: 'warning',
            title: t('viewer.missing'),
            description: isBlank(relPath) ? undefined : relPath,
            actions: retryAction(t, onRetry),
            t
          })
        }
        const message = record !== null && typeof record.message === 'string' && record.message !== ''
          ? record.message
          : t('viewer.placeholder')
        if (kind === 'error') return h(ErrorState, { message, onRetry, t })
        return h(EmptyState, {
          icon: 'info',
          title: message,
          description: isBlank(sizeText) ? undefined : sizeText,
          actions: retryAction(t, onRetry),
          t
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
        const providedText = props.text
        const text = typeof providedText === 'string'
          ? providedText
          : (record !== null && typeof record.text === 'string' ? record.text : null)
        const kind = record === null ? null : (typeof record.kind === 'string' ? record.kind : 'text')
        const name = relPath !== '' && relPath !== undefined ? basename(relPath) : ''
        const parent = relPath !== '' && relPath !== undefined ? dirname(relPath) : ''
        const sizeText = formatSize(record === null ? 0 : record.size)
        const lineCount = useMemo(() => (text === null ? 0 : countLines(text)), [text])
        const showGutter = wrap !== true && text !== null && lineCount <= MAX_GUTTER_LINES
        const gutterNumbers = useMemo(() => {
          if (showGutter !== true) return null
          const numbers = []
          for (let index = 1; index <= lineCount; index += 1) numbers.push(index)
          return numbers
        }, [showGutter, lineCount])

        const editable = text !== null && Boolean(loading) !== true && isBlank(error)

        const subParts = []
        if (text !== null && record !== null && typeof record.language === 'string' && record.language !== 'text') {
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

        const conflictBar = conflict === null || conflict === undefined
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

        const saveErrorBar = isBlank(saveError)
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
        if (Boolean(loading)) {
          body = h(LoadingState, { label: t('status.loading'), t })
        } else if (!isBlank(error)) {
          body = h(ErrorState, { message: String(error), onRetry, t })
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
       *   [ 提交说明（多行）                      ✦ ]
       *   [ 状态一行（提示 / 进度 / 结果）       提交 ]
       *
       * 设计要点：
       *  - **状态只有一行**，按「结果 > 生成中 > 提交中 > 无法提交的原因」取一个显示，
       *    所以成功/失败/进度都不会把下面的变更列表顶下去，也不会并排堆三条提示。
       *  - 提交按钮不可用时，状态行会说清**为什么**（没改动 / 没写说明），不做无声禁用。
       *  - 生成期间输入框禁用：模型结果会直接写进输入框，边等边打字再被覆盖是最糟的体验。
       *  - 输入框随内容长高：生成的说明常常有好几行，固定两行会让用户只能看到尾巴；
       *    长到上限就停止长高、改为滚动，不会把下面的列表挤没。
       */
      const { h, useEffect, useRef } = __m("./platform.js");
      const { Icon } = __m("./ui/Icon.js");

      /** 输入框的最小高度（两行）与最大高度（约七行）：到上限就不再长高，改成内部滚动。 */
      const COMMIT_INPUT_MIN_HEIGHT = 52
      const COMMIT_INPUT_MAX_HEIGHT = 160

      /**
       * 由内容的实际高度（`scrollHeight`）算出输入框该有多高：
       * 不低于两行、不高于上限。拿不到有效数字时按最小高度处理。
       */
      function commitInputHeight(scrollHeight) {
        const measured = typeof scrollHeight === 'number' && Number.isFinite(scrollHeight) ? scrollHeight : 0
        return Math.min(COMMIT_INPUT_MAX_HEIGHT, Math.max(COMMIT_INPUT_MIN_HEIGHT, Math.ceil(measured)))
      }

      function CommitBox(props) {
        const source = props
        const translate = source.t
        const message = typeof source.message === 'string' ? source.message : ''
        const stagedCount = typeof source.stagedCount === 'number' ? source.stagedCount : 0
        const changeCount = typeof source.changeCount === 'number' ? source.changeCount : stagedCount
        const busy = source.busy === true
        const generating = source.generating === true
        const elapsedMs = typeof source.elapsedMs === 'number' && source.elapsedMs > 0 ? source.elapsedMs : 0
        const note = source.note === null || source.note === undefined ? null : source.note

        // 内容变了就重新量一次高度（生成填充、手动输入、清空都走这里）
        const inputRef = useRef(null)
        useEffect(() => {
          const element = inputRef.current
          if (element === null || element === undefined) return
          element.style.height = 'auto'
          element.style.height = commitInputHeight(element.scrollHeight) + 'px'
        }, [message])

        const hasMessage = message.trim() !== ''
        const hasChanges = changeCount > 0
        // 有改动 + 有说明就能提交：没有暂存时，提交会先把全部改动暂存（smart commit）
        const canCommit = hasMessage && hasChanges && busy !== true && generating !== true

        // 状态行只显示一件事：结果 > 生成中 > 提交中 > 不能提交的原因
        let statusKind = null
        let statusText = null
        if (note !== null) {
          statusKind = 'note'
          statusText = note.text
        } else if (generating) {
          statusKind = 'progress'
          statusText = translate('commit.generatingElapsed', { seconds: (elapsedMs / 1000).toFixed(1) })
        } else if (busy) {
          statusKind = 'busy'
          statusText = translate('commit.submitting')
        } else if (!hasChanges) {
          statusKind = 'hint'
          statusText = translate('commit.hintNoChanges')
        } else if (!hasMessage) {
          statusKind = 'hint'
          statusText = translate('commit.hintNoMessage')
        } else if (stagedCount === 0) {
          statusKind = 'hint'
          statusText = translate('commit.hintStageAll')
        }

        return h('div', { className: 'dgp-commit' },
          h('div', { className: 'dgp-commit-input-wrap' },
            h('textarea', {
              ref: inputRef,
              className: 'dgp-commit-input',
              'data-dgp-commit': 'input',
              rows: 2,
              placeholder: translate('commit.placeholder'),
              value: message,
              disabled: busy === true || generating === true,
              onChange: (event) => {
                if (typeof source.onChange === 'function') source.onChange(event.target.value)
              },
              onKeyDown: (event) => {
                if ((event.ctrlKey === true || event.metaKey === true) && event.key === 'Enter' && canCommit) {
                  event.preventDefault()
                  source.onCommit()
                }
              }
            }),
            h('button', {
              type: 'button',
              className: 'dgp-commit-generate',
              'data-dgp-commit': 'generate',
              'data-busy': generating ? 'true' : undefined,
              disabled: generating || busy,
              title: translate(generating ? 'commit.generating' : 'commit.generate'),
              'aria-label': translate('commit.generate'),
              onClick: () => {
                if (typeof source.onGenerate === 'function') source.onGenerate()
              }
            },
            // 生成中把笔形图标换成转圈：一眼就能看出还在跑
            generating ? h('span', { className: 'dgp-spinner' }) : h(Icon, { name: 'sparkle', size: 14 }))),

          h('div', { className: 'dgp-commit-actions' },
            statusKind === null
              ? null
              : h('div', {
                className: 'dgp-commit-status',
                'data-dgp-commit': 'status',
                'data-kind': statusKind,
                'data-tone': note === null ? undefined : (note.tone === 'error' ? 'error' : 'info'),
                title: statusText
              },
              statusKind === 'progress' ? h('span', { className: 'dgp-spinner' }) : null,
              h('span', { className: 'dgp-commit-status-text dgp-oneline' }, statusText)),
            h('button', {
              type: 'button',
              className: 'dgp-btn dgp-commit-submit',
              'data-variant': 'primary',
              'data-size': 'sm',
              'data-dgp-commit': 'submit',
              disabled: canCommit !== true,
              title: canCommit ? translate('commit.submit') : translate(hasChanges ? 'commit.hintNoMessage' : 'commit.hintNoChanges'),
              onClick: () => {
                if (typeof source.onCommit === 'function') source.onCommit()
              }
            }, translate(busy ? 'commit.submitting' : 'commit.submit'))))
      }

      Object.assign(exports, { COMMIT_INPUT_MIN_HEIGHT, COMMIT_INPUT_MAX_HEIGHT, commitInputHeight, CommitBox });

    });
    __define("./components/SettingsView.js", (exports, module) => {
      /**
       * src/components/SettingsView.js —— 插件设置页
       *
       * 三段：生成提交说明的模型、变更区显示偏好、代码托管账号。
       * 选项一律来自宿主读到的事实（模型目录、已保存账号），读不到就只展示错误，
       * 不给一个假的默认项。
       */
      const { h, useState } = __m("./platform.js");
      const { openExternalUrl } = __m("./util/openUrl.js");
      const { copyText } = __m("./util/clipboard.js");
      const { Icon } = __m("./ui/Icon.js");
      const { InlineNote } = __m("./components/States.js");

      function SettingsView(props) {
        const source = props
        const translate = source.t
        const models = Array.isArray(source.models) ? source.models : []
        const accounts = Array.isArray(source.accounts) ? source.accounts : []
        const loading = source.loading === true
        const error = typeof source.error === 'string' && source.error !== '' ? source.error : null
        const saved = source.saved === true
        const accountsBusy = source.accountsBusy === true
        const accountsError = typeof source.accountsError === 'string' && source.accountsError !== ''
          ? source.accountsError
          : null
        const providers = Array.isArray(source.providers) ? source.providers : []

        const [provider, setProvider] = useState(providers.length > 0 ? providers[0].id : 'github')
        const [label, setLabel] = useState('')
        const [token, setToken] = useState('')
        // 点过「获取令牌」之后给什么提示：'opened' 或拦截时的地址
        const [tokenHint, setTokenHint] = useState(null)
        // 正在编辑的账号：{ id, label, token, tokenText, revealed, busy, error, notice }
        const [editing, setEditing] = useState(null)

        const selected = providers.find((item) => item.id === provider) ?? { id: provider, label: provider }
        // 每个平台的三步都不同（菜单路径、scope 名都不一样），文案按平台 id 取
        const steps = provider === 'gitee'
          ? ['accounts.guideGitee1', 'accounts.guideGitee2', 'accounts.guideGitee3'].map((key) => translate(key))
          : ['accounts.guideGithub1', 'accounts.guideGithub2', 'accounts.guideGithub3'].map((key) => translate(key))

        const submitAccount = () => {
          if (typeof source.onAddAccount !== 'function' || token.trim() === '') return
          source.onAddAccount({ provider, label: label.trim(), token: token.trim() })
          setToken('')
          setLabel('')
        }

        return h('div', { className: 'dgp-settings', 'data-dgp-view': 'settings' },
          h('div', { className: 'dgp-settings-head' },
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-dgp-settings': 'back',
              onClick: () => {
                if (typeof source.onBack === 'function') source.onBack()
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
                value: typeof source.commitModel === 'string' ? source.commitModel : '',
                onChange: (event) => {
                  if (typeof source.onChangeModel === 'function') source.onChangeModel(event.target.value)
                }
              },
              h('option', { value: '' }, translate('settings.modelNone')),
              models.map((model) => h('option', { key: model.ref, value: model.ref },
                model.providerLabel + ' · ' + model.modelLabel))),
              h('p', { className: 'dgp-settings-hint' }, translate('settings.modelHint'))),
            h('div', { className: 'dgp-settings-field' },
              h('label', { className: 'dgp-settings-label' }, translate('settings.reviewModelLabel')),
              h('select', {
                className: 'dgp-select',
                'data-dgp-settings': 'review-model',
                value: typeof source.reviewModel === 'string' ? source.reviewModel : '',
                onChange: (event) => {
                  if (typeof source.onChangeReviewModel === 'function') source.onChangeReviewModel(event.target.value)
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
              value: source.changesView === 'tree' ? 'tree' : 'list',
              onChange: (event) => {
                if (typeof source.onChangeChangesView === 'function') source.onChangeChangesView(event.target.value)
              }
            },
            h('option', { value: 'list' }, translate('settings.viewList')),
            h('option', { value: 'tree' }, translate('settings.viewTree')))),
          h('div', { className: 'dgp-settings-field' },
            h('label', { className: 'dgp-settings-label' }, translate('settings.untrackedLabel')),
            h('select', {
              className: 'dgp-select',
              'data-dgp-settings': 'untracked-mode',
              value: source.untrackedMode === 'separate' ? 'separate' : 'merge',
              onChange: (event) => {
                if (typeof source.onChangeUntrackedMode === 'function') source.onChangeUntrackedMode(event.target.value)
              }
            },
            h('option', { value: 'merge' }, translate('settings.untrackedMerge')),
            h('option', { value: 'separate' }, translate('settings.untrackedSeparate')))),

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
                    onClick: () => {
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
                  }, h(Icon, { name: 'file', size: 13 })),
                  h('button', {
                    type: 'button',
                    className: 'dgp-row-action',
                    'data-dgp-account-remove': account.id,
                    title: translate('accounts.remove', { name: account.label }),
                    'aria-label': translate('accounts.remove', { name: account.label }),
                    onClick: () => {
                      if (typeof source.onRemoveAccount === 'function') source.onRemoveAccount(account.id)
                    }
                  }, h(Icon, { name: 'trash', size: 13 }))))),
            editing === null
              ? null
              : h('div', { className: 'dgp-account-inline', 'data-dgp-accounts': 'editor' },
                h('div', { className: 'dgp-account-inline-head' },
                  h('span', { className: 'dgp-account-guide-title' },
                    translate('accounts.edit', { name: editing.label })),
                  h('button', {
                    type: 'button',
                    className: 'dgp-btn',
                    'data-size': 'sm',
                    'data-variant': 'ghost',
                    'data-dgp-accounts': 'hide-token',
                    onClick: () => setEditing({ ...editing, revealed: false, tokenText: null })
                  }, translate('accounts.hide'))),
                h('div', { className: 'dgp-account-form' },
                  h('input', {
                    className: 'dgp-input',
                    'data-dgp-accounts': 'edit-label',
                    placeholder: translate('accounts.editLabel'),
                    value: editing.label,
                    onChange: (event) => setEditing({ ...editing, label: event.target.value })
                  }),
                  h('input', {
                    className: 'dgp-input',
                    'data-dgp-accounts': 'edit-token',
                    placeholder: translate('accounts.tokenReplaceHint'),
                    value: editing.token,
                    onChange: (event) => setEditing({ ...editing, token: event.target.value })
                  }),
                  h('button', {
                    type: 'button',
                    className: 'dgp-btn',
                    'data-size': 'sm',
                    'data-dgp-accounts': 'reveal-token',
                    disabled: editing.busy,
                    onClick: async () => {
                      if (editing.revealed) {
                        setEditing({ ...editing, revealed: false, tokenText: null })
                        return
                      }
                      if (typeof source.onReadToken !== 'function') return
                      setEditing({ ...editing, busy: true, error: null })
                      const result = await source.onReadToken(editing.id)
                      if (result !== null && result !== undefined && result.ok === true) {
                        setEditing({ ...editing, busy: false, revealed: true, tokenText: result.token })
                        return
                      }
                      setEditing({ ...editing, busy: false, error: result === null || result === undefined ? '读取失败' : result.error })
                    }
                  }, translate(editing.revealed ? 'accounts.hide' : 'accounts.reveal')),
                  h('button', {
                    type: 'button',
                    className: 'dgp-btn',
                    'data-size': 'sm',
                    'data-dgp-accounts': 'copy-token',
                    disabled: editing.tokenText === null,
                    onClick: async () => {
                      const copied = await copyText(editing.tokenText)
                      setEditing({
                        ...editing,
                        notice: copied.ok ? translate('accounts.copied') : translate('accounts.copyFailed'),
                        error: null
                      })
                    }
                  }, translate('accounts.copy')),
                  h('button', {
                    type: 'button',
                    className: 'dgp-btn',
                    'data-size': 'sm',
                    'data-variant': 'primary',
                    'data-dgp-accounts': 'save-account',
                    disabled: editing.busy,
                    onClick: async () => {
                      if (typeof source.onUpdateAccount !== 'function') return
                      setEditing({ ...editing, busy: true, error: null, notice: null })
                      const result = await source.onUpdateAccount({
                        id: editing.id,
                        label: editing.label,
                        token: editing.token
                      })
                      if (result !== null && result !== undefined && result.ok === true) {
                        setEditing({ ...editing, busy: false, token: '', notice: translate('accounts.updated') })
                        return
                      }
                      setEditing({ ...editing, busy: false, error: result === null || result === undefined ? '保存失败' : result.error })
                    }
                  }, translate(accountsBusy ? 'accounts.adding' : 'accounts.saveLabel')),
                  h('button', {
                    type: 'button',
                    className: 'dgp-btn',
                    'data-size': 'sm',
                    onClick: () => setEditing(null)
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
            typeof source.accountsNotice === 'string' && source.accountsNotice !== ''
              ? h(InlineNote, { tone: 'info' }, source.accountsNotice)
              : null,
            /* 引导：按当前平台给三步 + 一键打开令牌页，免得用户自己去翻设置菜单 */
            h('div', { className: 'dgp-account-guide', 'data-dgp-accounts': 'guide' },
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
                disabled: accountsBusy || token.trim() === '',
                onClick: submitAccount
              }, translate(accountsBusy ? 'accounts.adding' : 'accounts.add'))),

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
      const { h, useState } = __m("./platform.js");
      const { Icon } = __m("./ui/Icon.js");
      const { formatDateTime } = __m("./util/time.js");
      const { openExternalUrl } = __m("./util/openUrl.js");

      /** 秒数保留一位小数，避免每次 tick 都跳一大截。 */
      function secondsOf(startedAt, now) {
        if (startedAt === 0) return '0.0'
        return ((now - startedAt) / 1000).toFixed(1)
      }

      function RemotePane(props) {
        const source = props
        const translate = source.t
        const accounts = Array.isArray(source.accounts) ? source.accounts : []
        const accountId = typeof source.accountId === 'string' ? source.accountId : null
        const repos = Array.isArray(source.repos) ? source.repos : []
        const loading = source.loading === true
        const error = typeof source.error === 'string' && source.error !== '' ? source.error : null
        const hasMore = source.hasMore === true
        const filter = typeof source.filter === 'string' ? source.filter : ''
        const selectedFullName = typeof source.selectedFullName === 'string' ? source.selectedFullName : null
        const prCounts = source.prCounts !== null && typeof source.prCounts === 'object' ? source.prCounts : {}
        const clone = source.clone === null || source.clone === undefined ? null : source.clone
        const now = typeof source.now === 'number' ? source.now : 0
        const [folderFor, setFolderFor] = useState(null)
        const [folderName, setFolderName] = useState('')
        // 添加账号的行内表单：{ provider, label, token, busy, error }
        const [form, setForm] = useState(null)
        // 点过「获取令牌」后的提示：'opened' 或拦截时的地址
        const [tokenHint, setTokenHint] = useState(null)

        const providers = Array.isArray(source.providers) ? source.providers : []
        const providerOf = (id) => providers.find((item) => item.id === id) ?? { id, label: id }

        const openForm = (providerId) => {
          const id = typeof providerId === 'string' && providerId !== ''
            ? providerId
            : (providers.length > 0 ? providers[0].id : 'github')
          setTokenHint(null)
          setForm({ provider: id, label: '', token: '', busy: false, error: null })
        }

        const closeForm = () => setForm(null)

        const submitForm = async () => {
          if (form === null || typeof source.onAddAccount !== 'function') return
          if (form.token.trim() === '') return
          setForm({ ...form, busy: true, error: null })
          const result = await source.onAddAccount({
            provider: form.provider,
            label: form.label.trim(),
            token: form.token.trim()
          })
          if (result !== null && result !== undefined && result.ok === true) {
            setForm(null)
            return
          }
          setForm({ ...form, busy: false, error: result === null || result === undefined ? '添加失败' : result.error })
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
          if (typeof source.onClone !== 'function') return
          setFolderFor(null)
          source.onClone(repo, folderName.trim())
        }

        const formNode = form === null
          ? null
          : h('div', { className: 'dgp-account-inline', 'data-dgp-remote': 'account-form' },
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
                onChange: (event) => setForm({ ...form, provider: event.target.value })
              },
              providers.map((item) => h('option', { key: item.id, value: item.id }, item.label))),
              h('input', {
                className: 'dgp-input',
                'data-dgp-remote': 'account-label',
                placeholder: translate('accounts.label'),
                value: form.label,
                onChange: (event) => setForm({ ...form, label: event.target.value })
              }),
              h('input', {
                className: 'dgp-input',
                'data-dgp-remote': 'account-token',
                type: 'password',
                placeholder: translate('accounts.tokenPlaceholder'),
                value: form.token,
                onChange: (event) => setForm({ ...form, token: event.target.value }),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') submitForm()
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
        if (accounts.length === 0) {
          body = h('div', { className: 'dgp-state', 'data-dgp-remote': 'no-accounts' },
            h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'external', size: 22 })),
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
              typeof source.onOpenSettings === 'function'
                ? h('button', {
                  type: 'button',
                  className: 'dgp-btn',
                  'data-variant': 'ghost',
                  'data-dgp-remote': 'open-settings',
                  onClick: () => source.onOpenSettings()
                }, translate('accounts.guideTitle'))
                : null))
        } else if (error !== null) {
          body = h('div', { className: 'dgp-state', 'data-dgp-remote': 'error' },
            h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'warning', size: 20 })),
            h('div', { className: 'dgp-state-title' }, translate('remote.failed', { message: '' })),
            h('div', { className: 'dgp-state-desc' }, error),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              onClick: () => {
                if (typeof source.onRefresh === 'function') source.onRefresh()
              }
            }, translate('remote.refresh')))
        } else if (loading && repos.length === 0) {
          body = h('div', { className: 'dgp-state', 'data-dgp-remote': 'loading' },
            h('div', { className: 'dgp-state-icon' }, h('span', { className: 'dgp-spinner' })),
            h('div', { className: 'dgp-state-title' }, translate('remote.loading')))
        } else if (repos.length === 0) {
          body = h('div', { className: 'dgp-state', 'data-dgp-remote': 'empty' },
            h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'folder-open', size: 20 })),
            h('div', { className: 'dgp-state-title' }, translate('remote.empty')))
        } else {
          body = h('div', { className: 'dgp-list', 'data-dgp-remote': 'list', role: 'list' },
            repos.map((repo) => {
              const cloning = clone !== null && clone.fullName === repo.fullName
              return h('div', {
                key: repo.fullName,
                className: 'dgp-remote-item',
                role: 'listitem',
                'data-dgp-remote-item': repo.fullName,
                'data-active': repo.fullName === selectedFullName ? 'true' : undefined,
                onClick: () => {
                  if (typeof source.onSelectRepo === 'function') source.onSelectRepo(repo)
                }
              },
                h('div', { className: 'dgp-remote-row' },
                  h('span', { className: 'dgp-remote-name dgp-oneline', title: repo.fullName }, repo.name),
                  typeof prCounts[repo.fullName] === 'number' && prCounts[repo.fullName] > 0
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
                    onClick: (event) => event.stopPropagation()
                  },
                    h('label', { className: 'dgp-remote-cloneform-label' }, translate('remote.cloneFolder')),
                    h('input', {
                      className: 'dgp-input dgp-remote-cloneform-input',
                      'data-dgp-remote-folder': repo.fullName,
                      value: folderName,
                      onChange: (event) => setFolderName(event.target.value)
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
                    h('span', null, clone.error))
                  : null)
            }),
            hasMore
              ? h('button', {
                type: 'button',
                className: 'dgp-btn dgp-remote-more',
                'data-size': 'sm',
                disabled: loading,
                onClick: () => {
                  if (typeof source.onLoadMore === 'function') source.onLoadMore()
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
                  if (typeof source.onSelectAccount === 'function') source.onSelectAccount(account)
                }
              }, account.label)),
              h('button', {
                type: 'button',
                className: 'dgp-iconbtn dgp-remote-refresh',
                title: translate('remote.addAccount'),
                'aria-label': translate('remote.addAccount'),
                'data-dgp-remote': 'add-account',
                onClick: () => openForm(providerOf(accountId).id)
              }, h(Icon, { name: 'plus', size: 13 })),
              h('button', {
                type: 'button',
                className: 'dgp-iconbtn',
                title: translate('remote.refresh'),
                'aria-label': translate('remote.refresh'),
                onClick: () => {
                  if (typeof source.onRefresh === 'function') source.onRefresh()
                }
              }, h(Icon, { name: 'refresh', size: 13 }))),
          accounts.length === 0
            ? null
            : h('input', {
              className: 'dgp-input dgp-remote-filter',
              'data-dgp-remote-filter': 'true',
              placeholder: translate('remote.filter'),
              value: filter,
              onChange: (event) => {
                if (typeof source.onFilterChange === 'function') source.onFilterChange(event.target.value)
              }
            }),
          body)
      }

      Object.assign(exports, { RemotePane });

    });
    __define("./components/RemoteDetail.js", (exports, module) => {
      /**
       * src/components/RemoteDetail.js —— 远端仓库右侧详情：代码 / Issues / PR
       *
       * 只负责展示：数据由 Panel 拉（remote/detail），这里把「数量、最近条目、
       * 打开网页」三件事排清楚；拿不到总数的区块如实写「数量未知」。
       */
      const { h } = __m("./platform.js");
      const { Icon } = __m("./ui/Icon.js");
      const { formatDateTime } = __m("./util/time.js");

      function Section(props) {
        const { title, total, itemsTheLabel, items, emptyLabel, openLabel, onOpen, t, kind } = props
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
                  className: 'dgp-detail-link dgp-oneline',
                  title: item.title,
                  'data-dgp-item': kind,
                  onClick: () => {
                    if (kind === 'pulls' && item.number !== null && typeof props.onOpenPull === 'function') {
                      props.onOpenPull(item.number)
                      return
                    }
                    onOpen(item.url)
                  }
                }, (item.number === null ? '' : '#' + item.number + ' ') + item.title),
                h('span', { className: 'dgp-detail-meta dgp-oneline' },
                  item.author === '' ? '' : item.author + ' · ',
                  item.createdAt === '' ? '' : formatDateTime(Date.parse(item.createdAt)))))))
      }

      function RemoteDetail(props) {
        const source = props
        const t = source.t
        const selection = source.selection === null || source.selection === undefined ? null : source.selection
        const detail = source.detail === null || source.detail === undefined ? null : source.detail

        if (selection === null) {
          return h('div', { className: 'dgp-viewer' },
            h('div', { className: 'dgp-state', 'data-dgp-detail': 'empty' },
              h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'file-diff', size: 22 })),
              h('div', { className: 'dgp-state-title' }, t('detail.pickRepo')),
              h('div', { className: 'dgp-state-desc' }, t('detail.pickRepoHint'))))
        }

        if (detail === null || detail.loading === true) {
          return h('div', { className: 'dgp-viewer' },
            h('div', { className: 'dgp-state', 'data-dgp-detail': 'loading' },
              h('div', { className: 'dgp-state-icon' }, h('span', { className: 'dgp-spinner' })),
              h('div', { className: 'dgp-state-title' }, t('detail.loading', { name: selection.fullName }))))
        }

        if (detail.error !== null) {
          return h('div', { className: 'dgp-viewer' },
            h('div', { className: 'dgp-state', 'data-dgp-detail': 'error' },
              h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'warning', size: 20 })),
              h('div', { className: 'dgp-state-title' }, t('detail.failed')),
              h('div', { className: 'dgp-state-desc' }, detail.error),
              h('button', {
                type: 'button',
                className: 'dgp-btn',
                'data-size': 'sm',
                onClick: () => {
                  if (typeof source.onRetry === 'function') source.onRetry()
                }
              }, t('action.retry'))))
        }

        const data = detail.data
        const repo = data.repo
        const sizeText = repo.sizeKb > 0 ? t('detail.sizeKb', { size: repo.sizeKb }) : ''
        const meta = [repo.language, sizeText, repo.defaultBranch === '' ? '' : repo.defaultBranch]
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
                  if (typeof source.onClone === 'function') source.onClone(selection)
                }
              }, t('remote.clone')),
              h('button', {
                type: 'button',
                className: 'dgp-btn',
                'data-size': 'sm',
                'data-dgp-detail-open': 'repo',
                onClick: () => {
                  if (typeof source.onOpenUrl === 'function') source.onOpenUrl(repo.htmlUrl)
                }
              }, t('remote.openWeb'), h(Icon, { name: 'external', size: 12 })))),
          repo.description === '' ? null : h('p', { className: 'dgp-detail-desc' }, repo.description),
          h('div', { className: 'dgp-detail-meta' },
            meta === '' ? null : h('span', null, meta),
            h('span', null, t('detail.stars', { count: repo.stars })),
            h('span', null, t('detail.forks', { count: repo.forks })),
            repo.updatedAt === '' ? null : h('span', null, t('remote.updatedAt', { time: formatDateTime(Date.parse(repo.updatedAt)) }))),

          (Array.isArray(data.failures) ? data.failures : []).map((failure) => h('p', {
            key: failure.section,
            className: 'dgp-detail-failure'
          }, t('detail.sectionFailed', { section: failure.section, message: failure.message }))),

          h('div', { className: 'dgp-detail-code' },
            h('span', { className: 'dgp-detail-title' }, t('detail.code')),
            h('span', { className: 'dgp-detail-meta' },
              [repo.language === '' ? '' : repo.language, sizeText, repo.defaultBranch === '' ? '' : t('detail.defaultBranch', { name: repo.defaultBranch })]
                .filter((part) => part !== '').join(' · '))),

          h(Section, {
            kind: 'issues',
            title: t('detail.issues'),
            total: data.issues.total,
            items: data.issues.items,
            emptyLabel: t('detail.noIssues'),
            openLabel: t('detail.openOnWeb'),
            onOpen: (url) => {
              if (typeof source.onOpenUrl === 'function') source.onOpenUrl(url ?? repo.issuesUrl)
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
              if (typeof source.onOpenUrl === 'function') source.onOpenUrl(url ?? repo.pullsUrl)
            },
            onOpenPull: typeof source.onOpenPull === 'function' ? source.onOpenPull : undefined,
            t
          }))
      }

      Object.assign(exports, { RemoteDetail });

    });
    __define("./components/PullDetail.js", (exports, module) => {
      /**
       * src/components/PullDetail.js —— 单个 PR 的详情与操作（审查 / 合并）
       *
       * 能力来自宿主返回的 capabilities：Gitee 只有「通过」一种结论、合并方式两种，
       * GitHub 三种都有。界面只渲染平台真正支持的动作，不做「点了才发现不支持」。
       */
      const { h, useState } = __m("./platform.js");
      const { Icon } = __m("./ui/Icon.js");
      const { formatDateTime } = __m("./util/time.js");

      const VERDICT_LABEL = {
        approve: 'pull.approve',
        'request-changes': 'pull.requestChanges',
        comment: 'pull.comment'
      }

      function PullDetail(props) {
        const source = props
        const t = source.t
        const selection = source.selection === null || source.selection === undefined ? null : source.selection
        const detail = source.detail === null || source.detail === undefined ? null : source.detail
        const [note, setNote] = useState('')
        const [mergeMethod, setMergeMethod] = useState('merge')
        const [deleteBranch, setDeleteBranch] = useState(true)
        const [busy, setBusy] = useState(null)
        const [error, setError] = useState(null)
        const [notice, setNotice] = useState(null)
        // AI 审阅：idle / loading / done(result) / error
        const [ai, setAi] = useState({ status: 'idle', result: null, error: null })
        // 评论草稿：AI 生成后填入，用户可改，只有点「提交评论」才发出去
        const [draft, setDraft] = useState('')
        const [commentBusy, setCommentBusy] = useState(false)
        const [commentNotice, setCommentNotice] = useState(null)

        if (selection === null) return null

        const back = () => {
          if (typeof source.onBack === 'function') source.onBack()
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
              h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'warning', size: 20 })),
              h('div', { className: 'dgp-state-title' }, t('pull.failed')),
              h('div', { className: 'dgp-state-desc' }, detail.error),
              h('div', { className: 'dgp-state-actions' },
                h('button', {
                  type: 'button',
                  className: 'dgp-btn',
                  'data-size': 'sm',
                  onClick: () => {
                    if (typeof source.onRetry === 'function') source.onRetry()
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

        const run = async (kind, action) => {
          setBusy(kind)
          setError(null)
          setNotice(null)
          const result = await action()
          setBusy(null)
          if (result !== null && result !== undefined && result.ok === true) {
            setNotice(result.message ?? null)
            if (typeof source.onChanged === 'function') source.onChanged()
            return
          }
          setError(result === null || result === undefined ? '操作失败' : result.error)
        }

        /** 跑一次 AI 审阅（宿主负责取 diff 与调模型）。 */
        const runAi = async () => {
          if (typeof source.onAiReview !== 'function') return
          setAi({ status: 'loading', result: null, error: null })
          setCommentNotice(null)
          const result = await source.onAiReview({
            accountId: selection.accountId,
            fullName: selection.fullName,
            number: pull.number
          })
          if (result !== null && result !== undefined && result.ok === true) {
            setAi({ status: 'done', result, error: null })
            setDraft(result.comment ?? '')
            return
          }
          setAi({ status: 'error', result: null, error: result === null || result === undefined ? '审阅失败' : result.error })
        }

        /** 提交评论：内容就是输入框里的（用户可改过的）文本。 */
        const submitComment = async () => {
          if (typeof source.onComment !== 'function' || commentBusy) return
          setCommentBusy(true)
          setCommentNotice(null)
          const result = await source.onComment({
            accountId: selection.accountId,
            fullName: selection.fullName,
            number: pull.number,
            comment: draft
          })
          setCommentBusy(false)
          if (result !== null && result !== undefined && result.ok === true) setCommentNotice(result.message ?? t('pull.aiCommentDone'))
          else setCommentNotice(result === null || result === undefined ? '评论失败' : result.error)
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
                if (typeof source.onOpenUrl === 'function') source.onOpenUrl(pull.htmlUrl)
              }
            }, t('remote.openWeb'), h(Icon, { name: 'external', size: 12 }))),

          /* 门禁状态：审查与测试并排一行，状态一眼可见 */
          h('div', { className: 'dgp-gate', 'data-dgp-pull': 'gate' },
            h('span', { className: 'dgp-gate-chip', 'data-gate': 'review', 'data-state': gate.review.state },
              t('pull.gateReview'), '：', gateLabel('review', gate.review.state)),
            h('span', { className: 'dgp-gate-chip', 'data-gate': 'test', 'data-state': gate.test.state },
              t('pull.gateTest'), '：', gateLabel('test', gate.test.state)),
            gate.mergeState === null ? null : h('span', { className: 'dgp-gate-chip', 'data-gate': 'merge-state' },
              t('pull.gateMergeState'), '：', gate.mergeState)),

          h('div', { className: 'dgp-detail-meta' },
            h('span', { 'data-dgp-pull-state': pull.state }, t('pull.state.' + pull.state === '' ? 'pull.state.unknown' : 'pull.state.' + pull.state)),
            pull.merged === true ? h('span', null, t('pull.merged')) : null,
            h('span', null, pull.author),
            h('span', null, pull.headBranch + ' → ' + pull.baseBranch),
            h('span', null, '+' + statText(pull.additions) + ' / −' + statText(pull.deletions)),
            h('span', null, t('pull.filesChanged', { count: statText(pull.changedFiles) })),
            h('span', null, t('pull.commits', { count: pull.commits })),
            pull.updatedAt === '' ? null : h('span', null, t('remote.updatedAt', { time: formatDateTime(Date.parse(pull.updatedAt)) }))),

          pull.body === ''
            ? null
            : h('pre', { className: 'dgp-pull-body', 'data-dgp-pull': 'body' }, pull.body),

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
                onClick: runAi
              }, t(ai.status === 'done' ? 'pull.aiRerun' : 'pull.aiRun'))),
            ai.status === 'loading' ? h('p', { className: 'dgp-detail-meta', 'data-dgp-pull': 'ai-loading' }, t('pull.aiRunning')) : null,
            ai.status === 'error' ? h('p', { className: 'dgp-detail-failure', 'data-dgp-pull': 'ai-error' }, ai.error) : null,
            ai.status !== 'done' ? null : h('div', { 'data-dgp-pull': 'ai-result' },
              ai.result.truncated === true
                ? h('p', { className: 'dgp-detail-notice', 'data-dgp-pull': 'ai-truncated' }, t('pull.aiTruncated'))
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
                h('label', { className: 'dgp-settings-label' }, t('pull.aiCommentLabel')),
                h('p', { className: 'dgp-settings-hint' }, t('pull.aiCommentHint')),
                h('textarea', {
                  className: 'dgp-input dgp-ai-textarea',
                  'data-dgp-pull': 'ai-comment',
                  value: draft,
                  spellCheck: false,
                  rows: 10,
                  onChange: (event) => setDraft(event.target.value)
                }),
                h('div', { className: 'dgp-pull-actions' },
                  h('button', {
                    type: 'button',
                    className: 'dgp-btn',
                    'data-size': 'sm',
                    'data-variant': 'primary',
                    'data-dgp-pull': 'comment-submit',
                    disabled: commentBusy || draft.trim() === '',
                    onClick: submitComment
                  }, t(commentBusy ? 'pull.aiCommentSubmitting' : 'pull.aiCommentSubmit'))),
                commentNotice === null
                  ? null
                  : h('p', { className: 'dgp-detail-notice', 'data-dgp-pull': 'comment-notice' }, commentNotice)))),

          /* ------------------------------ 审查 ------------------------------ */
          h('section', { className: 'dgp-detail-section', 'data-dgp-pull': 'review' },
            h('div', { className: 'dgp-detail-head' },
              h('span', { className: 'dgp-detail-title' }, t('pull.review')),
              h('span', { className: 'dgp-detail-count' },
                caps.reviews === true ? t('pull.reviewCount', { count: data.reviews.length }) : t('pull.reviewUnsupported'))),
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
                  onChange: (event) => setMergeMethod(event.target.value)
                },
                caps.mergeMethods.map((method) => h('option', { key: method, value: method }, t('pull.method.' + method)))),
                h('label', { className: 'dgp-pull-check' },
                  h('input', {
                    type: 'checkbox',
                    'data-dgp-pull': 'delete-branch',
                    checked: deleteBranch,
                    onChange: (event) => setDeleteBranch(event.target.checked)
                  }),
                  t('pull.deleteBranch', { branch: pull.headBranch })),
                h('button', {
                  type: 'button',
                  className: 'dgp-btn',
                  'data-size': 'sm',
                  'data-variant': 'primary',
                  'data-dgp-pull': 'merge-run',
                  disabled: busy !== null || mergeBlocked,
                  onClick: submitMerge
                }, t(busy === 'merge' ? 'pull.merging' : 'pull.mergeRun'))))
            : null,

          busy === null ? null : h('p', { className: 'dgp-detail-meta' }, t('pull.working')),
          notice === null ? null : h('p', { className: 'dgp-detail-notice', 'data-dgp-pull': 'notice' }, notice),
          error === null ? null : h('p', { className: 'dgp-detail-failure', 'data-dgp-pull': 'error' }, error))
      }

      Object.assign(exports, { PullDetail });

    });
    __define("./store.js", (exports, module) => {
      /**
       * src/store.js —— 显示偏好 + 两个通用 hook
       *
       * 只放「跨会话应该记住的显示偏好」。status/diff 数据与当前选中项都是每次
       * 重新取的组件状态，不进这里。
       *
       * 偏好存在 localStorage 里；读取时只做「结构校验 + 数值钳制」，
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
        untrackedMode: 'merge'
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
        if (input.collapsedGroups && typeof input.collapsedGroups === 'object') {
          const groups = {}
          for (const key of GROUPS) if (input.collapsedGroups[key] === true) groups[key] = true
          out.collapsedGroups = groups
        }
        return out
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
       * @param {string} key DEFAULTS 的键
       */
      function usePref(key) {
        const [value, setValue] = useState(() => loadPrefs()[key])
        const set = useCallback((next) => {
          setValue((prev) => {
            const resolved = typeof next === 'function' ? next(prev) : next
            savePrefs({ [key]: resolved })
            return resolved
          })
        }, [key])
        return [value, set]
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

      Object.assign(exports, { MODE, MODES, UNTRACKED_MODES, usePref, useLatestGuard });

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
       * 挂在 `conversation.session.header.actions` 槽（session 作用域，官方 jobs 插件同款位置）。
       * 点一下 = 打开当前会话右侧栏的「Git 变更」页签：
       *   sidebarRight.openTabIn(sessionId, 'git')
       * 布局 store 的 openContent 会先执行 planSetExpanded(true)，所以侧栏收起时也会自动展开。
       *
       * 这个按钮的意义：右侧栏可能被收起，光靠「+」菜单里的入口会找不到，标题栏按钮常驻可见。
       */
      const { h } = __m("./platform.js");

      /** 与 tab 类型一致的 kind（右侧栏按 kind 找到 tab 定义）。 */
      const TAB_KIND = 'git'

      function GitHeaderAction(props) {
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

      Object.assign(exports, { TAB_KIND, GitHeaderAction });

    });
    var api = __m("./index.js");
    // 测试钩子：冒烟测试可借它直接取任意模块（生产运行路径不使用）
    if (api !== null && typeof api === "object") { try { api.__modules = __m; } catch (e) { /* frozen */ } }
    return api;
  }
});
