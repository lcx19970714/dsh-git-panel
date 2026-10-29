/**
 * host 半体离线测试：假 ctx + 真实 git 沙盒仓库（_sandbox/repo，由 test/make-fixture.mjs 生成）。
 * 用法：node test/host.test.mjs
 *
 * 覆盖：apply() 注册通道、project/resolve（cwd / 活会话 / 冷会话 / 普通目录多仓库）、
 * status（含缓存）、diff（暂存/未暂存/未跟踪/二进制/重命名/删除）、file/read、tree/list、
 * roots/add·remove + 持久化、路径逃逸与错误映射、损坏配置恢复。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/* ---------------------------------------------------------------- 准备环境 */

const FIXTURE = path.resolve(import.meta.dirname, '../../_sandbox/repo')
if (!existsSync(path.join(FIXTURE, '.git'))) {
  console.error('缺少沙盒仓库，请先运行：')
  console.error(`  node "${path.resolve(import.meta.dirname, 'make-fixture.mjs')}" "${FIXTURE}"`)
  process.exit(1)
}

const PREVIOUS_DSH_HOME = process.env.DSH_HOME
const TEMP_HOME = mkdtempSync(path.join(os.tmpdir(), 'dgp-host-home-'))
// 必须在 import config.js / index.js 之前钉住 DSH_HOME（config.js 在调用时解析，顺序仍然重要）
process.env.DSH_HOME = TEMP_HOME

const cleanupDirs = [TEMP_HOME]

const plugin = await import('../index.js')
const config = await import('../host/config.js')

/* ---------------------------------------------------------------- 假 ctx */

const storedSessions = {
  'session-cold': { header: { cwd: FIXTURE } }
}
const logs = []
/** path → 已注册的精确 Fetch 路由（模拟连接服务的 fetchRoutes 表）。 */
const routes = new Map()
let captured = null

const fakeCtx = {
  connection: {
    fetch: {
      register(route) {
        // 模拟真实连接服务：同一路径第二次注册必须抛错
        if (routes.has(route.path)) throw new Error(`connection: exact Fetch route ${JSON.stringify(route.path)} is already registered`)
        routes.set(route.path, route)
        captured = route
        return () => routes.delete(route.path)
      }
    }
  },
  sessions: {
    get(id) {
      if (id === 'session-fixture') return { header: { cwd: FIXTURE } }
      return undefined
    }
  },
  effect(fn) {
    return fn()
  },
  inject(_deps, callback) {
    callback(fakeCtx)
  },
  get(serviceName) {
    if (serviceName === 'sessionPersistence') {
      return {
        async stat(id) {
          return storedSessions[id]
        }
      }
    }
    return undefined
  },
  logger: {
    info: (message) => logs.push(['info', message]),
    warn: (message) => logs.push(['warn', message]),
    error: (message) => logs.push(['error', message]),
    debug: (message) => logs.push(['debug', message])
  }
}

plugin.apply(fakeCtx)
if (captured === null) {
  console.error('apply() 没有注册任何 Fetch 路由')
  process.exit(1)
}

/**
 * 用真实的「路由 → fetch(handler)」链路发一次请求。
 * @param {string} endpoint
 * @param {object} payload
 * @returns {Promise<object>} 解开的回包 result（{ok,...}）
 */
async function callRoute(endpoint, payload) {
  const path = plugin.routePathOf(endpoint)
  const route = routes.get(path)
  if (route === undefined) throw new Error('没有注册路由: ' + path)
  const rpcId = 'rpc-' + (++callRoute.seq)
  const request = {
    json: async () => ({ type: 'client-request', rpcId, method: 'dsh-git/' + endpoint, payload })
  }
  const response = await route.fetch(request)
  const body = await response.json()
  assert.equal(body.type, 'server-response')
  assert.equal(body.rpcId, rpcId, 'rpcId 必须原样回传')
  return body.result
}
callRoute.seq = 0

/** 老的调用形态：直接按 endpoint 发一次请求（等价于客户端一次 rpc.call）。 */
const handler = (endpoint, payload) => callRoute(endpoint, payload)

/* -------------------------------------------------------------- 工具函数 */

const toPosix = (value) => String(value).replace(/\\/g, '/')
const eqPath = (actual, expected) =>
  toPosix(path.resolve(actual)).toLowerCase() === toPosix(path.resolve(expected)).toLowerCase()

function tempDir(prefix) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix))
  cleanupDirs.push(dir)
  return dir
}

