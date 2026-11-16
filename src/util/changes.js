/**
 * src/util/changes.js —— 「变更」分组与树行构造的纯函数
 *
 * 这里只放**纯逻辑**：不依赖 react、不依赖 DOM、不碰宿主桥接。
 * 这样 `plugin/test/tree.test.mjs` 可以直接 `import` 本文件在 Node 里单测，
 * 而 ChangesList（「变更」树）/ FileTree（「文件」树）只负责把它们渲染成 DOM。
 *
 * 约定：
 * - 所有路径都是「正斜杠、无前导斜杠」的仓库内相对路径（见 util/paths.js 文件头）。
 * - 入参一律做防御：可能拿到 null / undefined / 非数组（宿主或测试给不到数据）。
 */
import { basename, buildTree, flattenTree, matchesFilter, naturalCompare, parentChain } from './paths.js'

/** 分组固定顺序：冲突 → 已暂存 → 未暂存 → 未跟踪（与 i18n 的 group.* 键一一对应）。 */
export const GROUP_ORDER = ['conflicted', 'staged', 'unstaged', 'untracked']

/**
 * 未跟踪文件的呈现方式：
 *   merge    —— 并进「未暂存」（VS Code 的默认行为，「Changes」里同时有改动和新文件）
 *   separate —— 单列「未跟踪」组
 */
const UNTRACKED_MODES = ['merge', 'separate']

/** 单个文件归属的分组；冲突文件只进「冲突」组（与 VSCode 的 Merge Changes 一致）。 */
export function groupsOfFile(file, untrackedMode = 'merge') {
  if (file === null || file === undefined || typeof file !== 'object') return []
  if (file.conflicted === true) return ['conflicted']
  const out = []
  if (file.staged === true) out.push('staged')
  if (file.unstaged === true) out.push('unstaged')
  if (file.untracked === true) out.push(untrackedMode === 'merge' ? 'unstaged' : 'untracked')
  return out
}

/**
 * 把 `status.files` 拆成 4 个固定顺序的分组，空分组丢弃。
 *
 * 同一个文件可以同时出现在多个分组里（`MM` = 已暂存 + 未暂存），
 * 因为右侧 diff 要看哪一侧取决于用户点的是哪一组的行。
 *
 * @param {Array<{path: string, staged?: boolean, unstaged?: boolean, untracked?: boolean, conflicted?: boolean}>} files
 * @param {{untrackedMode?: 'merge'|'separate'}} [options] 未跟踪文件是并进未暂存还是单列一组
 * @returns {Array<{key: 'conflicted'|'staged'|'unstaged'|'untracked', entries: object[]}>}
 */
export function groupChanges(files, options = {}) {
  const untrackedMode = options.untrackedMode === 'separate' ? 'separate' : 'merge'
  const list = Array.isArray(files) ? files : []
  const buckets = new Map()
  for (const key of GROUP_ORDER) buckets.set(key, [])
  for (const file of list) {
    for (const key of groupsOfFile(file, untrackedMode)) {
      const bucket = buckets.get(key)
      if (bucket !== undefined) bucket.push(file)
    }
  }
  const out = []
  for (const key of GROUP_ORDER) {
    const entries = buckets.get(key)
    if (entries !== undefined && entries.length > 0) out.push({ key, entries })
  }
  return out
}

/**
 * 一行该放哪个索引操作按钮。
 *
 * 规则跟 VS Code 的 SCM 行一致，并且**只由所在分组决定**（同一文件可以同时出现在两组）：
 *   staged             → unstage（减号，取消暂存，文件回到未暂存）
 *   unstaged/untracked → stage（加号，暂存，文件进入已暂存）
 *   conflicted         → null（冲突要先解决再暂存，行上不给一键操作）
 * 其它分组一律 null，调用方据此不渲染按钮。
 */
export function rowActionOf(groupKey) {
  if (groupKey === 'staged') return 'unstage'
  if (groupKey === 'unstaged' || groupKey === 'untracked') return 'stage'
  return null
}

/**
 * 这一行能不能「退回改动」，以及退回的是哪一种（VS Code 的行为）：
 *
 *  · 只有未暂存 / 未跟踪的行能退回 —— 能与「暂存」共存的那个位置，就是工作区的那一半；
 *    已暂存的那一行对应的是索引，它的动作是「取消暂存」，不是退回。
 *  · 冲突文件不给：退回会把冲突标记一起抹掉，正确做法是先解决冲突。
 *  · 未跟踪文件退回 = **删除它**（它没有 HEAD 版本可回），确认文案必须说清这一点。
 *
 * 返回 `'revert'`（工作区回到索引）、`'delete'`（删除未跟踪文件）或 `null`（不提供）。
 */
export function rowDiscardKind(entry, groupKey) {
  if (rowActionOf(groupKey) !== 'stage') return null
  return entry !== null && entry !== undefined && entry.untracked === true ? 'delete' : 'revert'
}

