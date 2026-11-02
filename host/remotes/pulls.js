/**
 * host/remotes/pulls.js —— PR 详情 / 审查 / 合并
 *
 * 能力差异来自 provider.pull（见 providers.js）：
 *  - GitHub：三种审查结论 + 三种合并方式；删源分支要单独调 git refs
 *  - Gitee：审查只有「通过」（说明文字走评论接口）；合并方法两种；删分支走 prune_source_branch
 */
import { GitError } from '../git.js'
import { readJson, request } from './http.js'
import { requireFullName, requirePullNumber } from './providers.js'

export function createPulls(deps) {
  const { store, fetchImpl } = deps

  async function findAccount(id) {
    const providerId = typeof id === 'string' ? id.split(':')[0] : ''
    const provider = (await import('./providers.js')).requireProvider(providerId)
    const account = (await store.readAccounts(provider.id)).find((item) => item.id === id)
    if (account === undefined) throw new GitError('bad-request', '没有这个账号：' + String(id))
    return { provider, account }
  }

  /** 一个 PR 的详情：基础信息 + 审查记录（平台支持时）+ 能力清单。 */
  async function pullDetail(input, options = {}) {
    const { provider, account } = await findAccount(input.accountId)
    const fullName = requireFullName(input.fullName)
    const number = requirePullNumber(input.number)
    const headers = provider.headers(account.token)
    const base = provider.apiBase + provider.repoPath(fullName) + provider.pullPath(number)
    const send = (url, init = {}) => request(fetchImpl, provider.authorize(url, account.token), { headers, ...init }, options.signal)

    const detail = await readJson(await send(base))

    let reviews = []
    if (provider.pull.reviewsPath !== null) {
      const listed = await readJson(await send(base + '/reviews'))
      if (!Array.isArray(listed)) {
        throw new GitError('remote-api-failed', provider.label + ' 的审查记录不是数组')
      }
      reviews = listed.map(provider.pull.normalizeReview)
    }

    return {
      pull: provider.pull.normalizePull(detail),
      reviews,
      capabilities: {
        verdicts: provider.pull.verdicts,
        reviews: provider.pull.reviewsPath !== null,
        mergeMethods: provider.pull.mergeMethods,
        deleteBranch: true
      }
    }
  }

  /** 提交审查：GitHub 三种结论，Gitee 只有「通过」。 */
  async function reviewPull(input, options = {}) {
    const { provider, account } = await findAccount(input.accountId)
    const fullName = requireFullName(input.fullName)
    const number = requirePullNumber(input.number)
    const verdict = typeof input.verdict === 'string' ? input.verdict : ''
    if (!provider.pull.verdicts.includes(verdict)) {
      throw new GitError('bad-request', provider.label + ' 不支持这种审查结论：' + verdict)
    }
    const body = typeof input.body === 'string' ? input.body.trim() : ''
    if (verdict !== 'approve' && body === '') {
      throw new GitError('bad-request', '这个结论必须写点说明')
    }
    const headers = provider.headers(account.token)
    const base = provider.apiBase + provider.repoPath(fullName) + provider.pullPath(number)
    const send = (path, init) => request(fetchImpl, provider.authorize(base + path, account.token), { headers, ...init }, options.signal)

    if (provider.pull.reviewEvents === null) {
      // Gitee：说明文字走 PR 评论接口，再调 /review 表示通过（该接口不带 body）
      if (body !== '') await readJson(await send('/comments', { method: 'POST', body: JSON.stringify({ body }) }))
      await readJson(await send('/review', { method: 'POST' }))
      return { verdict, bodyPosted: body !== '' }
    }

    const event = provider.pull.reviewEvents[verdict]
    await readJson(await send('/reviews', {
      method: 'POST',
      body: JSON.stringify(body === '' ? { event } : { event, body })
    }))
    return { verdict, bodyPosted: body !== '' }
  }

  /** 合并 PR；deleteBranch 的行为由平台决定（GitHub 合并后删 ref，Gitee 走合并参数）。 */
  async function mergePull(input, options = {}) {
    const { provider, account } = await findAccount(input.accountId)
    const fullName = requireFullName(input.fullName)
    const number = requirePullNumber(input.number)
    const method = typeof input.method === 'string' ? input.method : 'merge'
    if (!provider.pull.mergeMethods.includes(method)) {
      throw new GitError('bad-request', provider.label + ' 不支持这种合并方式：' + method)
    }
    const headers = provider.headers(account.token)
    const base = provider.apiBase + provider.repoPath(fullName) + provider.pullPath(number)
    const send = (url, init) => request(fetchImpl, provider.authorize(url, account.token), { headers, ...init }, options.signal)
    const deleteBranch = input.deleteBranch === true

    // 先读一次详情：已合并 / 非打开 / 明确不可合并都直接拒绝，不让平台甩一句难懂的话
    const detail = await readJson(await send(base))
    const pull = provider.pull.normalizePull(detail)
    if (pull.merged === true) throw new GitError('already-merged', '这个 PR 已经合并过了')
    if (pull.state !== 'open') throw new GitError('not-open', '只有打开状态的 PR 才能合并（当前 ' + pull.state + '）')
    // mergeable 为 null 表示「平台还在算」，这不是拒绝的理由：交给合并接口自己判断
    if (pull.mergeable === false) throw new GitError('not-mergeable', '这个 PR 现在不能合并（可能有冲突或缺少审查）')

    const payload = { merge_method: method }
    if (provider.pull.mergeDeletesBranch === 'flag') payload.prune_source_branch = deleteBranch
    const result = await readJson(await send(base + '/merge', { method: 'PUT', body: JSON.stringify(payload) }))
    if (result.merged === false) {
      throw new GitError('merge-failed', typeof result.message === 'string' ? result.message : '平台没有完成合并')
    }

    let branchDeleted = false
    if (deleteBranch && provider.pull.mergeDeletesBranch === 'api' && pull.headBranch !== '') {
      const refUrl = provider.apiBase + provider.repoPath(fullName) + '/git/refs/heads/' + encodeURIComponent(pull.headBranch)
      await readJson(await send(refUrl, { method: 'DELETE' }))
      branchDeleted = true
    } else if (provider.pull.mergeDeletesBranch === 'flag') {
      branchDeleted = deleteBranch
    }

    return {
      merged: true,
      method,
      branchDeleted,
      headBranch: pull.headBranch,
      message: typeof result.message === 'string' ? result.message : ''
    }
  }

  return { pullDetail, reviewPull, mergePull }
}
