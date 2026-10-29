/**
 * test/tree.test.mjs —— 「变更」树 / 「文件」树的纯逻辑单测
 *
 * 覆盖：
 *   1. `src/util/changes.js` 的分组规则（MM 文件同时进两组、冲突只进冲突组、单文件快捷键）
 *   2. 分组内压树 + 单链折叠（`buildGroupRows`，底层是 `util/paths.js` 的 buildTree/compactChain/flattenTree）
 *   3. 自动展开链（`ancestorsFor`）、目录文件数（`countFilesUnder`）、浏览树的路径拼接（`childPath`）
 *   4. 过滤（`filterEntries` / `matchesEntry` / `matchesFilter`）
 *   5. `util/paths.js` 里被这两个组件用到的纯函数（只读引用，不修改）
 *
 * 用法：node test/tree.test.mjs
 */
import assert from 'node:assert/strict'
import {
  GROUP_ORDER,
  ancestorsFor,
  buildGroupRows,
  childPath,
  countFilesUnder,
  filterEntries,
  groupChanges,
  groupsOfFile,
  matchesEntry,
  normalizeRelPath,
  orderTreeEntries,
  reconcileSelection,
  singleFileShortcut
} from '../src/util/changes.js'
import {
  basename,
  buildTree,
  collectDirPaths,
  compactChain,
  dirname,
  flattenTree,
  formatCount,
  matchesFilter,
  naturalCompare,
  parentChain,
} from '../src/util/paths.js'

const results = []
function test(name, fn) {
  results.push({ name, fn })
}

/** 造一个 FileEntry（字段形状见 CONTRACT.md §2）。 */
function entry(path, extra) {
  return {
    path,
    status: 'M',
    staged: false,
    unstaged: true,
    untracked: false,
    conflicted: false,
    oldPath: null,
    adds: 1,
    dels: 0,
    binary: false,
    ...(extra ?? {})
  }
}

/* ==========================================================================
   1. 分组规则
   ========================================================================== */

test('groupChanges：MM 文件同时出现在「已暂存」和「未暂存」', () => {
  const files = [
    entry('a.js', { unstaged: true }),
    entry('b.js', { staged: true, unstaged: true }),
    entry('c.js', { staged: true, unstaged: false, status: 'A' }),
    entry('u.js', { staged: false, unstaged: false, untracked: true, status: '?' })
  ]
  const groups = groupChanges(files)
  assert.deepEqual(groups.map((group) => group.key), ['staged', 'unstaged', 'untracked'])

  const byKey = new Map(groups.map((group) => [group.key, group.entries.map((item) => item.path)]))
  assert.deepEqual(byKey.get('staged'), ['b.js', 'c.js'])
  assert.deepEqual(byKey.get('unstaged'), ['a.js', 'b.js'])
  assert.deepEqual(byKey.get('untracked'), ['u.js'])
})

test('groupChanges：冲突文件只进「冲突」组，不再重复进 staged/unstaged', () => {
  // 宿主对 UU 会同时置 staged/unstaged=true（见 host/git.js makeEntry），这里必须去重
  const conflict = entry('k.js', { status: 'U', staged: true, unstaged: true, conflicted: true })
  assert.deepEqual(groupsOfFile(conflict), ['conflicted'])
  const groups = groupChanges([conflict, entry('normal.js')])
  assert.deepEqual(groups.map((group) => group.key), ['conflicted', 'unstaged'])
  assert.deepEqual(groups[0].entries.map((item) => item.path), ['k.js'])
})

test('groupChanges：固定顺序 conflicted → staged → unstaged → untracked，空分组丢弃', () => {
  const files = [
    entry('u.js', { untracked: true, staged: false, unstaged: false, status: '?' }),
    entry('s.js', { staged: true, unstaged: false }),
    entry('w.js', { unstaged: true }),
    entry('k.js', { conflicted: true, status: 'U' })
  ]
  const groups = groupChanges(files)
  assert.deepEqual(groups.map((group) => group.key), GROUP_ORDER)
  assert.deepEqual(GROUP_ORDER, ['conflicted', 'staged', 'unstaged', 'untracked'])
  // 空数组/无变更时不产生任何分组
  assert.deepEqual(groupChanges([]), [])
  // 防御：非数组入参
  assert.deepEqual(groupChanges(null), [])
  assert.deepEqual(groupChanges(undefined), [])
  assert.deepEqual(groupChanges({}), [])
})