/**
 * 分组头右侧的批量操作。与行尾按钮同一套规则，作用范围是**整组**，
 * 所以必须跟着分组内容走：
 *   staged    → unstage（取消暂存全部已暂存）
 *   unstaged  → 合并模式：组里还有未跟踪文件 → stage-all（全部加进来）
 *               分开模式：组里只有已跟踪改动 → stage-unstaged（git add -u）
 *   untracked → stage-untracked（只暂存未跟踪文件）
 *   conflicted → null
 */
export function groupActionOf(groupKey, untrackedMode = 'merge') {
  if (groupKey === 'staged') return 'unstage'
  if (groupKey === 'unstaged') return untrackedMode === 'merge' ? 'stage-all' : 'stage-unstaged'
  if (groupKey === 'untracked') return 'stage-untracked'
  return null
}

/** 分组里只有一个文件时，直接渲染成文件行（不造目录行）：返回那个条目，否则 null。 */
export function singleFileShortcut(entries) {
  return entries.length === 1 ? entries[0] : null
}

/** 路径归一化：反斜杠 → 正斜杠、去掉前导 `./`、去掉末尾斜杠。 */
export function normalizeRelPath(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\\/g, '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/+$/, '')
}

/**
 * 算出子项相对浏览根的路径。
 *
 * 宿主 `tree/list` 只返回条目名（相对被列举目录），这里拼上父路径就是根相对路径。
 *
 * @param {string} parentRel 父目录的相对路径（'' = 根）
 * @param {{name?: string}} entry
 */
export function childPath(parentRel, entry) {
  const parent = normalizeRelPath(parentRel)
  const raw = entry !== null && entry !== undefined && typeof entry.name === 'string' ? entry.name : ''
  const rel = normalizeRelPath(raw)
  if (rel === '') return parent
  if (parent === '') return rel
  if (rel === parent || rel.startsWith(parent + '/')) return rel
  return parent + '/' + rel
}

/** 单个条目是否命中过滤词：文件名 / 完整路径 / 重命名前路径，任一命中即可。 */
export function matchesEntry(entry, filter) {
  if (entry === null || entry === undefined || typeof entry !== 'object') return false
  if (filter === undefined || filter === null || filter === '') return true
  if (matchesFilter(entry.path, filter)) return true
  if (typeof entry.name === 'string' && matchesFilter(entry.name, filter)) return true
  if (typeof entry.oldPath === 'string' && entry.oldPath !== '' && matchesFilter(entry.oldPath, filter)) return true
  return false
}

/** 过滤条目；`filter` 为空串时**不过滤**（返回全部，而不是全部过滤掉）。 */
export function filterEntries(entries, filter) {
  const list = Array.isArray(entries) ? entries : []
  if (filter === undefined || filter === null || filter === '') return list.slice()
  return list.filter((entry) => matchesEntry(entry, filter))
}

/** 构造一条文件行（与 flattenTree 输出的行形状保持一致）。 */
function fileRow(entry, depth) {
  const path = normalizeRelPath(entry === null || entry === undefined ? '' : entry.path)
  const name = basename(path)
  return {
    kind: 'file',
    node: { name, path, type: 'file', children: [], entry },
    displayName: name,
    path,
    depth
  }
}

/**
 * 把一个分组的条目压成可直接渲染的行数组（已折叠单子节点目录链）。
 *
 * - 分组只有 1 个条目 → 直接一行文件（depth 0），不造目录行。
 * - 其它情况 → `buildTree` + `flattenTree`（后者内部调用 `compactChain`），
 *   `a/b/c` 这种单链会合并成一行显示。
 *
 * @param {object[]} entries
 * @param {(dirPath: string) => boolean} isExpanded 目录是否展开
 * @returns {Array<{kind:'dir'|'file', path: string, depth: number, displayName: string}>}
 */
export function buildGroupRows(entries, isExpanded) {
  const list = Array.isArray(entries) ? entries : []
  const only = singleFileShortcut(list)
  if (only !== null) return [fileRow(only, 0)]
  const { nodes } = buildTree(list)
  const expanded = typeof isExpanded === 'function' ? isExpanded : () => false
  return flattenTree(nodes, expanded)
}

/**
 * 把一个分组的条目压成**扁平行**（列表模式：不造目录行，一行一个文件）。
 *
 * 文件名是主体，父路径在行内弱化显示（VS Code 的 List 视图）。
 * 排序按完整路径的自然序，同一目录的文件相邻。
 *
 * @param {object[]} entries
 * @returns {Array<{kind:'file', path: string, depth: number, displayName: string}>}
 */
export function buildListRows(entries) {
  const list = Array.isArray(entries) ? entries : []
  const rows = []
  for (const entry of list) {
    if (entry === null || entry === undefined || typeof entry.path !== 'string' || entry.path === '') continue
    rows.push(fileRow(entry, 0))
  }
  rows.sort((left, right) => naturalCompare(left.path, right.path))
  return rows
}

