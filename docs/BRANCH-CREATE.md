# 创建分支：带着未提交改动走

> 状态：**已实现**（`branch/create` + `branches/list` 的 `state`）。
> 本文既是设计说明，也是行为基准：文中每条 git 行为都在本机 `git 2.55.0.windows.5` 上实测过，
> 对应的断言落在 `test/host.test.mjs`（决策矩阵）与 `test/panel-flow.test.mjs`（界面流程）里。
> 端点表与契约细节见 `ARCHITECTURE.md` §3 与 `CONTRACT.md` §2。

## 0. 结论先行

**「工作区有改动」不会让创建分支失败，也不需要 stash —— 前提是新分支从当前 HEAD 开始。**
`git switch -c <name>` 只写两个东西：`refs/heads/<name>` 和 `HEAD`，**不碰索引、不碰工作区**。
所以「新分支直接就有这些改动、但一个提交都不多出来」是 `switch -c` 的免费性质，不是要实现的功能。

由此得到整个实现的形状（三件事，没有第四件）：

1. **base = 当前 HEAD**：一行 `git switch -c`，改动自动跟随。脏与不脏完全一样，零风险。
2. **base ≠ 当前 HEAD**：由 git 自己做两路合并 —— 脏文件与 `HEAD..base` 差异**无重叠**时它会把改动带过去；
   **有重叠**时它拒绝。插件在动手前用同一套规则预判，撞车就报 `would-overwrite` 并给出两个零风险出口：
   「改为从当前分支创建」/「只建分支（不切换）」。
3. **`checkout:false`**：`git branch <name> <base>`，只写 ref，工作区一个字节都不动（改动仍归原分支）。

**刻意没有的东西**（详见 §6）：自动 stash、「先存起来再搬过去」这一档、`-f` / `--discard-changes`、
预检端点（撞车判定与执行在 `branch/create` 内部共用一份代码，没有第二套规则可以漂移）。

## 1. 先把 git 事实钉死

### 1.1 从当前 HEAD 建分支：改动必然跟随，零风险

初始状态（把能脏的都脏上：未暂存修改 / 已暂存修改 / 未暂存删除 / 已暂存新文件 / 未跟踪文件）：

```
$ git status --porcelain=v1
 M f1.txt          # 已跟踪 · 未暂存修改
M  f2.txt          # 已跟踪 · 已暂存修改
 D f3.txt          # 已跟踪 · 未暂存删除
A  staged-new.txt  # 新文件 · 已暂存
?? brand-new.txt   # 未跟踪
$ git switch -c feature/x
Switched to a new branch 'feature/x'   [exit 0]
```

创建后逐项比对：`HEAD` 不变、`git status` / `git diff --cached --stat` / `git diff --stat` /
`ls-files --others` **全部字节一致** —— 暂存/未暂存的切分、`A ` 状态、删除、未跟踪文件都原样保留。

| 状态 | `git switch -c X`（无起始点） |
|---|---|
| 工作区干净 | 成功 |
| 任意混合脏状态（上述五种同时存在） | **成功，一切原样保留** |
| 游离 HEAD + 脏 | 成功；`X` 正好指向游离提交（这是「救回游离提交」的标准路径） |
| 未跟踪文件 | 保留（不被跟踪、不被移动） |
| 合并冲突未解决（`UU` + `MERGE_HEAD`） | **拒绝：`fatal: cannot switch branch while merging` [128]** |
| 空仓库（unborn HEAD） | 成功，`HEAD` 指向未诞生的 `X`；之后 `rev-parse HEAD` 仍然失败 |

### 1.2 从别的 base 建分支：会真的撞工作区

`git switch -c X origin/dev`（HEAD 在 main）实测：

| 脏文件与 `origin/dev` 的关系 | 结果 |
|---|---|
| 文件在 HEAD..origin/dev 之间**没有**差异 | 成功；改动被带过去，暂存切分保留；**自动设上游 `origin/dev`** |
| 已跟踪文件在两边**有**差异（修改是暂存还是未暂存都一样） | 拒绝 `error: Your local changes to the following files would be overwritten by checkout` [1] |
| 未跟踪文件在 base 里**存在**（哪怕内容完全一致） | 拒绝 `error: The following untracked working tree files would be overwritten by checkout` [1] |
| base 里**删除**了某个文件、本地又改了它 | 拒绝（同样走「local changes would be overwritten」） |
| `-f` / `--discard-changes` | 成功 = **静默丢弃所有已跟踪改动，并覆盖撞车的未跟踪文件** |

拒绝时索引、工作区、ref 全部不动 —— 这说明「先算、再动手」在 git 层是安全的，也说明第 5 行永远不能出现在插件里。

### 1.3 两个会咬人的坑

