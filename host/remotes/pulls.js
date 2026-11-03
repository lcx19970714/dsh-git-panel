/**
 * host/remotes/pulls.js —— PR 详情 / 审查 / 合并
 *
 * 能力差异来自 provider.pull（见 providers.js）：
 *  - GitHub：三种审查结论 + 三种合并方式；删源分支要单独调 git refs
 *  - Gitee：审查只有「通过」（说明文字走评论接口）；合并方法两种；删分支走 prune_source_branch
 */
import { GitError } from '../git.js'
import { lastPageOf, readArray, readJson, readObject, request, requestJson } from './http.js'
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

    const detail = await readObject(await send(base), 'PR 详情')

    // 提交列表：读失败不拖垮详情，但明确标记
    let commits = []
    let commitsUnavailable = null
    try {
      const repoBase = provider.apiBase + provider.repoPath(fullName)
      const listed = await readJson(await send(repoBase + provider.commitsPath(number)))
      if (Array.isArray(listed)) commits = listed.map(provider.pull.normalizeCommit)
      else commitsUnavailable = '平台返回的提交列表不是数组'
    } catch (error) {
      commitsUnavailable = error instanceof GitError ? error.message : String(error)
    }

    // 评论列表：GET 与 POST 同一个路径（GitHub issues/{n}/comments、Gitee pulls/{n}/comments）
    let comments = []
    let commentsUnavailable = null
    try {
      const repoBase = provider.apiBase + provider.repoPath(fullName)
      const listed = await readJson(await send(repoBase + provider.commentPath(number) + '?per_page=50&page=1'))
      if (Array.isArray(listed)) comments = listed.map(provider.pull.normalizeComment)
      else commentsUnavailable = '平台返回的评论列表不是数组'
    } catch (error) {
      // 评论读不到不拖垮 PR 详情，但必须明确告诉界面
      commentsUnavailable = error instanceof GitError ? error.message : String(error)
    }

    let reviews = []
    if (provider.pull.reviewsPath !== null) {
      const listed = await readArray(await send(base + '/reviews'), provider.label + ' 审查记录')
      reviews = listed.map(provider.pull.normalizeReview)
    }
    const reviewGate = provider.pull.reviewsPath === null
      ? { state: 'unknown', approvals: 0, changesRequested: 0 }
      : summarizeReviewGate(reviews)

    return {
      pull: provider.pull.normalizePull(detail),
      reviews,
      comments,
      commentsUnavailable,
      commits,
      commitsUnavailable,
      gate: {
        review: reviewGate,
        // 两家都没有「查询测试状态」的接口，只能执行或从合并被拒反推
        test: { state: 'unknown' },
        mergeState: typeof detail.mergeable_state === 'string' ? detail.mergeable_state : null
      },
      capabilities: {
        verdicts: provider.pull.verdicts,
        reviews: provider.pull.reviewsPath !== null,
        mergeMethods: provider.pull.mergeMethods,
        deleteBranch: true,
        test: provider.pull.testPath !== null
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
    const send = (path, init = {}) => (init.json === undefined
      ? request(fetchImpl, provider.authorize(base + path, account.token), { headers, ...init }, options.signal)
      : requestJson(fetchImpl, provider.authorize(base + path, account.token), { headers, ...init }, options.signal))

    if (provider.pull.reviewEvents === null) {
      // Gitee：说明文字走 PR 评论接口，再调 /review 表示通过（该接口不带 body）
      if (body !== '') await readJson(await send('/comments', { method: 'POST', json: { body } }))
      // Gitee 的审查接口成功时返回空响应，不需要读 JSON
      await readJson(await send('/review', { method: 'POST' }))
      return { verdict, bodyPosted: body !== '' }
    }

    const event = provider.pull.reviewEvents[verdict]
    await readJson(await send('/reviews', {
      method: 'POST',
      json: body === '' ? { event } : { event, body }
    }))
    return { verdict, bodyPosted: body !== '' }
  }

  /** 审查状态：按人取最新结论，再判断「有人要求修改」优先于「有人通过」。 */
  function summarizeReviewGate(reviews) {
    const latest = new Map()
    for (const review of reviews) {
      if (review.state === 'COMMENTED' || review.state === 'PENDING') continue
      latest.set(review.author, review.state)
    }
    let approvals = 0
    let changesRequested = 0
    for (const state of latest.values()) {
      if (state === 'APPROVED') approvals += 1
      else if (state === 'CHANGES_REQUESTED') changesRequested += 1
    }
    const state = changesRequested > 0 ? 'changes-requested' : (approvals > 0 ? 'approved' : 'pending')
    return { state, approvals, changesRequested }
  }

  /**
   * 一键「审查与测试都通过」。
   *
   * 按平台能力依次执行：有的平台没有测试动作（GitHub 门禁是 CI）就只做审查。
   * 任何一步失败都不静默：成功的步骤照实返回，失败的进 failures，界面据此显示。
   */
  async function passPull(input, options = {}) {
    const { provider, account } = await findAccount(input.accountId)
    const fullName = requireFullName(input.fullName)
    const number = requirePullNumber(input.number)
    const steps = []

    if (provider.pull.verdicts.includes('approve')) {
      steps.push(['review', () => reviewPull({ ...input, verdict: 'approve', body: typeof input.body === 'string' ? input.body : '' }, options)])
    }
    if (provider.pull.testPath !== null) {
      steps.push(['test', () => testPull({ ...input, accountId: account.id, fullName, number }, options)])
    }
    if (steps.length === 0) throw new GitError('bad-request', provider.label + ' 没有可执行的通过动作')

    const completed = []
    const failures = []
    for (const [name, run] of steps) {
      try {
        await run()
        completed.push(name)
      } catch (error) {
        failures.push({ step: name, message: error instanceof GitError ? error.message : String(error) })
      }
    }
    if (completed.length === 0) {
      throw new GitError(failures[0].step === 'test' ? 'test-failed' : 'review-failed',
        '一键通过失败：' + failures.map((item) => item.step + '：' + item.message).join('；'))
    }
    return { completed, failures }
  }

  /**
   * 深度审阅需要的东西：PR 详情 + 拉取用的 git 地址/refspec/凭据。
   *
   * 凭据只给这次 fetch 用（http.extraHeader），不写进任何配置。
   */
  async function reviewSource(input, options = {}) {
    const detail = await pullDetail(input, options)
    const { provider, account } = await findAccount(input.accountId)
    const fullName = requireFullName(input.fullName)
    const number = requirePullNumber(input.number)
    // fork PR 的 head 在另一个仓库：URL 要指向真正有那个分支的仓库
    const repoUsed = provider.reviewRepo(fullName, detail.pull)
    const isFork = repoUsed !== fullName
    return {
      pull: detail.pull,
      fullName,
      repoUsed,
      url: provider.gitUrl(repoUsed),
      remoteRef: provider.reviewRef(number, detail.pull),
      user: provider.gitUser === null ? account.login : provider.gitUser,
      token: account.token,
      authHint: isFork
        ? '深度审阅需要拉取 fork 仓库 ' + repoUsed + ' 的代码，请确认当前账号对它有读权限'
        : null
    }
  }

  /**
   * 确认当前账号能通过 API 读到某个仓库。
   *
   * 只有「必须用插件令牌去拉 fork 仓库」的路径才调用：读不到就直接报 fork-no-access，
   * 而不是等 git 抛一句 Unauthorized。
   */
  async function assertRepoAccess(input, options = {}) {
    const { provider, account } = await findAccount(input.accountId)
    const fullName = requireFullName(input.fullName)
    const probe = provider.apiBase + provider.repoPath(fullName)
    try {
      return await readObject(
        await request(fetchImpl, provider.authorize(probe, account.token), { headers: provider.headers(account.token) }, options.signal),
        '仓库'
      )
    } catch (error) {
      throw new GitError('fork-no-access',
        '这个 PR 的代码在 ' + fullName + '，但账号 ' + account.login + ' 读不到它，'
        + '因此无法拉取代码做深度审阅。可以用对 ' + fullName + ' 有权限的账号，'
        + '或让作者把分支推到当前仓库再试。原始错误：'
        + (error instanceof GitError ? error.message : String(error)))
    }
  }

  /**
   * PR 的文件列表 + 每个文件的 patch（AI 审阅的输入）。
   *
   * 两家都是 `pulls/{n}/files`，每页 50 条（**必须 ≤70**：GitHub 在 per_page>70 时
   * 会让第 70 个之后的文件不再返回 patch，见 openjdk SKARA-1406），最多 6 页（300 个文件）。
   * 达到上限时 truncated=true —— 调用方必须把这个事实带进提示词与界面，
   * 不能假装「这就是全部改动」。
   *
   * 单个文件可能没有 patch（二进制文件，或该文件 diff 过大）；这里用 patchAvailable
   * 明确标出，界面与提示词都要据此说明「这个文件没被读到」，而不是当成空改动。
   */
  async function pullDiff(input, options = {}) {
    const { provider, account } = await findAccount(input.accountId)
    const fullName = requireFullName(input.fullName)
    const number = requirePullNumber(input.number)
    const headers = provider.headers(account.token)
    // filesPath 自带 /pulls/{n}/files，所以这里只拼到 repoPath，不能再带 pullPath
    const repoBase = provider.apiBase + provider.repoPath(fullName)
    const PAGE_SIZE = 50
    const MAX_PAGES = 6

    const files = []
    let truncated = false
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const url = provider.authorize(repoBase + provider.filesPath(number) + '?per_page=' + PAGE_SIZE + '&page=' + page, account.token)
      const response = await request(fetchImpl, url, { headers }, options.signal)
      const listed = await readArray(response, 'PR 文件列表')
      for (const item of listed) {
        files.push({
          filename: typeof item.filename === 'string' ? item.filename : '',
          status: typeof item.status === 'string' ? item.status : '',
          additions: Number.isFinite(item.additions) ? item.additions : 0,
          deletions: Number.isFinite(item.deletions) ? item.deletions : 0,
          changes: Number.isFinite(item.changes) ? item.changes : 0,
          patch: typeof item.patch === 'string' ? item.patch : '',
          // 平台没给 patch：二进制文件，或该文件 diff 过大
          patchAvailable: typeof item.patch === 'string' && item.patch !== ''
        })
      }
      if (listed.length < PAGE_SIZE) break
      if (page === MAX_PAGES) truncated = true
    }
    return { files, truncated, pagesRead: Math.min(MAX_PAGES, Math.ceil(files.length / 50) || 1) }
  }

  /**
   * 关闭 / 重新打开 PR。
   *
   * 两个平台都是 PATCH /pulls/{n}，body 里带 state；只允许 open / closed 两个值。
   */
  async function setPullState(input, options = {}) {
    const { provider, account } = await findAccount(input.accountId)
    const fullName = requireFullName(input.fullName)
    const number = requirePullNumber(input.number)
    const state = input.state
    if (state !== 'open' && state !== 'closed') {
      throw new GitError('bad-request', 'state 只能是 open 或 closed：' + String(state))
    }
    const headers = provider.headers(account.token)
    const url = provider.apiBase + provider.repoPath(fullName) + provider.pullPath(number)
    const updated = await readJson(await requestJson(fetchImpl, provider.authorize(url, account.token), {
      method: 'PATCH',
      headers,
      json: { state }
    }, options.signal))
    return {
      number,
      state: updated !== null && typeof updated === 'object' && typeof updated.state === 'string'
        ? updated.state
        : state
    }
  }

  /**
   * 当前分支对应哪个 PR（找不到返回 null）。
   *
   * GitHub 一次精确查询；Gitee 拉作者最近一页 PR 后按 head 本地匹配。
   */
  async function findPullForBranch(input, options = {}) {
    const { provider, account } = await findAccount(input.accountId)
    const fullName = requireFullName(input.fullName)
    const branch = typeof input.branch === 'string' ? input.branch : ''
    if (branch === '') throw new GitError('bad-request', '缺少分支名')
    const url = provider.apiBase + provider.repoPath(fullName) + provider.pullLookup.path
      + provider.pullLookup.params({ login: account.login, branch })
    const listed = await readArray(await request(fetchImpl, provider.authorize(url, account.token), {
      headers: provider.headers(account.token)
    }, options.signal), 'PR 列表')
    for (const item of listed) {
      if (provider.pullLookup.match(item, branch)) return provider.pull.normalizePull(item)
    }
    return null
  }

  /**
   * 创建 PR：POST /repos/{o}/{r}/pulls，body { title, head, base, body }。
   * GitHub 与 Gitee 的路径与字段一致；head 是源分支名（同仓库）。
   */
  async function createPull(input, options = {}) {
    const { provider, account } = await findAccount(input.accountId)
    const fullName = requireFullName(input.fullName)
    const head = input.head
    const base = input.base
    const title = typeof input.title === 'string' ? input.title.trim() : ''
    const body = typeof input.body === 'string' ? input.body : ''
    if (typeof head !== 'string' || head === '') throw new GitError('bad-request', '缺少源分支')
    if (typeof base !== 'string' || base === '') throw new GitError('bad-request', '缺少目标分支')
    if (head === base) throw new GitError('bad-request', '源分支与目标分支不能相同')
    if (title === '') throw new GitError('bad-request', 'PR 标题不能为空')

    const headers = provider.headers(account.token)
    const url = provider.apiBase + provider.repoPath(fullName) + '/pulls'
    const created = await readObject(
      await requestJson(fetchImpl, provider.authorize(url, account.token), {
        method: 'POST',
        headers,
        json: { title, head, base, body }
      }, options.signal),
      'PR 创建结果'
    )
    const number = Number.isFinite(created.number) ? created.number : null
    if (number === null) throw new GitError('remote-api-failed', '平台没有返回 PR 编号，无法确认创建成功')
    return {
      number,
      url: typeof created.html_url === 'string' ? created.html_url : '',
      state: typeof created.state === 'string' ? created.state : 'open'
    }
  }

  /** 发一条 PR 评论（内容由用户在界面上确认/编辑后提交）。 */
  async function commentPull(input, options = {}) {
    const { provider, account } = await findAccount(input.accountId)
    const fullName = requireFullName(input.fullName)
    const number = requirePullNumber(input.number)
    const comment = typeof input.comment === 'string' ? input.comment.trim() : ''
    if (comment === '') throw new GitError('bad-request', '评论内容不能为空')
    const headers = provider.headers(account.token)
    const url = provider.apiBase + provider.repoPath(fullName) + provider.commentPath(number)
    const response = await requestJson(fetchImpl, provider.authorize(url, account.token), {
      method: 'POST',
      headers,
      json: { body: comment }
    }, options.signal)
    const posted = await readJson(response)
    return {
      posted: true,
      url: posted !== null && typeof posted === 'object' && typeof posted.html_url === 'string' ? posted.html_url : null
    }
  }

  /**
   * 标记 PR「测试通过」——Gitee 的合并门禁之一。
   * GitHub 没有对应动作（门禁由 CI 的 required status checks 决定），这里明确报不支持。
   */
  async function testPull(input, options = {}) {
    const { provider, account } = await findAccount(input.accountId)
    if (provider.pull.testPath === null) {
      throw new GitError('bad-request', provider.label + ' 没有「标记测试通过」这个动作（合并门禁由 CI 决定）')
    }
    const fullName = requireFullName(input.fullName)
    const number = requirePullNumber(input.number)
    const headers = provider.headers(account.token)
    const url = provider.apiBase + provider.repoPath(fullName) + provider.pullPath(number) + provider.pull.testPath
    // 与 /review 同族：这个动作不带请求体
    await readJson(await request(fetchImpl, provider.authorize(url, account.token), { headers, method: 'POST' }, options.signal))
    return { tested: true }
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
    const send = (url, init = {}) => (init.json === undefined
      ? request(fetchImpl, provider.authorize(url, account.token), { headers, ...init }, options.signal)
      : requestJson(fetchImpl, provider.authorize(url, account.token), { headers, ...init }, options.signal))
    const deleteBranch = input.deleteBranch === true

    // 先读一次详情：已合并 / 非打开 / 明确不可合并都直接拒绝，不让平台甩一句难懂的话
    const detail = await readObject(await send(base), 'PR 详情')
    const pull = provider.pull.normalizePull(detail)
    if (pull.merged === true) throw new GitError('already-merged', '这个 PR 已经合并过了')
    if (pull.state !== 'open') throw new GitError('not-open', '只有打开状态的 PR 才能合并（当前 ' + pull.state + '）')
    // mergeable 为 null 表示「平台还在算」，这不是拒绝的理由：交给合并接口自己判断
    if (pull.mergeable === false) throw new GitError('not-mergeable', '这个 PR 现在不能合并（可能有冲突或缺少审查）')

    const payload = { merge_method: method }
    if (provider.pull.mergeDeletesBranch === 'flag') payload.prune_source_branch = deleteBranch
    let result
    try {
      result = await readJson(await send(base + '/merge', { method: 'PUT', json: payload }))
    } catch (error) {
      // Gitee 的合并门禁：405「此 Pull Request 未通过设置的测试」
      const text = error instanceof GitError ? error.message : ''
      if (/未通过设置的测试|not passed the configured test/i.test(text)) {
        throw new GitError('merge-gate', provider.label + ' 的合并门禁要求先通过测试：' + text
          + '（先在面板里点「标记测试通过」再合并）')
      }
      throw error
    }
    // 空响应也算成功（平台不返回结果体）；只有明确 merged===false 才是失败
    if (result !== null && typeof result === 'object' && result.merged === false) {
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
      message: result !== null && typeof result === 'object' && typeof result.message === 'string' ? result.message : ''
    }
  }

  return { pullDetail, pullDiff, reviewSource, assertRepoAccess, reviewPull, testPull, passPull, commentPull, setPullState, createPull, findPullForBranch, mergePull }
}
