# src/ 模块契约（写代码前必读）

本文件是 `dsh-git-panel` 客户端半体的内部契约。所有 `src/**/*.js` 必须遵守，否则 `build/build-client.mjs`
会直接报错（它只支持下面这些语法形式）。

## 0. 硬规则

1. **不许用 JSX**（没有编译 JSX 的工具链）。用 `h(tag, props, ...children)` 手写，`h` 来自 `./platform.js`。
2. **不许 import 任何 npm 包**，唯一的例外是 `import react from 'react'`，而且只允许出现在 `src/platform.js`。
   其它文件一律 `import { h, useState, ... } from './platform.js'`。
3. 模块之间只用 **相对路径 + `.js` 后缀** 的具名 import。
4. 每个文件只允许下面这些语法（打包器只认这些）：
   - `import def from './x.js'` / `import { a, b as c } from './x.js'` / `import * as ns from './x.js'` / `import './x.js'`
   - `export function f(){}` / `export async function f(){}` / `export class C {}` / `export const x = 1`
   - `export default <expr>`（后面必须是同一行的表达式）
   - `export { a, b as c }`
   - **禁止** `export * from`、`export { a } from './x.js'`、动态 `import()`。
5. 不许有循环依赖（A→B→A）。打包器会报错。
6. 不要碰 `window` / `document`，除非确实需要（见 styles.js 的幂等注入）。
7. 文案一律走 `t('key')`，`t` 由框架通过 props 注入（`register({ locale: NS })` 保证），插件不自造 `makeT` 之类的降级。
8. **不要写「缺失兜底」**：`t`、`sessionId`、`ctx.connection` 等由宿主/`inject` 保证存在，直接取用；
   缺了就应该报错（浮到 DevTools），而不是静默降级成另一条路径。兼容分支比崩溃更难查。

## 1. 模块清单与负责人

| 文件 | 导出 | 说明 |
|---|---|---|
| `src/platform.js` | `h, Fragment, useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef, setPluginContext, getPluginContext` | 唯一接触 react/宿主的文件 |
| `src/i18n.js` | `zh, en, NS` | 内联字典（`t` 由宿主 locale 注入，插件不自造） |
| `src/styles.js` | `CSS, ensureStyles()` | 全部样式（注入 `<style>`） |
| `src/api.js` | `resolveProject, readStatus, readDiff, readFile, writeFile, listDirectory, addRoot, removeRoot, describeError` | Host RPC 封装（超时/取消/错误归一） |
| `src/store.js` | `MODE, usePref, useLatestGuard` | 显示偏好持久化 + 请求序号守护 |
| `src/util/paths.js` | `basename, dirname, segments, parentChain, naturalCompare, buildTree, compactChain, flattenTree, collectDirPaths, matchesFilter, formatCount` | 纯函数，必须可单测 |
| `src/util/diff.js` | `buildUnifiedRows, buildSplitRows, highlightWordDiff, diffStats, budgetRows, pairChangedRuns, MAX_DIFF_ROWS` | **纯函数**，必须可单测 |
| `src/ui/Icon.js` | `Icon` 组件 + `StatusLetter` | 内联 SVG 图标（不依赖 primitives） |
| `src/ui/Menu.js` | `PopupMenu, MenuItem, MenuLabel, MenuSeparator` | 轻量下拉菜单 |
| `src/components/States.js` | `EmptyState, LoadingState, ErrorState, SkeletonRows, InlineNote` | 空/加载/错误/骨架 |
| `src/components/DiffView.js` | `DiffView` | 统一/并排 diff |
| `src/components/FileEditor.js` | `FileEditor` | 文件模式右栏：可编辑 textarea + 行号 + 脏/冲突态 + 不可编辑占位态 |
| `src/components/ChangesList.js` | `ChangesList` | 「变更」模式的树/列表 |
| `src/components/FileTree.js` | `FileTree` | 「文件」模式的浏览树 |
| `src/components/RootPicker.js` | `RootPicker` | 仓库/根切换器 + 添加外部仓库 |
| `src/components/GitPanelSurface.js` | `GitPanelSurface` | 两个外壳（会话视图 tab / 右侧栏 tab）共用的转发层 |
| `src/components/Panel.js` | `Panel` | 根布局：工具条 + 分栏 + 键盘 + 拖拽 |
| `src/index.js` | `apply(ctx)`、`name`、`inject` | 注册入口 |

