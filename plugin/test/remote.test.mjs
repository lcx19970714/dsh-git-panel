/**
 * test/remote.test.mjs —— `src/util/remote.js` 的单测（纯 Node ESM）
 *
 * 远端地址到网页地址的转换规则必须钉死：它决定了「打开 Git 仓库」按钮
 * 是可用还是禁用，也决定会不会把凭据带进浏览器地址栏。
 *
 * 用法：node test/remote.test.mjs
 */
import assert from 'node:assert/strict'

import { webUrlOf } from '../src/util/remote.js'

const results = []
function test(name, fn) {
  results.push({ name, fn })
}

test('scp 形式（git@host:owner/repo.git）', () => {
  assert.equal(webUrlOf('git@github.com:owner/repo.git'), 'https://github.com/owner/repo')
  assert.equal(webUrlOf('git@gitlab.example.com:group/sub/repo.git'), 'https://gitlab.example.com/group/sub/repo')
})

test('ssh:// 形式（含端口与用户）', () => {
  assert.equal(webUrlOf('ssh://git@github.com/owner/repo.git'), 'https://github.com/owner/repo')
  assert.equal(webUrlOf('ssh://git@host:2222/owner/repo.git'), 'https://host/owner/repo')
})

test('https / http / git 形式', () => {
  assert.equal(webUrlOf('https://github.com/owner/repo.git'), 'https://github.com/owner/repo')
  assert.equal(webUrlOf('https://github.com/owner/repo'), 'https://github.com/owner/repo')
  assert.equal(webUrlOf('http://host/owner/repo.git/'), 'http://host/owner/repo')
  assert.equal(webUrlOf('git://host/owner/repo.git'), 'https://host/owner/repo')
})

test('不把凭据带进地址栏', () => {
  assert.equal(webUrlOf('https://user:token@github.com/owner/repo.git'), 'https://github.com/owner/repo')
})

test('本地路径 / 空值 / 非法输入 → null（按钮禁用，保证不会弹必然失败的窗口）', () => {
  assert.equal(webUrlOf('C:\\Users\\me\\repos\\x'), null)
  assert.equal(webUrlOf('/home/me/repos/x'), null)
  assert.equal(webUrlOf('file:///home/me/repos/x'), null)
  assert.equal(webUrlOf(''), null)
  assert.equal(webUrlOf('   '), null)
  assert.equal(webUrlOf(undefined), null)
  assert.equal(webUrlOf(null), null)
})

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
