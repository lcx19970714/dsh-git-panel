/** openExternalUrl 的单元测试（不经过面板）。 */
import assert from 'node:assert/strict'

/* 模拟不同环境的 window */
function withWindow(value, fn) {
  const previous = globalThis.window
  if (value === undefined) delete globalThis.window
  else globalThis.window = value
  try {
    return fn()
  } finally {
    if (previous === undefined) delete globalThis.window
    else globalThis.window = previous
  }
}

const { openExternalUrl } = await import('../src/util/openUrl.js')

const opened = []
withWindow({ open: (url) => { opened.push(url); return {} } }, () => {
  const result = openExternalUrl('https://example.com/a')
  assert.deepEqual(result, { opened: true, reason: null })
  assert.deepEqual(opened, ['https://example.com/a'])
})

withWindow({ open: () => null }, () => {
  assert.deepEqual(openExternalUrl('https://example.com/b'), { opened: false, reason: 'blocked' })
})

withWindow(undefined, () => {
  assert.deepEqual(openExternalUrl('https://example.com/c'), { opened: false, reason: 'unsupported' })
})

console.log('  ✓ openExternalUrl：成功 / 被拦截 / 无 window 三种结果都如实体现在返回值里')
console.log('')
console.log('openUrl：1 passed, 0 failed')
