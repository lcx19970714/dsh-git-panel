/**
 * host/remotes/providers.js —— 平台的「差异表」
 *
 * 每个平台只描述自己：怎么鉴权、用户/仓库/issue/PR 的路径与字段怎么归一。
 * 上层（accounts / repos / pulls）只按这份契约调用，不写 `if (platform === ...)`。
 *
 * 契约在模块加载时就校验：少一个方法直接抛错（启动即失败），
 * 而不是等用户点到某个按钮才发现平台没实现。
 */
import { GitError } from '../git.js'

/** 每页条数：两家上限都是 100。 */
export const PAGE_SIZE = 100

/** PR 合并状态：GitHub 会在计算期间返回 null，那表示「还不知道」，不是「不能合并」。 */
function mergeableOf(value) {
  if (value === true) return true
  if (value === false) return false
  return null
}

function baseMeta(item, fullName, provider) {
  return {
    fullName,
    description: typeof item.description === 'string' ? item.description : '',
    language: typeof item.language === 'string' ? item.language : '',
    private: item.private === true,
    defaultBranch: typeof item.default_branch === 'string' ? item.default_branch : '',
    sizeKb: Number.isFinite(item.size) ? item.size : 0,
    stars: Number.isFinite(item.stargazers_count) ? item.stargazers_count : 0,
    forks: Number.isFinite(item.forks_count) ? item.forks_count : 0,
    updatedAt: typeof item.updated_at === 'string' ? item.updated_at : '',
    htmlUrl: typeof item.html_url === 'string' ? item.html_url : provider.web + '/' + fullName
  }
}

function repoMeta(item) {
  return {
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
  }
}

function issueMeta(item) {
  return {
    number: Number.isFinite(item.number) ? item.number : null,
    title: typeof item.title === 'string' ? item.title : '',
    url: typeof item.html_url === 'string' ? item.html_url : '',
    author: typeof item.user?.login === 'string' ? item.user.login : '',
    comments: Number.isFinite(item.comments) ? item.comments : 0,
    // created_at = 提交 PR 的时间；updated_at = 最后一次有动静（提交/评论/审查）
    createdAt: typeof item.created_at === 'string' ? item.created_at : '',
    updatedAt: typeof item.updated_at === 'string' ? item.updated_at : ''
  }
}

/**
 * PR 归一化。两家的统计字段不保证都给，所以额外带 `statsComplete`：
 * 缺字段时界面显示「—」而不是 0。
 */
function pullMeta(item, provider) {
  const hasStats = Number.isFinite(item.additions) || Number.isFinite(item.deletions)
    || Number.isFinite(item.changed_files)
  const merged = item.merged === true || item.state === 'merged'
    || (typeof item.merged_at === 'string' && item.merged_at !== '')
  return {
    number: Number.isFinite(item.number) ? item.number : null,
    title: typeof item.title === 'string' ? item.title : '',
    body: typeof item.body === 'string' ? item.body : '',
    state: typeof item.state === 'string' ? item.state : '',
    draft: item.draft === true,
    merged,
    mergeable: mergeableOf(item.mergeable),
    author: typeof item.user?.login === 'string' ? item.user.login : '',
    baseBranch: typeof item.base?.ref === 'string' ? item.base.ref : '',
    headBranch: typeof item.head?.ref === 'string' ? item.head.ref : '',
    additions: Number.isFinite(item.additions) ? item.additions : 0,
    deletions: Number.isFinite(item.deletions) ? item.deletions : 0,
    changedFiles: Number.isFinite(item.changed_files) ? item.changed_files : 0,
    commits: Number.isFinite(item.commits) ? item.commits : 0,
    statsComplete: hasStats,
    createdAt: typeof item.created_at === 'string' ? item.created_at : '',
    updatedAt: typeof item.updated_at === 'string' ? item.updated_at : '',
    htmlUrl: typeof item.html_url === 'string'
      ? item.html_url
      : provider.web + '/' + String(item.base?.repo?.full_name ?? '') + '/pulls/' + String(item.number ?? '')
  }
}

