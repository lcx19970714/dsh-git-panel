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
 * 刷新策略：挂载 / 切根 / 切模式 / 窗口重新可见+聚焦 / 手动 ⟳ / 可选 8s 轮询；
 * 每次请求带序号守护，切根时 abort 掉旧请求。
 */
import { h, useCallback, useEffect, useMemo, useRef, useState } from '../platform.js'
import { Icon } from '../ui/Icon.js'
import { PopupMenu, MenuItem, MenuLabel, MenuSeparator } from '../ui/Menu.js'
import { RepoList } from './RepoList.js'
import { ChangesList } from './ChangesList.js'
import { FileTree } from './FileTree.js'
import { DiffView } from './DiffView.js'
import { FileEditor } from './FileEditor.js'
import { EmptyState, LoadingState, InlineNote } from './States.js'
import { CommitBox } from './CommitBox.js'
import { SettingsView } from './SettingsView.js'
import { RemotePane } from './RemotePane.js'
import { RemoteDetail } from './RemoteDetail.js'
import { PullDetail } from './PullDetail.js'
import { MODE, readRemoteAccount, saveRemoteAccount, usePref, useLatestGuard, workspaceKeyOf } from '../store.js'
import * as api from '../api.js'
import { openExternalUrl } from '../util/openUrl.js'
import { reconcileSelection } from '../util/changes.js'
import { webUrlOf } from '../util/remote.js'
import { formatClock } from '../util/time.js'

const POLL_INTERVAL_MS = 8000
/** 提交成功提示的存活时间：看一眼就够，别一直占着位置。 */
const COMMIT_NOTE_TTL_MS = 8000
const MIN_LEFT = 180
const MIN_RIGHT = 280

function documentVisible() {
  return document.visibilityState !== 'hidden'
}

function documentFocused() {
  return document.hasFocus()
}


function initialSide(entry) {
  if (entry === null) return 'unstaged'
  if (entry.untracked) return 'untracked'
  if (entry.unstaged) return 'unstaged'
  return 'staged'
}

