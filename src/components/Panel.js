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
 * 刷新策略：
 *  · 轮询（8s）/ 窗口重新可见+聚焦 → status + 储存库汇总；status 内容没变就不落状态，
 *    所以也不会连带重取 diff；
 *  · 手动刷新（R / 立即刷新）→ 额外重读当前 diff、文件内容与文件树（外部改动是显式意图）；
 *  · 任何写操作（暂存 / 提交 / 保存 / 分支）→ 一次 refreshRepository（status + 汇总）。
 * 每次请求带序号守护与 AbortController，切根 / 卸载时旧请求会被真正取消。
 */
import { h, useCallback, useEffect, useMemo, useRef, useState, getPluginContext } from '../platform.js'
import { Icon } from '../ui/Icon.js'
import { PopupMenu, MenuItem, MenuLabel, MenuSeparator } from '../ui/Menu.js'
import { useTimedNotice } from '../ui/useTimedNotice.js'
import { useSnapshotResource } from '../ui/useSnapshotResource.js'
import { RepoList } from './RepoList.js'
import { ChangesList } from './ChangesList.js'
import { FileTree } from './FileTree.js'
import { DiffView } from './DiffView.js'
import { FileEditor } from './FileEditor.js'
import { EmptyState, LoadingState, InlineNote } from './States.js'
import { CommitBox } from './CommitBox.js'
import { CreatePullForm } from './CreatePullForm.js'
import { PushHint } from './PushHint.js'
import { PullStatusCard } from './PullStatusCard.js'
import { SettingsView } from './SettingsView.js'
import { RemotePane } from './RemotePane.js'
import { RemoteDetail } from './RemoteDetail.js'
import { PullDetail } from './PullDetail.js'
import { MODE, readPrefs, writePref, readRemoteAccount, saveRemoteAccount, usePref, useLatestGuard } from '../store.js'
import * as api from '../api.js'
import { openExternalUrl } from '../util/openUrl.js'
import { reconcileSelection, statusSignature } from '../util/changes.js'
import { readSnapshot, writeSnapshot, snapshotAge } from '../util/resource-cache.js'
import { readDrafts, writeDraft, dropDraft } from '../util/draft-cache.js'
import { webUrlOf } from '../util/remote.js'
import { formatClock } from '../util/time.js'

const POLL_INTERVAL_MS = 8000
/** 工具条与提交框的信息类提示：看一眼就够，别一直占着位置。 */
const NOTE_TTL_MS = 8000
const MIN_LEFT = 180
const MIN_RIGHT = 280
/** 需要展示提示条的 sync 状态：该推送的两种 + 远端已被删除（要收尾）。 */
const SYNC_HINT_STATES = ['never-pushed', 'ahead', 'remote-deleted']

const NO_ROOTS = { projectRoot: null, roots: [], warnings: [] }

function documentVisible() {
  return document.visibilityState !== 'hidden'
}

function documentFocused() {
  return document.hasFocus()
}

/**
 * 两份「改动规模」是否一样。
 *
 * 轮询每 8 秒回来一次，内容一致时不该让整张储存库列表重渲染 —— 那会连带
 * 重新计算行布局，并让「有数字」的视觉稳定感碎掉。
 */
function sameRootStats(previous, next) {
  const previousKeys = Object.keys(previous)
  if (previousKeys.length !== Object.keys(next).length) return false
  for (const key of previousKeys) {
    const before = previous[key]
    const after = next[key]
    if (after === undefined || before.error !== after.error) return false
    if (before.error !== undefined) continue
    if (before.counts.total !== after.counts.total) return false
    if (before.counts.conflicted !== after.counts.conflicted) return false
    if (before.adds !== after.adds || before.dels !== after.dels || before.binary !== after.binary) return false
  }
  return true
}

