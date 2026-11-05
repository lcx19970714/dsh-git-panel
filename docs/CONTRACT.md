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
| `src/store.js` | `MODE, MODES, usePref, useLatestGuard, readRemoteAccount, saveRemoteAccount` | 显示偏好持久化 + 每个工作区记住的远端账号 + 请求序号守护 |
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
| `src/components/RemotePane.js` | `RemotePane` | 「远端」页签左栏：账号 chip + 仓库列表 + 行内拉取 |
| `src/components/RemoteDetail.js` | `RemoteDetail` | 「远端」页签右栏：仓库概况 + 分支区 + Issues + PR |
| `src/components/BranchList.js` | `BranchList` | 远端仓库详情的「分支」区：本地/远端状态 + 行内操作（切换 / 建跟踪分支 / 复制 / 打开网页 / 删除本地 / 删除远端） |
| `src/index.js` | `apply(ctx)`、`name`、`inject` | 注册入口 |

## 2. 数据契约（Host RPC 返回的形状；端点清单见 `docs/ARCHITECTURE.md` §3.2）

```ts
type RpcResult<T> = { ok: true, value: T } | { ok: false, error: { code: string, message: string, details: object } }

interface Root {
  id: string; path: string; repoRoot: string | null; name: string
  kind: 'primary' | 'discovered' | 'extra'
  isGit: boolean
  branch?: string | null; head?: string | null; upstream?: string | null
  ahead?: number; behind?: number; dirty?: number
  hidden: boolean       // 用户在储存库里隐藏了它（持久化；primary 永远为 false）
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
  pushed: boolean | null          // 远端有没有 HEAD 这个提交：true=一致、false=要推、null=无从判断（无 origin / 游离 HEAD / 空仓库）
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

interface BranchInfo {
  name: string
  local: boolean
  current: boolean
  remote: boolean | null          // null = 远端名单没读到（未知），不是「远端没有」
  default: boolean
  protected: boolean
  remoteSha: string | null
  upstream: string | null
  ahead: number; behind: number
  upstreamGone: boolean           // 本地 %(upstream:track) 报 gone
  upstreamMissing: boolean        // 上游分支名不在远端名单里（远端已删）
  remoteUpdated: boolean          // 远端 sha ≠ 本地 refs/remotes/origin/<name>
}

interface RemoteBranchesResult {
  accountId: string; fullName: string; provider: string; htmlUrl: string
  defaultBranch: string
  remoteKnown: boolean; localKnown: boolean; truncated: boolean
  counts: { total: number; local: number; remoteOnly: number; localOnly: number }
  branches: BranchInfo[]
  local: { rootPath: string; current: string | null; detached: boolean } | null
  failures: { section: 'local'|'remote'; message: string }[]
}

interface RepoState {                    // branches/list 的 state：分支菜单要的全部现状，跟名单同一次往返
  head: string | null                    // 短 sha；null = unborn（空仓库还没有第一个提交）
  detached: boolean
  unborn: boolean
  inProgress: null | 'merge' | 'rebase' | 'cherry-pick' | 'revert'
                                         // 读 .git/MERGE_HEAD、rebase-merge / rebase-apply、CHERRY_PICK_HEAD、REVERT_HEAD、sequencer
  dirty: { total: number; staged: number; unstaged: number; untracked: number; conflicted: number }
                                         // 与 status.counts 同形，但不做行数统计（菜单只要计数）
}

interface BranchesResult {               // branches/list 的返回：refs/heads 与 refs/remotes 按名字合成一条，跳过 origin/HEAD
  branches: { name: string; local: boolean; current: boolean; remote: string | null
              upstream: string | null; ahead: number; behind: number; upstreamGone: boolean }[]
  current: string | null
  state: RepoState
}

interface BranchCreateRequest {          // 三个字段全部必填，缺一个就 bad-request
  rootPath: string
  name: string
  base: string                           // 'HEAD' 或任意可解析的 ref（本地分支名 / origin/x / sha）
  checkout: boolean                      // 建完是否立刻切过去；false = 只建分支，只写 ref、不碰工作区
}

interface BranchCreateResult {
  branch: string; head: string | null
  previousBranch: string | null; previousHead: string | null   // 创建前（detached 时 branch 为 null）
  base: { ref: string; kind: 'head' | 'local' | 'remote' | 'commit'; sha: string }
  switched: boolean
  carried: { total: number; staged: number; unstaged: number; untracked: number; conflicted: number }
                                         // 创建后的工作区脏计数（与 status.counts 同形）
}

interface BranchPushRequest { rootPath: string }   // 只推当前分支、只推 origin，没有别的参数

interface BranchPushResult {
  branch: string; head: string | null; upstream: string | null; output: string
}
```

