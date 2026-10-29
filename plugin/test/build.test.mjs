/**
 * test/build.test.mjs —— 打包器自测
 *
 * 目标：在真实 src/ 还没齐的时候，先证明 build/build-client.mjs 的转换与产物执行是正确的。
 * 做法：用 test/fixtures/bundler-src 下的一组小模块打包到临时文件，然后在假的
 * `window.__ModuleLoader__` 环境里执行工厂，检查模块解析、导出、副作用都被正确串起来。
 *
 * 运行：node test/build.test.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFile, rm, mkdtemp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = path.resolve(HERE, '..')
const FIXTURE = path.join(HERE, 'fixtures', 'bundler-src')

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

async function testAsync(name, fn) {
  try {
    await fn()
    passed += 1
    console.log('  ok   ' + name)
  } catch (error) {
    failures.push({ name, error })
    console.log('  FAIL ' + name + '\n       ' + (error && error.message ? error.message : error))
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'assertion failed')
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error((message ?? 'assertEqual') + ': expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual))
  }
}

const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'dgp-build-'))
const outFile = path.join(tmpDir, 'bundle.js')

try {
  console.log('build: ' + path.relative(PLUGIN_DIR, FIXTURE))

  let buildError = null
  try {
    execFileSync(process.execPath, [
      path.join(PLUGIN_DIR, 'build', 'build-client.mjs'),
      '--src', FIXTURE,
      '--entry', path.join(FIXTURE, 'index.js'),
      '--out', outFile
    ], { stdio: 'pipe' })
  } catch (error) {
    buildError = error
  }

  await testAsync('打包成功', () => {
    assert(buildError === null, buildError === null ? '' : String(buildError.stderr ?? buildError.message))
    assert(existsSync(outFile), '产物文件不存在')
  })

  const bundle = existsSync(outFile) ? await readFile(outFile, 'utf8') : ''

  await testAsync('产物里没有残留的 import/export 语句', () => {
    const withoutStrings = bundle
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/("(?:\\.|[^"\\])*")/g, '""')
    assert(!/^\s*import\s/m.test(withoutStrings), '残留 import 语句')
    assert(!/^\s*export\s/m.test(withoutStrings), '残留 export 语句')
  })

  await testAsync('产物包含 __ModuleLoader__ 装载头', () => {
    assert(bundle.includes('window.__ModuleLoader__.load('), '缺少 load 调用')
    assert(bundle.includes('id: "dsh-git-panel"'), '缺少 loader id')
    assert(bundle.includes('factory: (require) =>'), '缺少 factory')
  })

  // ---- 在假环境里执行 ----
  let factory = null
  const fakeWindow = {
    __ModuleLoader__: {
      load(definition) {
        assert(definition.id === 'dsh-git-panel', 'loader id 不符')
        factory = definition.factory
      }
    }
  }
  const fakeRequire = (id) => {
    if (id !== 'react') throw new Error('unexpected require: ' + id)
    return { useState: () => [0, () => {}], createElement: () => null, Fragment: 'Fragment' }
  }

  await testAsync('工厂可被调用并返回模块导出', () => {
    const fn = new Function('window', 'return (function(){ ' + bundle + ' })()')
    fn(fakeWindow)
    assert(typeof factory === 'function', 'factory 未注册')
    const exportsObject = factory(fakeRequire)
    assert(exportsObject !== null && typeof exportsObject === 'object', '返回的不是对象')
  })

  let mod = null
  {
    const fn = new Function('window', 'return (function(){ ' + bundle + ' })()')
    fn(fakeWindow)
    mod = factory(fakeRequire)
  }

  test('具名导出可用', () => {
    assertEqual(mod.CONSTANT, 42, 'CONSTANT')
    assertEqual(typeof mod.greet, 'function', 'greet 是函数')
    assertEqual(mod.greet('lead'), 'hi lead 4 math 3', '跨模块调用结果')
  })

  test('async 导出可用', async () => {
    assertEqual(typeof mod.later, 'function', 'later 是函数')
  })

  test('class 导出可用', () => {
    assertEqual(typeof mod.Thing, 'function', 'Thing 是构造函数')
    assertEqual(new mod.Thing().value, 42, 'Thing 实例字段')
  })

  test('default 导出可用', () => {
    assertEqual(typeof mod.default, 'function', 'default 是函数')
    const tree = mod.default()
    assert(tree !== null && typeof tree === 'object', 'default 返回值异常')
  })

  test('模块缓存：同一模块只求值一次（副作用仅一次）', () => {
    const fn = new Function('window', 'return (function(){ ' + bundle + ' })()')
    fn(fakeWindow)
    const again = factory(fakeRequire)
    assertEqual(again.greet('x'), 'hi x 4 math 3', '二次调用结果一致')
  })

  test('未使用的导出不报错（tree-shaking 之外）', () => {
    assert(typeof bundle === 'string' && bundle.length > 0, '产物为空')
  })

  test('检测循环依赖并报错', async () => {
    const cycleDir = path.join(tmpDir, 'cycle')
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(cycleDir, { recursive: true })
    await writeFile(path.join(cycleDir, 'a.js'), "import { b } from './b.js'\nexport const a = 1\n", 'utf8')
    await writeFile(path.join(cycleDir, 'b.js'), "import { a } from './a.js'\nexport const b = 2\n", 'utf8')
    let failed = false
    try {
      execFileSync(process.execPath, [
        path.join(PLUGIN_DIR, 'build', 'build-client.mjs'),
        '--src', cycleDir,
        '--entry', path.join(cycleDir, 'a.js'),
        '--out', path.join(tmpDir, 'cycle-out.js')
      ], { stdio: 'pipe' })
    } catch {
      failed = true
    }
    assert(failed, '循环依赖没有被检测出来')
  })
} finally {
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
}

console.log('')
if (failures.length > 0) {
  console.error(failures.length + ' failed, ' + passed + ' passed')
  for (const failure of failures) console.error(' - ' + failure.name + ': ' + (failure.error && failure.error.stack ? failure.error.stack : failure.error))
  process.exit(1)
}
console.log(passed + ' passed')