/** 建一个有一个提交的 git 仓库。 */
function makeRepo(dir) {
  mkdirSync(dir, { recursive: true })
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test User')
  git('config', 'core.autocrlf', 'false')
  writeFileSync(path.join(dir, 'hello.txt'), 'hello\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'init')
  return dir
}

/** 直接调用 handler；成功返回 value，失败抛带 code 的 Error。 */
async function callOk(endpoint, payload, signal) {
  const result = await handler(endpoint, payload, signal)
  assert.equal(typeof result, 'object', `${endpoint} 必须返回信封对象`)
  assert.equal(result.ok, true, `${endpoint} 期望成功，实际：${JSON.stringify(result)}`)
  return result.value
}

/** 直接调用 handler；断言失败并返回 error 对象。 */
async function callFail(endpoint, payload) {
  const result = await handler(endpoint, payload)
  assert.equal(typeof result, 'object', `${endpoint} 必须返回信封对象`)
  assert.equal(result.ok, false, `${endpoint} 期望失败，实际成功`)
  assert.equal(typeof result.error, 'object')
  assert.equal(typeof result.error.code, 'string')
  assert.equal(typeof result.error.message, 'string')
  assert.equal(typeof result.error.details, 'object')
  return result.error
}

/* ------------------------------------------------------------------ 用例 */

const tests = []
function test(name, fn) {
  tests.push({ name, fn })
}

test('apply() 为每个 endpoint 注册一条 /api/dsh-git/* 的精确 Fetch 路由', async () => {
  assert.equal(plugin.name, 'dsh-git-panel')
  for (const endpoint of ['project/resolve', 'roots/add', 'roots/remove', 'status', 'diff', 'file/read', 'tree/list']) {
    assert.ok(plugin.ENDPOINTS.includes(endpoint), 'ENDPOINTS 缺少 ' + endpoint)
    const path = plugin.routePathOf(endpoint)
    assert.equal(path, '/api/dsh-git/' + endpoint, '路由路径')
    const route = routes.get(path)
    assert.ok(route !== undefined, '没有注册路由 ' + path)
    assert.deepEqual(route.methods, ['POST'], '路由只接受 POST')
    assert.equal(route.requestBody, 'buffered')
    assert.equal(typeof route.fetch, 'function')
  }
  // 路由总数必须与端点清单一致（不多不少）
  assert.equal(routes.size, plugin.ENDPOINTS.length, '路由数量')
})

test('路由 fetch：信封校验 + method 匹配 + rpcId 原样回传', async () => {
  const route = routes.get('/api/dsh-git/status')
  // 非 JSON body
  const badBody = await route.fetch({ json: async () => { throw new Error('nope') } })
  assert.equal(badBody.status, 400)
  // 信封不合格
  const badEnvelope = await route.fetch({ json: async () => ({ hello: 'world' }) })
  assert.equal(badEnvelope.status, 400)
  // method 不匹配
  const mismatch = await route.fetch({
    json: async () => ({ type: 'client-request', rpcId: 'r9', method: 'dsh-git/diff', payload: {} })
  }).then((response) => response.json())
  assert.equal(mismatch.rpcId, 'r9', 'rpcId 必须原样回传')
  assert.equal(mismatch.result.ok, false)
  assert.equal(mismatch.result.error.code, 'bad-request')
})

test('路由 fetch：能拿到真实 status（走完整信封链路）', async () => {
  const result = await callRoute('status', { rootPath: FIXTURE })
  assert.equal(result.ok, true, 'status 调用失败: ' + JSON.stringify(result))
  assert.equal(typeof result.value.repoRoot, 'string')
  assert.ok(Array.isArray(result.value.files), 'files 应是数组')
})

test('路由注册是进程内单例：重复 apply 只注册一次，最后一个 disposer 才注销', async () => {
  // 全新模块实例，避免与该文件顶部的 apply 共享模块级计数
  const fresh = await import('../index.js?singleton-probe')
  const registered = []
  const collected = []
  const released = []

  const fakeCtx2 = {
    connection: {
      fetch: {
        register(route) {
          // 模拟真实连接服务：同一路径第二次注册必须抛错
          if (registered.includes(route.path)) throw new Error('connection: exact Fetch route "' + route.path + '" is already registered')
          registered.push(route.path)
          return () => released.push(route.path)
        }
      }
    },
    effect(fn) {
      const dispose = fn()
      collected.push(dispose)
      return dispose
    },
    inject(_deps, callback) {
      callback(fakeCtx2)
    },
    sessions: { get: () => undefined },
    get: () => undefined,
    logger: { info() {}, warn() {}, error() {}, debug() {} }
  }

  const expected = fresh.ENDPOINTS.map((endpoint) => fresh.routePathOf(endpoint))

  // 两次 apply（HMR 重载会走到这里）不应该抛，也不应该注册两遍路由
  fresh.apply(fakeCtx2)
  fresh.apply(fakeCtx2)
  assert.deepEqual(registered, expected, '每个 endpoint 只应注册一条路由')
  assert.equal(collected.length, 2, '两次 apply 应各产生一个 disposer')

  // 先释放一个：路由仍应存活
  collected[0]()
  assert.deepEqual(released, [], '还有一个持有者时不应注销')

  // 释放最后一个：整组路由注销
  collected[1]()
  assert.deepEqual(released, expected, '最后一个持有者释放后应注销全部路由')
  // 再次释放同一个 disposer 不重复扣减
  collected[1]()
  assert.deepEqual(released, expected, '重复释放不应多注销一次')
})


test('config.projectKey 规范化为正斜杠（Windows 下额外小写）', async () => {
  const key = config.projectKey(FIXTURE)
  // projectKey 只在 win32 上小写（大小写不敏感的文件系统），其他平台保留原样
  const expected = process.platform === 'win32'
    ? toPosix(path.resolve(FIXTURE)).toLowerCase()
    : toPosix(path.resolve(FIXTURE))
  assert.equal(key, expected)
  assert.ok(!key.includes('\\'))
  // 尾斜杠不影响键
  assert.equal(config.projectKey(FIXTURE + path.sep), key)
  // 相对路径会被解析成绝对路径
  assert.ok(path.isAbsolute(config.projectKey('.')))
})

test('config.addExtra 规范化、去重、并发写串行化', async () => {
  const projectRoot = path.join(tempDir('dgp-config-proj-'), 'proj')
  mkdirSync(projectRoot, { recursive: true })

  const a = path.join(tempDir('dgp-config-a-'), 'repo-a')
  const b = path.join(tempDir('dgp-config-b-'), 'repo-b')
  const c = path.join(tempDir('dgp-config-c-'), 'repo-c')

  // 并发写：串行化后三条都应落盘，不互相覆盖
  await Promise.all([
    config.addExtra(projectRoot, a),
    config.addExtra(projectRoot, b + '\\'),
    config.addExtra(projectRoot, c)
  ])
  const listed = await config.listExtras(projectRoot)
  assert.equal(listed.length, 3, '并发添加不应丢条目：' + JSON.stringify(listed))
  assert.ok(listed.every((item) => !item.includes('\\') && !item.endsWith('/')), '应全是正斜杠无尾斜杠')
  assert.ok(listed.some((item) => eqPath(item, a)))
  assert.ok(listed.some((item) => eqPath(item, b)))

  // 重复添加（大小写不同也算同一个）不产生第二条
  await config.addExtra(projectRoot, a.toUpperCase())
  assert.equal((await config.listExtras(projectRoot)).length, 3)

  // 移除幂等
  await config.removeExtra(projectRoot, a)
  await config.removeExtra(projectRoot, a)
  assert.equal((await config.listExtras(projectRoot)).length, 2)

  // 目录下手写坏 JSON 之外的正常文件仍可读
  assert.ok(existsSync(config.configPath()))
})

test('project/resolve：cwd 解析出 primary + 嵌套 discovered', async () => {
  const value = await callOk('project/resolve', { cwd: FIXTURE })
  assert.equal(value.projectRoot, toPosix(path.resolve(FIXTURE)))
  assert.ok(Array.isArray(value.roots))
  assert.ok(Array.isArray(value.warnings))
  assert.doesNotThrow(() => JSON.stringify(value))

  const primary = value.roots[0]
  assert.equal(primary.kind, 'primary', 'primary 必须排在第一位：' + JSON.stringify(value.roots.map((r) => r.kind)))
  assert.equal(primary.isGit, true)
  assert.equal(primary.path, toPosix(path.resolve(FIXTURE)))
  assert.ok(eqPath(primary.repoRoot, FIXTURE))
  assert.equal(primary.id, primary.repoRoot)
  assert.equal(primary.branch, 'main')
  assert.match(primary.head, /^[0-9a-f]{7,}$/)
  assert.equal(primary.ahead, 0)
  assert.equal(primary.behind, 0)
  assert.equal(primary.dirty, undefined, 'resolveRoots 不应跑 status，dirty 必须留空')
  assert.equal(primary.name, 'repo')

  const discovered = value.roots.filter((root) => root.kind === 'discovered')
  assert.equal(discovered.length, 1, '应发现 1 个内嵌仓库：' + JSON.stringify(value.roots))
  assert.ok(eqPath(discovered[0].path, path.join(FIXTURE, 'packages/sub-repo')))
  assert.ok(eqPath(discovered[0].repoRoot, path.join(FIXTURE, 'packages/sub-repo')))
  assert.equal(discovered[0].isGit, true)
  assert.equal(discovered[0].branch, 'main')
  assert.equal(discovered[0].name, 'sub-repo')

  // 按 repoRoot 去重
  const ids = value.roots.map((root) => root.id.toLowerCase())
  assert.equal(new Set(ids).size, ids.length, 'id 不应重复：' + JSON.stringify(value.roots.map((r) => r.id)))
})

test('project/resolve：活会话 / 冷会话（sessionPersistence）都能解析', async () => {
  const live = await callOk('project/resolve', { sessionId: 'session-fixture' })
  assert.equal(live.projectRoot, toPosix(path.resolve(FIXTURE)))

  const cold = await callOk('project/resolve', { sessionId: 'session-cold' })
  assert.equal(cold.projectRoot, toPosix(path.resolve(FIXTURE)))

  const unknown = await callFail('project/resolve', { sessionId: 'session-nope' })
  assert.equal(unknown.code, 'no-session')

  const emptyPayload = await callFail('project/resolve', {})
  assert.equal(emptyPayload.code, 'no-session')

  const missingDir = await callFail('project/resolve', { cwd: path.join(TEMP_HOME, 'nope') })
  assert.equal(missingDir.code, 'not-found')
})

test('project/resolve：普通目录 → 浏览根 + 嵌套 discovered', async () => {
  const plain = tempDir('dgp-plain-')
  const nestedRepo = makeRepo(path.join(plain, 'nested', 'repo'))
  mkdirSync(path.join(plain, 'docs'), { recursive: true })

  const value = await callOk('project/resolve', { cwd: plain })
  assert.equal(value.roots.length, 2, '应是浏览根 + 1 个 discovered：' + JSON.stringify(value.roots))

  // 浏览根永远第一：项目根不是仓库时合成 isGit:false 的 primary，保证文件浏览可用
  const browse = value.roots[0]
  assert.equal(browse.kind, 'primary')
  assert.equal(browse.isGit, false)
  assert.equal(browse.repoRoot, null)
  assert.ok(eqPath(browse.path, plain))
  assert.equal(browse.id, toPosix(path.resolve(plain)))
  assert.equal(browse.branch, null)
  assert.equal(browse.head, null)
  assert.equal(browse.name, path.basename(plain))
  assert.equal(browse.dirty, undefined)

  const root = value.roots[1]
  assert.equal(root.kind, 'discovered')
  assert.equal(root.isGit, true)
  assert.ok(eqPath(root.path, nestedRepo))
  assert.ok(eqPath(root.repoRoot, nestedRepo))
  assert.equal(root.branch, 'main')
  assert.equal(value.warnings.length, 0, '不应有告警：' + JSON.stringify(value.warnings))
})

test('project/resolve：普通目录（完全无 git）→ 单一浏览根，tree/list 与 file/read 可用', async () => {
  const plain = tempDir('dgp-browse-')
  mkdirSync(path.join(plain, 'sub'), { recursive: true })
  writeFileSync(path.join(plain, 'hello.txt'), 'hello browse\n')
  writeFileSync(path.join(plain, 'sub', 'nested.md'), '# nested\n')

  const value = await callOk('project/resolve', { cwd: plain })
  assert.equal(value.roots.length, 1, '非仓库项目必须仍有一个浏览根：' + JSON.stringify(value.roots))
  const browse = value.roots[0]
  assert.equal(browse.kind, 'primary')
  assert.equal(browse.isGit, false)
  assert.equal(browse.repoRoot, null)
  assert.ok(eqPath(browse.path, plain))
  assert.equal(browse.id, toPosix(path.resolve(plain)))
  assert.equal(browse.branch, null)
  assert.equal(browse.head, null)
  assert.equal(browse.upstream, null)
  assert.equal(browse.ahead, 0)
  assert.equal(browse.behind, 0)
  assert.equal(browse.error, null)
  assert.equal(browse.dirty, undefined)
  assert.equal(browse.name, path.basename(plain))
  assert.equal(value.warnings.length, 0, '不应有告警：' + JSON.stringify(value.warnings))
  assert.doesNotThrow(() => JSON.stringify(value))

  // 浏览根不是仓库：客户端不查 status，但 tree/list 与 file/read 必须直接可用（关键路径）
  const listing = await callOk('tree/list', { rootPath: browse.path, path: '' })
  assert.equal(listing.truncated, false)
  assert.ok(listing.entries.some((entry) => entry.name === 'hello.txt' && entry.type === 'file'))
  assert.ok(listing.entries.some((entry) => entry.name === 'sub' && entry.type === 'dir'))

  const subListing = await callOk('tree/list', { rootPath: browse.path, path: 'sub' })
  assert.ok(subListing.entries.some((entry) => entry.name === 'nested.md' && entry.type === 'file'))

  const file = await callOk('file/read', { rootPath: browse.path, path: 'hello.txt' })
  assert.equal(file.kind, 'text')
  assert.ok(file.text.includes('hello browse'))

  const nested = await callOk('file/read', { rootPath: browse.path, path: 'sub/nested.md' })
  assert.equal(nested.kind, 'text')
  assert.ok(nested.text.includes('# nested'))

  // 绝对路径也接受
  const absolute = await callOk('file/read', {
    rootPath: browse.path,
    path: path.join(plain, 'hello.txt')
  })
  assert.equal(absolute.kind, 'text')

  // 该根不是仓库：status 明确返回 not-a-repository（客户端不会调用，但契约要稳）
  const statusError = await callFail('status', { rootPath: browse.path })
  assert.equal(statusError.code, 'not-a-repository')

  // 浏览根一样不允许逃逸
  const escape = await callFail('file/read', { rootPath: browse.path, path: '../escape.txt' })
  assert.equal(escape.code, 'outside-root')
})

test('project/resolve：同名根用父目录名消歧', async () => {
  const plain = tempDir('dgp-twins-')
  makeRepo(path.join(plain, 'one', 'twin'))
  makeRepo(path.join(plain, 'two', 'twin'))

  const value = await callOk('project/resolve', { cwd: plain })
  assert.equal(value.roots.length, 3, '浏览根 + 2 个 discovered：' + JSON.stringify(value.roots))
  assert.equal(value.roots[0].kind, 'primary')
  assert.equal(value.roots[0].isGit, false)
  const names = value.roots
    .filter((root) => root.kind === 'discovered')
    .map((root) => root.name)
    .sort()
  assert.deepEqual(names, ['one/twin', 'two/twin'])
  const ids = new Set(value.roots.map((root) => root.id.toLowerCase()))
  assert.equal(ids.size, 3, 'id 不应重复')
})

test('status：全状态覆盖 + dirty + 行数统计', async () => {
  const value = await callOk('status', { rootPath: FIXTURE })
  assert.doesNotThrow(() => JSON.stringify(value))
  assert.ok(eqPath(value.repoRoot, FIXTURE))
  assert.equal(value.branch, 'main')
  assert.match(value.head, /^[0-9a-f]{7,}$/)
  assert.equal(value.detached, false)
  assert.ok(Array.isArray(value.files))
  assert.equal(value.dirty, value.counts.total)
  assert.ok(value.counts.total >= 9, '夹具应有至少 9 个变更：' + JSON.stringify(value.counts))
  assert.equal(value.counts.conflicted, 0)
  assert.ok(value.counts.staged >= 2, 'staged 计数：' + JSON.stringify(value.counts))
  assert.ok(value.counts.unstaged >= 3, 'unstaged 计数：' + JSON.stringify(value.counts))
  assert.equal(value.counts.untracked, 6, 'untracked 计数：' + JSON.stringify(value.counts))
  assert.equal(value.truncated, false)

  const byPath = new Map(value.files.map((file) => [file.path, file]))
  const app = byPath.get('src/app.js')
  assert.ok(app, '应有 src/app.js')
  assert.equal(app.status, 'M')
  assert.equal(app.staged, false)
  assert.equal(app.unstaged, true)
  assert.equal(app.adds, 3)
  assert.equal(app.dels, 1)

  const util = byPath.get('src/util.ts')
  assert.ok(util, '应有 src/util.ts')
  assert.equal(util.staged, true)
  assert.equal(util.unstaged, false)
  assert.equal(util.adds, 1)

  const renamed = byPath.get('src/renamed/renamed.txt')
  assert.ok(renamed, '重命名新路径应在列表里：' + [...byPath.keys()].join(', '))
  assert.equal(renamed.status, 'R')
  assert.equal(renamed.oldPath, 'src/will-rename.txt')
  assert.equal(renamed.staged, true)

  const deleted = byPath.get('src/will-delete.txt')
  assert.equal(deleted.status, 'D')
  assert.equal(deleted.unstaged, true)

  const todo = byPath.get('notes/todo.md')
  assert.equal(todo.untracked, true)
  assert.equal(todo.status, '?')

  const logo = byPath.get('assets/logo.bin')
  assert.equal(logo.binary, true, '二进制应被 numstat 标记')

  assert.ok(byPath.get('中文目录/说明.md'), '应支持中文路径')
})

test('status：1.2s 内重复请求命中缓存（内容一致）', async () => {
  // 走真实路由时返回的是 JSON 序列化后的副本，所以断言内容一致而非对象同一性
  const first = await callOk('status', { rootPath: FIXTURE })
  const second = await callOk('status', { rootPath: FIXTURE })
  assert.deepEqual(second, first, 'TTL 内应返回同样的内容')

  plugin.clearStatusCache()
  const third = await callOk('status', { rootPath: FIXTURE })
  assert.deepEqual(third, first, '清缓存后重新查询结果应一致')
  assert.equal(third.counts.total, first.counts.total)
})

test('status：非仓库 / 不存在 → 结构化错误', async () => {
  const plain = tempDir('dgp-status-plain-')
  const notRepo = await callFail('status', { rootPath: plain })
  assert.equal(notRepo.code, 'not-a-repository')

  const missing = await callFail('status', { rootPath: path.join(TEMP_HOME, 'nope') })
  assert.equal(missing.code, 'not-found')

  const relative = await callFail('status', { rootPath: 'relative/dir' })
  assert.equal(relative.code, 'bad-request')

  const noRoot = await callFail('status', {})
  assert.equal(noRoot.code, 'bad-request')
})

test('diff：未暂存 / 已暂存 / 未跟踪 / 二进制 / 重命名', async () => {
  const unstaged = await callOk('diff', { rootPath: FIXTURE, path: 'src/app.js' })
  assert.equal(unstaged.kind, 'text')
  assert.equal(unstaged.stats.adds, 3)
  assert.equal(unstaged.stats.dels, 1)
  assert.equal(unstaged.language, 'javascript')
  assert.equal(unstaged.hunks.length, 1)
  const removed = unstaged.hunks[0].lines.find((line) => line.kind === 'del')
  assert.equal(removed.text, '  return 1')
  assert.doesNotThrow(() => JSON.stringify(unstaged))

  const staged = await callOk('diff', { rootPath: FIXTURE, path: 'src/util.ts', staged: true })
  assert.equal(staged.kind, 'text')
  assert.equal(staged.stats.adds, 1)
  assert.equal(staged.stats.dels, 0)

  const untracked = await callOk('diff', {
    rootPath: FIXTURE,
    path: 'notes/todo.md',
    untracked: true
  })
  assert.equal(untracked.kind, 'text')
  assert.equal(untracked.newFile, true)
  assert.equal(untracked.stats.adds, 2)
  assert.equal(untracked.hunks[0].lines[0].text, '- buy milk')

  const binary = await callOk('diff', { rootPath: FIXTURE, path: 'assets/logo.bin' })
  assert.equal(binary.kind, 'binary')

  // 夹具里的重命名没有内容改动；按新路径做 --cached diff 时 git 视为新增
  const renamed = await callOk('diff', {
    rootPath: FIXTURE,
    path: 'src/renamed/renamed.txt',
    staged: true
  })
  assert.equal(renamed.kind, 'text')
  assert.ok(renamed.stats.adds >= 2)
})

test('diff：contextLines / ignoreWhitespace / 绝对路径 / 删除文件', async () => {
  const narrow = await callOk('diff', { rootPath: FIXTURE, path: 'src/app.js', contextLines: 0 })
  assert.equal(narrow.kind, 'text')
  const wide = await callOk('diff', { rootPath: FIXTURE, path: 'src/app.js', contextLines: 50 })
  assert.ok(narrow.hunks[0].lines.length <= wide.hunks[0].lines.length)

  const noWhitespace = await callOk('diff', {
    rootPath: FIXTURE,
    path: 'src/app.js',
    ignoreWhitespace: true
  })
  assert.equal(noWhitespace.kind, 'text')

  // 客户端可以传相对路径，也可以传 absPath
  const absolute = await callOk('diff', { rootPath: FIXTURE, path: path.join(FIXTURE, 'src/app.js') })
  assert.equal(absolute.kind, 'text')
  assert.equal(absolute.stats.adds, 3)

  const deleted = await callOk('diff', { rootPath: FIXTURE, path: 'src/will-delete.txt' })
  assert.equal(deleted.kind, 'text')
  assert.ok(deleted.stats.dels >= 1)
  assert.ok(deleted.hunks[0].lines.every((line) => line.kind === 'del'))
})

test('diff：路径逃逸 / .git / 非仓库 → outside-root / forbidden-path / not-a-repository', async () => {
  const escape = await callFail('diff', { rootPath: FIXTURE, path: '../escape.txt' })
  assert.equal(escape.code, 'outside-root')

  const gitDir = await callFail('diff', { rootPath: FIXTURE, path: '.git/config' })
  assert.equal(gitDir.code, 'forbidden-path')

  const plain = tempDir('dgp-diff-plain-')
  const notRepo = await callFail('diff', { rootPath: plain, path: 'a.txt' })
  assert.equal(notRepo.code, 'not-a-repository')

  const noPath = await callFail('diff', { rootPath: FIXTURE })
  assert.equal(noPath.code, 'bad-request')

  const rootItself = await callFail('diff', { rootPath: FIXTURE, path: '' })
  assert.equal(rootItself.code, 'bad-request')
})

test('file/read：文本 / 二进制 / 缺失 / 目录 / 语言与换行', async () => {
  const text = await callOk('file/read', { rootPath: FIXTURE, path: 'src/app.js' })
  assert.equal(text.kind, 'text')
  assert.ok(text.text.includes('return 42'))
  assert.equal(text.language, 'javascript')
  assert.equal(text.eol, 'lf')
  assert.ok(text.size > 0)
  assert.ok(text.lines > 0)
  assert.doesNotThrow(() => JSON.stringify(text))

  const binary = await callOk('file/read', { rootPath: FIXTURE, path: 'assets/logo.bin' })
  assert.equal(binary.kind, 'binary')

  const missing = await callOk('file/read', { rootPath: FIXTURE, path: 'src/does-not-exist.txt' })
  assert.equal(missing.kind, 'missing')

  const directory = await callOk('file/read', { rootPath: FIXTURE, path: 'src' })
  assert.equal(directory.kind, 'directory')

  const chinese = await callOk('file/read', { rootPath: FIXTURE, path: '中文目录/说明.md' })
  assert.equal(chinese.kind, 'text')
  assert.ok(chinese.text.includes('中文内容'))

  // 子目录作为根也能读
  const fromSub = await callOk('file/read', { rootPath: path.join(FIXTURE, 'src'), path: 'app.js' })
  assert.equal(fromSub.kind, 'text')
})

test('file/read：路径校验', async () => {
  const escape = await callFail('file/read', { rootPath: FIXTURE, path: '../escape.txt' })
  assert.equal(escape.code, 'outside-root')

  const gitDir = await callFail('file/read', { rootPath: FIXTURE, path: '.git/HEAD' })
  assert.equal(gitDir.code, 'forbidden-path')

  const noPath = await callFail('file/read', { rootPath: FIXTURE })
  assert.equal(noPath.code, 'bad-request')
})

test('tree/list：目录优先 + 自然序 + truncated', async () => {
  const rootListing = await callOk('tree/list', { rootPath: FIXTURE, path: '' })
  assert.ok(Array.isArray(rootListing.entries))
  assert.equal(rootListing.truncated, false)
  const rootNames = rootListing.entries.map((entry) => entry.name)
  assert.ok(rootNames.includes('src'))
  assert.ok(rootNames.includes('README.md'))
  const firstFile = rootListing.entries.findIndex((entry) => entry.type === 'file')
  const lastDir = rootListing.entries.map((entry) => entry.type).lastIndexOf('dir')
  assert.ok(lastDir < firstFile, '目录应排在文件前：' + JSON.stringify(rootListing.entries))

  const srcListing = await callOk('tree/list', { rootPath: FIXTURE, path: 'src' })
  const srcNames = srcListing.entries.map((entry) => entry.name)
  assert.ok(srcNames.includes('app.js'))
  assert.ok(srcNames.includes('renamed'))
  const appEntry = srcListing.entries.find((entry) => entry.name === 'app.js')
  assert.equal(appEntry.type, 'file')
  assert.equal(appEntry.path, 'app.js')

  // 省略 path 等价于根目录
  const implicit = await callOk('tree/list', { rootPath: FIXTURE })
  assert.deepEqual(
    implicit.entries.map((entry) => entry.name),
    rootListing.entries.map((entry) => entry.name)
  )
})

test('tree/list：路径校验与错误码', async () => {
  const escape = await callFail('tree/list', { rootPath: FIXTURE, path: '../../' })
  assert.equal(escape.code, 'outside-root')

  const gitDir = await callFail('tree/list', { rootPath: FIXTURE, path: '.git' })
  assert.equal(gitDir.code, 'forbidden-path')

  const missing = await callFail('tree/list', { rootPath: path.join(TEMP_HOME, 'nope') })
  assert.equal(missing.code, 'not-found')

  const notDir = await callFail('tree/list', { rootPath: FIXTURE, path: 'README.md' })
  assert.equal(notDir.code, 'list-failed')
})

test('roots/add：添加外部仓库 → 立即出现在结果 + 落盘 + 去重', async () => {
  const secondRepo = makeRepo(path.join(tempDir('dgp-extra-'), 'second-repo'))

  const added = await callOk('roots/add', { projectRoot: FIXTURE, path: secondRepo })
  assert.equal(added.projectRoot, toPosix(path.resolve(FIXTURE)))
  assert.doesNotThrow(() => JSON.stringify(added))

  const extra = added.roots.find((root) => root.kind === 'extra')
  assert.ok(extra, '应出现 extra 根：' + JSON.stringify(added.roots.map((r) => r.kind)))
  assert.equal(extra.isGit, true)
  assert.ok(eqPath(extra.path, secondRepo))
  assert.ok(eqPath(extra.repoRoot, secondRepo))
  assert.equal(extra.branch, 'main')
  assert.match(extra.head, /^[0-9a-f]{7,}$/)
  assert.equal(extra.name, 'second-repo')
  assert.equal(extra.dirty, undefined)
  assert.equal(extra.id, extra.repoRoot)

  // 配置落盘
  const configFile = config.configPath()
  assert.ok(existsSync(configFile), '配置文件应存在：' + configFile)
  assert.ok(toPosix(configFile).toLowerCase().startsWith(toPosix(TEMP_HOME).toLowerCase()))
  const onDisk = JSON.parse(readFileSync(configFile, 'utf8'))
  assert.equal(onDisk.version, 1)
  const key = config.projectKey(FIXTURE)
  assert.deepEqual(onDisk.projects[key], [toPosix(secondRepo)])
  // 原子写不留临时文件
  const leftovers = readdirSync(path.dirname(configFile)).filter((name) => name.includes('.tmp-'))
  assert.deepEqual(leftovers, [])

  // 重复添加不会重复出现
  const again = await callOk('roots/add', { projectRoot: FIXTURE, path: secondRepo })
  const extras = again.roots.filter((root) => root.kind === 'extra')
  assert.equal(extras.length, 1)
  assert.deepEqual(await config.listExtras(FIXTURE), [toPosix(secondRepo)])

  // 新进程/新模块实例仍能读回（DSH_HOME 在调用时解析）
  const reloaded = await import('../host/config.js?fresh=' + Date.now())
  assert.deepEqual(await reloaded.listExtras(FIXTURE), [toPosix(secondRepo)])

  // 收尾：不给后续用例留状态
  await callOk('roots/remove', { projectRoot: FIXTURE, path: secondRepo })
  assert.deepEqual(await config.listExtras(FIXTURE), [])
})

test('roots/add：不存在 / 非仓库 / 相对路径 / 缺参 → 结构化错误', async () => {
  const missing = await callFail('roots/add', {
    projectRoot: FIXTURE,
    path: path.join(TEMP_HOME, 'no-such-dir')
  })
  assert.equal(missing.code, 'not-found')

  const plain = tempDir('dgp-add-plain-')
  const notRepo = await callFail('roots/add', { projectRoot: FIXTURE, path: plain })
  assert.equal(notRepo.code, 'not-a-repository')

  const relative = await callFail('roots/add', { projectRoot: FIXTURE, path: 'some/relative/dir' })
  assert.equal(relative.code, 'bad-request')

  const noProject = await callFail('roots/add', { path: plain })
  assert.equal(noProject.code, 'bad-request')

  // 失败不应污染配置
  assert.deepEqual(await config.listExtras(FIXTURE), [])
})

test('roots/remove：移除后消失 + 配置落盘 + 幂等', async () => {
  const removeMe = makeRepo(path.join(tempDir('dgp-remove-'), 'remove-me'))
  const added = await callOk('roots/add', { projectRoot: FIXTURE, path: removeMe })
  assert.ok(added.roots.some((root) => root.kind === 'extra' && eqPath(root.path, removeMe)))

  const removed = await callOk('roots/remove', { projectRoot: FIXTURE, path: removeMe })
  assert.equal(removed.roots.some((root) => root.kind === 'extra'), false, '移除后不应再有 extra 根')
  assert.ok(eqPath(removed.projectRoot, FIXTURE))

  const onDisk = JSON.parse(readFileSync(config.configPath(), 'utf8'))
  assert.deepEqual(onDisk.projects[config.projectKey(FIXTURE)] ?? [], [])

  // 幂等：再移除一次仍然是成功
  const twice = await callOk('roots/remove', { projectRoot: FIXTURE, path: removeMe })
  assert.ok(Array.isArray(twice.roots))

  // 缺参
  const noPath = await callFail('roots/remove', { projectRoot: FIXTURE })
  assert.equal(noPath.code, 'bad-request')
})

test('失效的外部根：仍在结果里（isGit:false + error）且可移除', async () => {
  const doomed = makeRepo(path.join(tempDir('dgp-doomed-'), 'doomed-repo'))
  await callOk('roots/add', { projectRoot: FIXTURE, path: doomed })
  rmSync(doomed, { recursive: true, force: true })

  const resolved = await callOk('project/resolve', { cwd: FIXTURE })
  const stale = resolved.roots.find((root) => root.kind === 'extra')
  assert.ok(stale, '失效的外部根不应被丢弃')
  assert.equal(stale.isGit, false)
  assert.equal(stale.repoRoot, null)
  assert.equal(stale.error, '目录不存在')
  assert.ok(eqPath(stale.path, doomed))
  assert.ok(
    resolved.warnings.some((warning) => warning.includes('外部仓库目录不存在')),
    '应有中文告警：' + JSON.stringify(resolved.warnings)
  )

  const removed = await callOk('roots/remove', { projectRoot: FIXTURE, path: doomed })
  assert.equal(removed.roots.some((root) => root.kind === 'extra'), false)
  assert.deepEqual(await config.listExtras(FIXTURE), [])
})

test('配置文件损坏 → 备份为 roots.json.broken-* 并从空配置继续', async () => {
  const configFile = config.configPath()
  mkdirSync(path.dirname(configFile), { recursive: true })
  writeFileSync(configFile, '{ 这不是合法 JSON', 'utf8')

  const extras = await config.listExtras(FIXTURE)
  assert.deepEqual(extras, [])

  const backups = readdirSync(path.dirname(configFile)).filter((name) =>
    name.startsWith('roots.json.broken-')
  )
  assert.equal(backups.length, 1, '应备份且只备份一次：' + JSON.stringify(backups))
  assert.ok(readFileSync(path.join(path.dirname(configFile), backups[0]), 'utf8').includes('这不是合法 JSON'))

  // 之后仍可正常写入
  const revived = makeRepo(path.join(tempDir('dgp-revived-'), 'revived-repo'))
  await callOk('roots/add', { projectRoot: FIXTURE, path: revived })
  assert.deepEqual(await config.listExtras(FIXTURE), [toPosix(revived)])
  await config.removeExtra(FIXTURE, revived)
})

/* ------------------------------------------------------------------ */
/* file/write：编辑保存（乐观并发 + 原子写 + EOL 保真）                  */
/* ------------------------------------------------------------------ */

test('file/write：读到的 hash 能保存成功，返回新 hash', async () => {
  const dir = tempDir('dgp-write-ok-')
  const file = path.join(dir, 'a.txt')
  writeFileSync(file, 'one\ntwo\n', 'utf8')

  const read = await callRoute('file/read', { rootPath: dir, path: 'a.txt' })
  assert.equal(read.ok, true, 'file/read 失败: ' + JSON.stringify(read))
  assert.equal(typeof read.value.hash, 'string', 'read 必须返回 hash')
  assert.equal(read.value.bom, false, 'read 必须返回 bom')

  const wrote = await callRoute('file/write', {
    rootPath: dir,
    path: 'a.txt',
    text: 'one\ntwo\nthree\n',
    expectedHash: read.value.hash,
    eol: read.value.eol,
    bom: read.value.bom
  })
  assert.equal(wrote.ok, true, 'file/write 失败: ' + JSON.stringify(wrote))
  assert.equal(readFileSync(file, 'utf8'), 'one\ntwo\nthree\n', '磁盘内容')
  const again = await callRoute('file/read', { rootPath: dir, path: 'a.txt' })
  assert.equal(again.value.hash, wrote.value.hash, '写入返回的 hash 应与重新读一致')
})

test('file/write：hash 过期 → conflict（不覆盖别人的改动）', async () => {
  const dir = tempDir('dgp-write-stale-')
  const file = path.join(dir, 'b.txt')
  writeFileSync(file, 'original\n', 'utf8')
  const read = await callRoute('file/read', { rootPath: dir, path: 'b.txt' })

  // 别人先改了磁盘
  writeFileSync(file, 'someone-else\n', 'utf8')

  const stale = await callRoute('file/write', {
    rootPath: dir, path: 'b.txt', text: 'mine\n',
    expectedHash: read.value.hash, eol: 'lf', bom: false
  })
  assert.equal(stale.ok, false, '过期 hash 必须失败')
  assert.equal(stale.error.code, 'conflict', '错误码')
  assert.equal(typeof stale.error.details.currentHash, 'string', '应回传当前 hash 供排查')
  assert.equal(readFileSync(file, 'utf8'), 'someone-else\n', '别人的改动不能被覆盖')

  // 显式覆盖才生效
  const forced = await callRoute('file/write', {
    rootPath: dir, path: 'b.txt', text: 'mine\n', force: true, eol: 'lf', bom: false
  })
  assert.equal(forced.ok, true, 'force 覆盖应成功: ' + JSON.stringify(forced))
  assert.equal(readFileSync(file, 'utf8'), 'mine\n')
})

test('file/write：缺 expectedHash 且非 force → bad-request', async () => {
  const dir = tempDir('dgp-write-nohash-')
  writeFileSync(path.join(dir, 'c.txt'), 'x\n', 'utf8')
  const result = await callRoute('file/write', { rootPath: dir, path: 'c.txt', text: 'y\n', eol: 'lf', bom: false })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'bad-request')
  assert.equal(readFileSync(path.join(dir, 'c.txt'), 'utf8'), 'x\n', '不应写入')
})

