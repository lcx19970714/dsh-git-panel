/**
 * test/remotes.test.mjs —— 代码托管账号、远端仓库列表、克隆
 *
 * 网络与凭据都用假实现：fetch 由测试提供，凭据服务用一个内存 Map 模拟。
 * 克隆是真的跑 git（用本地裸仓库当远端），验证落到磁盘上的结果。
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createRemotes, PROVIDER_IDS } from '../host/remotes.js'

const tempDir = (prefix) => mkdtempSync(path.join(os.tmpdir(), prefix))

function summary(name) {
  return { name, passed: 0, failed: 0 }
}
const current = summary('remotes')

function test(name, fn) {
  return (async () => {
    try {
      await fn()
      current.passed += 1
      console.log('  ✓ ' + name)
    } catch (error) {
      current.failed += 1
      console.log('  ✗ ' + name)
      console.log('    ' + (error && error.message ? error.message : String(error)))
    }
  })()
}

/** 内存凭据服务：readRecord / modifyRecord 语义与 dsh-credentials 一致。 */
function fakeCredentials() {
  const records = new Map()
  return {
    records,
    async readRecord(key) {
      const record = records.get(key)
      return record === undefined ? undefined : JSON.parse(JSON.stringify(record))
    },
    async modifyRecord(key, mutate) {
      const previous = records.get(key)
      const next = await mutate(previous === undefined ? undefined : JSON.parse(JSON.stringify(previous)))
      if (next === undefined) return undefined
      records.set(key, next)
      return next
    }
  }
}

/** 按 URL 路由的假 fetch。 */
function fakeFetch(routes) {
  const calls = []
  const impl = async (url, options) => {
    calls.push({ url, options })
    for (const [pattern, handler] of routes) {
      if (pattern.test(url)) {
        const body = typeof handler === 'function' ? handler(url, options) : handler
        const headers = body.headers ?? {}
        return {
          ok: body.status === undefined || body.status < 400,
          status: body.status ?? 200,
          headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
          text: async () => JSON.stringify(body.json ?? {})
        }
      }
    }
    throw new Error('没有为这个地址准备假响应: ' + url)
  }
  impl.calls = calls
  return impl
}

function makeBareRemote(name) {
  const root = tempDir('dgp-remote-bare-')
  const bare = path.join(root, name + '.git')
  const work = path.join(root, name + '-work')
  execFileSync('git', ['init', '--bare', '-q', bare], { stdio: 'pipe' })
  mkdirSync(work, { recursive: true })
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: work, stdio: 'pipe' })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: work })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: work })
  writeFileSync(path.join(work, 'README.md'), '# ' + name + '\n')
  execFileSync('git', ['add', '-A'], { cwd: work })
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: work })
  execFileSync('git', ['remote', 'add', 'origin', bare], { cwd: work })
  execFileSync('git', ['push', '-q', 'origin', 'main'], { cwd: work })
  // 裸仓库 HEAD 必须指向 main，否则 clone 出来是空工作区
  execFileSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: bare })
  return bare
}

/* ------------------------------------------------------------------------ */

await test('没有凭据服务时，账号操作明确报 no-credentials', async () => {
  const remotes = createRemotes({ credentials: null, fetchImpl: fakeFetch([]) })
  await assert.rejects(
    () => remotes.listAccounts(),
    (error) => error.code === 'no-credentials'
  )
})

await test('添加账号：先用 token 调 /user 验证，再存进凭据服务，列表不返回 token', async () => {
  const credentials = fakeCredentials()
  const fetchImpl = fakeFetch([
    [/api\.github\.com\/user$/, { json: { login: 'alice' } }]
  ])
  const remotes = createRemotes({ credentials, fetchImpl })

  const added = await remotes.addAccount({ provider: 'github', label: '工作号', token: 'ghp_x' })
  assert.equal(added.account.id, 'github:alice')
  assert.equal(added.account.label, '工作号')

  const listed = await remotes.listAccounts()
  assert.equal(listed.accounts.length, 1)
  assert.equal(listed.accounts[0].provider, 'github')
  assert.equal(listed.accounts[0].login, 'alice')
  assert.equal(Object.prototype.hasOwnProperty.call(listed.accounts[0], 'token'), false, '列表里不能出现 token')

  // token 真的落在凭据服务里（grant 记录）
  const record = credentials.records.get('dsh-git-panel/github')
  assert.equal(record.kind, 'grant')
  assert.equal(record.payload.accounts[0].token, 'ghp_x')
  assert.deepEqual(listed.providers.map((item) => item.id), PROVIDER_IDS)
})

