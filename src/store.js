/**
 * src/store.js —— 显示偏好 + 每个工作区记住的选中项 + 两个通用 hook
 *
 * 放两类「跨会话应该记住」的东西：
 *   · 显示偏好（mode/diffView/leftWidth…）：全局一份，见 usePref；
 *   · 每个工作区自己的选中项（目前是「远端」页签选中的账号）：按项目根分开记，
 *     见 readRemoteAccount / saveRemoteAccount。
 * status/diff 数据与文件/仓库选中项都是每次重新取的组件状态，不进这里。
 *
 * 都存在 localStorage 里；读取时只做「结构校验 + 数值钳制」，
 * 保证手改/旧版本残留的坏数据不会把面板布局搞坏。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from './platform.js'

export const MODE = { changes: 'changes', files: 'files', remote: 'remote' }

/** 三个页签的顺序（工具条与偏好校验共用）。 */
export const MODES = [MODE.changes, MODE.files, MODE.remote]

const STORAGE_KEY = 'dsh-git-panel:prefs:v1'

const DEFAULTS = {
  mode: MODE.changes,
  diffView: 'unified',
  wrap: false,
  contextLines: 3,
  ignoreWhitespace: false,
  autoRefresh: true,
  leftWidth: 264,
  collapsedGroups: {},
  /** 「储存库」区域的展开状态（只在有多个仓库时出现）。 */
  repositoriesOpen: true,
  /** 变更列表显示方式：list = 一行一个文件（文件名 + 弱化路径），tree = 按文件夹展开。 */
  changesView: 'list',
  /** 未跟踪文件：merge = 并进「未暂存」（VS Code 行为），separate = 单列「未跟踪」组。 */
  untrackedMode: 'merge'
}

/** 未跟踪文件的两种呈现方式（设置页与分组逻辑共用）。 */
export const UNTRACKED_MODES = ['merge', 'separate']

/** 变更列表的两种显示方式（设置页与 ⋯ 菜单共用）。 */
const CHANGES_VIEWS = ['list', 'tree']

const GROUPS = ['conflicted', 'staged', 'unstaged', 'untracked']

/** 把任意输入收敛成合法的偏好对象。 */
function sanitize(input) {
  const out = { ...DEFAULTS }
  if (MODES.includes(input.mode)) out.mode = input.mode
  if (input.diffView === 'unified' || input.diffView === 'split') out.diffView = input.diffView
  if (typeof input.wrap === 'boolean') out.wrap = input.wrap
  if (typeof input.ignoreWhitespace === 'boolean') out.ignoreWhitespace = input.ignoreWhitespace
  if (typeof input.autoRefresh === 'boolean') out.autoRefresh = input.autoRefresh
  if (Number.isFinite(input.contextLines)) {
    out.contextLines = Math.min(20, Math.max(0, Math.round(input.contextLines)))
  }
  if (Number.isFinite(input.leftWidth)) {
    out.leftWidth = Math.min(720, Math.max(180, Math.round(input.leftWidth)))
  }
  if (typeof input.repositoriesOpen === 'boolean') out.repositoriesOpen = input.repositoriesOpen
  if (CHANGES_VIEWS.includes(input.changesView)) out.changesView = input.changesView
  if (UNTRACKED_MODES.includes(input.untrackedMode)) out.untrackedMode = input.untrackedMode
  if (input.collapsedGroups && typeof input.collapsedGroups === 'object') {
    const groups = {}
    for (const key of GROUPS) if (input.collapsedGroups[key] === true) groups[key] = true
    out.collapsedGroups = groups
  }
  return out
}

function loadPrefs() {
  let raw = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return { ...DEFAULTS }
  }
  if (raw === null) return { ...DEFAULTS }
  try {
    return sanitize(JSON.parse(raw))
  } catch {
    return { ...DEFAULTS }
  }
}

function savePrefs(patch) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadPrefs(), ...patch }))
  } catch {
    /* 隐私模式/配额满时静默：偏好存不下不影响当前会话 */
  }
}

/**
 * 一个会持久化到 localStorage 的 state。
 * @param {string} key DEFAULTS 的键
 */
export function usePref(key) {
  const [value, setValue] = useState(() => loadPrefs()[key])
  const set = useCallback((next) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next
      savePrefs({ [key]: resolved })
      return resolved
    })
  }, [key])
  return [value, set]
}

/* ==================== 每个工作区记住的远端账号 ==================== */