test('file/write：参数不合法直接拒绝（eol / bom / text）', async () => {
  const dir = tempDir('dgp-write-bad-')
  writeFileSync(path.join(dir, 'd.txt'), 'x\n', 'utf8')
  const base = { rootPath: dir, path: 'd.txt', text: 'y\n', expectedHash: 'deadbeef' }
  assert.equal((await callRoute('file/write', { ...base, eol: 'CRLF', bom: false })).error.code, 'bad-request')
  assert.equal((await callRoute('file/write', { ...base, eol: 'lf', bom: 'yes' })).error.code, 'bad-request')
  assert.equal((await callRoute('file/write', { ...base, text: 42, eol: 'lf', bom: false })).error.code, 'bad-request')
})

test('file/write：CRLF 文件保存后仍是 CRLF（不制造伪 diff）', async () => {
  const dir = tempDir('dgp-write-crlf-')
  const file = path.join(dir, 'e.txt')
  writeFileSync(file, 'a\r\nb\r\n', 'utf8')
  const read = await callRoute('file/read', { rootPath: dir, path: 'e.txt' })
  assert.equal(read.value.eol, 'crlf', '应识别 CRLF')
  assert.equal(read.value.text, 'a\nb\n', '读出的文本是 LF 归一后的')

  const wrote = await callRoute('file/write', {
    rootPath: dir, path: 'e.txt', text: 'a\nb\nc\n',
    expectedHash: read.value.hash, eol: read.value.eol, bom: read.value.bom
  })
  assert.equal(wrote.ok, true)
  assert.equal(readFileSync(file, 'utf8'), 'a\r\nb\r\nc\r\n', '写回必须还原 CRLF')
})