test('groupChanges：未跟踪文件 staged/unstaged 都是 false 时只进未跟踪组', () => {
  const untracked = entry('new.txt', { staged: false, unstaged: false, untracked: true, status: '?' })
  const groups = groupChanges([untracked])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].key, 'untracked')
  assert.equal(groups[0].entries.length, 1)
})

/* ==========================================================================
   2. 单文件快捷键 + 压树/单链折叠
   ========================================================================== */

test('singleFileShortcut：只有 1 个条目时返回该条目，否则 null', () => {
  const one = entry('a/b/c.js')
  assert.equal(singleFileShortcut([one]), one)
  assert.equal(singleFileShortcut([]), null)
  assert.equal(singleFileShortcut([one, entry('d.js')]), null)
  assert.equal(singleFileShortcut(null), null)
})

test('buildGroupRows：分组只有 1 个文件时直接一行文件行（不造目录行）', () => {
  const rows = buildGroupRows([entry('src/util/deep/file.js')], () => false)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].kind, 'file')
  assert.equal(rows[0].depth, 0)
  assert.equal(rows[0].path, 'src/util/deep/file.js')
  assert.equal(rows[0].displayName, 'file.js')
  assert.equal(rows[0].node.entry.path, 'src/util/deep/file.js')
})

test('buildGroupRows：单子节点目录链折叠成 a/b/c 一行', () => {
  const entries = [entry('p/q/r/one.js'), entry('p/q/r/two.js')]
  const collapsed = buildGroupRows(entries, () => false)
  assert.equal(collapsed.length, 1, '折叠时只应看到一行目录')
  assert.equal(collapsed[0].kind, 'dir')
  assert.equal(collapsed[0].depth, 0)
  assert.equal(collapsed[0].displayName, 'p/q/r')
  assert.equal(collapsed[0].path, 'p/q/r')

  const expanded = buildGroupRows(entries, (dirPath) => dirPath === 'p/q/r')
  assert.equal(expanded.length, 3)
  assert.deepEqual(expanded.map((row) => row.kind), ['dir', 'file', 'file'])
  assert.deepEqual(expanded.map((row) => row.depth), [0, 1, 1])
  assert.deepEqual(expanded.slice(1).map((row) => row.path), ['p/q/r/one.js', 'p/q/r/two.js'])
})

test('buildGroupRows：目录优先、自然序（file2 在 file10 前），并支持逐层展开', () => {
  const entries = [
    entry('root10.js'),
    entry('root2.js'),
    entry('src/z.js'),
    entry('src/a.js'),
    entry('lib/index.js')
  ]
  const collapsed = buildGroupRows(entries, () => false)
  assert.deepEqual(collapsed.map((row) => row.displayName), ['lib', 'src', 'root2.js', 'root10.js'])
  assert.deepEqual(collapsed.map((row) => row.depth), [0, 0, 0, 0])

  const oneLevel = buildGroupRows(entries, (dirPath) => dirPath === 'src')
  assert.deepEqual(
    oneLevel.map((row) => row.kind + ':' + row.displayName),
    ['dir:lib', 'dir:src', 'file:a.js', 'file:z.js', 'file:root2.js', 'file:root10.js']
  )
  assert.deepEqual(oneLevel.map((row) => row.depth), [0, 0, 1, 1, 0, 0])
})

test('buildGroupRows：防御空入参', () => {
  assert.deepEqual(buildGroupRows(null, () => true), [])
  assert.deepEqual(buildGroupRows(undefined), [])
  assert.deepEqual(buildGroupRows([], () => true), [])
})

/* ==========================================================================
   3. 自动展开链 / 目录计数 / 浏览树路径
   ========================================================================== */

test('ancestorsFor：返回选中文件需要展开的祖先目录（由浅到深）', () => {
  const entries = [entry('src/a/b.js'), entry('src/c.js')]
  assert.deepEqual(ancestorsFor(entries, 'src/a/b.js'), ['src', 'src/a'])
  assert.deepEqual(ancestorsFor(entries, 'src/c.js'), ['src'])
  // 压缩链的「末端」也必须在结果里，否则 flattenTree 不会展开
  const chain = [entry('p/q/r/one.js'), entry('p/q/r/two.js')]
  assert.deepEqual(ancestorsFor(chain, 'p/q/r/one.js'), ['p', 'p/q', 'p/q/r'])
  // 单文件分组没有目录行
  assert.deepEqual(ancestorsFor([entry('src/a.js')], 'src/a.js'), [])
  // 目标不在本组
  assert.deepEqual(ancestorsFor(entries, 'other/x.js'), [])
  assert.deepEqual(ancestorsFor(entries, null), [])
})