## 2. 数据契约（Host RPC 返回的形状；见 `../../_recon/notes/architecture.md` §3）

```ts
type RpcResult<T> = { ok: true, value: T } | { ok: false, error: { code: string, message: string, details: object } }

interface Root {
  id: string; path: string; repoRoot: string | null; name: string
  kind: 'primary' | 'discovered' | 'extra'
  isGit: boolean
  branch?: string | null; head?: string | null; upstream?: string | null
  ahead?: number; behind?: number; dirty?: number
  error?: string | null
}

interface FileEntry {
  path: string          // 相对 repoRoot，正斜杠
  status: 'M'|'A'|'D'|'R'|'C'|'T'|'U'|'?'|'!'
  staged: boolean; unstaged: boolean; untracked: boolean; conflicted: boolean
  oldPath?: string | null
  adds: number; dels: number; binary: boolean
}

interface StatusResult {
  repoRoot: string; branch: string | null; head: string | null; detached: boolean
  upstream: string | null; ahead: number; behind: number
  files: FileEntry[]
  counts: { total: number; staged: number; unstaged: number; untracked: number; conflicted: number }
  truncated: boolean
}

interface DiffLine { kind: 'ctx'|'add'|'del'; oldLine?: number; newLine?: number; text: string; noNewline?: boolean }
interface Hunk { header: string; section: string; oldStart: number; oldLines: number; newStart: number; newLines: number; lines: DiffLine[] }
interface DiffResult {
  kind: 'text'|'binary'|'oversized'|'empty'|'error'|'submodule'|'deleted'|'directory'
  hunks: Hunk[]; stats: { adds: number; dels: number }
  language?: string; message?: string; truncated?: boolean; newFile?: boolean
}

interface FileResult {
  kind: 'text'|'binary'|'oversized'|'missing'|'directory'|'other'|'error'
  text?: string; size: number; language?: string; eol?: 'crlf'|'lf'; lines?: number; message?: string
}

interface TreeResult { entries: { name: string; path: string; type: 'dir'|'file'|'other' }[]; truncated: boolean }
```

## 3. 组件 props 契约（由 `Panel.js` 传入，禁止改动形状）

### `<ChangesList />`
```js
{
  status,            // StatusResult | null
  loading,           // boolean
  error,             // string | null
  selectedPath,      // string | null
  onSelect,          // (entry: FileEntry) => void
  filter,            // string
  onFilterChange,    // (value: string) => void
  collapsedGroups,   // { staged?: boolean, unstaged?: boolean, untracked?: boolean, conflicted?: boolean }
  onToggleGroup,     // (group: string) => void
  t,                 // (key, params?) => string
}
```
行为：把 `status.files` 按 冲突 / 已暂存 / 未暂存 / 未跟踪 分组（同一文件可同时出现在已暂存与未暂存组，
VSCode 的 MM 就是这样），每组内按路径构建**目录树**（单子节点链折叠成 `a/b/c`）；

### `<FileTree />`
```js
{
  rootPath,          // string  —— 浏览根（绝对路径）
  selectedPath,      // string | null —— 相对 rootPath
  onSelectFile,      // (relPath: string) => void
  filter,            // string
  onFilterChange,    // (value: string) => void
  loadDir,           // (relPath: string, signal) => Promise<TreeResult>
  t,
}
```
自带展开状态与目录缓存；点文件只回调，不自己取内容。

