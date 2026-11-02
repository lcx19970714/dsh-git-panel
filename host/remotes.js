/**
 * host/remotes.js —— 代码托管账号与远端仓库（GitHub / Gitee）
 *
 * 三件事：
 *  1. 账号：token 只存在 DSH 的凭据服务里（`credentialKey('dsh-git-panel', '<provider>')`
 *     的 grant 记录），本模块从不把 token 交给客户端，也不写进任何配置文件；
 *  2. 列仓库：直接调各家的 REST API；
 *  3. 克隆：`git clone` 到项目根下的子目录，鉴权用 `-c http.extraHeader` 一次性传入，
 *     不把 token 写进 remote URL（否则会永久留在 .git/config 里）。
 *
 * 两个平台只在这三个地方不同（取用户、列仓库、鉴权头），差异全部收在 PROVIDERS 里。
 */
import path from 'node:path'
import { existsSync, readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'

import { GitError, runGit } from './git.js'

/** 凭据记录的 scope：等于插件自己的包名。 */
const CREDENTIAL_SCOPE = 'dsh-git-panel'
/** 每页条数：两家上限都是 100。 */
const PAGE_SIZE = 100
const API_TIMEOUT_MS = 20000

/** GitHub 的 REST 与 git 鉴权口径。 */
const github = {
  id: 'github',
  label: 'GitHub',
  web: 'https://github.com',
  apiBase: 'https://api.github.com',
  gitUser: 'x-access-token',
  headers: (token) => ({
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }),
  userPath: () => '/user',
  reposPath: (page) => '/user/repos?per_page=' + PAGE_SIZE + '&page=' + page
    + '&sort=updated&affiliation=owner,collaborator,organization_member',
  normalizeRepo: (item) => ({
    fullName: String(item.full_name),
    name: String(item.name),
    private: item.private === true,
    description: typeof item.description === 'string' ? item.description : '',
    language: typeof item.language === 'string' ? item.language : '',
    updatedAt: typeof item.updated_at === 'string' ? item.updated_at : '',
    sizeKb: Number.isFinite(item.size) ? item.size : 0,
    defaultBranch: typeof item.default_branch === 'string' ? item.default_branch : '',
    htmlUrl: typeof item.html_url === 'string' ? item.html_url : '',
    cloneUrl: typeof item.clone_url === 'string' ? item.clone_url : ''
  })
}

/** Gitee 的 REST 与 git 鉴权口径（token 走 query 参数，git 用 用户名:token 的 Basic）。 */
const gitee = {
  id: 'gitee',
  label: 'Gitee',
  web: 'https://gitee.com',
  apiBase: 'https://gitee.com/api/v5',
  gitUser: null, // 用账号自己的 login
  headers: () => ({ Accept: 'application/json' }),
  userPath: (token) => '/user?access_token=' + encodeURIComponent(token),
  reposPath: (page, token) => '/user/repos?access_token=' + encodeURIComponent(token)
    + '&per_page=' + PAGE_SIZE + '&page=' + page + '&sort=updated',
  normalizeRepo: (item) => ({
    fullName: String(item.full_name),
    name: String(item.name ?? item.human_name ?? item.full_name),
    private: item.private === true,
    description: typeof item.description === 'string' ? item.description : '',
    language: typeof item.language === 'string' ? item.language : '',
    updatedAt: typeof item.updated_at === 'string' ? item.updated_at : '',
    sizeKb: Number.isFinite(item.size) ? item.size : 0,
    defaultBranch: typeof item.default_branch === 'string' ? item.default_branch : '',
    htmlUrl: typeof item.html_url === 'string' ? item.html_url : '',
    cloneUrl: typeof item.clone_url === 'string' ? item.clone_url : ''
  })
}

export const PROVIDERS = Object.freeze({ github, gitee })
export const PROVIDER_IDS = Object.freeze(['github', 'gitee'])

/** 凭据记录 key：`<scope>/<provider>`（凭据服务要求两段都是小写 slug）。 */
export function credentialKeyFor(providerId) {
  return CREDENTIAL_SCOPE + '/' + providerId
}

/** 账号对外 id：`github:login`。内部定位账号也用它。 */
function accountIdOf(providerId, login) {
  return providerId + ':' + login
}

function requireProvider(providerId) {
  const provider = PROVIDERS[providerId]
  if (provider === undefined) throw new GitError('bad-request', '不支持的托管平台：' + String(providerId))
  return provider
}

function messageOf(error) {
  if (error === null || error === undefined) return '未知错误'
  if (typeof error === 'string') return error
  return typeof error.message === 'string' ? error.message : String(error)
}

/** 带超时的 fetch，失败归一成 GitError（调用方只需要关心「失败了，原因是什么」）。 */
async function request(fetchImpl, url, options, signal) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  if (signal !== undefined) signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (controller.signal.aborted) throw new GitError('timeout', '访问 ' + url + ' 超时')
    throw new GitError('remote-api-failed', '访问 ' + url + ' 失败：' + messageOf(error))
  } finally {
    clearTimeout(timer)
    if (signal !== undefined) signal.removeEventListener('abort', onAbort)
  }
}