test('countFilesUnder：目录行显示的文件数', () => {
  const entries = [entry('src/a.js'), entry('src/b/c.js'), entry('root.js')]
  assert.equal(countFilesUnder(entries, 'src'), 2)
  assert.equal(countFilesUnder(entries, 'src/b'), 1)
  assert.equal(countFilesUnder(entries, 'src/b/c.js'), 0)
  assert.equal(countFilesUnder(entries, ''), 3)
  assert.equal(countFilesUnder(null, 'src'), 0)
})

test('childPath：兼容「相对被列举目录」与「根相对」两种宿主返回', () => {
  assert.equal(childPath('', { name: 'src', path: 'src' }), 'src')
  assert.equal(childPath('src', { name: 'app.js', path: 'app.js' }), 'src/app.js')
  assert.equal(childPath('src', { name: 'app.js', path: 'src/app.js' }), 'src/app.js')
  assert.equal(childPath('src', { name: 'app.js', path: 'src\\app.js' }), 'src/app.js')
  assert.equal(childPath('src/deep', { name: 'x.js' }), 'src/deep/x.js')
  assert.equal(childPath('', {}), '')
  assert.equal(normalizeRelPath('./a/b/'), 'a/b')
})

test('orderTreeEntries：目录优先 + 自然序', () => {
  const ordered = orderTreeEntries([
    { name: 'file10', path: 'file10', type: 'file' },
    { name: 'zdir', path: 'zdir', type: 'dir' },
    { name: 'file2', path: 'file2', type: 'file' },
    { name: 'adir', path: 'adir', type: 'dir' }
  ])
  assert.deepEqual(ordered.map((item) => item.name), ['adir', 'zdir', 'file2', 'file10'])
  assert.deepEqual(orderTreeEntries(null), [])
})

/* ==========================================================================
   4. 过滤
   ========================================================================== */

test('filterEntries：空串表示不过滤（不是过滤掉全部）', () => {
  const entries = [entry('src/app.js'), entry('docs/readme.md')]
  assert.equal(filterEntries(entries, '').length, 2)
  assert.equal(filterEntries(entries, null).length, 2)
  assert.equal(filterEntries(entries, undefined).length, 2)
  assert.notEqual(filterEntries(entries, ''), entries, '应返回副本，调用方可以随便改')
})

test('filterEntries：按路径/文件名/重命名前路径命中，忽略大小写', () => {
  const entries = [
    entry('src/App.js'),
    entry('docs/readme.md'),
    entry('lib/new-name.js', { oldPath: 'lib/old-name.js', status: 'R' })
  ]
  assert.deepEqual(filterEntries(entries, 'app').map((item) => item.path), ['src/App.js'])
  assert.deepEqual(filterEntries(entries, 'src/').map((item) => item.path), ['src/App.js'])
  assert.deepEqual(filterEntries(entries, 'old-name').map((item) => item.path), ['lib/new-name.js'])
  assert.equal(filterEntries(entries, 'zzz').length, 0)
  // 路径片段（目录名）也能命中
  assert.equal(filterEntries(entries, 'docs').length, 1)
})

test('matchesEntry / matchesFilter：空 filter 一律命中，非对象条目视为不命中', () => {
  assert.equal(matchesEntry(entry('a.js'), ''), true)
  assert.equal(matchesEntry(null, 'a'), false)
  assert.equal(matchesEntry({ name: 'name-only.js' }, 'name-only'), true)
  // 空 filter 恒真（注意方向：路径为空、filter 非空时是 false）
  assert.equal(matchesFilter('src/a.js', ''), true)
  assert.equal(matchesFilter('a.js', undefined), true)
  assert.equal(matchesFilter('', 'anything'), false)
  assert.equal(matchesFilter('src/a.js', 'A.JS'), true)
})

/* ==========================================================================
   5. util/paths.js 的树工具（只读引用，组件依赖它们的行为）
   ========================================================================== */

