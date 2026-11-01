/**
 * src/util/diff.js 的独立测试（零依赖，纯 Node ESM）。
 *
 * 用法：node test/diff.test.mjs
 *
 * 覆盖：unified 行号/缺字段/无换行标记/CRLF、split 的 del-run×add-run 配对、
 * 词级高亮切片、统计、全局行预算截断（含 10k 行纯新增）。
 */
import assert from 'node:assert/strict'
import {
  MAX_DIFF_ROWS,
  buildUnifiedRows,
  buildSplitRows,
  pairChangedRuns,
  highlightWordDiff,
  diffStats,
  budgetRows
} from '../src/util/diff.js'

const results = []
function test(name, fn) {
  results.push({ name, fn })
}

/** 造一个 hunk；oldStart/newStart 默认 1。 */
function hunkOf(lines, extra = {}) {
  const base = {
    header: '@@ -1,1 +1,1 @@',
    section: '',
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    lines
  }
  return { ...base, ...extra }
}

// ---------------------------------------------------------------------------
// buildUnifiedRows
// ---------------------------------------------------------------------------

test('buildUnifiedRows：空/非法输入返回空数组', () => {
  assert.deepEqual(buildUnifiedRows(null), [])
  assert.deepEqual(buildUnifiedRows(undefined), [])
  assert.deepEqual(buildUnifiedRows([]), [])
  assert.deepEqual(buildUnifiedRows([null, undefined, 42, 'hunk', {}]), [])
})

test('buildUnifiedRows：只有 header 的空 hunk 仍保留一行', () => {
  const rows = buildUnifiedRows([{ header: '@@ -1,0 +1,0 @@' }])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].type, 'hunk')
  assert.equal(rows[0].header, '@@ -1,0 +1,0 @@')
})

test('buildUnifiedRows：hunk 行把 header 与 section 拆开', () => {
  const rows = buildUnifiedRows([
    hunkOf([], {
      header: '@@ -10,2 +10,3 @@ section title',
      section: 'section title',
      oldStart: 10,
      oldLines: 2,
      newStart: 10,
      newLines: 3
    })
  ])
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], { type: 'hunk', header: '@@ -10,2 +10,3 @@', section: 'section title' })
})

test('buildUnifiedRows：header 缺失时按 hunk 头数字重建', () => {
  const rows = buildUnifiedRows([hunkOf([], {
    header: '',
    oldStart: 3,
    oldLines: 4,
    newStart: 5,
    newLines: 6
  })])
  assert.equal(rows[0].header, '@@ -3,4 +5,6 @@')
  assert.equal(rows[0].section, '')
})

test('buildUnifiedRows：只有新增（oldLine 为 undefined，新行号从 newStart 起）', () => {
  const rows = buildUnifiedRows([hunkOf([
    { kind: 'add', newLine: 1, text: 'a' },
    { kind: 'add', newLine: 2, text: 'b' }
  ], { newStart: 1, newLines: 2, oldStart: 0, oldLines: 0 })])

  assert.equal(rows.length, 3)
  assert.equal(rows[1].kind, 'add')
  assert.equal(rows[1].oldLine, undefined)
  assert.equal(rows[1].newLine, 1)
  assert.equal(rows[2].newLine, 2)
  assert.equal(rows[1].text, 'a')
})

test('buildUnifiedRows：只有删除（newLine 为 undefined）', () => {
  const rows = buildUnifiedRows([hunkOf([
    { kind: 'del', oldLine: 7, text: 'gone' }
  ], { oldStart: 7, oldLines: 1, newStart: 6, newLines: 0 })])

  assert.equal(rows[1].kind, 'del')
  assert.equal(rows[1].oldLine, 7)
  assert.equal(rows[1].newLine, undefined)
})

test('buildUnifiedRows：ctx/add/del 交错时两侧行号各自递增', () => {
  const rows = buildUnifiedRows([hunkOf([
    { kind: 'ctx', oldLine: 1, newLine: 1, text: 'keep1' },
    { kind: 'del', oldLine: 2, text: 'old2' },
    { kind: 'add', newLine: 2, text: 'new2' },
    { kind: 'ctx', oldLine: 3, newLine: 3, text: 'keep3' }
  ], { oldStart: 1, newStart: 1 })])
  const lines = rows.filter((row) => row.type === 'line')
  assert.equal(lines.length, 4)
  assert.deepEqual(lines.map((row) => row.kind), ['ctx', 'del', 'add', 'ctx'])
  assert.deepEqual(lines.map((row) => [row.oldLine, row.newLine]), [
    [1, 1], [2, undefined], [undefined, 2], [3, 3]
  ])
})