/**
 * 「远端」页签的账号是**按工作区**记的，不是全局偏好。
 *
 * 为什么必须按工作区：代码托管账号列表是全局的（DSH 凭据服务里一份），
 * 但每个项目日常用的账号往往不同（工作号 / 私人号 / 内网 Gitee）。
 * 如果只存在组件状态里，切到别的工作区再回来、或者重新打开面板，都会退回
 * 账号列表的第一个 —— 用户每切一次就要重选一次。
 *
 * 落盘形状（独立 key，不和显示偏好共用，任一份格式变化不牵连另一份）：
 *   { "version": 1, "workspaces": { "<规范化项目根>": { "remoteAccount": "github:alice" } } }
 *
 * 只存账号 id（`provider:login`），不存任何令牌；读的时候逐条结构校验，
 * 手改坏的数据只会让对应工作区回到默认（第一个账号），绝不抛异常。
 */
const WORKSPACE_STORAGE_KEY = 'dsh-git-panel:workspaces:v1'
const WORKSPACE_VERSION = 1

/**
 * 工作区标识 = 规范化后的项目根。
 *
 * 正斜杠、去尾斜杠；盘符路径与 UNC 路径（Windows）不区分大小写，统一小写，
 * 避免同一个目录因为 `C:/Work` 与 `c:/work` 被记成两个工作区。
 * 宿主下发的 projectRoot 已经是正斜杠绝对路径，这里只负责兜住不同来源的写法。
 *
 * @param {string|null|undefined} projectRoot
 * @returns {string|null} 无法得到稳定标识时返回 null（调用方按「没有记忆」处理）
 */
export function workspaceKeyOf(projectRoot) {
  if (typeof projectRoot !== 'string') return null
  let key = projectRoot.trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (key === '') return null
  if (/^[a-zA-Z]:\//.test(key) || key.startsWith('//')) key = key.toLowerCase()
  return key
}

/** 读整份工作区记忆；任何异常/坏形状都收敛成空对象。 */
function readWorkspaceState() {
  let raw = null
  try {
    raw = localStorage.getItem(WORKSPACE_STORAGE_KEY)
  } catch {
    return {}
  }
  if (raw === null) return {}
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  // 版本不认识就当没有：未来格式由未来的代码迁移，宁可回默认也别按旧结构硬读
  if (parsed.version !== WORKSPACE_VERSION) return {}
  const map = parsed.workspaces
  if (map === null || typeof map !== 'object' || Array.isArray(map)) return {}
  const out = {}
  for (const [key, value] of Object.entries(map)) {
    if (typeof key !== 'string' || key === '') continue
    if (value === null || typeof value !== 'object' || Array.isArray(value)) continue
    if (typeof value.remoteAccount !== 'string' || value.remoteAccount === '') continue
    out[key] = { remoteAccount: value.remoteAccount }
  }
  return out
}

/** 写整份工作区记忆；存不下（隐私模式/配额满）时静默 —— 记不住不影响当前会话。 */
function writeWorkspaceState(map) {
  try {
    localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify({ version: WORKSPACE_VERSION, workspaces: map }))
  } catch {
    /* ignore */
  }
}

/**
 * 某个工作区上次在「远端」页签选中的账号 id。
 * @param {string|null|undefined} projectRoot
 * @returns {string|null} 没有记录 / 记录不可用时返回 null
 */
export function readRemoteAccount(projectRoot) {
  const key = workspaceKeyOf(projectRoot)
  if (key === null) return null
  const entry = readWorkspaceState()[key]
  return entry === undefined ? null : entry.remoteAccount
}

/**
 * 记住某个工作区在「远端」页签选中的账号。
 * 幂等：值没变就不写盘（避免每次渲染都碰 localStorage）。
 * @param {string|null|undefined} projectRoot
 * @param {string|null|undefined} accountId 账号 id（`provider:login`）；空值表示不记
 */
export function saveRemoteAccount(projectRoot, accountId) {
  const key = workspaceKeyOf(projectRoot)
  if (key === null || typeof accountId !== 'string' || accountId === '') return
  const map = readWorkspaceState()
  const previous = map[key]
  if (previous !== undefined && previous.remoteAccount === accountId) return
  map[key] = { remoteAccount: accountId }
  writeWorkspaceState(map)
}

/**
 * 只保留最新一次异步结果的守护器。
 *
 * 返回对象必须**引用稳定**：调用方普遍写成
 *   const refresh = useCallback(..., [guard]);  useEffect(..., [refresh])
 * 每次返回新对象会让 refresh 每次渲染都变，effect 就会每渲染重跑 ——
 * 那会变成「取数 → 渲染 → 再取数」的死循环。
 */
export function useLatestGuard() {
  const seqRef = useRef(0)
  const begin = useCallback(() => {
    seqRef.current += 1
    return seqRef.current
  }, [])
  const isLatest = useCallback((token) => token === seqRef.current, [])
  return useMemo(() => ({ begin, isLatest }), [begin, isLatest])
}
