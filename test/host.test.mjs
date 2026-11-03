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
  realpathSync,
  chmodSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/* ---------------------------------------------------------------- 准备环境 */

const FIXTURE = path.resolve(import.meta.dirname, '../_sandbox/repo')
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
  /** 与真实 loader 一致：只有声明的服务都存在时才回调。 */
  inject(deps, callback) {
    const provided = { connection: fakeCtx.connection, llm: fakeCtx.llm }
    if (!deps.every((dep) => provided[dep] !== undefined)) return
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

/**
 * 把路径规范成可比较的键。
 *
 * 必须做 realpath：CI 的 %TEMP% 常常是 8.3 短名（例如 C:\Users\RUNNER~1\AppData\Local\Temp），
 * 而宿主会把路径规范化成真实长路径再回传/落盘 —— 这是**正确**行为（路径身份要稳定）。
 * 若测试只做 path.resolve，短名与长名永远对不上，会误报 6 条失败。
 */
function canonicalPath(value) {
  const resolved = path.resolve(value)
  let real
  try {
    real = realpathSync.native(resolved)
  } catch {
    real = resolved
  }
  const posix = toPosix(real)
  return process.platform === 'win32' ? posix.toLowerCase() : posix
}

const eqPath = (actual, expected) => canonicalPath(actual) === canonicalPath(expected)

/** 产品返回/落盘的仓库路径来自 git（8.3 短名会被解析成长路径），比较时也要 realpath。 */
const repoPath = (value) => {
  try {
    return toPosix(realpathSync.native(path.resolve(value)))
  } catch {
    return toPosix(path.resolve(value))
  }
}

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

test('会话级深度审阅：建到当前会话所属的工作区，不建成未分组的裸会话', async () => {
  const { findWorkspaceForSession, startSessionReview } = await import('../host/session-review.js')

  // 假 workspaceController：baseline 帧里带两个工作区，其中一个包含当前会话
  let returned = false
  const frames = [
    {
      type: 'baseline',
      value: {
        items: [
          { workspaceId: 'ws-other', path: 'C:/other', title: 'other', sessionIds: ['session-x'] },
          { workspaceId: 'ws-current', path: 'H:/limob-crm-front-end', title: 'limob', sessionIds: ['session-1', 'session-2'] }
        ]
      }
    }
  ]
  const workspaceController = {
    follow() {
      return {
        async *[Symbol.asyncIterator]() {
          for (const frame of frames) yield frame
        },
        async return() {
          returned = true
        }
      }
    }
  }

  const workspace = await findWorkspaceForSession(workspaceController, 'session-1', new AbortController().signal)
  assert.equal(workspace?.workspaceId, 'ws-current', '应找到包含当前会话的工作区')
  assert.equal(workspace?.path, 'H:/limob-crm-front-end')
  assert.equal(returned, true, '拿到 baseline 后必须释放 follow 流')

  // 找不到会话时返回 null
  assert.equal(await findWorkspaceForSession(workspaceController, 'session-none', new AbortController().signal), null)

  // 有 workspaceId 时 create 用 workspaceId，不再传 cwd
  const calls = []
  const started = await startSessionReview({
    sessionController: {
      async create(params, signal) { calls.push({ kind: 'create', params, signal }); return { sessionId: 'session-new' } },
      async prompt(params, signal) { calls.push({ kind: 'prompt', params, signal }) }
    },
    localRoot: 'H:/limob-crm-front-end',
    workspaceId: 'ws-current',
    branch: 'feat',
    fullName: 'main233/limob-crm-front-end',
    pull: { title: 'T', headBranch: 'feat', baseBranch: 'master' },
    files: [],
    signal: new AbortController().signal
  })
  assert.equal(started.sessionId, 'session-new')
  assert.equal(calls[0].params.workspaceId, 'ws-current', '应加入工作区')
  assert.equal(calls[0].params.cwd, undefined, '有工作区时不要再传 cwd')
  assert.ok(calls[1].params.content[0].text.includes('H:/limob-crm-front-end'), '提示词要带代码目录')
})

test('会话级深度审阅：create/prompt 都必须带 AbortSignal（否则 DSH 内部 throwIfAborted 炸）', async () => {
  const { startSessionReview } = await import('../host/session-review.js')
  const calls = []
  const controller = {
    async create(params, signal) {
      calls.push({ kind: 'create', params, signal })
      return { sessionId: 'session-1', agentPreset: 'review' }
    },
    async prompt(params, signal) {
      calls.push({ kind: 'prompt', params, signal })
    }
  }
  const signal = new AbortController().signal
  const started = await startSessionReview({
    sessionController: controller,
    localRoot: '/repo',
    branch: 'feat',
    fullName: 'alice/app',
    pull: { title: 'T', author: 'alice', headBranch: 'feat', baseBranch: 'main', body: 'B' },
    files: [{ filename: 'src/a.js', additions: 1, deletions: 0 }],
    filesTruncated: false,
    signal
  })
  assert.equal(started.sessionId, 'session-1')
  assert.equal(calls.length, 2, '应调用 create 与 prompt')
  for (const call of calls) {
    assert.ok(call.signal instanceof AbortSignal, call.kind + ' 必须收到 AbortSignal')
    assert.equal(call.signal, signal, call.kind + ' 应使用调用方的 signal')
  }
  const promptText = calls[1].params.content[0].text
  assert.ok(promptText.includes('alice/app'), '提示词要带仓库名')
  assert.ok(promptText.includes('src/a.js'), '提示词要带改动文件')
  assert.equal(calls[0].params.cwd, '/repo', '会话 cwd 应是准备好的目录')

  // 没传 signal 时也不能把 undefined 交给 DSH：内部要兜一个可用的 AbortSignal
  const noSignal = []
  await startSessionReview({
    sessionController: {
      async create(params, sig) { noSignal.push(sig); return { sessionId: 'session-2' } },
      async prompt(params, sig) { noSignal.push(sig) }
    },
    localRoot: '/repo',
    fullName: 'alice/app',
    pull: { title: 'T' },
    files: []
  })
  assert.ok(noSignal[0] instanceof AbortSignal, '调用方没给 signal 时也要传一个真实的 AbortSignal')
})

test('pr/prepare 路由：origin 是 GitHub 时要走到分支检查（助手必须真的被导入）', async () => {
  const repo = makeRepo(path.join(tempDir('dgp-pr-route-'), 'repo'))
  execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/alice/app.git'], { cwd: repo, stdio: 'pipe' })
  const result = await callRoute('pr/prepare', { rootPath: repo })
  assert.equal(result.ok, false, '没有账号时应当失败')
  assert.equal(typeof result.error?.code, 'string', '要有明确错误码：' + JSON.stringify(result))
  assert.notEqual(result.error.code, 'internal', '不能是内部异常：' + result.error.message)
  assert.ok(!String(result.error.message).includes('is not defined'),
    '不能是「变量未定义」这类实现错误：' + result.error.message)
})

test('评论转会话的提示词：带评论原文、先判断、不自动提交/推送', async () => {
  const { buildCommentSessionPrompt } = await import('../host/session-review.js')
  const prompt = buildCommentSessionPrompt({
    fullName: 'alice/app',
    localRoot: 'H:/code/app',
    branch: 'feat/x',
    pull: { number: 7, title: 'T', headBranch: 'feat/x', baseBranch: 'dev' },
    comment: { author: 'bob', createdAt: '2026-11-01T10:00:00Z', body: '这里没有判空，会 NPE，改一下' }
  })
  assert.ok(prompt.includes('alice/app'))
  assert.ok(prompt.includes('#7'))
  assert.ok(prompt.includes('这里没有判空，会 NPE，改一下'), '必须带评论原文')
  assert.ok(prompt.includes('先判断这条意见是否成立'), '必须先判断')
  assert.ok(prompt.includes('不要 commit、不要 push'), '必须明确不提交不推送')
  assert.ok(prompt.includes('需要向评论人确认'), '说不清时要停下来问')
})

test('创建 PR 的本地信息：远端地址识别、远端分支、是否已推送、base..HEAD 提交', async () => {
  const { remoteInfoFor, listRemoteBranches, pushedState, branchCommits } = await import('../host/git.js')
  const platform = path.join(tempDir('dgp-pr-platform-'), 'repo.git')
  execFileSync('git', ['init', '--bare', '-q', platform], { stdio: 'pipe' })
  const work = makeRepo(path.join(tempDir('dgp-pr-work-'), 'repo'))
  const g = (...args) => execFileSync('git', args, { cwd: work, stdio: 'pipe' })
  g('remote', 'add', 'origin', platform)
  g('push', '-q', 'origin', 'HEAD:refs/heads/master')
  g('push', '-q', 'origin', 'HEAD:refs/heads/dev')
  g('switch', '-q', '-c', 'feat/x')
  writeFileSync(path.join(work, 'b.js'), 'export const b = 2\n')
  g('add', '-A')
  g('commit', '-qm', 'feat: add b')
  g('push', '-q', 'origin', 'feat/x:refs/heads/feat/x')

  // origin 是本地路径：不是 GitHub/Gitee，识别为 null
  assert.equal(await remoteInfoFor(work), null)
  // 改成 github 地址后能识别出 owner/repo（不需要网络）
  g('remote', 'set-url', 'origin', 'git@github.com:alice/app.git')
  const info = await remoteInfoFor(work)
  assert.deepEqual(info, { provider: 'github', fullName: 'alice/app', url: 'git@github.com:alice/app.git' })

  // 远端分支列表来自本地 refs/remotes（先把本地路径的跟踪分支抓下来）
  g('remote', 'set-url', 'origin', platform)
  await execFileSync('git', ['fetch', '-q', 'origin'], { cwd: work, stdio: 'pipe' })
  const branches = await listRemoteBranches(work)
  assert.ok(branches.includes('dev'), '应列出远端 dev：' + branches.join(','))
  assert.ok(branches.includes('master'))

  const pushed = await pushedState(work, 'feat/x')
  assert.equal(pushed.pushed, true, '刚推过，应判定已推送')
  assert.equal(pushed.local, pushed.remoteSha)

  const commits = await branchCommits(work, 'origin/master')
  assert.equal(commits.length, 1, 'base..HEAD 应有 1 个提交')
  assert.equal(commits[0].subject, 'feat: add b')
})

test('生成 PR 文案：严格 JSON，非法输出直接报错', async () => {
  const { parsePullText } = await import('../host/pr-text.js')
  const valid = JSON.stringify({ title: 'feat: X', body: '## 变更摘要\n- a' })
  assert.deepEqual(parsePullText(valid), { title: 'feat: X', body: '## 变更摘要\n- a' })
  for (const bad of ['', '不是 JSON', '{"body":"x"}', '{"title":"x"}', '{"title":"","body":""}', '["x"]']) {
    await assert.rejects(() => Promise.resolve().then(() => parsePullText(bad)),
      (error) => error.code === 'bad-model-output', '应拒绝：' + bad)
  }
})

test('深度审阅的准备：已在 PR 提交上时只切分支，不再 fetch', async () => {
  const { prepareReviewBranch, headShaOf, reviewBranchName } = await import('../host/git.js')
  const dir = makeRepo(path.join(tempDir('dgp-already-'), 'repo'))
  const sha = await headShaOf(dir)
  assert.equal(sha.length, 40, 'headShaOf 应返回完整提交号')

  // 人为切到一个临时分支，验证 alreadyAtHead 只做 switch
  const run = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  run('branch', 'other')
  run('switch', '-q', 'other')

  const prepared = await prepareReviewBranch(dir, {
    sameRepo: true,
    alreadyAtHead: true,
    headBranch: 'other',
    number: 3
  })
  assert.equal(prepared.branch, 'other', '应切到 PR 的分支')
  assert.equal(prepared.fetched, false, '已在该提交上，不应触发 fetch')
  assert.equal(reviewBranchName(3), 'dsh-review/pr-3')
})

test('深度审阅的准备：同仓库 PR 直接用本机 origin 切分支（不需要插件令牌）', async () => {
  const { prepareReviewBranch } = await import('../host/git.js')
  const { execFileSync } = await import('node:child_process')

  const platform = path.join(tempDir('dgp-same-platform-'), 'alice', 'app.git')
  execFileSync('git', ['init', '--bare', '-q', platform], { stdio: 'pipe' })
  const work = path.join(tempDir('dgp-same-work-'), 'work')
  execFileSync('git', ['init', '-q', work], { stdio: 'pipe' })
  const g = (...args) => execFileSync('git', args, { cwd: work, stdio: 'pipe' })
  g('config', 'user.email', 'a@b.c')
  g('config', 'user.name', 'a')
  writeFileSync(path.join(work, 'a.js'), 'export const a = 1\n')
  g('add', '-A')
  g('commit', '-qm', 'one')
  g('push', '-q', platform, 'HEAD:refs/heads/main')
  // PR 的分支：推到 origin 的普通分支上
  g('branch', 'feat/pr-branch')
  g('push', '-q', platform, 'feat/pr-branch:refs/heads/feat/pr-branch')

  const local = path.join(tempDir('dgp-same-local-'), 'clone')
  execFileSync('git', ['clone', '-q', platform, local], { stdio: 'pipe' })

  const prepared = await prepareReviewBranch(local, {
    sameRepo: true, headBranch: 'feat/pr-branch', number: 9
  })
  assert.equal(prepared.branch, 'feat/pr-branch', '应切到 PR 的分支')
  assert.ok(existsSync(path.join(local, 'a.js')))
})

test('深度审阅的准备：找本地仓库 → 切分支；没有则克隆到指定目录', async () => {
  const { prepareReviewBranch, cloneForReview, findLocalRepoFor, reviewBranchName } = await import('../host/git.js')
  const { execFileSync } = await import('node:child_process')

  // 「平台」裸仓库：带 refs/pull/1/head
  const platform = path.join(tempDir('dgp-dr-platform-'), 'alice', 'app.git')
  execFileSync('git', ['init', '--bare', '-q', platform], { stdio: 'pipe' })
  const work = path.join(tempDir('dgp-dr-work-'), 'work')
  execFileSync('git', ['init', '-q', work], { stdio: 'pipe' })
  writeFileSync(path.join(work, 'a.js'), 'export const a = 1\n')
  const g = (...args) => execFileSync('git', args, { cwd: work, stdio: 'pipe' })
  g('config', 'user.email', 'a@b.c')
  g('config', 'user.name', 'a')
  g('add', '-A')
  g('commit', '-qm', 'one')
  g('push', '-q', platform, 'HEAD:refs/pull/1/head')
  g('push', '-q', platform, 'HEAD:refs/heads/pr-branch')

  // 本地克隆：origin 指向「平台」→ findLocalRepoFor 应命中
  const local = path.join(tempDir('dgp-dr-local-'), 'clone')
  execFileSync('git', ['clone', '-q', platform, local], { stdio: 'pipe' })
  const found = await findLocalRepoFor([local], 'alice/app')
  assert.ok(found !== null, '应找到对应本地仓库')
  assert.ok(eqPath(found.rootPath, realpathSync.native(local)), '命中的应是这个克隆')

  const notFound = await findLocalRepoFor([local], 'other/repo')
  assert.equal(notFound, null, '不匹配时返回 null')

  // 切到 PR 分支：独立分支名，fetch + switch
  await prepareReviewBranch(local, {
    url: platform, remoteRef: 'refs/pull/1/head', number: 1, user: 'x', token: ''
  })
  const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: local, stdio: 'pipe' }).toString('utf8').trim()
  assert.equal(branch, reviewBranchName(1), '应切到审阅分支')
  assert.ok(existsSync(path.join(local, 'a.js')), '工作区应有文件')

  // 克隆到指定目录：目标非空要拒绝
  const target = path.join(tempDir('dgp-dr-target-'), 'target')
  mkdirSync(target, { recursive: true })
  writeFileSync(path.join(target, 'occupied.txt'), 'x')
  await assert.rejects(
    () => cloneForReview(target, { url: platform, remoteRef: 'refs/pull/1/head', number: 1, branch: 'main', user: 'x', token: '' }),
    (error) => error.code === 'target-exists'
  )

  // 空目录 → 克隆并切到 PR 分支
  const empty = path.join(tempDir('dgp-dr-empty-'), 'target')
  const cloned = await cloneForReview(empty, {
    url: platform, remoteRef: 'refs/pull/1/head', number: 1, branch: 'pr-branch', user: 'x', token: ''
  })
  assert.equal(cloned.branch, 'pr-branch', '应切到 PR 分支')
  assert.ok(existsSync(path.join(empty, 'a.js')))
})

