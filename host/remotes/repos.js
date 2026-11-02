/**
 * host/remotes/repos.js —— 列仓库 / 仓库详情 / 克隆
 */
import path from 'node:path'
import { existsSync, readdirSync } from 'node:fs'

import { GitError, runGit } from '../git.js'
import { lastPageOf, readArray, readJson as readJsonSafe, readObject, request } from './http.js'
import { requireFullName, requireProvider } from './providers.js'

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

    const section = async (listPath, isIssues) => {
      const listResponse = await send(base + listPath(pageSize))
      const list = await readArray(listResponse, '条目')
      const countResponse = await send(base + listPath(1))
      // 计数请求只要读到分页头，响应体本身是什么都无所谓
      await readJsonSafe(countResponse)
      const items = list.filter((item) => (
        isIssues && activeProvider.issuesIncludePulls ? item.pull_request === undefined : true
      ))
      return {
        total: lastPageOf(countResponse.headers?.get?.('link')),
        items: items.slice(0, pageSize).map(activeProvider.normalizeIssue)
      }
    }

    const [issuesResult, pullsResult] = await Promise.allSettled([
      section(provider.issueListPath, true),
      section(provider.pullListPath, false)
    ])
    const failures = []
    const pick = (settled, label) => {
      if (settled.status === 'fulfilled') return settled.value
      failures.push({ section: label, message: String(settled.reason?.message ?? settled.reason) })
      return { total: null, items: [] }
    }
    const issues = pick(issuesResult, 'issues')
    const pulls = pick(pullsResult, 'pulls')

    const issuesTotal = provider.issuesIncludePulls === true
      ? (issues.total === null || pulls.total === null ? null : Math.max(0, issues.total - pulls.total))
      : issues.total

    return {
      repo: provider.normalizeDetail(detail, fullName),
      issues: { total: issuesTotal, items: issues.items },
      pulls: { total: pulls.total, items: pulls.items },
      failures
    }
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
      // 只在本条命令里带鉴权头：不进 .git/config，进程结束后不留痕
      args.push('-c', 'http.extraHeader=AUTHORIZATION: basic ' + auth)
    }
    args.push('clone', '--progress', cloneUrl, targetPath)
    await runGit(projectRoot, args, { signal: options.signal, timeoutMs: 15 * 60 * 1000 })

    return { path: targetPath, name: targetName, fullName }
  }

  return { findAccount, listRepos, repoDetail, cloneRepo }
}
