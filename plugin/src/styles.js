/**
 * src/styles.js —— 面板全部样式
 *
 * 规则（见 CONTRACT.md §4/§6）：
 *  · 颜色/圆角/字体/间距全部取自 DSH 主题令牌（--dsw-* / --dsh-*），**零字面量色值**；
 *  · 深浅色自动跟随（令牌定义在 body 上，暗色由 body[data-ds-dark-theme] 切换），
 *    因此这里不需要写暗色覆写；
 *  · 分隔线一律 .5px 发丝线；
 *  · 样式必须在 factory 执行期间同步注入，平台才会打上 data-plugin 并在卸载时回收。
 */
const STYLE_ID = 'dsh-git-panel-css'

export const CSS = `
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
.dgp-mono { font-family: var(--ds-font-family-code); }
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

/* 仓库选择 pill */
.dgp-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  min-width: 0;
  max-width: 200px;
  padding: 0 8px;
  border: 0;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  line-height: 18px;
  cursor: pointer;
}
.dgp-pill:hover, .dgp-pill[aria-expanded="true"] { background: var(--dsw-alias-interactive-bg-hover); }
.dgp-pill[data-empty="true"] { color: var(--dsw-alias-label-tertiary); }
.dgp-pill-label { flex: 0 1 auto; min-width: 0; }
.dgp-rootpicker { display: inline-flex; min-width: 0; }
/* 根列表里的一行：主体按钮 + 可选的移除按钮并排（button 不能嵌套 button） */
.dgp-root-row {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: var(--dsw-radius-sm);
}
.dgp-root-row[data-active="true"] { background: var(--dsw-alias-interactive-bg-hover); }
.dgp-root-row > .dgp-menu-item { flex: 1 1 auto; min-width: 0; }
.dgp-pill-badge {
  flex: none;
  padding: 0 4px;
  border-radius: var(--dsw-radius-xs);
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-tertiary);
  font-size: 10px;
  line-height: 14px;
}
.dgp-pill-badge[data-kind="extra"] { color: var(--dsw-alias-state-business-primary); }
.dgp-pill-branch {
  flex: none;
  max-width: 96px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--ds-font-family-code);
  font-size: 11px;
}
.dgp-pill-count {
  flex: none;
  min-width: 14px;
  padding: 0 3px;
  border-radius: 999px;
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
  border-radius: var(--dsw-radius-sm);
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
.dgp-iconbtn, .dgp-tool {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: 0 0;
  color: var(--dsw-alias-label-secondary);
  line-height: 1;
  cursor: pointer;
}
.dgp-iconbtn svg, .dgp-tool svg { width: 15px; height: 15px; }
.dgp-iconbtn:hover:not(:disabled), .dgp-tool:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dgp-iconbtn[data-active="true"], .dgp-iconbtn[aria-pressed="true"],
.dgp-tool[data-active="true"], .dgp-tool[aria-pressed="true"] {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
}
.dgp-iconbtn:disabled, .dgp-tool:disabled { opacity: .4; cursor: default; }
.dgp-iconbtn[data-busy="true"] svg { animation: dgp-spin 1s linear infinite; }
.dgp-iconbtn:focus-visible, .dgp-tool:focus-visible, .dgp-btn:focus-visible,
.dgp-pill:focus-visible, .dgp-seg-btn:focus-visible, .dgp-input:focus-visible,
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
  border-radius: var(--dsw-radius-md);
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
.dgp-btn[data-size="sm"] { height: 24px; padding: 0 8px; font-size: 11px; border-radius: var(--dsw-radius-sm); }

/* 搜索框 */
.dgp-filter { display: flex; flex: none; align-items: center; gap: 6px; padding: 2px 8px 6px; }
.dgp-search { position: relative; display: flex; align-items: center; flex: 1 1 auto; min-width: 0; }
.dgp-search > .dgp-ico { position: absolute; left: 7px; color: var(--dsw-alias-label-tertiary); pointer-events: none; }
.dgp-input {
  width: 100%;
  height: 26px;
  padding: 0 24px 0 26px;
  border: 0;
  border-radius: var(--dsw-radius-md);
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
.dgp-num { font-family: var(--ds-font-family-code); font-size: 12px; }

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
  border-radius: var(--dsw-radius-sm);
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
.dgp-repo-branch {
  flex: 0 1 auto;
  min-width: 0;
  margin-left: auto;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--ds-font-family-code);
  font-size: 11px;
}
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
.dgp-divider, .dgp-splitter {
  position: relative;
  z-index: 1;
  flex: none;
  width: 0;
  cursor: col-resize;
  touch-action: none;
}
.dgp-divider::before, .dgp-splitter::before {
  content: "";
  position: absolute;
  top: 0; bottom: 0; left: -.25px;
  width: .5px;
  background: var(--dsw-alias-border-l4);
}
.dgp-divider::after, .dgp-splitter::after {
  content: "";
  position: absolute;
  inset: 0 -4px;
  background: linear-gradient(to bottom, transparent, var(--dsw-alias-label-caption) 50%, transparent) center / 1px 100% no-repeat;
  opacity: 0;
  transition: opacity .12s ease-out;
}
.dgp-divider:hover::after, .dgp-divider[data-dragging="true"]::after,
.dgp-splitter:hover::after, .dgp-splitter:active::after, .dgp-splitter:focus-visible::after { opacity: 1; }
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
  border-radius: var(--dsw-radius-md);
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
  border-radius: var(--dsw-radius-sm);
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
  border-radius: var(--dsw-radius-sm);
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
  border-radius: var(--dsw-radius-sm);
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
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
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
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
}
.dgp-commit-generate:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dgp-commit-generate[data-busy='true'] { opacity: .5; cursor: default; }
.dgp-commit-submit { align-self: flex-end; min-width: 72px; }

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
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 12px;
}

.dgp-note { margin: 0; padding: 4px 10px; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.dgp-note[data-tone="error"] { color: var(--dsw-alias-state-error-primary); }
.dgp-empty { padding: 6px 10px; color: var(--dsw-alias-label-tertiary); font-size: 12px; }

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
.dgp-diff-gutter { display: contents; }
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
.dgp-diff-note { margin: 0; padding: 4px 16px 8px; color: var(--dsw-alias-label-tertiary); font-family: var(--dsw-font-family); font-size: 12px; }
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
/* ===================== 7. 文件编辑器 ===================== */
# 见文件末「文件编辑器」区块（textarea + 行号列）


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
  border-radius: var(--dsw-radius-md);
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
  border-radius: var(--dsw-radius-md);
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
  border-radius: var(--dsw-radius-sm);
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
.dgp-menu-form { display: flex; flex-direction: column; gap: 6px; padding: 6px 8px 8px; }
.dgp-menu-form-actions { display: flex; justify-content: flex-end; gap: 6px; }

/* ===================== 10. 自适应 ===================== */
.dgp-root[data-narrow="true"] .dgp-meta,
.dgp-root[data-narrow="true"] .dgp-pill-branch { display: none; }
@media (prefers-reduced-motion: reduce) {
  .dgp-spinner { animation-duration: 2.4s; }
  .dgp-skel-dot, .dgp-skel-bar { animation: none; }
  .dgp-caret, .dgp-group-caret, .dgp-divider::after { transition: none; }
}
@media (pointer: coarse) {
  .dgp-row, .dgp-group-head { min-height: 40px; }
  .dgp-iconbtn, .dgp-tool { width: 32px; height: 32px; }
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
  border-radius: 6px;
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
  border-radius: var(--dsw-radius-md);
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

/* 检测更新的一句话结果（在工具条下方） */
.dgp-notebar { padding: 0 10px 6px; }


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
`

/** 幂等注入样式表（必须在 factory 执行期间同步调用）。 */
export function ensureStyles() {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
}