`branches/list` 的入参没变，仍是 `{rootPath}`（裸仓库明确报 `not-a-repository`）：多返回一个 `state`，
分支菜单就不必再调一次 `status`。`branch/create` 的入参见 `BranchCreateRequest`；它的错误码如下
（全部带可操作文案；全部发生在动手之前 —— 撞车时什么都没做，所以菜单可以拿另一组参数直接重试，
这正是「不新增预检端点」的落点）：

| code | 场景 |
|---|---|
| `bad-branch` | 名字非法 |
| `branch-exists` | 本地已有同名分支 |
| `base-not-found` | base ref 不存在（例如 `origin/dev` 还没 fetch） |
| `unborn` | 空仓库（还没有第一个提交）且 `checkout:false`：只能创建并切换 |
| `in-progress` | merge / rebase / cherry-pick / revert 进行中且 `checkout:true`（git 的 `switch` 会硬拒绝） |
| `would-overwrite` | base≠HEAD、脏文件与 base 的差异重叠且 `checkout:true`：message 内联文件清单（最多 8 个 + 另有 N 个）并提示两个出口，`details` 为 `{ base, tracked: string[], untracked: string[] }` |

`branch/push`（`BranchPushRequest` → `BranchPushResult`）只做一件事：`git push --set-upstream origin <当前分支>`，
凭据用本机 git（与 `branch/pull` 的 fetch 同口径，插件不掺和令牌）。错误码：
`detached-head` / `unborn` / `no-remote` / `git-auth-failed`（远端拒绝：本机没有可用凭据）/
`not-fast-forward`（远端有你没有的提交，提示先「拉取当前分支最新代码」）。

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

### `<RepoList />`（「储存库」区 + 分支菜单）
```js
{
  roots,                          // Root[]
  activeRootId,                   // string | null
  open,                           // boolean —— 折叠状态
  onToggleOpen(),                 // 折叠 / 展开
  onSelect(root),                 // 只选中仓库，不打开分支菜单
  onAdd(dir),                     // 添加外部仓库
  onHide(root), onUnhide(root), onRemove(root),
  onLoadBranches(root),           // => Promise<BranchesResult>（branches / current / state）
  onSwitchBranch(root, name),     // 切换已有分支
  onTrackBranch(root, branch),    // 仅远程的行：建本地跟踪分支并切换
  onPullBranch(root),             // 拉取当前分支最新代码（branch/pull，只允许快进）
  onFetchBranches(root),          // 获取远程更新（remote/fetch，只读）=> Promise<BranchesResult>
  onCreateBranch(root, request),  // request = { name, base, checkout }
  t,
}
```
- `onCreateBranch` 的 `request` 三个字段**全部必填**：`base` 是 `'HEAD'` 或任意可解析的 ref（本地分支名 /
  `origin/x` / sha），`checkout` 是「创建后是否立刻切过去」（`false` = 只建分支，只写 ref、不碰工作区）。
  组件不自己补默认值：菜单上看到什么就发什么，`branch/create` 缺字段直接回 `bad-request`。
- 菜单要的现状（`state.dirty` 的改动计数、`state.inProgress` / `state.unborn`）由 `onLoadBranches` 一并返回，
  组件**不另调** `status`：一次 `branches/list` 就能把菜单画全；切换 / 创建成功后由 Panel 重新拉一次 `state`。
- 创建失败按 `error.code` + `error.details` 渲染，不吞错误：`would-overwrite` 用 `details.tracked` /
  `details.untracked` 列出重叠文件，给两个**零风险出口** ——「改为从当前分支创建」（把 base 拉回 `HEAD`，
  重发原请求）与「只建分支」（`checkout:false` 重发，只写 ref、不碰工作区）；`in-progress` 也只剩「只建分支」；
  `unborn` 反过来只剩「创建并切换」（空仓库没有可指的 `HEAD`，`git branch` 会失败）。
- 组件自身不做 git 调用，也不判断「会不会撞车」：撞车判定在 `branch/create` 内部、与执行共用同一份代码，
  客户端只负责把 `code` 翻译成可操作的出口；插件不走 stash、不做 force，不会制造冲突现场。

### `<BranchList />`（远端仓库详情的「分支」区）
```js
BranchList({
  selection,                     // { accountId, fullName, name }
  state,                         // { loading, error, data } | null；data 见 RemoteBranchesResult
  onReloadBranches,              // () => Promise<{ok:true}|{ok:false,error,code}>
  onFetchBranches,               // git fetch --prune（只更新远端跟踪引用）
  onSwitchBranch(branch),        // 本地已有 → 切换
  onTrackBranch(branch),         // 仅远端 → 建本地跟踪分支并切换
  onDeleteLocalBranch(branch, force),
  onDeleteRemoteBranch(branch),
  onOpenUrl(url),
  t
})
```
回调统一返回 `{ ok: true }` 或 `{ ok: false, error, code }`；只有 `code === 'branch-unmerged'` 时
组件才在确认框里露出「强制删除」，其它失败就地显示原因。组件自身不做网络/ git 调用。