await test('添加账号：令牌无效时报 remote-auth-failed，且不写入', async () => {
  const credentials = fakeCredentials()
  const fetchImpl = fakeFetch([
    [/api\.github\.com\/user$/, { status: 401, json: {} }]
  ])
  const remotes = createRemotes({ credentials, fetchImpl })
  await assert.rejects(
    () => remotes.addAccount({ provider: 'github', token: 'bad' }),
    (error) => error.code === 'remote-auth-failed' && /令牌无效/.test(error.message)
  )
  assert.equal(credentials.records.size, 0, '验证失败不能留下记录')
})

await test('添加账号：同一账号重复添加直接报错', async () => {
  const credentials = fakeCredentials()
  const fetchImpl = fakeFetch([[/api\.github\.com\/user$/, { json: { login: 'bob' } }]])
  const remotes = createRemotes({ credentials, fetchImpl })
  await remotes.addAccount({ provider: 'github', token: 'a' })
  await assert.rejects(
    () => remotes.addAccount({ provider: 'github', token: 'b' }),
    (error) => error.code === 'account-exists'
  )
})

await test('移除账号：从记录里删掉，其它账号保留', async () => {
  const credentials = fakeCredentials()
  const fetchImpl = fakeFetch([
    [/api\.github\.com\/user$/, { json: { login: 'carol' } }],
    [/gitee\.com\/api\/v5\/user/, { json: { login: 'dave' } }]
  ])
  const remotes = createRemotes({ credentials, fetchImpl })
  await remotes.addAccount({ provider: 'github', token: 'a' })
  await remotes.addAccount({ provider: 'gitee', token: 'b' })

  const after = await remotes.removeAccount({ id: 'github:carol' })
  assert.deepEqual(after.accounts.map((account) => account.id), ['gitee:dave'])
})

await test('改账号：备注名可以随时修改，id 与登录名不变', async () => {
  const credentials = fakeCredentials()
  const fetchImpl = fakeFetch([[/api\.github\.com\/user$/, { json: { login: 'alice' } }]])
  const remotes = createRemotes({ credentials, fetchImpl })
  await remotes.addAccount({ provider: 'github', token: 'ghp_x', label: '旧名字' })

  const updated = await remotes.updateAccount({ id: 'github:alice', label: '新名字' })
  assert.equal(updated.account.label, '新名字')
  assert.equal(updated.account.id, 'github:alice')

  const listed = await remotes.listAccounts()
  assert.equal(listed.accounts[0].label, '新名字')
  assert.equal(listed.accounts[0].login, 'alice')

  // 备注名清空 → 显示登录名
  const cleared = await remotes.updateAccount({ id: 'github:alice', label: '' })
  assert.equal(cleared.account.label, 'alice')
})

await test('改账号：换令牌前会验证，且必须属于同一账号', async () => {
  const credentials = fakeCredentials()
  let login = 'alice'
  const fetchImpl = fakeFetch([
    [/api\.github\.com\/user$/, () => ({ json: { login } })]
  ])
  const remotes = createRemotes({ credentials, fetchImpl })
  await remotes.addAccount({ provider: 'github', token: 'ghp_old' })

  // 新令牌属于另一个账号 → 拒绝，且不落库
  login = 'bob'
  await assert.rejects(
    () => remotes.updateAccount({ id: 'github:alice', token: 'ghp_other' }),
    (error) => error.code === 'token-mismatch' && /bob/.test(error.message)
  )
  assert.equal((await remotes.readToken({ id: 'github:alice' })).token, 'ghp_old')

  // 同账号的新令牌 → 通过并替换
  login = 'alice'
  await remotes.updateAccount({ id: 'github:alice', token: 'ghp_new' })
  assert.equal((await remotes.readToken({ id: 'github:alice' })).token, 'ghp_new')
})

await test('读令牌：返回原文，未知账号直接报错', async () => {
  const credentials = fakeCredentials()
  const fetchImpl = fakeFetch([[/api\.github\.com\/user$/, { json: { login: 'alice' } }]])
  const remotes = createRemotes({ credentials, fetchImpl })
  await remotes.addAccount({ provider: 'github', token: 'ghp_secret' })

  const value = await remotes.readToken({ id: 'github:alice' })
  assert.equal(value.token, 'ghp_secret')

  await assert.rejects(
    () => remotes.readToken({ id: 'github:nobody' }),
    (error) => error.code === 'bad-request'
  )
})

