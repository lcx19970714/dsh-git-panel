/**
 * test/run.mjs —— 跑齐所有测试
 * 用法：node test/run.mjs [--only paths|diff|tree|highlight|build|git|host|client]
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const SUITES = [
  { name: 'paths', file: 'paths.test.mjs', args: [] },
  { name: 'remote', file: 'remote.test.mjs', args: [] },
  { name: 'diff', file: 'diff.test.mjs', args: [] },
  { name: 'tree', file: 'tree.test.mjs', args: [] },
  { name: 'build', file: 'build.test.mjs', args: [] },
  { name: 'git', file: 'git.test.mjs', args: [path.resolve(HERE, '..', '..', '_sandbox', 'repo')] },
  { name: 'host', file: 'host.test.mjs', args: [] },
  { name: 'client', file: 'client.test.mjs', args: [] },
  { name: 'components', file: 'components.test.mjs', args: [] },
  { name: 'flow', file: 'panel-flow.test.mjs', args: [] }
]

const onlyIndex = process.argv.indexOf('--only')
const only = onlyIndex === -1 ? null : process.argv[onlyIndex + 1]

let failed = 0
let ran = 0
const results = []

for (const suite of SUITES) {
  if (only !== null && only !== suite.name) continue
  const file = path.join(HERE, suite.file)
  if (!existsSync(file)) {
    results.push({ name: suite.name, status: 'missing' })
    continue
  }
  ran += 1
  const started = Date.now()
  try {
    const output = execFileSync(process.execPath, [file, ...suite.args], { encoding: 'utf8', stdio: 'pipe' })
    const lastLine = output.trim().split('\n').filter(Boolean).pop() ?? ''
    results.push({ name: suite.name, status: 'pass', detail: lastLine, ms: Date.now() - started })
  } catch (error) {
    failed += 1
    const output = String(error.stdout ?? '') + String(error.stderr ?? '')
    const lines = output.trim().split('\n')
    // 失败时先把「失败的用例名」捞出来：套件的尾部 14 行往往全是通过项，
    // 真正有用的信息（哪条挂了）会被截掉，导致只能靠猜或重跑。
    const failures = lines.filter((line) => /\u2717|FAIL |not ok/.test(line)).map((line) => line.trim())
    const tail = lines.slice(-14)
    const detail = [
      ...(failures.length > 0 ? ['失败用例：', ...failures.map((line) => '  ' + line), ''] : []),
      ...tail
    ].join('\n')
    results.push({ name: suite.name, status: 'fail', detail, ms: Date.now() - started })
  }
}

console.log('')
for (const result of results) {
  const mark = result.status === 'pass' ? 'ok  ' : result.status === 'fail' ? 'FAIL' : '--  '
  console.log(`  ${mark} ${result.name.padEnd(10)} ${result.detail ?? '(missing)'}${result.ms === undefined ? '' : `  (${result.ms}ms)`}`)
}
console.log('')
if (failed > 0) {
  console.error(`${failed} suite(s) failed`)
  process.exit(1)
}
console.log(`${ran} suite(s) passed`)
