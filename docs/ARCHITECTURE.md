# dsh-git-panel —— DSH 里的「Git 变更 / 文件浏览」面板

[![GitHub](https://img.shields.io/badge/GitHub-lcx19970714%2Fdsh-git-panel-181717?logo=github)](https://github.com/lcx19970714/dsh-git-panel)
[![CI](https://github.com/lcx19970714/dsh-git-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/lcx19970714/dsh-git-panel/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

> 这里是**深入文档**（平台约束、接线细节、反兜底约定、排错）。面向使用者的完整介绍与安装说明见仓库首页 [README.md](../README.md)。

给 DSH Web/桌面端加一个 **VSCode 风格**的 Git 面板：左侧看改动（或直接浏览文件树），
右侧看 diff（或直接编辑文件并保存）。装在**右侧栏**里，按会话的项目目录工作。

## 安装

普通用户走**在线安装**：DSH → 侧边栏「插件」→「安装第三方插件」→ 填 `github:lcx19970714/dsh-git-panel`，
或命令行 `dsh plugin add github:lcx19970714/dsh-git-panel`。仓库根就是 npm 包根，pnpm 直接能装。

改代码的开发流程用本地联接：

```bash
git clone https://github.com/lcx19970714/dsh-git-panel.git
cd dsh-git-panel
node scripts/install-profile.mjs          # 加 --dry-run 可先看它会改什么
```

它会做三件事（幂等，可重复执行）：

1. 在 profile 的 `node_modules` 下建目录联接 → 指到仓库根（Windows 用 junction，免管理员权限）
2. 把 `dsh-git-panel` 写进 profile 的 `dependencies`（`link:` 形式）
3. 把 `dsh-git-panel` 追加进 `dsh.profile.bundles`

**然后重启一次 DSH**（宿主半体是 ESM，只在启动时加载）。之后在任意会话里：

- 点**标题栏最右侧的「变更」按钮**，或右侧栏「+」→「Git 变更」
- 卸载：`node scripts/install-profile.mjs --uninstall`

> 需要 Node ≥ 22。安装脚本按自身位置定位插件目录，克隆到哪个盘都行。


- 目标插件 ID（tab 类型 id）：`dsh-git-panel`
- tab kind：`git`（`openTab("git")` 的寻址名）
- 主面板 id：`git-changes`（面板列表里的条目，与 tab kind 是两套命名空间）
- RPC 通道：`/api/dsh-git/*`（插件自有通道，不与平台保留的 `/api` 冲突）

**两个入口，同一个面板：**

| 入口 | 位置 | 说明 |
|---|---|---|
| **会话标题栏按钮（常驻）** | 标题栏**最右侧**、紧挨「打开侧边栏」那些按钮（`utilities` 槽），SVG + 「变更」小按钮 | 点一下打开右侧栏的 Git 页签；侧栏收起时也能点（`openContent` 会自动展开侧栏） |
| 会话右侧栏 tab | 右侧栏「+」→「Git 变更」 | 面板本体，session 作用域，直接用当前会话的 `sessionId` |

标题栏按钮注册在 `conversation.session.header.utilities`（list 槽）。会话标题栏四段依次是
`lineage`(single) → `actions`(list) → `utilities`(list) → `corner`(single，侧栏开关)，
`utilities` 就是整行最右侧区域（它 `:empty` 时 `display:none`，加进去才会出现）：

```js
ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
  name: 'conversation.session.header.utilities',
  id: 'git-changes', order: 30, locale: NS,
  inject: () => ({ openPanel: (sessionId) => ctx.sidebarRight.openTabIn(sessionId, 'git') })
}, GitHeaderAction))
```

点击调用 `sidebarRight.openTabIn(sessionId, 'git')`；布局 store 的 `openContent` 第一件事就是
`planSetExpanded(state, true)`，所以侧栏处于收起状态时会自动展开并聚焦该页签。
Git 变动与「当前会话所在项目」强绑定，所以只挂在 session 作用域的右侧栏，不做独立面板，也不占会话区顶部标签。

实现 = `ctx.sidebarRightTabs.register({ id, kind, title, guide })` + `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id })`，
body 的 `key` 必须等于 tab 类型的 `id`（不是 `kind`）。
## 1. 它解决什么

DSH 的项目是以**会话的工作目录（cwd）**为中心的，但「git 仓库」和「项目目录」并不是一一对应的。
这个面板同时支持三种真实形态：

| 形态 | 例子 | 面板行为 |
|---|---|---|
| ① 项目根就是一个仓库 | `H:\proj`（`H:\proj\.git`） | 一个 **项目** 根，直接显示该仓库的变更 |
| ② 项目里每个子目录各是一个仓库 | `H:\proj\a\.git`、`H:\proj\b\.git`，`H:\proj` 本身不是仓库 | 一个 **项目** 浏览根（可浏览整个 project 的文件）+ 若干 **发现** 根（各自的变更） |
| ③ 想额外盯一个外部仓库 | `D:\opensource\xxx` | 用户手动 **添加外部仓库**，与项目内仓库并列、按项目分别记忆 |

> 形态 ② 的「项目浏览根」很关键：没有它，多仓库项目就没法在项目层面浏览文件。
> 形态 ③ 的配置存在 `~/.dsh/dsh-git-panel/roots.json`，按项目根分组，不会污染仓库本身。

### 仓库发现规则（`host/git.js: discoverRepos`）

判定依据只有一条：**目录里有 `.git`（目录或 gitfile）就是一棵工作树**，它的工作树根就是仓库；
找到之后不再深入（里面属于同一个工作树）。

| 情况 | 行为 |
|---|---|
| 项目根在某个仓库内部 | 显示那个仓库（向上 `rev-parse --show-toplevel`；项目根是仓库子目录也算） |
| 子目录里有仓库 | 最多向下 4 层，每个工作树各成一根（`a/b/c/repo` 也算） |
| `vendor` / `third_party` 里的仓库 | 照常扫描（依赖以仓库形态检出的情况） |
| 目录联接 / 符号链接 | 按真实目录处理，`realpath` 环检测 + 指向上级目录的链接跳过 |
| `node_modules` / `dist` / `target` 等 | 整棵跳过 |
| 子模块 / worktree | `.git` 是文件，照常识别为一棵独立工作树 |
| 裸仓库 | 没有工作区，不列入根（项目根本身是裸仓库时给告警） |
| 有 `.git` 却读不出工作树 | 只告警并跳过，不造一个永远报错的假根 |
| 扫描达到上限 | 返回 `truncated`，面板提示「可能还有仓库没有列出」 |

`discoverRepos` 的返回值是 `{ repos, truncated, scanned }`；`truncated` 让调用方能把「扫到上限」
变成用户可见的告警，而不是静默少列。

## 2. 功能

**变更模式（默认）**

- 按 **冲突 / 已暂存 / 未暂存 / 未跟踪** 四组展示，同一文件可同时出现在「已暂存」和「未暂存」（`MM` 文件，与 VSCode 一致）
- 目录树自动折叠单链（`src/features/auth` 一行显示），支持逐级展开
- 每行：状态字母（`M/A/D/R/C/T/U/?`）+ 文件名 + 弱化父路径 + `+N/−N`
- 右侧 diff：**统一 / 并排** 两种视图、自动换行开关、上下文行数（1/3/6/12）、忽略空白差异
- 词级高亮（同一行内只标出真正变化的片段）、`\ No newline at end of file`、二进制/过大/子模块/纯重命名都有专门状态
- 双态文件（同时 staged + unstaged）在筛选栏右侧出现 **未暂存/已暂存** 切换

**文件模式（可编辑）**

- 左侧懒加载目录树；右侧是**编辑器**：`textarea` + 行号列，直接改、`Ctrl/Cmd+S` 保存
- 未保存改动：标题栏「未保存」+ 文件树脏点；切到别的文件再切回来，改动还在（草稿按路径留在面板内存里）
- 保存冲突时给两个**显式**选择：`重新加载`（丢弃本地）/ `覆盖保存`（`force`）—— 不存在"静默覆盖"
- `Tab` / `Shift+Tab` 缩进反缩进、`Enter` 沿用上一行缩进（走 `setRangeText`，不破坏原生撤销栈）
- 换行与 BOM 保存时原样还原，不会产生"整文件都变了"的伪 diff
- 筛选只作用于「已展开的目录」（v1 不做服务端全文搜索，界面有明确提示）

**通用**

- 变更区顶部是「储存库」列表（VS Code 的 Repositories）：每个仓库一行，点选切换下方变更区，可折叠；外部仓库行尾可移除，标题行 `+` 添加。当前分支是贴在行最右侧的按钮，点仓库名只选中仓库，只有点这个按钮才打开分支菜单；菜单里可切到已有分支，也可在底部输入名字创建新分支并立刻切过去。用不上的根（测试夹具、vendor 仓库）可以在行尾隐藏：只是从储存库里收起，仓库本身不动，配置持久化在 `roots.json` 的 `hidden` 段；标题行的眼睛按钮展开「已隐藏」，在那里取消隐藏。项目根本身不给隐藏入口。文件模式固定浏览项目根，没有根选择器
- 变更列表有两种显示方式，设置页与 `⋯` 菜单共用同一个偏好：**列表**（一行一个文件，文件名为主体、路径弱化在后，路径先截断）/ **树形**（按文件夹展开折叠）
- 未跟踪文件有两种归属：**并进未暂存**（默认，VS Code 的 Changes 里同时有改动和新文件）或**单列未跟踪组**。批量按钮跟着分组内容走：合并模式是「全部暂存」（`git add -A`），分开模式才是「暂存已跟踪改动」（`git add -u`）+「只暂存新文件」（逐路径 `git add`）
- 提交框只有两行：输入框（右上角生成按钮）+ 一行「状态 + 提交按钮」。输入框随内容自动长高（两行起步、约七行封顶，超出改为内部滚动），生成的说明有好几行时不会被压成两行只露一截
- 状态行按状态行按 **结果 > 生成中 > 提交中 > 不能提交的原因** 只显示一件事，成功/失败/进度都不会把下面的变更列表顶下去；不能提交时说清是「没有已暂存的改动」还是「填写提交说明后提交」，不做无声禁用
- 提交成功的结果（`已提交 abc1234 · 主题`）显示在同一条状态行里，8 秒后自动消失，开始写新说明时立刻让位；错误提示留着等你动手
- 生成提交说明是模型调用：生成中笔形按钮换成转圈、状态行显示「正在生成… 3.2s」，输入框与提交按钮同时禁用（避免模型结果覆盖刚打的字）；失败时提示里带**服务端返回的真实原因**（含 provider/model）。宿主侧有 60s 超时，输出上限 1024 并取模型最低推理档（推理型模型被小上限吃光 token 会返回空文本）
- **版本号 chip**（当前提交短 SHA）：点一下 = 检测更新（git fetch），结果显示在版本号**左边**同一行（「已是最新 / 落后 N 个 / 领先 N 个」），不单独占一行；空间不够时截断，全文在 title 里
- **打开 Git 仓库**按钮：按 remote.origin.url 转成 https 在新标签打开；本地路径类远端没有网页，按钮自动禁用
- 手动刷新在「⋯」菜单的「立即刷新」里，`R` 键同效；可选 8s 自动刷新（仅在窗口可见且聚焦时跑）
- 左列宽度可拖拽（键盘 `←/→` 也能调），宽度与所有显示偏好持久化
- `/` 聚焦筛选、`Esc` 清空筛选、`↑↓` 在列表内移动、`Enter` 打开
- 深浅色自动跟随 DSH 主题（全部取色自 `--dsw-*` 令牌，零硬编码色值）
- 圆角只用 `--dsw-radius-*` 令牌：宿主实际值是 xs=4 / sm=8 / md=12 / lg=16。控件（Tab、列表行、按钮、输入框、菜单项）统一 `xs`，浮层菜单这种大面用 `sm`；不要用 `md`/`lg`，24~26px 高的控件上会显得过圆

## 3. 架构

```
<仓库根>                      ← 仓库根就是 npm 包根，pnpm / github: 安装才能直接吃到
├─ package.json             包清单：main / exports / dsh.client / dsh.bundle
├─ index.js                 宿主入口：ctx.inject(['connection']) + 精确 Fetch 路由
├─ host/
│  ├─ git.js                零依赖 git 引擎（spawn git；porcelain=v2 -z 解析、unified diff、目录、仓库发现、文件读写）
│  ├─ remotes/              GitHub / Gitee 远端能力（令牌存 DSH 凭据服务，克隆不落盘令牌）
│  │  ├─ index.js           门面：账号增删改 + 组装下面几块
│  │  ├─ providers.js       平台差异表（鉴权/路径/字段归一/PR 能力），加载时校验契约
│  │  ├─ accounts.js        凭据服务里的账号记录（token 不出宿主）
│  │  ├─ repos.js           列仓库 / 仓库详情 / 克隆
│  │  ├─ pulls.js           PR 详情 / 审查 / 合并
│  │  └─ http.js            带超时的请求、错误归一、分页 Link
│  ├─ roots.js              三种根的解析（primary / discovered / extra）
│  └─ config.js             外部根持久化（原子写、损坏自动备份）
├─ src/                     ← 客户端源码（ESM，构建成 client.js）
│  ├─ index.js              apply(ctx)：字典 / tab 类型 / 快捷键 / tab body
│  ├─ platform.js           唯一接触 react 与宿主桥的文件
│  ├─ api.js                宿主 RPC 封装（超时、abort、错误归一）
│  ├─ store.js              显示偏好持久化 + 小 hook
│  ├─ i18n.js               内联 zh/en 字典（文案一律由框架注入的 t 取）
│  ├─ styles.js             全部样式（令牌取色，注入 <style>）
│  ├─ util/{paths,diff,changes,remote,time}.js  纯函数（有单测）
│  ├─ ui/{Icon,Menu}.js     内联 SVG 图标 + 轻量浮层菜单
│  └─ components/           Panel / RepoList / ChangesList / FileTree / DiffView / FileEditor / CommitBox / States
├─ build/build-client.mjs   零依赖微型打包器（ESM → 经典脚本 __ModuleLoader__）
├─ test/                    10 套测试（见下）
├─ scripts/install-profile.mjs  本地开发安装：junction + profile package.json
└─ docs/                    ARCHITECTURE.md（本文）/ CONTRACT.md（客户端模块契约）
```

为什么**没有构建工具**：这台机器上没有 esbuild，而 DSH 的客户端插件必须是**经典脚本**
（`window.__ModuleLoader__.load({id, factory})`，不能是 ESM）。于是自带一个只认本仓库写法的
极小打包器（约 380 行）：把 `src/**` 的 `import/export` 重写成模块表 + 惰性求值，产物仍是纯
经典脚本。它会在写文件前用 `node --check` 校验产物，遇到不支持的语法/循环依赖直接报错，
不会静默产出坏包。

**宿主与客户端的边界**：客户端只做展示与交互，一切文件系统与 git 操作都在宿主侧（插件 host 半体），
通过 35 个 RPC 端点通信。写能力包括 `file/write`（必须带内容哈希）、`index/stage`（暂存/取消暂存）、`commit`（smart commit：有暂存只提交暂存，没有则先全部暂存）和 `branch/create`（从当前 HEAD 建分支并切过去）。远端操作只有一个端点（`remote/fetch`），只做 git fetch（只更新远端跟踪引用，不动工作区与本地分支）
（`runGit` 全程用 `spawn` + 参数数组，不拼 shell 字符串）。

| 端点 | 入参 | 返回 |
|---|---|---|
| `project/resolve` | `{sessionId?} \| {cwd?}` | `{projectRoot, roots[], warnings[]}` |
| `roots/add` / `roots/remove` | `{projectRoot, path}` | 同上 |
| `roots/hide` / `roots/unhide` | `{projectRoot, path}` | 同上；隐藏只持久化「不在储存库里显示」，不动仓库；项目本身报 `cannot-hide` |
| `status` | `{rootPath}` | `{branch, head, detached, upstream, ahead, behind, files[], counts, truncated}` |
| `diff` | `{rootPath, path, staged, untracked, contextLines, ignoreWhitespace}` | `{kind, hunks[], stats, language}` |
| `remote/fetch` | `{rootPath}` | `{url, branch, head, upstream, ahead, behind, fetchedAt}`（执行 git fetch --prune） |
| `file/read` | `{rootPath, path}` | `{kind, text, size, language, eol, bom, hash, lines}`（文本一律 LF 归一） |
| `file/write` | `{rootPath, path, text, expectedHash, eol, bom}` 或 `{…, force:true}` | `{size, mtimeMs, hash}`；哈希不匹配 → `conflict` |
| `index/stage` | `{rootPath, path, action}` | `{path, action}`；`stage` = `git add --`，`unstage` = `git restore --staged --` |
| `index/stage-group` | `{rootPath, scope}` | `{scope}`；整组暂存 / 取消暂存 |
| `branches/list` | `{rootPath}` | `{branches, current}`；一次 for-each-ref 同时读 refs/heads 与 refs/remotes，按分支名合成一条：`{name, local, current, remote, upstream, ahead, behind, upstreamGone}`（`remote` 是远程名或 null，`local:false` 表示只有远程）；跳过 origin/HEAD 这类符号引用 |
| `branch/track` | `{rootPath, remote, name}` | `{branch, head, upstream}`；`git switch -c <name> --track <remote>/<name>`，本地同名分支已存在报 `branch-exists` |
| `branch/switch` | `{rootPath, name}` | `{branch, head}`；`git switch`，工作区怎么处理由 git 决定 |
| `branch/create` | `{rootPath, name}` | `{branch, head}`；从当前 HEAD `git switch -c`，已存在或名字不合法时拒绝，不覆盖已有分支 |
| `accounts/list` | `{}` | `{accounts: [{id, provider, login, label}], providers}`；**不含令牌** |
| `accounts/add` | `{provider, label?, token}` | `{account}`；先用令牌调 `/user` 验证，通过后存进凭据服务 |
| `accounts/update` | `{id, label?, token?}` | `{account}`；改备注名不需要验证，换令牌会先调 `/user` 验证且必须同账号 |
| `accounts/token` | `{id}` | `{id, token}`；只在用户点「显示令牌」时调用，列表接口不含令牌 |
| `accounts/remove` | `{id}` | `{accounts}` |
| `remote/repos` | `{accountId, page?}` | `{repos[], page, hasMore}`；GitHub/Gitee 字段归一成同一形状 |
**写请求约定**：所有带 body 的请求都走 `requestJson()`，它固定设置
`Content-Type: application/json;charset=UTF-8`。fetch 对字符串 body 默认 `text/plain`，
Gitee 会直接回 `406 {"error":"The requested content-type 'text/plain' is not supported."}`。
不要手写 `body: JSON.stringify(...)`。

**外部目录约定**：`roots/add` 只接受「含 .git 的目录」，存的就是用户给的那个路径本身
（不做 realpath 归一、不向上找祖先仓库、不向下扫描子仓库）。因此 `add` 与 `remove` 用的是同一个键，
不存在「两种写法各删一次」的兜底；用户加了仓库里的子目录会被明确拒绝（缺少 .git）。
项目根的多仓库发现（discovered）只作用于**项目根**，不会扩展到外部目录。

**空响应约定**：`readJson()` 对 `204` / 空体返回 `null`（成功但没有响应体）——Gitee 的审查通过接口就是这样。
需要对象/数组的调用方用 `readObject()` / `readArray()`（空体直接报「平台没有返回 X」），
纯写接口直接忽略返回值。任何写操作都不要假设「成功必有 JSON 回包」。

**远端平台鉴权约定**：token 只在 `provider.authorize(url, token)` 一处落地 —— GitHub 放请求头
（`Authorization: Bearer`，URL 保持干净），Gitee 放 `access_token` 查询参数。**新增任何 API 路径都必须经过
`authorize()`**：Gitee 对「无权访问的私有仓库」返回 404 `{"message":"Not Found Project"}`，
漏掉 token 会表现为「仓库不存在」，而不是 401。

| `remote/detail` | `{accountId, fullName, pageSize?}` | `{repo, issues:{total,items}, pulls:{total,items}, failures}`；总数取分页 Link 最后一页，GitHub 的 issue 数会减掉 PR |
| `remote/pr-counts` | `{accountId, fullNames[]}` | `{counts: {fullName: number\|null}, failures}`；每个仓库一次 per_page=1 请求，上限 50 个、并发 6 |
| `remote/pull` | `{accountId, fullName, number}` | `{pull, reviews, capabilities}`；capabilities 说明平台支持哪些审查结论与合并方式 |
| `remote/pull/review` | `{accountId, fullName, number, verdict, body?}` | `{verdict, bodyPosted}`；GitHub 三种结论，Gitee 只有 approve（说明走评论接口） |
| `remote/pull/pass` | `{accountId, fullName, number, body?}` | `{completed, failures}`；按平台能力依次执行审查/测试，部分成功照实返回 |
| `remote/pull/test` | `{accountId, fullName, number}` | `{tested}`；Gitee 专用（POST /pulls/{n}/test，无请求体），GitHub 报不支持 |
| `remote/pull/merge` | `{accountId, fullName, number, method, deleteBranch?}` | `{merged, method, branchDeleted, headBranch}`；不可合并/已合并/非打开状态在宿主侧拦下 |
| `remote/clone` | `{accountId, fullName, cloneUrl, projectRoot, targetName?}` | `{path, name, fullName}`；鉴权只走 `-c http.extraHeader`，不写进 `.git/config` |
| `commit` | `{rootPath, message}` | `{head, subject, includedUnstaged}`；有暂存只提交暂存，没有则先 `git add -A` 再提交 |
| `commit/message` | `{rootPath}` | `{message, model, source}`；有暂存看暂存，否则看未暂存 |
| `models/list` | `{}` | `{models[], failed[]}`；模型来自 DSH 的 `llm` 服务，不读配置文件、不碰密钥 |
| `settings/get` / `settings/set` | `{commitModel?}` | `{commitModel: {provider, model} \| null}`；生成提交说明所用的模型 |
| `tree/list` | `{rootPath, path}` | `{entries[], truncated}` |

所有失败都返回 `{ok:false, error:{code, message, details}}`，宿主 handler 绝不抛错（避免裸 500）。

## 4. 开发

```bash
node build/build-client.mjs          # 构建 client.js（改完 src/ 必跑）
node test/run.mjs                    # 跑全部测试
node test/run.mjs --only client      # 只跑某一套
node scripts/audit-dead-code.mjs     # 死代码体检（CI 也跑：不可达文件 / 没人 import 的导出 / 孤儿样式）
node scripts/verify-live.mjs --port 52460   # 确认运行中的 DSH 真的加载了插件
node scripts/install-profile.mjs     # 装进 desktop profile（幂等）
node scripts/install-profile.mjs --dry-run
```

发版清单：改完代码 → `node build/build-client.mjs` → `node test/run.mjs` →
**同步 README 的「能做什么 / 限制」与 `package.json` 版本号** → 提交推送 → 打 tag 发 Release。

测试包含：

| 套件 | 覆盖 |
|---|---|
| `paths` | 路径/树构建/折叠/过滤/排序 |
| `diff` | hunk 解析、并排配对、词级高亮、行预算 |
| `tree` | 分组规则（`MM` 双组、冲突只进冲突组）、单文件组、树展开 |
| `remote` | 远端地址 → 网页地址（scp/ssh/https/git 形式）、凭据不入地址栏、本地路径 → null |
| `build` | 打包器：产物无残留 import/export、能真跑、循环依赖报错 |
| `git` | git 引擎（需要 `_sandbox/repo` 夹具：`node test/make-fixture.mjs`） |
| `host` | 35 个端点的信封契约、错误码、文件写入（哈希/冲突/原子/EOL 保真）、暂存/取消暂存/提交、分支列表、切换与创建、代码托管账号（令牌存 DSH 凭据服务）、远端仓库列表与克隆、仓库发现（深层目录 / 联接 / 依赖树跳过 / 截断告警）、远端 fetch、配置持久化与损坏恢复 |
| `client` | 产物装载 + `apply()` 契约 + 用假 react 真渲染 tab body（不需要浏览器）+ 样式表合法性（规则外不得有裸文本行，否则浏览器会吞掉下一条规则） |
| `components` | 组件渲染契约：编辑器脏/冲突态、不可编辑占位、换行开关下的行号隐藏 |
| `flow` | 面板端到端数据流：选根→status→diff→文件读→编辑保存→冲突→检测更新（假 fetch，不起服务） |

### 热更新循环

- **改 `client.js`（即改 `src/**` 后重新 build）**：宿主每 500ms stat 轮询并热替换 bundle，
  约 1s 生效，**不用重启、不用刷新页面**。
- **改宿主半体（`index.js` / `host/**`）**：需要重新组合 profile（重启桌面端，或 设置→插件 页
  把任意插件关掉再开）—— 宿主代码启动后不会重新求值。

**首次安装必须重启一次**：客户端 bundle 会被自动扫进 bundle 表（`/plugins/events` 里就能看到），
但宿主半体要等 profile 真正重新组合才会注册 RPC 通道。装完跑一遍：

```bash
node scripts/verify-live.mjs --port <DSH 的实际端口>
```

它通过公开的 `/plugins/events` SSE 图确认三件事：

1. `✓ SSE 可读`：能连上，并报出当前图里的客户端 bundle 总数
2. `✓ 客户端 bundle 已在表里`：`dsh-git-panel` 的 bundle 已被登记（`immediately=true`）
3. `✓ 运行中的 bundle 与磁盘一致`：热更新已生效（改完 `src/` 重新 build 后应为绿）

第 2 步红 = 客户端半体没被扫到（检查 profile 的 `dsh.profile.bundles` 与 junction）；
第 3 步红 = 热更新没跟上，刷新页面；两者都绿但面板仍无数据 → 宿主半体没加载，**重启桌面端**。

## 4.4 平台约束（踩过的坑，务必遵守）

**宿主半体必须用命令式 `ctx.inject(deps, cb)` 声明依赖，不能只靠模块导出的 `inject`。**

本 App 的宿主 Loader 挂载插件时不会把模块上的 `export const inject` 传进 fiber，因此
fiber 的 store 里没有依赖服务，`ctx.xxx` 只能解析到**根级**服务。典型后果：

- `ctx.connection` 能拿到（connection 在根上）→ apply 正常执行
- `connection.rpc.handle('/x', fn)` 内部要 `owner.webServer.register(route)`，而 `webServer`
  由 `dsh-host-webserver` 这个 entry 自己的 fiber 提供 → 抛
  `Error: cannot get property "webServer" without inject`
- 表现：插件"加载了但通道 405"，且宿主没有崩溃日志

正确写法（与同环境正常工作的 dsh-runner 一致）：

```js
export function apply(ctx) {
  ctx.inject(['connection', 'webServer'], (scope) => {
    scope.effect(() => scope.connection.rpc.handle('/dsh-git', handler), 'dsh-git-panel: rpc')
  })
}
```

客户端（浏览器侧）的声明式 `inject` 是可用的，两侧不对称，别照搬。
## 4.5 架构约定（反兜底）

这一版刻意去掉了所有"兼容/降级/兜底"分支，规则如下：

| 约定 | 做法 | 反例（已删除） |
|---|---|---|
| 服务依赖 | 模块级 `export const inject = [...]`，缺服务就不激活 | `apply` 里等 15s 重试、同步兜底、`try { ctx.x } catch` |
| 文案 | `t` 由 `register({ locale: NS })` 注入，直接用 | 插件内自带本地字典回落 |
| 会话来源 | 两个外壳都是 session 作用域，框架直接给 `sessionId` | 从全局 `sessions` 里猜"主会话"、支持 `cwd` 入参 |
| 面板外壳 | 一个 `GitPanelSurface` 同时服务两处 | 两套外壳组件 + `layout` 装饰属性 |
| 宿主路径口径 | `diff` 的 path 相对 **repoRoot**；`file/read`、`tree/list` 的 path 相对 **rootPath** | `outside-root` 时回退到 repoRoot 再解析一次 |
| 数据形状 | 宿主返回什么就用什么（契约见 `docs/CONTRACT.md` §2） | `Array.isArray(x) ? x : []`、`?? []` 之类逐层兜底 |
| 图标 | 未知图标名打印一次错误并返回 null | 静默回落到 `file` 图标 |
| 安装 | Windows 只走目录联接 | junction 失败再试 dir symlink |

好处：任何一环不满足时**会直接报错**（DevTools / 面板错误条），而不是悄悄走另一条看起来能跑的路径
——之前那个"面板一直闪、diff 永远加载不出来"的 bug 就是一路静默降级掩盖出来的。
## 5. 已知边界（v1 明确不做）

- **提交是 smart commit**：有暂存就只提交暂存；没有暂存但工作区有改动时，会先把全部改动（含未跟踪文件）暂存再提交 —— 与 VS Code 的 `git.enableSmartCommit` 行为一致，只是这里始终开启。不做 discard / 分支操作。
- **仓库自己的 git hooks 照常执行**（pre-commit / commit-msg 等），不传 `--no-verify`；hook 失败时把它的输出原样显示出来。有未解决的冲突时会在提交前拦住并报 `unmerged`，不让 git 用一句退出码 1 收场。
- 项目根是仓库子目录时，变更列表展示的是**整个仓库**的变更（VSCode 行为），不做「只看项目目录以内」的过滤。
- 文件模式的筛选只搜索**已展开**的目录，不做仓库级全文搜索。
- 单个文件 diff 超过 5000 行会截断并给出「展开全部」。
- 编辑器不开语法着色（编辑态是等宽纯文本）：浏览器里要「可编辑 + 高亮」得自己实现编辑器内核或做透明层叠加，
  那套东西脆弱且难维护，所以这里明确不做半套。diff 视图的词级高亮不受影响。
- 编辑器行号最多画 5000 行（再多只保留输入框，避免几万个 DOM 节点）。
- 二进制文件只提示、不渲染图片。
- 不支持工作树（git worktree）里的特殊布局与 submodule 内部的二级 diff（submodule 指针变更会给出提示）。

## 6. 排错

| 现象 | 检查 |
|---|---|
| 右侧栏「+」里没有「Git 变更」 | `dsh.profile.bundles` 是否含 `dsh-git-panel`；`node_modules/dsh-git-panel` 链接是否指向本目录；是否已重新组合 profile |
| tab 能开但一片空白 | 浏览器 DevTools Console 有无报错；`exports["./client"]` 指向的文件是否存在 |
| 面板显示「当前目录不是 Git 仓库」 | 项目里没有任何工作树；用「储存库」标题行的 `+` 补一个外部仓库 |
| 变更一直是旧的 | 关掉自动刷新时按 `⟳`；确认宿主 `status` 缓存 1.2s 内没有踩到 |
| 文案显示成 key | 字典没注册上（`ctx.locale.register` 与 `locale: NS` 的 ns 必须都是 `dshGitPanel`） |

日志：`%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*.log`；浏览器 DevTools 里搜 `dsh-git-panel`。

## 7. 卸载

```bash
node scripts/install-profile.mjs --uninstall
```

会移除 `node_modules/dsh-git-panel` 链接、profile `dependencies` 与 `dsh.profile.bundles` 里的条目
（profile `package.json` 每次改动前都会自动备份成 `package.json.bak-<时间戳>`）。
外部根配置在 `~/.dsh/dsh-git-panel/roots.json`，需要的话手工删除。