### `<DiffView />`
```js
{
  diff,              // DiffResult | null
  loading,           // boolean
  error,             // string | null
  path,              // string | null   —— 显示用
  entry,             // FileEntry | null —— 取 status/oldPath/adds/dels
  view,              // 'unified' | 'split'
  wrap,              // boolean
  onRetry,           // () => void
  t,
}
```

### `<FileEditor />`
```js
{ record, text, loading, error, path, wrap,
  dirty, busy, conflict, savedAt, saveError,
  onChange(text), onSave(), onOverwrite(), onReload(), onRetry(), t }
```
- `record` 是 `file/read` 的原始结果（`kind/size/language/eol/bom/hash`）；`text` 是**草稿内容**，优先于 `record.text`
- `dirty` = 草稿与上次读/存的内容不同；`conflict` 非空 ⇒ 渲染「重新加载 / 覆盖保存」两条显式动作
- `kind !== 'text'` 时渲染占位态，**不出现输入框**

### 编辑器与保存的不变量（宿主 `file/write`）

1. `file/read` 返回 `hash`（原始字节 sha1）与 `bom`/`eol`；文本**一律 LF 归一**返回。
2. `file/write` 必须带 `expectedHash`；与磁盘当前内容不一致 → `conflict`（含 `details.currentHash`）。
3. 只有 `force: true` 才跳过哈希校验 —— 它只由用户点「覆盖保存」触发，客户端不得自行使用。
4. 写入是原子的：同目录临时文件 → `rename`，失败不留残文件。
5. 保存时按 `eol`/`bom` 还原，避免伪 diff；混合换行按 LF 处理（唯一确定的行为）。

### `<States.* />`
```js
EmptyState({ icon, title, description, actions, t })
LoadingState({ label, t })
ErrorState({ message, onRetry, t })
SkeletonRows({ rows })
InlineNote({ tone: 'info'|'warn'|'error', children })
```

## 4. 样式契约

- 所有 class 以 `dgp-` 开头，禁止全局选择器、禁止 `!important`。
- 颜色/圆角/字体/间距**只用** `styles.js` 里已定义的 `--dsw-*` / `--ds-*` 变量（token 见 `_recon/notes/ui-design.md` §2）。
- 0.5px 发丝线：`border-bottom: .5px solid var(--dsw-alias-border-l3)`。
- 行数据要带稳定钩子：`data-dgp-entry` / `data-dgp-path` / `data-dgp-row`。

## 5. CSS class 词汇表（`styles.js` 保证提供，组件只许引用这些）

样式全部由 Lead 在 `src/styles.js` 里实现。组件**只能**使用下面列出的 class；需要新 class 先跟 Lead 说。

### 布局骨架
`dgp-root`（面板根，flex column，height 100%）、`dgp-toolbar`、`dgp-tbar-row`、`dgp-spacer`、
`dgp-body`、`dgp-pane-left`、`dgp-pane-right`、`dgp-divider`（拖拽条，`data-dragging`）、`dgp-scroll`

### 控件
`dgp-btn`（`data-variant`: `primary|ghost|danger`，`data-size`: `sm`）、`dgp-iconbtn`、
`dgp-seg` + `dgp-seg-btn[data-active]`、`dgp-input`、`dgp-search`、`dgp-kbd`、`dgp-hint`、`dgp-num`
`dgp-pill` + `dgp-pill-badge[data-kind=primary|discovered|extra]` + `dgp-pill-branch` + `dgp-pill-count`
（仅文件模式的浏览根选择器）

### 变更模式的「储存库」区
`dgp-changes`（左栏容器：储存库 + 提交框 + 列表）、`dgp-repolist`、`dgp-repolist-head`、
`dgp-repolist-toggle[data-dgp-repolist-toggle][data-open]`、`dgp-repolist-title`、
`dgp-repolist-rows`、`dgp-repo-row[data-dgp-repo][data-active]`、`dgp-repo-branch`、
`dgp-row-action[data-dgp-repo-remove]`（仅外部仓库）、`dgp-addform` + `dgp-addform-actions`

