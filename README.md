# dsh-git-panel

DeepSeek Harness 的 Git 面板插件：在会话右侧栏里看变更、读 diff、编辑文件、暂存与提交，提交说明可以直接用 DSH 里已配置的模型生成。

## 安装

**在线安装（推荐）**

DSH → 侧边栏「插件」→「安装第三方插件」，填入：

```
github:lcx19970714/dsh-git-panel
```

点安装即可。装完重启一次 DSH（或在「插件」页随便关开一个插件触发重组），会话标题栏右侧就会出现「变更」按钮。

**命令行安装**

```bash
dsh plugin add github:lcx19970714/dsh-git-panel
```

**本地开发**

```bash
git clone https://github.com/lcx19970714/dsh-git-panel.git
cd dsh-git-panel
node scripts/install-profile.mjs      # 建目录联接装进 default profile
```

这条路径下改 `src/` 后跑 `node build/build-client.mjs` 立即生效（客户端热替换，约 1s）。

## 能做什么

| 功能 | 说明 |
|---|---|
| 变更列表 | 列表 / 树形两种显示，可在设置里切换；支持筛选与键盘导航 |
| 查看 diff | 统一 / 并排视图、上下文行数、忽略空白、词级高亮 |
| 编辑并保存 | 文件模式直接改，`Ctrl/Cmd+S` 保存；带内容哈希校验，冲突时二选一 |
| 暂存 / 取消暂存 | 文件行尾 `+` / `−`，分组头可整组操作 |
| 提交 | smart commit：有暂存只提交暂存；没有暂存则先全部暂存再提交 |
| 生成提交说明 | 用 DSH 里配好的模型生成，优先用暂存内容；生成中显示进度 |
| 多仓库 | 项目内仓库、子目录仓库、外部仓库都列在「储存库」里，点选切换 |
| 切换分支 | 点「储存库」行里的分支名弹出分支菜单；工作区怎么处理交给 git，会被覆盖就原样报错 |
| 检测更新 | 点版本号执行 `git fetch`，结果显示在版本号左侧 |
| 设置 | 模型、列表/树形、未跟踪文件分组 |

## 三种仓库形态

| 形态 | 面板行为 |
|---|---|
| 项目根就是一个仓库 | 「储存库」里一行，直接用 |
| 项目下有多个仓库 | 自动发现（最深 4 层、跟随目录联接），各占一行 |
| 仓库不在项目里 | 「储存库」标题行 `+` 添加外部仓库，行尾可移除 |

项目根只是仓库子目录时，变更列表展示整个仓库的变更（与 VS Code 一致）。

## 配置

设置入口在工具条右侧的齿轮：

- **生成提交说明的模型** — 列出 DSH 当前可用的模型，选中即保存；未配置时生成会提示
- **变更文件的显示方式** — 列表 / 树形
- **未跟踪文件的分组** — 并进「未暂存」（与 VS Code 一致）或单列一组

## 限制

- 只做暂存、提交与分支切换；不新建/删除分支，不做 push、discard
- 文件模式固定浏览项目根（没有仓库选择器），仓库切换只发生在变更模式的「储存库」里
- 提交会执行仓库自己的 git hooks，失败时原样显示 hook 的输出
- 文件模式的编辑不设语法高亮（diff 视图仍有词级高亮）

## 开发

```bash
node build/build-client.mjs            # 构建客户端产物 client.js
node test/run.mjs                      # 全部 10 个测试套件
node scripts/audit-dead-code.mjs       # 死代码体检（CI 也跑）
node test/make-fixture.mjs _sandbox/repo   # 生成 host 测试用的真实仓库
```

文档：[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)（平台约束、端点、反兜底约定）、[docs/CONTRACT.md](docs/CONTRACT.md)（客户端模块契约）。

## License

MIT
