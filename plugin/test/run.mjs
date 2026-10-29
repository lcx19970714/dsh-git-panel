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
    results.push({ name: suite.name, status: 'fail', detail: output.trim().split('\n').slice(-14).join('\n'), ms: Date.now() - started })
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