async function readJson(response) {
  const text = await response.text()
  if (!response.ok) {
    const reason = response.status === 401 || response.status === 403
      ? '令牌无效或已过期（HTTP ' + response.status + '）'
      : 'HTTP ' + response.status
    throw new GitError('remote-auth-failed', reason + '：' + text.slice(0, 300))
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new GitError('remote-api-failed', '接口返回的不是 JSON：' + text.slice(0, 200))
  }
}

/**
 * 账号与远端仓库的门面。
 *
 * @param {{credentials: {readRecord: Function, modifyRecord: Function}|null, fetchImpl?: Function}} deps
 *   `credentials` 为 null 表示这个 DSH 组合没有凭据服务，此时「账号」相关操作会明确报错，
 *   而不是偷偷把 token 存到别处。
 */
export function createRemotes(deps) {
  const credentials = deps === null || deps === undefined ? null : deps.credentials ?? null
  const fetchImpl = deps !== null && deps !== undefined && typeof deps.fetchImpl === 'function'
    ? deps.fetchImpl
    : globalThis.fetch

  function requireCredentials() {
    if (credentials === null) {
      throw new GitError('no-credentials', '这个 DSH 组合没有提供凭据服务，无法保存账号令牌')
    }
    return credentials
  }

  /** 读某平台账号列表（含 token，仅宿主内部使用）。 */
  async function readAccounts(providerId) {
    requireProvider(providerId)
    const record = await requireCredentials().readRecord(credentialKeyFor(providerId))
    if (record === undefined) return []
    if (record.kind !== 'grant') {
      throw new GitError('bad-config', '凭据记录 ' + credentialKeyFor(providerId) + ' 的类型不是 grant')
    }
    const payload = record.payload
    const accounts = payload !== null && typeof payload === 'object' ? payload.accounts : undefined
    if (!Array.isArray(accounts)) {
      throw new GitError('bad-config', '凭据记录 ' + credentialKeyFor(providerId) + ' 缺少 accounts 数组')
    }
    return accounts.map((account) => {
      if (typeof account?.id !== 'string' || typeof account?.login !== 'string' || typeof account?.token !== 'string') {
        throw new GitError('bad-config', '凭据记录 ' + credentialKeyFor(providerId) + ' 里的账号结构不完整')
      }
      return { id: account.id, provider: providerId, login: account.login, label: typeof account.label === 'string' ? account.label : '', token: account.token }
    })
  }

  async function writeAccounts(providerId, mutate) {
    requireCredentials()
    await requireCredentials().modifyRecord(credentialKeyFor(providerId), async (previous) => {
      const accounts = previous === undefined
        ? []
        : (Array.isArray(previous?.payload?.accounts) ? previous.payload.accounts : [])
      const next = await mutate(accounts)
      return next === undefined ? undefined : { kind: 'grant', payload: { accounts: next } }
    })
  }

  /** 对外只暴露「有这个账号」，绝不带 token。 */
  async function listAccounts() {
    const result = []
    for (const providerId of PROVIDER_IDS) {
      for (const account of await readAccounts(providerId)) {
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
      providers: PROVIDER_IDS.map((providerId) => ({ id: providerId, label: PROVIDERS[providerId].label }))
    }
  }

  /**
   * 添加账号：先拿 token 调一次 `/user` 验证并取到登录名，验证通过才写入凭据服务。
   * 同一账号重复添加直接报错，不做「覆盖」这种含糊行为。
   */
  async function addAccount(input, options = {}) {
    const provider = requireProvider(input.provider)
    const token = typeof input.token === 'string' ? input.token.trim() : ''
    if (token === '') throw new GitError('bad-request', '令牌不能为空')

    const response = await request(fetchImpl, provider.apiBase + provider.userPath(token), { headers: provider.headers(token) }, options.signal)
    const data = await readJson(response)
    const login = typeof data.login === 'string' ? data.login : ''
    if (login === '') throw new GitError('remote-api-failed', '接口没有返回登录名，无法确认这个令牌')

    const id = accountIdOf(provider.id, login)
    const existing = await readAccounts(provider.id)
    if (existing.some((account) => account.id === id)) {
      throw new GitError('account-exists', '这个账号已经添加过了：' + login)
    }
    const label = typeof input.label === 'string' && input.label.trim() !== '' ? input.label.trim() : login
    await writeAccounts(provider.id, (accounts) => [...accounts, { id, login, label, token }])
    return { account: { id, provider: provider.id, login, label, providerLabel: provider.label } }
  }

  async function removeAccount(input) {
    const id = typeof input.id === 'string' ? input.id : ''
    const providerId = id.split(':')[0]
    const provider = requireProvider(providerId)
    const existing = await readAccounts(provider.id)
    if (!existing.some((account) => account.id === id)) {
      throw new GitError('bad-request', '没有这个账号：' + id)
    }
    await writeAccounts(provider.id, (accounts) => accounts.filter((account) => account.id !== id))
    return { accounts: (await listAccounts()).accounts }
  }

  async function findAccount(id) {
    const providerId = typeof id === 'string' ? id.split(':')[0] : ''
    const provider = requireProvider(providerId)
    const account = (await readAccounts(provider.id)).find((item) => item.id === id)
    if (account === undefined) throw new GitError('bad-request', '没有这个账号：' + String(id))
    return { provider, account }
  }

  /** 列某个账号下的仓库（一页 100 条）。 */
  async function listRepos(input, options = {}) {
    const { provider, account } = await findAccount(input.accountId)
    const page = Number.isInteger(input.page) && input.page > 0 ? input.page : 1
    const url = provider.apiBase + provider.reposPath(page, account.token)
    const response = await request(fetchImpl, url, { headers: provider.headers(account.token) }, options.signal)
    const data = await readJson(response)
    if (!Array.isArray(data)) throw new GitError('remote-api-failed', '接口返回的仓库列表不是数组')
    const repos = data.map((item) => ({ ...provider.normalizeRepo(item), provider: provider.id, accountId: account.id }))
    return { repos, page, hasMore: repos.length >= PAGE_SIZE }
  }

  /** 克隆：目标必须在项目根内，且不能已存在（不覆盖、不合并，宁可报错）。 */
  async function cloneRepo(input, options = {}) {
    const { provider, account } = await findAccount(input.accountId)
    const projectRoot = typeof input.projectRoot === 'string' ? input.projectRoot : ''
    if (projectRoot === '' || !path.isAbsolute(projectRoot)) {
      throw new GitError('bad-request', 'projectRoot 必须是绝对路径')
    }
    if (!existsSync(projectRoot)) {
      throw new GitError('bad-request', '项目目录不存在：' + projectRoot)
    }
    const fullName = typeof input.fullName === 'string' ? input.fullName : ''
    if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) throw new GitError('bad-request', '仓库名不合法：' + fullName)

    const defaultName = fullName.split('/')[1]
    const targetName = typeof input.targetName === 'string' && input.targetName.trim() !== ''
      ? input.targetName.trim()
      : defaultName
    if (!/^[\w.-]+$/.test(targetName) || targetName === '.' || targetName === '..') {
      throw new GitError('bad-request', '目标文件夹名不合法：' + targetName)
    }
    const targetPath = path.join(projectRoot, targetName)
    if (readdirSync(projectRoot).includes(targetName) || existsSync(targetPath)) {
      throw new GitError('target-exists', '目标文件夹已存在：' + targetName)
    }

    // 克隆地址由调用方从仓库记录里带过来（平台自己给的才是准的，不自造）
    const cloneUrl = typeof input.cloneUrl === 'string' ? input.cloneUrl.trim() : ''
    if (cloneUrl === '') throw new GitError('bad-request', '缺少克隆地址')
    const isHttp = /^https?:\/\//i.test(cloneUrl)
    const isLocalPath = path.isAbsolute(cloneUrl) && existsSync(cloneUrl)
    if (!isHttp && !isLocalPath) {
      throw new GitError('bad-request', '克隆地址必须是 http(s) URL 或本地仓库路径：' + cloneUrl)
    }

    const args = []
    if (isHttp) {
      const basicUser = provider.gitUser === null ? account.login : provider.gitUser
      const auth = Buffer.from(basicUser + ':' + account.token, 'utf8').toString('base64')
      // 只在本条命令里带鉴权头：不进 .git/config，进程结束后不留痕
      args.push('-c', 'http.extraHeader=AUTHORIZATION: basic ' + auth)
    }
    args.push('clone', '--progress', cloneUrl, targetPath)
    await runGit(projectRoot, args, { signal: options.signal, timeoutMs: 15 * 60 * 1000 })

    return { path: targetPath, name: targetName, fullName }
  }

  return { listAccounts, addAccount, removeAccount, listRepos, cloneRepo }
}
