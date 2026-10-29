/**
 * src/util/paths.js —— 纯路径/显示工具
 *
 * 全部纯函数，不依赖 react 或 DOM，可以直接在 Node 里单测。
 * 约定：插件内部一切「仓库内相对路径」都是正斜杠、无前导斜杠。
 */

/** 取路径最后一段。 */
export function basename(p) {
  if (!p) return ''
  const clean = String(p).replace(/[\\/]+$/, '')
  const parts = clean.split(/[\\/]/)
  return parts[parts.length - 1] || ''
}

/** 取父路径（保留正斜杠）。 */
export function dirname(p) {
  if (!p) return ''
  const clean = String(p).replace(/\\/g, '/').replace(/\/+$/, '')
  const index = clean.lastIndexOf('/')
  return index === -1 ? '' : clean.slice(0, index)
}


/** 拆成段数组。 */
export function segments(p) {
  return String(p || '').replace(/\\/g, '/').split('/').filter(Boolean)
}

/** 从根到该路径的祖先链（不含自身）：'a/b/c' -> ['a', 'a/b']。 */
export function parentChain(relPath) {
  const parts = segments(relPath)
  const out = []
  for (let i = 1; i < parts.length; i += 1) out.push(parts.slice(0, i).join('/'))
  return out
}

/** 自然序、忽略大小写的比较。 */
export function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * 把一串路径压成树，并把「只有一个目录子节点」的链折叠成 `a/b/c`。
 *
 * @param {Array<{path: string} & Record<string, any>>} entries
 * @returns {{ nodes: TreeNode[], byPath: Map<string, TreeNode> }}
 *
 * TreeNode = {
 *   name: string, path: string, type: 'dir'|'file',
 *   children: TreeNode[], entry?: object, depth?: number
 * }
 */
export function buildTree(entries) {
  const root = { name: '', path: '', type: 'dir', children: [] }
  const byPath = new Map()

  for (const entry of entries) {
    const parts = segments(entry.path)
    if (parts.length === 0) continue
    let cursor = root
    for (let i = 0; i < parts.length - 1; i += 1) {
      const name = parts[i]
      const path = parts.slice(0, i + 1).join('/')
      let next = cursor.children.find((child) => child.type === 'dir' && child.name === name)
      if (next === undefined) {
        next = { name, path, type: 'dir', children: [] }
        cursor.children.push(next)
        byPath.set(path, next)
      }
      cursor = next
    }
    const fileName = parts[parts.length - 1]
    const filePath = parts.join('/')
    const fileNode = { name: fileName, path: filePath, type: 'file', children: [], entry }
    cursor.children.push(fileNode)
    byPath.set(filePath, fileNode)
  }

  sortTree(root)
  return { nodes: root.children, byPath }
}

function sortTree(node) {
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return naturalCompare(a.name, b.name)
  })
  for (const child of node.children) {
    if (child.children.length > 0) sortTree(child)
  }
}

/**
 * 把单链目录折叠：'src/a/b'（每层只有一个目录子节点）显示成一行。
 * @returns {{ displayName: string, node: TreeNode, chain: TreeNode[] }}
 */
export function compactChain(node) {
  const chain = [node]
  let cursor = node
  while (
    cursor.type === 'dir'
    && cursor.children.length === 1
    && cursor.children[0].type === 'dir'
  ) {
    cursor = cursor.children[0]
    chain.push(cursor)
  }
  const displayName = chain.map((item) => item.name).join('/')
  return { displayName, node: cursor, chain }
}

/** 扁平化树为渲染行（含每个节点的展开状态）。 */
export function flattenTree(nodes, isExpanded, depth = 0, out = []) {
  for (const node of nodes) {
    if (node.type === 'dir') {
      const { displayName, node: last, chain } = compactChain(node)
      out.push({ kind: 'dir', node: last, chain, displayName, path: last.path, depth })
      if (isExpanded(last.path)) flattenTree(last.children, isExpanded, depth + 1, out)
    } else {
      out.push({ kind: 'file', node, displayName: node.name, path: node.path, depth })
    }
  }
  return out
}

/** 收集树上所有目录路径（用于「全部折叠/展开」与自动展开到选中项）。 */
export function collectDirPaths(nodes, out = []) {
  for (const node of nodes) {
    if (node.type !== 'dir') continue
    const { node: last } = compactChain(node)
    out.push(last.path)
    collectDirPaths(last.children, out)
  }
  return out
}

/** 过滤：命中文件名或完整路径（不区分大小写）。 */
export function matchesFilter(relPath, filter) {
  if (!filter) return true
  const needle = String(filter).toLowerCase().trim()
  if (needle === '') return true
  return String(relPath).toLowerCase().includes(needle)
}


/** 数字格式化：1234 -> 1.2k。 */
export function formatCount(value) {
  const n = Number(value) || 0
  if (n < 1000) return String(n)
  if (n < 10_000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k'
  return Math.round(n / 1000) + 'k'
}

