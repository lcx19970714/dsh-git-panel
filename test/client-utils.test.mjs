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
const { formatDateTime } = await import('../src/util/time.js')
const { zh, en } = await import('../src/i18n.js')

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

await check('formatDateTime：今天只显示时分，今年带月日，跨年带年份', async () => {
  const now = new Date(2026, 4, 20, 15, 30, 0).getTime()
  assert.equal(formatDateTime(new Date(2026, 4, 20, 9, 5, 0).getTime(), now), '09:05', '今天：时分')
  assert.equal(formatDateTime(new Date(2026, 0, 3, 8, 7, 0).getTime(), now), '01-03 08:07', '今年：月日 + 时分')
  assert.equal(formatDateTime(new Date(2025, 11, 31, 23, 59, 0).getTime(), now), '2025-12-31 23:59', '跨年：带年份')
  assert.equal(formatDateTime(Number.NaN, now), '—', '非法时间戳给占位符')
})

const placeholdersOf = (value) => (String(value).match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort().join(',')

await check('i18n：中英文 key 集合与占位符必须一致', async () => {
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  assert.deepEqual(zhKeys, enKeys, '中英文 key 集合不一致（缺：' +
    zhKeys.filter((key) => !(key in en)).join(',') + '；多：' +
    enKeys.filter((key) => !(key in zh)).join(',') + '）')
  const mismatched = zhKeys.filter((key) => placeholdersOf(zh[key]) !== placeholdersOf(en[key]))
  assert.deepEqual(mismatched, [], '这些 key 的占位符中英不一致：' + mismatched.join(', '))
})

await check('resource-cache：有快照就零延迟返回，没写过的键返回 undefined', async () => {
  const cache = await import('../src/util/resource-cache.js')
  cache.clearSnapshots()
  assert.equal(cache.readSnapshot('k'), undefined, '没写过就是 undefined（界面据此决定是否骨架屏）')
  assert.equal(cache.snapshotAge('k'), Infinity, '没有快照时年龄为 Infinity')

  cache.writeSnapshot('k', { v: 1 })
  assert.deepEqual(cache.readSnapshot('k'), { v: 1 })
  assert.ok(cache.snapshotAge('k') < 1000, '刚写入的快照是新的')

  cache.dropSnapshot('k')
  assert.equal(cache.readSnapshot('k'), undefined, '删除后不再命中')

  // 容量上限：写满之后淘汰最旧的键，不会无限增长
  cache.clearSnapshots()
  for (let index = 0; index < 130; index += 1) cache.writeSnapshot('k' + index, index)
  assert.equal(cache.readSnapshot('k0'), undefined, '最旧的键应被淘汰')
  assert.equal(cache.readSnapshot('k129'), 129, '最新的键仍在')
})

await check('draft-cache：按仓库根分桶，读/删/清互不串台', async () => {
  const cache = await import('../src/util/draft-cache.js')
  cache.clearDrafts()
  const draft = (text) => ({ text, savedText: 'base', hash: 'h', eol: 'lf', bom: false })
  cache.writeDraft('C:/w/a', 'src/x.js', draft('a1'))
  cache.writeDraft('C:/w/b', 'src/x.js', draft('b1'))
  assert.equal(cache.readDrafts('C:/w/a').get('src/x.js').text, 'a1', '同一个相对路径在不同仓库是不同草稿')
  assert.equal(cache.readDrafts('C:/w/b').get('src/x.js').text, 'b1')
  cache.writeDraft('C:/w/a', 'src/x.js', draft('a2'))
  assert.equal(cache.readDrafts('C:/w/a').get('src/x.js').text, 'a2', '覆盖同一路径')
  cache.dropDraft('C:/w/a', 'src/x.js')
  assert.equal(cache.readDrafts('C:/w/a').has('src/x.js'), false, '删除只影响该仓库的该路径')
  assert.equal(cache.readDrafts('C:/w/b').has('src/x.js'), true, '别的仓库不受影响')
  cache.clearDrafts()
  assert.equal(cache.readDrafts('C:/w/b').size, 0)
})

await check('draft-cache：条数上限淘汰最久没写过的草稿', async () => {
  const cache = await import('../src/util/draft-cache.js')
  cache.clearDrafts()
  const draft = { text: 'x', savedText: 'x', hash: 'h', eol: 'lf', bom: false }
  for (let index = 0; index < 61; index += 1) cache.writeDraft('C:/w/a', 'f' + index + '.js', draft)
  // 重写 f0 让它变成最近使用，再写一条把 f1 挤出去
  cache.writeDraft('C:/w/a', 'f0.js', draft)
  cache.writeDraft('C:/w/a', 'f61.js', draft)
  assert.equal(cache.readDrafts('C:/w/a').has('f0.js'), true, '最近写过的草稿保留')
  assert.equal(cache.readDrafts('C:/w/a').has('f1.js'), false, '最旧的被淘汰')
  cache.clearDrafts()
})

console.log('')
console.log('client-utils：' + passed + ' passed, 0 failed')
