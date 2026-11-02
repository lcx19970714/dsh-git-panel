/**
 * test/review.test.mjs —— AI 审阅模块
 *
 * 覆盖三件事：输入拼装（超限截断必须如实标记）、输出严格校验（坏 JSON/坏枚举/空字段
 * 都要报 bad-model-output）、以及通过假 llm 走通一次完整调用。
 */
import assert from 'node:assert/strict'

import { buildReviewInput, generateReview, MAX_OUTPUT_TOKENS, REVIEW_DIFF_LIMIT } from '../host/review.js'

let passed = 0
let failed = 0
async function test(name, fn) {
  try {
    await fn()
    passed += 1
    console.log('  ✓ ' + name)
  } catch (error) {
    failed += 1
    console.log('  ✗ ' + name)
    console.log('    ' + String(error?.message ?? error).split('\n').join('\n    '))
  }
}

/* ---------------- 假 llm ---------------- */

function fakeLlm(reply) {
  const calls = []
  return {
    calls,
    service: {
      listProviders: () => [{ id: 'p1', name: 'Provider' }],
      listModels: async () => [{ id: 'm1', name: 'Model 1', provider: 'p1' }],
      prepareCall: async (config) => {
        calls.push({ config })
        return {
          config,
          stream({ system, messages }) {
            calls[calls.length - 1].system = system
            calls[calls.length - 1].prompt = messages[0].content[0].text
            return (async function* emit() {
              const text = typeof reply === 'function' ? reply() : reply
              yield { type: 'text-delta', text }
              yield { type: 'finish', reason: null }
            })()
          }
        }
      }
    }
  }
}

const validReview = {
  summary: '这次改动加了重试，整体方向对，但有两处需要调整。',
  verdict: 'request-changes',
  findings: [
    { severity: 'blocker', file: 'src/a.js', line: 12, title: '重试没有上限', detail: '可能无限重试', suggestion: '加最大次数' },
    { severity: 'nit', file: 'src/b.js', line: null, title: '命名不一致', detail: '两个变量风格不同', suggestion: '统一命名' }
  ],
  comment: '1. src/a.js:12 重试没有上限…\n2. src/b.js 命名不一致…'
}

/* ---------------- 输入拼装 ---------------- */

await test('buildReviewInput：小 diff 不截断，包含文件头与 patch', async () => {
  const built = buildReviewInput({
    pull: { title: 'T', body: 'B', author: 'alice', headBranch: 'feat', baseBranch: 'main', additions: 3, deletions: 1, changedFiles: 1 },
    files: [{ filename: 'src/a.js', status: 'modified', additions: 3, deletions: 1, patch: '@@ -1 +1 @@' }]
  })
  assert.equal(built.truncated, false)
  assert.equal(built.filesIncluded, 1)
  assert.ok(built.text.includes('src/a.js'))
  assert.ok(built.text.includes('@@ -1 +1 @@'))
})

await test('buildReviewInput：超过上限时截断并标 truncated，且不超出上限太多', async () => {
  const files = Array.from({ length: 40 }, (_, index) => ({
    filename: 'f' + index + '.js',
    status: 'added',
    additions: 1,
    deletions: 0,
    patch: 'x'.repeat(9000)
  }))
  const built = buildReviewInput({ pull: { title: 'T' }, files })
  assert.equal(built.truncated, true)
  assert.ok(built.filesIncluded < 40, '截断后只包含部分文件')
  assert.ok(built.text.length <= REVIEW_DIFF_LIMIT + 1000, '不应该远超上限：' + built.text.length)
})

/* ---------------- 严格校验 ---------------- */

await test('buildReviewInput：没有 patch 的文件要写明原因，并记入 skippedFiles', async () => {
  const built = buildReviewInput({
    pull: { title: 'T' },
    files: [
      { filename: 'assets/logo.png', status: 'added', additions: 0, deletions: 0, changes: 0, patch: '', patchAvailable: false },
      { filename: 'src/a.js', status: 'modified', additions: 2, deletions: 1, changes: 3, patch: '+x', patchAvailable: true }
    ]
  })
  assert.equal(built.skippedFiles.length, 1)
  assert.equal(built.skippedFiles[0].filename, 'assets/logo.png')
  assert.equal(built.skippedFiles[0].changes, 0)
  assert.ok(built.text.includes('未被审阅'), '提示词里要说明这个文件没被读到')
})

await test('parseReviewOutput：合法结构原样通过', async () => {
  const { parseReviewOutput } = await import('../host/review.js')
  const parsed = parseReviewOutput(JSON.stringify(validReview))
  assert.equal(parsed.verdict, 'request-changes')
  assert.equal(parsed.findings.length, 2)
  assert.equal(parsed.findings[1].line, null)
})

await test('parseReviewOutput：坏 JSON / 缺字段 / 非法枚举都报 bad-model-output', async () => {
  const { parseReviewOutput } = await import('../host/review.js')
  const cases = [
    ['不是 JSON', 'not json'],
    ['空文本', '   '],
    ['缺少 comment', JSON.stringify({ ...validReview, comment: '' })],
    ['verdict 非法', JSON.stringify({ ...validReview, verdict: 'lgtm' })],
    ['findings 不是数组', JSON.stringify({ ...validReview, findings: {} })],
    ['severity 非法', JSON.stringify({ ...validReview, findings: [{ ...validReview.findings[0], severity: 'huge' }] })],
    ['line 非法', JSON.stringify({ ...validReview, findings: [{ ...validReview.findings[0], line: 1.5 }] })]
  ]
  for (const [label, text] of cases) {
    assert.throws(() => parseReviewOutput(text), (error) => error.code === 'bad-model-output', label)
  }
})

/* ---------------- 完整调用 ---------------- */

await test('generateReview：走 prepareCall + stream，输出上限比提交说明高，结论带模型名', async () => {
  const llm = fakeLlm(JSON.stringify(validReview))
  const result = await generateReview(llm.service, { provider: 'p1', model: 'm1' }, {
    pull: { title: 'T', body: 'B' },
    files: [{ filename: 'src/a.js', status: 'modified', additions: 1, deletions: 0, patch: '+x' }]
  })
  assert.equal(result.verdict, 'request-changes')
  assert.equal(result.model, 'p1/m1')
  assert.equal(result.truncated, false)
  assert.equal(llm.calls.length, 1)
  assert.equal(llm.calls[0].config.maxTokens, MAX_OUTPUT_TOKENS)
  assert.ok(MAX_OUTPUT_TOKENS >= 4096, '审阅输出上限不能太小：' + MAX_OUTPUT_TOKENS)
  assert.ok(llm.calls[0].system.includes('JSON'), '系统提示词要求输出 JSON')
  assert.ok(llm.calls[0].prompt.includes('src/a.js'), '提示词里包含文件')
})

await test('generateReview：模型输出不合规时报错，不返回半成品', async () => {
  const llm = fakeLlm('{"summary":"只有一半"')
  await assert.rejects(
    () => generateReview(llm.service, { provider: 'p1', model: 'm1' }, { pull: { title: 'T' }, files: [] }),
    (error) => error.code === 'bad-model-output'
  )
})

await test('generateReview：没有 llm 服务时明确报 no-llm', async () => {
  await assert.rejects(
    () => generateReview(null, { provider: 'p1', model: 'm1' }, { pull: {}, files: [] }),
    (error) => error.code === 'no-llm'
  )
})

console.log('')
console.log(passed + ' passed, ' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
