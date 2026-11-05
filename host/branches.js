/**
 * host/branches.js —— 远端页签「分支」视图的合成逻辑（纯函数，无 IO）
 *
 * 输入是三个来源的原始数据：
 *  - 远端：平台 API 的分支名单（可能没读到，null）
 *  - 本地：`git for-each-ref refs/heads`（listBranches，可能没克隆，null）
 *  - 跟踪引用：`refs/remotes/origin/*`（remoteTrackingRefs，没有本地仓库时是 []）
 *
 * 输出是界面直接可用的一张表：每行的 local / remote / current / default / protected /
 * ahead-behind / upstream 是否还在 / 远端是否有新提交都算好，排序也定好。
 *
 * 这里不碰文件系统、不发网络请求、不跑 git —— 因此可以脱离宿主单独单测。
 * 取数与错误处理（某一侧失败只记 failures，不拖垮整体）由 index.js 的 handler 负责。
 */
import { naturalCompare } from './git.js'

/** 把任意输入收敛成数组（真值不可信：调用方可能传 null / 对象）。 */
function asArray(value) {
  return Array.isArray(value) ? value : []
}

/** ahead/behind 来自 git 输出解析，按非负整数收敛。 */
function toCount(value) {
  const number = Number.parseInt(value, 10)
  return Number.isFinite(number) && number > 0 ? number : 0
}

/**
 * @param {{
 *   remote: null | { branches: Array<{name: string, sha: string, protected: boolean}>, truncated: boolean },
 *   tracking: Array<{name: string, sha: string}>,
 *   local: null | {
 *     branches: Array<{name: string, current: boolean, upstream: string|null, ahead: number, behind: number, upstreamGone: boolean}>,
 *     current: string|null,
 *     detached: boolean
 *   },
 *   defaultBranch: string
 * }} input
 * @returns {{
 *   branches: Array<{
 *     name: string,
 *     local: boolean,
 *     current: boolean,
 *     remote: boolean|null,
 *     default: boolean,
 *     protected: boolean,
 *     remoteSha: string|null,
 *     upstream: string|null,
 *     ahead: number,
 *     behind: number,
 *     upstreamGone: boolean,
 *     upstreamMissing: boolean,
 *     remoteUpdated: boolean
 *   }>,
 *   remoteKnown: boolean,
 *   localKnown: boolean,
 *   truncated: boolean,
 *   counts: {total: number, local: number, remoteOnly: number, localOnly: number}
 * }}
 */