1. **同名远端分支不会自动跟踪。** `origin/feature/a` 存在时，`git switch -c feature/a` 是从 **HEAD**
   建（实测落后 1 个提交）、且没有上游（`fatal: no upstream configured`）。上游只在**起始点本身是
   remote-tracking ref** 时才自动设置；`--no-track` 可抑制。
   → 插件里「输入的名字恰好等于一个仅远端分支」必须被提示出来（界面给
   「要跟踪它，把「从」选成 `origin/x`」），否则用户以为自己建的是「远端那个分支的本地副本」。
2. **合并进行中 `switch` 被拒、`checkout -b` 不拒。** `git branch X` 也能建（只动 ref）。
   → 插件用 `switch`（`checkout` 的这个口子更像疏漏），并把该状态解释成可操作文案，同时把
   「只建分支」作为这个状态下唯一可行的出口。

### 1.4 为什么最终**不**走 stash（曾经的方案，实测后否决）

| 命令 | 实测结论 |
|---|---|
| `git stash push -u` + `switch` + `git stash apply --index` | 无重叠时确实能无损搬运，切分也保留 |
| 同样三步、**有重叠**时 | `apply --index` 必然在那几个文件上 `CONFLICT`（`UU` + 标记），`Index was not unstashed.` [1]，stash 条目保留 |
| `git stash apply`（不带 `--index`） | 把已暂存压成未暂存 —— 所以 `--index` 不能省 |
| `git stash create` | 只返回一个 SHA、不产生条目，且**不含未跟踪文件**，不能当安全快照 |

关键结论：**stash 只在「本来就不需要它」的场景下一切正常**（无重叠），而在**真正需要它**的场景
（有重叠）下必然制造冲突现场。也就是说它不是「平滑搬运」，而是「明知会冲突还要硬搬」。
所以这一档被删掉，撞车时给的是两个**零风险**出口，而不是一条注定冲突的第三条路。

### 1.5 `git branch X HEAD` 的边界

只创建 ref：`HEAD`、索引、工作区零变化，`git status -sb` 仍报 `## main`。
因此「只建分支、不切换」**不会**把改动带到新分支上 —— 之后在 main 上提交，提交就落在 main。
这一条必须写在界面上（`已创建 {name}（未切换）`），否则它就是本功能最容易骗人的地方。
另外空仓库里 `git branch X` 会失败（`not a valid object name`），所以 unborn 状态下没有这个出口。

## 2. 三个正交选择

| 选择 | 取值 | 默认 | 风险 |
|---|---|---|---|
| **base** | `'HEAD'` / 本地分支 / remote-tracking / 任意提交 | `'HEAD'` | 只有非 HEAD 才可能撞工作区 |
| **checkout** | `true`（建+切）/ `false`（只建 ref） | `true` | 只建不搬改动，改动留在原分支 |
| （无第三项） | — | — | 搬不搬由 git 的合并语义决定，不由插件选 |

完整决策矩阵（★ = 默认落点）：

| # | 工作区 | base | checkout | 做法 | 失败可能 |
|---|---|---|---|---|---|
| 1 | 干净 | HEAD | 是 ★ | `switch -c X` | 重名 / 非法名 / 合并中 |
| 2 | 脏 | HEAD | 是 ★ | `switch -c X` —— **一行命令，改动必然跟随** | 同上 |
| 3 | 脏 | HEAD | 否 | `branch X HEAD` | 无（但要提示改动没跟过来） |
| 4 | 干净 | 其它 | 是 ★ | `switch -c X --no-track <sha>` | base 不存在 |
| 5 | 脏·不撞车 | 其它 | 是 ★ | `switch -c X --no-track <sha>`：git 自己把改动带过去 | 重名 / 合并中 |
| 6 | 脏·撞车 | 其它 | 是 | **拒绝**（`would-overwrite`），给两个出口 | — |
| 7 | 脏 | 其它 | 否 | `branch X <sha>` | 无（改动留在原分支） |
| 8 | 任何 | HEAD | 是 · 合并/变基中进行 | **拒绝**（`in-progress`），只给 #3 出口 | — |
| 9 | unborn | HEAD | 是 | `switch -c X` | — |
| 10 | unborn | HEAD | 否 | **拒绝**（`unborn`） | — |

## 3. 契约

### 3.1 `branches/list` 增补 `state`

菜单打开时本来就要读分支名单，把「当前现状」放进同一个响应，创建区才不用多一次往返：

```js
{ branches, current, state }

state: {
  head: 'a1b2c3d' | null,        // null = unborn（还没有第一个提交）
  detached: boolean,
  unborn: boolean,
  inProgress: null | 'merge' | 'rebase' | 'cherry-pick' | 'revert',   // 读 .git/MERGE_HEAD 等标记文件
  dirty: { total, staged, unstaged, untracked, conflicted }           // 与 status.counts 同形，但不做行数统计
}
```