### 左侧列表 / 树
`dgp-list`、`dgp-level`（ul）、`dgp-item`（li）、`dgp-row`（button；`data-kind=dir|file`；`data-active`）、
`dgp-caret[data-open]`、`dgp-status-letter[data-status=M|A|D|R|C|T|U|?]`、`dgp-name`、`dgp-name-dir`、
`dgp-sub`（弱化父路径）、`dgp-meta`、`dgp-add`、`dgp-del`、
`dgp-group`、`dgp-group-head`、`dgp-group-caret[data-open]`、`dgp-group-title`、`dgp-group-count`、
`dgp-note[data-tone=info|warn|error]`、`dgp-empty`

### 右侧查看器
`dgp-viewer`（查看器根，flex column height 100%）、`dgp-viewer-head`、`dgp-viewer-title`、
`dgp-viewer-sub`、`dgp-viewer-actions`、`dgp-scroll`

### diff
`dgp-diff`、`dgp-diff-row[data-kind=add|del|ctx]`、`dgp-diff-gutter`、`dgp-ln[data-side=old|new]`、
`dgp-marker`、`dgp-diff-text`、`dgp-diff-mark`（词级高亮 `mark`）、`dgp-diff-note`、
`dgp-diff-columns`（split 双列容器）、`dgp-diff-col[data-side=old|new]`、`dgp-diff-cell[data-kind=add|del|ctx]`、
`dgp-hunk`、`dgp-hunk-head`、`dgp-hunk-section`、`dgp-diff-truncated`

### 文件编辑器
`dgp-viewer-editor`、`dgp-editor[data-wrap]`、`dgp-editor-gutter`、`dgp-editor-ln`、
`dgp-editor-input`（textarea）、`dgp-dirty`、`dgp-dirty-dot[data-dirty]`、`dgp-editor-saved`

### 状态位
`dgp-state`、`dgp-state-icon`、`dgp-state-title`、`dgp-state-desc`、`dgp-state-actions`、
`dgp-skeleton`、`dgp-skel-row`、`dgp-inline-note[data-tone=info|warn|error]`

### 菜单
`dgp-menu`、`dgp-menu-item[data-checked=true]`、`dgp-menu-label`、`dgp-menu-sep`、`dgp-menu-scrim`

### 通用
`dgp-ico`（所有 SVG 图标自带）、`dgp-oneline`（单行省略）、`dgp-mono`（等宽字体）

## 6. 尺寸/密度（写样式时的硬指标）

| 项目 | 值 |
|---|---|
| 面板 header / 查看器 header | 38px 高，`border-bottom: .5px solid var(--dsw-alias-border-l3)` |
| 列表行 | min-height 30px（变更行 30px，树行 30px），`padding: 0 10px`，`radius-md` |
| 分组头 | 28px 高，11px/500 字重，`label-tertiary` 色 |
| diff 行 | 22px（`min-height:22px; line-height:22px`） |
| 图标按钮 | 28×28，内部 SVG 15×15，`radius-sm` |
| 列表缩进 | 每层 14px（用 `--dgp-depth` 变量 + `padding-left: calc(10px + var(--dgp-depth) * 14px)`） |
| 字号 | 列表/正文 13px（`--dsh-content-font-size-secondary,13px`）；diff/代码 `--dsw-font-markdown-code-block`；分组头/计数 11px |
| 圆角 | 行/按钮 `--dsw-radius-sm`，分组卡 `--dsw-radius-md` |
| hover | `background: var(--dsw-alias-interactive-bg-hover)` |
| 选中 | 同 hover 底色 + `box-shadow: inset 2px 0 0 var(--dsw-alias-state-business-primary)` |
| 焦点 | `outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px` |