export function mergeBranches(input) {
  const source = input !== null && typeof input === 'object' ? input : {}
  const remote = source.remote !== null && typeof source.remote === 'object' ? source.remote : null
  const local = source.local !== null && typeof source.local === 'object' ? source.local : null
  const tracking = asArray(source.tracking)
  const defaultBranch = typeof source.defaultBranch === 'string' ? source.defaultBranch : ''

  const remoteKnown = remote !== null
  const localKnown = local !== null

  // 远端名单：同名脏条目只留第一条；name 为空的一律丢弃
  const remoteByName = new Map()
  if (remoteKnown) {
    for (const branch of asArray(remote.branches)) {
      if (branch === null || typeof branch !== 'object') continue
      const name = typeof branch.name === 'string' ? branch.name : ''
      if (name === '' || remoteByName.has(name)) continue
      remoteByName.set(name, {
        sha: typeof branch.sha === 'string' ? branch.sha : '',
        protected: branch.protected === true
      })
    }
  }

  // 本地名单：同样按名字去重；分支上的 current 字段不参与判定（以 HEAD 为准）。
  // listBranches 会把「只有远端」的分支也合成一条（local:false），那些不是本地分支，必须跳过 ——
  // 否则远端独有分支会被算成「本地有」，界面上「本地有没有」就全错了。
  const localByName = new Map()
  if (localKnown) {
    for (const branch of asArray(local.branches)) {
      if (branch === null || typeof branch !== 'object') continue
      if (branch.local === false) continue
      const name = typeof branch.name === 'string' ? branch.name : ''
      if (name === '' || localByName.has(name)) continue
      localByName.set(name, branch)
    }
  }

  // `<remote>/<branch>` 跟踪引用的 sha（已由 remoteTrackingRefs 去掉远端前缀）
  const trackingByName = new Map()
  for (const ref of tracking) {
    if (ref === null || typeof ref !== 'object') continue
    const name = typeof ref.name === 'string' ? ref.name : ''
    if (name === '' || trackingByName.has(name)) continue
    trackingByName.set(name, typeof ref.sha === 'string' ? ref.sha : '')
  }

  // 当前分支只认 HEAD：detached 时不属于任何分支
  const currentName = localKnown && local.detached !== true
    && typeof local.current === 'string' && local.current !== ''
    ? local.current
    : null

  // 名称全集 = 本地名单 ∪ 远端名单；某一侧读不到时自然只剩另一侧
  const names = new Set()
  for (const name of localByName.keys()) names.add(name)
  for (const name of remoteByName.keys()) names.add(name)

  const branches = []
  for (const name of names) {
    const localBranch = localByName.get(name) ?? null
    const remoteBranch = remoteByName.get(name) ?? null
    const isLocal = localBranch !== null
    const isRemote = remoteBranch !== null

    const upstream = isLocal && typeof localBranch.upstream === 'string' && localBranch.upstream !== ''
      ? localBranch.upstream
      : null
    const remoteSha = isRemote && typeof remoteBranch.sha === 'string' && remoteBranch.sha !== ''
      ? remoteBranch.sha
      : null

    // 上游名去掉第一段（远端名）之后的分支，不在远端名单里 = 远端已删
    let upstreamMissing = false
    if (remoteKnown && upstream !== null) {
      const slash = upstream.indexOf('/')
      const upstreamBranch = slash === -1 ? upstream : upstream.slice(slash + 1)
      upstreamMissing = upstreamBranch !== '' && !remoteByName.has(upstreamBranch)
    }

    // 远端 sha 与本地 origin/<name> 跟踪引用不同 = 远端有新提交，本地还没 fetch
    const trackingSha = trackingByName.get(name)
    const remoteUpdated = isRemote && remoteSha !== null
      && trackingSha !== undefined && trackingSha !== remoteSha

    branches.push({
      name,
      local: isLocal,
      current: currentName !== null && name === currentName,
      remote: remoteKnown ? isRemote : null,
      default: name === defaultBranch,
      protected: isRemote && remoteBranch.protected === true,
      remoteSha,
      upstream,
      ahead: isLocal ? toCount(localBranch.ahead) : 0,
      behind: isLocal ? toCount(localBranch.behind) : 0,
      upstreamGone: isLocal && localBranch.upstreamGone === true,
      upstreamMissing,
      remoteUpdated
    })
  }

  // 排序档位：当前 → 默认 → 本地+远端都有 → 仅本地 → 仅远端；同档按自然序。
  // 同时是当前与默认的分支只落在「当前」这一档，不会重复插两次。
  const rankOf = (branch) => {
    if (branch.current) return 0
    if (branch.default) return 1
    if (branch.local && branch.remote === true) return 2
    if (branch.local) return 3
    return 4
  }
  branches.sort((left, right) => (rankOf(left) - rankOf(right)) || naturalCompare(left.name, right.name))

  const counts = {
    total: branches.length,
    local: branches.filter((branch) => branch.local).length,
    remoteOnly: branches.filter((branch) => branch.remote === true && branch.local === false).length,
    localOnly: branches.filter((branch) => branch.local === true && branch.remote === false).length
  }

  return {
    branches,
    remoteKnown,
    localKnown,
    truncated: remoteKnown && remote.truncated === true,
    counts
  }
}