test('file/write：越界路径拒绝；不存在的文件 → not-found', async () => {
  const dir = tempDir('dgp-write-guard-')
  const escape = await callRoute('file/write', {
    rootPath: dir, path: '../../evil.txt', text: 'x', force: true, eol: 'lf', bom: false
  })
  assert.equal(escape.ok, false)
  assert.equal(escape.error.code, 'outside-root')

  const gitInternal = await callRoute('file/write', {
    rootPath: dir, path: '.git/config', text: 'x', force: true, eol: 'lf', bom: false
  })
  assert.equal(gitInternal.ok, false, '.git 内部路径必须拒绝')

  const missing = await callRoute('file/write', {
    rootPath: dir, path: 'nope.txt', text: 'x', force: true, eol: 'lf', bom: false
  })
  assert.equal(missing.ok, false)
  assert.equal(missing.error.code, 'not-found')
})

/* ------------------------------------------------------------------ */
/* remote/fetch：检测更新（本地 bare 仓库当 origin，全程离线）           */
/* ------------------------------------------------------------------ */

/** 搭一个 origin(bare) + work(clone) 的最小环境。 */
function makeRemoteFixture(name) {
  const root = tempDir(name)
  const origin = path.join(root, 'origin.git')
  const seed = path.join(root, 'seed')
  const work = path.join(root, 'work')
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' })

  git(root, 'init', '--bare', '-q', origin)
  git(root, 'init', '-q', '-b', 'main', seed)
  git(seed, 'config', 'user.email', 't@example.com')
  git(seed, 'config', 'user.name', 'test')
  writeFileSync(path.join(seed, 'a.txt'), 'one\n')
  git(seed, 'add', '.')
  git(seed, 'commit', '-qm', 'first')
  git(seed, 'remote', 'add', 'origin', origin)
  git(seed, 'push', '-q', 'origin', 'HEAD:main')
  git(root, 'clone', '-q', '-b', 'main', origin, work)
  return { root, origin, seed, work, git }
}