await test('列仓库：两个平台的字段都被归一成同一形状', async () => {
  const credentials = fakeCredentials()
  const fetchImpl = fakeFetch([
    [/api\.github\.com\/user$/, { json: { login: 'alice' } }],
    [/api\.github\.com\/user\/repos/, {
      json: [{
        full_name: 'alice/app', name: 'app', private: true, description: 'demo', language: 'TypeScript',
        updated_at: '2026-01-02T03:04:05Z', size: 120, default_branch: 'main',
        html_url: 'https://github.com/alice/app', clone_url: 'https://github.com/alice/app.git'
      }]
    }],
    [/gitee\.com\/api\/v5\/user\/repos/, {
      json: [{
        full_name: 'bob/tool', name: 'tool', private: false, description: '', language: 'Go',
        updated_at: '2026-02-03T00:00:00Z', size: 8, default_branch: 'master',
        html_url: 'https://gitee.com/bob/tool', clone_url: 'https://gitee.com/bob/tool.git'
      }]
    }],
    [/gitee\.com\/api\/v5\/user\?/, { json: { login: 'bob' } }]
  ])
  const remotes = createRemotes({ credentials, fetchImpl })
  await remotes.addAccount({ provider: 'github', token: 'a' })
  await remotes.addAccount({ provider: 'gitee', token: 'b' })

  const github = await remotes.listRepos({ accountId: 'github:alice' })
  assert.equal(github.repos.length, 1)
  assert.deepEqual(Object.keys(github.repos[0]).sort(), [
    'accountId', 'cloneUrl', 'defaultBranch', 'description', 'fullName', 'htmlUrl',
    'language', 'name', 'private', 'provider', 'sizeKb', 'updatedAt'
  ])
  assert.equal(github.repos[0].cloneUrl, 'https://github.com/alice/app.git')
  assert.equal(github.repos[0].private, true)

  const gitee = await remotes.listRepos({ accountId: 'gitee:bob' })
  assert.equal(gitee.repos[0].fullName, 'bob/tool')
  assert.equal(gitee.repos[0].language, 'Go')
})

await test('仓库详情：GitHub 的 issue 数要减掉 PR，总数来自 Link 最后一页', async () => {
  const credentials = fakeCredentials()
  const link = (page) => `<https://api.github.com/x?page=${page}>; rel="last"`
  const fetchImpl = fakeFetch([
    [/api\.github\.com\/user$/, { json: { login: 'alice' } }],
    [/\/repos\/alice\/app\/issues\?.*per_page=1$/, { json: [], headers: { link: link(12) } }],
    [/\/repos\/alice\/app\/pulls\?.*per_page=1$/, { json: [], headers: { link: link(5) } }],
    [/\/repos\/alice\/app\/issues\?/, {
      json: [
        { number: 7, title: 'issue A', html_url: 'https://github.com/alice/app/issues/7', user: { login: 'bob' }, created_at: '2026-01-01T00:00:00Z' },
        { number: 8, title: 'PR disguised as issue', html_url: 'https://x', pull_request: { url: 'x' }, user: { login: 'bob' } }
      ]
    }],
    [/\/repos\/alice\/app\/pulls\?/, {
      json: [{ number: 3, title: 'PR three', html_url: 'https://github.com/alice/app/pull/3', user: { login: 'carl' }, comments: 0 }]
    }],
    [/\/repos\/alice\/app$/, {
      json: {
        full_name: 'alice/app', description: 'demo', language: 'TypeScript', private: false,
        default_branch: 'main', size: 120, stargazers_count: 9, forks_count: 2,
        updated_at: '2026-02-02T00:00:00Z', html_url: 'https://github.com/alice/app'
      }
    }]
  ])
  const remotes = createRemotes({ credentials, fetchImpl })
  await remotes.addAccount({ provider: 'github', token: 'a' })

  const detail = await remotes.repoDetail({ accountId: 'github:alice', fullName: 'alice/app' })
  assert.equal(detail.repo.language, 'TypeScript')
  assert.equal(detail.repo.stars, 9)
  assert.equal(detail.repo.issuesUrl, 'https://github.com/alice/app/issues')
  assert.equal(detail.pulls.total, 5, 'PR 总数 = Link 最后一页')
  assert.equal(detail.issues.total, 7, 'issue 数 = 12 - 5')
  assert.equal(detail.issues.items.length, 1, 'issues 列表里要过滤掉 PR')
  assert.equal(detail.issues.items[0].title, 'issue A')
  assert.equal(detail.pulls.items[0].number, 3)
  assert.deepEqual(detail.failures, [])
})