`head` / `detached` / `unborn` / `inProgress` / `dirty` 的读法共用 `status` 端点的 porcelain 解析
（`readWorkingEntries` + `countStatus`），不做第二套解释；`inProgress` 只 `existsSync` 几个标记文件，不调 git。

### 3.2 `branch/create`

```js
// 入参（三个字段全部必填，缺即 bad-request）
{ rootPath, name, base, checkout }

// 返回
{
  branch, head,
  previousBranch, previousHead,      // 创建前在哪（游离 HEAD 时 previousBranch 为 null）
  base: { ref, kind, sha },          // kind: 'head' | 'local' | 'remote' | 'commit'
  switched,
  carried: { total, staged, unstaged, untracked, conflicted }   // 创建后的工作区脏计数
}
```

`kind` 由 `git rev-parse --symbolic-full-name` 判定（不靠文本猜）；`base.tracking` 只在「远端引用的
分支段与新分支同名」时非空（base=`origin/topic`、name=`topic`），此时用 `--track`，其余一律 `--no-track`。

| code | 场景 | 时机 |
|---|---|---|
| `bad-branch` | 名字非法（`check-ref-format --branch`） | 动手前 |
| `branch-exists` | 本地已有同名分支 | 动手前 |
| `base-not-found` | base 无法解析成提交（例如 `origin/dev` 还没 fetch） | 动手前 |
| `in-progress` | merge / rebase / cherry-pick / revert 进行中且 `checkout:true` | 动手前 |
| `unborn` | 空仓库且 `checkout:false` | 动手前 |
| `would-overwrite` | 跨 base 且脏文件与 base 差异重叠、`checkout:true` | 动手前 |

所有拒绝都发生在**任何写操作之前**，所以失败时仓库状态一定是原样的 —— 这正是界面敢把
`would-overwrite` 当成「换个参数再试一次」而不是「出事了」的原因。`would-overwrite` 的
`details` 为 `{ base, tracked: [...], untracked: [...] }`，message 里内联文件清单（最多 8 个 + 另有 N 个）。

## 4. 撞车预判怎么算

一条只读命令就够，而且与 git 自己的两条拒绝规则一一对应：

```
git diff --no-renames --name-status -z HEAD <baseSha>
  → (状态, 路径) 序列，状态 ∈ A/M/D/T
碰撞.tracked   = 路径 ∩ (已暂存 ∪ 未暂存 ∪ 删除 ∪ 已暂存的新文件)
碰撞.untracked = 未跟踪路径 ∩ 差异路径
```

- `--no-renames` 让「base 里被重命名」表现为 `D 旧路径 + A 新路径`，两条路径自然落进差异集合，
  不需要单独处理 `R` 条目；
- 未跟踪文件不可能在 HEAD 里，所以它出现在差异里就一定是撞车（实测连内容完全一致也拒绝）；
- base 里**删除**了一个本地改过的文件，同样会表现为差异路径 → 判定为撞车（与 git 行为一致）。

返回的是**预判**：最终裁决权在 git。预判与 git 不一致时以 git 原文为准（不静默重试、不改写错误，
`runGit` 已经把 git 的原话带在 `GitError.details` 里）。

## 5. 界面流程（分支菜单）

原则：**无风险路径不加仪式，有风险路径才给选择。** 默认路径仍是「打名字回车」。

```
┌ 分支 · my-repo ──────────────────────────────────┐
│ ⟳ 拉取当前分支最新代码                             │
│ ⇅ 获取远程更新                                     │
│ ───────────────────────────────────────────────── │
│ ✓ main                              [本地][远程]   │
│   feature/a                         [本地][远程]   │
│ ───────────────────────────────────────────────── │
│ [新分支名______________]                [创建]      │
│ 从 [当前分支 main ▾]              ☑ 创建后切换      │
│ 当前 main · 3 处改动（1 已暂存）                    │
└───────────────────────────────────────────────────┘
```

- **脏工作区**：只显示一行改动计数（`当前 main · 3 处改动（1 已暂存）`）。它是「改动会不会跟过去」
  的现场证据；base=HEAD 时这些改动必然跟随，所以不加任何确认。
- **「从」下拉框（起点）**：默认「当前分支 {name}」，其它本地分支标「（本地）」、远端分支标「（远端）」
  —— 只写 `origin/dev` 对不熟 git 的人是看不懂的。选了非当前分支时，下面立刻补一句人话：
  `新分支从 dev 的最新提交开始；你的 N 处改动会跟着一起带过去（和它撞上时，插件会先拦下来让你选）`。
  这个下拉框的存在理由只有一个：支持「从 `origin/dev` 拉一个新分支，但把我现在改的东西带过去」，
  不选它就永远是「从你现在的位置开一个新分支」。
