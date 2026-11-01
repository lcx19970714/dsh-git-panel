/**
 * test/paths.test.mjs —— util/paths.js 纯函数测试
 * 运行：node test/paths.test.mjs
 */
import {
  basename,
  dirname,
  segments,
  parentChain,
  naturalCompare,
  buildTree,
  compactChain,
  flattenTree,
  collectDirPaths,
  matchesFilter,
  formatCount
} from '../src/util/paths.js'

let passed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log('  ok   ' + name)
  } catch (error) {
    failures.push({ name, error })
    console.log('  FAIL ' + name + '\n       ' + (error && error.message ? error.message : error))
  }
}

function eq(actual, expected, message) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error((message ?? 'eq') + ': expected ' + b + ', got ' + a)
}

function ok(value, message) {
  if (!value) throw new Error(message ?? 'expected truthy')
}

console.log('paths')

test('basename', () => {
  eq(basename('a/b/c.txt'), 'c.txt')
  eq(basename('a/b/'), 'b')
  eq(basename('C:\\x\\y.md'), 'y.md')
  eq(basename(''), '')
})

test('dirname 统一正斜杠', () => {
  eq(dirname('a/b/c.txt'), 'a/b')
  eq(dirname('C:\\x\\y.md'), 'C:/x')
  eq(dirname('top.txt'), '')
})


test('segments / parentChain', () => {
  eq(segments('a/b/c'), ['a', 'b', 'c'])
  eq(parentChain('a/b/c'), ['a', 'a/b'])
  eq(parentChain('a.txt'), [])
})

test('naturalCompare 数字按大小', () => {
  const list = ['a10', 'a2', 'a1'].sort(naturalCompare)
  eq(list, ['a1', 'a2', 'a10'])
})

test('buildTree：目录优先 + 自然序', () => {
  const { nodes } = buildTree([
    { path: 'b.txt' },
    { path: 'a/x.js' },
    { path: 'a10.txt' },
    { path: 'a2.txt' }
  ])
  eq(nodes.map((n) => n.name), ['a', 'a2.txt', 'a10.txt', 'b.txt'])
  eq(nodes[0].type, 'dir')
  eq(nodes[0].children[0].path, 'a/x.js')
})

test('buildTree：byPath 可回查', () => {
  const { byPath } = buildTree([{ path: 'src/deep/file.ts' }])
  ok(byPath.has('src'), 'src 存在')
  ok(byPath.has('src/deep'), 'src/deep 存在')
  ok(byPath.has('src/deep/file.ts'), '文件节点存在')
  eq(byPath.get('src/deep').type, 'dir')
  eq(byPath.get('src/deep/file.ts').type, 'file')
})

test('compactChain：单链折叠', () => {
  const { nodes } = buildTree([{ path: 'a/b/c/one.txt' }])
  const { displayName, node } = compactChain(nodes[0])
  eq(displayName, 'a/b/c')
  eq(node.path, 'a/b/c')
  eq(node.children.length, 1)
})

test('compactChain：遇到分叉停止折叠', () => {
  const { nodes } = buildTree([{ path: 'a/x.txt' }, { path: 'a/b/y.txt' }])
  const { displayName } = compactChain(nodes[0])
  eq(displayName, 'a')
})

test('flattenTree：折叠目录只出一行', () => {
  const { nodes } = buildTree([{ path: 'a/b/c/one.txt' }])
  const rows = flattenTree(nodes, () => false)
  eq(rows.length, 1)
  eq(rows[0].kind, 'dir')
  eq(rows[0].displayName, 'a/b/c')
})

test('flattenTree：展开后递归出文件', () => {
  const { nodes } = buildTree([{ path: 'a/b/one.txt' }, { path: 'a/b/two.txt' }])
  const rows = flattenTree(nodes, (p) => p === 'a/b')
  eq(rows[0].displayName, 'a/b')
  eq(rows[0].kind, 'dir')
  eq(rows.slice(1).map((r) => r.displayName), ['one.txt', 'two.txt'])
  eq(rows[1].depth, 1)
})

test('collectDirPaths', () => {
  const { nodes } = buildTree([{ path: 'a/b/one.txt' }, { path: 'c/two.txt' }])
  const dirs = collectDirPaths(nodes).sort()
  eq(dirs, ['a/b', 'c'])
})

test('matchesFilter', () => {
  ok(matchesFilter('src/app.js', ''))
  ok(matchesFilter('src/app.js', 'APP'))
  ok(matchesFilter('src/app.js', 'src/'))
  ok(!matchesFilter('src/app.js', 'nope'))
})


test('formatCount', () => {
  eq(formatCount(0), '0')
  eq(formatCount(999), '999')
  eq(formatCount(1200), '1.2k')
  eq(formatCount(12000), '12k')
})


console.log('')
if (failures.length > 0) {
  console.error(failures.length + ' failed, ' + passed + ' passed')
  for (const failure of failures) console.error(' - ' + failure.name + ': ' + (failure.error && failure.error.stack ? failure.error.stack : failure.error))
  process.exit(1)
}
console.log(passed + ' passed')