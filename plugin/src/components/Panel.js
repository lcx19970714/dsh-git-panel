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
import { RootPicker } from './RootPicker.js'
import { RepoList } from './RepoList.js'
import { ChangesList } from './ChangesList.js'
import { FileTree } from './FileTree.js'
import { DiffView } from './DiffView.js'
import { FileEditor } from './FileEditor.js'
import { EmptyState, LoadingState, InlineNote } from './States.js'
import { CommitBox } from './CommitBox.js'
import { SettingsView } from './SettingsView.js'
import { MODE, usePref, useLatestGuard } from '../store.js'
import * as api from '../api.js'
import { reconcileSelection } from '../util/changes.js'
import { webUrlOf } from '../util/remote.js'
import { formatClock } from '../util/time.js'

const POLL_INTERVAL_MS = 8000
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

  /* ------------------------------- 根 ------------------------------- */
  const [project, setProject] = useState({ projectRoot: null, roots: [], warnings: [] })
  const [activeRootId, setActiveRootId] = useState(null)
  const [rootsLoading, setRootsLoading] = useState(true)
  const [rootsError, setRootsError] = useState(null)
  const [addingRoot, setAddingRoot] = useState(false)

  const roots = project.roots
  /** 真正的仓库（排除只有文件浏览能力的「浏览根」）。变更模式只看这些。 */
  const gitRoots = useMemo(() => roots.filter((root) => root.isGit === true), [roots])
  const activeRoot = roots.find((root) => root.id === activeRootId) ?? roots[0] ?? null
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
  const [commitNote, setCommitNote] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsState, setSettingsState] = useState({ loading: false, models: [], commitModel: null, error: null, saved: false })

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
    if (mode !== MODE.files || activeRoot === null || selection === null) return
    const path = selection.path
    const draft = draftsRef.current.get(path)
    if (draft === undefined) return
    if (force !== true && draft.text === draft.savedText) return

    const token = saveSeq.begin()
    setSaveState((previous) => ({ ...previous, busy: true, error: null }))
    const body = { rootPath: activeRoot.path, path, text: draft.text, eol: draft.eol, bom: draft.bom }
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
  }, [mode, activeRoot, selection, saveSeq, refreshStatus])

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
    api.readFile({ rootPath: activeRoot.path, path }, { signal: controller.signal })
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
  }, [mode, selection, activeRootId, fileSeq, fileNonce])

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
    if (scope !== 'stage-unstaged' && scope !== 'stage-untracked' && scope !== 'unstage') return
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
      setCommitNote({ tone: 'info', text: tRef.current('commit.done', { head: result.head }) })
      await refreshStatus()
      setDiffNonce((previous) => previous + 1)
    } catch (error) {
      setCommitNote({ tone: 'error', text: api.describeError(error, tRef.current) })
    } finally {
      setCommitBusy(false)
    }
  }, [activeRoot, commitMessage, commitBusy, refreshStatus])

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

  /** 打开设置页：同时拉模型目录和当前设置。 */
  const openSettings = useCallback(async () => {
    setShowSettings(true)
    setSettingsState({ loading: true, models: [], commitModel: null, error: null, saved: false })
    try {
      const [catalog, settings] = await Promise.all([api.listModels({}), api.readSettings({})])
      setSettingsState({ loading: false, models: catalog.models, commitModel: settings.commitModel, error: null, saved: false })
    } catch (error) {
      setSettingsState({ loading: false, models: [], commitModel: null, error: api.describeError(error, tRef.current), saved: false })
    }
  }, [])

  /** 选择模型即保存。空值表示清除。 */
  const changeCommitModel = useCallback(async (ref) => {
    const commitModel = ref === '' ? null : ref
    setSettingsState((previous) => ({ ...previous, commitModel, saved: false, error: null }))
    try {
      const saved = await api.writeSettings({ commitModel })
      setSettingsState((previous) => ({ ...previous, commitModel: saved.commitModel, saved: true }))
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
    setAddingRoot(true)
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
    } finally {
      setAddingRoot(false)
    }
  }, [])

  const removeExternalRoot = useCallback(async (root) => {
    const projectRoot = projectRef.current.projectRoot
    if (root === null || typeof projectRoot !== 'string') return
    setAddingRoot(true)
    try {
      const value = await api.removeRoot({ projectRoot, path: root.path })
      const nextRoots = value.roots
      setProject({ projectRoot: value.projectRoot, roots: nextRoots, warnings: value.warnings })
      setActiveRootId((previous) => (
        previous === root.id ? (nextRoots.length > 0 ? nextRoots[0].id : null) : previous
      ))
    } catch (error) {
      setRootsError(api.describeError(error, tRef.current))
    } finally {
      setAddingRoot(false)
    }
  }, [])

  const loadDir = useCallback(async (relPath, signal) => {
    const root = activeRootRef.current
    if (root === null) return { entries: [], truncated: false }
    return api.listDirectory({ rootPath: root.path, path: relPath ?? '' }, { signal })
  }, [])

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

  // 变更模式的仓库切换在「储存库」列表里；文件模式的浏览根仍用顶栏选择器。
  const toolbar = h('div', { className: 'dgp-toolbar' },
    h('div', { className: 'dgp-tbar-row' },
      mode === MODE.files
        ? h(RootPicker, {
          roots,
          activeRootId: activeRoot === null ? null : activeRoot.id,
          projectRoot: project.projectRoot,
          onSelect: selectRoot,
          onAdd: addExternalRoot,
          onRemove: removeExternalRoot,
          busy: addingRoot,
          t
        })
        : null,
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
        }, t('mode.files'))),
      h('div', { className: 'dgp-spacer' }),
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

  let leftPane
  if (mode === MODE.changes) {
    if (gitRoots.length === 0) {
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
          roots: gitRoots,
          activeRootId: activeRoot === null ? null : activeRoot.id,
          open: repositoriesOpen === true,
          onToggleOpen: () => setRepositoriesOpen(repositoriesOpen !== true),
          onSelect: selectRoot,
          onAdd: addExternalRoot,
          onRemove: removeExternalRoot,
          t
        }),
        h(CommitBox, {
          message: commitMessage,
          stagedCount,
          busy: commitBusy,
          generating: commitGenerating,
          onChange: setCommitMessage,
          onCommit: commitStaged,
          onGenerate: generateMessage,
          t
        }),
        commitNote === null
          ? null
          : h('div', { className: 'dgp-notebar', 'data-commit-note': commitNote.tone },
            h(InlineNote, { tone: commitNote.tone }, commitNote.text)),
        h(ChangesList, {
          status,
          loading: statusLoading && status === null,
          error: null,
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
      rootPath: activeRoot === null ? null : activeRoot.path,
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
  if (mode === MODE.changes) {
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
  h('div', { className: 'dgp-pane-right' }, rightPane))

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
      loading: settingsState.loading,
      error: settingsState.error,
      saved: settingsState.saved,
      onChangeModel: changeCommitModel,
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
  updateNote === null
    ? null
    : h('div', { className: 'dgp-notebar', 'data-update-note': updateNote.tone },
      h(InlineNote, { tone: updateNote.tone }, updateNote.text)),
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
