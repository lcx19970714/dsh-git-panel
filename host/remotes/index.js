/**
 * host/remotes/index.js —— 远端能力门面（GitHub / Gitee）
 *
 * 组合四块职责，对外只有一个 createRemotes()：
 *  - http      带超时的请求、错误归一、分页 Link
 *  - providers 平台差异表（鉴权、路径、字段归一、PR 能力），加载时校验契约
 *  - accounts  凭据服务里的账号记录（token 不出宿主）
 *  - repos     列仓库 / 仓库详情 / 克隆
 *  - pulls     PR 详情 / 审查 / 合并
 *
 * 账号的增删改需要「先用令牌调一次 /user 验证」，所以放在这一层（它同时能拿到
 * provider 与 fetch）。
 */
import { GitError } from '../git.js'
import { createAccountStore, accountIdOf } from './accounts.js'
import { readObject, request } from './http.js'
import { PROVIDERS, PROVIDER_IDS, requireProvider } from './providers.js'
import { createRepos } from './repos.js'
import { createPulls } from './pulls.js'

export { PROVIDERS, PROVIDER_IDS } from './providers.js'
export { credentialKeyFor } from './accounts.js'
export { lastPageOf } from './http.js'

/**
 * @param {{credentials: object|null, fetchImpl?: Function}} deps
 */
export function createRemotes(deps) {
  const credentials = deps === null || deps === undefined ? null : deps.credentials ?? null
  const fetchImpl = deps !== null && deps !== undefined && typeof deps.fetchImpl === 'function'
    ? deps.fetchImpl
    : globalThis.fetch

  const store = createAccountStore({ credentials })
  const repos = createRepos({ store, fetchImpl })
  const pulls = createPulls({ store, fetchImpl })

  /** 对外只暴露「有这个账号」，绝不带 token。 */
  async function listAccounts() {
    const result = []
    for (const providerId of PROVIDER_IDS) {
      for (const account of await store.readAccounts(providerId)) {
        result.push({
          id: account.id,
          provider: providerId,
          login: account.login,
          label: account.label !== '' ? account.label : account.login,
          providerLabel: PROVIDERS[providerId].label
        })
      }
    }
    return {
      accounts: result,
      providers: PROVIDER_IDS.map((providerId) => ({
        id: providerId,
        label: PROVIDERS[providerId].label,
        tokenUrl: PROVIDERS[providerId].tokenUrl
      }))
    }
  }

  /** 用令牌调一次 /user：既验证它有效，也拿到登录名。 */
  async function whoami(provider, token, signal) {
    const url = provider.authorize(provider.apiBase + provider.userPath(), token)
    const data = await readObject(
      await request(fetchImpl, url, { headers: provider.headers(token) }, signal),
      '账号信息'
    )
    const login = typeof data.login === 'string' ? data.login : ''
    if (login === '') throw new GitError('remote-api-failed', '接口没有返回登录名，无法确认这个令牌')
    return login
  }

  /** 添加账号：验证通过才写入；同一账号重复添加直接报错，不做「覆盖」这种含糊行为。 */
  async function addAccount(input, options = {}) {
    const provider = requireProvider(input.provider)
    const token = typeof input.token === 'string' ? input.token.trim() : ''
    if (token === '') throw new GitError('bad-request', '令牌不能为空')

    const login = await whoami(provider, token, options.signal)
    const id = accountIdOf(provider.id, login)
    const existing = await store.readAccounts(provider.id)
    if (existing.some((account) => account.id === id)) {
      throw new GitError('account-exists', '这个账号已经添加过了：' + login)
    }
    const label = typeof input.label === 'string' && input.label.trim() !== '' ? input.label.trim() : login
    await store.writeAccounts(provider.id, (accounts) => [...accounts, { id, login, label, token }])
    return { account: { id, provider: provider.id, login, label, providerLabel: provider.label } }
  }

  /**
   * 改账号：备注名随时可改；令牌可以换，但换之前必须验证且必须属于同一账号，
   * 不把没验证过 / 别人的令牌写进凭据服务。
   */
  async function updateAccount(input, options = {}) {
    const { provider, account } = await repos.findAccount(input.id)
    const patch = {}
    if (typeof input.label === 'string') patch.label = input.label.trim()

    const nextToken = typeof input.token === 'string' ? input.token.trim() : ''
    if (nextToken !== '') {
      const login = await whoami(provider, nextToken, options.signal)
      if (login !== account.login) {
        throw new GitError('token-mismatch', `这个令牌属于 ${login}，与当前账号 ${account.login} 不符`)
      }
      patch.token = nextToken
    }
    if (Object.keys(patch).length === 0) throw new GitError('bad-request', '没有要修改的内容')

    await store.writeAccounts(provider.id, (accounts) => accounts.map((item) => (
      item.id === account.id ? { ...item, ...patch } : item
    )))
    const stored = (await store.readAccounts(provider.id)).find((item) => item.id === account.id)
    return {
      account: {
        id: stored.id,
        provider: provider.id,
        login: stored.login,
        label: stored.label !== '' ? stored.label : stored.login,
        providerLabel: provider.label
      }
    }
  }

  /** 取某个账号的令牌原文（只在用户主动点「显示」时调用，列表接口永远不含它）。 */
  async function readToken(input) {
    const { account } = await repos.findAccount(input.id)
    return { id: account.id, token: account.token }
  }

  async function removeAccount(input) {
    const id = typeof input.id === 'string' ? input.id : ''
    const providerId = id.split(':')[0]
    const provider = requireProvider(providerId)
    const existing = await store.readAccounts(provider.id)
    if (!existing.some((account) => account.id === id)) {
      throw new GitError('bad-request', '没有这个账号：' + id)
    }
    await store.writeAccounts(provider.id, (accounts) => accounts.filter((account) => account.id !== id))
    return { accounts: (await listAccounts()).accounts }
  }

  return {
    listAccounts,
    addAccount,
    updateAccount,
    readToken,
    removeAccount,
    listRepos: repos.listRepos,
    repoDetail: repos.repoDetail,
    pullCounts: repos.pullCounts,
    cloneRepo: repos.cloneRepo,
    pullDetail: pulls.pullDetail,
    pullDiff: pulls.pullDiff,
    reviewSource: pulls.reviewSource,
    assertRepoAccess: pulls.assertRepoAccess,
    reviewPull: pulls.reviewPull,
    testPull: pulls.testPull,
    passPull: pulls.passPull,
    commentPull: pulls.commentPull,
    mergePull: pulls.mergePull
  }
}