test('拉取当前分支：只允许快进；分叉、没有上游、工作区冲突都明确拒绝', async () => {
  const { pullBranch, readHead } = await import('../host/git.js')
  const platform = path.join(tempDir('dgp-pull-platform-'), 'repo.git')
  execFileSync('git', ['init', '--bare', '-q', platform], { stdio: 'pipe' })
  // 裸仓库的 HEAD 默认指向 master；我们先推 main，所以要把 HEAD 指到 main，clone 才有主线
  execFileSync('git', ['--git-dir', platform, 'symbolic-ref', 'HEAD', 'refs/heads/main'], { stdio: 'pipe' })

  const work = makeRepo(path.join(tempDir('dgp-pull-work-'), 'repo'))
  const g = (...args) => execFileSync('git', args, { cwd: work, stdio: 'pipe' })
  g('remote', 'add', 'origin', platform)
  g('push', '-q', 'origin', 'HEAD:refs/heads/main')
  g('fetch', '-q', 'origin')
  g('branch', '--set-upstream-to=origin/main')

  const other = path.join(tempDir('dgp-pull-other-'), 'other')
  execFileSync('git', ['clone', '-q', platform, other], { stdio: 'pipe' })
  const o = (...args) => execFileSync('git', args, { cwd: other, stdio: 'pipe' })
  o('checkout', '-q', '-B', 'main', 'origin/main')
  o('config', 'user.email', 'o@b.c')
  o('config', 'user.name', 'o')
  writeFileSync(path.join(other, 'new.txt'), 'from upstream\n')
  o('add', '-A')
  o('commit', '-qm', 'upstream commit')
  o('push', '-q', 'origin', 'HEAD:refs/heads/main')

  const before = await readHead(work)
  const pulled = await pullBranch(work)
  assert.notEqual(pulled.head, before.head, '应真的前进到远端最新提交')
  assert.equal(pulled.branch, before.branch)
  assert.ok(existsSync(path.join(work, 'new.txt')), '拉取后工作区必须拿到远端文件')
  assert.equal((await readHead(work)).behind, 0, '拉取后不应再落后')

  // 分叉：本地有远端没有的提交 → 拒绝快进
  writeFileSync(path.join(work, 'local.txt'), 'local only\n')
  g('add', '-A')
  g('commit', '-qm', 'local commit')
  writeFileSync(path.join(other, 'another.txt'), 'upstream again\n')
  o('add', '-A')
  o('commit', '-qm', 'upstream again')
  o('push', '-q', 'origin', 'HEAD:refs/heads/main')
  await assert.rejects(
    () => pullBranch(work),
    (error) => error.code === 'not-fast-forward' && error.message.includes('分叉')
  )

  // 没有上游：直接说清楚，不猜
  const lonely = makeRepo(path.join(tempDir('dgp-pull-lonely-'), 'repo'))
  await assert.rejects(
    () => pullBranch(lonely),
    (error) => error.code === 'no-upstream'
  )
})