const github = {
  id: 'github',
  label: 'GitHub',
  web: 'https://github.com',
  apiBase: 'https://api.github.com',
  tokenUrl: 'https://github.com/settings/tokens/new?description=dsh-git-panel&scopes=repo',
  gitUser: 'x-access-token',
  headers: (token) => ({
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }),
  authorize: (url) => url,
  userPath: () => '/user',
  reposPath: (page) => '/user/repos?per_page=' + PAGE_SIZE + '&page=' + page
    + '&sort=updated&affiliation=owner,collaborator,organization_member',
  repoPath: (fullName) => '/repos/' + fullName,
  pullPath: (number) => '/pulls/' + number,
  pullListPath: (pageSize) => '/pulls?state=open&per_page=' + pageSize,
  issueListPath: (pageSize) => '/issues?state=open&per_page=' + pageSize,
  filesPath: (number) => '/pulls/' + number + '/files',
  // PR 在 GitHub 上是 issue，评论走 issues 接口
  commentPath: (number) => '/issues/' + number + '/comments',
  // 深度审阅：GitHub 有标准的 refs/pull/N/head，链接到 fork 也能取到
  gitUrl: (fullName) => 'https://github.com/' + fullName + '.git',
  reviewRef: (number) => 'refs/pull/' + number + '/head',
  // 计数：issues 列表是游标分页（没有 rel=last），用 search API 的 total_count 才准；
  // search 的 type:issue 天然排除 PR，不需要再减。
  countsPath: (kind, fullName) => (kind === 'issues'
    ? '/search/issues?q=' + encodeURIComponent('repo:' + fullName + ' type:issue state:open') + '&per_page=1'
    : '/repos/' + fullName + '/pulls?state=open&per_page=1'),
  normalizeRepo: repoMeta,
  normalizeIssue: issueMeta,
  normalizeDetail: (item, fullName) => ({
    ...baseMeta(item, fullName, github),
    issuesUrl: (typeof item.html_url === 'string' ? item.html_url : github.web + '/' + fullName) + '/issues',
    pullsUrl: (typeof item.html_url === 'string' ? item.html_url : github.web + '/' + fullName) + '/pulls'
  }),
  pull: {
    verdicts: ['approve', 'request-changes', 'comment'],
    reviewEvents: { approve: 'APPROVE', 'request-changes': 'REQUEST_CHANGES', comment: 'COMMENT' },
    reviewsPath: true,
    mergeMethods: ['merge', 'squash', 'rebase'],
    mergeDeletesBranch: 'api',
    // GitHub 的合并门禁是 required status checks（CI 决定），面板里没有「标记测试通过」这种动作
    testPath: null,
    normalizePull: (item) => pullMeta(item, github),
    normalizeReview: (item) => ({
      author: typeof item.user?.login === 'string' ? item.user.login : '',
      state: typeof item.state === 'string' ? item.state : '',
      body: typeof item.body === 'string' ? item.body : '',
      submittedAt: typeof item.submitted_at === 'string' ? item.submitted_at : ''
    })
  }
}