export function Panel(props) {
  const t = props.t
  const tRef = useRef(t)
  tRef.current = t
  /** loadAccounts 定义在 openSettings 之后，这里留一个最新引用供打开设置时调用。 */

  const sessionId = props.sessionId

  /**
   * 首屏快照的键。
   *
   * 切走再切回来时组件会重新挂载：先拿上次的成功结果渲染，再后台刷新。
   * 项目根按会话分键（不同会话可能是不同项目），status 按仓库路径分键
   * （同一仓库被多个会话打开时共用一份快照）。
   */
  const projectKey = 'project:' + String(sessionId)
  const statusKeyOf = (rootPath) => 'status:' + rootPath
  const selectionKeyOf = (rootPath) => 'changes-selection:' + rootPath
  const fileSelectionKeyOf = (rootPath) => 'file-selection:' + rootPath

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
  /** 提交成功后自动推送（默认开；对应 VS Code 的 git.postCommitCommand）。 */
  const [postCommitPush, setPostCommitPush] = usePref('postCommitPush')

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
  // 右侧详情：选中的仓库
  const [remoteSelection, setRemoteSelection] = useState(null)
  // 分支数据是「按账号+仓库」的：记住上次拉的是哪一份，避免切页签/关 PR 时重复请求
  const branchSelectionRef = useRef(null)
  const remoteReposRef = useRef([])
  remoteReposRef.current = remoteRepos
  // 面板内打开的 PR
  const [openPull, setOpenPull] = useState(null)
  const [accountsBusy, setAccountsBusy] = useState(false)
  const [accountsError, setAccountsError] = useState(null)
  const [accountsNotice, setAccountsNotice] = useState(null)
  // 合并后 PR 会自动关闭，提示放在右侧顶部（PullDetail 已卸载，它的本地提示会丢）
  const [remoteNotice, setRemoteNotice] = useState(null)

  /* ------------------------------- 根 ------------------------------- */
  // 挂载时先吃上次的快照：有就零延迟出画面，没有才骨架屏
  const [project, setProject] = useState(() => readSnapshot(projectKey) ?? NO_ROOTS)
  const [activeRootId, setActiveRootId] = useState(null)
  const [rootsLoading, setRootsLoading] = useState(() => readSnapshot(projectKey) === undefined)
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
   * 「当前可操作的仓库」：变更模式里的写操作（暂存 / 提交 / 生成说明 / 建 PR）都只对它生效。
   *
   * `activeRoot` 是「储存库列表里当前高亮的那一行」，它可以是 null：所有仓库都被隐藏时
   * `visibleRoots` 为空，那是一个真实状态（没有可操作的仓库），不是异常。渲染层与回调
   * 一律只看 `activeRepo` 是否为 null，不再各自拼 `activeRoot === null || activeRoot.isGit === false`
   * 这种两段判定 —— 那种写法漏掉一处就是一个渲染期 TypeError，而渲染期异常会被宿主
   * 换成一块没有任何内容的黑屏（`GitPanelSurface.js`）。
   */
  const activeRepo = activeRoot !== null && activeRoot.isGit === true ? activeRoot : null
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

  /* ------------------------- 远端资源（快照 + 守护） ------------------------- */
  /**
   * 四个「按选中项取数」的资源共用同一套语义，差别只在三个开关：
   *  · 仓库详情 / PR 详情：失败就清空，让错误态独自占屏；
   *  · 分支全貌 / 当前分支 PR 卡片：刷新与失败都保留上一份数据，列表与卡片不闪。
   */
  const remoteDetailResource = useSnapshotResource({
    keyOf: (selection) => 'remote-detail:' + selection.accountId + ':' + selection.fullName,
    // 带上账号 id：同名仓库在不同账号下不能共用一份详情
    load: (selection) => api.remoteDetail({ accountId: selection.accountId, fullName: selection.fullName })
      .then((value) => ({ ...value, accountId: selection.accountId })),
    t
  })
  const remoteBranchesResource = useSnapshotResource({
    keyOf: (selection) => 'remote-branches:' + selection.accountId + ':' + selection.fullName,
    load: (selection) => api.remoteBranches({
      accountId: selection.accountId,
      fullName: selection.fullName,
      rootPaths: allGitRoots.map((root) => root.path)
    }),
    keepPrevious: true,
    keepOnError: true,
    t
  })
  const pullDetailResource = useSnapshotResource({
    keyOf: (selection) => 'pull:' + selection.accountId + ':#' + String(selection.number),
    load: (selection) => api.remotePull({
      accountId: selection.accountId,
      fullName: selection.fullName,
      number: selection.number
    }),
    onLoaded: (selection, data) => {
      // 详情里能看到评论 = 用户已读：记水位供状态卡算未读
      writePref('pullSeen', {
        ...(readPrefs().pullSeen ?? {}),
        [selection.accountId + '#' + selection.number]: data.comments.length
      })
    },
    t
  })
  const linkedPullResource = useSnapshotResource({
    snapshot: false,
    keepPrevious: true,
    keepOnError: true,
    // 仓库是入参而不是闭包：没有活动仓库时这个请求没有意义，调用方必须先把仓库给它
    // （带上的 rootId 让切根后在途的旧结果不会挂到新仓库的卡片上）
    load: (root) => api.prLinked({ rootPath: root.path }).then((value) => ({ ...value, rootId: root.id })),
    t
  })

  const remoteDetail = remoteDetailResource.state
  const remoteBranches = remoteBranchesResource.state
  const pullDetail = pullDetailResource.state
  const linkedPull = linkedPullResource.state
  const loadRemoteDetail = remoteDetailResource.reload
  const loadRemoteBranches = remoteBranchesResource.reload
  const loadPullDetail = pullDetailResource.reload
  const loadLinkedPull = linkedPullResource.reload
  const clearRemoteBranches = remoteBranchesResource.clear
  const clearPullDetail = pullDetailResource.clear
  const remoteBranchesRef = useRef(remoteBranches)
  remoteBranchesRef.current = remoteBranches

  /** 打开某个 PR 时清掉上次合并的提示。 */
  const openPullWith = useCallback((selection) => {
    setRemoteNotice(null)
    setOpenPull(selection)
  }, [])

  /* ------------------------------ status ------------------------------ */
  const [status, setStatus] = useState(null)
  /** 最新 status 的同步引用：判断「要不要显示骨架屏」时不用把它塞进 useCallback 依赖。 */
  const statusRef = useRef(status)
  statusRef.current = status
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusError, setStatusError] = useState(null)
  /** 上一次 status 的内容指纹：没变就不落状态（否则每 8 秒重渲染整张列表并重取 diff）。 */
  const statusSignatureRef = useRef(null)
  /** 储存库列表每行的改动规模：path -> { counts, adds, dels, binary } | { error } */
  const [rootStats, setRootStats] = useState({})
  const rootStatsRef = useRef(rootStats)
  rootStatsRef.current = rootStats
  /** 正在暂存/取消暂存的文件路径；同时只允许一个，避免连点打乱索引。 */
  const [stagePending, setStagePending] = useState(null)
  const stagePendingRef = useRef(null)
  const statusSeq = useLatestGuard()
  const statusAbortRef = useRef(null)
  const statsSeq = useLatestGuard()
  const statsAbortRef = useRef(null)

  /* ----------------------------- 选中状态 ----------------------------- */
  /**
   * 两个页签各有一份选中项，互不迁移。
   *
   * 「变更」里的路径是仓库相对（活动仓库可能是项目里的子仓库），「文件」里的路径是
   * 项目浏览根相对。共用一份状态时，切页签会把一个根下的相对路径套到另一个根上 ——
   * 在单仓库项目里碰巧对，多仓库项目里打开的是另一个同名文件。
   *
   * changesSelection: { rootPath, path, entry, side }
   * fileSelection:    { rootPath, path }
   */
  const [changesSelection, setChangesSelection] = useState(null)
  const [fileSelection, setFileSelection] = useState(null)
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
  /** 文件树的手动刷新序号：+1 时清空目录缓存并重读（否则外部新建的文件永远看不到）。 */
  const [treeNonce, setTreeNonce] = useState(0)

  /**
   * 远端仓库列表 / 账号列表的序号守护。
   *
   * 它们都「先 setLoading 再 await」：切账号时旧账号的列表不能覆盖新账号的。
   * 详情 / 分支 / PR 详情各自有序号守护，见 useSnapshotResource。
   */
  const remoteReposGuard = useLatestGuard()
  const pullCountsGuard = useLatestGuard()
  const accountsGuard = useLatestGuard()

  /**
   * 编辑器草稿表：path -> { text, savedText, hash, eol, bom }。
   *
   * 为什么按 path 存在面板内存里（而不是只存"当前文件"）：
   *  用户在 A 文件改了几行、切去看 B、再切回 A —— 未保存的内容必须还在。
   *  静默丢弃按键是最不能接受的失败方式，所以草稿的生命周期 = 面板实例的生命周期。
   */
  const [drafts, setDrafts] = useState(() => new Map())
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  /** 草稿缓存按「仓库根」分桶：切到别的根再切回来，未保存的改动仍在。 */
  const draftsRootRef = useRef(null)
  const [saveState, setSaveState] = useState({ busy: false, savedAt: 0, error: null, conflict: null })
  const saveSeq = useLatestGuard()
  /**
   * 插件自身版本与更新检查（与本仓库的 git 状态无关）。
   */
  const [pluginState, setPluginState] = useState({
    version: null, busy: false, latestVersion: null, url: '', publishedAt: '', newer: false, checkedAt: 0, error: null
  })
  /** 工具条提示：插件检查结果与上游检查结果共用一条，谁最后动作显示谁。 */
  const [toolbarNote, setToolbarNote] = useTimedNotice(NOTE_TTL_MS)
  const checkSeq = useLatestGuard()

  // 派生值只依赖 state，放在动作之前：checkUpdates/openRemote 要用到它们
  const versionText = pluginState.version === null ? '—' : 'v' + pluginState.version
  const remoteWebUrl = webUrlOf(status === null ? null : status.remoteUrl)
  const versionTitle = buildVersionTitle(pluginState, t)
  const updateNote = toolbarNote

  /* --------------------------- 提交 / 设置 --------------------------- */
  const [commitMessage, setCommitMessage] = useState('')
  const [commitBusy, setCommitBusy] = useState(false)
  const [commitGenerating, setCommitGenerating] = useState(false)
  /** 生成中的已等待毫秒数：每 200ms 刷新一次，让用户看得见它在跑。 */
  const [generateElapsed, setGenerateElapsed] = useState(0)
  const [commitNote, setCommitNote] = useTimedNotice(NOTE_TTL_MS)
  /**
   * 「推送 / 收尾」这类远端动作的状态：{ busy, error }。
   * error 直接显示在提示块里，不弹窗；推送与收尾共用这一份（同一时刻只会做一个）。
   */
  const [remoteAction, setRemoteAction] = useState({ busy: false, error: null })
  const remoteActionRef = useRef(remoteAction)
  remoteActionRef.current = remoteAction
  const [showSettings, setShowSettings] = useState(false)
  /**
   * 创建 PR 表单（右侧面板）：
   * { loading, error, repo, head, bases, accounts, accountId, base, title, body,
   *   generating, creating, created, notice }
   *
   * 这里没有推送状态：「分支与远端的关系」属于仓库状态，唯一来源是 `status.sync`。
   * 表单另存一份快照只会有两个后果 —— 同一屏出现两块同样的提示、以及推送后两边对不上。
   */
  const [pullForm, setPullForm] = useState(null)
  const [settingsState, setSettingsState] = useState({ loading: false, models: [], commitModel: null, reviewModel: null, commitThinking: false, commitReasoningEffort: null, error: null, saved: false })

  const [moreOpen, setMoreOpen] = useState(false)
  const moreAnchorRef = useRef(null)
  const [moreAnchorRect, setMoreAnchorRect] = useState(null)

  const rootRef = useRef(null)
  const bodyRef = useRef(null)
  const dividerRef = useRef(null)

  /* ============================ 解析项目根 ============================ */
  const resolveProject = useCallback(async (signal) => {
    // 有快照时这是「后台重新验证」：不把画面切回骨架屏
    if (readSnapshot(projectKey) === undefined) setRootsLoading(true)
    setRootsError(null)
    try {
      const value = await api.resolveProject({ sessionId }, { signal })
      if (signal !== undefined && signal.aborted) return
      const next = { projectRoot: value.projectRoot, roots: value.roots, warnings: value.warnings }
      writeSnapshot(projectKey, next)
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
  }, [sessionId, projectKey])

  useEffect(() => {

    const controller = new AbortController()
    resolveProject(controller.signal)
    return () => controller.abort()
  }, [resolveProject, sessionId])

  /* ============================== 刷新 status ============================== */
  const refreshActiveStatus = useCallback(async () => {
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
    statusAbortRef.current?.abort()
    statusAbortRef.current = controller
    // 已经有画面时不再显示加载态：轮询每 8 秒一次，闪一下骨架屏比不刷新还糟。
    const showLoading = statusRef.current === null
    if (showLoading) setStatusLoading(true)
    setStatusError(null)
    try {
      const value = await api.readStatus({ rootPath: root.path }, { signal: controller.signal })
      if (!statusSeq.isLatest(token)) return
      // 内容没变就不落状态：否则每一轮轮询都会重渲染整张列表、把选中项换成新对象、
      // 再连带把 diff 重新取一遍 —— 什么都没有变，只是又跑了一圈。
      const signature = statusSignature(value)
      if (signature === statusSignatureRef.current) return
      statusSignatureRef.current = signature
      setStatus(value)
      writeSnapshot(statusKeyOf(root.path), value)
      setChangesSelection((previous) => reconcileSelection(previous, value.files))
    } catch (error) {
      if (!statusSeq.isLatest(token) || error.code === 'aborted') return
      setStatusError(api.describeError(error, tRef.current))
    } finally {
      if (statusAbortRef.current === controller) statusAbortRef.current = null
      if (showLoading && statusSeq.isLatest(token)) setStatusLoading(false)
    }
  }, [statusSeq])

  /* ============================ 刷新储存库汇总 ============================ */
  /**
   * 储存库列表每行要显示「改动文件数 + 增删行数」：一次请求把所有仓库查完，
   * 宿主那边还能命中 status 缓存。内容没变就不落状态（否则列表会跟着轮询重渲染）。
   */
  const refreshRootStats = useCallback(async () => {
    const paths = projectRef.current.roots.filter((root) => root.isGit === true).map((root) => root.path)
    if (paths.length === 0) {
      if (Object.keys(rootStatsRef.current).length > 0) setRootStats({})
      return
    }
    const token = statsSeq.begin()
    const controller = new AbortController()
    statsAbortRef.current?.abort()
    statsAbortRef.current = controller
    try {
      const value = await api.rootStats({ paths }, { signal: controller.signal })
      if (!statsSeq.isLatest(token)) return
      const next = {}
      for (const summary of value.summaries) next[summary.path] = summary
      if (sameRootStats(rootStatsRef.current, next)) return
      setRootStats(next)
    } catch (error) {
      if (!statsSeq.isLatest(token) || error.code === 'aborted') return
      setStatusError(api.describeError(error, tRef.current))
    } finally {
      if (statsAbortRef.current === controller) statsAbortRef.current = null
    }
  }, [statsSeq])

  /** 一次仓库操作之后要同时跟上的两件事：活动仓库的 status、所有仓库的改动规模。 */
  const refreshRepository = useCallback(async () => {
    await Promise.all([refreshActiveStatus(), refreshRootStats()])
  }, [refreshActiveStatus, refreshRootStats])

  /** 根集合本身变了（新增 / 隐藏 / 取消隐藏 / 移除）：汇总数字要跟着换一批。 */
  const gitRootPathsKey = useMemo(
    () => project.roots.filter((root) => root.isGit === true).map((root) => root.path).join('\u0000'),
    [project.roots]
  )
  useEffect(() => {
    refreshRootStats()
  }, [gitRootPathsKey, refreshRootStats])

  /**
   * 用户主动刷新（工具条 / R 键）：重读 status、储存库汇总、当前 diff、文件内容与文件树。
   *
   * 轮询不碰 diff / 文件树：那两样只有内容真的变了才需要重来，而 status 指纹
   * 已经负责判断「变没变」；手动刷新是用户的显式意图，一律重读。
   */
  // 卸载时取消还在跑的汇总请求（status 由根 effect 负责）。
  useEffect(() => () => {
    statsAbortRef.current?.abort()
    statsAbortRef.current = null
  }, [])

  const refreshAll = useCallback(() => {
    setFileNonce((count) => count + 1)
    setDiffNonce((count) => count + 1)
    setTreeNonce((count) => count + 1)
    refreshRepository()
  }, [refreshRepository])

  useEffect(() => {
    // 换根：先把上次看过的快照摆上来，再后台刷新 —— 切回来不再白屏
    const rootPath = activeRepo === null ? null : activeRepo.path
    const cachedStatus = rootPath === null ? undefined : readSnapshot(statusKeyOf(rootPath))
    const cachedSelection = rootPath === null ? undefined : readSnapshot(selectionKeyOf(rootPath))
    statusSignatureRef.current = cachedStatus === undefined ? null : statusSignature(cachedStatus)
    setStatus(cachedStatus ?? null)
    setChangesSelection(reconcileSelection(cachedSelection ?? null, cachedStatus === undefined ? [] : cachedStatus.files))
    setDiff(null)
    // 换仓库 = 换了一份上下文：提交说明、创建 PR 表单、操作结果都不属于新仓库
    setRemoteAction({ busy: false, error: null })
    setCommitMessage('')
    setCommitNote(null)
    setPullForm(null)
    if (activeRepo === null) {
      setStatusLoading(false)
      return undefined
    }
    refreshActiveStatus()
    // 切根/卸载：取消这个根还没回来的 status 请求
    return () => {
      statusAbortRef.current?.abort()
      statusAbortRef.current = null
    }
  }, [activeRootId, activeRepo === null, refreshActiveStatus])

  /* ---------------------------- 选中项快照 ---------------------------- */
  // 切走再切回来时要回到「上次看的那个文件」，否则每次都要重新点一遍
  useEffect(() => {
    if (changesSelection === null) return
    writeSnapshot(selectionKeyOf(changesSelection.rootPath), changesSelection)
  }, [changesSelection])

  useEffect(() => {
    if (fileSelection === null) return
    writeSnapshot(fileSelectionKeyOf(fileSelection.rootPath), fileSelection)
  }, [fileSelection])

  /**
   * 文件页签的根与草稿。
   *
   * 草稿按「浏览根 + 相对路径」存进模块级缓存：切右侧栏页签会卸载组件，
   * 只放在组件 state 里的话，一次 unmount 就把没保存的改动丢光。
   */
  useEffect(() => {
    const browsePath = browseRoot === null ? null : browseRoot.path
    draftsRootRef.current = browsePath
    setDrafts(browsePath === null ? new Map() : readDrafts(browsePath))
    setFileData(null)
    setFileError(null)
    setSaveState({ busy: false, savedAt: 0, error: null, conflict: null })
    if (browsePath !== null) setFileSelection(readSnapshot(fileSelectionKeyOf(browsePath)) ?? null)
  }, [browseRoot === null ? null : browseRoot.path])

  /* ---------------------------- 自适应 refresh ---------------------------- */
  useEffect(() => {
    // 切回窗口/页签时，只有快照已经凉了才真的发请求：
    // 刚挂载时的 refreshRepository 已经发过一次，这里再发就是同一份数据的第二次往返。
    const shouldRefresh = () => {
      const root = activeRootRef.current
      return root === null ? true : snapshotAge(statusKeyOf(root.path)) > 500
    }
    const onFocus = () => {
      if (shouldRefresh()) refreshRepository()
    }
    const onVisibility = () => {
      if (documentVisible() && shouldRefresh()) refreshRepository()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refreshRepository])

  useEffect(() => {
    if (autoRefresh !== true || mode !== MODE.changes) return undefined
    const timer = setInterval(() => {
      if (documentVisible() && documentFocused()) refreshRepository()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [autoRefresh, mode, refreshRepository])

  /**
   * 「储存库」行上的分支名是 project/resolve 的快照，而 status 是活动仓库的实时状态。
   * 两者不一致 = HEAD 在面板之外被切走了（PR 深度审阅会真的切、终端 / VS Code 也会切）；
   * 这时分支菜单（每次重读 branches/list）勾的是新分支、行尾还是旧值，两处对不上。
   *
   * 所以每次 status 更新后对一次：不一致就补一次 resolveProject 让快照跟上。
   * 只依赖 status（解析结果不会反过来改 status），因此不会形成解析循环；
   * 宿主真返回旧值时，最多是下一轮 status 再解析一次，不会变成请求风暴。
   */
  useEffect(() => {
    if (status === null) return
    const root = activeRootRef.current
    if (root === null || root.isGit !== true) return
    if (status.branch === root.branch) return
    resolveProject()
  }, [status, resolveProject])

  /* ============================== 取 diff ============================== */
  /**
   * 依赖是「请求的身份」而不是 selection 对象：决定 diff 的只有
   * `rootPath + path + side + 上下文设置`。轮询换掉了 selection 对象但内容没变时，
   * 这里不会重取（这是把 8 秒一次的 diff 请求彻底关掉的关键）。
   */
  const diffRootPath = changesSelection === null ? '' : changesSelection.rootPath
  const diffPath = changesSelection === null ? '' : changesSelection.path
  const diffSide = changesSelection === null ? '' : changesSelection.side
  useEffect(() => {
    if (mode !== MODE.changes) return undefined
    if (diffPath === '') {
      setDiff(null)
      setDiffLoading(false)
      setDiffError(null)
      return undefined
    }
    const controller = new AbortController()
    const token = diffSeq.begin()
    // 换文件/换侧立刻清空：否则新标题会和上一个文件的 diff 同屏一小会儿
    setDiff(null)
    setDiffLoading(true)
    setDiffError(null)
    api.readDiff({
      rootPath: diffRootPath,
      path: diffPath,
      staged: diffSide === 'staged',
      untracked: diffSide === 'untracked',
      contextLines,
      ignoreWhitespace
    }, { signal: controller.signal })
      .then((value) => {
        if (!diffSeq.isLatest(token)) return
        setDiff(value)
      })
      .catch((error) => {
        if (!diffSeq.isLatest(token) || error.code === 'aborted') return
        setDiffError(api.describeError(error, tRef.current))
      })
      .finally(() => {
        if (diffSeq.isLatest(token)) setDiffLoading(false)
      })
    return () => controller.abort()
  }, [mode, diffRootPath, diffPath, diffSide, contextLines, ignoreWhitespace, diffSeq, diffNonce])

  /* ====================== 编辑器草稿 / 保存（文件模式） ====================== */

  /** 更新一个草稿并同步写进模块级缓存（null = 丢掉这个文件的草稿）。 */
  const patchDraft = useCallback((path, draft) => {
    setDrafts((previous) => {
      const next = new Map(previous)
      if (draft === null) next.delete(path)
      else next.set(path, draft)
      return next
    })
    const root = draftsRootRef.current
    if (draft === null) dropDraft(root, path)
    else writeDraft(root, path, draft)
  }, [])

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
    const existing = draftsRef.current.get(path)
    if (value.kind !== 'text') {
      if (existing !== undefined) patchDraft(path, null)
      return
    }
    const fresh = {
      text: value.text,
      savedText: value.text,
      hash: value.hash,
      eol: value.eol,
      bom: value.bom
    }
    if (existing === undefined) {
      patchDraft(path, fresh)
      return
    }
    if (existing.hash === value.hash) return
    if (existing.text !== existing.savedText) {
      setSaveState((previous) => ({ ...previous, conflict: { path } }))
      return
    }
    patchDraft(path, fresh)
  }, [patchDraft])

  /** 编辑器输入 → 更新草稿。 */
  const changeDraft = useCallback((path, text) => {
    const draft = draftsRef.current.get(path)
    if (draft === undefined || draft.text === text) return
    patchDraft(path, { ...draft, text })
  }, [patchDraft])

  /**
   * 保存当前文件。
   * `force === true` 只由「覆盖保存」按钮传入 —— 那是用户看过冲突提示后的显式决定。
   */
  const saveDraft = useCallback(async (force) => {
    if (mode !== MODE.files || browseRoot === null || fileSelection === null) return
    const path = fileSelection.path
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
      const current = draftsRef.current.get(path)
      if (current !== undefined) patchDraft(path, { ...current, savedText: current.text, hash: result.hash })
      setSaveState({ busy: false, savedAt: Date.now(), error: null, conflict: null })
      // 保存后工作区变了：变更列表与储存库行的数字都要跟上
      refreshRepository()
    } catch (error) {
      if (!saveSeq.isLatest(token)) return
      if (error.code === 'conflict') {
        setSaveState({ busy: false, savedAt: 0, error: null, conflict: { path } })
        return
      }
      if (error.code === 'aborted') {
        setSaveState((previous) => ({ ...previous, busy: false }))
        return
      }
      setSaveState({ busy: false, savedAt: 0, error: api.describeError(error, tRef.current), conflict: null })
    }
  }, [mode, browseRoot, fileSelection, saveSeq, patchDraft, refreshRepository])

  /** 冲突条的「重新加载」：丢掉本地改动，重新从磁盘读。 */
  const reloadDraft = useCallback(() => {
    if (fileSelection === null) return
    patchDraft(fileSelection.path, null)
    setSaveState({ busy: false, savedAt: 0, error: null, conflict: null })
    setFileNonce((count) => count + 1)
  }, [fileSelection, patchDraft])

  /* -------------------------- 检测更新 / 打开仓库 -------------------------- */

  /** 检查插件是否最新（当前安装版本 vs GitHub 最新 release）。 */
  const checkUpdates = useCallback(async () => {
    const token = checkSeq.begin()
    setPluginState((previous) => ({ ...previous, busy: true, error: null }))
    try {
      const value = await api.pluginUpdate()
      if (!checkSeq.isLatest(token)) return
      setPluginState({
        version: value.currentVersion,
        busy: false,
        latestVersion: value.latestVersion,
        url: value.url,
        publishedAt: value.publishedAt,
        newer: value.newer,
        checkedAt: Date.now(),
        error: null
      })
      setToolbarNote(value.newer
        ? {
          tone: 'warn',
          text: tRef.current('update.pluginNewer', { version: value.latestVersion, current: value.currentVersion }),
          url: value.url
        }
        : { tone: 'info', text: tRef.current('update.pluginUpToDate', { version: value.currentVersion }) })
    } catch (error) {
      if (!checkSeq.isLatest(token)) return
      setPluginState((previous) => ({ ...previous, busy: false, error: api.describeError(error, tRef.current) }))
      setToolbarNote({
        tone: 'error',
        text: tRef.current('update.failed', { message: api.describeError(error, tRef.current) })
      })
    }
  }, [checkSeq])

  /** 读一次插件版本（本地 package.json，不联网），让按钮一进来就显示真实版本。 */
  useEffect(() => {
    let alive = true
    api.pluginInfo().then((value) => {
      if (!alive) return
      setPluginState((previous) => ({ ...previous, version: value.version }))
    }, (error) => {
      if (!alive) return
      setPluginState((previous) => ({ ...previous, error: api.describeError(error, tRef.current) }))
    })
    return () => {
      alive = false
    }
  }, [])

  /** 打开远端仓库网页（本地路径类远端没有网页，按钮此时是禁用的）。 */
  const openRemote = useCallback(() => {
    const result = openExternalUrl(remoteWebUrl)
    if (result.opened !== true) {
      setToolbarNote({ tone: 'error', text: tRef.current('error.openFailed', { url: remoteWebUrl }) })
    }
  }, [remoteWebUrl, setToolbarNote])

  /** 有未保存改动的文件（给文件树画脏点）。 */
  const dirtyPaths = useMemo(() => {
    const set = new Set()
    for (const [path, draft] of drafts) if (draft.text !== draft.savedText) set.add(path)
    return set
  }, [drafts])

  /* ============================ 取文件内容 ============================ */
  const filePath = fileSelection === null ? null : fileSelection.path
  useEffect(() => {
    if (mode !== MODE.files) return undefined
    if (filePath === null) {
      setFileData(null)
      setFileLoading(false)
      setFileError(null)
      return undefined
    }
    const controller = new AbortController()
    const token = fileSeq.begin()
    setFileLoading(true)
    setFileError(null)
    api.readFile({ rootPath: browseRoot.path, path: filePath }, { signal: controller.signal })
      .then((value) => {
        if (!fileSeq.isLatest(token)) return
        setFileData(value)
        adoptRead(filePath, value)
      })
      .catch((error) => {
        if (!fileSeq.isLatest(token) || error.code === 'aborted') return
        setFileError(api.describeError(error, tRef.current))
      })
      .finally(() => {
        if (fileSeq.isLatest(token)) setFileLoading(false)
      })
    return () => controller.abort()
  }, [mode, filePath, browseRoot === null ? null : browseRoot.path, fileSeq, fileNonce])

  /* ============================== 交互 ============================== */
  const selectEntry = useCallback((entry, groupKey) => {
    const side = groupKey === 'untracked'
      ? 'untracked'
      : (groupKey === 'staged' && entry.staged === true ? 'staged' : 'unstaged')
    setChangesSelection({ rootPath: activeRootRef.current.path, path: entry.path, entry, side })
  }, [])

  const selectFile = useCallback((relPath) => {
    setFileSelection({ rootPath: browseRootRef.current.path, path: relPath })
  }, [])

  const switchSide = useCallback((side) => {
    setChangesSelection((previous) => (previous === null ? null : { ...previous, side }))
  }, [])

  /**
   * 行尾 + / −：未暂存与未跟踪暂存（git add），已暂存取消暂存（git restore --staged）。
   * 操作只作用于那一个文件；完成后重读 status，分组归属由新状态决定，
   * 所以文件会从下面的未暂存移到上面的已暂存（或反过来）。
   */
  const stageEntry = useCallback(async (relPath, action) => {
    if (activeRepo === null) return
    if (stagePendingRef.current !== null) return
    stagePendingRef.current = relPath
    setStagePending(relPath)
    setStatusError(null)
    try {
      await api.stageFile({ rootPath: activeRepo.path, path: relPath, action })
      await refreshRepository()
      setDiffNonce((previous) => previous + 1)
    } catch (error) {
      if (error.code !== 'aborted') {
        setStatusError(api.describeError(error, tRef.current))
      }
    } finally {
      stagePendingRef.current = null
      setStagePending(null)
    }
  }, [activeRepo, refreshRepository])

  /** 分组头的批量按钮：一次暂存或取消暂存整组。 */
  const stageGroup = useCallback(async (scope) => {
    if (activeRepo === null) return
    if (stagePendingRef.current !== null) return
    stagePendingRef.current = scope
    setStagePending(scope)
    setStatusError(null)
    try {
      await api.stageGroup({ rootPath: activeRepo.path, scope })
      await refreshRepository()
      setDiffNonce((previous) => previous + 1)
    } catch (error) {
      if (error.code !== 'aborted') {
        setStatusError(api.describeError(error, tRef.current))
      }
    } finally {
      stagePendingRef.current = null
      setStagePending(null)
    }
  }, [activeRepo, refreshRepository])

  /**
   * 行尾 ↶：退回这个文件的改动（未跟踪文件由宿主删除）。
   *
   * 与「暂存」共用同一份忙碌标记：这两个动作都改索引/工作区，同一时刻只能有一个在跑，
   * 否则第二次操作会基于上一次之前的索引状态执行。是否删除未跟踪文件由宿主按索引状态判定，
   * 客户端只传路径（见 host/git.js 的 discardFile）—— 行是快照，不能拿它当事实。
   */
  const discardEntry = useCallback(async (relPath) => {
    if (activeRepo === null) return
    if (stagePendingRef.current !== null) return
    stagePendingRef.current = relPath
    setStagePending(relPath)
    setStatusError(null)
    try {
      await api.discardFile({ rootPath: activeRepo.path, path: relPath })
      await refreshRepository()
      setDiffNonce((previous) => previous + 1)
    } catch (error) {
      if (error.code !== 'aborted') {
        setStatusError(api.describeError(error, tRef.current))
      }
    } finally {
      stagePendingRef.current = null
      setStagePending(null)
    }
  }, [activeRepo, refreshRepository])

  /**
   * 推送当前分支（`branch/push`）。成功就刷新仓库状态 —— 提示条由 `status.sync` 驱动，
   * 刷新后自己消失/换成别的状态；失败把原因留在提示条里，不弹窗。
   * 正在执行时用 ref 挡住重复点击（state 要等下一遍渲染才生效）。
   */
  const pushBranchNow = useCallback(async () => {
    const root = activeRootRef.current
    if (root === null || root.isGit !== true || remoteActionRef.current.busy === true) return null
    setRemoteAction({ busy: true, error: null })
    try {
      const value = await api.pushBranch({ rootPath: root.path })
      setRemoteAction({ busy: false, error: null })
      setToolbarNote({ tone: 'info', text: tRef.current('sync.pushed', { branch: value.branch }) })
      await refreshRepository()
      return value
    } catch (error) {
      setRemoteAction({ busy: false, error: api.describeError(error, tRef.current) })
      return null
    }
  }, [refreshRepository])

  /**
   * 收尾「远端分支已被删除」的本地分支（`branch/cleanup`）：宿主一次做完
   * 取远程更新 → 切回默认分支 → 快进 → 删本地分支。
   * 成功会切换分支，所以要重新解析根（行尾分支名）并重读 status。
   */
  const cleanupBranchNow = useCallback(async () => {
    const root = activeRootRef.current
    if (root === null || root.isGit !== true || remoteActionRef.current.busy === true) return null
    setRemoteAction({ busy: true, error: null })
    try {
      const value = await api.cleanupBranch({ rootPath: root.path })
      setRemoteAction({ busy: false, error: null })
      setToolbarNote({
        tone: 'info',
        text: tRef.current('sync.cleaned', { branch: value.branch, base: value.base })
      })
      await resolveProject()
      await refreshRepository()
      return value
    } catch (error) {
      setRemoteAction({ busy: false, error: api.describeError(error, tRef.current) })
      return null
    }
  }, [resolveProject, refreshRepository])

  const commitStaged = useCallback(async () => {
    if (activeRepo === null) return
    const message = commitMessage.trim()
    if (message === '' || commitBusy) return
    setCommitBusy(true)
    setCommitNote(null)
    try {
      const result = await api.commitChanges({ rootPath: activeRepo.path, message })
      setCommitMessage('')
      const subject = result.subject.trim()
      setCommitNote({
        tone: 'info',
        text: subject === ''
          ? tRef.current('commit.done', { head: result.head })
          : tRef.current('commit.doneSubject', { head: result.head, subject })
      })
      setDiffNonce((previous) => previous + 1)
      // 提交成功后按偏好自动推送；推送成功时它自己会刷新 status（提示条随之消失/换状态）。
      // 没推或推失败时补一次刷新，让提示条按新的 ahead 状态出现（失败原因会显示在里面）。
      const pushedAfterCommit = postCommitPush === true ? await pushBranchNow() : null
      if (pushedAfterCommit === null) await refreshRepository()
    } catch (error) {
      setCommitNote({ tone: 'error', text: api.describeError(error, tRef.current) })
    } finally {
      setCommitBusy(false)
    }
  }, [activeRepo, commitMessage, commitBusy, refreshRepository, postCommitPush, pushBranchNow])

  /** 改输入就清掉上一次的结果提示：用户已经在写新的说明了。 */
  const changeCommitMessage = useCallback((text) => {
    setCommitMessage(text)
    setCommitNote(null)
  }, [])

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
    if (activeRepo === null || commitGenerating) return
    setCommitGenerating(true)
    setCommitNote(null)
    try {
      const result = await api.commitMessage({ rootPath: activeRepo.path })
      setCommitMessage(result.message)
    } catch (error) {
      setCommitNote({ tone: 'error', text: api.describeError(error, tRef.current), code: error?.code ?? null })
    } finally {
      setCommitGenerating(false)
    }
  }, [activeRepo, commitGenerating])

  /** 设置里存的是 {provider, model}，下拉框用的是扁平 ref。 */
  const refOfPair = (pair) => (pair === null || pair === undefined ? null : pair.provider + '/' + pair.model)

  /** 打开设置页：同时拉模型目录和当前设置。 */
  /** 目标分支记忆键：按 provider + 仓库全名区分。 */
  const pullTargetKey = (repo) => repo.provider + ':' + repo.fullName

  /** 打开创建 PR 表单：先向宿主要仓库/账号/分支信息。 */
  const openCreatePull = useCallback(async () => {
    if (activeRepo === null) return
    setPullForm({ loading: true, error: null, repo: null, head: '', bases: [], accounts: [], accountId: '', base: '', title: '', body: '', generating: false, creating: false, created: null, notice: null })
    try {
      const prepared = await api.prPrepare({ rootPath: activeRepo.path })
      const remembered = readPrefs().pullTargets?.[pullTargetKey(prepared.repo)] ?? ''
      const base = prepared.bases.includes(remembered) ? remembered : (prepared.bases[0] ?? '')
      setPullForm({
        loading: false,
        error: null,
        repo: prepared.repo,
        head: prepared.head,
        bases: prepared.bases,
        accounts: prepared.accounts,
        accountId: prepared.accounts[0]?.id ?? '',
        base,
        title: '',
        body: '',
        generating: false,
        creating: false,
        created: null,
        notice: null
      })
    } catch (error) {
      setPullForm({ loading: false, error: api.describeError(error, tRef.current), repo: null, head: '', bases: [], accounts: [], accountId: '', base: '', title: '', body: '', generating: false, creating: false, created: null, notice: null })
    }
  }, [activeRepo])

  const closeCreatePull = useCallback(() => setPullForm(null), [])

  const changePullField = useCallback((field, value) => {
    setPullForm((previous) => {
      if (previous === null || previous.created !== null) return previous
      return { ...previous, [field]: value, notice: null }
    })
  }, [])

  /** 用模型生成标题与描述（失败就地显示原因）。 */
  const generatePullText = useCallback(async () => {
    if (pullForm === null || activeRepo === null) return
    // 没有目标分支就不发请求：`{ base: undefined }` 序列化后字段会整个消失，
    // 宿主只会回一句「缺少参数 base」，看起来像生成功能坏了，其实模型根本没被调用。
    if (pullForm.base === '') return
    setPullForm({ ...pullForm, generating: true, error: null, notice: null })
    try {
      const generated = await api.prGenerate({ rootPath: activeRepo.path, base: pullForm.base })
      setPullForm((previous) => (previous === null ? previous : {
        ...previous,
        generating: false,
        title: generated.title,
        body: generated.body,
        notice: tRef.current('pr.generated', { count: generated.commits })
      }))
    } catch (error) {
      setPullForm((previous) => (previous === null ? previous : {
        ...previous, generating: false, error: api.describeError(error, tRef.current)
      }))
    }
  }, [pullForm, activeRepo])

  /** 创建 PR：成功后记住目标分支，供下次默认。 */
  const createPull = useCallback(async () => {
    if (pullForm === null || activeRepo === null) return
    // 同 generatePullText：没有目标分支（或还没准备出 repo）时不发这个注定被拒的请求
    if (pullForm.base === '') return
    if (pullForm.repo === null) return
    setPullForm({ ...pullForm, creating: true, error: null, notice: null })
    try {
      const created = await api.prCreate({
        rootPath: activeRepo.path,
        accountId: pullForm.accountId,
        fullName: pullForm.repo.fullName,
        base: pullForm.base,
        title: pullForm.title,
        body: pullForm.body
      })
      writePref('pullTargets', { ...(readPrefs().pullTargets ?? {}), [pullTargetKey(pullForm.repo)]: pullForm.base })
      await loadLinkedPull(activeRepo)
      await refreshRepository()
      setPullForm((previous) => (previous === null ? previous : { ...previous, creating: false, created }))
    } catch (error) {
      setPullForm((previous) => (previous === null ? previous : {
        ...previous, creating: false, error: api.describeError(error, tRef.current)
      }))
    }
  }, [pullForm, activeRepo, refreshRepository, loadLinkedPull])

  /** 读账号列表（token 不会下发到客户端，只有 id/login/label）。 */
  const loadAccounts = useCallback(async () => {
    const token = accountsGuard.begin()
    try {
      const value = await api.listAccounts({})
      if (!accountsGuard.isLatest(token)) return
      setAccounts(value.accounts)
      setProviders(value.providers)
      setAccountsLoaded(true)
    } catch (error) {
      if (!accountsGuard.isLatest(token)) return
      setAccountsLoaded(true)
      setRemoteError(api.describeError(error, tRef.current))
    }
  }, [accountsGuard])

  const openSettings = useCallback(async () => {
    setShowSettings(true)
    setSettingsState({ loading: true, models: [], commitModel: null, reviewModel: null, commitThinking: false, commitReasoningEffort: null, error: null, saved: false })
    // 设置页也管理账号：进来就确保账号列表是最新的（只读列表接口，很便宜）
    loadAccounts()
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
        commitThinking: settings.commitThinking === true,
        commitReasoningEffort: settings.commitReasoningEffort ?? null,
        error: modelError,
        saved: false
      })
    } catch (error) {
      setSettingsState({ loading: false, models: [], commitModel: null, reviewModel: null, commitThinking: false, commitReasoningEffort: null, error: api.describeError(error, tRef.current), saved: false })
    }
  }, [])

  /** 选择模型即保存。空值表示清除。 */
  const changeCommitModel = useCallback(async (ref) => {
    const commitModel = ref === '' ? null : ref
    setSettingsState((previous) => ({ ...previous, commitModel, commitThinking: false, commitReasoningEffort: null, saved: false, error: null }))
    try {
      const saved = await api.writeSettings({ commitModel, commitThinking: false, commitReasoningEffort: null })
      setSettingsState((previous) => ({ ...previous, commitModel: refOfPair(saved.commitModel), commitThinking: saved.commitThinking === true, commitReasoningEffort: saved.commitReasoningEffort ?? null, saved: true }))
    } catch (error) {
      setSettingsState((previous) => ({ ...previous, error: api.describeError(error, tRef.current), saved: false }))
    }
  }, [])

  /** 思考模式与档位单独保存；失败时恢复服务器上的值。 */
  const changeCommitThinking = useCallback(async (patch) => {
    setSettingsState((previous) => ({ ...previous, ...patch, saved: false, error: null }))
    try {
      const saved = await api.writeSettings(patch)
      setSettingsState((previous) => ({ ...previous, commitThinking: saved.commitThinking === true, commitReasoningEffort: saved.commitReasoningEffort ?? null, saved: true }))
    } catch (error) {
      try {
        const settings = await api.readSettings({})
        setSettingsState((previous) => ({ ...previous, commitThinking: settings.commitThinking === true, commitReasoningEffort: settings.commitReasoningEffort ?? null }))
      } catch { /* 保留原始保存错误 */ }
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
    if (activeRepo !== null) return
    const firstRepo = gitRoots[0]
    if (firstRepo !== undefined) setActiveRootId(firstRepo.id)
  }, [mode, activeRepo, gitRoots])

  const toggleGroup = useCallback((groupKey) => {
    setCollapsedGroups((previous) => {
      const next = { ...previous }
      if (next[groupKey] === true) delete next[groupKey]
      else next[groupKey] = true
      return next
    })
  }, [setCollapsedGroups])

  const selectRoot = useCallback((root) => {
    if (root === null) return
    setActiveRootId(root.id)
  }, [])

  const addExternalRoot = useCallback(async (dir) => {
    const projectRoot = projectRef.current.projectRoot
    if (projectRoot === null || projectRoot === '') {
      throw new Error(tRef.current('status.noCwd'))
    }
    try {
      const value = await api.addRoot({ projectRoot, path: dir })
      const nextRoots = value.roots
      setProject({ projectRoot: value.projectRoot, roots: nextRoots, warnings: value.warnings })
      const added = nextRoots.find((root) => root.path.toLowerCase() === dir.replace(/\\/g, '/').toLowerCase())
      if (added !== undefined) setActiveRootId(added.id)
      else if (nextRoots.length > 0) setActiveRootId(nextRoots[nextRoots.length - 1].id)
      return value
    } catch (error) {
      throw new Error(api.describeError(error, tRef.current))
    }
  }, [])

  const removeExternalRoot = useCallback(async (root) => {
    const projectRoot = projectRef.current.projectRoot
    if (root === null || projectRoot === null) return
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
    if (root === null || projectRoot === null) return
    try {
      applyRootsChange(await api.hideRoot({ projectRoot, path: root.path }), root)
    } catch (error) {
      setRootsError(api.describeError(error, tRef.current))
    }
  }, [applyRootsChange])

  const unhideRoot = useCallback(async (root) => {
    const projectRoot = projectRef.current.projectRoot
    if (root === null || projectRoot === null) return
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
    await refreshRepository()
  }, [resolveProject, refreshRepository])

  /** 分支菜单里的「获取远程更新」：git fetch 后重读分支列表。 */
  /** 拉取该仓库当前分支的最新代码（fetch + 只允许快进，不做自动合并）。 */
  const pullBranchNow = useCallback(async (root) => {
    let value
    try {
      value = await api.pullBranch({ rootPath: root.path })
    } catch (error) {
      throw new Error(api.describeError(error, tRef.current))
    }
    setToolbarNote({
      tone: 'info',
      text: tRef.current('branch.pulled', { head: String(value.head).slice(0, 7) })
    })
    await resolveProject()
    await refreshAll()
    return value
  }, [resolveProject, refreshAll])

  const fetchBranches = useCallback(async (root) => {
    let fetched
    try {
      fetched = await api.fetchRemote({ rootPath: root.path })
    } catch (error) {
      throw new Error(api.describeError(error, tRef.current))
    }
    // fetch 只更新远端跟踪引用：把 ahead/behind 报出来，用户才知道要不要真的拉取
    setToolbarNote(buildUpstreamNote(fetched, tRef.current))
    if (activeRoot !== null && activeRoot.id === root.id) refreshRepository()
    return api.listBranches({ rootPath: root.path })
  }, [activeRoot, refreshRepository])

  const switchBranch = useCallback(async (root, name) => {
    try {
      await api.switchBranch({ rootPath: root.path, name })
    } catch (error) {
      throw new Error(api.describeError(error, tRef.current))
    }
    // 切分支会改 HEAD 与工作区：重新解析根（分支名要更新）并重读状态
    await resolveProject()
    await refreshRepository()
  }, [resolveProject, refreshRepository])

  /**
   * 创建分支（可携带未提交改动）。
   *
   * 宿主在动手前会把「能不能建」全部判定完，所以失败时仓库一定没被改过 ——
   * 界面可以放心地把 `would-overwrite` 当成「换个选择再试一次」，而不是「出事了」。
   * 这里把错误码与 details 透传出去（`api.describeError` 只保留一句话，撞车文件清单会丢），
   * RepoList 才能据此摆出两个零风险出口。
   */
  const createBranch = useCallback(async (root, request) => {
    let value
    try {
      value = await api.createBranch({ rootPath: root.path, ...request })
    } catch (error) {
      const wrapped = new Error(api.describeError(error, tRef.current))
      wrapped.code = error.code
      wrapped.details = error.details
      throw wrapped
    }
    setToolbarNote(buildBranchCreatedNote(value, tRef.current))
    // 建/切分支会改 HEAD（可能还改了工作区）：行尾分支名与 status 都要重读
    await resolveProject()
    await refreshRepository()
    return value
  }, [resolveProject, refreshRepository])

  const loadDir = useCallback(async (relPath, signal) => (
    api.listDirectory({ rootPath: browseRootRef.current.path, path: relPath }, { signal })
  ), [])

  /* ------------------------------ 远端账号 ------------------------------ */


  /** 读某个账号的仓库；append 用于「加载更多」。 */
  const loadRepos = useCallback(async (accountId, page, append) => {
    if (accountId === null) return
    const token = remoteReposGuard.begin()
    setRemoteLoading(true)
    if (append !== true) setRemoteError(null)
    try {
      const value = await api.listRemoteRepos({ accountId, page })
      if (!remoteReposGuard.isLatest(token)) return
      setRemoteRepos((previous) => (append === true ? [...previous, ...value.repos] : value.repos))
      setRemoteHasMore(value.hasMore === true)
    } catch (error) {
      if (!remoteReposGuard.isLatest(token)) return
      setRemoteError(api.describeError(error, tRef.current))
      if (append !== true) setRemoteRepos([])
    } finally {
      if (remoteReposGuard.isLatest(token)) setRemoteLoading(false)
    }
  }, [remoteReposGuard])

  /** 批量取当前列表的未合并 PR 数（宿主限制 50 个/次）。 */
  const loadPullCounts = useCallback(async (accountId, repos) => {
    if (accountId === null || repos.length === 0) {
      setPrCounts({})
      return
    }
    const token = pullCountsGuard.begin()
    try {
      const value = await api.remotePullCounts({
        accountId,
        fullNames: repos.map((repo) => repo.fullName)
      })
      if (!pullCountsGuard.isLatest(token)) return
      setPrCounts(value.counts)
    } catch {
      // 计数只是角标：失败就不显示，不打断列表（详情接口会暴露真实错误）
      if (pullCountsGuard.isLatest(token)) setPrCounts({})
    }
  }, [pullCountsGuard])

  /** 从仓库详情点开某个 PR。 */
  const openPullNumber = useCallback((number) => {
    if (remoteSelection === null) return
    const selection = {
      accountId: remoteSelection.accountId,
      fullName: remoteSelection.fullName,
      number
    }
    openPullWith(selection)
    loadPullDetail(selection)
  }, [remoteSelection, loadPullDetail, openPullWith])

  const closePull = useCallback(() => {
    setOpenPull(null)
    clearPullDetail()
  }, [clearPullDetail])

  // 切到变更页签或分支变化时刷新；不轮询（面板没有后台任务）
  useEffect(() => {
    if (mode !== MODE.changes || activeRepo === null) return
    loadLinkedPull(activeRepo)
  }, [mode, status === null ? '' : status.branch, loadLinkedPull, activeRepo])

  /** 从卡片打开 PR：切到远端页签并载入详情，同时记已读。 */
  const openLinkedPull = useCallback(async () => {
    if (linkedPull === null || linkedPull.data === null || linkedPull.data.linked !== true) return
    const data = linkedPull.data
    const selection = { accountId: data.accountId, fullName: data.fullName, number: data.number }
    setMode(MODE.remote)
    setRemoteSelection(selection)
    openPullWith(selection)
    await loadPullDetail(selection)
  }, [linkedPull, setMode, loadPullDetail, openPullWith])

  /**
   * 从 PR 卡片跳进远端页签 / 关掉 PR 回到仓库详情时，补一次仓库详情请求。
   * 只按「账号+仓库」比较，避免同一个仓库名在两个账号下共用一份详情。
   */
  useEffect(() => {
    if (mode !== MODE.remote || openPull !== null || remoteSelection === null) return
    const data = remoteDetail === null ? null : remoteDetail.data
    if (data !== null && data.accountId === remoteSelection.accountId && data.repo.fullName === remoteSelection.fullName) return
    loadRemoteDetail(remoteSelection)
    // 故意不依赖 remoteDetail：失败后等用户点重试，不自动循环请求
    // eslint-disable-next-line -- 只跟随选中项
  }, [mode, openPull, remoteSelection, loadRemoteDetail])

  /* --------------------------- 远端仓库详情 · 分支 --------------------------- */

  /**
   * 选中仓库变了才重拉分支：
   *  - 从 PR 详情关回仓库详情时，选中没变，不重复请求；
   *  - 切到别的仓库（或从 PR 卡片跳进来）时，按 fullName 重新拉一次；
   *  - 切回远端页签不自动刷新（分支有「刷新 / 获取远程更新」按钮，拉网络不该偷偷发生）。
   */
  useEffect(() => {
    if (mode !== MODE.remote) return
    if (remoteSelection === null) {
      branchSelectionRef.current = null
      clearRemoteBranches()
      return
    }
    if (openPull !== null) return
    const key = branchKeyOf(remoteSelection)
    if (branchSelectionRef.current === key) return
    branchSelectionRef.current = key
    // 换了仓库：先把上一个仓库的分支清掉，避免新数据回来前右侧挂着别人的分支
    clearRemoteBranches()
    loadRemoteBranches(remoteSelection)
  }, [mode, openPull, remoteSelection, loadRemoteBranches, clearRemoteBranches])

  /** 分支操作统一返回 { ok, error, code }：组件据 code 判断要不要露出「强制删除」。 */
  const branchFailure = useCallback((error) => ({
    ok: false,
    error: api.describeError(error, tRef.current),
    code: error.code ?? null
  }), [])

  /** 本地没有克隆时，本地分支操作明确报出来，不做无声失败。 */
  const noLocalRepoFailure = useCallback(() => ({
    ok: false,
    error: tRef.current('branch.noLocalOps'),
    code: 'no-local-repo'
  }), [])

  /** 切换分支：本地已有该分支才能切；成功后重新解析根并刷新 status（储存库行的分支名要跟着变）。 */
  const switchRemoteBranch = useCallback(async (branch) => {
    const rootPath = localRootPathOfBranches(remoteBranchesRef.current)
    if (rootPath === null) return noLocalRepoFailure()
    try {
      await api.switchBranch({ rootPath, name: branch.name })
    } catch (error) {
      return branchFailure(error)
    }
    await resolveProject()
    await refreshRepository()
    if (remoteSelection !== null) await loadRemoteBranches(remoteSelection)
    return { ok: true }
  }, [resolveProject, refreshRepository, loadRemoteBranches, remoteSelection, branchFailure, noLocalRepoFailure])

  /** 远端独有的分支：在本地建跟踪分支并切过去（与储存库分支菜单里的行为一致）。 */
  const trackRemoteBranch = useCallback(async (branch) => {
    const rootPath = localRootPathOfBranches(remoteBranchesRef.current)
    if (rootPath === null) return noLocalRepoFailure()
    try {
      await api.trackBranch({ rootPath, remote: 'origin', name: branch.name })
    } catch (error) {
      return branchFailure(error)
    }
    await resolveProject()
    await refreshRepository()
    if (remoteSelection !== null) await loadRemoteBranches(remoteSelection)
    return { ok: true }
  }, [resolveProject, refreshRepository, loadRemoteBranches, remoteSelection, branchFailure, noLocalRepoFailure])

  /** 删除本地分支（force 只会在用户点「强制删除」时传 true）。 */
  const deleteLocalBranchAt = useCallback(async (branch, force) => {
    const rootPath = localRootPathOfBranches(remoteBranchesRef.current)
    if (rootPath === null) return noLocalRepoFailure()
    try {
      await api.deleteLocalBranch({ rootPath, name: branch.name, force: force === true })
    } catch (error) {
      return branchFailure(error)
    }
    await resolveProject()
    await refreshRepository()
    if (remoteSelection !== null) await loadRemoteBranches(remoteSelection)
    return { ok: true }
  }, [resolveProject, refreshRepository, loadRemoteBranches, remoteSelection, branchFailure, noLocalRepoFailure])

  /** 删除远端分支：它是破坏性操作，界面已二次确认过；成功后只重读分支列表。 */
  const deleteRemoteBranchAt = useCallback(async (branch) => {
    if (remoteSelection === null) return { ok: false, error: tRef.current('branch.noLocalOps'), code: null }
    try {
      await api.deleteRemoteBranch({
        accountId: remoteSelection.accountId,
        fullName: remoteSelection.fullName,
        name: branch.name
      })
    } catch (error) {
      return branchFailure(error)
    }
    await loadRemoteBranches(remoteSelection)
    return { ok: true }
  }, [remoteSelection, loadRemoteBranches, branchFailure])

  /** 「获取远程更新」：git fetch --prune（只更新远端跟踪引用，不动工作区/本地分支），然后重读列表。 */
  const fetchRepoBranches = useCallback(async () => {
    const rootPath = localRootPathOfBranches(remoteBranchesRef.current)
    if (rootPath === null) return noLocalRepoFailure()
    try {
      await api.fetchRemote({ rootPath })
    } catch (error) {
      return branchFailure(error)
    }
    await refreshRepository()
    if (remoteSelection !== null) await loadRemoteBranches(remoteSelection)
    return { ok: true }
  }, [refreshRepository, loadRemoteBranches, remoteSelection, branchFailure, noLocalRepoFailure])


  /** PR 里单个文件的 diff：点开文件行时才读，失败就地给 PullDetail 显示。 */
  const pullFile = useCallback(async (input) => {
    try {
      const result = await api.remotePullFile(input)
      return { ok: true, ...result }
    } catch (error) {
      return { ok: false, error: api.describeError(error, tRef.current) }
    }
  }, [])

  /** 审查：统一把失败包成 { ok:false, error, code }，界面就地显示。 */
  const reviewPull = useCallback(async (input) => {
    try {
      const result = await api.remotePullReview(input)
      await loadPullDetail({ accountId: input.accountId, fullName: input.fullName, number: input.number })
      return { ok: true, message: tRef.current('pull.reviewDone', { verdict: input.verdict }) }
    } catch (error) {
      return { ok: false, error: api.describeError(error, tRef.current), code: error?.code ?? null }
    }
  }, [loadPullDetail])

  /** AI 审阅 PR：宿主取 diff、调审阅模型，返回结构化结论与评论草稿。 */
  const aiReviewPull = useCallback(async (input) => {
    try {
      const review = await api.remotePullAiReview(input)
      return { ok: true, ...review }
    } catch (error) {
      return {
        ok: false,
        error: api.describeError(error, tRef.current),
        code: error?.code ?? null,
        details: error?.details ?? null
      }
    }
  }, [])

  /**
   * 深度审阅：宿主会把本地仓库切到 PR 的分支（prepareReviewBranch：fetch + switch），
   * 读完整文件后再判。
   *
   * 切分支发生在面板之外，所以成功后要重新解析根 + 重读 status：
   * 否则「储存库」行上的分支名还是旧的，而分支菜单里新分支已经打了勾 —— 两处对不上。
   */
  /** 深度审阅阶段一：准备本地目录（查找仓库 / 判断是否已在 PR 提交 / 切分支）。 */
  const prepareReviewPull = useCallback(async (input) => {
    try {
      const prepared = await api.remotePullPrepareReview(input)
      if (prepared.mode === 'local') {
        // 切了分支：储存库行的分支名与 status 都要跟着刷新
        await resolveProject()
        await refreshRepository()
      }
      return { ok: true, ...prepared }
    } catch (error) {
      return {
        ok: false,
        error: api.describeError(error, tRef.current),
        code: error?.code ?? null,
        details: error?.details ?? null
      }
    }
  }, [resolveProject, refreshRepository])

  /** 会话级深度审阅：主工作区切分支后新建会话，把审阅指令发过去并自动打开。 */
  const sessionReviewPull = useCallback(async (input) => {
    try {
      // 带上当前 DSH 会话 id：宿主据此找到它所属的工作区，把审阅会话建进去
      const started = await api.remotePullSessionReview({ ...input, sessionId })
      if (started?.sessionId) {
        await resolveProject()
        await refreshRepository()
        getPluginContext()?.uiWorkspace?.openSession?.(started.sessionId)
      }
      return { ok: true, ...started }
    } catch (error) {
      return {
        ok: false,
        error: api.describeError(error, tRef.current),
        code: error?.code ?? null,
        details: error?.details ?? null
      }
    }
  }, [resolveProject, refreshRepository])

  /** 把 PR 克隆到用户选的目录（深度审阅前的准备步骤）。 */
  const cloneForReviewPull = useCallback(async (input) => {
    try {
      const result = await api.remotePullCloneForReview(input)
      // 克隆完成后重新解析项目：如果落在项目里，「变更」会立刻多出这个仓库
      await resolveProject()
      return { ok: true, ...result }
    } catch (error) {
      return { ok: false, error: api.describeError(error, tRef.current) }
    }
  }, [resolveProject])

  /** 关闭 / 重新打开 PR：成功后重读详情（状态、门禁、合并区都会变）。 */
  const setPullState = useCallback(async (input) => {
    try {
      const result = await api.remotePullState(input)
      await loadPullDetail({ accountId: input.accountId, fullName: input.fullName, number: input.number })
      await loadPullCounts(input.accountId, remoteReposRef.current)
      return { ok: true, ...result }
    } catch (error) {
      return {
        ok: false,
        error: api.describeError(error, tRef.current),
        code: error?.code ?? null
      }
    }
  }, [loadPullDetail, loadPullCounts])

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
      // 部分成功也要说清哪一步没做成：只报「已通过：review」会让人以为测试也过了
      const failed = Array.isArray(result.failures) ? result.failures : []
      const message = failed.length === 0
        ? tRef.current('pull.passDone', { steps: result.completed.join(' / ') })
        : tRef.current('pull.passPartial', {
          steps: result.completed.join(' / '),
          failures: failed.map((item) => item.message).join('；')
        })
      return { ok: true, message }
    } catch (error) {
      return { ok: false, error: api.describeError(error, tRef.current), code: error?.code ?? null }
    }
  }, [loadPullDetail])

  /** 标记测试通过（Gitee 的合并门禁）：成功后重读详情，让合并按钮可用。 */
  const testPull = useCallback(async (input) => {
    try {
      await api.remotePullTest(input)
      await loadPullDetail({ accountId: input.accountId, fullName: input.fullName, number: input.number })
      return { ok: true, message: tRef.current('pull.testDone') }
    } catch (error) {
      return { ok: false, error: api.describeError(error, tRef.current), code: error?.code ?? null }
    }
  }, [loadPullDetail])

  const mergePull = useCallback(async (input) => {
    try {
      const result = await api.remotePullMerge(input)
      // PR 合并后就关闭了：直接回到仓库详情，不再停在已关闭的 PR 上
      closePull()
      setRemoteNotice(tRef.current('pull.mergedClosed', {
        number: input.number,
        branch: result.headBranch === '' ? '' : result.headBranch
      }))
      await loadRemoteDetail({ accountId: input.accountId, fullName: input.fullName })
      // 合并可以顺带删掉源分支：回到详情时分支区要重读，不能留着已删除的那一行
      branchSelectionRef.current = null
      clearRemoteBranches()
      // 合并后未合并数量会变，角标要跟着刷新
      await loadPullCounts(input.accountId, remoteReposRef.current)
      // closed:true 让 PullDetail 不要在被卸载后再写自己的提示
    return {
      ok: true,
      closed: true,
      message: result.branchDeleteError === null || result.branchDeleteError === undefined
        ? tRef.current('pull.mergedDone', { branch: result.headBranch })
        : tRef.current('pull.mergedButBranchKept', { branch: result.headBranch, message: result.branchDeleteError })
    }
    } catch (error) {
      return { ok: false, error: api.describeError(error, tRef.current), code: error?.code ?? null }
    }
  }, [loadPullDetail, loadRemoteDetail, closePull, clearRemoteBranches, loadPullCounts])

  /** 选中账号：记到当前工作区（切到别的工作区再回来仍是它）。账号 chip 只在面板内容渲染后才会出现，那时 projectRoot 一定有值。 */
  const selectRemoteAccount = useCallback((accountId) => {
    setRemoteAccountId(accountId)
    saveRemoteAccount(projectRef.current.projectRoot, accountId)
  }, [])

  /** 选中仓库：右侧立刻进入加载态再拉数据。 */
  const selectRemoteRepo = useCallback((repo) => {
    const selection = { accountId: repo.accountId, fullName: repo.fullName, name: repo.name }
    setRemoteSelection(selection)
    // 切仓库时关掉上一个仓库里打开的 PR：右栏优先渲染 openPull，
    // 不清的话会出现「左边选 B、右边显示 A 的 PR」。
    setOpenPull(null)
    clearPullDetail()
    setRemoteNotice(null)
    loadRemoteDetail(selection)
    // 点的是已经选中的仓库 = 手动刷新：分支数据按账号+仓库去重，这里显式再读一次
    if (branchSelectionRef.current === branchKeyOf(selection)) loadRemoteBranches(selection)
  }, [loadRemoteDetail, loadRemoteBranches, clearPullDetail])

  const openExternal = useCallback((url) => {
    const result = openExternalUrl(url)
    if (result.opened !== true) {
      setToolbarNote({ tone: 'error', text: tRef.current('error.openFailed', { url }) })
    }
  }, [setToolbarNote])

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
    // 正在看某个 PR 时不要因为列表刷新把左栏选中项改掉（右栏仍是那个 PR）
    if (mode !== MODE.remote || openPull !== null || remoteRepos.length === 0) return
    const exists = remoteSelection !== null && remoteRepos.some((repo) => (
      repo.accountId === remoteSelection.accountId && repo.fullName === remoteSelection.fullName
    ))
    if (exists) return
    selectRemoteRepo(remoteRepos[0])
  }, [mode, openPull, remoteRepos, remoteSelection, selectRemoteRepo])

  /** 切账号或首次进入时读第一页。 */
  useEffect(() => {
    if (mode !== MODE.remote || remoteAccountId === null) return
    loadRepos(remoteAccountId, 1, false)
  }, [mode, remoteAccountId, loadRepos])

  /**
   * 选中账号是 (工作区, 账号列表) 的派生：工作区已知、账号到手后，
   * 优先保留当前选中的（仍存在），其次用本工作区上次记下的，最后落第一个账号。
   *
   * 账号列表是全局的，但「用哪个」按工作区记（store.js 的 readRemoteAccount），
   * 所以切去别的工作区再回来、或者重新打开面板，都不会退回第一个账号。
   * 记忆只在用户点选时写（见 selectRemoteAccount），这里只读。
   */
  useEffect(() => {
    if (project.projectRoot === null || accounts.length === 0) return
    setRemoteAccountId((previous) => {
      // 账号 id 一定是非空字符串，所以这里不用先判断 previous/remembered 是不是 null
      if (accounts.some((account) => account.id === previous)) return previous
      const remembered = readRemoteAccount(project.projectRoot)
      if (accounts.some((account) => account.id === remembered)) return remembered
      return accounts[0].id
    })
  }, [project.projectRoot, accounts])

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
      // 项目里多了这个仓库：下次回到远端页签时分支区要重新判断「本地有没有克隆」
      branchSelectionRef.current = null
      clearRemoteBranches()
      await resolveProject()
      await refreshRepository()
      setMode(MODE.changes)
    } catch (error) {
      setCloneState({ fullName: repo.fullName, startedAt: 0, error: api.describeError(error, tRef.current) })
    }
  }, [resolveProject, refreshRepository, setMode, clearRemoteBranches])

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
  /**
   * 拖拽只把一个 CSS 变量写到 DOM 上，pointerup 才落一次 state（并持久化）。
   *
   * 原先每次 pointermove 都 setLeftWidth：整面板重渲染（最多 5000 行 diff）
   * 加同步写 localStorage，拖起来会抖。拖拽是视觉变换，不是应用状态。
   */
  const dragCleanupRef = useRef(null)
  const dragWidthRef = useRef(leftWidth)

  const beginDrag = useCallback((event) => {
    if (event.button !== 0) return
    event.preventDefault()
    const body = bodyRef.current
    const divider = dividerRef.current
    dragWidthRef.current = leftWidth
    divider.setAttribute('data-dragging', 'true')
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMove = (moveEvent) => {
      const rect = body.getBoundingClientRect()
      const max = Math.max(MIN_LEFT, rect.width - MIN_RIGHT)
      const raw = moveEvent.clientX - rect.left
      const next = Math.min(max, Math.max(MIN_LEFT, Math.round(raw)))
      dragWidthRef.current = next
      body.style.setProperty('--dgp-left-width', next + 'px')
    }
    const cleanup = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      divider.removeAttribute('data-dragging')
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      dragCleanupRef.current = null
    }
    const onUp = () => {
      cleanup()
      setLeftWidth(dragWidthRef.current)
    }
    dragCleanupRef.current = cleanup
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [leftWidth, setLeftWidth])

  // 卸载时把可能还挂着的拖拽监听收掉（不落 state）。
  useEffect(() => () => {
    dragCleanupRef.current?.()
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  /** 键盘调宽：同样受「右侧至少 MIN_RIGHT」约束。 */
  const resizeBy = useCallback((delta) => {
    const rect = bodyRef.current.getBoundingClientRect()
    const max = Math.max(MIN_LEFT, rect.width - MIN_RIGHT)
    setLeftWidth(Math.min(max, Math.max(MIN_LEFT, leftWidth + delta)))
  }, [leftWidth, setLeftWidth])

  /* ------------------------------ 键盘 ------------------------------ */
  const onKeyDown = useCallback((event) => {
    const target = event.target
    const inField = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable === true
    if (event.key === '/' && !inField) {
      event.preventDefault()
      filterRef.current.focus()
      return
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === 's' || event.key === 'S')) {
      // 文件页签的保存：焦点在编辑器里时由 FileEditor 处理（它能拿到光标位置），
      // 这里负责焦点在文件树 / 工具条的情况。任何模式下都不让浏览器弹「保存网页」。
      event.preventDefault()
      if (!inField && mode === MODE.files && fileSelection !== null) saveDraft(false)
      return
    }
    if (inField) return
    if ((event.key === 'r' || event.key === 'R') && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      refreshAll()
    }
  }, [refreshAll, mode, fileSelection, saveDraft])

  /* ------------------------------ 派生 ------------------------------ */
  const selectedChangePath = changesSelection === null ? null : changesSelection.path
  const selectedChangeEntry = changesSelection === null ? null : changesSelection.entry
  const entryHasBothSides = selectedChangeEntry !== null
    && selectedChangeEntry.staged === true
    && selectedChangeEntry.unstaged === true
  const counts = status === null ? null : status.counts
  const warnings = useMemo(() => {
    const list = []
    for (const warning of project.warnings) {
      if (warning !== '') list.push(warning)
    }
    if (activeRoot !== null && activeRoot.error !== null) list.push(activeRoot.error)
    return list
  }, [project.warnings, activeRoot])

  /* ------------------------------ 渲染 ------------------------------ */
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
          disabled: showSettings,
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
          disabled: showSettings,
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
          disabled: showSettings,
          onClick: () => setMode(MODE.remote)
        }, t('mode.remote'))),
      h('div', { className: 'dgp-spacer' }),
      // 检测更新的结果贴在版本号左边，不单独占一行（宽度不够时自己截断，全文在 title 里）
      updateNote === null
        ? null
        : (updateNote.url === undefined || updateNote.url === ''
          ? h('span', {
            className: 'dgp-update-note',
            'data-update-note': updateNote.tone,
            'data-tone': updateNote.tone,
            title: updateNote.text
          }, updateNote.text)
          : h('button', {
            type: 'button',
            className: 'dgp-update-note dgp-update-note-link',
            'data-dgp-version': 'note-link',
            'data-update-note': updateNote.tone,
            'data-tone': updateNote.tone,
            title: t('update.openRelease'),
            onClick: () => openExternalUrl(updateNote.url)
          }, updateNote.text, h(Icon, { name: 'external', size: 12 }))),
      h('button', {
        type: 'button',
        className: 'dgp-version',
        title: versionTitle,
        'aria-label': t('toolbar.checkUpdates'),
        'data-action': 'check-updates',
        'data-busy': pluginState.busy ? 'true' : undefined,
        'data-newer': pluginState.newer ? 'true' : undefined,
        disabled: pluginState.busy,
        onClick: checkUpdates
      }, h(Icon, { name: 'sync', size: 12 }), h('span', { className: 'dgp-version-text' }, versionText)),
      h('button', {
        type: 'button',
        className: 'dgp-iconbtn',
        title: remoteWebUrl === null ? t('update.noRemote') : t('toolbar.openRemote'),
        'aria-label': t('toolbar.openRemote'),
        'data-action': 'open-remote',
        disabled: remoteWebUrl === null,
        onClick: openRemote
      }, h(Icon, { name: 'external', size: 16 })),
      h('button', {
        type: 'button',
        className: 'dgp-iconbtn',
        title: t('settings.open'),
        'aria-label': t('settings.open'),
        'data-action': 'open-settings',
        onClick: openSettings
      }, h(Icon, { name: 'settings', size: 16 })),
      h('button', {
        type: 'button',
        className: 'dgp-iconbtn',
        title: t('toolbar.more'),
        'data-action': 'more',
        'aria-expanded': moreOpen ? 'true' : 'false',
        onClick: () => {
          const node = moreAnchorRef.current
          setMoreAnchorRect(node === null ? null : node.getBoundingClientRect())
          setMoreOpen((previous) => !previous)
        },
        ref: moreAnchorRef
      }, h(Icon, { name: 'more', size: 16 }))))

  const filterRow = showSettings || mode === MODE.remote
    ? null
    : h('div', { className: 'dgp-filter' },
    h('div', { className: 'dgp-search' },
      h(Icon, { name: 'search', size: 14 }),
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
            event.target.blur()
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
          'data-active': changesSelection.side === 'unstaged' ? 'true' : undefined,
          title: t('group.unstaged'),
          onClick: () => switchSide('unstaged')
        }, t('group.unstaged')),
        h('button', {
          type: 'button',
          className: 'dgp-seg-btn',
          'data-active': changesSelection.side === 'staged' ? 'true' : undefined,
          title: t('group.staged'),
          onClick: () => switchSide('staged')
        }, t('group.staged')))
      : null)

  const stagedCount = status === null ? 0 : status.counts.staged
  /** 只要有改动就能提交（没有暂存时提交会先把全部改动暂存）。 */
  const changeCount = status === null ? 0 : status.counts.total

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
      onSelectAccount: (account) => selectRemoteAccount(account.id),
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
        }, t('mode.files'))]
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
          onPullBranch: pullBranchNow,
          onTrackBranch: trackBranchAt,
          onCreateBranch: createBranch,
          stats: rootStats,
          t
        }),
        linkedPull !== null && (linkedPull.data === null || linkedPull.data.rootId === (activeRoot === null ? null : activeRoot.id))
          ? h(PullStatusCard, {
            card: linkedPull,
            unread: linkedPull.data !== null && linkedPull.data.linked === true
              ? Math.max(0, (Array.isArray(linkedPull.data.comments) ? linkedPull.data.comments.length : 0)
                - (readPrefs().pullSeen?.[linkedPull.data.accountId + '#' + linkedPull.data.number] ?? 0))
              : 0,
            onOpen: openLinkedPull,
            // 卡片只在「发起请求的那个仓库就是当前仓库」时渲染，所以这里一定有可操作的仓库
            onRefresh: () => loadLinkedPull(activeRepo),
            t
          })
          : null,
        /**
         * 本地分支与远端不同步时的常驻提示。三种状态各自下一步不同：
         *   never-pushed / ahead → 推送（带按钮）
         *   remote-deleted       → 收尾（切回默认分支并删除本地分支，绝不普通推送重建已合并分支）
         *   behind / diverged    → 不提示推送（那是该拉取/处理分叉），交给分支菜单的「拉取」。
         * synced / unknown 什么都不显示。
         */
        status !== null && SYNC_HINT_STATES.includes(status.sync.state)
          ? h(PushHint, {
            branch: status.branch,
            sync: status.sync,
            t,
            onPush: pushBranchNow,
            onCleanup: cleanupBranchNow,
            busy: remoteAction.busy,
            error: remoteAction.error
          })
          : null,
        // 提交框只在「有可操作的仓库」时存在：没有仓库时它既没有提交对象，
        // 也没有「创建 PR」可言 —— 那不是禁用状态，是这个控件本来就不该出现。
        activeRepo === null
          ? null
          : h(CommitBox, {
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
            onOpenSettings: openSettings,
            onCreatePull: openCreatePull,
            t
          }),
        h(ChangesList, {
          status,
          loading: statusLoading && status === null,
          view: changesView,
          untrackedMode,
          selectedPath: selectedChangePath,
          onSelect: selectEntry,
          filter,
          collapsedGroups,
          onToggleGroup: toggleGroup,
          onStage: stageEntry,
          onDiscard: discardEntry,
          pendingPath: stagePending,
          onStageGroup: stageGroup,
          pendingGroup: stagePending,
          t
        }))
    }
  } else {
    leftPane = h(FileTree, {
      rootPath: browseRoot === null ? null : browseRoot.path,
      selectedPath: fileSelection === null ? null : fileSelection.path,
      onSelectFile: selectFile,
      filter,
      loadDir,
      dirtyPaths,
      reloadNonce: treeNonce,
      t
    })
  }

  let rightPane
  if (mode === MODE.changes && pullForm !== null) {
    rightPane = h(CreatePullForm, {
      form: pullForm,
      onCancel: closeCreatePull,
      onChangeBase: (value) => changePullField('base', value),
      onChangeAccount: (value) => changePullField('accountId', value),
      onChangeTitle: (value) => changePullField('title', value),
      onChangeBody: (value) => changePullField('body', value),
      onGenerate: generatePullText,
      onCreate: createPull,
      onOpenUrl: openExternal,
      // 创建 PR 只认「本地与远端一致」：不一致时表单说明原因，左侧提示条给下一步动作
      synced: status !== null && status.sync.state === 'synced',
      syncState: status === null ? 'unknown' : status.sync.state,
      t
    })
  } else if (mode === MODE.remote && openPull !== null) {
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
      onPullFile: pullFile,
      onPrepareReview: prepareReviewPull,
      onSessionReview: sessionReviewPull,
      onCommentSession: sessionReviewPull,
      onCloneForReview: cloneForReviewPull,
      projectRoot: project.projectRoot,
      // 深度审阅会拿这些仓库逐个比对 origin，命中就复用它的对象库（快很多）
      localRepoRoots: gitRoots.map((root) => root.path),
      onComment: commentPull,
      onSetPullState: setPullState,
      onOpenSettings: openSettings,
      onMerge: mergePull,
      onChanged: () => loadPullDetail(openPull),
      onOpenUrl: openExternal,
      t
    })
  } else if (mode === MODE.remote) {
    rightPane = h(RemoteDetail, {
      selection: remoteSelection,
      detail: remoteDetail,
      // 分支区：数据 + 各类操作都走 Panel，组件只做交互与错误呈现
      branchState: remoteBranches,
      onReloadBranches: () => loadRemoteBranches(remoteSelection),
      onFetchBranches: fetchRepoBranches,
      onSwitchBranch: switchRemoteBranch,
      onTrackBranch: trackRemoteBranch,
      onDeleteLocalBranch: deleteLocalBranchAt,
      onDeleteRemoteBranch: deleteRemoteBranchAt,
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
    if (changesSelection === null) {
      // 和 DiffView 用同一个容器壳，空态与有内容时的几何完全一致（居中，不贴左上角）
      rightPane = h('div', { className: 'dgp-viewer' },
        h(EmptyState, {
          icon: 'file-diff',
          title: t('viewer.placeholderDiff')
        }))
    } else {
      rightPane = h(DiffView, {
        diff,
        loading: diffLoading,
        error: diffError,
        path: changesSelection.path,
        entry: changesSelection.entry,
        view: diffView,
        wrap: wrap === true && diffView === 'unified',
        onRetry: () => setDiffNonce((previous) => previous + 1),
        t
      })
    }
  } else if (fileSelection === null) {
    rightPane = h('div', { className: 'dgp-viewer' },
      h(EmptyState, {
        icon: 'file',
        title: t('viewer.placeholder')
      }))
  } else {
    const path = fileSelection.path
    const draft = drafts.get(path)
    const conflict = saveState.conflict !== null && saveState.conflict.path === path ? saveState.conflict : null
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
    label: t('toolbar.unified'),
    checked: diffView === 'unified',
    onClick: () => {
      setDiffView('unified')
      setMoreOpen(false)
    }
  }),
  h(MenuItem, {
    label: t('toolbar.split'),
    checked: diffView === 'split',
    onClick: () => {
      setDiffView('split')
      setMoreOpen(false)
    }
  }),
  h(MenuItem, {
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
    ref: dividerRef,
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-valuenow': leftWidth,
    'aria-valuemin': MIN_LEFT,
    tabIndex: 0,
    title: t('toolbar.resize'),
    onPointerDown: beginDrag,
    onKeyDown: (event) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        resizeBy(-16)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        resizeBy(16)
      }
    }
  }),
  h('div', { className: 'dgp-pane-right' },
    mode === MODE.remote && remoteNotice !== null
      ? h('div', { className: 'dgp-remote-notice', 'data-dgp-remote': 'notice' },
        h('span', { className: 'dgp-oneline' }, remoteNotice),
        h('button', {
          type: 'button',
          className: 'dgp-row-action',
          'data-dgp-remote': 'notice-dismiss',
          title: t('action.close'),
          onClick: () => setRemoteNotice(null)
        }, h(Icon, { name: 'close', size: 12 })))
      : null,
    rightPane))

  let content
  if (rootsLoading && roots.length === 0) {
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
      }, t('action.retry'))]
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
      }, t('action.retry'))]
    })
  } else {
    content = body
  }

  if (showSettings) {
    content = h(SettingsView, {
      models: settingsState.models,
      commitModel: settingsState.commitModel,
      commitThinking: settingsState.commitThinking === true,
      commitReasoningEffort: settingsState.commitReasoningEffort,
      onChangeCommitThinking: changeCommitThinking,
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
      postCommitPush,
      onChangePostCommitPush: setPostCommitPush,
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
        onClick: () => refreshRepository()
      }, t('action.retry')))
    : null,
  content,
  moreMenu)
}