test('插件版本与更新检查：本地版本取 package.json，最新版本严格比较，失败明确报错', async () => {
  const { pluginInfo, compareVersions, checkPluginUpdate } = await import('../host/plugin-meta.js')
  const pkgText = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  const pkg = JSON.parse(pkgText)

  const info = pluginInfo()
  assert.equal(info.version, pkg.version, '版本必须来自 package.json')
  assert.equal(info.fullName, 'lcx19970714/dsh-git-panel', '仓库全名从 repository 解析')

  assert.equal(compareVersions('0.36.0', '0.35.1'), 1)
  assert.equal(compareVersions('0.35.1', '0.36.0'), -1)
  assert.equal(compareVersions('0.35.1', '0.35.1'), 0)
  assert.equal(compareVersions('0.35.10', '0.35.9'), 1, '数字段按数值比较，不是字符串')
  assert.equal(compareVersions('1.0.0', '0.99.0'), 1)

  const okFetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { tag_name: 'v999.0.0', html_url: 'https://example.com/release', published_at: '2026-11-01T00:00:00Z' }
    }
  })
  const newer = await checkPluginUpdate({ fetchImpl: okFetch })
  assert.equal(newer.currentVersion, pkg.version)
  assert.equal(newer.latestVersion, '999.0.0', 'tag 前缀 v 要去掉')
  assert.equal(newer.newer, true)
  assert.equal(newer.url, 'https://example.com/release')

  const sameFetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { tag_name: 'v' + pkg.version, html_url: 'x', published_at: '2026-11-01T00:00:00Z' }
    }
  })
  assert.equal((await checkPluginUpdate({ fetchImpl: sameFetch })).newer, false, '同版本不算新版本')

  // 失败必须抛错，不能当成「已是最新」
  await assert.rejects(
    () => checkPluginUpdate({ fetchImpl: async () => ({ ok: false, status: 403, async json() { return {} } }) }),
    (error) => error.code === 'update-check-failed' && error.message.includes('403')
  )
  await assert.rejects(
    () => checkPluginUpdate({ fetchImpl: async () => { throw new Error('network down') } }),
    (error) => error.code === 'update-check-failed' && error.message.includes('network down')
  )
  await assert.rejects(
    () => checkPluginUpdate({ fetchImpl: async () => ({ ok: true, status: 200, async json() { return { tag_name: '' } } }) }),
    (error) => error.code === 'update-check-failed'
  )

  // 路由：plugin/info 必须返回真实安装版本
  const routeInfo = await callRoute('plugin/info', {})
  assert.equal(routeInfo.ok, true)
  assert.equal(routeInfo.value.version, pkg.version)
})

test('index.js 用到的 host/git.js 助手必须都已导入（防 readHead is not defined 复发）', async () => {
  const fs = await import('node:fs')
  const indexText = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  const match = indexText.match(/import \{([\s\S]*?)\} from '\.\/host\/git\.js'/)
  assert.ok(match !== null, '找不到 git.js 导入块')
  const imported = new Set(match[1].split(',').map((item) => item.trim()).filter(Boolean))
  const gitText = fs.readFileSync(new URL('../host/git.js', import.meta.url), 'utf8')
  const exports = [...gitText.matchAll(/export (?:async )?function (\w+)/g)].map((item) => item[1])
  const body = indexText.slice(indexText.indexOf(match[0]) + match[0].length)
  const missingImports = exports.filter((name) => new RegExp('\\b' + name + '\\s*\\(').test(body) && !imported.has(name))
  assert.deepEqual(missingImports, [], '这些助手被使用了但没导入：' + missingImports.join(', '))
})