test('status 带上 remoteUrl（供「打开仓库」用）', async () => {
  const fixture = makeRemoteFixture('dgp-remote-status-')
  const result = await callRoute('status', { rootPath: fixture.work })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(toPosix(result.value.remoteUrl), toPosix(fixture.origin), 'remoteUrl')
  assert.equal(result.value.branch, 'main', 'branch')
  assert.equal(typeof result.value.head, 'string', 'head 应是短 SHA')
  assert.ok(result.value.head.length <= 12, 'head 应是短形式，实际 ' + result.value.head)
})

test('remote/fetch：远端有新提交 → behind 增加，并返回 fetch 时间', async () => {
  const fixture = makeRemoteFixture('dgp-remote-fetch-')
  const first = await callRoute('remote/fetch', { rootPath: fixture.work })
  assert.equal(first.ok, true, JSON.stringify(first))
  assert.equal(first.value.behind, 0, '刚 clone 时应为 0')
  assert.equal(typeof first.value.fetchedAt, 'number', 'fetchedAt')
  assert.equal(toPosix(first.value.url), toPosix(fixture.origin), 'url')

  // 远端（seed）再推一个提交
  writeFileSync(path.join(fixture.seed, 'b.txt'), 'two\n')
  fixture.git(fixture.seed, 'add', '.')
  fixture.git(fixture.seed, 'commit', '-qm', 'second')
  fixture.git(fixture.seed, 'push', '-q', 'origin', 'HEAD:main')

  const second = await callRoute('remote/fetch', { rootPath: fixture.work })
  assert.equal(second.ok, true, JSON.stringify(second))
  assert.equal(second.value.behind, 1, 'fetch 之后应落后 1 个提交')
})

