/**
 * test/client-utils.test.mjs —— 客户端小工具：打开外链、复制到剪贴板
 *
 * 两者都是「环境可能不给能力」的操作，重点是失败要如实体现在返回值里，
 * 界面才能给出可操作提示（而不是点了没反应）。
 */
import assert from 'node:assert/strict'

/**
 * 临时替换全局：Node 里 `navigator` 是只读 getter，必须用属性描述符改。
 */
async function withGlobal(name, value, fn) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true })
  try {
    return await fn()
  } finally {
    if (descriptor === undefined) delete globalThis[name]
    else Object.defineProperty(globalThis, name, descriptor)
  }
}

const { openExternalUrl } = await import('../src/util/openUrl.js')
const { copyText } = await import('../src/util/clipboard.js')

let passed = 0
async function check(name, fn) {
  await fn()
  passed += 1
  console.log('  ✓ ' + name)
}

/* ---------------------------------- openExternalUrl ---------------------------------- */

await check('openExternalUrl：成功时返回 opened=true', async () => {
  const calls = []
  await withGlobal('window', { open: (url) => { calls.push(url); return {} } }, () => {
    assert.deepEqual(openExternalUrl('https://example.com/a'), { opened: true, reason: null })
    assert.deepEqual(calls, ['https://example.com/a'])
  })
})

await check('openExternalUrl：被拦截时返回 blocked', async () => {
  await withGlobal('window', { open: () => null }, () => {
    assert.deepEqual(openExternalUrl('https://example.com/b'), { opened: false, reason: 'blocked' })
  })
})

await check('openExternalUrl：没有 window 时返回 unsupported', async () => {
  await withGlobal('window', undefined, () => {
    assert.deepEqual(openExternalUrl('https://example.com/c'), { opened: false, reason: 'unsupported' })
  })
})

/* ------------------------------------ copyText ------------------------------------ */

await check('copyText：写入成功时返回 ok', async () => {
  const written = []
  const result = await withGlobal('navigator', {
    clipboard: { writeText: async (value) => { written.push(value) } }
  }, () => copyText('ghp_secret'))
  assert.deepEqual(result, { ok: true, reason: null })
  assert.deepEqual(written, ['ghp_secret'])
})

await check('copyText：没有剪贴板 API 时返回 unsupported', async () => {
  const result = await withGlobal('navigator', {}, () => copyText('x'))
  assert.deepEqual(result, { ok: false, reason: 'unsupported' })
})

await check('copyText：空字符串不写剪贴板', async () => {
  const result = await withGlobal('navigator', { clipboard: { writeText: async () => {} } }, () => copyText(''))
  assert.deepEqual(result, { ok: false, reason: 'empty' })
})

await check('copyText：浏览器拒绝时返回 denied', async () => {
  const result = await withGlobal('navigator', {
    clipboard: { writeText: async () => { throw new Error('NotAllowedError') } }
  }, () => copyText('x'))
  assert.deepEqual(result, { ok: false, reason: 'denied' })
})

console.log('')
console.log('client-utils：' + passed + ' passed, 0 failed')