test('文档与端点清单必须一致：数量一致，且每个端点都在文档端点表里', async () => {
  const doc = readFileSync(new URL('../docs/ARCHITECTURE.md', import.meta.url), 'utf8')
  const claimed = /通过 (\d+) 个 RPC 端点通信/.exec(doc)
  assert.ok(claimed !== null, '文档里找不到端点数量声明')
  assert.equal(Number(claimed[1]), plugin.ENDPOINTS.length, '文档写的端点数量与实际不一致')
  const absent = plugin.ENDPOINTS.filter((endpoint) => !doc.includes('`' + endpoint + '`'))
  assert.deepEqual(absent, [], '这些端点没有写进文档端点表：' + absent.join(', '))
})

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
    /** 与真实 loader 一致：只有声明的服务都存在时才回调（这个 ctx 没有 llm）。 */
    inject(deps, callback) {
      const provided = { connection: fakeCtx2.connection }
      if (!deps.every((dep) => provided[dep] !== undefined)) return
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
  // 用 path.sep 造「带尾分隔符」的写法，别写死反斜杠 —— 在 Linux 上 '\' 是合法文件名字符，不是分隔符
  await Promise.all([
    config.addExtra(projectRoot, a),
    config.addExtra(projectRoot, b + path.sep),
    config.addExtra(projectRoot, c)
  ])
  const listed = await config.listExtras(projectRoot)
  assert.equal(listed.length, 3, '并发添加不应丢条目：' + JSON.stringify(listed))
  assert.ok(listed.every((item) => !item.includes('\\') && !item.endsWith('/')), '应全是正斜杠无尾斜杠')
  assert.ok(listed.some((item) => eqPath(item, a)))
  assert.ok(listed.some((item) => eqPath(item, b)))

  // 重复添加不产生第二条
  await config.addExtra(projectRoot, a)
  assert.equal((await config.listExtras(projectRoot)).length, 3, '同一路径重复添加不应产生第二条')
  // Windows 文件系统大小写不敏感，另一种大小写也必须被当成同一条；Linux 上是两个不同路径，不做此断言
  if (process.platform === 'win32') {
    await config.addExtra(projectRoot, a.toUpperCase())
    assert.equal((await config.listExtras(projectRoot)).length, 3, 'Windows 下大小写不同的写法算同一条')
  }

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
  assert.equal(appEntry.path, undefined, '不再返回与 name 重复的 path 字段')

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
  assert.deepEqual(onDisk.projects[key], [repoPath(secondRepo)])
  // 原子写不留临时文件
  const leftovers = readdirSync(path.dirname(configFile)).filter((name) => name.includes('.tmp-'))
  assert.deepEqual(leftovers, [])

  // 重复添加不会重复出现
  const again = await callOk('roots/add', { projectRoot: FIXTURE, path: secondRepo })
  const extras = again.roots.filter((root) => root.kind === 'extra')
  assert.equal(extras.length, 1)
  assert.deepEqual(await config.listExtras(FIXTURE), [repoPath(secondRepo)])

  // 新进程/新模块实例仍能读回（DSH_HOME 在调用时解析）
  const reloaded = await import('../host/config.js?fresh=' + Date.now())
  assert.deepEqual(await reloaded.listExtras(FIXTURE), [repoPath(secondRepo)])

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
  // realpath 必须在删除前取（删掉之后就解析不出长路径了），否则短/长名比较会误报
  const doomedReal = realpathSync.native(doomed)
  await callOk('roots/add', { projectRoot: FIXTURE, path: doomed })
  rmSync(doomed, { recursive: true, force: true })

  const resolved = await callOk('project/resolve', { cwd: FIXTURE })
  const stale = resolved.roots.find((root) => root.kind === 'extra')
  assert.ok(stale, '失效的外部根不应被丢弃')
  assert.equal(stale.isGit, false)
  assert.equal(stale.repoRoot, null)
  assert.equal(stale.error, '目录不存在')
  assert.ok(eqPath(stale.path, doomedReal))
  assert.ok(
    resolved.warnings.some((warning) => warning.includes('外部仓库目录不存在')),
    '应有中文告警：' + JSON.stringify(resolved.warnings)
  )

  // UI 移除时传的是解析结果里的 root.path（规范路径），不是用户当初输入的写法
  const removed = await callOk('roots/remove', { projectRoot: FIXTURE, path: stale.path })
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
  assert.deepEqual(await config.listExtras(FIXTURE), [repoPath(revived)])
  await config.removeExtra(FIXTURE, repoPath(revived))
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


test('project/resolve：项目子目录里的仓库都要被发现（深层 / vendor / 联接），跳过依赖树与坏仓库', async () => {
  // 不变量：项目根的「是不是仓库」只是第一层判断。子目录里只要有 .git（目录或 gitfile）
  // 就是一棵独立工作树，必须逐个列出；找到之后不再深入（里面属于同一个工作树）。
  // 目录联接在 Windows 上不会被 readdir 报成目录，必须显式跟进去。
  const project = tempDir('dgp-scan-')
  writeFileSync(path.join(project, 'README.md'), '# project\n')

  const depth1 = makeRepo(path.join(project, 'repo-d1'))
  const depth2 = makeRepo(path.join(project, 'group', 'repo-d2'))
  const depth3 = makeRepo(path.join(project, 'a', 'b', 'repo-d3'))
  const vendored = makeRepo(path.join(project, 'vendor', 'repo-vendor'))
  const thirdParty = makeRepo(path.join(project, 'third_party', 'repo-third'))
  const inNodeModules = makeRepo(path.join(project, 'node_modules', 'repo-nm'))
  const external = makeRepo(path.join(tempDir('dgp-scan-ext-'), 'external-repo'))
  const linkPath = path.join(project, 'linked')
  symlinkSync(external, linkPath, process.platform === 'win32' ? 'junction' : 'dir')

  // 有 .git 但读不出工作树：只告警，不许造一个假的 isGit:false 根
  mkdirSync(path.join(project, 'broken', '.git'), { recursive: true })

  const value = await callOk('project/resolve', { cwd: project })
  const repos = value.roots.filter((root) => root.isGit === true).map((root) => root.repoRoot)

  for (const expected of [depth1, depth2, depth3, vendored, thirdParty, external]) {
    assert.ok(
      repos.some((root) => eqPath(root, expected)),
      '缺少仓库：' + expected + '\n实际：' + JSON.stringify(repos)
    )
  }
  assert.ok(
    !repos.some((root) => eqPath(root, inNodeModules)),
    'node_modules 里的目录应整棵跳过'
  )
  assert.equal(
    value.roots.filter((root) => root.kind === 'discovered' && root.isGit === false).length,
    0,
    '坏仓库不应变成列表里的假仓库'
  )
  assert.ok(
    value.warnings.some((w) => w.includes('broken')),
    '坏仓库必须留下告警：' + JSON.stringify(value.warnings)
  )
})

test('外部根：存规范化路径，联接写法添加/移除都命中同一条记录', async () => {
  // 不变量：add 与 remove 都先把路径规范化（realpath），因此联接写法、8.3 短名、
  // 真实路径指向同一个目录时，永远是同一条记录 —— 不会留下删不掉的僵尸根。
  const realRepo = makeRepo(path.join(tempDir('dgp-link-'), 'real-repo'))
  const linkPath = path.join(tempDir('dgp-link-home-'), 'linked-repo')
  symlinkSync(realRepo, linkPath, process.platform === 'win32' ? 'junction' : 'dir')

  await callOk('roots/add', { projectRoot: FIXTURE, path: linkPath })

  const stored = (await config.listExtras(FIXTURE)).filter((item) => eqPath(item, linkPath))
  assert.equal(stored.length, 1, '应只有一条外部根记录')
  assert.equal(stored[0], toPosix(realpathSync.native(realRepo)), '入库键应是规范化后的真实路径，实际 ' + stored[0])

  const listed = await callOk('project/resolve', { cwd: FIXTURE })
  const extra = listed.roots.find((root) => root.kind === 'extra')
  assert.ok(extra, '应出现 extra 根')
  assert.equal(extra.isGit, true, '联接指向真实仓库，应识别为仓库')
  assert.equal(extra.path, toPosix(realpathSync.native(realRepo)), '展示路径也是规范化后的真实路径')

  // 同一路径重复添加不产生第二条
  await callOk('roots/add', { projectRoot: FIXTURE, path: linkPath })
  assert.equal((await config.listExtras(FIXTURE)).length, 1)

  // 用同一路径移除：必须命中并清空
  const after = await callOk('roots/remove', { projectRoot: FIXTURE, path: linkPath })
  assert.deepEqual(after.roots.filter((root) => root.kind === 'extra'), [], '移除后不应再有外部根')
  assert.deepEqual(await config.listExtras(FIXTURE), [], '配置里也必须清干净')
})

test('外部根：只认这个目录自身 —— 不向上找祖先仓库、不向下扫子仓库', async () => {
  const repo = makeRepo(path.join(tempDir('dgp-extra-scope-'), 'outer'))

  // 1) 加仓库里的子目录：不能悄悄换成上层仓库，直接拒绝
  const subDir = path.join(repo, 'src')
  mkdirSync(subDir, { recursive: true })
  const failed = await callFail('roots/add', { projectRoot: FIXTURE, path: subDir })
  assert.equal(failed.code, 'not-a-repository', '子目录不是仓库根，必须拒绝')
  assert.match(failed.message, /缺少 \.git/, '错误要说明原因：' + failed.message)

  // 2) 外部根内部还有嵌套仓库：只列外部根这一条，不扫描它的子仓库
  const nested = makeRepo(path.join(repo, 'packages', 'inner'))
  assert.ok(nested)
  const added = await callOk('roots/add', { projectRoot: FIXTURE, path: repo })
  const extras = added.roots.filter((root) => root.kind === 'extra' && eqPath(root.path, repo))
  assert.equal(extras.length, 1, '只应有外部根自身那一条')
  assert.equal(extras[0].path, repoPath(repo))
  assert.equal(
    added.roots.filter((root) => root.kind === 'discovered' && eqPath(root.path, nested)).length,
    0,
    '外部根内部不应被扫描出子仓库'
  )

  await callOk('roots/remove', { projectRoot: FIXTURE, path: repo })
})

test('branches/list：区分本地 / 仅远程 / 两边都有，并给出 ahead-behind', async () => {
  const dir = makeRepo(path.join(tempDir('dgp-branches-'), 'repo'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  const bare = path.join(tempDir('dgp-branches-origin-'), 'origin.git')
  execFileSync('git', ['init', '--bare', '-q', bare], { stdio: 'pipe' })
  git('remote', 'add', 'origin', bare)
  git('push', '-q', '-u', 'origin', 'main')

  // 只在本地存在的分支
  git('branch', 'local-only')
  // 只在远程存在的分支：推到 origin 后删掉本地
  git('branch', 'remote-only')
  git('push', '-q', 'origin', 'remote-only')
  git('branch', '-D', 'remote-only')
  // main 领先 origin/main 1 个提交
  writeFileSync(path.join(dir, 'ahead.txt'), 'a\n')
  git('add', '-A')
  git('commit', '-qm', 'ahead one')

  const listed = await callOk('branches/list', { rootPath: dir })
  const main = listed.branches.find((branch) => branch.name === 'main')
  assert.equal(main.local, true)
  assert.equal(main.current, true, '当前分支')
  assert.equal(main.remote, 'origin', 'origin 有同名分支')
  assert.equal(main.upstream, 'origin/main')
  assert.equal(main.ahead, 1, '领先 1 个提交')
  assert.equal(main.behind, 0)

  const localOnly = listed.branches.find((branch) => branch.name === 'local-only')
  assert.equal(localOnly.local, true)
  assert.equal(localOnly.remote, null, '远端没有同名分支 → 远程标志是暗的')

  const remoteOnly = listed.branches.filter((branch) => branch.local === false)
  assert.deepEqual(remoteOnly.map((branch) => branch.name), ['remote-only'], '只有远程的分支')
  assert.equal(remoteOnly[0].remote, 'origin')
  assert.equal(listed.current, 'main')
})

test('branches/track：把仅远程的分支建成本地跟踪分支；同名已存在则拒绝', async () => {
  const dir = makeRepo(path.join(tempDir('dgp-track-'), 'repo'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  const bare = path.join(tempDir('dgp-track-origin-'), 'origin.git')
  execFileSync('git', ['init', '--bare', '-q', bare], { stdio: 'pipe' })
  git('remote', 'add', 'origin', bare)
  git('push', '-q', '-u', 'origin', 'main')
  git('branch', 'feature/x')
  git('push', '-q', 'origin', 'feature/x')
  git('branch', '-D', 'feature/x')

  const tracked = await callOk('branch/track', { rootPath: dir, remote: 'origin', name: 'feature/x' })
  assert.equal(tracked.branch, 'feature/x', '应切到新建的本地分支')
  assert.equal(tracked.upstream, 'origin/feature/x', '并建立跟踪关系')

  const listed = await callOk('branches/list', { rootPath: dir })
  const local = listed.branches.find((branch) => branch.name === 'feature/x' && branch.local === true)
  assert.ok(local, '本地分支应出现')
  assert.equal(local.current, true)
  assert.equal(local.remote, 'origin', '本地有了，远程标志也应是亮的')
  assert.equal(listed.branches.some((branch) => branch.local === false), false, '都建成本地了，就不该再有「只有远程」的行')

  const again = await callRoute('branch/track', { rootPath: dir, remote: 'origin', name: 'feature/x' })
  assert.equal(again.ok, false)
  assert.equal(again.error.code, 'branch-exists')
})

test('index/stage：未暂存点加号进入已暂存，已暂存点减号回到未暂存', async () => {
  const dir = makeRepo(path.join(tempDir('dgp-stage-'), 'repo'))
  // hello.txt 已在初始提交里：改它的内容才是「未暂存」；fresh.txt 是全新文件，走未跟踪
  writeFileSync(path.join(dir, 'hello.txt'), 'changed\n')
  writeFileSync(path.join(dir, 'fresh.txt'), 'new\n')

  const before = await callOk('status', { rootPath: dir })
  const note = before.files.find((file) => file.path === 'hello.txt')
  const fresh = before.files.find((file) => file.path === 'fresh.txt')
  assert.equal(note.unstaged, true, '改动应在未暂存')
  assert.equal(note.staged, false)
  assert.equal(fresh.untracked, true, '新文件应是未跟踪')

  const staged = await callOk('index/stage', { rootPath: dir, path: 'hello.txt', action: 'stage' })
  assert.deepEqual(staged, { path: 'hello.txt', action: 'stage' })
  await callOk('index/stage', { rootPath: dir, path: 'fresh.txt', action: 'stage' })

  const middle = await callOk('status', { rootPath: dir })
  const noteStaged = middle.files.find((file) => file.path === 'hello.txt')
  const freshStaged = middle.files.find((file) => file.path === 'fresh.txt')
  assert.equal(noteStaged.staged, true, '加号之后应进入已暂存')
  assert.equal(noteStaged.unstaged, false, '整文件暂存后不应再留在未暂存')
  assert.equal(freshStaged.staged, true, '未跟踪文件暂存后应进入已暂存')
  assert.equal(freshStaged.untracked, false)

  const unstaged = await callOk('index/stage', { rootPath: dir, path: 'hello.txt', action: 'unstage' })
  assert.equal(unstaged.action, 'unstage')
  const after = await callOk('status', { rootPath: dir })
  const noteBack = after.files.find((file) => file.path === 'hello.txt')
  assert.equal(noteBack.staged, false, '减号之后应离开已暂存')
  assert.equal(noteBack.unstaged, true, '取消暂存应回到未暂存，工作区内容保留')
})

test('index/stage：非法路径与非法动作直接拒绝，不改索引', async () => {
  const dir = makeRepo(path.join(tempDir('dgp-stage-guard-'), 'repo'))
  for (const bad of ['../outside.txt', '.git/config', '/abs.txt', '-evil', 'a//b', '']) {
    const result = await callRoute('index/stage', { rootPath: dir, path: bad, action: 'stage' })
    assert.equal(result.ok, false, '应拒绝：' + JSON.stringify(bad) + ' → ' + JSON.stringify(result))
  }
  const wrong = await callRoute('index/stage', { rootPath: dir, path: 'hello.txt', action: 'commit' })
  assert.equal(wrong.ok, false)
  assert.equal(wrong.error.code, 'bad-request')

  const status = await callOk('status', { rootPath: dir })
  assert.equal(status.files.length, 0, '拒绝的请求不能改动索引')
})

test('index/stage-group：未暂存整组暂存、已暂存整组取消', async () => {
  const dir = makeRepo(path.join(tempDir('dgp-stage-group-'), 'repo'))
  writeFileSync(path.join(dir, 'hello.txt'), 'changed\n')
  writeFileSync(path.join(dir, 'fresh.txt'), 'new\n')

  await callOk('index/stage-group', { rootPath: dir, scope: 'stage-unstaged' })
  const afterTracked = await callOk('status', { rootPath: dir })
  const hello = afterTracked.files.find((file) => file.path === 'hello.txt')
  const fresh = afterTracked.files.find((file) => file.path === 'fresh.txt')
  assert.equal(hello.staged, true, '已跟踪改动应整组进入已暂存')
  assert.equal(fresh.untracked, true, '暂存未暂存组不应连带未跟踪文件')

  await callOk('index/stage-group', { rootPath: dir, scope: 'stage-untracked' })
  const afterAll = await callOk('status', { rootPath: dir })
  assert.equal(afterAll.files.every((file) => file.staged === true), true, '未跟踪文件应整组进入已暂存')

  await callOk('index/stage-group', { rootPath: dir, scope: 'unstage' })
  const cleared = await callOk('status', { rootPath: dir })
  assert.equal(cleared.files.every((file) => file.staged !== true), true, '取消暂存后不应再有已暂存文件')
  assert.equal(cleared.files.find((file) => file.path === 'hello.txt').unstaged, true, '工作区改动还在')
})

test('index/stage-group：stage-untracked 只加未跟踪文件，stage-all 两者都加', async () => {
  // 不变量：每个 scope 的作用范围必须和那一组里到底有什么一致。
  // 分开模式里「未跟踪」组只该加新文件；合并模式里「未暂存」组两者都有，才用 stage-all。
  const dir = makeRepo(path.join(tempDir('dgp-stage-scope-'), 'repo'))
  writeFileSync(path.join(dir, 'hello.txt'), 'changed\n')   // 已跟踪改动
  writeFileSync(path.join(dir, 'fresh.txt'), 'new\n')       // 未跟踪

  await callOk('index/stage-group', { rootPath: dir, scope: 'stage-untracked' })
  const afterUntracked = await callOk('status', { rootPath: dir })
  const fresh = afterUntracked.files.find((file) => file.path === 'fresh.txt')
  const hello = afterUntracked.files.find((file) => file.path === 'hello.txt')
  assert.equal(fresh.staged, true, '未跟踪文件应进入已暂存')
  assert.equal(hello.staged, false, 'stage-untracked 不该连带已跟踪改动')
  assert.equal(hello.unstaged, true, '已跟踪改动仍留在未暂存')

  await callOk('index/stage-group', { rootPath: dir, scope: 'stage-all' })
  const afterAll = await callOk('status', { rootPath: dir })
  assert.equal(afterAll.files.every((file) => file.staged === true), true, 'stage-all 之后不该还有未暂存内容')
})

test('commit：pre-commit hook 失败时把 hook 的输出报出来，不是只说退出码', async () => {
  // 曾经的表现：git 把原因写在 stdout，而错误只取了 stderr，用户只看到「以退出码 1 结束」。
  const dir = makeRepo(path.join(tempDir('dgp-commit-hook-'), 'repo'))
  writeFileSync(path.join(dir, 'hello.txt'), 'changed\n')
  const hook = path.join(dir, '.git', 'hooks', 'pre-commit')
  mkdirSync(path.dirname(hook), { recursive: true })
  writeFileSync(hook, '#!/bin/sh\necho "pre-commit: lint failed"\nexit 1\n', 'utf8')
  try {
    chmodSync(hook, 0o755)
  } catch {
    /* Windows 上一般不需要可执行位 */
  }

  const failed = await callRoute('commit', { rootPath: dir, message: 'feat: x' })
  assert.equal(failed.ok, false, 'hook 失败时提交必须失败')
  assert.match(failed.error.message, /lint failed/, '错误里要带 hook 的输出：' + JSON.stringify(failed.error))
  assert.doesNotMatch(failed.error.message, /以退出码/, '不该只剩一句退出码')
})

test('commit：有未解决冲突时明确报 unmerged，而不是让 git 用退出码 1 失败', async () => {
  const dir = makeRepo(path.join(tempDir('dgp-commit-unmerged-'), 'repo'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  git('checkout', '-q', '-b', 'other')
  writeFileSync(path.join(dir, 'hello.txt'), 'other\n')
  git('commit', '-qam', 'other')
  git('checkout', '-q', 'main')
  writeFileSync(path.join(dir, 'hello.txt'), 'main\n')
  git('commit', '-qam', 'main')
  assert.throws(() => git('merge', 'other'), '合并应产生冲突')

  const failed = await callRoute('commit', { rootPath: dir, message: 'feat: merge' })
  assert.equal(failed.ok, false)
  assert.equal(failed.error.code, 'unmerged')
})

test('branches/list 与 branch/switch：列出本地分支、切换后当前分支跟着变', async () => {
  const dir = makeRepo(path.join(tempDir('dgp-branch-'), 'repo'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  git('branch', 'feature')

  const listed = await callOk('branches/list', { rootPath: dir })
  const names = listed.branches.map((branch) => branch.name)
  assert.ok(names.includes('main') && names.includes('feature'), '应列出全部本地分支：' + names.join(','))
  assert.equal(listed.branches.find((branch) => branch.name === 'main').current, true, '当前分支要标出来')
  assert.equal(listed.branches[0].name, 'main', '当前分支排最前')

  const switched = await callOk('branch/switch', { rootPath: dir, name: 'feature' })
  assert.equal(switched.branch, 'feature')

  const after = await callOk('branches/list', { rootPath: dir })
  assert.equal(after.branches.find((branch) => branch.name === 'feature').current, true)
  assert.equal(after.branches.find((branch) => branch.name === 'main').current, false)

  const bad = await callRoute('branch/switch', { rootPath: dir, name: 'has space' })
  assert.equal(bad.ok, false, '非法分支名必须拒绝')
  assert.equal(bad.error.code, 'bad-branch')
})

test('branch/create：从当前 HEAD 建分支并切过去；重名与非法名字拒绝', async () => {
  const dir = makeRepo(path.join(tempDir('dgp-branch-create-'), 'repo'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  const before = git('rev-parse', '--short', 'HEAD').toString('utf8').trim()

  const created = await callOk('branch/create', { rootPath: dir, name: 'topic' })
  assert.equal(created.branch, 'topic', '创建后应停在新分支上')
  assert.equal(created.head, before, '新分支应指向创建时的 HEAD，而不是另起一个提交')
  assert.equal(git('branch', '--show-current').toString('utf8').trim(), 'topic')

  const listed = await callOk('branches/list', { rootPath: dir })
  assert.equal(listed.branches.find((branch) => branch.name === 'topic').current, true)
  assert.equal(listed.branches.find((branch) => branch.name === 'main').current, false)

  const duplicate = await callRoute('branch/create', { rootPath: dir, name: 'main' })
  assert.equal(duplicate.ok, false, '已有分支不能被新建覆盖')
  assert.equal(git('branch', '--show-current').toString('utf8').trim(), 'topic', '失败后仍停在原分支')

  const bad = await callRoute('branch/create', { rootPath: dir, name: 'has space' })
  assert.equal(bad.ok, false, '非法分支名必须拒绝')
  assert.equal(bad.error.code, 'bad-branch')
})

test('branch/switch：改动会被覆盖时由 git 拒绝，错误原样上抛且不丢改动', async () => {
  const dir = makeRepo(path.join(tempDir('dgp-branch-dirty-'), 'repo'))
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  git('checkout', '-q', '-b', 'other')
  writeFileSync(path.join(dir, 'hello.txt'), 'other\n')
  git('commit', '-qam', 'other changes hello')
  git('checkout', '-q', 'main')
  writeFileSync(path.join(dir, 'hello.txt'), 'dirty\n') // 未提交、且与 other 冲突

  const failed = await callRoute('branch/switch', { rootPath: dir, name: 'other' })
  assert.equal(failed.ok, false, '会被覆盖时必须失败')
  assert.match(failed.error.message, /overwritten|local changes/i, '要带 git 的原话：' + failed.error.message)
  // 与 VS Code 的默认行为一致：不自动 stash、不 force，改动还在原处
  assert.equal(readFileSync(path.join(dir, 'hello.txt'), 'utf8'), 'dirty\n', '未提交的改动不能被悄悄丢掉')
})

test('roots/hide 与 roots/unhide：隐藏只改列表标记，仓库本身不动；项目本身不能隐藏', async () => {
  const dir = makeRepo(path.join(tempDir('dgp-hide-'), 'repo'))
  const nested = path.join(dir, 'nested')
  mkdirSync(nested, { recursive: true })
  const nestedGit = (...args) => execFileSync('git', args, { cwd: nested, stdio: 'pipe' })
  nestedGit('init', '-q', '-b', 'main')
  nestedGit('config', 'user.email', 'nested@example.com')
  nestedGit('config', 'user.name', 'Nested')
  writeFileSync(path.join(nested, 'a.txt'), 'a\n')
  nestedGit('add', '-A')
  nestedGit('commit', '-q', '-m', 'nested init')

  const before = await callOk('project/resolve', { cwd: dir })
  const nestedRoot = before.roots.find((root) => root.kind === 'discovered')
  assert.ok(nestedRoot !== undefined, '应先发现子仓库：' + JSON.stringify(before.roots.map((root) => root.kind)))
  assert.equal(nestedRoot.hidden, false, '默认不隐藏')
  assert.equal(before.roots.find((root) => root.kind === 'primary').hidden, false, 'primary 默认不隐藏')

  const hidden = await callOk('roots/hide', { projectRoot: dir, path: nestedRoot.path })
  assert.equal(hidden.roots.find((root) => root.kind === 'discovered').hidden, true, '隐藏后带 hidden 标记')
  assert.equal(existsSync(path.join(nested, '.git')), true, '隐藏不能动仓库本身')

  const again = await callOk('project/resolve', { cwd: dir })
  assert.equal(again.roots.find((root) => root.kind === 'discovered').hidden, true, '隐藏状态要持久化')

  const restored = await callOk('roots/unhide', { projectRoot: dir, path: nestedRoot.path })
  assert.equal(restored.roots.find((root) => root.kind === 'discovered').hidden, false, '取消隐藏后回到列表')

  const denied = await callRoute('roots/hide', { projectRoot: dir, path: dir })
  assert.equal(denied.ok, false, '项目本身不能隐藏')
  assert.equal(denied.error.code, 'cannot-hide')
})

test('commitDiffText：有暂存看暂存；没有则看工作区并带上未跟踪文件清单', async () => {
  const gitHost = await import('../host/git.js')
  const dir = makeRepo(path.join(tempDir('dgp-commit-diff-'), 'repo'))

  assert.equal(await gitHost.commitDiffText(dir), null, '干净仓库没有可生成的差异')

  // 只有未跟踪文件也要有内容：git diff 不显示它们，必须显式列出来
  writeFileSync(path.join(dir, 'brand-new.txt'), 'hello\n')
  const onlyUntracked = await gitHost.commitDiffText(dir)
  assert.equal(onlyUntracked.source, 'unstaged')
  assert.match(onlyUntracked.text, /brand-new\.txt/, '未跟踪文件应出现在文本里：' + onlyUntracked.text)

  // 有已跟踪改动时也一并带上
  writeFileSync(path.join(dir, 'hello.txt'), 'changed\n')
  const mixed = await gitHost.commitDiffText(dir)
  assert.match(mixed.text, /hello\.txt/, '已跟踪改动应在文本里')
  assert.match(mixed.text, /brand-new\.txt/, '未跟踪文件也应在文本里')

  // 一旦有暂存内容，就只看暂存（优先用暂存的）
  await callOk('index/stage', { rootPath: dir, path: 'hello.txt', action: 'stage' })
  const staged = await gitHost.commitDiffText(dir)
  assert.equal(staged.source, 'staged')
  assert.match(staged.text, /hello\.txt/)
  assert.doesNotMatch(staged.text, /brand-new\.txt/, '有暂存时不应混入未跟踪文件')
})

test('commit：有暂存只提交暂存；没有暂存就把全部改动暂存后提交', async () => {
  const dir = makeRepo(path.join(tempDir('dgp-commit-'), 'repo'))

  // 完全没有改动：明确告诉调用方没有可提交的东西
  const clean = await callRoute('commit', { rootPath: dir, message: 'nothing to see' })
  assert.equal(clean.ok, false, '工作区干净时提交必须失败')
  assert.equal(clean.error.code, 'nothing-to-commit')

  const blank = await callRoute('commit', { rootPath: dir, message: '   ' })
  assert.equal(blank.ok, false)
  assert.equal(blank.error.code, 'bad-request')

  // 只有未暂存改动：自动全部暂存（含未跟踪）再提交
  writeFileSync(path.join(dir, 'hello.txt'), 'changed\n')
  writeFileSync(path.join(dir, 'fresh.txt'), 'new\n')
  const smart = await callOk('commit', { rootPath: dir, message: 'update hello\n\nwhy: test' })
  assert.equal(typeof smart.head, 'string', '应返回新提交的短 SHA')
  assert.equal(smart.includedUnstaged, true, '这次提交是自己把未暂存改动加进来的')
  assert.equal(smart.subject, 'update hello', '返回首行主题')

  const afterSmart = await callOk('status', { rootPath: dir })
  assert.equal(afterSmart.files.length, 0, '全部改动都应被提交走：' + JSON.stringify(afterSmart.files))
})

test('commit：还没有第一个提交时也能创建初始提交', async () => {
  const dir = tempDir('dgp-commit-initial-')
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test User')
  writeFileSync(path.join(dir, 'first.txt'), 'hello\n')

  const result = await callOk('commit', { rootPath: dir, message: 'init' })
  assert.equal(result.includedUnstaged, true, '初始提交同样是先暂存再提交')
  const after = await callOk('status', { rootPath: dir })
  assert.equal(after.files.length, 0, '提交后工作区应干净')
  assert.equal(typeof after.head, 'string', '应能读出新的 HEAD')
})

test('commit：已有暂存内容时只提交暂存，未暂存的改动留在工作区', async () => {
  const dir = makeRepo(path.join(tempDir('dgp-commit-staged-'), 'repo'))
  writeFileSync(path.join(dir, 'hello.txt'), 'changed\n')
  writeFileSync(path.join(dir, 'fresh.txt'), 'new\n')

  await callOk('index/stage', { rootPath: dir, path: 'hello.txt', action: 'stage' })
  const committed = await callOk('commit', { rootPath: dir, message: 'update hello' })
  assert.equal(committed.includedUnstaged, false, '这次提交用的是已暂存内容')

  const after = await callOk('status', { rootPath: dir })
  assert.equal(after.files.find((file) => file.path === 'hello.txt'), undefined, '已提交的文件应离开变更列表')
  assert.equal(after.files.find((file) => file.path === 'fresh.txt').untracked, true, '未暂存的文件不应被提交带走')
})

/* --------------------------------------------------- 提交说明生成（llm 服务） */

/** 一个最小的 llm 服务替身：只实现本插件用到的那四个方法。 */
function fakeLlm(overrides = {}) {
  const seen = { calls: [], options: null }
  const service = {
    // 契约：provider 路由是 { id, name }（dsh-llm 的 providerInfo）
    listProviders: () => overrides.providers ?? [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
    listModels: async (provider) => {
      if (overrides.listModels !== undefined) return overrides.listModels(provider)
      // 契约：模型记录一定有非空的 provider/id/name（llm 运行时校验并重建过）
      return provider === 'p1'
        ? [{ provider: 'p1', id: 'm1', name: 'Model One' }, { provider: 'p1', id: 'm2', name: 'Model Two' }]
        : [{ provider: 'p2', id: 'm3', name: 'Model Three' }]
    },
    prepareCall: async (config, signal, configure) => {
      seen.calls.push(config)
      // configure 会拿到 (controls, model 元数据)：给一份带推理档位的模型信息
      const info = overrides.modelInfo ?? { reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } }
      return {
        config: { ...configure(config, info), provider: config.provider, model: config.model },
        stream: (options) => {
          seen.options = options
          if (overrides.stream !== undefined) return overrides.stream(options)
          return (async function* generate() {
            if (overrides.chunks !== undefined) {
              for (const chunk of overrides.chunks) yield chunk
              return
            }
            yield { type: 'text-delta', text: '  feat: 生成说明  ' }
            yield { type: 'text-delta', text: '\n\n- 原因' }
            yield { type: 'finish', reason: { kind: 'stop' } }
          })()
        }
      }
    }
  }
  return { service, seen }
}

const models = await import('../host/models.js')

test('models.listModels：目录来自 llm 服务，provider/模型名都取到', async () => {
  const { service } = fakeLlm()
  const catalog = await models.listModels(service)
  assert.deepEqual(catalog.failed, [])
  assert.deepEqual(catalog.models.map((item) => item.ref), ['p1/m1', 'p1/m2', 'p2/m3'])
  assert.equal(catalog.models[0].providerLabel, 'P1', 'provider 名来自路由的 name')
  assert.equal(catalog.models[0].modelLabel, 'Model One', '模型名来自记录本身')
  assert.equal(catalog.models[1].modelLabel, 'Model Two')
})

test('models.listModels：provider 路由缺 id/name 是契约违背，直接报错而不是跳过', async () => {
  const { service } = fakeLlm({ providers: [{ id: 'p1', name: 'P1' }, { provider: 'p2' }] })
  await assert.rejects(
    () => models.listModels(service),
    (error) => error.code === 'bad-provider' && /p2/.test(error.message)
  )
})

test('models.listModels：单个 provider 失败要报出来，不能吞掉也不能拖垮其它 provider', async () => {
  const { service } = fakeLlm({
    listModels: (provider) => {
      if (provider === 'p1') throw new Error('api key 没配')
      return [{ id: 'm3' }]
    }
  })
  const catalog = await models.listModels(service)
  assert.deepEqual(catalog.models.map((item) => item.ref), ['p2/m3'], '其它 provider 照常列出')
  assert.equal(catalog.failed.length, 1)
  assert.equal(catalog.failed[0].provider, 'p1')
  assert.match(catalog.failed[0].message, /api key/)
})

test('models.listModels：没有 llm 服务时给 no-llm', async () => {
  await assert.rejects(() => models.listModels(null), (error) => error.code === 'no-llm')
})

test('models.parseRef：按第一个斜杠切开，非法输入返回 null', () => {
  assert.deepEqual(models.parseRef('p1/m1'), { provider: 'p1', model: 'm1' })
  assert.deepEqual(models.parseRef('p1/a/b'), { provider: 'p1', model: 'a/b' })
  assert.equal(models.parseRef('m1'), null)
  assert.equal(models.parseRef('/m1'), null)
  assert.equal(models.parseRef('p1/'), null)
  assert.equal(models.parseRef(null), null)
})

test('models.generateCommitMessage：拼 text-delta 得到说明，并把 diff 与 system 传下去', async () => {
  const { service, seen } = fakeLlm()
  const result = await models.generateCommitMessage(service, { provider: 'p1', model: 'm1' }, 'diff --git a/x b/x')
  assert.equal(result.message, 'feat: 生成说明  \n\n- 原因', '文本按块拼接并去掉首尾空白')
  assert.equal(result.model, 'p1/m1')
  assert.equal(seen.options.messages[0].role, 'user')
  assert.equal(seen.options.messages[0].content[0].text, 'diff --git a/x b/x')
  assert.match(seen.options.system, /提交说明/)
  assert.equal(seen.calls[0].maxTokens > 0, true, '要带输出上限')
})

test('models.generateCommitMessage：finish 是错误时抛 model-failed，不返回半截文本', async () => {
  const { service } = fakeLlm({
    chunks: [
      { type: 'text-delta', text: '半截' },
      { type: 'finish', reason: { kind: 'error', failure: { message: '额度不足' } } }
    ]
  })
  await assert.rejects(
    () => models.generateCommitMessage(service, { provider: 'p1', model: 'm1' }, 'diff'),
    (error) => error.code === 'model-failed' && /额度不足/.test(error.message)
  )
})

test('models.generateCommitMessage：模型没吐文本时抛 model-failed', async () => {
  const { service } = fakeLlm({ chunks: [{ type: 'finish', reason: { kind: 'stop' } }] })
  await assert.rejects(
    () => models.generateCommitMessage(service, { provider: 'p1', model: 'm1' }, 'diff'),
    (error) => error.code === 'model-failed'
  )
})

test('models.generateCommitMessage：输出上限留够，不被推理吃掉', async () => {
  const { service, seen } = fakeLlm()
  await models.generateCommitMessage(service, { provider: 'p1', model: 'm1' }, 'diff')
  assert.equal(seen.calls[0].maxTokens >= 1024, true, 'maxTokens 太小会让推理型模型返回空文本：' + seen.calls[0].maxTokens)
})

test('models.generateCommitMessage：模型没有推理档位时不动 controls', async () => {
  const { service } = fakeLlm({ modelInfo: {} })
  const result = await models.generateCommitMessage(service, { provider: 'p1', model: 'm1' }, 'diff')
  assert.equal(result.message.includes('feat'), true)
})

test('models.generateCommitMessage：provider 一直不回时按 timeout 结束，不无限挂', async () => {
  const { service } = fakeLlm({
    stream: (options) => (async function* hang() {
      await new Promise((resolve, reject) => {
        if (options.signal !== undefined && options.signal.aborted === true) {
          reject(new Error('aborted'))
          return
        }
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
      })
    })()
  })
  await assert.rejects(
    () => models.generateCommitMessage(service, { provider: 'p1', model: 'm1' }, 'diff', { timeoutMs: 30 }),
    (error) => error.code === 'timeout' && /秒内没有返回/.test(error.message)
  )
})

test('models.generateCommitMessage：provider 抛异常时把原因和模型都写进 message', async () => {
  const { service } = fakeLlm({
    stream: () => (async function* boom() {
      throw new Error('connect ECONNREFUSED')
    })()
  })
  await assert.rejects(
    () => models.generateCommitMessage(service, { provider: 'p1', model: 'm1' }, 'diff'),
    (error) => error.code === 'model-failed' && /ECONNREFUSED/.test(error.message) && /p1\/m1/.test(error.message)
  )
})

test('models.generateCommitMessage：模型不在目录里时抛 unknown-model', async () => {
  const { service } = fakeLlm()
  await assert.rejects(
    () => models.generateCommitMessage(service, { provider: 'p1', model: 'nope' }, 'diff'),
    (error) => error.code === 'unknown-model'
  )
})

test('models 设置：结构不对就是坏配置，不静默当成「未设置」', async () => {
  const file = models.settingsPath()
  mkdirSync(path.dirname(file), { recursive: true })

  writeFileSync(file, JSON.stringify({ version: 1, commitModel: { provider: 'p1' } }), 'utf8')
  await assert.rejects(() => models.readSettings(), (error) => error.code === 'bad-config')

  writeFileSync(file, '[]', 'utf8')
  await assert.rejects(() => models.readSettings(), (error) => error.code === 'bad-config')

  writeFileSync(file, '{oops', 'utf8')
  await assert.rejects(() => models.readSettings(), (error) => error.code === 'bad-config')

  await models.writeSettings({ commitModel: null }) // 还原成合法状态，避免影响后续用例
})

test('models 设置：存的是 provider/model 对，读回来一致，null 表示清空', async () => {
  assert.equal((await models.readSettings()).commitModel, null, '没有设置文件时是 null')
  assert.equal((await models.readSettings()).reviewModel, null, '审阅模型同样默认为 null')

  await models.writeSettings({ commitModel: { provider: 'p1', model: 'm1' } })
  assert.deepEqual((await models.readSettings()).commitModel, { provider: 'p1', model: 'm1' })

  // 只改审阅模型：提交说明模型不能被抹掉
  await models.writeSettings({ reviewModel: { provider: 'p2', model: 'm2' } })
  const both = await models.readSettings()
  assert.deepEqual(both.commitModel, { provider: 'p1', model: 'm1' }, '另一个模型必须保留')
  assert.deepEqual(both.reviewModel, { provider: 'p2', model: 'm2' })

  await models.writeSettings({ commitModel: null })
  assert.equal((await models.readSettings()).commitModel, null)
  await models.writeSettings({ reviewModel: null })
  assert.equal((await models.readSettings()).reviewModel, null)
})

test('apply 注入 llm 后：models/list 走真实 llm，settings/set 校验模型存在', async () => {
  // 全新模块实例：llmService 是模块级引用，不能与该文件顶部的 apply 混用
  const fresh = await import('../index.js?llm-probe')
  const freshRoutes = new Map()
  const llm = fakeLlm().service
  const ctx = {
    connection: {
      fetch: {
        register(route) {
          freshRoutes.set(route.path, route)
          return () => freshRoutes.delete(route.path)
        }
      }
    },
    llm,
    effect(fn) {
      return fn()
    },
    inject(deps, callback) {
      const provided = { connection: ctx.connection, llm: ctx.llm }
      if (!deps.every((dep) => provided[dep] !== undefined)) return
      callback(ctx)
    },
    get() {
      return undefined
    },
    sessions: { get: () => undefined },
    logger: { info() {}, warn() {}, error() {}, debug() {} }
  }
  fresh.apply(ctx)

  const call = async (endpoint, payload) => {
    const route = freshRoutes.get(fresh.routePathOf(endpoint))
    assert.ok(route !== undefined, '没有注册路由: ' + endpoint)
    const request = {
      json: async () => ({ type: 'client-request', rpcId: 'r1', method: 'dsh-git/' + endpoint, payload })
    }
    const body = await (await route.fetch(request)).json()
    return body.result
  }

  const listed = await call('models/list', {})
  assert.equal(listed.ok, true, JSON.stringify(listed))
  assert.deepEqual(listed.value.models.map((model) => model.ref), ['p1/m1', 'p1/m2', 'p2/m3'])

  const bad = await call('settings/set', { commitModel: 'p1/nope' })
  assert.equal(bad.ok, false, '目录里没有的模型必须拒绝')
  assert.equal(bad.error.code, 'unknown-model')

  const good = await call('settings/set', { commitModel: 'p1/m1' })
  assert.equal(good.ok, true, JSON.stringify(good))
  assert.deepEqual(good.value.commitModel, { provider: 'p1', model: 'm1' })
  assert.deepEqual((await call('settings/get', {})).value.commitModel, { provider: 'p1', model: 'm1' })
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