await test('仓库详情：某一块失败只标记那一块，其余照常返回', async () => {
  const credentials = fakeCredentials()
  const fetchImpl = fakeFetch([
    [/api\.github\.com\/user$/, { json: { login: 'alice' } }],
    [/\/repos\/alice\/app\/issues\?.*per_page=1$/, { json: [], headers: { link: '<x?page=4>; rel="last"' } }],
    [/\/repos\/alice\/app\/pulls\?.*per_page=1$/, { status: 500, json: {} }],
    [/\/repos\/alice\/app\/issues\?/, { json: [] }],
    [/\/repos\/alice\/app\/pulls\?/, { status: 500, json: {} }],
    [/\/repos\/alice\/app$/, { json: { full_name: 'alice/app', language: 'Go', html_url: 'https://github.com/alice/app' } }]
  ])
  const remotes = createRemotes({ credentials, fetchImpl })
  await remotes.addAccount({ provider: 'github', token: 'a' })

  const detail = await remotes.repoDetail({ accountId: 'github:alice', fullName: 'alice/app' })
  assert.equal(detail.repo.language, 'Go', '仓库详情照常返回')
  assert.deepEqual(detail.pulls.items, [], 'PR 块为空')
  assert.equal(detail.pulls.total, null, '拿不到就是 null，不编数字')
  assert.equal(detail.failures.length, 1, '失败要报出来')
  assert.equal(detail.failures[0].section, 'pulls')
})

await test('克隆：把本地裸仓库拉到项目根下的子目录，名字可改', async () => {
  const credentials = fakeCredentials()
  const fetchImpl = fakeFetch([[/api\.github\.com\/user$/, { json: { login: 'alice' } }]])
  const remotes = createRemotes({ credentials, fetchImpl })
  await remotes.addAccount({ provider: 'github', token: 'a' })

  const bare = makeBareRemote('demo')
  const projectRoot = tempDir('dgp-remote-project-')
  const result = await remotes.cloneRepo({
    accountId: 'github:alice',
    fullName: 'alice/demo',
    cloneUrl: bare,
    projectRoot,
    targetName: 'my-demo'
  })
  assert.equal(result.name, 'my-demo')
  assert.equal(existsSync(path.join(projectRoot, 'my-demo', 'README.md')), true)
  // Windows 上 core.autocrlf 会把检出内容换成 CRLF，比较前统一换行符
  assert.equal(readFileSync(path.join(projectRoot, 'my-demo', 'README.md'), 'utf8').replace(/\r\n/g, '\n'), '# demo\n')
})

await test('克隆：目标已存在时报 target-exists，不覆盖', async () => {
  const credentials = fakeCredentials()
  const fetchImpl = fakeFetch([[/api\.github\.com\/user$/, { json: { login: 'alice' } }]])
  const remotes = createRemotes({ credentials, fetchImpl })
  await remotes.addAccount({ provider: 'github', token: 'a' })

  const bare = makeBareRemote('taken')
  const projectRoot = tempDir('dgp-remote-project-')
  mkdirSync(path.join(projectRoot, 'taken'))
  await assert.rejects(
    () => remotes.cloneRepo({ accountId: 'github:alice', fullName: 'alice/taken', cloneUrl: bare, projectRoot }),
    (error) => error.code === 'target-exists'
  )
})

await test('克隆：地址既不是 http(s) 也不是本地路径时拒绝', async () => {
  const credentials = fakeCredentials()
  const fetchImpl = fakeFetch([[/api\.github\.com\/user$/, { json: { login: 'alice' } }]])
  const remotes = createRemotes({ credentials, fetchImpl })
  await remotes.addAccount({ provider: 'github', token: 'a' })
  const projectRoot = tempDir('dgp-remote-project-')
  await assert.rejects(
    () => remotes.cloneRepo({
      accountId: 'github:alice', fullName: 'alice/x', cloneUrl: 'not-a-url', projectRoot
    }),
    (error) => error.code === 'bad-request'
  )
})

console.log('')
console.log('remotes：' + current.passed + ' passed, ' + current.failed + ' failed')
if (current.failed > 0) process.exit(1)