test('buildUnifiedRows：缺 oldLine/newLine 时用 hunk 头游标补全', () => {
  const rows = buildUnifiedRows([hunkOf([
    { kind: 'ctx', text: 'a' },
    { kind: 'del', text: 'b' },
    { kind: 'add', text: 'c' }
  ], { oldStart: 20, newStart: 40 })])
  const lines = rows.filter((row) => row.type === 'line')
  assert.deepEqual(lines.map((row) => [row.oldLine, row.newLine]), [
    [20, 40], [21, undefined], [undefined, 41]
  ])
})

test('buildUnifiedRows：\\ No newline 标记行并入上一行，不单独成行', () => {
  const rows = buildUnifiedRows([hunkOf([
    { kind: 'del', oldLine: 1, text: 'last-old' },
    { kind: 'nonewline', text: '' },
    { kind: 'add', newLine: 1, text: 'last-new' }
  ])])
  const lines = rows.filter((row) => row.type === 'line')
  assert.equal(lines.length, 2)
  assert.equal(lines[0].noNewline, true)
  assert.equal(lines[1].noNewline, false)
  assert.equal(lines[0].text, 'last-old')
})

test('buildUnifiedRows：CRLF 的尾部 \\r 被剥掉', () => {
  const rows = buildUnifiedRows([hunkOf([
    { kind: 'ctx', oldLine: 1, newLine: 1, text: 'win\r' },
    { kind: 'add', newLine: 2, text: 'added\r' }
  ])])
  assert.equal(rows[1].text, 'win')
  assert.equal(rows[2].text, 'added')
})

// ---------------------------------------------------------------------------
// buildSplitRows / pairChangedRuns
// ---------------------------------------------------------------------------

test('buildSplitRows：空输入安全', () => {
  assert.deepEqual(buildSplitRows(null), [])
  assert.deepEqual(buildSplitRows([]), [])
})

test('buildSplitRows：del 多于 add 时按索引配对、多余的一侧补 null', () => {
  const rows = buildSplitRows([hunkOf([
    { kind: 'del', oldLine: 1, text: 'a' },
    { kind: 'del', oldLine: 2, text: 'b' },
    { kind: 'del', oldLine: 3, text: 'c' },
    { kind: 'add', newLine: 1, text: 'x' }
  ])])
  const pairs = rows.filter((row) => row.type === 'pair')
  assert.equal(pairs.length, 3)
  assert.deepEqual(pairs.map((pair) => pair.left.kind), ['del', 'del', 'del'])
  assert.deepEqual(pairs.map((pair) => pair.left.line), [1, 2, 3])
  assert.equal(pairs[0].right.kind, 'add')
  assert.equal(pairs[0].right.text, 'x')
  assert.equal(pairs[1].right, null)
  assert.equal(pairs[2].right, null)
})

test('buildSplitRows：add 多于 del 时同理（另一侧补 null）', () => {
  const rows = buildSplitRows([hunkOf([
    { kind: 'del', oldLine: 1, text: 'a' },
    { kind: 'add', newLine: 1, text: 'x' },
    { kind: 'add', newLine: 2, text: 'y' },
    { kind: 'add', newLine: 3, text: 'z' }
  ])])
  const pairs = rows.filter((row) => row.type === 'pair')
  assert.equal(pairs.length, 3)
  assert.equal(pairs[0].right.kind, 'add')
  assert.deepEqual(pairs.map((pair) => pair.right.line), [1, 2, 3])
  assert.equal(pairs[1].left, null)
  assert.equal(pairs[2].left, null)
})

test('buildSplitRows：ctx 行左右同文、各自行号', () => {
  const rows = buildSplitRows([hunkOf([
    { kind: 'ctx', oldLine: 5, newLine: 9, text: 'same' }
  ])])
  const pair = rows.find((row) => row.type === 'pair')
  assert.deepEqual(pair.left, { kind: 'ctx', line: 5, text: 'same', noNewline: false })
  assert.deepEqual(pair.right, { kind: 'ctx', line: 9, text: 'same', noNewline: false })
})

test('buildSplitRows：ctx 会重置配对（两个改动块不互相错位）', () => {
  const rows = buildSplitRows([hunkOf([
    { kind: 'del', oldLine: 1, text: 'a1' },
    { kind: 'del', oldLine: 2, text: 'a2' },
    { kind: 'add', newLine: 1, text: 'b1' },
    { kind: 'ctx', oldLine: 3, newLine: 2, text: 'ctx' },
    { kind: 'del', oldLine: 4, text: 'c1' },
    { kind: 'add', newLine: 3, text: 'd1' },
    { kind: 'add', newLine: 4, text: 'd2' }
  ])])
  const pairs = rows.filter((row) => row.type === 'pair')
  // 2 + 1(ctx) + 2 = 5 行
  assert.equal(pairs.length, 5)
  assert.deepEqual(pairs[0].left.text, 'a1')
  assert.deepEqual(pairs[0].right.text, 'b1')
  assert.equal(pairs[1].left.text, 'a2')
  assert.equal(pairs[1].right, null)
  assert.equal(pairs[2].left.kind, 'ctx')
  assert.equal(pairs[2].right.kind, 'ctx')
  assert.equal(pairs[3].left.text, 'c1')
  assert.equal(pairs[3].right.text, 'd1')
  assert.equal(pairs[4].left, null)
  assert.equal(pairs[4].right.text, 'd2')
})

