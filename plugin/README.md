# dsh-git-panel —— DSH 里的「Git 变更 / 文件浏览」面板

[![GitHub](https://img.shields.io/badge/GitHub-lcx19970714%2Fdsh-git-panel-181717?logo=github)](https://github.com/lcx19970714/dsh-git-panel)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

给 DSH Web/桌面端加一个 **VSCode 风格**的 Git 面板：左侧看改动（或直接浏览文件树），
右侧看 diff（或直接编辑文件并保存）。装在**右侧栏**里，按会话的项目目录工作。

## 安装（从 GitHub）

```bash
git clone https://github.com/lcx19970714/dsh-git-panel.git
cd dsh-git-panel
node plugin/scripts/install-profile.mjs          # 加 --dry-run 可先看它会改什么
```

它会做三件事（幂等，可重复执行）：

1. 在 profile 的 `node_modules` 下建目录联接 → 指到 `plugin/`（Windows 用 junction，免管理员权限）
2. 把 `dsh-git-panel` 写进 profile 的 `dependencies`（`link:` 形式）
3. 把 `dsh-git-panel` 追加进 `dsh.profile.bundles`

**然后重启一次 DSH**（宿主半体是 ESM，只在启动时加载）。之后在任意会话里：

- 点**标题栏最右侧的「变更」按钮**，或右侧栏「+」→「Git 变更」
- 卸载：`node plugin/scripts/install-profile.mjs --uninstall`

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

- 顶栏 pill 切换根（项目 / 发现 / 外部），外部根可一键移除
- **版本号 chip**（当前提交短 SHA）：点一下 = 检测更新（git fetch），结果一行说明「已是最新 / 落后 N 个 / 领先 N 个」
- **打开 Git 仓库**按钮：按 remote.origin.url 转成 https 在新标签打开；本地路径类远端没有网页，按钮自动禁用
- 手动刷新在「⋯」菜单的「立即刷新」里，`R` 键同效；可选 8s 自动刷新（仅在窗口可见且聚焦时跑）
- 左列宽度可拖拽（键盘 `←/→` 也能调），宽度与所有显示偏好持久化
- `/` 聚焦筛选、`Esc` 清空筛选、`↑↓` 在列表内移动、`Enter` 打开
- 深浅色自动跟随 DSH 主题（全部取色自 `--dsw-*` 令牌，零硬编码色值）

## 3. 架构

```
plugin/
├─ index.js                 宿主入口：ctx.inject(['connection']) + rpc.handle('/dsh-git')
├─ host/
│  ├─ git.js                零依赖只读 git 引擎（spawn git，porcelain=v2 -z 解析、diff、目录、仓库发现）
│  ├─ roots.js              三种根的解析（primary / discovered / extra）
│  └─ config.js             外部根持久化（原子写、损坏自动备份）
├─ src/                     ← 客户端源码（ESM，构建成 client.js）
│  ├─ index.js              apply(ctx)：字典 / tab 类型 / 快捷键 / tab body
│  ├─ platform.js           唯一接触 react 与宿主桥的文件
│  ├─ api.js                宿主 RPC 封装（超时、abort、错误归一）
│  ├─ store.js              显示偏好持久化 + 小 hook
│  ├─ i18n.js               内联 zh/en 字典 + makeT 降级
│  ├─ styles.js             全部样式（令牌取色，注入 <style>）
│  ├─ util/{paths,diff,highlight,changes}.js   纯函数（有单测）
│  ├─ ui/{Icon,Menu}.js     内联 SVG 图标 + 轻量浮层菜单
│  └─ components/           Panel / RootPicker / ChangesList / FileTree / DiffView / FileView / States
├─ build/build-client.mjs   零依赖微型打包器（ESM → 经典脚本 __ModuleLoader__）
├─ test/                    7 套测试（见下）
└─ scripts/install-profile.mjs  装进 DSH profile（junction + package.json）
```

为什么**没有构建工具**：这台机器上没有 esbuild，而 DSH 的客户端插件必须是**经典脚本**
（`window.__ModuleLoader__.load({id, factory})`，不能是 ESM）。于是自带一个只认本仓库写法的
极小打包器（约 380 行）：把 `src/**` 的 `import/export` 重写成模块表 + 惰性求值，产物仍是纯
经典脚本。它会在写文件前用 `node --check` 校验产物，遇到不支持的语法/循环依赖直接报错，
不会静默产出坏包。

**宿主与客户端的边界**：客户端只做展示与交互，一切文件系统与 git 操作都在宿主侧（插件 host 半体），
通过 9 个 RPC 端点通信。写能力只有一个端点（`file/write`），且必须带内容哈希；远端操作只有一个端点（`remote/fetch`），只做 git fetch（只更新远端跟踪引用，不动工作区与本地分支）
（`runGit` 全程用 `spawn` + 参数数组，不拼 shell 字符串）。

| 端点 | 入参 | 返回 |
|---|---|---|
| `project/resolve` | `{sessionId?} \| {cwd?}` | `{projectRoot, roots[], warnings[]}` |
| `roots/add` / `roots/remove` | `{projectRoot, path}` | 同上 |
| `status` | `{rootPath}` | `{branch, head, detached, upstream, ahead, behind, files[], counts, truncated}` |
| `diff` | `{rootPath, path, staged, untracked, contextLines, ignoreWhitespace}` | `{kind, hunks[], stats, language}` |
| `remote/fetch` | `{rootPath}` | `{url, branch, head, upstream, ahead, behind, fetchedAt}`（执行 git fetch --prune） |
| `file/read` | `{rootPath, path}` | `{kind, text, size, language, eol, bom, hash, lines}`（文本一律 LF 归一） |
| `file/write` | `{rootPath, path, text, expectedHash, eol, bom}` 或 `{…, force:true}` | `{size, mtimeMs, hash}`；哈希不匹配 → `conflict` |
| `tree/list` | `{rootPath, path}` | `{entries[], truncated}` |

所有失败都返回 `{ok:false, error:{code, message, details}}`，宿主 handler 绝不抛错（避免裸 500）。

## 4. 开发

```bash
cd plugin
node build/build-client.mjs          # 构建 client.js（改完 src/ 必跑）
node test/run.mjs                    # 跑全部测试
node test/run.mjs --only client      # 只跑某一套
node scripts/install-profile.mjs     # 装进 desktop profile（幂等）
node scripts/install-profile.mjs --dry-run
```

测试包含：

| 套件 | 覆盖 |
|---|---|
| `paths` | 路径/树构建/折叠/过滤/排序 |
| `diff` | hunk 解析、并排配对、词级高亮、行预算 |
| `tree` | 分组规则（`MM` 双组、冲突只进冲突组）、单文件组、树展开 |
| `highlight` | 分词无损性（`join(tokens) === line`）、跨行块注释、未知语言降级 |
| `build` | 打包器：产物无残留 import/export、能真跑、循环依赖报错 |
| `git` | git 引擎（需要 `_sandbox/repo` 夹具：`node test/make-fixture.mjs`） |
| `host` | 7 个端点的信封契约、错误码、配置持久化、损坏恢复 |
| `client` | 产物装载 + `apply()` 契约 + 用假 react 真渲染 tab body（不需要浏览器） |

### 热更新循环

- **改 `client.js`（即改 `src/**` 后重新 build）**：宿主每 500ms stat 轮询并热替换 bundle，
  约 1s 生效，**不用重启、不用刷新页面**。
- **改宿主半体（`index.js` / `host/**`）**：需要重新组合 profile（重启桌面端，或 设置→插件 页
  把任意插件关掉再开）—— 宿主代码启动后不会重新求值。

**首次安装必须重启一次**：客户端 bundle 会被自动扫进 bundle 表（`/plugins/events` 里就能看到），
但宿主半体要等 profile 真正重新组合才会注册 RPC 通道。装完跑一遍：

```bash
node scripts/verify-live.mjs
```

它读公开的 SSE 图 + 探一次 `/dsh-git/project/resolve`，直接给出状态：

- `✓ 通道已注册（HTTP 401/403）` → 插件完整可用；
- `✗ 通道不存在（HTTP 405）` → 宿主还没加载，需要重启桌面端（只改客户端时不会出现这种情况）。

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
| 文案 | `t` 由 `register({ locale: NS })` 注入，直接用 | 插件内自带 `makeT()` 回落到本地字典 |
| 会话来源 | 两个外壳都是 session 作用域，框架直接给 `sessionId` | 从全局 `sessions` 里猜"主会话"、支持 `cwd` 入参 |
| 面板外壳 | 一个 `GitPanelSurface` 同时服务两处 | 两套外壳组件 + `layout` 装饰属性 |
| 宿主路径口径 | `diff` 的 path 相对 **repoRoot**；`file/read`、`tree/list` 的 path 相对 **rootPath** | `outside-root` 时回退到 repoRoot 再解析一次 |
| 数据形状 | 宿主返回什么就用什么（契约见 `src/CONTRACT.md` §2） | `Array.isArray(x) ? x : []`、`?? []` 之类逐层兜底 |
| 图标 | 未知图标名打印一次错误并返回 null | 静默回落到 `file` 图标 |
| 安装 | Windows 只走目录联接 | junction 失败再试 dir symlink |

好处：任何一环不满足时**会直接报错**（DevTools / 面板错误条），而不是悄悄走另一条看起来能跑的路径
——之前那个"面板一直闪、diff 永远加载不出来"的 bug 就是一路静默降级掩盖出来的。
## 5. 已知边界（v1 明确不做）

- **版本控制操作只读**：不提供 stage / unstage / commit / discard / 分支操作（保存只写工作区文件）。
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
| 面板显示「当前目录不是 Git 仓库」 | 会话 cwd 不是仓库；用顶栏「添加外部仓库…」补一个 |
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