test('remote/fetch：没有远端 → no-remote（不假装"已是最新"）', async () => {
  const dir = tempDir('dgp-remote-none-')
  execFileSync('git', ['init', '-q'], { cwd: dir })
  const result = await callRoute('remote/fetch', { rootPath: dir })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'no-remote')
})

test('remote/fetch：非仓库目录 → not-a-repository', async () => {
  const dir = tempDir('dgp-remote-plain-')
  const result = await callRoute('remote/fetch', { rootPath: dir })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'not-a-repository')
})

test('未知端点没有路由；畸形 payload 返回错误信封，绝不抛出', async () => {
  // 路由是精确注册的：不存在的 endpoint 压根没有路由（由连接服务回 404）
  assert.equal(routes.get(plugin.routePathOf('nope/nope')), undefined, '未知端点不应有路由')

  const payloads = [undefined, null, 0, '', 'txt', [], { rootPath: {} }, { rootPath: 42, path: [] }]
  for (const payload of payloads) {
    const result = await handler('status', payload)
    assert.equal(typeof result, 'object')
    assert.equal(result.ok, false, '畸形 payload 必须是失败信封：' + JSON.stringify(payload))
  }

  // 路由 fetch 本身不抛
  await assert.doesNotReject(() => handler('diff', { rootPath: FIXTURE, path: null }))
  const bad = await routes.get('/api/dsh-git/diff').fetch({ json: async () => null })
  assert.equal(bad.status, 400, 'null 信封应被拒绝')
})

/* ---------------------------------------------------------------- 执行 */

let passed = 0
let failed = 0
try {
  for (const { name, fn } of tests) {
    try {
      await fn()
      passed += 1
      console.log('  \u2713 ' + name)
    } catch (error) {
      failed += 1
      console.log('  \u2717 ' + name)
      console.log('    ' + String(error?.message ?? error).split('\n').join('\n    '))
    }
  }
} finally {
  for (const dir of cleanupDirs.reverse()) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
  if (PREVIOUS_DSH_HOME === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = PREVIOUS_DSH_HOME
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