## 4. 样式契约

- 所有 class 以 `dgp-` 开头，禁止全局选择器、禁止 `!important`。
- 颜色/圆角/字体/间距**只用** `styles.js` 里已定义的 `--dsw-*` / `--ds-*` 变量（主题令牌清单见 `docs/ARCHITECTURE.md` §4.3）。
- 0.5px 发丝线：`border-bottom: .5px solid var(--dsw-alias-border-l3)`。
- 行数据要带稳定钩子：`data-dgp-entry` / `data-dgp-path` / `data-dgp-row`。
- 分支创建区的可测试属性见 §5（`data-dgp-branch-base` / `-checkout` / `-dirty` / `-blocked` / `-from-head` / `-only`）：
  `test/components.test.mjs` 只按这些属性定位，不假设 DOM 嵌套。

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
`dgp-repolist-rows`、`dgp-repo-row[data-dgp-repo][data-active][data-hidden]`（只选中仓库）、
`dgp-repo-branch[data-dgp-branch]`（行最右侧；只有点它才打开分支菜单）、
`dgp-branch-create[data-dgp-branch-create]`（菜单底部：名字 + 起点选择 + 切换勾选 + 现状提示 + 撞车警告 + 两个出口）、
`dgp-repolist-hidden[data-dgp-repolist-hidden]` + `dgp-repolist-hidden-count`（展开/收起已隐藏的仓库）、
`dgp-row-action[data-dgp-repo-hide]`（非 primary 可隐藏）、`dgp-row-action[data-dgp-repo-unhide]`（已隐藏的行）、
`dgp-row-action[data-dgp-repo-remove]`（仅外部仓库）、`dgp-addform` + `dgp-addform-actions`

分支创建区的可测试属性（测试按属性定位，不依赖 class）：
`[data-dgp-branch-name]`（新分支名输入框）、
`[data-dgp-branch-create-submit]`（创建按钮；勾着「创建后切换」时文案是「创建」，否则是「只建分支」）、
`[data-dgp-branch-base]`（起点选择器，标签是「从」：`当前分支 main` / `dev（本地）` / `origin/dev（远端）`；
`title` 里给出整句话解释）、
`[data-dgp-branch-base-note]`（选了非当前分支时出现的解释句，属性值是所选 ref；文案随工作区脏不脏变化）、
`[data-dgp-branch-checkout]`（「创建后切换」勾选框；`inProgress` 非空时禁用并默认不勾）、
`[data-dgp-branch-dirty]`（现状提示行，属性值是 `dirty`（工作区脏，文案 `当前 main · 3 处改动（1 已暂存）`）
或 `in-progress`（合并 / 变基等进行中，文案解释为什么不能切换））、
`[data-dgp-branch-same-remote]`（输入的名字命中仅远端分支时出现，属性值是远端 ref，如 `origin/topic`）、
`[data-dgp-branch-blocked]`（撞车警告块：重叠文件清单 + 两个零风险出口）、
`[data-dgp-branch-from-head]`（「改为从当前分支创建」按钮，把 base 拉回 `HEAD` 后重发）、
`[data-dgp-branch-only]`（「只建分支」按钮，`checkout:false` 重发）

### 远端仓库详情 · 分支区
`dgp-branch-section`（分区根）、`dgp-branch-head`、`dgp-branch-title`、`dgp-branch-summary`、
`dgp-branch-head-actions`、`dgp-branch-filter`（筛选框，复用 `dgp-input`）、
`dgp-branch-status[data-tone=info|warn|error]`、`dgp-branch-statuses`、
`dgp-branch-list`（ul）、`dgp-branch-item[data-current][data-busy]`（li）、`dgp-branch-row[data-dgp-branch-row]`（行主按钮）、
`dgp-branch-ico[data-current]`、`dgp-branch-name`、`dgp-branch-tags`、
`dgp-branch-tag[data-kind=local|remote|default][data-active][data-unknown]`（亮 = 有，暗 = 没有）、
`dgp-branch-track`（`↑n ↓m`）、`dgp-branch-more[data-dgp-branch-more]`（行尾 ⋯）、
`dgp-branch-confirm[data-dgp-branch-confirm=local|remote]` + `dgp-branch-confirm-text` + `dgp-branch-confirm-actions`、
`dgp-branch-hint`（未克隆 / 截断等提示）、`dgp-branch-empty`

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