export function Panel(props) {
  const t = props.t
  const tRef = useRef(t)
  tRef.current = t
  /** loadAccounts 定义在 openSettings 之后，这里留一个最新引用供打开设置时调用。 */
  const loadAccountsRef = useRef(null)

  const sessionId = props.sessionId

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

  /* ------------------------------ 远端账号 ------------------------------ */
  const [accounts, setAccounts] = useState([])
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [remoteAccountId, setRemoteAccountId] = useState(null)
  /**
   * 远端账号的「按工作区记忆」两个 ref：
   *  · userPicked —— 用户亲手点过 chip 后，就以他的选择为准，项目根解析得晚也不回退到记忆值；
   *  · restoredFor —— 已经为哪个工作区解析过记忆值（账号列表重新加载时不反复覆盖选择）。
   */
  const remoteUserPickedRef = useRef(false)
  const remoteRestoredForRef = useRef(null)
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
  // 右侧详情：选中的仓库与它的数据
  const [remoteSelection, setRemoteSelection] = useState(null)
  const [remoteDetail, setRemoteDetail] = useState(null)
  const remoteReposRef = useRef([])
  remoteReposRef.current = remoteRepos
  // 面板内打开的 PR：{ number } + 它的详情
  const [openPull, setOpenPull] = useState(null)
  const [pullDetail, setPullDetail] = useState(null)
  const [accountsBusy, setAccountsBusy] = useState(false)
  const [accountsError, setAccountsError] = useState(null)
  const [accountsNotice, setAccountsNotice] = useState(null)
  // 合并后 PR 会自动关闭，提示放在右侧顶部（PullDetail 已卸载，它的本地提示会丢）
  const [remoteNotice, setRemoteNotice] = useState(null)

  /* ------------------------------- 根 ------------------------------- */
  const [project, setProject] = useState({ projectRoot: null, roots: [], warnings: [] })
  const [activeRootId, setActiveRootId] = useState(null)
  const [rootsLoading, setRootsLoading] = useState(true)
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

  /* ------------------------------ status ------------------------------ */
  const [status, setStatus] = useState(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [statusError, setStatusError] = useState(null)
  /** 正在暂存/取消暂存的文件路径；同时只允许一个，避免连点打乱索引。 */
  const [stagePending, setStagePending] = useState(null)
  const stagePendingRef = useRef(null)
  const statusSeq = useLatestGuard()
  const statusAbortRef = useRef(null)

  /* ----------------------------- 选中状态 ----------------------------- */
  const [selection, setSelection] = useState(null) // { path, entry, side }
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

  /**
   * 编辑器草稿表：path -> { text, savedText, hash, eol, bom }。
   *
   * 为什么按 path 存在面板内存里（而不是只存"当前文件"）：
   *  用户在 A 文件改了几行、切去看 B、再切回 A —— 未保存的内容必须还在。
   *  静默丢弃按键是最不能接受的失败方式，所以草稿的生命周期 = 面板实例的生命周期。
   */
  const [drafts, setDrafts] = useState(() => new Map())
  const [saveState, setSaveState] = useState({ busy: false, savedAt: 0, error: null, conflict: null })
  const saveSeq = useLatestGuard()
  /**
   * 检测更新（git fetch）的状态。
   * fetchedAt 为 0 表示还没检测过；checkSeq 保证只有最新一次结果落地。
   */
  const [updateState, setUpdateState] = useState({ busy: false, fetchedAt: 0, ahead: 0, behind: 0, upstream: null, remoteUrl: null, error: null })
  const checkSeq = useLatestGuard()

  // 下面四个派生值只依赖 state，放在动作之前：checkUpdates/openRemote 要用到它们
  // 版本号 = 当前提交的短 SHA（status.head 已经是 --short 的结果）
  const versionText = status !== null && status.head !== null ? status.head : '—'
  const remoteWebUrl = webUrlOf(status === null ? null : status.remoteUrl)
  const versionTitle = buildVersionTitle(activeRoot, status, updateState, remoteWebUrl, t)
  const updateNote = buildUpdateNote(updateState, t)
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts

  /* --------------------------- 提交 / 设置 --------------------------- */
  const [commitMessage, setCommitMessage] = useState('')
  const [commitBusy, setCommitBusy] = useState(false)
  const [commitGenerating, setCommitGenerating] = useState(false)
  /** 生成中的已等待毫秒数：每 200ms 刷新一次，让用户看得见它在跑。 */
  const [generateElapsed, setGenerateElapsed] = useState(0)
  const [commitNote, setCommitNote] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsState, setSettingsState] = useState({ loading: false, models: [], commitModel: null, reviewModel: null, error: null, saved: false })

  const [moreOpen, setMoreOpen] = useState(false)
  const moreAnchorRef = useRef(null)
  const [moreAnchorRect, setMoreAnchorRect] = useState(null)

  const rootRef = useRef(null)
  const bodyRef = useRef(null)
  const [dragging, setDragging] = useState(false)

  /* ============================ 解析项目根 ============================ */
  const resolveProject = useCallback(async (signal) => {
    setRootsLoading(true)
    setRootsError(null)
    try {
      const value = await api.resolveProject({ sessionId }, { signal })
      if (signal !== undefined && signal.aborted) return
      const next = { projectRoot: value.projectRoot, roots: value.roots, warnings: value.warnings }
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
  }, [sessionId])

  useEffect(() => {

    const controller = new AbortController()
    resolveProject(controller.signal)
    return () => controller.abort()
  }, [resolveProject, sessionId])

  /* ============================== 刷新 status ============================== */
  const refreshStatus = useCallback(async () => {
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
    const previousController = statusAbortRef.current
    statusAbortRef.current = controller
    if (previousController !== null && typeof previousController.abort === 'function') {
      try {
        previousController.abort()
      } catch {
        /* ignore */
      }
    }
    setStatusLoading(true)
    setStatusError(null)
    try {
      const value = await api.readStatus({ rootPath: root.path }, { signal: controller.signal })
      if (!statusSeq.isLatest(token)) return
      setStatus(value)
      setSelection((previous) => reconcileSelection(previous, value.files))
    } catch (error) {
      if (!statusSeq.isLatest(token)) return
      if (error !== null && error !== undefined && error.code === 'aborted') return
      setStatusError(api.describeError(error, tRef.current))
    } finally {
      if (statusAbortRef.current === controller) statusAbortRef.current = null
      if (statusSeq.isLatest(token)) setStatusLoading(false)
    }
  }, [statusSeq])

  /**
   * 用户主动刷新（工具条按钮 / R 键）：除了 status，还要重读"当前正在看的内容"。
   *
   * - 变更模式：status 刷新后 `reconcileSelection` 会给出**新的** selection 对象，
   *   diff 的 effect 依赖 selection 身份，所以 diff 自动重取 —— 这里不需要额外动作。
   * - 文件模式：选中项代表一个路径，`reconcileSelection` 原样返回同一个对象（这是对的，
   *   否则未修改的文件会被清空），因此文件内容必须靠 fileNonce 显式重读。
   */
  const refreshAll = useCallback(() => {
    setFileNonce((count) => count + 1)
    refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    setStatus(null)
    setSelection(null)
    setDiff(null)
    setFileData(null)
    // 换根 = 换了一批文件：草稿（按相对路径存）不再有意义
    setDrafts(new Map())
    setSaveState({ busy: false, savedAt: 0, error: null, conflict: null })
    if (activeRoot === null || activeRoot.isGit === false) {
      setStatusLoading(false)
      return undefined
    }
    refreshStatus()
    // 切根/卸载：取消这个根还没回来的 status 请求
    return () => {
      const controller = statusAbortRef.current
      if (controller !== null && typeof controller.abort === 'function') {
        try {
          controller.abort()
        } catch {
          /* ignore */
        }
      }
      statusAbortRef.current = null
    }
  }, [activeRootId, activeRoot === null ? null : activeRoot.isGit, refreshStatus])

  /* ---------------------------- 自适应 refresh ---------------------------- */
  useEffect(() => {
    const onFocus = () => refreshStatus()
    const onVisibility = () => {
      if (documentVisible()) refreshStatus()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refreshStatus])

  useEffect(() => {
    if (autoRefresh !== true || mode !== MODE.changes) return undefined
    const timer = setInterval(() => {
      if (documentVisible() && documentFocused()) refreshStatus()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [autoRefresh, mode, refreshStatus])

  /* ============================== 取 diff ============================== */
  useEffect(() => {
    if (mode !== MODE.changes) return undefined
    if (selection === null || activeRoot === null) {
      setDiff(null)
      setDiffLoading(false)
      setDiffError(null)
      return undefined
    }
    const controller = new AbortController()
    const token = diffSeq.begin()
    setDiffLoading(true)
    setDiffError(null)
    api.readDiff({
      rootPath: activeRoot.path,
      path: selection.path,
      staged: selection.side === 'staged',
      untracked: selection.side === 'untracked',
      contextLines,
      ignoreWhitespace
    }, { signal: controller.signal })
      .then((value) => {
        if (!diffSeq.isLatest(token)) return
        setDiff(value)
      })
      .catch((error) => {
        if (!diffSeq.isLatest(token)) return
        if (error && error.code === 'aborted') return
        setDiffError(api.describeError(error, tRef.current))
      })
      .finally(() => {
        if (diffSeq.isLatest(token)) setDiffLoading(false)
      })
    return () => controller.abort()
  }, [mode, selection, activeRootId, contextLines, ignoreWhitespace, diffSeq, diffNonce])

  /* ====================== 编辑器草稿 / 保存（文件模式） ====================== */

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
    const editable = value !== null && typeof value === 'object'
      && value.kind === 'text' && typeof value.text === 'string'
    const existing = draftsRef.current.get(path)
    if (editable !== true) {
      if (existing === undefined) return
      const cleaned = new Map(draftsRef.current)
      cleaned.delete(path)
      setDrafts(cleaned)
      return
    }
    const fresh = {
      text: value.text,
      savedText: value.text,
      hash: value.hash,
      eol: value.eol,
      bom: value.bom === true
    }
    if (existing === undefined) {
      const created = new Map(draftsRef.current)
      created.set(path, fresh)
      setDrafts(created)
      return
    }
    if (existing.hash === value.hash) return
    const dirty = existing.text !== existing.savedText
    const next = new Map(draftsRef.current)
    next.set(path, dirty ? existing : fresh)
    setDrafts(next)
    if (dirty) setSaveState((previous) => ({ ...previous, conflict: { path } }))
  }, [])

  /** 编辑器输入 → 更新草稿。 */
  const changeDraft = useCallback((path, text) => {
    setDrafts((previous) => {
      const draft = previous.get(path)
      if (draft === undefined || draft.text === text) return previous
      const next = new Map(previous)
      next.set(path, { ...draft, text })
      return next
    })
  }, [])

  /**
   * 保存当前文件。
   * `force === true` 只由「覆盖保存」按钮传入 —— 那是用户看过冲突提示后的显式决定。
   */
  const saveDraft = useCallback(async (force) => {
    if (mode !== MODE.files || browseRoot === null || selection === null) return
    const path = selection.path
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
      setDrafts((previous) => {
        const current = previous.get(path)
        if (current === undefined) return previous
        const next = new Map(previous)
        next.set(path, { ...current, savedText: current.text, hash: result.hash })
        return next
      })
      setSaveState({ busy: false, savedAt: Date.now(), error: null, conflict: null })
      // 保存后工作区变了：刷新 status，让变更列表/计数跟上（选中项是路径型，不会被清掉）
      refreshStatus()
    } catch (error) {
      if (!saveSeq.isLatest(token)) return
      if (error !== null && error !== undefined && error.code === 'conflict') {
        setSaveState({ busy: false, savedAt: 0, error: null, conflict: { path } })
        return
      }
      if (error !== null && error !== undefined && error.code === 'aborted') {
        setSaveState((previous) => ({ ...previous, busy: false }))
        return
      }
      setSaveState({ busy: false, savedAt: 0, error: api.describeError(error, tRef.current), conflict: null })
    }
  }, [mode, browseRoot, selection, saveSeq, refreshStatus])

  /** 冲突条的「重新加载」：丢掉本地改动，重新从磁盘读。 */
  const reloadDraft = useCallback(() => {
    if (selection === null) return
    const path = selection.path
    setDrafts((previous) => {
      if (!previous.has(path)) return previous
      const next = new Map(previous)
      next.delete(path)
      return next
    })
    setSaveState({ busy: false, savedAt: 0, error: null, conflict: null })
    setFileNonce((count) => count + 1)
  }, [selection])

  /* -------------------------- 检测更新 / 打开仓库 -------------------------- */

  /**
   * 检测更新 = 让宿主执行一次 git fetch，再回来看 ahead/behind。
   * 这是只读操作（只更新远端跟踪引用），所以不需要二次确认。
   */
  const checkUpdates = useCallback(async () => {
    if (activeRoot === null || activeRoot.isGit === false) return
    const token = checkSeq.begin()
    setUpdateState((previous) => ({ ...previous, busy: true, error: null }))
    try {
      const value = await api.fetchRemote({ rootPath: activeRoot.path })
      if (!checkSeq.isLatest(token)) return
      setUpdateState({
        busy: false,
        fetchedAt: value.fetchedAt,
        ahead: value.ahead,
        behind: value.behind,
        upstream: value.upstream,
        remoteUrl: value.url,
        error: null
      })
      // fetch 改了远端跟踪引用：status 里的 ahead/behind 也要跟上
      refreshStatus()
    } catch (error) {
      if (!checkSeq.isLatest(token)) return
      if (error !== null && error !== undefined && error.code === 'aborted') {
        setUpdateState((previous) => ({ ...previous, busy: false }))
        return
      }
      setUpdateState({
        busy: false,
        fetchedAt: Date.now(),
        ahead: 0,
        behind: 0,
        upstream: null,
        remoteUrl: null,
        error: api.describeError(error, tRef.current)
      })
    }
  }, [activeRoot, checkSeq, refreshStatus])

  /** 打开远端仓库网页（本地路径类远端没有网页，按钮此时是禁用的）。 */
  const openRemote = useCallback(() => {
    if (remoteWebUrl === null) return
    window.open(remoteWebUrl, '_blank', 'noopener,noreferrer')
  }, [remoteWebUrl])


  /** 有未保存改动的文件（给文件树画脏点）。 */
  const dirtyPaths = useMemo(() => {
    const set = new Set()
    for (const [path, draft] of drafts) if (draft.text !== draft.savedText) set.add(path)
    return set
  }, [drafts])
  /* ============================ 取文件内容 ============================ */
  useEffect(() => {
    if (mode !== MODE.files) return undefined
    if (selection === null || activeRoot === null) {
      setFileData(null)
      setFileLoading(false)
      setFileError(null)
      return undefined
    }
    const controller = new AbortController()
    const token = fileSeq.begin()
    setFileLoading(true)
    setFileError(null)
    const path = selection.path
    api.readFile({ rootPath: browseRoot.path, path }, { signal: controller.signal })
      .then((value) => {
        if (!fileSeq.isLatest(token)) return
        setFileData(value)
        adoptRead(path, value)
      })
      .catch((error) => {
        if (!fileSeq.isLatest(token)) return
        if (error && error.code === 'aborted') return
        setFileError(api.describeError(error, tRef.current))
      })
      .finally(() => {
        if (fileSeq.isLatest(token)) setFileLoading(false)
      })
    return () => controller.abort()
  }, [mode, selection, browseRoot === null ? null : browseRoot.id, fileSeq, fileNonce])

  /* ============================== 交互 ============================== */
  const selectEntry = useCallback((entry, groupKey) => {
    if (entry === null || entry === undefined) return
    const side = groupKey === 'staged' && entry.staged === true
      ? 'staged'
      : groupKey === 'unstaged' && entry.unstaged === true
        ? 'unstaged'
        : groupKey === 'untracked'
          ? 'untracked'
          : initialSide(entry)
    setSelection({ path: entry.path, entry, side })
  }, [])

  const selectFile = useCallback((relPath) => {
    if (typeof relPath !== 'string' || relPath === '') return
    setSelection({ path: relPath, entry: null, side: 'unstaged' })
  }, [])

  const switchSide = useCallback((side) => {
    setSelection((previous) => (previous === null ? previous : { ...previous, side }))
  }, [])

  /**
   * 行尾 + / −：未暂存与未跟踪暂存（git add），已暂存取消暂存（git restore --staged）。
   * 操作只作用于那一个文件；完成后重读 status，分组归属由新状态决定，
   * 所以文件会从下面的未暂存移到上面的已暂存（或反过来）。
   */
  const stageEntry = useCallback(async (relPath, action) => {
    if (activeRoot === null || activeRoot.isGit === false) return
    if (typeof relPath !== 'string' || relPath === '') return
    if (action !== 'stage' && action !== 'unstage') return
    if (stagePendingRef.current !== null) return
    stagePendingRef.current = relPath
    setStagePending(relPath)
    setStatusError(null)
    try {
      await api.stageFile({ rootPath: activeRoot.path, path: relPath, action })
      await refreshStatus()
      setDiffNonce((previous) => previous + 1)
    } catch (error) {
      if (error === null || error === undefined || error.code !== 'aborted') {
        setStatusError(api.describeError(error, tRef.current))
      }
    } finally {
      stagePendingRef.current = null
      setStagePending(null)
    }
  }, [activeRoot, refreshStatus])

  /** 分组头的批量按钮：一次暂存或取消暂存整组。 */
  const stageGroup = useCallback(async (scope) => {
    if (activeRoot === null || activeRoot.isGit === false) return
    if (scope !== 'stage-unstaged' && scope !== 'stage-untracked' && scope !== 'stage-all' && scope !== 'unstage') return
    if (stagePendingRef.current !== null) return
    stagePendingRef.current = scope
    setStagePending(scope)
    setStatusError(null)
    try {
      await api.stageGroup({ rootPath: activeRoot.path, scope })
      await refreshStatus()
      setDiffNonce((previous) => previous + 1)
    } catch (error) {
      if (error === null || error === undefined || error.code !== 'aborted') {
        setStatusError(api.describeError(error, tRef.current))
      }
    } finally {
      stagePendingRef.current = null
      setStagePending(null)
    }
  }, [activeRoot, refreshStatus])

  /** 提交已暂存内容。未暂存的改动不参与。 */
  const commitStaged = useCallback(async () => {
    if (activeRoot === null || activeRoot.isGit === false) return
    const message = commitMessage.trim()
    if (message === '' || commitBusy) return
    setCommitBusy(true)
    setCommitNote(null)
    try {
      const result = await api.commitChanges({ rootPath: activeRoot.path, message })
      setCommitMessage('')
      const subject = typeof result.subject === 'string' ? result.subject.trim() : ''
      setCommitNote({
        tone: 'info',
        text: subject === ''
          ? tRef.current('commit.done', { head: result.head })
          : tRef.current('commit.doneSubject', { head: result.head, subject })
      })
      await refreshStatus()
      setDiffNonce((previous) => previous + 1)
    } catch (error) {
      setCommitNote({ tone: 'error', text: api.describeError(error, tRef.current) })
    } finally {
      setCommitBusy(false)
    }
  }, [activeRoot, commitMessage, commitBusy, refreshStatus])

  /** 改输入就清掉上一次的结果提示：用户已经在写新的说明了。 */
  const changeCommitMessage = useCallback((text) => {
    setCommitMessage(text)
    setCommitNote(null)
  }, [])

  /**
   * 提交成功的提示会自己消失（8s）；错误提示留着，用户读完自己动手再试。
   */
  useEffect(() => {
    if (commitNote === null || commitNote.tone === 'error') return undefined
    const timer = setTimeout(() => setCommitNote(null), COMMIT_NOTE_TTL_MS)
    return () => clearTimeout(timer)
  }, [commitNote])

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
    if (activeRoot === null || activeRoot.isGit === false || commitGenerating) return
    setCommitGenerating(true)
    setCommitNote(null)
    try {
      const result = await api.commitMessage({ rootPath: activeRoot.path })
      setCommitMessage(result.message)
    } catch (error) {
      setCommitNote({ tone: 'error', text: api.describeError(error, tRef.current) })
    } finally {
      setCommitGenerating(false)
    }
  }, [activeRoot, commitGenerating])

  /** 设置里存的是 {provider, model}，下拉框用的是扁平 ref。 */
  const refOfPair = (pair) => (pair === null || pair === undefined ? null : pair.provider + '/' + pair.model)

  /** 打开设置页：同时拉模型目录和当前设置。 */
  const openSettings = useCallback(async () => {
    setShowSettings(true)
    setSettingsState({ loading: true, models: [], commitModel: null, reviewModel: null, error: null, saved: false })
    // 设置页也管理账号：进来就确保账号列表是最新的（只读列表接口，很便宜）
    loadAccountsRef.current?.()
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
        error: modelError,
        saved: false
      })
    } catch (error) {
      setSettingsState({ loading: false, models: [], commitModel: null, reviewModel: null, error: api.describeError(error, tRef.current), saved: false })
    }
  }, [])

  /** 选择模型即保存。空值表示清除。 */
  const changeCommitModel = useCallback(async (ref) => {
    const commitModel = ref === '' ? null : ref
    setSettingsState((previous) => ({ ...previous, commitModel, saved: false, error: null }))
    try {
      const saved = await api.writeSettings({ commitModel })
      setSettingsState((previous) => ({ ...previous, commitModel: refOfPair(saved.commitModel), saved: true }))
    } catch (error) {
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
    if (activeRoot !== null && activeRoot.isGit === true) return
    const firstRepo = gitRoots[0]
    if (firstRepo !== undefined) setActiveRootId(firstRepo.id)
  }, [mode, activeRoot, gitRoots])

  const toggleGroup = useCallback((groupKey) => {
    setCollapsedGroups((previous) => {
      const next = { ...(previous && typeof previous === 'object' ? previous : {}) }
      if (next[groupKey] === true) delete next[groupKey]
      else next[groupKey] = true
      return next
    })
  }, [setCollapsedGroups])

  const selectRoot = useCallback((root) => {
    if (root === null || root === undefined) return
    setActiveRootId(root.id)
  }, [])

  const addExternalRoot = useCallback(async (dir) => {
    const projectRoot = projectRef.current.projectRoot
    if (typeof projectRoot !== 'string' || projectRoot === '') {
      throw new Error(tRef.current('status.noCwd'))
    }
    try {
      const value = await api.addRoot({ projectRoot, path: dir })
      const nextRoots = value.roots
      setProject({ projectRoot: value.projectRoot, roots: nextRoots, warnings: value.warnings })
      const added = nextRoots.find((root) => typeof root.path === 'string' && root.path.toLowerCase() === dir.replace(/\\/g, '/').toLowerCase())
      if (added !== undefined) setActiveRootId(added.id)
      else if (nextRoots.length > 0) setActiveRootId(nextRoots[nextRoots.length - 1].id)
      return value
    } catch (error) {
      throw new Error(api.describeError(error, tRef.current))
    }
  }, [])

  const removeExternalRoot = useCallback(async (root) => {
    const projectRoot = projectRef.current.projectRoot
    if (root === null || typeof projectRoot !== 'string') return
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
    if (root === null || typeof projectRoot !== 'string') return
    try {
      applyRootsChange(await api.hideRoot({ projectRoot, path: root.path }), root)
    } catch (error) {
      setRootsError(api.describeError(error, tRef.current))
    }
  }, [applyRootsChange])

  const unhideRoot = useCallback(async (root) => {
    const projectRoot = projectRef.current.projectRoot
    if (root === null || typeof projectRoot !== 'string') return
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
    await refreshStatus()
  }, [resolveProject, refreshStatus])

  /** 分支菜单里的「获取远程更新」：git fetch 后重读分支列表。 */
  const fetchBranches = useCallback(async (root) => {
    try {
      await api.fetchRemote({ rootPath: root.path })
    } catch (error) {
      throw new Error(api.describeError(error, tRef.current))
    }
    return api.listBranches({ rootPath: root.path })
  }, [])

  const switchBranch = useCallback(async (root, name) => {
    try {
      await api.switchBranch({ rootPath: root.path, name })
    } catch (error) {
      throw new Error(api.describeError(error, tRef.current))
    }
    // 切分支会改 HEAD 与工作区：重新解析根（分支名要更新）并重读状态
    await resolveProject()
    await refreshStatus()
  }, [resolveProject, refreshStatus])

  /** 创建分支后直接切过去：宿主一次做完 `git switch -c`，面板只负责刷新。 */
  const createBranch = useCallback(async (root, name) => {
    try {
      await api.createBranch({ rootPath: root.path, name })
    } catch (error) {
      throw new Error(api.describeError(error, tRef.current))
    }
    await resolveProject()
    await refreshStatus()
  }, [resolveProject, refreshStatus])

  const loadDir = useCallback(async (relPath, signal) => {
    const root = browseRootRef.current
    if (root === null) return { entries: [], truncated: false }
    return api.listDirectory({ rootPath: root.path, path: relPath ?? '' }, { signal })
  }, [])

  /* ------------------------------ 远端账号 ------------------------------ */

  /** 读账号列表（token 不会下发到客户端，只有 id/login/label）。 */
  const loadAccounts = useCallback(async () => {
    try {
      const value = await api.listAccounts({})
      setAccounts(value.accounts)
      setProviders(value.providers)
      setAccountsLoaded(true)
      /*
       * 选中账号的优先级：当前选中的（仍存在） → 本工作区上次选中的 → 第一个。
       * 账号列表是全局的，但「用哪个」按工作区记（store.js 的 readRemoteAccount），
       * 所以切去别的工作区再回来、或者重新打开面板，都不会退回第一个账号。
       */
      setRemoteAccountId((previous) => {
        if (typeof previous === 'string' && value.accounts.some((account) => account.id === previous)) return previous
        const remembered = readRemoteAccount(projectRef.current.projectRoot)
        if (remembered !== null && value.accounts.some((account) => account.id === remembered)) return remembered
        return value.accounts.length > 0 ? value.accounts[0].id : null
      })
    } catch (error) {
      setAccountsLoaded(true)
      setRemoteError(api.describeError(error, tRef.current))
    }
  }, [])
  loadAccountsRef.current = loadAccounts

  /** 读某个账号的仓库；append 用于「加载更多」。 */
  const loadRepos = useCallback(async (accountId, page, append) => {
    if (typeof accountId !== 'string') return
    setRemoteLoading(true)
    if (append !== true) setRemoteError(null)
    try {
      const value = await api.listRemoteRepos({ accountId, page })
      setRemoteRepos((previous) => (append === true ? [...previous, ...value.repos] : value.repos))
      setRemoteHasMore(value.hasMore === true)
    } catch (error) {
      setRemoteError(api.describeError(error, tRef.current))
      if (append !== true) setRemoteRepos([])
    } finally {
      setRemoteLoading(false)
    }
  }, [])

  /** 批量取当前列表的未合并 PR 数（宿主限制 50 个/次）。 */
  const loadPullCounts = useCallback(async (accountId, repos) => {
    if (typeof accountId !== 'string' || repos.length === 0) {
      setPrCounts({})
      return
    }
    try {
      const value = await api.remotePullCounts({
        accountId,
        fullNames: repos.map((repo) => repo.fullName)
      })
      setPrCounts(value.counts ?? {})
    } catch {
      // 计数只是角标：失败就不显示，不打断列表（详情接口会暴露真实错误）
      setPrCounts({})
    }
  }, [])

  /** 读选中仓库的详情（代码 / issues / PR）。 */
  const loadRemoteDetail = useCallback(async (selection) => {
    if (selection === null) {
      setRemoteDetail(null)
      return
    }
    setRemoteDetail({ loading: true, error: null, data: null })
    try {
      const data = await api.remoteDetail({ accountId: selection.accountId, fullName: selection.fullName })
      setRemoteDetail({ loading: false, error: null, data })
    } catch (error) {
      setRemoteDetail({ loading: false, error: api.describeError(error, tRef.current), data: null })
    }
  }, [])

  /** 读一个 PR 的详情（含平台能力与审查记录）。 */
  const loadPullDetail = useCallback(async (selection) => {
    if (selection === null) {
      setPullDetail(null)
      return
    }
    setPullDetail({ loading: true, error: null, data: null })
    try {
      const data = await api.remotePull({
        accountId: selection.accountId,
        fullName: selection.fullName,
        number: selection.number
      })
      setPullDetail({ loading: false, error: null, data })
    } catch (error) {
      setPullDetail({ loading: false, error: api.describeError(error, tRef.current), data: null })
    }
  }, [])

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
  }, [remoteSelection, loadPullDetail])

  const closePull = useCallback(() => {
    setOpenPull(null)
    setPullDetail(null)
  }, [])

  /** 打开某个 PR 时清掉上次合并的提示。 */
  const openPullWith = useCallback((selection) => {
    setRemoteNotice(null)
    setOpenPull(selection)
  }, [])

  /** 审查：统一把失败包成 { ok:false, error }，界面就地显示。 */
  const reviewPull = useCallback(async (input) => {
    try {
      const result = await api.remotePullReview(input)
      await loadPullDetail({ accountId: input.accountId, fullName: input.fullName, number: input.number })
      return { ok: true, message: tRef.current('pull.reviewDone', { verdict: input.verdict }) }
    } catch (error) {
      return { ok: false, error: api.describeError(error, tRef.current) }
    }
  }, [loadPullDetail])

  /** AI 审阅 PR：宿主取 diff、调审阅模型，返回结构化结论与评论草稿。 */
  const aiReviewPull = useCallback(async (input) => {
    try {
      const review = await api.remotePullAiReview(input)
      return { ok: true, ...review }
    } catch (error) {
      return { ok: false, error: api.describeError(error, tRef.current), code: error?.code ?? null }
    }
  }, [])

  /** 深度审阅：宿主拉 PR head 到临时 worktree，读完整文件后再判。 */
  const deepReviewPull = useCallback(async (input) => {
    try {
      const review = await api.remotePullDeepReview(input)
      return { ok: true, ...review }
    } catch (error) {
      return { ok: false, error: api.describeError(error, tRef.current), code: error?.code ?? null }
    }
  }, [])

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
      return { ok: true, message: tRef.current('pull.passDone', { steps: result.completed.join(' / ') }) }
    } catch (error) {
      return { ok: false, error: api.describeError(error, tRef.current) }
    }
  }, [loadPullDetail])

  /** 标记测试通过（Gitee 的合并门禁）：成功后重读详情，让合并按钮可用。 */
  const testPull = useCallback(async (input) => {
    try {
      await api.remotePullTest(input)
      await loadPullDetail({ accountId: input.accountId, fullName: input.fullName, number: input.number })
      return { ok: true, message: tRef.current('pull.testDone') }
    } catch (error) {
      return { ok: false, error: api.describeError(error, tRef.current) }
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
      // 合并后未合并数量会变，角标要跟着刷新
      await loadPullCounts(input.accountId, remoteReposRef.current)
      // closed:true 让 PullDetail 不要在被卸载后再写自己的提示
    return { ok: true, closed: true, message: tRef.current('pull.mergedDone', { branch: result.headBranch }) }
    } catch (error) {
      return { ok: false, error: api.describeError(error, tRef.current) }
    }
  }, [loadPullDetail, loadRemoteDetail])

  /** 选中账号：立刻记到当前工作区（切到别的工作区再回来仍是它）。 */
  const selectRemoteAccount = useCallback((accountId) => {
    remoteUserPickedRef.current = true
    setRemoteAccountId(accountId)
    // 项目根还没解析出来时这里写空；解析出来后由恢复记忆的 effect 补写
    saveRemoteAccount(projectRef.current.projectRoot, accountId)
  }, [])

  /** 选中仓库：右侧立刻进入加载态再拉数据。 */
  const selectRemoteRepo = useCallback((repo) => {
    const selection = { accountId: repo.accountId, fullName: repo.fullName, name: repo.name }
    setRemoteSelection(selection)
    loadRemoteDetail(selection)
  }, [loadRemoteDetail])

  const openExternal = useCallback((url) => {
    const result = openExternalUrl(url)
    if (result.opened !== true) setStatusError(tRef.current('error.openFailed', { url }))
  }, [])

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
    if (mode !== MODE.remote || remoteRepos.length === 0) return
    const exists = remoteSelection !== null && remoteRepos.some((repo) => repo.fullName === remoteSelection.fullName)
    if (exists) return
    selectRemoteRepo(remoteRepos[0])
  }, [mode, remoteRepos, remoteSelection, selectRemoteRepo])

  /** 切账号或首次进入时读第一页。 */
  useEffect(() => {
    if (mode !== MODE.remote || remoteAccountId === null) return
    loadRepos(remoteAccountId, 1, false)
  }, [mode, remoteAccountId, loadRepos])

  /**
   * 会话切换时面板实例可能被复用（sessionId 变了、工作区也就变了）：
   * 清掉「已解析」标记，让下面的记忆恢复按新工作区重新走一遍。
   */
  useEffect(() => {
    remoteUserPickedRef.current = false
    remoteRestoredForRef.current = null
  }, [sessionId])

  /**
   * 每个工作区记住自己的远端账号。
   *
   * 只在**两个明确时机**写记忆，避免「自动选中的第一个账号」把用户的选择覆盖掉：
   *  1. 用户亲手点了账号 chip（selectRemoteAccount 里写；项目根未知时由这里补写）；
   *  2. 项目根解析得比账号列表晚时（先读到账号、后知道是哪个工作区），
   *     这里补一次记忆恢复 —— 否则会停在「第一个账号」上。
   *
   * 记忆只解析一次（restoredFor），所以账号列表重新加载（新增/删除账号）不会
   * 把用户刚点好的选择改回去。
   */
  useEffect(() => {
    if (accounts.length === 0) return
    const workspace = project.projectRoot
    const key = workspaceKeyOf(workspace)
    if (key === null) return
    if (remoteUserPickedRef.current === true) {
      // 用户在知道工作区之前就点过账号：等知道了再补写，选择本身不覆盖
      if (remoteAccountId !== null && accounts.some((account) => account.id === remoteAccountId)) {
        saveRemoteAccount(workspace, remoteAccountId)
      }
      return
    }
    if (remoteRestoredForRef.current === key) return
    remoteRestoredForRef.current = key
    const remembered = readRemoteAccount(workspace)
    if (remembered !== null && accounts.some((account) => account.id === remembered) && remembered !== remoteAccountId) {
      setRemoteAccountId(remembered)
    }
  }, [accounts, remoteAccountId, project])

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
      await resolveProject()
      await refreshStatus()
      setMode(MODE.changes)
    } catch (error) {
      setCloneState({ fullName: repo.fullName, startedAt: 0, error: api.describeError(error, tRef.current) })
    }
  }, [resolveProject, refreshStatus, setMode])

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
  const beginDrag = useCallback((event) => {
    if (event.button !== undefined && event.button !== 0) return
    event.preventDefault()
    setDragging(true)
  }, [])

  useEffect(() => {
    if (!dragging) return undefined
    const onMove = (event) => {
      const body = bodyRef.current
      if (body === null) return
      const rect = body.getBoundingClientRect()
      const raw = event.clientX - rect.left
      const max = Math.max(MIN_LEFT, rect.width - MIN_RIGHT)
      const next = Math.min(max, Math.max(MIN_LEFT, Math.round(raw)))
      setLeftWidth(next)
    }
    const onUp = () => setDragging(false)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    const previousCursor = document.body.style.cursor
    const previousSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousSelect
    }
  }, [dragging, setLeftWidth])

  /* ------------------------------ 键盘 ------------------------------ */
  const onKeyDown = useCallback((event) => {
    const target = event.target
    const inField = target !== null && (
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable === true
    )
    if (event.key === '/' && !inField) {
      event.preventDefault()
      const node = filterRef.current
      if (node !== null && node.focus !== undefined) node.focus()
      return
    }
    if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === 's' || event.key === 'S')) {
      // 焦点在编辑器里时由 FileEditor 处理（它能拿到光标位置）；这里管"焦点在文件树/工具条"的情况
      if (inField || mode !== MODE.files) return
      event.preventDefault()
      if (selection !== null) saveDraft(false)
      return
    }
    if (inField) return
    if ((event.key === 'r' || event.key === 'R') && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      refreshAll()
    }
  }, [refreshAll, mode])


