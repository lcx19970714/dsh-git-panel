/**
 * host/remotes/repos.js —— 列仓库 / 仓库详情 / 克隆
 */
import path from 'node:path'
import { existsSync, readdirSync } from 'node:fs'

import { GitError, runGit } from '../git.js'
import { messageOf, readArray, readObject, readJson as readJsonSafe, request, totalOf } from './http.js'
import { PAGE_SIZE, requireFullName, requireProvider } from './providers.js'

/** 分支列表最多翻 10 页（1000 个）：再多也超出界面能用的范围，标 truncated 让用户知道。 */
const BRANCH_PAGE_LIMIT = 10

/** 分支名校验：非空字符串、无控制字符（URL 里会整段编码，注入不是问题，这里只挡明显脏数据）。 */
function requireBranchName(value) {
  if (typeof value !== 'string' || value.trim() === '' || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new GitError('bad-request', '分支名不合法：' + String(value))
  }
  return value
}

export function createRepos(deps) {
  const { store, fetchImpl } = deps

  /** 定位账号：返回平台适配器与账号记录（含 token）。 */
  async function findAccount(id) {
    const providerId = typeof id === 'string' ? id.split(':')[0] : ''
    const provider = requireProvider(providerId)
    const account = (await store.readAccounts(provider.id)).find((item) => item.id === id)
    if (account === undefined) throw new GitError('bad-request', '没有这个账号：' + String(id))
    return { provider, account }
  }

  /** 列某个账号下的仓库（一页 100 条）。 */
  async function listRepos(input, options = {}) {
    const { provider, account } = await findAccount(input.accountId)
    const page = Number.isInteger(input.page) && input.page > 0 ? input.page : 1
    const url = provider.authorize(provider.apiBase + provider.reposPath(page), account.token)
    const data = await readArray(
      await request(fetchImpl, url, { headers: provider.headers(account.token) }, options.signal),
      '仓库'
    )
    const repos = data.map((item) => ({ ...provider.normalizeRepo(item), provider: provider.id, accountId: account.id }))
    return { repos, page, hasMore: repos.length >= 100 }
  }

  /**
   * 仓库详情 + 未关闭 issue/PR 数量 + 最近条目。
   *
   * 计数用 `per_page=1` 请求读 Link 的最后一页（就是总数），比按列表长度估靠谱；
   * 拿不到 Link 时返回 null，界面显示「数量未知」而不是编一个数字。
   * GitHub 的 /issues 含 PR，因此 issue 数 = issues 总数 - PR 总数。
   *
   * issues / PRs 任一块失败只标记该块（failures），仓库详情与另一块照常返回。
   */
  async function repoDetail(input, options = {}) {
    const { provider, account } = await findAccount(input.accountId)
    const fullName = requireFullName(input.fullName)
    const pageSize = Number.isInteger(input.pageSize) && input.pageSize > 0 ? Math.min(input.pageSize, 50) : 10
    const headers = provider.headers(account.token)
    const base = provider.apiBase + provider.repoPath(fullName)
    const send = (url) => request(fetchImpl, provider.authorize(url, account.token), { headers }, options.signal)
    const activeProvider = provider

    const detail = await readObject(await send(base), '仓库详情')

    const section = async (kind, listPath) => {
      const listResponse = await send(base + listPath(pageSize))
      const list = await readArray(listResponse, '条目')
      // 计数单独请求：GitHub 的 issues 用 search 的 total_count 才准确，
      // Gitee 用列表响应里的 Link / total_count。
      const countUrl = provider.apiBase + provider.countsPath(kind, fullName)
      const countResponse = await send(countUrl)
      const countBody = await readJsonSafe(countResponse)
      return {
        total: totalOf(countResponse.headers?.get?.('link'), countBody),
        items: list.slice(0, pageSize).map(activeProvider.normalizeIssue)
      }
    }

    const [issuesResult, pullsResult] = await Promise.allSettled([
      section('issues', provider.issueListPath),
      section('pulls', provider.pullListPath)
    ])
    const failures = []
    const pick = (settled, label) => {
      if (settled.status === 'fulfilled') return settled.value
      failures.push({ section: label, message: String(settled.reason?.message ?? settled.reason) })
      return { total: null, items: [] }
    }
    const issues = pick(issuesResult, 'issues')
    const pulls = pick(pullsResult, 'pulls')

    return {
      repo: provider.normalizeDetail(detail, fullName),
      issues: { total: issues.total, items: issues.items },
      pulls: { total: pulls.total, items: pulls.items },
      failures
    }
  }

  /**
   * 列远端仓库的分支。
   *
   * 先读一次仓库详情：默认分支与 html 地址以平台返回为准，不按平台规则自己拼。
   * 列表按 per_page=100 从第 1 页翻到「不满一页」为止，最多 10 页（1000 个）；
   * 翻到上限时 `truncated: true`，界面据此提示「只显示前 N 个」。
   * 没有 name 的脏条目直接丢弃 —— 不能变成一行空分支。
   */
  async function remoteBranches(input, options = {}) {
    const { provider, account } = await findAccount(input.accountId)
    const fullName = requireFullName(input.fullName)
    const headers = provider.headers(account.token)
    const repoBase = provider.apiBase + provider.repoPath(fullName)
    const send = (url) => request(fetchImpl, provider.authorize(url, account.token), { headers }, options.signal)

    const detail = provider.normalizeDetail(await readObject(await send(repoBase), '仓库详情'), fullName)

    const branches = []
    let truncated = false
    for (let page = 1; page <= BRANCH_PAGE_LIMIT; page += 1) {
      const list = await readArray(await send(repoBase + provider.branchesPath(page)), '分支')
      // 用原始条数判断是否到末页：过滤脏条目 ≠ 平台已经翻完
      branches.push(...list.map((item) => provider.normalizeBranch(item)).filter((branch) => branch.name !== ''))
      if (list.length < PAGE_SIZE) break
      if (page === BRANCH_PAGE_LIMIT) truncated = true
    }

    return {
      fullName,
      provider: provider.id,
      htmlUrl: detail.htmlUrl,
      defaultBranch: detail.defaultBranch,
      branches,
      truncated
    }
  }

  /**
   * 删远端分支。
   *
   * 先读仓库详情：默认分支在本地就拦下（平台也会拒，但给不出可操作的提示）。
   * 删除路径与鉴权方式都交给 provider（GitHub 删 ref、Gitee 删 branch，token 位置不同）；
   * 空响应算成功（204 是正常结果）。平台以 403/422 + protected 表示受保护分支时，
   * 翻译成 protected-branch，其余错误原样上抛（http.js 已归一）。
   */
  async function deleteBranch(input, options = {}) {
    const { provider, account } = await findAccount(input.accountId)
    const fullName = requireFullName(input.fullName)
    const name = requireBranchName(input.name)
    const headers = provider.headers(account.token)
    const repoBase = provider.apiBase + provider.repoPath(fullName)
    const send = (url, init = {}) => request(
      fetchImpl,
      provider.authorize(url, account.token),
      { headers, ...init },
      options.signal
    )

    const detail = provider.normalizeDetail(await readObject(await send(repoBase), '仓库详情'), fullName)
    if (name === detail.defaultBranch) {
      throw new GitError('default-branch', '默认分支不能删除：' + name)
    }

    try {
      await readJsonSafe(await send(repoBase + provider.branchDeletePath(name), { method: 'DELETE' }))
    } catch (error) {
      const message = messageOf(error)
      if (/HTTP (?:403|422)\b/.test(message) && /protected|受保护/i.test(message)) {
        throw new GitError('protected-branch',
          '分支 ' + name + ' 受保护，不能删除（先在 ' + provider.label + ' 的仓库设置里取消分支保护）')
      }
      throw error
    }
    return { name, deleted: true }
  }

  /**
   * 批量取未合并 PR 数量。
   *
   * @param {{accountId: string, fullNames: string[]}} input
   * @returns {Promise<{counts: Record<string, number|null>, failures: {fullName: string, message: string}[]}>}
   */
  async function pullCounts(input, options = {}) {
    const { provider, account } = await findAccount(input.accountId)
    const names = Array.isArray(input.fullNames) ? input.fullNames : []
    const limited = names.filter((name) => typeof name === 'string').slice(0, 50)
    const headers = provider.headers(account.token)
    const counts = {}
    const failures = []

    const one = async (fullName) => {
      if (!/^[\w.-]+\/[\w.-]+$/.test(fullName)) {
        counts[fullName] = null
        failures.push({ fullName, message: '仓库名不合法' })
        return
      }
      const url = provider.authorize(
        provider.apiBase + provider.repoPath(fullName) + provider.pullListPath(1),
        account.token
      )
      try {
        const response = await request(fetchImpl, url, { headers }, options.signal)
        const list = await readArray(response, '未合并 PR')
        const total = totalOf(response.headers?.get?.('link'), null)
        counts[fullName] = total === null ? list.length : total
      } catch (error) {
        counts[fullName] = null
        failures.push({ fullName, message: error instanceof GitError ? error.message : String(error) })
      }
    }

    const CONCURRENCY = 6
    for (let index = 0; index < limited.length; index += CONCURRENCY) {
      await Promise.all(limited.slice(index, index + CONCURRENCY).map(one))
    }
    return { counts, failures }
  }

  /** 克隆：目标必须在项目根内，且不能已存在（不覆盖、不合并，宁可报错）。 */
  async function cloneRepo(input, options = {}) {
    const { provider, account } = await findAccount(input.accountId)
    const projectRoot = typeof input.projectRoot === 'string' ? input.projectRoot : ''
    if (projectRoot === '' || !path.isAbsolute(projectRoot)) {
      throw new GitError('bad-request', 'projectRoot 必须是绝对路径')
    }
    if (!existsSync(projectRoot)) throw new GitError('bad-request', '项目目录不存在：' + projectRoot)

    const fullName = requireFullName(input.fullName)
    const targetName = typeof input.targetName === 'string' && input.targetName.trim() !== ''
      ? input.targetName.trim()
      : fullName.split('/')[1]
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
      // 只在本条命令里带鉴权头：不进 .git/config，进程结束后不留痕。
      // credential.helper 留空：禁用本机凭据管理器，避免它用缓存的旧凭据覆盖我们的请求头。
      args.push('-c', 'credential.helper=')
      args.push('-c', 'http.extraHeader=Authorization: Basic ' + auth)
    }
    args.push('clone', '--progress', cloneUrl, targetPath)
    await runGit(projectRoot, args, { signal: options.signal, timeoutMs: 15 * 60 * 1000 })

    return { path: targetPath, name: targetName, fullName }
  }

  return { findAccount, listRepos, repoDetail, remoteBranches, deleteBranch, pullCounts, cloneRepo }
}
