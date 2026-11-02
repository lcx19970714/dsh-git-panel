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

import { createRemotes, PROVIDER_IDS } from '../host/remotes/index.js'

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
          // empty: true 模拟 204 / 空响应体（Gitee 的审查接口就是这样）
          text: async () => (body.empty === true ? '' : JSON.stringify(body.json ?? {}))
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

await test('Gitee：详情/列表/取用户都带 access_token，GitHub 的 URL 里不带 token', async () => {
  const credentials = fakeCredentials()
  const fetchImpl = fakeFetch([
    [/gitee\.com\/api\/v5\/user\?/, { json: { login: 'bob' } }],
    [/gitee\.com\/api\/v5\/user\/repos/, { json: [] }],
    [/gitee\.com\/api\/v5\/repos\/bob\/tool\/issues\?.*per_page=1/, { json: [], headers: { link: '<x?page=2>; rel="last"' } }],
    [/gitee\.com\/api\/v5\/repos\/bob\/tool\/pulls\?.*per_page=1/, { json: [], headers: { link: '<x?page=1>; rel="last"' } }],
    [/gitee\.com\/api\/v5\/repos\/bob\/tool\/issues\?/, { json: [] }],
    [/gitee\.com\/api\/v5\/repos\/bob\/tool\/pulls\?/, { json: [] }],
    [/gitee\.com\/api\/v5\/repos\/bob\/tool\?/, { json: { full_name: 'bob/tool', language: 'Go', html_url: 'https://gitee.com/bob/tool' } }],
    [/api\.github\.com\/user$/, { json: { login: 'alice' } }],
    [/api\.github\.com\/repos\/alice\/app\/issues\?.*per_page=1/, { json: [], headers: { link: '<x?page=1>; rel="last"' } }],
    [/api\.github\.com\/repos\/alice\/app\/pulls\?.*per_page=1/, { json: [], headers: { link: '<x?page=1>; rel="last"' } }],
    [/api\.github\.com\/repos\/alice\/app\/issues\?/, { json: [] }],
    [/api\.github\.com\/repos\/alice\/app\/pulls\?/, { json: [] }],
    [/api\.github\.com\/repos\/alice\/app$/, { json: { full_name: 'alice/app', html_url: 'https://github.com/alice/app' } }]
  ])
  const remotes = createRemotes({ credentials, fetchImpl })
  await remotes.addAccount({ provider: 'gitee', token: 'gitee_tok' })
  await remotes.addAccount({ provider: 'github', token: 'gh_tok' })

  const giteeDetail = await remotes.repoDetail({ accountId: 'gitee:bob', fullName: 'bob/tool' })
  assert.equal(giteeDetail.repo.language, 'Go')

  // 私有仓库在 Gitee 上无权访问会返回 404，所以每个请求都必须带 token
  const giteeCalls = fetchImpl.calls.filter((call) => call.url.includes('gitee.com'))
  assert.ok(giteeCalls.length >= 5, '应至少有取用户/列仓库/详情/issue/PR 五次请求：' + giteeCalls.length)
  for (const call of giteeCalls) {
    assert.match(call.url, /access_token=gitee_tok/, 'Gitee 请求必须带 access_token：' + call.url)
  }

  const githubDetail = await remotes.repoDetail({ accountId: 'github:alice', fullName: 'alice/app' })
  assert.equal(githubDetail.repo.fullName, 'alice/app')

  const githubCalls = fetchImpl.calls.filter((call) => call.url.includes('api.github.com'))
  assert.ok(githubCalls.length >= 5, 'GitHub 也应有取用户/详情/issue/PR 等请求：' + githubCalls.length)
  for (const call of githubCalls) {
    assert.doesNotMatch(call.url, /access_token|gh_tok/, 'GitHub 的 token 不能出现在 URL 里：' + call.url)
    assert.equal(call.options.headers.Authorization, 'Bearer gh_tok', 'GitHub 走请求头')
  }
})