/** 版本号按钮的 tooltip：检测更新 · 分支 · 提交 · 上游 · 上次检测时间。 */
function buildVersionTitle(activeRoot, status, updateState, remoteWebUrl, t) {
  const parts = [t('toolbar.checkUpdates')]
  if (status !== null) {
    if (status.branch !== null) parts.push(status.branch)
    if (status.head !== null) parts.push(status.head)
    if (status.upstream !== null) parts.push(status.upstream)
  }
  if (activeRoot !== null && activeRoot.isGit === false) parts.push(t('update.noRemote'))
  else if (remoteWebUrl === null) parts.push(t('update.noRemote'))
  if (updateState.fetchedAt > 0 && updateState.error === null) {
    parts.push(t('update.checkedAt', { time: formatClock(updateState.fetchedAt) }))
  }
  return parts.join(' \u00b7 ')
}

/**
 * 检测更新的一句话结果。返回 null 表示还没有结果可报（从未检测过）。
 * 落后优先于领先：同时有分叉时更重要的是"你落后了"。
 */
function buildUpdateNote(updateState, t) {
  if (updateState.busy === true) return { tone: 'info', text: t('update.checking') }
  if (updateState.error !== null) return { tone: 'error', text: t('update.failed', { message: updateState.error }) }
  if (updateState.fetchedAt === 0) return null
  const upstream = updateState.upstream === null ? '' : updateState.upstream
  if (updateState.behind > 0) return { tone: 'warn', text: t('update.behind', { count: updateState.behind, upstream }) }
  if (updateState.ahead > 0) return { tone: 'info', text: t('update.ahead', { count: updateState.ahead, upstream }) }
  return { tone: 'info', text: t('update.upToDate', { upstream }) }
}


  /* ------------------------------ 派生 ------------------------------ */
  const selectedPath = selection === null ? null : selection.path
  const selectedEntry = selection === null ? null : selection.entry
  const entryHasBothSides = selectedEntry !== null
    && selectedEntry.staged === true
    && selectedEntry.unstaged === true
  const counts = status === null ? null : status.counts
  const isNarrow = typeof leftWidth === 'number' && leftWidth < 220
  const warnings = useMemo(() => {
    const list = []
    for (const warning of project.warnings) {
      if (warning !== '') list.push(warning)
    }
    if (activeRoot !== null && typeof activeRoot.error === 'string' && activeRoot.error !== '') {
      list.push(activeRoot.error)
    }
    return list
  }, [project.warnings, activeRoot])

  /* ------------------------------ 渲染 ------------------------------ */
  const noSession = typeof sessionId !== 'string'

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
          onClick: () => setMode(MODE.remote)
        }, t('mode.remote'))),
      h('div', { className: 'dgp-spacer' }),
      // 检测更新的结果贴在版本号左边，不单独占一行（宽度不够时自己截断，全文在 title 里）
      updateNote === null
        ? null
        : h('span', {
          className: 'dgp-update-note',
          'data-update-note': updateNote.tone,
          'data-tone': updateNote.tone,
          title: updateNote.text
        }, updateNote.text),
      h('button', {
        type: 'button',
        className: 'dgp-version',
        title: versionTitle,
        'aria-label': t('toolbar.checkUpdates'),
        'data-action': 'check-updates',
        'data-busy': updateState.busy ? 'true' : undefined,
        disabled: activeRoot === null || activeRoot.isGit === false,
        onClick: checkUpdates
      }, h(Icon, { name: 'sync', size: 13 }), h('span', { className: 'dgp-version-text' }, versionText)),
      h('button', {
        type: 'button',
        className: 'dgp-iconbtn',
        title: remoteWebUrl === null ? t('update.noRemote') : t('toolbar.openRemote'),
        'aria-label': t('toolbar.openRemote'),
        'data-action': 'open-remote',
        disabled: remoteWebUrl === null,
        onClick: openRemote
      }, h(Icon, { name: 'external', size: 15 })),
      h('button', {
        type: 'button',
        className: 'dgp-iconbtn',
        title: t('settings.open'),
        'aria-label': t('settings.open'),
        'data-action': 'open-settings',
        onClick: openSettings
      }, h(Icon, { name: 'settings', size: 15 })),
      h('button', {
        type: 'button',
        className: 'dgp-iconbtn',
        title: t('toolbar.more'),
        'aria-expanded': moreOpen ? 'true' : 'false',
        onClick: () => {
          const node = moreAnchorRef.current
          setMoreAnchorRect(node === null ? null : node.getBoundingClientRect())
          setMoreOpen((previous) => !previous)
        },
        ref: moreAnchorRef
      }, h(Icon, { name: 'more', size: 15 }))))

  const filterRow = h('div', { className: 'dgp-filter' },
    h('div', { className: 'dgp-search' },
      h(Icon, { name: 'search', size: 13 }),
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
            if (event.target && event.target.blur) event.target.blur()
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
          'data-active': selection.side === 'unstaged' ? 'true' : undefined,
          title: t('group.unstaged'),
          onClick: () => switchSide('unstaged')
        }, t('group.unstaged')),
        h('button', {
          type: 'button',
          className: 'dgp-seg-btn',
          'data-active': selection.side === 'staged' ? 'true' : undefined,
          title: t('group.staged'),
          onClick: () => switchSide('staged')
        }, t('group.staged')))
      : null)

  const stagedCount = status !== null && status.counts !== null && status.counts !== undefined
    ? status.counts.staged
    : 0
  /** 只要有改动就能提交（没有暂存时提交会先把全部改动暂存）。 */
  const changeCount = status !== null && status.counts !== null && status.counts !== undefined
    ? status.counts.total
    : 0

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
        }, t('mode.files'))],
        t
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
          onTrackBranch: trackBranchAt,
          onCreateBranch: createBranch,
          t
        }),
        h(CommitBox, {
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
          t
        }),
        h(ChangesList, {
          status,
          loading: statusLoading && status === null,
          error: null,
          view: changesView,
          untrackedMode,
          selectedPath,
          onSelect: selectEntry,
          filter,
          onFilterChange: setFilter,
          collapsedGroups,
          onToggleGroup: toggleGroup,
          onStage: stageEntry,
          pendingPath: stagePending,
          onStageGroup: stageGroup,
          pendingGroup: stagePending,
          t
        }))
    }
  } else {
    leftPane = h(FileTree, {
      rootPath: browseRoot === null ? null : browseRoot.path,
      selectedPath,
      onSelectFile: selectFile,
      filter,
      onFilterChange: setFilter,
      loadDir,
      dirtyPaths,
      t
    })
  }

  let rightPane
  if (mode === MODE.remote && openPull !== null) {
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
      onDeepReview: deepReviewPull,
      onCloneForReview: cloneForReviewPull,
      projectRoot: project.projectRoot,
      // 深度审阅会拿这些仓库逐个比对 origin，命中就复用它的对象库（快很多）
      localRepoRoots: gitRoots.map((root) => root.path),
      onComment: commentPull,
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
    if (selection === null) {
      // 和 DiffView 用同一个容器壳，空态与有内容时的几何完全一致（居中，不贴左上角）
      rightPane = h('div', { className: 'dgp-viewer' },
        h(EmptyState, {
          icon: 'file-diff',
          title: t('viewer.placeholderDiff'),
          description: activeRoot === null ? t('status.noRootsHint') : undefined,
          t
        }))
    } else {
      rightPane = h(DiffView, {
        diff,
        loading: diffLoading,
        error: diffError,
        path: selection.path,
        entry: selection.entry,
        view: diffView,
        wrap: wrap === true && diffView === 'unified',
        onRetry: () => setDiffNonce((previous) => previous + 1),
        t
      })
    }
  } else if (selection === null) {
    rightPane = h('div', { className: 'dgp-viewer' },
      h(EmptyState, {
        icon: 'file',
        title: t('viewer.placeholder'),
        description: activeRoot === null ? t('status.noRootsHint') : undefined,
        t
      }))
  } else {
    const path = selection.path
    const draft = drafts.get(path)
    const conflict = saveState.conflict !== null && saveState.conflict !== undefined && saveState.conflict.path === path
      ? saveState.conflict
      : null
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
    icon: 'unified',
    label: t('toolbar.unified'),
    checked: diffView === 'unified',
    onClick: () => {
      setDiffView('unified')
      setMoreOpen(false)
    }
  }),
  h(MenuItem, {
    icon: 'split',
    label: t('toolbar.split'),
    checked: diffView === 'split',
    onClick: () => {
      setDiffView('split')
      setMoreOpen(false)
    }
  }),
  h(MenuItem, {
    icon: 'wrap',
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
    icon: 'filter',
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
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-valuenow': leftWidth,
    'data-dragging': dragging ? 'true' : undefined,
    tabIndex: 0,
    title: 'Drag to resize',
    onPointerDown: beginDrag,
    onKeyDown: (event) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setLeftWidth(Math.max(MIN_LEFT, leftWidth - 16))
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        setLeftWidth(leftWidth + 16)
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
  if (noSession) {
    content = h(EmptyState, { icon: 'warning', title: t('status.noSession'), t })
  } else if (rootsLoading && roots.length === 0) {
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
      }, t('action.retry'))],
      t
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
      }, t('action.retry'))],
      t
    })
  } else {
    content = body
  }

  if (showSettings) {
    content = h(SettingsView, {
      models: settingsState.models,
      commitModel: settingsState.commitModel,
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
    'data-narrow': isNarrow ? 'true' : undefined,
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
        onClick: () => refreshStatus()
      }, t('action.retry')))
    : null,
  content,
  moreMenu)
}
