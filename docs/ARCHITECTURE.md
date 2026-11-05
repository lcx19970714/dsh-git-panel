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

- 变更区顶部是「储存库」列表（VS Code 的 Repositories）：每个仓库一行，点选切换下方变更区，可折叠；外部仓库行尾可移除，标题行 `+` 添加。当前分支是贴在行最右侧的按钮，点仓库名只选中仓库，只有点这个按钮才打开分支菜单；菜单里可切到已有分支，也可在底部输入名字创建新分支：创建区能选「从」哪里开始（默认当前分支；其它本地分支标「（本地）」、远端分支标「（远端）」，选了非当前分支会补一句人话说明新分支从哪开始、改动会怎样），并决定是否「创建后切换」；工作区脏时先显示改动计数（`当前 main · 3 处改动（1 已暂存 · 2 未暂存）`）；合并 / 变基 / 拣选 / 回滚进行中时只留「只建分支」一个出口；跨起点撞车时把重叠文件摊开，给两个零风险出口：「改为从当前分支创建」/「只建分支」（不切换、改动不动）。用不上的根（测试夹具、vendor 仓库）可以在行尾隐藏：只是从储存库里收起，仓库本身不动，配置持久化在 `roots.json` 的 `hidden` 段；标题行的眼睛按钮展开「已隐藏」，在那里取消隐藏。项目根本身不给隐藏入口。文件模式固定浏览项目根，没有根选择器
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
- 「远端」页签选中的账号**按工作区**记住（localStorage 里独立的一份，key 直接用宿主下发的 `projectRoot`）：切到别的工作区再切回来、或者关掉面板重新打开，都还是这个工作区上次选的那个，不会退回账号列表的第一个；换了工作区各记各的。只存账号 id（`provider:login`），不存令牌
- **远端仓库详情的「分支」区**（选中仓库后出现在右侧）：远端分支名单来自平台 API，本地状态来自项目里 origin 匹配到的本地仓库，两侧合成一张表；每行给出本地有没有 / 远端有没有（三态：有 / 没有 / 未知）、当前 / 默认 / 受保护、`↑n ↓m`、上游是否已删、远端是否已有本地还没 fetch 的新提交。行上可切换、建本地跟踪分支、复制名、打开网页、删除本地或远端分支（删除都二次确认；本地未合并只露出「强制删除」）。列表超过 8 条才出现筛选框；本地没克隆时照常看/删远端分支并提示先拉取
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
│  ├─ llm-call.js           一次模型调用的唯一实现：超时/abort/拼 text-delta/判 finish（stop·tool-calls 成功，max-tokens 报 model-truncated）
│  ├─ models.js             提交说明生成 + 模型目录/设置（模型目录来自宿主注入的 llm 服务）
│  ├─ remotes/              GitHub / Gitee 远端能力（令牌存 DSH 凭据服务，克隆不落盘令牌）
│  │  ├─ index.js           门面：账号增删改 + 组装下面几块
│  │  ├─ providers.js       平台差异表（鉴权/路径/字段归一/PR 能力），加载时校验契约
│  │  ├─ accounts.js        凭据服务里的账号记录（token 不出宿主）
│  │  ├─ repos.js           列仓库 / 仓库详情 / 克隆 / 远端分支列表与删除
│  │  ├─ pulls.js           PR 详情 / 审查 / 合并
│  │  └─ http.js            带超时的请求、错误归一、分页 Link
│  ├─ branches.js           远端分支视图合成（纯函数：远端名单 + 本地分支 + 跟踪引用 → 一张表）
│  ├─ review.js             AI 审阅 PR：输入拼装（超限截断如实标记）、严格校验模型 JSON、评论草稿
│  ├─ roots.js              三种根的解析（primary / discovered / extra）
│  └─ config.js             外部根持久化（原子写、损坏自动备份）
├─ src/                     ← 客户端源码（ESM，构建成 client.js）
│  ├─ index.js              apply(ctx)：字典 / tab 类型 / 快捷键 / tab body
│  ├─ platform.js           唯一接触 react 与宿主桥的文件
│  ├─ api.js                宿主 RPC 封装（超时、abort、错误归一）
│  ├─ store.js              显示偏好 + 每个工作区记住的远端账号 + 小 hook
│  ├─ i18n.js               内联 zh/en 字典（文案一律由框架注入的 t 取）
│  ├─ styles.js             全部样式（令牌取色，注入 <style>）
│  ├─ util/{paths,diff,changes,remote,time}.js  纯函数（有单测）
│  ├─ ui/{Icon,Menu}.js     内联 SVG 图标 + 轻量浮层菜单
│  └─ components/           Panel / RepoList / ChangesList / FileTree / DiffView / FileEditor / CommitBox / States / RemotePane / RemoteDetail / BranchList
├─ build/build-client.mjs   零依赖微型打包器（ESM → 经典脚本 __ModuleLoader__）
├─ test/                    13 套测试（见下）
├─ scripts/install-profile.mjs  本地开发安装：junction + profile package.json
└─ docs/                    ARCHITECTURE.md（本文）/ CONTRACT.md（客户端模块契约）
```

为什么**没有构建工具**：这台机器上没有 esbuild，而 DSH 的客户端插件必须是**经典脚本**
（`window.__ModuleLoader__.load({id, factory})`，不能是 ESM）。于是自带一个只认本仓库写法的
极小打包器（约 380 行）：把 `src/**` 的 `import/export` 重写成模块表 + 惰性求值，产物仍是纯
经典脚本。它会在写文件前用 `node --check` 校验产物，遇到不支持的语法/循环依赖直接报错，
不会静默产出坏包。

**宿主与客户端的边界**：客户端只做展示与交互，一切文件系统与 git 操作都在宿主侧（插件 host 半体），
通过 55 个 RPC 端点通信。写能力包括 `file/write`（必须带内容哈希）、`index/stage`（暂存/取消暂存）、`commit`（smart commit：有暂存只提交暂存，没有则先全部暂存）、`branch/create`（选基准建分支、可选建完就切过去；基准是当前 HEAD 时未提交改动原样跟随，跨基准撞车直接拒绝并给两个零风险出口）和 `branch/delete`（删除本地分支，默认只删已合并的）。
git 层面的**远端写**只有 `branch/push`（把当前分支推到 origin，用本机 git 凭据，
`git push --set-upstream origin <当前分支>`；失败按认证 / 非快进分类）。
`remote/fetch`（只更新远端跟踪引用，不动工作区与本地分支）与 `branch/pull`（fetch + 只允许快进）
都不是写远端；`remote/branches` 是只读的（平台 API + 本地 refs 合成）。
平台侧的写操作是 PR 审查/评论/合并与 `remote/branch/delete`（删远端分支）。
（`runGit` 全程用 `spawn` + 参数数组，不拼 shell 字符串）。

| 端点 | 入参 | 返回 |
|---|---|---|
| `project/resolve` | `{sessionId?} \| {cwd?}` | `{projectRoot, roots[], warnings[]}` |
| `roots/add` / `roots/remove` | `{projectRoot, path}` | 同上 |
| `roots/hide` / `roots/unhide` | `{projectRoot, path}` | 同上；隐藏只持久化「不在储存库里显示」，不动仓库；项目本身报 `cannot-hide` |
| `status` | `{rootPath}` | `{branch, head, detached, upstream, ahead, behind, pushed, files[], counts, truncated}`；`pushed` = 远端有没有 HEAD 这个提交（true 一致 / false 要推 / null 无从判断：无 origin、游离 HEAD、空仓库），比对的是 `refs/remotes/origin/<branch>` 的 sha 而不是「有没有 upstream」 |
| `diff` | `{rootPath, path, staged, untracked, contextLines, ignoreWhitespace}` | `{kind, hunks[], stats, language}` |
| `remote/fetch` | `{rootPath}` | `{url, branch, head, upstream, ahead, behind, fetchedAt}`（执行 git fetch --prune） |
| `file/read` | `{rootPath, path}` | `{kind, text, size, language, eol, bom, hash, lines}`（文本一律 LF 归一） |
| `file/write` | `{rootPath, path, text, expectedHash, eol, bom}` 或 `{…, force:true}` | `{size, mtimeMs, hash}`；哈希不匹配 → `conflict` |
| `index/stage` | `{rootPath, path, action}` | `{path, action}`；`stage` = `git add --`，`unstage` = `git restore --staged --` |
| `index/stage-group` | `{rootPath, scope}` | `{scope}`；整组暂存 / 取消暂存 |
| `branches/list` | `{rootPath}` | `{branches, current, state}`；一次 for-each-ref 同时读 refs/heads 与 refs/remotes，按分支名合成一条：`{name, local, current, remote, upstream, ahead, behind, upstreamGone}`（`remote` 是远程名或 null，`local:false` 表示只有远程）；跳过 origin/HEAD 这类符号引用。`state` 是分支菜单要的全部现状，跟名单同一次往返取回：`{head, detached, unborn, inProgress, dirty}` —— `head` 是短 sha（`null` = unborn，空仓库还没有第一个提交）、`inProgress` ∈ `null / merge / rebase / cherry-pick / revert`（读 `.git/MERGE_HEAD`、`rebase-merge` / `rebase-apply`、`CHERRY_PICK_HEAD`、`REVERT_HEAD` 与 `sequencer`）、`dirty` 与 `status.counts` 同形但**不做行数统计**（菜单只要计数）；裸仓库明确报 `not-a-repository` |
| `branch/track` | `{rootPath, remote, name}` | `{branch, head, upstream}`；`git switch -c <name> --track <remote>/<name>`，本地同名分支已存在报 `branch-exists` |
| `branch/switch` | `{rootPath, name}` | `{branch, head}`；`git switch`，工作区怎么处理由 git 决定 |
| `branch/create` | `{rootPath, name, base, checkout}` | 创建分支，可选建完立刻切过去；三个字段全部必填（缺一个就 `bad-request`）。返回 `{branch, head, previousBranch, previousHead, base:{ref, kind, sha}, switched, carried}`：`base.kind` ∈ `head / local / remote / commit`、`carried` 是创建后的工作区脏计数（与 `status.counts` 同形）。不 stash、不 force，撞车直接拒绝。流程与错误码见下面「创建分支约定」 |
| `branch/push` | `{rootPath}` | `{branch, head, upstream, output}`；把**当前**分支推到 origin：`git push --set-upstream origin <当前分支>`（一条命令同时覆盖「从没推过 / 已经推过」，上游已存在时只是重新确认）。凭据用本机 git（SSH key / 凭据管理器），与 `branch/pull` 的 fetch 同口径。游离 HEAD → `detached-head`、空仓库 → `unborn`、没有 origin → `no-remote`、远端拒绝认证 → `git-auth-failed`、远端有你没有的提交 → `not-fast-forward`（提示先拉取） |
| `branch/delete` | `{rootPath, name, force?}` | `{name, deleted, forced}`；`git branch -d`（force 时 `-D`）。当前分支 `current-branch`、不存在 `branch-not-found`、未合并 `branch-unmerged`（提示用强制删除） |
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

**计数与时间约定**：分页总数统一走 `totalOf(link, body)` —— 优先 Link 的 last 页
（GitHub 用双引号 `rel="last"`，Gitee 用单引号 `rel='last'`，两种都要认），其次 `total_count`
（Gitee 响应头 / GitHub search 响应体）。两者都没有时返回 `null`，界面显示「数量未知」而不是编数字。
远端时间一律用 `formatDateTime`：今天 = HH:MM，今年 = MM-DD HH:MM，跨年 = YYYY-MM-DD HH:MM
（只显示时分秒会让人误以为是当天）。

**深度审阅约定**：`remote/pull/deep-review` 不只发 diff：直接读**真实本地目录**里改动文件的完整内容再审。

- **两阶段**：`remote/pull/prepare-review` 只做「找目录 + 切分支」（界面文案「正在准备本地代码」），
  `remote/pull/deep-review` 只做「读完整文件 + 调模型」（界面文案「正在读取完整文件并审阅」）；
  `remote/pull/session-review` 复用阶段一，然后新建会话把审阅指令发过去（界面文案「正在准备本地代码」→ 自动打开新会话）；
  两个阶段的步骤合并显示，失败时能看到卡在哪一阶段；
- 目录来源（按顺序）：
  1. 请求带 `rootPath`（刚克隆完 / 复用上次目录）→ 直接审；
  2. 否则在 `rootPaths`（变更里所有仓库根）里按 `remote.origin.url` 匹配 PR 仓库（`repoUsed`，fork PR 指向 head 仓库），
     命中就 `git fetch` PR head 到独立分支 `dsh-review/pr-<n>` 并切过去再审；
  3. 都没有 → 返回 `{needsClone:true, repoUsed, headBranch, suggestedName, url}`，界面弹框让用户选
     「克隆到项目工作区」或「指定目录」，`remote/pull/clone-for-review` 克隆后再审。
- 不复用临时裸仓库/worktree：审的就是真实目录，方便用户自己调试、切分支；
- 深度审阅**真的会切本地仓库的分支**（fork PR 切到 `dsh-review/pr-<n>`），所以客户端在成功后必须
  重新 `project/resolve` + 重读 `status`：否则「储存库」行尾的分支名还是打开面板时的旧快照，
  而分支菜单每次打开都重读 `branches/list`，两处会显示不同的分支（菜单勾新分支、行尾还是旧分支）；
- 同一类兜底：`status` 里读到的 `branch` 和「储存库」根上的 `branch` 不一致时补一次
  `project/resolve`（覆盖在终端 / VS Code 里切分支的情况；同一个分支值只重试一次，避免来回请求）；
- 切换分支不动未提交改动：工作区脏时 git 自己拒绝，错误原样上抛；
- 二进制、超过 2MB、已删除的文件不读完整内容，原因随 `fullFilesSkipped` 返回并显示。
- 超时：客户端 RPC 默认 20s 只适合普通请求；`remote/pull/ai-review` 240s、
  `remote/pull/deep-review` 600s、`remote/pull/clone-for-review` 900s，
  避免「客户端超时了但宿主还在跑」；
- 跳过重复拉取：PR 详情带 `headSha`，本地 HEAD 已经等于它时只做 `git switch`（甚至什么都不做），
  不执行 `git fetch`；
- 可观测性：每次深度审阅把步骤写进 `~/.dsh/dsh-git-panel/review.log`（时间戳 + 级别 + 耗时 + 仓库#PR），
  同时通过宿主 logger 输出，并把步骤数组随结果/错误返回；界面「执行步骤」列出每一步做了什么、
  耗时与失败原因，错误里附日志文件路径。
- **同仓库 PR 不需要插件令牌**：本地克隆的 origin 就是 PR 所在仓库（或本地克隆的正是 fork）时，
  直接 `git fetch origin <headBranch>` + `git switch <headBranch>`，用用户本机配置的 git 凭据
  （SSH / 凭据管理器）——它们本来就能用，插件只负责切分支与读文件；
- 只有 fork PR、且本地克隆的是 base 仓库时才用插件令牌拉 fork 代码（此时先调 `assertRepoAccess` 预检权限）；
- 认证：带令牌的 git 命令一律 `-c credential.helper=`（禁用本机凭据管理器，避免旧凭据覆盖）
  + `-c http.extraHeader=Authorization: Basic <base64(login:token)>`，令牌不写进任何配置；
- fork PR 的权限：Gitee 没有 `refs/pull`，必须能读 fork 仓库才能拉代码，所以 `reviewSource` 会**先预检**
  fork 仓库可读性，读不到直接报 `fork-no-access`（带仓库名与账号），而不是让用户猜 git 的 Unauthorized；
  GitHub 用 base 的 `refs/pull/N/head`，不需要 fork 权限；

**会话级深度审阅约定**：`remote/pull/session-review` 准备目录（切分支/克隆）后，新建一个真实 DSH 会话，
把审阅指令作为首条消息发过去。会话归属按下面的顺序决定：

- 客户端带上当前 DSH `sessionId`；宿主注入 `workspaceController`，从 `workspaceController.follow()` 的
  baseline 帧里按 `sessionIds` 找到它所属的工作区，用 `session/create { workspaceId }` 建会话
  —— 这样会话出现在**当前工作区**里（有分组、有工作区路径），不是未分组的裸会话；
- 找不到工作区（或宿主没提供 workspaceController / 没传 sessionId）才退回 `session/create { cwd }`，
  并在日志里明确写「没有找到当前工作区」，不静默降级；
- `sessionController.create / prompt` 是「(参数, signal)」两个实参，必须传 AbortSignal；
- 提示词里带**代码目录绝对路径**：工作区路径与 PR 代码目录可能不是同一个。

**PR 提交与状态**：PR 详情会一并读提交列表（`GET /pulls/{n}/commits?per_page=50`），
读失败不拖垮详情，但带 `commitsUnavailable` 明确标记。
关闭 / 重新打开走 `remote/pull/state`（`PATCH /pulls/{n}` + `state`），两家路径与字段一致；
关闭在界面里是两步确认，重新打开直接执行。

显示规则（只在有意义时占位）：

- `linked:false`（no-pull / no-account / no-remote-repo / detached-head）→ **不渲染卡片**：
  这时「创建 PR」就是唯一的下一步，空卡片只是噪音；这些 reason 也不再翻译成界面文案；
- 查询失败 → 渲染错误卡 + 重试（失败必须让人看见，不能静默当成「没有 PR」）；
- `linked:true` → 卡片带「刷新状态」与「查看 PR」；刷新时保留上一份数据，避免先消失再出现。

**fetch 与 pull 的区别（分支菜单）**：`⋯` 菜单里的「获取远程更新」只做 `git fetch`：
更新远端跟踪引用、刷新分支列表与 ahead/behind，**不改工作区文件、不动本地分支**——它回答"远端有没有新提交"，
不给你代码。要拿到代码用「拉取当前分支最新代码」（`branch/pull`）：`fetch` + `merge --ff-only @{u}`，
只允许快进；分叉、无上游、工作区改动会冲突时直接报错，插件不自动产生合并提交、也不自动 stash。

**创建分支约定**（`branch/create`；git 侧的实测结论与「为什么不 stash」见 [BRANCH-CREATE.md](BRANCH-CREATE.md)）：

- **没有单独的预检端点**：分支菜单本来就要调 `branches/list`，`state`（`head` / `detached` / `unborn` /
  `inProgress` / `dirty`）跟着同一次响应回来，菜单要画的东西就都有了；撞车判定放在 `branch/create` 内部、
  与执行共用同一份代码 —— 既不会有「预检说能建、执行却按另一套规则」的漂移，也不必为了一个只读检查多开端点。
- **没有隐式默认 base**：`base` / `checkout` 必填（缺了就是 `bad-request`），菜单上看到什么就发什么。
  `base` 是 `'HEAD'` 或任意可解析的 ref（本地分支名 / `origin/x` / sha）；`checkout` 决定建完是否立刻切过去。
- **base 取当前 HEAD 是零风险路径**：`git switch -c` 只写 ref 与 `HEAD`，**不碰索引与工作区**，未提交改动
  （含已暂存/未暂存的切分、未跟踪文件）原样跟到新分支上，**不自动 stash、不自动提交**。所以默认路径不加仪式，
  回车就建；成功提示里说清「N 处改动已跟随（未提交）」，不让用户只能凭信任点按钮。
- **base 取别的 ref 只在「没重叠」时才安全**：脏文件与 `HEAD..base` 的差异没有交集时，
  `git switch -c <name> --no-track <base>` 自己就把改动带过去（暂存切分保留）；有交集时 git 会拒绝，
  插件把它翻译成 `would-overwrite`：message 内联文件清单（最多 8 个 + 另有 N 个）并提示两个出口，
  `details` 带 `{base, tracked, untracked}`。
- **不做 stash、不做 force、不制造冲突现场**：重叠时本来就无法平滑搬运 —— `stash apply --index` 必然在那几个
  重叠文件上产生冲突，等于「明知会冲突还要硬搬」，所以这条路整条不实现。只留两个零风险出口：
  「改为从当前分支创建」（把 base 拉回 `HEAD`，即上面那条零风险路径）与「只建分支」（`checkout:false`，
  只写 ref、根本不碰工作区）。`-f` / `--discard-changes` 这类会静默丢改动的参数永远不出现。
- **跨 base 一律 `--no-track`**：把 `origin/dev` 设成特性分支的上游，`push.default=simple` 下 push 会直接卡住
  （「上游名字对不上」），上游留给用户第一次 push 时定。唯一例外是 base 恰好等于 `origin/<新分支同名>`，
  这时用 `--track` —— 那正是用户想要的跟踪。
- **「只建分支」不搬改动，文案必须说清**：它只创建一个指向 base 的 ref，改动仍留在原分支的工作区里，
  之后在原分支提交，提交就落在原分支上 —— 这是这个出口唯一容易骗人的地方。
- **只剩一个出口的两种状态**：`git switch` 在 merge / rebase / cherry-pick / revert 进行中会硬拒绝（`128`），
  所以 `checkout:true` 时先报 `in-progress`，菜单只留「只建分支」；空仓库（unborn，还没有第一个提交）
  反过来 —— `git branch` 会失败，只能「创建并切换」，`checkout:false` 报 `unborn`。

| code | 场景（全部带可操作文案） |
|---|---|
| `bad-branch` | 名字非法 |
| `branch-exists` | 本地已有同名分支 |
| `base-not-found` | base ref 不存在（例如 `origin/dev` 还没 fetch）→ 提示先获取远程更新 |
| `unborn` | 空仓库（还没有第一个提交）且 `checkout:false`：只能「创建并切换」 |
| `in-progress` | merge / rebase / cherry-pick / revert 进行中且 `checkout:true`（git 的 `switch` 会硬拒绝） |
| `would-overwrite` | base≠HEAD、脏文件与 base 的差异重叠且 `checkout:true`：message 内联文件清单（最多 8 个 + 另有 N 个）并提示两个出口，`details` 为 `{base, tracked, untracked}` |

**远端页签的分支视图约定**（`remote/branches`，实现在 `host/branches.js: mergeBranches` + `index.js` 的 handler）：

- **两个视角别混**：「储存库」行尾的分支菜单是**本地仓库**视角（切分支的地方，读 `branches/list`）；
  远端页签的「分支」区是**远端仓库**视角（回答"这个仓库在平台上有什么分支、我本地跟到哪了"）。
  两者共用 `branch/switch`·`branch/track`·`branch/delete`，但行上的主操作按状态决定：
  本地已有 → 切换；仅远端且本地有仓库 → 建跟踪分支；都没有 → 只提供复制 / 打开网页。
- **「远端有没有」是平台 API 说了算**，不是本地 `refs/remotes/*`：本地可能很久没 fetch，跟踪引用会过期。
  远端 API 读不到时该字段是 `null`（未知，标签画成暗色并在 title 写「远端未知」），**不能画成"没有"**；
  本地没克隆与本地读取失败也用 `localKnown` / `failures` 分开表达。
- **`remoteUpdated`**：远端 API 的 sha 与本地 `refs/remotes/origin/<name>` 的 sha 不同 = 远端有新提交、
  本地还没 fetch。界面不自己拉网络，只提示；要更新就点分支区的「获取远程更新」（`remote/fetch`，`fetch --prune`）。
- **失败不拖垮另一半**：本地读失败只记 `failures[{section:'local'}]`（`localKnown:false`），
  远端 API 失败只记 `failures[{section:'remote'}]`（`remoteKnown:false`），端点本身仍是成功信封 ——
  这样令牌过期/没网时本地分支操作照常可用，本地没克隆时远端分支也照常可看。
- **删除是破坏性操作，一律二次确认**：本地删除先 `git branch -d`，git 报未合并时返回 `branch-unmerged`，
  界面才露出「强制删除」（`-D`），不默认 force；远端删除先读仓库详情拒绝默认分支（`default-branch`），
  平台 403/422 + protected 映射成 `protected-branch`。删除远端分支后不碰本地跟踪引用（下次 fetch --prune 自然消失），
  合并视图以 API 为准，所以界面不会显示成"远端还在"。
- 远端分支一次最多读 10 页（`PAGE_SIZE=100`，共 1000 个），到上限 `truncated:true`，界面如实提示「只显示前 N 个」。
- 分支区数据像详情一样**按仓库缓存**：切仓库才重拉；从 PR 详情关回详情、切页签都不重复请求（有显式刷新按钮）。

**客户端入口（两条路，同一面板）**：

| 入口 | 槽位 | 作用域 | 点击行为 |
|---|---|---|---|
| 会话标题栏按钮 | `conversation.session.header.utilities` | session | `sidebarRight.openTabIn(sessionId, 'git')` |
| 左侧栏底部「代码坞」 | `sidebar.footer.action` | root | `sidebarRight.openTab('git')`（自己解析当前挂载会话） |

左侧栏入口在侧栏收起（56px 图标条）时只显示彩色图标，展开时显示图标 + 「代码坞」；
没有已挂载的会话时 `openTab` 会抛错，入口按钮自己标红点并在 tooltip 说明原因，不静默失败。

**版本号按钮的语义（两件事不混）**：工具条右侧的版本号 chip 是**插件自身版本**（`v<package.json version>`），
点击检查插件是否有新版本（`plugin/update` → GitHub 最新 release）：已是最新给 info、有新版本给 warn 且可点开
release 页、失败给 error 并说清原因。

**仓库上游检查**（`git fetch` + ahead/behind）不再挂在版本号上，移到 `⋯` 菜单的「检查上游更新」：
它是只读操作，结果只报告不自动合并。两者共用一个提示位（谁最后动作显示谁），但语义、文案与状态互不影响。

**PR 状态与反馈约定**：变更页签顶部显示「当前分支的 PR」卡片（`pr/linked`）：
状态由 `pull.merged / pull.state / gate.review.state / pull.mergeable` 推导，只用平台给的事实，
不推断「谁 approve 了」（Gitee 不提供评审明细，卡片只显示平台合并门禁）。
未读反馈用本地水位 `pullSeen['<accountId>#<number>'] = 已读条数`，在打开 PR 详情时写入；
未读 = 评论总数 − 水位，下限 0。

**未推送提示约定**（`PushHint` 组件，**唯一渲染点：变更页签**）：

- **变更页签常驻一条**：`status.pushed === false` 时，在提交框上方显示「这条分支还只在你电脑上」+
  「**推送到远端**」按钮 + 可照抄的 `git push -u origin <当前分支>`（`user-select: all`）。
  创建完分支、或提交完还没推，都能立刻看到 —— 这就是「要不要推送」的回答，**点按钮即可，不用去终端**。
- **推送由宿主执行** `branch/push`：一条 `git push --set-upstream origin <当前分支>` 同时覆盖
  「从没推过 / 已经推过」两种状态；凭据口径与 `branch/pull` 的 fetch 一致（本机 git 凭据，
  插件不掺和令牌）。认证失败、远端有你没有的提交都翻译成可操作原因显示在提示块里，不弹窗、不吞。
- `pushed === null`（没有 origin / 游离 HEAD / 空仓库）与 `true` 都不显示：无从判断或不必要，不能误报。
- **创建 PR 表单里不放同一块内容**：表单与变更页签同屏，复制一遍就会让同一句话在一屏里出现两次。
  表单只回答「创建按钮为什么是灰的」（`pr.blockedNotPushed` 一行），推送按钮仍然只有左栏那一处。
- **`pushed` 只有一个来源**：宿主 `status.pushed`。`pr/prepare` 不返回它 —— 那是同一事实的第二份快照，
  会随表单停留而过期，也让两处提示对不上。真正的推送校验在 `pr/create`（绕过界面直接调接口也拦得住）。
- 判定必须比对远端跟踪引用的 sha，而不是「有没有 upstream」：`git push origin x`（不带 `-u`）推成功
  也没有 upstream，那时不该继续提示去推。
- 推送成功后客户端刷新 `status`，`pushed` 变 true，左栏提示与表单里的禁用一起消失，不需要用户手动关。

**评论转会话（AI 处理反馈）**：PR 详情每条评论有「让 AI 处理」，调 `remote/pull/session-review`
并带 `comment {id, author, body, createdAt}`；宿主用 `buildCommentSessionPrompt` 生成指令：
先在仓库里判断评论是否成立（不成立就说明理由、不改），成立才改，只改该评论涉及范围，
跑相关测试，**不 commit / 不 push**；说不清指哪里就列进「需要向评论人确认」。
会话仍按当前工作区创建；本地没有仓库时复用深度审阅的克隆确认框，克隆完继续处理同一条评论。

**创建 PR 约定**：入口在「变更」页签（提交框右侧「创建 PR」），表单渲染在右侧面板。

- 宿主先 `pr/prepare`：从 `remote.origin.url` 认出 provider 与 `owner/repo`、列出远端分支作为目标候选、
  检查当前分支是否已推送；不满足条件直接报明确错误，不在界面上假装可创建；
- 目标分支默认按 `dev → develop → main → master → 自然序` 排序；**客户端按仓库（provider:owner/repo）
  记住上次选择**（`pullTargets` 偏好），下次自动带出；
- 标题与描述用「提交说明模型」（设置里同一个模型）生成：输入是 base..HEAD 的提交标题 + diff 统计 +
  diff 片段（40k 截断），输出严格 JSON `{title, body}`，不合法就报 bad-model-output。
  输出上限 **4096**、推理档位取最低（标题 + 三节中文正文在 1024 下会被砍断，那是真实踩过的坑）。
- 「分支还没推到远端」时**给按钮，不给作业**：推送按钮在左栏 `PushHint` 里，与表单同屏可见；
  表单自己只把「创建 PR」置灰并给一行原因（`pr.blockedNotPushed`）。点推送 → 宿主 `branch/push`
  → 刷新 `status` → `pushed` 变 true，创建按钮自动可用，**不需要重新 `pr/prepare`**。
  宿主 `pr/create` 的 `not-pushed` 错误照样带可照抄的命令（绕过界面直接调接口时兜底）。
- 用户可改，点「创建 PR」才真正发出去；成功后显示 PR 编号与「打开 PR」，并记住这次的目标分支。

**PR 评论约定**：PR 详情（`remote/pull`）会一并读评论列表：
GitHub 走 `GET /issues/{n}/comments`、Gitee 走 `GET /pulls/{n}/comments`（与发表评论同路径）。
读失败不拖垮详情，但会带上 `commentsUnavailable` 原因，界面明确显示。
发表评论是 `remote/pull/comment`，内容以界面评论框里的文本为准（AI 草稿只是「填入评论框」，
不直接提交）。

**AI 审阅约定**：`remote/pull/ai-review` 由宿主取 `pulls/{n}/files` 的 patch，拼成
PR 元信息 + 文件块的提示词，让 `reviewModel` 输出固定结构的 JSON（summary / verdict / findings[] / comment）。

- 输入上限 `REVIEW_DIFF_LIMIT = 200_000` 字符；超限时提示词里写明「只看到前 N 个字符」，并把 `truncated` 一路带回界面；
- 文件列表每页 **50** 条：GitHub 在 `per_page > 70` 时会让第 70 个之后的文件不返回 patch（openjdk SKARA-1406），
  这是平台缺陷，必须绕开；
- 平台对**二进制文件**与**单个 diff 过大**的文件不返回 patch。`pullDiff` 给每个文件标 `patchAvailable`，
  `buildReviewInput` 在这种情况下写明「本文件 +N/−M，内容未被审阅」，并把它们放进 `skippedFiles`；
  界面列出这些文件与改动行数，用户据此把文件拆小、把生成物移出版本库或拆 PR。
- 输出上限 8192 token、超时 180s，与提交说明共用 `host/llm-call.js`（同一套 prepareCall / stream / abort / 结束原因判定）；
- 模型输出必须严格合法（坏 JSON、缺字段、非法 severity/verdict 一律 `bad-model-output`），不做修补；
- 评论只生成草稿：`remote/pull/comment` 只有在用户点「提交评论」时才调用，内容以界面里的文本为准；
- 两个模型（commitModel / reviewModel）存在 `~/.dsh/dsh-git-panel/settings.json`，写入是部分更新，互不覆盖。

**模型调用约定**（`host/llm-call.js`，提交说明 / PR 标题描述 / AI 审阅三个调用点共用）：

- 一次模型调用只有一处实现：`prepareCall → stream → 拼 text-delta → 判 finish`。这三处原先各抄了一遍，
  代价是同一个坑犯了三次 —— 谁都没看结束原因，于是「输出被上限截断」只表现为「JSON 不完整」，
  最终报成「模型输出不是合法 JSON」，把人往格式问题上带。
- `finish.reason.kind` 是封闭联合（dsh-llm 的 FinishReason）：只有 `stop` / `tool-calls` 算成功；
  `max-tokens` **是明确可识别的失败**，报 `model-truncated` 并带上限值与输出末尾片段 —— 不允许上层把它
  解释成「格式不对」或「模型没返回文本」；`error` / `aborted` 报 `model-failed` / `aborted`；
  结束原因缺失（流被中断）同样报 `model-failed`，绝不把半截文本交给上层解析。
- 预算按任务定，不搞一个数通吃：提交说明 **1024**（一行说明）、PR 标题描述 **4096**（标题 + 三节正文）、
  AI 审阅 **8192**（多条问题 + 评论草稿）；后两者都是「把已有信息改写成固定结构」，其中需要压缩预算的
  两个调用点把推理档位取该模型最低档（推理 token 也算在 maxTokens 里，小上限会被思考吃光）。
- JSON 类输出解析失败时，错误里打印「共 N 字符 + **末尾**片段」：开头永远长得像正常 JSON，
  问题一定在断点上（早先只打印开头，正是它误导了排查方向）。解析本身仍然严格：不抠大括号、不剥代码块。

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

| `remote/detail` | `{accountId, fullName, pageSize?}` | `{repo, issues:{total,items}, pulls:{total,items}, failures}`；总数由 provider 的 `countsPath` 单独取：GitHub 的 issues 走 search 的 `total_count`（`type:issue` 天然排除 PR），pulls 与 Gitee 两者都用列表的 Link 末页 / `total_count`；拿不到就是 `null`（界面显示「数量未知」） |
| `remote/pr-counts` | `{accountId, fullNames[]}` | `{counts: {fullName: number\|null}, failures}`；每个仓库一次 per_page=1 请求，上限 50 个、并发 6 |
| `remote/branches` | `{accountId, fullName, rootPaths?}` | `{provider, htmlUrl, defaultBranch, remoteKnown, localKnown, truncated, counts, branches[], local, failures}`；远端分支走平台 API（最多 10 页、到上限报 `truncated`），本地状态由 `rootPaths` 里 origin 匹配的仓库读出来再合成一条（`mergeBranches`）：每行 `{name, local, current, remote, default, protected, remoteSha, upstream, ahead, behind, upstreamGone, upstreamMissing, remoteUpdated}`。远端/本地任一侧失败只记进 `failures` 并把 `*Known` 置 false，另一侧照常返回 |
| `remote/branch/delete` | `{accountId, fullName, name}` | `{name, deleted}`；平台 DELETE。默认分支 `default-branch`、受保护 `protected-branch`，其余错误原样上抛 |
| `remote/pull` | `{accountId, fullName, number}` | `{pull, reviews, capabilities}`；capabilities 说明平台支持哪些审查结论与合并方式 |
| `remote/pull/review` | `{accountId, fullName, number, verdict, body?}` | `{verdict, bodyPosted}`；GitHub 三种结论，Gitee 只有 approve（说明走评论接口） |
| `remote/pull/pass` | `{accountId, fullName, number, body?}` | `{completed, failures}`；按平台能力依次执行审查/测试，部分成功照实返回 |
| `remote/pull/diff` | `{accountId, fullName, number}` | `{files: [{filename, status, additions, deletions, changes, patch}], truncated}`；两家都走 `pulls/{n}/files`，每页 100、最多 3 页 |
| `remote/pull/ai-review` | `{accountId, fullName, number}` | `{summary, verdict, findings[], comment, model, truncated, filesIncluded}`；读 `reviewModel`，输出严格校验 |
| `remote/pull/prepare-review` | `{accountId, fullName, number, rootPaths?, rootPath?, branch?}` | `{mode:'local', rootPath, branch, pull, steps, logPath}` 或 `{needsClone, repoUsed, headBranch, suggestedName, url, steps}`；阶段一：找仓库/判是否已在 PR 提交/切分支（必要时才 fetch） |
| `remote/pull/deep-review` | `{accountId, fullName, number, rootPath?}` | 同 ai-review 的返回 + `deep, filesRead, fullFilesSkipped, objectSource`；把 PR head 拉到临时裸仓库/worktree 读完整文件再审，临时目录用完即删 |
| `remote/pull/session-review` | `{accountId, fullName, number, rootPaths?, rootPath?, branch?}` | `{sessionId, rootPath, branch, steps, logPath}`；阶段一与 prepare-review 相同（主工作区切分支；没有本地仓库返回 `needsClone`），阶段二新建真实会话并把审阅指令作为首条消息发过去，用户在会话里继续追问 |
| `remote/pull/clone-for-review` | `{accountId, fullName, number, targetDir}` | `{rootPath, branch, head}`；目标目录必须绝对且为空/不存在；克隆后切到 PR 分支 |
| `remote/pull/state` | `{accountId, fullName, number, state}` | `{number, state}`；`PATCH /pulls/{n}` 带 `state: open/closed`（两家一致），关闭需界面二次确认 |
| `remote/pull/comment` | `{accountId, fullName, number, comment}` | `{posted, url}`；内容由用户在面板里确认/编辑后提交 |
| `remote/pull/test` | `{accountId, fullName, number}` | `{tested}`；Gitee 专用（POST /pulls/{n}/test，无请求体），GitHub 报不支持 |
| `remote/pull/merge` | `{accountId, fullName, number, method, deleteBranch?}` | `{merged, method, branchDeleted, headBranch}`；不可合并/已合并/非打开状态在宿主侧拦下 |
| `remote/clone` | `{accountId, fullName, cloneUrl, projectRoot, targetName?}` | `{path, name, fullName}`；鉴权只走 `-c http.extraHeader`，不写进 `.git/config` |
| `commit` | `{rootPath, message}` | `{head, subject, includedUnstaged}`；有暂存只提交暂存，没有则先 `git add -A` 再提交 |
| `branch/pull` | `{rootPath}` | `{branch, upstream, head, previousHead, ahead, behind}`；`git fetch origin` + `git merge --ff-only @{u}`；游离 HEAD→detached-head、无上游→no-upstream、分叉或工作区冲突→not-fast-forward（不自动 merge/stash） |
| `plugin/info` | `{}` | `{name, version, repositoryUrl, fullName}`；本地读 package.json，不联网 |
| `plugin/update` | `{}` | `{currentVersion, latestVersion, url, publishedAt, newer}`；查 GitHub 最新 release 并严格比较版本，失败抛 `update-check-failed`（不把失败当成「已是最新」） |
| `pr/linked` | `{rootPath, accountId?}` | `{linked:true, provider, fullName, branch, accountId, number, pull, gate, comments}` 或 `{linked:false, reason}`；reason ∈ no-remote-repo / detached-head / no-account / no-pull。没有 PR 不是错误 |
| `pr/prepare` | `{rootPath}` | `{repo:{provider,fullName}, head, bases, accounts}`；origin 指向 GitHub/Gitee、当前在分支上、有对应账号，否则直接报错（no-remote-repo / no-account / detached-head / no-base-branch）。**不返回是否已推送**：那是 `status.pushed` 的唯一职责，这里再算一遍只会多一份会过期的快照 |
| `pr/generate` | `{rootPath, base}` | `{title, body, commits}`；`git log origin/base..HEAD` + `git diff origin/base...HEAD` 交给提交说明模型，严格 JSON |
| `pr/create` | `{rootPath, accountId, fullName, base, title, body}` | `{number, url, state, head, base}`；先校验 origin 与 fullName 一致、分支已推送（not-pushed），再 `POST /pulls` |
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
| `tree` | 分组规则（`MM` 双组、冲突只进冲突组）、单文件组、树展开 |
| `remote` | 远端地址 → 网页地址（scp/ssh/https/git 形式）、凭据不入地址栏、本地路径 → null |
| `build` | 打包器：产物无残留 import/export、能真跑、循环依赖报错 |
| `git` | git 引擎（需要 `_sandbox/repo` 夹具：`node test/make-fixture.mjs`） |
| `host` | 54 个端点的信封契约、错误码、文件写入（哈希/冲突/原子/EOL 保真）、暂存/取消暂存/提交、分支列表、切换/创建/删除本地分支、远端分支视图合成（`mergeBranches`）、代码托管账号（令牌存 DSH 凭据服务）、远端仓库列表与克隆、仓库发现（深层目录 / 联接 / 依赖树跳过 / 截断告警）、远端 fetch、配置持久化与损坏恢复 |
| `client` | 产物装载 + `apply()` 契约 + 用假 react 真渲染 tab body（不需要浏览器）+ 样式表合法性（规则外不得有裸文本行，否则浏览器会吞掉下一条规则） |
| `components` | 组件渲染契约：编辑器脏/冲突态、不可编辑占位、换行开关下的行号隐藏；远端仓库详情的分支区（本地/远端标签三态、当前/默认、加载/失败/未克隆、旧仓库数据不串台） |
| `remotes` | 平台差异表与远端 API：仓库/PR 归一分页、令牌位置、分支列表与删除（默认分支拦截、protected 映射） |
| `flow` | 面板端到端数据流：选根→status→diff→文件读→编辑保存→冲突→检测更新（假 fetch，不起服务） |
| `review` / `client-utils` | 审阅输入/输出校验；客户端纯函数（路径/差异/变更） |

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

- **提交是 smart commit**：有暂存就只提交暂存；没有暂存但工作区有改动时，会先把全部改动（含未跟踪文件）暂存再提交 —— 与 VS Code 的 `git.enableSmartCommit` 行为一致，只是这里始终开启。不做 discard（撤销本地改动）。
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
| 报「`[pr/generate] 缺少参数 base`」这类缺参错误 | **界面与宿主版本不一致**：宿主在启动时把 `index.js`/`host/*` 读进内存，改完代码只刷新页面没用 —— 重启 DSH，再 `Ctrl+F5` 硬刷新（浏览器可能还在用旧的 `client.js`）。看进程启动时间与 `client.js` 的修改时间先后就能确认。缺参错误现在带端点名（`[endpoint]`），一句就能定位是哪次调用 |

日志：`%APPDATA%\@deepseek-ai\dsh-desktop\logs\crash-*.log`；浏览器 DevTools 里搜 `dsh-git-panel`。

## 7. 卸载

```bash
node scripts/install-profile.mjs --uninstall
```

会移除 `node_modules/dsh-git-panel` 链接、profile `dependencies` 与 `dsh.profile.bundles` 里的条目
（profile `package.json` 每次改动前都会自动备份成 `package.json.bak-<时间戳>`）。
外部根配置在 `~/.dsh/dsh-git-panel/roots.json`，需要的话手工删除。