- **`inProgress` 非空**：默认不勾「创建后切换」并禁用勾选框，按钮变成「只建分支」，同时用一行文案说明
  「合并进行中，git 不允许切换分支」——不是拦住用户，而是告诉他这个状态下唯一可行的动作。
- **输入的名字命中仅远端分支**：提示「远端已有 `origin/x`：要跟踪它，把「从」选成 `origin/x`」。
- **撞车（`would-overwrite`）**：不当成失败，也不弹第二个对话框；在创建区里出一块提示（含文件清单）
  + 两个按钮：`改为从当前分支创建` / `只建分支（不切换）`。两者都是「同一件事换参数重试」。
- **结果提示**（复用工具条的 `data-update-note`）：三种结局分开说 ——
  `已创建并切换到 {name}；{total} 处改动已跟随（未提交）` /
  `已创建并切换到 {name}`（本来就干净）/ `已创建 {name}（未切换）`。
- **建完还要回答「要不要推送」**：新建的本地分支远端没有，所以紧接着「变更」页签会出现常驻提示
  `这条分支还只在你电脑上` + **「推送到远端」按钮** + 可照抄的 `git push -u origin <新分支>`
  （`status.pushed === false` 驱动，是这句话唯一的渲染点；创建 PR 表单不再重复同一块内容，
  只把「创建」置灰并给一行原因）。点按钮由宿主执行
  `branch/push`（本机 git 凭据），推完提示自动消失。唯一例外：base 就是 `origin/<新分支同名>`
  （跟踪创建），这时远端本来就有，不会提示。

## 6. 明确不做

| 不做 | 理由 |
|---|---|
| 自动 stash / 「先存再搬」 | 无重叠时不需要（git 自己带过去）；有重叠时 `apply --index` 必然冲突（§1.4）——等于给一条注定冲突的路写代码 |
| `switch -f` / `--discard-changes` / `reset --hard` | 实测会静默丢改动、覆盖撞车的未跟踪文件 |
| 预检端点（`branch/create/plan`） | 客户端要的现状全在 `branches/list.state`；撞车判定放在 `branch/create` 内部，与执行共用一份代码，没有第二套规则可漂移 |
| 创建失败后自动删分支 / 回滚 | 所有拒绝都发生在动手前，没有「半成品」需要回滚；真出意外时回滚比失败更危险 |
| 自动设上游到 base | 特性分支的上游应该是 `origin/<同名>`；设成 `origin/dev` 会让 `push.default=simple` 直接卡住 |
| `checkout -b` 绕过合并限制 | 合并中切分支属于可疑操作；`switch` 的拒绝是更靠谱的默认 |
| 自动提交（「先提交再挪」） | 用户明确要求「提交还是要单独提交」；且会触发 hooks、改变 index 语义 |

## 7. 备选方案与否决理由

- **「创建时总是 stash → switch → pop」**：对默认路径是纯增加风险（§1.1 已证明不需要），
  对撞车路径必然冲突（§1.4）。否决。
- **「先提交，再 `switch -c`，再 `reset --soft HEAD~1`」**：确实有快照、也能搬过去，但会触发用户仓库的
  hooks、产生一个真实提交（容易被误推），且 `reset` 属于本插件刻意不碰的写操作。否决。
- **「创建分支 = 只建 ref（`git branch`），切换由用户自己做」**：最安全，但违背「新分支直接有这些变动」
  的诉求，也把 git 的报错推给用户。只作为撞车与合并中的出口保留。
- **「worktree 隔离」**：插件不浏览外部目录；且改动不会自动进新 worktree，还要再搬一次。
- **「持久化上次选的 base / 记住『创建后切换』」**：默认值就是最安全的那个（HEAD + 切换），
  记住上一次的冒险选择只会让下一次更容易误操作。不做。

## 8. 测试锚点

| 层 | 用例 |
|---|---|
| `host.test.mjs` | 混合脏状态下 `carried` 逐字节保真（status / cached diff / worktree diff 全等，且不产生 stash 与提交）；`checkout:false` 不动工作区；跨基准无重叠时改动被带走且无上游；跨基准撞车时 `details.tracked/untracked` 正确且仓库状态原样；撞车后两个出口都能成功；合并中 `in-progress` 与只建分支；unborn 的两个结局；三个入参缺失、重名、非法名、base 不存在的错误码；`branches/list.state` 的形状（含游离 HEAD） |
| `panel-flow.test.mjs` | 脏计数与基准候选；只建分支的载荷与按钮文案；撞车提示块与两个出口的重试载荷；合并中勾选框禁用 + 文案；同名远端提示；成功后的工具条文案分三种结局 |
