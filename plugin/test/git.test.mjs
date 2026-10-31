/**
 * host/git.js 的独立测试：不依赖 DSH，直接对沙盒仓库断言解析结果。
 * 用法：node test/git.test.mjs [fixtureDir]
 */
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdirSync, mkdtempSync } from 'node:fs'
import {
  discoverRepos,
  languageForPath,
  listDirectory,
  parseUnifiedDiff,
  readDiff,
  readStatus,
  readTextFile,
  resolveInside,
  resolveRepo,
  runGit
} from '../host/git.js'

const fixture = process.argv[2] || path.resolve(import.meta.dirname, '../../_sandbox/repo')
const results = []
function test(name, fn) {
  results.push({ name, fn })
}

test('resolveRepo 能定位仓库根', async () => {
  const repo = await resolveRepo(fixture)
  assert.ok(repo, '应识别为仓库')
  assert.equal(repo.bare, false)
  assert.equal(repo.repoRoot.replace(/\\/g, '/').toLowerCase(), fixture.replace(/\\/g, '/').toLowerCase())
})

test('resolveRepo 对非 git 目录返回 null', async () => {
  // 必须落在「任何仓库之外」：用系统临时目录，避免被外层仓库（例如本仓库）兜住
  const outside = mkdtempSync(path.join(os.tmpdir(), 'dgp-notrepo-'))
  const repo = await resolveRepo(outside)
  assert.equal(repo, null)
})

test('readHead 读出分支与 short sha', async () => {
  const status = await readStatus(fixture)
  assert.equal(status.branch, 'main')
  assert.match(status.head, /^[0-9a-f]{7,}$/)
  assert.equal(status.detached, false)
})

test('status 覆盖全部状态类型', async () => {
  const status = await readStatus(fixture)
  const byPath = new Map(status.files.map((f) => [f.path, f]))

  const app = byPath.get('src/app.js')
  assert.ok(app, '应有 src/app.js')
  assert.equal(app.unstaged, true)
  assert.equal(app.staged, false)
  assert.equal(app.status, 'M')

  const util = byPath.get('src/util.ts')
  assert.ok(util, '应有 src/util.ts')
  assert.equal(util.staged, true)
  assert.equal(util.unstaged, false)

  const guide = byPath.get('docs/guide.md')
  assert.ok(guide, '应有 docs/guide.md')
  assert.equal(guide.staged, true, 'guide 已暂存')
  assert.equal(guide.unstaged, true, 'guide 也有未暂存改动')

  const deleted = byPath.get('src/will-delete.txt')
  assert.ok(deleted, '应有 src/will-delete.txt')
  assert.equal(deleted.status, 'D')
  assert.equal(deleted.unstaged, true)

  const renamed = byPath.get('src/renamed/renamed.txt')
  assert.ok(renamed, '应能识别重命名后的新路径；实际: ' + [...byPath.keys()].join(', '))
  assert.equal(renamed.status, 'R')
  assert.equal(renamed.oldPath, 'src/will-rename.txt')

  const todo = byPath.get('notes/todo.md')
  assert.ok(todo, '应有未跟踪 notes/todo.md')
  assert.equal(todo.untracked, true)
  assert.equal(todo.status, '?')
  assert.equal(todo.adds, 2)

  const logo = byPath.get('assets/logo.bin')
  assert.ok(logo, '应有 assets/logo.bin')
  assert.equal(logo.binary, true, '二进制应被标记')

  assert.ok(byPath.get('中文目录/说明.md'), '应支持中文路径')
  assert.ok(byPath.get('src/empty.txt'), '应支持空文件')

  assert.equal(status.counts.untracked, 6, '未跟踪数 doc: ' + JSON.stringify(status.counts))
  assert.ok(status.counts.total >= 9)
})

test('numstat 行数统计正确', async () => {
  const status = await readStatus(fixture)
  const app = status.files.find((f) => f.path === 'src/app.js')
  assert.equal(app.adds, 3, 'src/app.js 新增 3 行')
  assert.equal(app.dels, 1, 'src/app.js 删除 1 行')
  const util = status.files.find((f) => f.path === 'src/util.ts')
  assert.equal(util.adds, 1)
  assert.equal(util.dels, 0)
})