/** 版本号按钮的 tooltip：插件版本 · 最新版本 · 检测时间（与仓库状态无关）。 */
function buildVersionTitle(pluginState, t) {
  const parts = [t('toolbar.checkUpdates')]
  if (pluginState.version !== null) parts.push(t('update.currentVersion', { version: pluginState.version }))
  if (pluginState.checkedAt > 0 && pluginState.error === null) {
    parts.push(pluginState.newer
      ? t('update.latestVersion', { version: pluginState.latestVersion })
      : t('update.pluginUpToDate', { version: pluginState.version }))
    parts.push(t('update.checkedAt', { time: formatClock(pluginState.checkedAt) }))
  }
  return parts.join(' \u00b7 ')
}

/**
 * 上游检查的一句话结果。
 * 落后优先于领先：同时有分叉时更重要的是"你落后了"。
 */
function buildUpstreamNote(value, t) {
  const upstream = value.upstream === null ? '' : value.upstream
  if (value.behind > 0) return { tone: 'warn', text: t('update.behind', { count: value.behind, upstream }) }
  if (value.ahead > 0) return { tone: 'info', text: t('update.ahead', { count: value.ahead, upstream }) }
  return { tone: 'info', text: t('update.upToDate', { upstream }) }
}

/**
 * 创建分支后的那句话。
 *
 * 用户最不确定的就是「我的改动去哪了」，所以这里必须把三种结局分开说：
 * 切过去并带走了改动 / 切过去但本来就没有改动 / 只建了分支没切换（改动留在原处）。
 */
function buildBranchCreatedNote(value, t) {
  if (value.switched !== true) return { tone: 'info', text: t('branch.createdOnly', { name: value.branch }) }
  if (value.carried.total > 0) {
    return { tone: 'info', text: t('branch.createdFollow', { name: value.branch, total: value.carried.total }) }
  }
  return { tone: 'info', text: t('branch.created', { name: value.branch }) }
}

/** 分支数据的去重键：同一个仓库名在不同账号下是两份数据。 */
function branchKeyOf(selection) {
  return selection.accountId + '#' + selection.fullName
}

/**
 * remote/branches 的状态 → 本地仓库根。
 * 没有本地克隆（或还没读到）时返回 null：分支区的本地操作一律以它为前提。
 */
function localRootPathOfBranches(state) {
  if (state === null) return null
  if (state.data === null) return null
  const local = state.data.local
  if (local === null) return null
  return typeof local.rootPath === 'string' && local.rootPath !== '' ? local.rootPath : null
}
