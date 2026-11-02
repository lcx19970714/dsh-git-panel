/**
 * host/remotes/accounts.js —— 账号记录（token 存在 DSH 凭据服务里）
 *
 * 只碰凭据服务，不发网络请求；校验 token 的逻辑在 index.js（那里能拿到 fetch）。
 */
import { GitError } from '../git.js'

/** 凭据记录的 scope：等于插件自己的包名。 */
const CREDENTIAL_SCOPE = 'dsh-git-panel'

/** 凭据记录 key：`<scope>/<provider>`（凭据服务要求两段都是小写 slug）。 */
export function credentialKeyFor(providerId) {
  return CREDENTIAL_SCOPE + '/' + providerId
}

/** 账号对外 id：`github:login`。内部定位账号也用它。 */
export function accountIdOf(providerId, login) {
  return providerId + ':' + login
}

/**
 * @param {{credentials: {readRecord: Function, modifyRecord: Function} | null}} deps
 *   credentials 为 null 表示这个 DSH 组合没有凭据服务，账号操作会明确报错。
 */
export function createAccountStore(deps) {
  const credentials = deps === null || deps === undefined ? null : deps.credentials ?? null

  function requireCredentials() {
    if (credentials === null) {
      throw new GitError('no-credentials', '这个 DSH 组合没有提供凭据服务，无法保存账号令牌')
    }
    return credentials
  }

  /** 读某平台账号列表（含 token，仅宿主内部使用）。 */
  async function readAccounts(providerId) {
    const record = await requireCredentials().readRecord(credentialKeyFor(providerId))
    if (record === undefined) return []
    if (record.kind !== 'grant') {
      throw new GitError('bad-config', '凭据记录 ' + credentialKeyFor(providerId) + ' 的类型不是 grant')
    }
    const accounts = record.payload !== null && typeof record.payload === 'object' ? record.payload.accounts : undefined
    if (!Array.isArray(accounts)) {
      throw new GitError('bad-config', '凭据记录 ' + credentialKeyFor(providerId) + ' 缺少 accounts 数组')
    }
    return accounts.map((account) => {
      if (typeof account?.id !== 'string' || typeof account?.login !== 'string' || typeof account?.token !== 'string') {
        throw new GitError('bad-config', '凭据记录 ' + credentialKeyFor(providerId) + ' 里的账号结构不完整')
      }
      return {
        id: account.id,
        provider: providerId,
        login: account.login,
        label: typeof account.label === 'string' ? account.label : '',
        token: account.token
      }
    })
  }

  async function writeAccounts(providerId, mutate) {
    await requireCredentials().modifyRecord(credentialKeyFor(providerId), async (previous) => {
      const accounts = previous === undefined
        ? []
        : (Array.isArray(previous?.payload?.accounts) ? previous.payload.accounts : [])
      const next = await mutate(accounts)
      return next === undefined ? undefined : { kind: 'grant', payload: { accounts: next } }
    })
  }

  return { readAccounts, writeAccounts }
}
