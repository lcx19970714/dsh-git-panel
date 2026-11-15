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

/**
 * 计数字段归一化。
 *
 * 两家对「行数」的声明不同：GitHub 给数字（`3`），Gitee 给字符串（`"3"` —— 官方 schema 里
 * `additions` / `deletions` 的 type 就是 string）。两者都是平台自己声明的形状，所以在归一化
 * 这一层转一次，上层拿到的永远是数字；平台没给这个字段时返回 null（界面据此显示「—」）。
 */
function countOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

/**
 * Gitee 的布尔标记：schema 里写的是 integer，官方示例里是 false / true，两种都当同一个意思。
 */
function flagged(value) {
  return value === true || value === 1
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

/**
 * 分支归一化。两家的字段形状一致（name / commit.sha / protected），
 * 因此共用同一份实现；脏条目（没有 name）由调用方过滤。
 */
function branchMeta(item) {
  return {
    name: String(item.name ?? ''),
    sha: typeof item.commit?.sha === 'string' ? item.commit.sha : '',
    protected: item.protected === true
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
  const additions = countOf(item.additions)
  const deletions = countOf(item.deletions)
  const changedFiles = countOf(item.changed_files)
  const hasStats = additions !== null || deletions !== null || changedFiles !== null
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
    // fork PR 的 head 在另一个仓库里：深度审阅要按这个仓库拉代码
    headRepo: typeof item.head?.repo?.full_name === 'string' ? item.head.repo.full_name : '',
    // PR 的 head 提交：本地已经是这个提交时，深度审阅不需要再 fetch
    headSha: typeof item.head?.sha === 'string' ? item.head.sha : '',
    additions: additions ?? 0,
    deletions: deletions ?? 0,
    changedFiles: changedFiles ?? 0,
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
  // 分支列表：返回相对仓库的路径，调用方拼 apiBase + repoPath(fullName)
  branchesPath: (page) => '/branches?per_page=' + PAGE_SIZE + '&page=' + page,
  // 删分支：GitHub 删的是 ref，分支名整段编码（'/' → '%2F'），否则会被当成多级 ref
  branchDeletePath: (name) => '/git/refs/heads/' + encodeURIComponent(name),
  pullPath: (number) => '/pulls/' + number,
  pullListPath: (pageSize) => '/pulls?state=open&per_page=' + pageSize,
  issueListPath: (pageSize) => '/issues?state=open&per_page=' + pageSize,
  filesPath: (number) => '/pulls/' + number + '/files',
  // PR 在 GitHub 上是 issue，评论走 issues 接口
  commentPath: (number) => '/issues/' + number + '/comments',
  commitsPath: (number) => '/pulls/' + number + '/commits?per_page=50&page=1',
  // 当前分支对应哪个 PR：GitHub 支持 head=owner:branch 精确查询
  pullLookup: {
    path: '/pulls',
    params: ({ login, branch }) => '?head=' + encodeURIComponent(login + ':' + branch) + '&state=all&per_page=1',
    match: (item, branch) => (typeof item.head?.ref === 'string' ? item.head.ref : '') === branch
  },
  // 深度审阅：GitHub 有标准的 refs/pull/N/head，链接到 fork 也能取到
  gitUrl: (fullName) => 'https://github.com/' + fullName + '.git',
  // GitHub 的 refs/pull/N/head 对 fork PR 同样可用，直接用 base 仓库，不需要 fork 权限
  requiresForkAccess: false,
  reviewRepo: (fullName) => fullName,
  reviewRef: (number) => 'refs/pull/' + number + '/head',
  // 计数：issues 列表是游标分页（没有 rel=last），用 search API 的 total_count 才准；
  // search 的 type:issue 天然排除 PR，不需要再减。
  countsPath: (kind, fullName) => (kind === 'issues'
    ? '/search/issues?q=' + encodeURIComponent('repo:' + fullName + ' type:issue state:open') + '&per_page=1'
    : '/repos/' + fullName + '/pulls?state=open&per_page=1'),
  normalizeRepo: repoMeta,
  normalizeIssue: issueMeta,
  normalizeBranch: branchMeta,
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
    // 文件变更（GET /pulls/{n}/files）：计数是数字，patch 是 hunk 文本
    normalizePullFile: (item) => ({
      filename: typeof item.filename === 'string' ? item.filename : '',
      status: typeof item.status === 'string' ? item.status : '',
      additions: countOf(item.additions) ?? 0,
      deletions: countOf(item.deletions) ?? 0,
      changes: countOf(item.changes) ?? 0,
      patch: typeof item.patch === 'string' ? item.patch : ''
    }),
    normalizeReview: (item) => ({
      author: typeof item.user?.login === 'string' ? item.user.login : '',
      state: typeof item.state === 'string' ? item.state : '',
      body: typeof item.body === 'string' ? item.body : '',
      submittedAt: typeof item.submitted_at === 'string' ? item.submitted_at : ''
    }),
    // PR 的提交列表（GET /pulls/{n}/commits）
    normalizeCommit: (item) => ({
      sha: typeof item.sha === 'string' ? item.sha : '',
      message: typeof item.commit?.message === 'string' ? item.commit.message : '',
      author: typeof item.commit?.author?.name === 'string'
        ? item.commit.author.name
        : (typeof item.author?.login === 'string' ? item.author.login : ''),
      date: typeof item.commit?.author?.date === 'string'
        ? item.commit.author.date
        : (typeof item.commit?.committer?.date === 'string' ? item.commit.committer.date : ''),
      url: typeof item.html_url === 'string' ? item.html_url : ''
    }),
    // 评论列表（GET 与 POST 用同一个路径）
    normalizeComment: (item) => ({
      id: Number.isFinite(item.id) ? item.id : null,
      author: typeof item.user?.login === 'string' ? item.user.login : '',
      body: typeof item.body === 'string' ? item.body : '',
      createdAt: typeof item.created_at === 'string' ? item.created_at : '',
      url: typeof item.html_url === 'string' ? item.html_url : ''
    })
  }
}

/**
 * Gitee 的 PR 文件对象（`GET /pulls/{n}/files`）与 GitHub 不同构，官方 schema 写得很清楚：
 *
 *   · `additions` / `deletions` 是**字符串**（`"3"`）。按数字读（`Number.isFinite`）会全部落成 0 ——
 *     这正是「PR 的文件列表能看到、每行的 +N −M 显示不出来」的原因；
 *   · `patch` 是**对象**：diff 文本在 `patch.diff`，行数在 `patch.added_lines` / `removed_lines`。
 *     按字符串读会得到空 patch —— 点开文件、AI 审阅都拿不到这个文件的改动；
 *   · `status` 可能是 null（官方示例里就是 null），真实改动类型在 `patch.new_file` /
 *     `deleted_file` / `renamed_file` 上。
 *
 * Gitee 没有 `changes` 字段，按同一份定义（增 + 删）算出来。
 */
function giteeFile(item) {
  const patch = item.patch !== null && typeof item.patch === 'object' ? item.patch : null
  const additions = countOf(item.additions) ?? (patch === null ? 0 : countOf(patch.added_lines) ?? 0)
  const deletions = countOf(item.deletions) ?? (patch === null ? 0 : countOf(patch.removed_lines) ?? 0)
  return {
    filename: typeof item.filename === 'string' ? item.filename : '',
    status: giteeFileStatus(item.status, patch),
    additions,
    deletions,
    changes: additions + deletions,
    patch: patch === null || typeof patch.diff !== 'string' ? '' : patch.diff
  }
}

/** Gitee 的 status 为空时，用 patch 上的三个标记还原改动类型。 */
function giteeFileStatus(status, patch) {
  if (typeof status === 'string' && status !== '') return status
  if (patch === null) return ''
  if (flagged(patch.deleted_file)) return 'deleted'
  if (flagged(patch.renamed_file)) return 'renamed'
  if (flagged(patch.new_file)) return 'added'
  return 'modified'
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
  // 分支列表：与 GitHub 同构，相对仓库路径；翻页参数由调用方补
  branchesPath: (page) => '/branches?per_page=' + PAGE_SIZE + '&page=' + page,
  // 删分支：Gitee 的分支接口直接吃分支名，同样整段编码
  branchDeletePath: (name) => '/branches/' + encodeURIComponent(name),
  pullPath: (number) => '/pulls/' + number,
  pullListPath: (pageSize) => '/pulls?state=open&per_page=' + pageSize,
  issueListPath: (pageSize) => '/issues?state=open&per_page=' + pageSize,
  filesPath: (number) => '/pulls/' + number + '/files',
  commentPath: (number) => '/pulls/' + number + '/comments',
  commitsPath: (number) => '/pulls/' + number + '/commits?per_page=50&page=1',
  // Gitee 不支持 head 过滤（实测 500）：按作者列表拉一页，用 head 本地匹配
  pullLookup: {
    path: '/pulls',
    params: ({ login }) => '?state=all&author=' + encodeURIComponent(login) + '&per_page=100&page=1&sort=updated&direction=desc',
    match: (item, branch) => {
      const ref = typeof item.head?.ref === 'string' ? item.head.ref : ''
      const label = typeof item.head?.label === 'string' ? item.head.label : ''
      return ref === branch || label === branch || label.endsWith(':' + branch)
    }
  },
  // Gitee 没有公开的 pull refs，用 PR 的 head 分支拉取
  gitUrl: (fullName) => 'https://gitee.com/' + fullName + '.git',
  // Gitee 没有 pull refs：fork PR 的 head 分支在 fork 仓库里，必须用 head 仓库拉
  requiresForkAccess: true,
  reviewRepo: (fullName, pull) => {
    const head = pull === null || pull === undefined ? '' : pull.headRepo
    return typeof head === 'string' && head !== '' ? head : fullName
  },
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
  normalizeBranch: branchMeta,
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
    // 文件变更：Gitee 的计数是字符串、patch 是对象（见 giteeFile）
    normalizePullFile: giteeFile,
    normalizeReview: null,
    normalizeCommit: (item) => ({
      sha: typeof item.sha === 'string' ? item.sha : '',
      message: typeof item.commit?.message === 'string' ? item.commit.message : '',
      author: typeof item.commit?.author?.name === 'string'
        ? item.commit.author.name
        : (typeof item.author?.login === 'string' ? item.author.login : ''),
      date: typeof item.commit?.author?.date === 'string'
        ? item.commit.author.date
        : (typeof item.commit?.committer?.date === 'string' ? item.commit.committer.date : ''),
      url: typeof item.html_url === 'string' ? item.html_url : ''
    }),
    normalizeComment: (item) => ({
      id: Number.isFinite(item.id) ? item.id : null,
      author: typeof item.user?.login === 'string' ? item.user.login : '',
      body: typeof item.body === 'string' ? item.body : '',
      createdAt: typeof item.created_at === 'string' ? item.created_at : '',
      url: typeof item.html_url === 'string' ? item.html_url : ''
    })
  }
}

export const PROVIDERS = Object.freeze({ github, gitee })
export const PROVIDER_IDS = Object.freeze(['github', 'gitee'])

/* ------------------------- 契约校验：启动时就失败 ------------------------- */

const REQUIRED_PROVIDER_KEYS = [
  'id', 'label', 'web', 'apiBase', 'tokenUrl', 'headers', 'authorize',
  'userPath', 'reposPath', 'repoPath', 'branchesPath', 'branchDeletePath',
  'pullPath', 'pullListPath', 'issueListPath',
  'filesPath', 'commentPath', 'commitsPath', 'countsPath', 'gitUrl', 'reviewRepo', 'reviewRef', 'requiresForkAccess', 'pullLookup',
  'normalizeRepo', 'normalizeIssue', 'normalizeBranch', 'normalizeDetail'
]
const REQUIRED_PULL_KEYS = [
  'verdicts', 'mergeMethods', 'mergeDeletesBranch', 'normalizePull', 'normalizePullFile',
  'normalizeComment', 'normalizeCommit'
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
