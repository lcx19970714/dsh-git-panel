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

/** 单个文件归属的分组；冲突文件只进「冲突」组（与 VSCode 的 Merge Changes 一致）。 */
export function groupsOfFile(file) {
  if (file === null || file === undefined || typeof file !== 'object') return []
  if (file.conflicted === true) return ['conflicted']
  const out = []
  if (file.staged === true) out.push('staged')
  if (file.unstaged === true) out.push('unstaged')
  if (file.untracked === true) out.push('untracked')
  return out
}

/**
 * 把 `status.files` 拆成 4 个固定顺序的分组，空分组丢弃。
 *
 * 同一个文件可以同时出现在多个分组里（`MM` = 已暂存 + 未暂存），
 * 因为右侧 diff 要看哪一侧取决于用户点的是哪一组的行。
 *
 * @param {Array<{path: string, staged?: boolean, unstaged?: boolean, untracked?: boolean, conflicted?: boolean}>} files
 * @returns {Array<{key: 'conflicted'|'staged'|'unstaged'|'untracked', entries: object[]}>}
 */
export function groupChanges(files) {
  const list = Array.isArray(files) ? files : []
  const buckets = new Map()
  for (const key of GROUP_ORDER) buckets.set(key, [])
  for (const file of list) {
    for (const key of groupsOfFile(file)) {
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

/** 分组里只有一个文件时，直接渲染成文件行（不造目录行）：返回那个条目，否则 null。 */
export function singleFileShortcut(entries) {
  const list = Array.isArray(entries) ? entries : []
  return list.length === 1 ? list[0] : null
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
 * 宿主 `tree/list` 返回的 `path` 是「相对被列举目录」的名字（见 host/git.js listDirectory），
 * 但也允许调用方提前拼好根相对路径；两种都兼容。
 *
 * @param {string} parentRel 父目录的相对路径（'' = 根）
 * @param {{name?: string, path?: string}} entry
 */
export function childPath(parentRel, entry) {
  const parent = normalizeRelPath(parentRel)
  let raw = ''
  if (entry !== null && entry !== undefined && typeof entry === 'object') {
    if (typeof entry.path === 'string' && entry.path !== '') raw = entry.path
    else if (typeof entry.name === 'string') raw = entry.name
  }
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
 * status 刷新后校正当前选中项。
 *
 * 选中项有两种语义，不能混为一谈：
 *  · 来自变更列表（`entry !== null`）——代表"某个变更"。文件从 status 里消失（被还原/被提交）
 *    就该清掉选中；还在就换成最新一次 status 里的 entry（diff 会据此重取）。
 *  · 来自文件浏览树（`entry === null`）——代表"某个路径"。它跟 status 无关（未修改的文件本来
 *    就不在 status.files 里），所以刷新时必须原样返回，否则会凭空清空正在浏览的文件。
 *
 * @param {{path: string, entry: object|null, side: string}|null} selection
 * @param {Array<object>} files status.files
 * @returns {object|null} 新的选中项，或 null（该清空）
 */
export function reconcileSelection(selection, files) {
  if (selection === null) return null
  if (selection.entry === null) return selection
  const entry = files.find((file) => file.path === selection.path)
  if (entry === undefined) return null
  return { path: entry.path, entry, side: selection.side }
}