test('readDiff 未暂存：结构化 hunk 与行号', async () => {
  const diff = await readDiff(fixture, 'src/app.js', { staged: false })
  assert.equal(diff.kind, 'text')
  assert.equal(diff.stats.adds, 3)
  assert.equal(diff.stats.dels, 1)
  assert.equal(diff.hunks.length, 1)
  const hunk = diff.hunks[0]
  assert.equal(hunk.oldStart, 1)
  assert.equal(hunk.newStart, 1)
  const added = hunk.lines.filter((l) => l.kind === 'add')
  const removed = hunk.lines.filter((l) => l.kind === 'del')
  assert.equal(added.length, 3)
  assert.equal(removed.length, 1)
  assert.ok(added.every((l) => typeof l.newLine === 'number'))
  assert.ok(removed.every((l) => typeof l.oldLine === 'number'))
  assert.equal(removed[0].text, '  return 1')
  assert.equal(diff.language, 'javascript')
})

test('readDiff 已暂存 vs 未暂存 内容不同', async () => {
  const stagedDiff = await readDiff(fixture, 'docs/guide.md', { staged: true })
  const unstagedDiff = await readDiff(fixture, 'docs/guide.md', { staged: false })
  assert.equal(stagedDiff.kind, 'text')
  assert.equal(unstagedDiff.kind, 'text')
  const stagedText = stagedDiff.hunks.flatMap((h) => h.lines.map((l) => l.text)).join('\n')
  const unstagedText = unstagedDiff.hunks.flatMap((h) => h.lines.map((l) => l.text)).join('\n')
  assert.ok(stagedText.includes('line2 CHANGED'))
  assert.ok(!stagedText.includes('line6 added later'), '已暂存不应包含后续未暂存改动')
  assert.ok(unstagedText.includes('line6 added later'))
})

test('readDiff 未跟踪文件整篇新增', async () => {
  const diff = await readDiff(fixture, 'notes/todo.md', { untracked: true })
  assert.equal(diff.kind, 'text')
  assert.equal(diff.stats.adds, 2)
  assert.equal(diff.hunks[0].newStart, 1)
  assert.equal(diff.hunks[0].lines[0].text, '- buy milk')
})

test('readDiff 二进制', async () => {
  const diff = await readDiff(fixture, 'assets/logo.bin', { staged: false })
  assert.equal(diff.kind, 'binary')
})

test('readDiff 删除文件全是 del', async () => {
  const diff = await readDiff(fixture, 'src/will-delete.txt', { staged: false })
  assert.equal(diff.kind, 'text')
  assert.ok(diff.stats.dels >= 1)
  assert.ok(diff.hunks[0].lines.every((l) => l.kind === 'del'))
})

test('readDiff 上下文行数可调', async () => {
  const d0 = await readDiff(fixture, 'src/app.js', { staged: false, contextLines: 0 })
  assert.ok(d0.hunks[0].lines.length <= 5, 'U0 应更短，实际 ' + d0.hunks[0].lines.length)
})

test('  readTextFile 正常/二进制/超大', async () => {
  const ok = await readTextFile(path.join(fixture, 'src/util.ts'))
  assert.equal(ok.kind, 'text')
  assert.ok(ok.text.includes('export const a = 1'))
  assert.equal(ok.language, 'typescript')

  const bin = await readTextFile(path.join(fixture, 'assets/logo.bin'))
  assert.equal(bin.kind, 'binary')

  const big = await readTextFile(path.join(fixture, 'src/util.ts'), { maxBytes: 5 })
  assert.equal(big.kind, 'oversized')

  const missing = await readTextFile(path.join(fixture, 'nope.txt'))
  assert.equal(missing.kind, 'missing')

  const dir = await readTextFile(path.join(fixture, 'src'))
  assert.equal(dir.kind, 'directory')
})

