# dsh-git-panel

[![CI](https://github.com/lcx19970714/dsh-git-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/lcx19970714/dsh-git-panel/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/lcx19970714/dsh-git-panel?label=release)](https://github.com/lcx19970714/dsh-git-panel/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-3c873a.svg)](https://nodejs.org)

**给 DSH 加一个 VSCode 风格的 Git 面板。** 装在会话右侧栏，跟着「当前会话所在项目」走：
左边看改动（或直接翻文件树），右边看 diff / 编辑文件，保存后改动立即回到左侧列表。

```
┌─ 会话标题栏 ──────────────────────────────────────────── [变更] [侧栏] ┐
│                                                                        │
│  ┌─ Git 变更 ───────────────────────────────────────────────────────┐  │
│  │ [ my-project ▾ ] [变更 3|文件]        [⎇ 112ddd8] [↗] [⋯]        │  │
│  │ ───────────────────────────────────────────────────────────────── │  │
│  │ ▾ 未暂存 (2)          │  src/components/Panel.js                    │  │
│  │   M src/components/P…  │  40 │  const row = (entry) => {           │  │
│  │   M src/styles.js      │  41 │ -  const gap = 6                    │  │
│  │ ▸ 已暂存 (1)           │     │ +  const gap = 8                    │  │
│  │ ? README.zh.md        │  42 │    return row(entry, gap)           │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

Git 变动天然与项目强绑定，所以它不占会话区顶部标签、也不是独立窗口 —— 只挂在 **session 作用域的右侧栏**，
并从标题栏最右侧那个常驻按钮一键唤出。

## 功能

**变更模式（默认）**

- 冲突 / 已暂存 / 未暂存 / 未跟踪 四组分类；**同一文件可同时出现在「已暂存」和「未暂存」**（`MM` 文件，与 VSCode 一致）
- 目录树自动折叠单链（`src/features/auth` 一行显示），支持逐级展开
- 每行：状态字母（`M A D R C T U ?`）+ 文件名 + 弱化父路径 + `+N/−N` 行数
- 右侧 diff：**统一 / 并排** 两种视图、词级高亮（只标真正变化的片段）、上下文行数 1/3/6/12、忽略空白差异
- `\ No newline at end of file`、二进制 / 过大 / 子模块 / 纯重命名都有专门状态

**文件模式（可编辑）**

- 左侧懒加载目录树；右侧是**编辑器**：`textarea` + 行号列，直接改、`Ctrl/Cmd+S` 保存
- 未保存改动：标题栏「未保存」+ 文件树脏点；**切到别的文件再切回，改动还在**（草稿按路径留在面板内存里）
- `Tab` / `Shift+Tab` 缩进反缩进、`Enter` 沿用上一行缩进（走 `setRangeText`，不破坏原生撤销栈）
- 保存与磁盘冲突时给两个**显式**选择：`重新加载`（丢弃本地）/ `覆盖保存` —— 不存在"静默覆盖"

**远端**

- **版本号 chip**（当前提交短 SHA）：点一下 = 检测更新（`git fetch`），一行说明 `已是最新 / 落后 N 个 / 本地领先 N 个`
- **打开 Git 仓库**按钮：按 `remote.origin.url` 转成 https 在新标签打开（本地路径类远端没有网页，按钮自动禁用）

**通用**

- 三种仓库形态都能识别：项目根即仓库 / 项目内含多个仓库 / 手动追加的外部仓库目录
- 手动刷新在 `⋯` 菜单的「立即刷新」，`R` 键同效；可选 8s 自动刷新（仅窗口可见且聚焦时跑）
- 左列宽度可拖拽（键盘 `←/→` 也能调），宽度与所有显示偏好持久化
- `/` 聚焦筛选、`Esc` 清空、`↑↓` 移动、`Enter` 打开
- 深浅色自动跟随 DSH 主题（全部取色自 `--dsw-*` 令牌，零硬编码色值）

## 安装

需要 **Node ≥ 22**（安装脚本会自己校验 profile 与插件产物）。

```bash
git clone https://github.com/lcx19970714/dsh-git-panel.git
cd dsh-git-panel
node plugin/scripts/install-profile.mjs
```

脚本做三件事（幂等，可重复执行；加 `--dry-run` 可先看要改什么）：

1. 在 DSH profile 的 `node_modules` 下建目录联接 → 指向 `plugin/`（Windows 用 junction，不需要管理员权限）
2. 把 `dsh-git-panel` 写进 profile 的 `dependencies`（`link:` 形式）
3. 把 `dsh-git-panel` 追加进 `dsh.profile.bundles`

**然后重启一次 DSH**（宿主半体是 ESM，只在启动时加载）。

打开任意会话 → 点**标题栏最右侧的「变更」按钮**，或右侧栏「+」→「Git 变更」。

卸载：

```bash
node plugin/scripts/install-profile.mjs --uninstall
```

> 安装脚本按自身位置定位插件目录，克隆到哪个盘都能用。
> 它改写 profile 的 `package.json` 前会留一份 `package.json.bak-<时间戳>`。

## 常用操作

| 操作 | 方式 |
|---|---|
| 打开面板 | 标题栏「变更」按钮 / 右侧栏「+」→「Git 变更」 |
| 切换「变更 / 文件」模式 | 工具条中段的分段按钮 |
| 切换仓库根 | 工具条左侧的仓库 pill |
| 查看 diff | 变更模式点文件行；工具条可切统一/并排、调上下文行数、忽略空白 |
| 编辑并保存 | 文件模式点文件 → 直接改 → `Ctrl/Cmd+S` |
| 处理保存冲突 | 冲突条上二选一：`重新加载` / `覆盖保存` |
| 检测远端更新 | 点版本号 chip（当前提交短 SHA） |
| 打开远端仓库网页 | 点 `↗` 按钮 |
| 立即刷新 | `⋯` 菜单 →「立即刷新」，或 `R` |
| 筛选 / 跳转 | `/` 聚焦、`Esc` 清空、`↑↓` 移动、`Enter` 打开 |

## 三种仓库形态

| 形态 | 面板行为 |
|---|---|
| 项目根就是一个仓库 | pill 里只有「项目」一个根，直接工作 |
| 项目根下多个仓库（monorepo 风格） | 自动发现有 `.git` 的子目录，各成一根，pill 里切换 |
| 不在项目里的外部仓库 | pill →「添加外部仓库」选目录；记录持久化，可随时移除 |

项目根是仓库**子目录**时，变更列表展示的是**整个仓库**的变更（VSCode 行为）。

## 架构速览

```
┌──────────────── 客户端（浏览器侧，22 个 ES 模块 → 单文件 bundle）────────────────┐
│  index.js        注册标题栏按钮 + 右侧栏 tab（两个入口，同一个面板）              │
│  components/     Panel（唯一状态主体）· ChangesList · DiffView · FileTree ·       │
│                  FileEditor · RootPicker · States                                  │
│  util/           diff（hunk 解析/词级高亮）· changes（分组/选中对账）·             │
│                  paths · remote（URL → 网页）· time                               │
└───────────────────────────────┬──────────────────────────────────────────────────┘
                                │ 10 个 RPC 端点，POST /api/dsh-git/*
┌───────────────────────────────┴──────────────────────────────────────────────────┐
│  宿主（Node 侧，零运行时依赖）                                                    │
│  index.js        精确 Fetch 路由（connection.fetch.register）+ 信封/错误映射       │
│  host/git.js     spawn git → 解析（porcelain=v2 -z / unified diff / 目录 / 仓库）  │
│  host/roots.js   三种根形态的解析与外部根增删                                     │
│  host/config.js  外部根持久化（串行化写 + 损坏备份恢复）                           │
└──────────────────────────────────────────────────────────────────────────────────┘
```

设计上只有一条硬边界：**客户端不做文件系统与 git 操作**，一切都在宿主侧；`runGit` 全程
`spawn` + 参数数组，不拼 shell 字符串。写入只有一个端点（`file/write`），且必须带内容哈希。

| 端点 | 入参 | 返回 |
|---|---|---|
| `project/resolve` | `{sessionId?}` / `{cwd?}` | `{projectRoot, roots[], warnings[]}` |
| `roots/add` · `roots/remove` | `{projectRoot, path}` | 同上 |
| `status` | `{rootPath}` | `{branch, head, detached, upstream, ahead, behind, remoteUrl, files[], counts, truncated}` |
| `remote/fetch` | `{rootPath}` | `{url, branch, head, upstream, ahead, behind, fetchedAt}` |
| `diff` | `{rootPath, path, staged, untracked, contextLines, ignoreWhitespace}` | `{kind, hunks[], stats, language}` |
| `file/read` | `{rootPath, path}` | `{kind, text, size, language, eol, bom, hash, lines}`（文本一律 LF 归一） |
| `file/write` | `{rootPath, path, text, expectedHash, eol, bom}` / `{…, force:true}` | `{size, mtimeMs, hash}`；哈希不匹配 → `conflict` |
| `index/stage` | `{rootPath, path, action}` | `{path, action}`；`stage` = `git add --`，`unstage` = `git restore --staged --` |
| `index/stage-group` | `{rootPath, scope}` | `{scope}`；整组暂存 / 取消暂存 |
| `commit` | `{rootPath, message}` | `{head, subject}`；只提交已暂存内容 |
| `commit/message` | `{rootPath}` | `{message, model, source}`；有暂存看暂存，否则看未暂存 |
| `models/list` | `{}` | `{models[]}`；模型目录来自 profile 的 `llm-pi-ai` 配置 |
| `settings/get` / `settings/set` | `{commitModel?}` | `{commitModel}`；生成提交说明所用的模型 |
| `tree/list` | `{rootPath, path}` | `{entries[], truncated}` |

失败一律返回 `{ok:false, error:{code, message, details}}`，宿主 handler 绝不抛裸异常。

**保存的三条不变量**（细节见 [plugin/src/CONTRACT.md](plugin/src/CONTRACT.md)）：

1. 不丢用户按键 —— 草稿按路径留在面板内存，切走切回仍在
2. 不丢别人的改动 —— `file/read` 给内容哈希，`file/write` 必须带 `expectedHash`，不匹配就 `conflict`
3. 不制造伪 diff —— CRLF / BOM 按读取时的形式还原；原子写（同目录临时文件 + rename）

## 开发

```bash
cd plugin
npm run build    # src/*.js → client.js（自定义 mini-bundler，无外部依赖）
npm test         # 10 套 / 193 条断言
npm run check    # 语法检查 + 产物可复现性检查
```

- **测试覆盖**：路径与远端 URL 转换、diff 解析与词级高亮、目录树、打包器（含换行规范化的可复现性）、
  git 引擎（真实仓库）、宿主 10 个端点、客户端产物装载、组件渲染、面板端到端数据流
- **CI**：`windows-latest` + `ubuntu-latest`，Node 22。步骤 = 生成沙盒仓库 → **重建产物并校验与源码一致**
  （`git diff --exit-code -- plugin/client.js`）→ 跑全部测试。忘了 build 就提交会直接红
- **热更新**：客户端 bundle 会自动热加载；宿主代码改动需要重启 DSH

## 目录结构

```
.
├── .github/workflows/ci.yml     双平台 CI
├── plugin/                      ← 插件本体（profile 里的 link: 指向这里）
│   ├── index.js                 宿主入口：10 个端点 + 精确 Fetch 路由
│   ├── client.js                构建产物（被 DSH 直接装载，故入库）
│   ├── host/                    git.js · roots.js · config.js
│   ├── src/                     客户端 22 个模块（index / components / util / ui）
│   ├── build/build-client.mjs   零依赖打包器
│   ├── scripts/                 install-profile.mjs · verify-live.mjs
│   ├── test/                    10 套测试 + 沙盒仓库生成器
│   └── README.md                深入文档：平台约束、反兜底约定、排错
└── ...
```

`_recon/`（从 Electron 应用里解出的调研材料）与 `_sandbox/`（测试生成的沙盒仓库）不入库。

更细的内容在 [plugin/README.md](plugin/README.md)：DSH 平台的坑（`rpc.handle` 不可用、Loader 不认 `export const inject`）、
接线槽位、已知边界与排错。

## 已知边界

- **提交只提交已暂存内容**：未暂存的改动不会被自动带上；不做 discard / 分支操作
- 编辑器不开语法着色：浏览器里要「可编辑 + 高亮」得自己写编辑器内核或做透明层叠加，那套东西脆弱且难维护，
  所以这里明确不做半套。diff 视图的词级高亮不受影响
- 编辑器行号最多画 5000 行（再多只保留输入框，避免几万个 DOM 节点）
- 文件模式的筛选只作用于**已展开**的目录，不做仓库级全文搜索
- 单个文件 diff 超过 5000 行会截断并给出「展开全部」
- 二进制文件只提示，不渲染图片

## License

[MIT](LICENSE)