await test('私有仓库 404 时，错误里要说明可能是权限问题', async () => {
  const credentials = fakeCredentials()
  const fetchImpl = fakeFetch([
    [/gitee\.com\/api\/v5\/user\?/, { json: { login: 'bob' } }],
    [/gitee\.com\/api\/v5\/repos\/bob\/private\?/, { status: 404, json: { message: 'Not Found Project' } }]
  ])
  const remotes = createRemotes({ credentials, fetchImpl })
  await remotes.addAccount({ provider: 'gitee', token: 't' })

  await assert.rejects(
    () => remotes.repoDetail({ accountId: 'gitee:bob', fullName: 'bob/private' }),
    (error) => error.code === 'remote-auth-failed'
      && /404/.test(error.message)
      && /权限/.test(error.message)
  )
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

await test('PR 详情：返回基础信息、审查记录与平台能力', async () => {
  const credentials = fakeCredentials()
  const fetchImpl = fakeFetch([
    [/api\.github\.com\/user$/, { json: { login: 'alice' } }],
    [/api\.github\.com\/repos\/alice\/app\/pulls\/7\/reviews$/, {
      json: [{ user: { login: 'bob' }, state: 'APPROVED', body: 'LGTM', submitted_at: '2026-02-01T00:00:00Z' }]
    }],
    [/api\.github\.com\/repos\/alice\/app\/pulls\/7$/, {
      json: {
        number: 7, title: 'Add remote panel', body: 'body text', state: 'open', user: { login: 'alice' },
        base: { ref: 'main' }, head: { ref: 'feature/remote' }, mergeable: true, merged: false,
        additions: 120, deletions: 8, changed_files: 6, commits: 3,
        created_at: '2026-01-30T00:00:00Z', updated_at: '2026-02-01T00:00:00Z',
        html_url: 'https://github.com/alice/app/pull/7'
      }
    }]
  ])
  const remotes = createRemotes({ credentials, fetchImpl })
  await remotes.addAccount({ provider: 'github', token: 't' })

  const detail = await remotes.pullDetail({ accountId: 'github:alice', fullName: 'alice/app', number: 7 })
  assert.equal(detail.pull.headBranch, 'feature/remote')
  assert.equal(detail.pull.additions, 120)
  assert.equal(detail.reviews.length, 1)
  assert.equal(detail.reviews[0].state, 'APPROVED')
  assert.deepEqual(detail.capabilities.verdicts, ['approve', 'request-changes', 'comment'])
  assert.deepEqual(detail.capabilities.mergeMethods, ['merge', 'squash', 'rebase'])
  assert.equal(detail.capabilities.reviews, true)
})

await test('审查：GitHub 三种结论都能发；请求修改必须带说明', async () => {
  const credentials = fakeCredentials()
  const posts = []
  const fetchImpl = fakeFetch([
    [/api\.github\.com\/user$/, { json: { login: 'alice' } }],
    [/api\.github\.com\/repos\/alice\/app\/pulls\/7\/reviews$/, (url, options) => {
      posts.push(JSON.parse(options.body))
      return { status: 200, json: { id: 1 } }
    }]
  ])
  const remotes = createRemotes({ credentials, fetchImpl })
  await remotes.addAccount({ provider: 'github', token: 't' })

  await remotes.reviewPull({ accountId: 'github:alice', fullName: 'alice/app', number: 7, verdict: 'approve' })
  assert.deepEqual(posts[0], { event: 'APPROVE' })

  await remotes.reviewPull({ accountId: 'github:alice', fullName: 'alice/app', number: 7, verdict: 'request-changes', body: '修一下' })
  assert.deepEqual(posts[1], { event: 'REQUEST_CHANGES', body: '修一下' })

  await assert.rejects(
    () => remotes.reviewPull({ accountId: 'github:alice', fullName: 'alice/app', number: 7, verdict: 'request-changes' }),
    (error) => error.code === 'bad-request'
  )
})

await test('合并：已合并/非打开/不可合并都拒绝；成功时带方法与删分支', async () => {
  const credentials = fakeCredentials()
  const calls = []
  let state = { merged: false, state: 'open', mergeable: true }
  const fetchImpl = fakeFetch([
    [/api\.github\.com\/user$/, { json: { login: 'alice' } }],
    [/\/pulls\/7\/merge$/, (url, options) => {
      calls.push({ url, method: options.method, body: JSON.parse(options.body) })
      return { json: { merged: true, message: 'Pull Request successfully merged' } }
    }],
    [/\/git\/refs\/heads\/feature%2Fremote$/, (url, options) => {
      calls.push({ url, method: options.method })
      return { json: {} }
    }],
    [/\/pulls\/7$/, () => ({
      json: {
        number: 7, title: 'T', state: state.state, merged: state.merged, mergeable: state.mergeable,
        base: { ref: 'main' }, head: { ref: 'feature/remote' }, html_url: 'https://x'
      }
    })]
  ])
  const remotes = createRemotes({ credentials, fetchImpl })
  await remotes.addAccount({ provider: 'github', token: 't' })
  const base = { accountId: 'github:alice', fullName: 'alice/app', number: 7 }

  state = { merged: true, state: 'closed', mergeable: true }
  await assert.rejects(() => remotes.mergePull(base), (error) => error.code === 'already-merged')

  state = { merged: false, state: 'closed', mergeable: true }
  await assert.rejects(() => remotes.mergePull(base), (error) => error.code === 'not-open')

  state = { merged: false, state: 'open', mergeable: false }
  await assert.rejects(() => remotes.mergePull(base), (error) => error.code === 'not-mergeable')

  state = { merged: false, state: 'open', mergeable: true }
  const result = await remotes.mergePull({ ...base, method: 'squash', deleteBranch: true })
  assert.equal(result.merged, true)
  assert.equal(result.branchDeleted, true)
  assert.deepEqual(calls[0].body, { merge_method: 'squash' }, 'GitHub 不认 prune 参数')
  assert.equal(calls[0].url.includes('/pulls/7/merge'), true)
  assert.equal(calls[1].method, 'DELETE', '删源分支单独调 git refs')

  await assert.rejects(
    () => remotes.mergePull({ ...base, method: 'fast-forward' }),
    (error) => error.code === 'bad-request'
  )
})

await test('Gitee 审查通过返回空响应时，不能再报「不是 JSON」', async () => {
  const credentials = fakeCredentials()
  const calls = []
  const fetchImpl = fakeFetch([
    [/gitee\.com\/api\/v5\/user\?/, { json: { login: 'bob' } }],
    // 真实接口成功时就是空体（204），旧实现会在这里抛「接口返回的不是 JSON」
    [/\/pulls\/5\/review\?/, (url, options) => {
      calls.push({ url, method: options.method })
      return { status: 204, empty: true }
    }]
  ])
  const remotes = createRemotes({ credentials, fetchImpl })
  await remotes.addAccount({ provider: 'gitee', token: 't' })

  const result = await remotes.reviewPull({
    accountId: 'gitee:bob',
    fullName: 'bob/tool',
    number: 5,
    verdict: 'approve'
  })
  assert.equal(result.verdict, 'approve')
  assert.equal(result.bodyPosted, false)
  assert.equal(calls.length, 1, '只发了 /review 一次请求')
})

await test('带 body 的请求都声明了 Content-Type: application/json', async () => {
  const credentials = fakeCredentials()
  const seen = []
  const capture = (url, options) => {
    seen.push({ url, method: options.method, contentType: options.headers?.['Content-Type'], body: options.body })
    if (url.includes('/merge')) return { json: { merged: true } }
    if (url.includes('/reviews')) return { json: {} }
    if (url.includes('/comments')) return { json: {} }
    if (url.includes('/review')) return { status: 204, empty: true }
    return { json: { number: 6, title: 'T', state: 'open', merged: false, mergeable: true, base: { ref: 'main' }, head: { ref: 'feat' } } }
  }
  const fetchImpl = fakeFetch([
    [/api\.github\.com\/user$/, { json: { login: 'alice' } }],
    [/gitee\.com\/api\/v5\/user\?/, { json: { login: 'bob' } }],
    [/\/pulls\/6\/reviews$/, capture],
    [/\/pulls\/6\/merge/, capture],
    [/\/pulls\/6\/comments/, capture],
    [/\/pulls\/6\/review/, capture],
    [/\/pulls\/6(\?|$)/, capture]
  ])
  const remotes = createRemotes({ credentials, fetchImpl })
  await remotes.addAccount({ provider: 'github', token: 'a' })
  await remotes.addAccount({ provider: 'gitee', token: 'b' })

  await remotes.reviewPull({ accountId: 'github:alice', fullName: 'alice/app', number: 6, verdict: 'approve' })
  await remotes.mergePull({ accountId: 'github:alice', fullName: 'alice/app', number: 6, method: 'merge' })
  await remotes.reviewPull({ accountId: 'gitee:bob', fullName: 'bob/tool', number: 6, verdict: 'approve', body: '不错' })
  await remotes.mergePull({ accountId: 'gitee:bob', fullName: 'bob/tool', number: 6, method: 'merge' })

  const withBody = seen.filter((call) => typeof call.body === 'string' && call.body !== '')
  assert.ok(withBody.length >= 4, '应该有多次带 body 的请求：' + withBody.length)
  for (const call of withBody) {
    assert.equal(
      call.contentType,
      'application/json;charset=UTF-8',
      '带 body 的请求必须声明 JSON 内容类型：' + call.method + ' ' + call.url + ' => ' + String(call.contentType)
    )
    assert.doesNotThrow(() => JSON.parse(call.body), 'body 必须是合法 JSON：' + call.body)
  }

  // Gitee 的 /review 不带 body（平台接口就是这样），因此也不该被塞 content-type
  const reviewCall = seen.find((call) => /\/pulls\/6\/review(\?|$)/.test(call.url))
  assert.equal(reviewCall.body, undefined, 'Gitee 审查接口不带请求体')
})

await test('需要对象的接口遇到空响应时，给出明确原因', async () => {
  const credentials = fakeCredentials()
  const fetchImpl = fakeFetch([
    [/api\.github\.com\/user$/, { json: { login: 'alice' } }],
    [/\/repos\/alice\/app$/, { status: 200, empty: true }]
  ])
  const remotes = createRemotes({ credentials, fetchImpl })
  await remotes.addAccount({ provider: 'github', token: 't' })

  await assert.rejects(
    () => remotes.repoDetail({ accountId: 'github:alice', fullName: 'alice/app' }),
    (error) => error.code === 'remote-api-failed' && /平台没有返回仓库详情/.test(error.message)
  )
})

await test('mergeable 三态：GitHub 的 null（计算中）不阻止合并，false 才阻止', async () => {
  const credentials = fakeCredentials()
  let mergeable = null
  const fetchImpl = fakeFetch([
    [/api\.github\.com\/user$/, { json: { login: 'alice' } }],
    [/\/pulls\/9\/merge$/, { json: { merged: true, message: 'ok' } }],
    [/\/pulls\/9\/reviews$/, { json: [] }],
    [/\/pulls\/9$/, () => ({
      json: { number: 9, title: 'T', state: 'open', merged: false, mergeable, base: { ref: 'main' }, head: { ref: 'feat' } }
    })]
  ])
  const remotes = createRemotes({ credentials, fetchImpl })
  await remotes.addAccount({ provider: 'github', token: 't' })
  const base = { accountId: 'github:alice', fullName: 'alice/app', number: 9 }

  const unknown = await remotes.pullDetail(base)
  assert.equal(unknown.pull.mergeable, null, 'null 要原样保留，不能塌成 false')
  const merged = await remotes.mergePull(base)
  assert.equal(merged.merged, true, 'mergeable=null 时允许尝试合并')

  mergeable = false
  await assert.rejects(
    () => remotes.mergePull(base),
    (error) => error.code === 'not-mergeable'
  )
})

await test('Gitee 的 merged 可能只体现在 state 或 merged_at；统计缺字段时标记 statsComplete=false', async () => {
  const credentials = fakeCredentials()
  const fetchImpl = fakeFetch([
    [/gitee\.com\/api\/v5\/user\?/, { json: { login: 'bob' } }],
    [/\/pulls\/4\?[^/]*$/, {
      json: {
        number: 4, title: 'T', state: 'merged', merged_at: '2026-01-01T00:00:00Z',
        base: { ref: 'master' }, head: { ref: 'dev' }, html_url: 'https://gitee.com/bob/tool/pulls/4'
      }
    }]
  ])
  const remotes = createRemotes({ credentials, fetchImpl })
  await remotes.addAccount({ provider: 'gitee', token: 't' })

  const detail = await remotes.pullDetail({ accountId: 'gitee:bob', fullName: 'bob/tool', number: 4 })
  assert.equal(detail.pull.merged, true, 'state=merged / merged_at 都算已合并')
  assert.equal(detail.pull.statsComplete, false, '没有增删行字段时不能声称统计完整')
  assert.deepEqual(detail.capabilities.verdicts, ['approve'])
  assert.equal(detail.capabilities.reviews, false, 'Gitee 没有审查记录接口')
})

await test('Gitee：审查只有「通过」，合并用 prune_source_branch 删分支', async () => {
  const credentials = fakeCredentials()
  const calls = []
  const fetchImpl = fakeFetch([
    [/gitee\.com\/api\/v5\/user\?/, { json: { login: 'bob' } }],
    [/\/pulls\/3\/review\?/, (url, options) => {
      calls.push({ url, method: options.method, body: options.body ?? null })
      return { json: {} }
    }],
    [/\/pulls\/3\/comments\?/, (url, options) => {
      calls.push({ url, method: options.method, body: JSON.parse(options.body) })
      return { json: {} }
    }],
    [/\/pulls\/3\/merge\?/, (url, options) => {
      calls.push({ url, method: options.method, body: JSON.parse(options.body) })
      return { json: { merged: true } }
    }],
    [/\/pulls\/3\?/, {
      json: { number: 3, title: 'T', state: 'open', merged: false, mergeable: true, base: { ref: 'master' }, head: { ref: 'dev' }, html_url: 'https://gitee.com/bob/tool/pulls/3' }
    }]
  ])
  const remotes = createRemotes({ credentials, fetchImpl })
  await remotes.addAccount({ provider: 'gitee', token: 'gt' })
  const base = { accountId: 'gitee:bob', fullName: 'bob/tool', number: 3 }

  await assert.rejects(
    () => remotes.reviewPull({ ...base, verdict: 'request-changes', body: 'x' }),
    (error) => error.code === 'bad-request'
  )

  await remotes.reviewPull({ ...base, verdict: 'approve', body: '看起来不错' })
  const comment = calls.find((call) => call.url.includes('/comments'))
  const review = calls.find((call) => call.url.includes('/review'))
  assert.equal(comment.body.body, '看起来不错', 'Gitee 的说明走评论接口')
  assert.equal(review.body, null, 'Gitee 的审查接口不需要 body')

  await remotes.mergePull({ ...base, method: 'merge', deleteBranch: true })
  const merge = calls.find((call) => call.url.includes('/merge'))
  assert.deepEqual(merge.body, { merge_method: 'merge', prune_source_branch: true })
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