test('buildSplitRows：hunk 行 + 配对行数量正确，section 带出', () => {
  const rows = buildSplitRows([hunkOf([
    { kind: 'ctx', oldLine: 1, newLine: 1, text: 'a' },
    { kind: 'del', oldLine: 2, text: 'b' },
    { kind: 'add', newLine: 2, text: 'c' },
    { kind: 'ctx', oldLine: 3, newLine: 3, text: 'd' }
  ], { header: '@@ -1,3 +1,3 @@ fn main()', section: 'fn main()' })])

  // hunk 行 + ctx 配对 + (del,add) 配对 + ctx 配对 = 4 行
  assert.equal(rows.length, 4)
  assert.equal(rows[0].type, 'hunk')
  assert.equal(rows[0].header, '@@ -1,3 +1,3 @@')
  assert.equal(rows[0].section, 'fn main()')
  assert.ok(rows.slice(1).every((row) => row.type === 'pair'))
})

test('pairChangedRuns：没有改动时等价于 ctx 配对', () => {
  const pairs = pairChangedRuns(hunkOf([
    { kind: 'ctx', oldLine: 1, newLine: 1, text: 'a' },
    { kind: 'ctx', oldLine: 2, newLine: 2, text: 'b' }
  ]))
  assert.equal(pairs.length, 2)
  assert.ok(pairs.every((pair) => pair.left.kind === 'ctx' && pair.right.kind === 'ctx'))
})

// ---------------------------------------------------------------------------
// highlightWordDiff
// ---------------------------------------------------------------------------

test('highlightWordDiff：完全相同时只有一段未变', () => {
  const diff = highlightWordDiff('const a = 1', 'const a = 1')
  assert.deepEqual(diff.oldSegments, [{ text: 'const a = 1', changed: false }])
  assert.deepEqual(diff.newSegments, [{ text: 'const a = 1', changed: false }])
})

test('highlightWordDiff：公共前后缀被保留，中间标记为 changed', () => {
  const diff = highlightWordDiff('const a = 1', 'const b = 1')
  assert.deepEqual(diff.oldSegments, [
    { text: 'const ', changed: false },
    { text: 'a', changed: true },
    { text: ' = 1', changed: false }
  ])
  assert.deepEqual(diff.newSegments, [
    { text: 'const ', changed: false },
    { text: 'b', changed: true },
    { text: ' = 1', changed: false }
  ])
})

test('highlightWordDiff：纯插入（旧行为空）时旧侧没有 changed 段', () => {
  const diff = highlightWordDiff('', 'abc')
  assert.deepEqual(diff.oldSegments, [])
  assert.deepEqual(diff.newSegments, [{ text: 'abc', changed: true }])
})

test('highlightWordDiff：纯前缀追加只标记新增部分', () => {
  const diff = highlightWordDiff('foo()', 'foo(bar)')
  // 公共前缀 'foo('、公共后缀 ')' 之外的 bar 才是 changed
  assert.deepEqual(diff.oldSegments, [
    { text: 'foo(', changed: false },
    { text: ')', changed: false }
  ])
  assert.deepEqual(diff.newSegments, [
    { text: 'foo(', changed: false },
    { text: 'bar', changed: true },
    { text: ')', changed: false }
  ])
})

test('highlightWordDiff：空文本返回空段数组', () => {
  assert.deepEqual(highlightWordDiff('', ''), { oldSegments: [], newSegments: [] })
  assert.deepEqual(highlightWordDiff(null, undefined), { oldSegments: [], newSegments: [] })
})

test('highlightWordDiff：超过 2000 字符整行标记 changed（保证 O(1)）', () => {
  const long = 'x'.repeat(2100)
  const diff = highlightWordDiff(long, long + 'y')
  assert.equal(diff.oldSegments.length, 1)
  assert.equal(diff.oldSegments[0].changed, true)
  assert.equal(diff.newSegments.length, 1)
  assert.equal(diff.newSegments[0].changed, true)
  assert.equal(diff.newSegments[0].text.length, long.length + 1)
})

// ---------------------------------------------------------------------------
// diffStats
// ---------------------------------------------------------------------------