test('listDirectory 目录优先 + 自然序', async () => {
  const listing = await listDirectory(path.join(fixture, 'src'))
  const names = listing.entries.map((e) => e.name)
  assert.ok(names.includes('app.js'))
  assert.ok(names.includes('renamed'))
  const firstFile = listing.entries.findIndex((e) => e.type === 'file')
  const lastDir = listing.entries.map((e) => e.type).lastIndexOf('dir')
  if (lastDir !== -1) assert.ok(lastDir < firstFile, '目录应排在文件之前')
})

test('discoverRepos 找到项目内嵌仓库', async () => {
  const scan = await discoverRepos(fixture, { includeRoot: false })
  assert.equal(scan.truncated, false, '没到上限时不应报告截断')
  assert.equal(scan.repos.length, 1, '应只发现 1 个内嵌仓库，实际：' + JSON.stringify(scan.repos))
  assert.ok(scan.repos[0].path.toLowerCase().endsWith('packages/sub-repo'), '实际：' + scan.repos[0].path)
})

test('discoverRepos includeRoot=true 时把根本身作为仓库', async () => {
  const scan = await discoverRepos(fixture)
  assert.equal(scan.repos.length, 1)
  assert.equal(scan.repos[0].depth, 0)
})

test('discoverRepos：达到上限时明确报告 truncated，不静默少列', async () => {
  const scan = await discoverRepos(fixture, { includeRoot: false, maxRepos: 0 })
  assert.equal(scan.repos.length, 0)
  assert.equal(scan.truncated, true, '仓库数达到上限时必须报告')
})

test('resolveInside 拒绝逃逸与 .git', async () => {
  assert.ok(resolveInside(fixture, 'src/app.js'))
  assert.throws(() => resolveInside(fixture, '../outside.txt'), /不在仓库根目录内/)
  assert.throws(() => resolveInside(fixture, '.git/config'), /不允许访问/)
})

test('parseUnifiedDiff 处理无换行结尾与多 hunk', async () => {
  const sample = [
    'diff --git a/x.txt b/x.txt',
    'index 111..222 100644',
    '--- a/x.txt',
    '+++ b/x.txt',
    '@@ -1,2 +1,2 @@',
    '-old',
    '+new',
    ' same',
    '@@ -10,2 +10,3 @@ section title',
    ' ctx',
    '+added',
    ' ctx2',
    '\\ No newline at end of file',
    ''
  ].join('\n')
  const parsed = parseUnifiedDiff(sample)
  assert.equal(parsed.hunks.length, 2)
  assert.equal(parsed.hunks[1].section, 'section title')
  assert.equal(parsed.stats.adds, 2)
  assert.equal(parsed.stats.dels, 1)
  assert.equal(parsed.hunks[1].lines.at(-1).text, 'ctx2')
  assert.equal(parsed.hunks[1].lines.at(-1).noNewline, true)
})

test('parsePorcelainV2 重命名条目兼容', async () => {
  const { parsePorcelainV2 } = await import('../host/git.js')
  const text = '2 R. N... 100644 100644 100644 abc def R100 new name.txt\u0000old name.txt\u0000'
  const entries = parsePorcelainV2(text)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].path, 'new name.txt')
  assert.equal(entries[0].oldPath, 'old name.txt')
  assert.equal(entries[0].status, 'R')
})

test('languageForPath 常见类型', async () => {
  assert.equal(languageForPath('a/b.tsx'), 'typescript')
  assert.equal(languageForPath('Dockerfile'), 'dockerfile')
  assert.equal(languageForPath('.gitignore'), 'ini')
  assert.equal(languageForPath('x.unknown'), 'text')
  assert.equal(languageForPath('中文/说明.md'), 'markdown')
})

test('git 不存在/非仓库时给出结构化错误', async () => {
  // 同上：临时目录保证不在任何仓库内部
  const outside = mkdtempSync(path.join(os.tmpdir(), 'dgp-notrepo-'))
  await assert.rejects(
    () => runGit(outside, ['status']),
    (error) => error.code === 'not-a-repository'
  )
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