test('paths.buildTree：建树 + byPath 索引', () => {
  const { nodes, byPath } = buildTree([{ path: 'a/b/c.js' }, { path: 'a/d.js' }])
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].name, 'a')
  assert.equal(nodes[0].type, 'dir')
  assert.equal(nodes[0].children.length, 2)
  assert.equal(byPath.get('a/b/c.js').type, 'file')
  assert.equal(byPath.get('a/b').type, 'dir')
})

test('paths.compactChain：只有一个目录子节点时折叠，遇到多子节点停下', () => {
  const { nodes } = buildTree([{ path: 'a/b/c.js' }, { path: 'a/b/d.js' }, { path: 'a/e.js' }])
  const onA = compactChain(nodes[0])
  assert.equal(onA.displayName, 'a', 'a 有两个子节点（b 目录 + e.js），不折叠')
  const onB = compactChain(nodes[0].children.find((node) => node.name === 'b'))
  assert.equal(onB.displayName, 'b')
  assert.equal(onB.chain.length, 1)
})

test('paths.flattenTree：按展开状态与深度输出行', () => {
  const { nodes } = buildTree([{ path: 'a/b/c.js' }, { path: 'a/d.js' }])
  const collapsed = flattenTree(nodes, () => false)
  assert.deepEqual(collapsed.map((row) => row.kind + ':' + row.path), ['dir:a'])
  const expanded = flattenTree(nodes, (dirPath) => dirPath === 'a')
  assert.deepEqual(expanded.map((row) => row.kind + ':' + row.path + '@' + row.depth), [
    'dir:a@0',
    'dir:a/b@1',
    'file:a/d.js@1'
  ])
})

test('paths.collectDirPaths / parentChain / dirname / basename', () => {
  const { nodes } = buildTree([{ path: 'a/b/c.js' }, { path: 'a/d.js' }])
  assert.deepEqual(collectDirPaths(nodes), ['a', 'a/b'])
  assert.deepEqual(parentChain('a/b/c.js'), ['a', 'a/b'])
  assert.deepEqual(parentChain('root.js'), [])
  assert.equal(dirname('a/b/c.js'), 'a/b')
  assert.equal(dirname('root.js'), '')
  assert.equal(basename('a/b/c.js'), 'c.js')
})



/* ------------------------------------------------------------------ */
/* reconcileSelection：status 刷新后如何校正选中项                       */
/* ------------------------------------------------------------------ */

test('reconcileSelection：来自变更列表的选中项会被更新/清空', () => {
  const entry = { path: 'src/app.js', status: 'M', adds: 1, dels: 0 }
  const files = [{ path: 'src/app.js', status: 'M', adds: 3, dels: 1 }]
  const selection = { path: 'src/app.js', entry, side: 'unstaged' }

  const kept = reconcileSelection(selection, files)
  assert.notEqual(kept, null, '文件仍在 status 里，不应清空')
  assert.notEqual(kept, selection, '应返回新对象，好让 diff 重取')
  assert.equal(kept.entry.adds, 3, '应换成最新的 entry')
  assert.equal(kept.side, 'unstaged', 'side 必须保留')

  assert.equal(reconcileSelection(selection, []), null, '文件从 status 里消失时应清空选中')
})

test('reconcileSelection：来自文件浏览树的选中项原样保留（未修改文件不在 status 里）', () => {
  const selection = { path: 'README.md', entry: null, side: 'unstaged' }
  // 未修改的文件本来就不在 status.files 里 —— 刷新绝不能因此清空
  assert.equal(reconcileSelection(selection, []), selection, '应原样返回同一个对象')
  assert.equal(reconcileSelection(selection, [{ path: 'src/app.js' }]), selection, 'status 里有别的文件也不受影响')
  assert.equal(reconcileSelection(null, []), null, 'null 进 null 出')
})


/* ==========================================================================
   runner（与 test/git.test.mjs 同款，保持输出风格一致）
   ========================================================================== */
let passed = 0
let failed = 0
for (const { name, fn } of results) {
  try {
    await fn()
    passed += 1
    console.log('  \u2713 ' + name)
  } catch (error) {
    failed += 1
    console.log('  \u2717 ' + name)
    console.log('    ' + String(error.message).split('\n').join('\n    '))
  }
}
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