test('diffStats：统计 add/del，忽略标记行与空 hunk', () => {
  assert.deepEqual(diffStats(null), { adds: 0, dels: 0 })
  assert.deepEqual(diffStats([]), { adds: 0, dels: 0 })
  const stats = diffStats([hunkOf([
    { kind: 'ctx', oldLine: 1, newLine: 1, text: 'a' },
    { kind: 'del', oldLine: 2, text: 'b' },
    { kind: 'add', newLine: 2, text: 'c' },
    { kind: 'add', newLine: 3, text: 'd' },
    { kind: 'nonewline', text: '' }
  ])])
  assert.deepEqual(stats, { adds: 2, dels: 1 })
})

// ---------------------------------------------------------------------------
// budgetRows
// ---------------------------------------------------------------------------

test('budgetRows：默认预算常量是 5000', () => {
  assert.equal(MAX_DIFF_ROWS, 5000)
})

test('budgetRows：未超预算时原样返回、不报告截断', () => {
  const rows = buildUnifiedRows([hunkOf([
    { kind: 'add', newLine: 1, text: 'a' },
    { kind: 'add', newLine: 2, text: 'b' }
  ])])
  const result = budgetRows(rows, 5000)
  assert.equal(result.rows, rows)
  assert.equal(result.truncatedCount, 0)
})

test('budgetRows：空输入 / budget=0', () => {
  assert.deepEqual(budgetRows(null), { rows: [], truncatedCount: 0 })
  const rows = buildUnifiedRows([hunkOf([{ kind: 'add', newLine: 1, text: 'a' }])])
  const none = budgetRows(rows, 0)
  assert.deepEqual(none.rows, [])
  assert.equal(none.truncatedCount, rows.length)
})

test('budgetRows：以整个 hunk 为单位丢弃，绝不切开 hunk', () => {
  const hunkA = hunkOf([
    { kind: 'ctx', oldLine: 1, newLine: 1, text: 'a1' },
    { kind: 'add', newLine: 2, text: 'a2' }
  ])
  const hunkB = hunkOf([
    { kind: 'ctx', oldLine: 5, newLine: 5, text: 'b1' },
    { kind: 'add', newLine: 6, text: 'b2' }
  ])
  const rows = buildUnifiedRows([hunkA, hunkB]) // 3 + 3 = 6 行
  const kept = budgetRows(rows, 4)
  assert.equal(kept.rows.length, 3, '第二个 hunk（3 行）放不进剩余 1 行预算 → 整块丢弃')
  assert.equal(kept.rows[0].type, 'hunk')
  assert.equal(kept.truncatedCount, 3)
})

test('budgetRows：10k 行纯新增（单 hunk）命中预算，且在行边界截断', () => {
  const lines = []
  for (let index = 1; index <= 10000; index += 1) {
    lines.push({ kind: 'add', newLine: index, text: 'line ' + index })
  }
  const rows = buildUnifiedRows([hunkOf(lines, {
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: 10000
  })])
  assert.equal(rows.length, 10001)

  const result = budgetRows(rows)
  assert.equal(result.rows.length, MAX_DIFF_ROWS)
  assert.equal(result.truncatedCount, 10001 - MAX_DIFF_ROWS)
  assert.equal(result.rows[0].type, 'hunk')
  assert.equal(result.rows[1].type, 'line')
  assert.ok(result.rows.every((row) => row.type === 'hunk' || row.type === 'line'))
})

test('budgetRows：split 行截断后每一行仍是完整配对（不会出现半个 pair）', () => {
  const lines = []
  for (let index = 1; index <= 10000; index += 1) {
    lines.push({ kind: 'add', newLine: index, text: 'line ' + index })
  }
  const rows = buildSplitRows([hunkOf(lines, {
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: 10000
  })])
  assert.equal(rows.length, 10001)

  const result = budgetRows(rows, 3000)
  assert.equal(result.rows.length, 3000)
  assert.ok(result.truncatedCount > 0)
  for (const row of result.rows) {
    assert.ok(row.type === 'hunk' || row.type === 'pair')
    assert.ok('left' in row || row.type === 'hunk')
    assert.ok('right' in row || row.type === 'hunk')
  }
})

test('budgetRows：未传 budget 时用 MAX_DIFF_ROWS', () => {
  const rows = new Array(MAX_DIFF_ROWS + 10)
  for (let index = 0; index < rows.length; index += 1) {
    rows[index] = index === 0 ? { type: 'hunk' } : { type: 'line' }
  }
  const result = budgetRows(rows)
  assert.equal(result.rows.length, MAX_DIFF_ROWS)
  assert.equal(result.truncatedCount, 10)
})

// ---------------------------------------------------------------------------
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