/**
 * 选中文件所在分组里，需要展开的目录链（用于「自动展开到选中项」）。
 * 分组只有 1 个条目时没有目录行，返回空数组。
 *
 * @param {object[]} entries
 * @param {string} targetPath
 * @returns {string[]} 目录相对路径，由浅到深
 */
export function ancestorsFor(entries, targetPath) {
  const list = Array.isArray(entries) ? entries : []
  const target = normalizeRelPath(targetPath)
  if (target === '' || list.length <= 1) return []
  const { byPath } = buildTree(list)
  const out = []
  for (const dirPath of parentChain(target)) {
    const node = byPath.get(dirPath)
    if (node !== undefined && node !== null && node.type === 'dir') out.push(node.path)
  }
  return out
}

/** 目录下的文件数（目录行的计数提示）。`dirPath` 为空 = 整个分组。 */
export function countFilesUnder(entries, dirPath) {
  const list = Array.isArray(entries) ? entries : []
  const dir = normalizeRelPath(dirPath)
  const prefix = dir === '' ? '' : dir + '/'
  let count = 0
  for (const entry of list) {
    if (entry === null || entry === undefined || typeof entry.path !== 'string') continue
    const path = normalizeRelPath(entry.path)
    if (prefix === '' ? path !== '' : path.startsWith(prefix)) count += 1
  }
  return count
}

/** 目录列举结果的排序：目录优先，其次自然序（`file2` 在 `file10` 前）。 */
export function orderTreeEntries(entries) {
  const list = Array.isArray(entries) ? entries : []
  return list.slice().sort((left, right) => {
    const leftDir = left !== null && left !== undefined && left.type === 'dir'
    const rightDir = right !== null && right !== undefined && right.type === 'dir'
    if (leftDir !== rightDir) return leftDir ? -1 : 1
    return naturalCompare(nameOf(left), nameOf(right))
  })
}

function nameOf(entry) {
  if (entry === null || entry === undefined) return ''
  if (typeof entry.name === 'string' && entry.name !== '') return entry.name
  return normalizeRelPath(entry.path)
}

/**
 * status 刷新后校正当前选中项（只针对「变更」页签的选中项）。
 *
 * 选中项的 `side` 是「用户当时点的是哪一组」，但文件本身会移动（暂存、取消暂存、
 * 提交）。若刷新后还按旧 side 取 diff，宿主的 `git diff` 会返回空 —— 用户刚点完
 * 「暂存」，右栏却变成「无改动」。所以 side 必须按新条目的实际状态校正：
 * 原 side 仍成立就保留（MM 文件停在用户选的那一侧），否则落到仍然存在的那一侧。
 *
 * 「文件」页签的选中项是路径语义，不经过这里（两个页签的状态彼此独立）。
 *
 * @param {{rootPath: string, path: string, entry: object, side: string}|null} selection
 * @param {Array<object>} files status.files
 * @returns {{rootPath: string, path: string, entry: object, side: string}|null}
 */
export function reconcileSelection(selection, files) {
  if (selection === null) return null
  const entry = files.find((file) => file.path === selection.path)
  if (entry === undefined) return null
  return {
    rootPath: selection.rootPath,
    path: entry.path,
    entry,
    side: sideForEntry(entry, selection.side)
  }
}

/** 条目当前仍然成立的一侧；优先保留用户原来选的那一侧。 */
export function sideForEntry(entry, preferred) {
  if (preferred === 'staged' && entry.staged === true) return 'staged'
  if (preferred === 'untracked' && entry.untracked === true) return 'untracked'
  if (preferred === 'unstaged' && entry.unstaged === true) return 'unstaged'
  if (entry.unstaged === true) return 'unstaged'
  if (entry.staged === true) return 'staged'
  return 'untracked'
}

/**
 * status 的内容指纹：只要它没变，就没有任何理由让界面重新渲染、重新取 diff。
 *
 * 轮询每 8 秒回来一次，而 `status` 每次都是新对象。直接 `setStatus` 会让整张
 * 变更列表重渲染、让 selection 换成新对象、连带把 diff 重新取一遍 —— 什么都没变，
 * 只是又跑了一圈。指纹覆盖所有会被界面读到的事实（分支 / 同步态 / 每个文件的
 * 状态与行数），变了才落状态。
 */
export function statusSignature(status) {
  const parts = [
    status.repoRoot,
    status.branch,
    status.head,
    status.detached === true ? 'detached' : 'attached',
    status.ahead,
    status.behind,
    status.sync.state,
    status.sync.ahead,
    status.sync.behind,
    status.truncated === true ? 'truncated' : 'complete',
    String(status.counts.total)
  ]
  for (const file of status.files) {
    parts.push([
      file.path,
      file.status,
      file.staged === true ? 's' : '',
      file.unstaged === true ? 'u' : '',
      file.untracked === true ? '?' : '',
      file.conflicted === true ? 'c' : '',
      file.binary === true ? 'b' : '',
      file.adds,
      file.dels,
      file.oldPath ?? ''
    ].join('\u0001'))
  }
  return parts.join('\u0000')
}