const gitee = {
  id: 'gitee',
  label: 'Gitee',
  web: 'https://gitee.com',
  apiBase: 'https://gitee.com/api/v5',
  tokenUrl: 'https://gitee.com/profile/personal_access_tokens',
  gitUser: null,
  headers: () => ({ Accept: 'application/json' }),
  authorize: (url, token) => url + (url.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(token),
  userPath: () => '/user',
  reposPath: (page) => '/user/repos?per_page=' + PAGE_SIZE + '&page=' + page + '&sort=updated',
  repoPath: (fullName) => '/repos/' + fullName,
  pullPath: (number) => '/pulls/' + number,
  pullListPath: (pageSize) => '/pulls?state=open&per_page=' + pageSize,
  issueListPath: (pageSize) => '/issues?state=open&per_page=' + pageSize,
  filesPath: (number) => '/pulls/' + number + '/files',
  commentPath: (number) => '/pulls/' + number + '/comments',
  // Gitee 没有公开的 pull refs，用 PR 的 head 分支拉取
  gitUrl: (fullName) => 'https://gitee.com/' + fullName + '.git',
  reviewRef: (number, pull) => {
    const branch = pull === null || pull === undefined ? '' : pull.headBranch
    if (typeof branch !== 'string' || branch === '') {
      throw new GitError('bad-request', 'Gitee 的深度审阅需要 PR 的 head 分支名，但平台没有给出')
    }
    return 'refs/heads/' + branch
  },
  // Gitee 的 issues / pulls 是两个独立集合，且响应头带 total_count、Link 带 rel='last'
  countsPath: (kind, fullName) => '/repos/' + fullName
    + (kind === 'issues' ? '/issues?state=open&per_page=1' : '/pulls?state=open&per_page=1'),
  normalizeRepo: repoMeta,
  normalizeIssue: issueMeta,
  normalizeDetail: (item, fullName) => ({
    ...baseMeta(item, fullName, gitee),
    issuesUrl: (typeof item.html_url === 'string' ? item.html_url : gitee.web + '/' + fullName) + '/issues',
    pullsUrl: (typeof item.html_url === 'string' ? item.html_url : gitee.web + '/' + fullName) + '/pulls'
  }),
  pull: {
    verdicts: ['approve'],
    reviewEvents: null,
    reviewsPath: null,
    mergeMethods: ['merge', 'squash'],
    mergeDeletesBranch: 'flag',
    // Gitee 允许把 PR 标记为「测试通过」，这是它的合并门禁之一
    testPath: '/test',
    normalizePull: (item) => pullMeta(item, gitee),
    normalizeReview: null
  }
}

export const PROVIDERS = Object.freeze({ github, gitee })
export const PROVIDER_IDS = Object.freeze(['github', 'gitee'])

/* ------------------------- 契约校验：启动时就失败 ------------------------- */

const REQUIRED_PROVIDER_KEYS = [
  'id', 'label', 'web', 'apiBase', 'tokenUrl', 'headers', 'authorize',
  'userPath', 'reposPath', 'repoPath', 'pullPath', 'pullListPath', 'issueListPath',
  'filesPath', 'commentPath', 'countsPath', 'gitUrl', 'reviewRef',
  'normalizeRepo', 'normalizeIssue', 'normalizeDetail'
]
const REQUIRED_PULL_KEYS = [
  'verdicts', 'mergeMethods', 'mergeDeletesBranch', 'normalizePull'
]

for (const provider of Object.values(PROVIDERS)) {
  for (const key of REQUIRED_PROVIDER_KEYS) {
    if (provider[key] === undefined || provider[key] === null) {
      throw new Error(`provider "${provider.id ?? '?'}" 缺少 ${key}`)
    }
  }
  for (const key of REQUIRED_PULL_KEYS) {
    if (provider.pull[key] === undefined || provider.pull[key] === null) {
      throw new Error(`provider "${provider.id}" 的 pull 能力缺少 ${key}`)
    }
  }
  if (typeof provider.pull.normalizeReview !== 'function' && provider.pull.reviewsPath !== null) {
    throw new Error(`provider "${provider.id}" 声称能读审查记录，却没有 normalizeReview`)
  }
  if (typeof provider.pull.normalizeReview === 'function' && provider.pull.reviewsPath === null) {
    throw new Error(`provider "${provider.id}" 有 normalizeReview 但没声明 reviewsPath`)
  }
  if (provider.pull.reviewEvents !== null) {
    for (const verdict of provider.pull.verdicts) {
      if (typeof provider.pull.reviewEvents[verdict] !== 'string') {
        throw new Error(`provider "${provider.id}" 的审查结论 ${verdict} 没有对应的事件名`)
      }
    }
  }
}

export function requireProvider(providerId) {
  const provider = PROVIDERS[providerId]
  if (provider === undefined) throw new GitError('bad-request', '不支持的托管平台：' + String(providerId))
  return provider
}

export function requireFullName(value) {
  if (typeof value !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(value)) {
    throw new GitError('bad-request', '仓库名不合法：' + String(value))
  }
  return value
}

export function requirePullNumber(value) {
  const number = Number.isInteger(value) ? value : Number.parseInt(String(value), 10)
  if (!Number.isInteger(number) || number <= 0) throw new GitError('bad-request', 'PR 编号不合法：' + String(value))
  return number
}
