/**
 * host/roots.js —— 一个「项目」下的多根解析
 *
 * 三种根：
 *   primary    项目根本身（或其祖先）是 git 工作树 → 显示基准 = 项目根，repoRoot = 仓库根；
 *              项目根本身**不在**任何工作树里时，合成一个浏览根（isGit:false, repoRoot:null），
 *              保证「文件浏览」在非仓库项目 / 多仓库项目里始终可用
 *   discovered 项目根下（深度 ≤ 2）发现的仓库；项目根本身是仓库时继续找子模块/嵌套仓库
 *   extra      用户手工添加并持久化到 config.js 的外部仓库
 *
 * 设计要点：
 *  - 只做「便宜」的探测：resolveRepo（1 次 git）+ readHead（最多 4 次 git），
 *    **不跑 status**（dirty 由客户端真正打开某个根时再查）。
 *  - 所有返回路径统一正斜杠。
 *  - 按 repoRoot 去重（primary 与发现的仓库同一个仓库时不能出现两次）；浏览根没有 repoRoot，
 *    按 id/path 去重且永远排第一，不会被同路径的 discovered 根顶掉。
 *  - 索引顺序固定：浏览/primary → discovered（自然序）→ extra（自然序）。
 *  - 失效的外部根不丢弃：仍在结果里，带 isGit:false 与 error，让 UI 能提示并移除。
 */
import { stat } from 'node:fs/promises'
import path from 'node:path'

import {
  GitError,
  discoverRepos,
  naturalCompare,
  normalizeSlashes,
  readHead,
  resolveRepo
} from './git.js'
import { addExtra, listExtras, removeExtra } from './config.js'

const MAX_DISCOVER_DEPTH = 2
const MAX_DISCOVER_REPOS = 12
const IS_WINDOWS = process.platform === 'win32'

/* ---------------------------------------------------------------- 小工具 */

/** 比较用的仓库/路径键：绝对 + 正斜杠 + Windows 小写。 */
function keyOf(target) {
  const normalized = normalizeSlashes(path.resolve(target))
  return IS_WINDOWS ? normalized.toLowerCase() : normalized
}

/** 绝对 + 正斜杠（展示用）。 */
function toPosix(target) {
  return normalizeSlashes(path.resolve(target))
}

async function statOrNull(target) {
  try {
    return await stat(target)
  } catch {
    return null
  }
}

/** 目录名；盘符根之类取不到时退回完整路径。 */
function baseName(target) {
  const base = path.basename(toPosix(target))
  return base === '' ? toPosix(target) : base
}

function describe(error) {
  if (error instanceof Error) return error.message || error.name
  return String(error)
}

/** 空根的统一形状（保证字段齐全，客户端不用猜）。 */
function makeRoot(fields) {
  return {
    id: fields.id,
    path: fields.path,
    repoRoot: fields.repoRoot ?? null,
    name: '',
    kind: fields.kind,
    isGit: fields.isGit === true,
    branch: fields.branch ?? null,
    head: fields.head ?? null,
    upstream: fields.upstream ?? null,
    ahead: fields.ahead ?? 0,
    behind: fields.behind ?? 0,
    error: fields.error
  }
}

/**
 * 同名根用父目录名消歧：`a/src` 与 `b/src` → 名字分别带父目录。
 * 只影响展示，不改 id/path。
 */
function assignNames(roots) {
  const counts = new Map()
  for (const root of roots) {
    const base = baseName(root.path)
    counts.set(base, (counts.get(base) ?? 0) + 1)
  }
  for (const root of roots) {
    const base = baseName(root.path)
    if ((counts.get(base) ?? 0) > 1) {
      const parent = baseName(path.dirname(toPosix(root.path)))
      root.name = parent !== '' && parent !== base ? `${parent}/${base}` : base
    } else {
      root.name = base
    }
  }
  return roots
}

/* ------------------------------------------------------------ 根解析入口 */

/**
 * 按 id 去重，保留先出现的条目。
 * 浏览根（repoRoot === null）不参与 repoRoot 去重，这里保证它的 id/path 唯一，
 * 也保证它不会被后面同路径的根顶掉（它总是先入列）。
 */
function dedupeById(roots) {
  const seen = new Set()
  const unique = []
  for (const root of roots) {
    const key = keyOf(root.id)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(root)
  }
  return unique
}

/**
 * 解析一个项目下的所有根。
 *
 * @param {string} projectRoot 绝对路径
 * @param {{logger?: object, signal?: AbortSignal}} [options]
 * @returns {Promise<{projectRoot: string, roots: object[], warnings: string[]}>}
 */
export async function resolveRoots(projectRoot, options = {}) {
  if (typeof projectRoot !== 'string' || projectRoot.trim() === '') {
    throw new GitError('bad-request', '缺少项目根目录 projectRoot')
  }
  if (!path.isAbsolute(projectRoot.trim())) {
    throw new GitError('bad-request', `项目根目录必须是绝对路径：${projectRoot.trim()}`)
  }

  const projectDir = path.resolve(projectRoot.trim())
  const normalizedProjectRoot = normalizeSlashes(projectDir)
  const warnings = []
  const drafts = []
  const seenRepos = new Set()

  const projectInfo = await statOrNull(projectDir)
  if (!projectInfo) {
    warnings.push(`项目目录不存在：${normalizedProjectRoot}`)
  } else if (!projectInfo.isDirectory()) {
    throw new GitError('not-a-directory', `项目根不是目录：${normalizedProjectRoot}`)
  }
  const projectIsDir = projectInfo?.isDirectory() === true

  /* 1) 项目根本身在工作树里 → primary（git）；否则合成「浏览根」 */
  let projectRepo = null
  if (projectIsDir) projectRepo = await resolveRepo(projectDir)
  if (projectRepo?.repoRoot && projectRepo.bare !== true) {
    const repoRoot = toPosix(projectRepo.repoRoot)
    seenRepos.add(keyOf(repoRoot))
    drafts.push(
      makeRoot({
        id: repoRoot,
        path: normalizedProjectRoot,
        repoRoot,
        kind: 'primary',
        isGit: true
      })
    )
  } else {
    if (projectRepo?.bare === true) {
      warnings.push(`项目目录是裸仓库，没有工作区：${normalizedProjectRoot}`)
    }
    // 浏览根：项目根不是 git 工作树时，客户端仍要能逐层浏览文件（isGit:false → 不查 status）。
    // repoRoot 为 null 表示「不是仓库」；id 用项目根自身，永远排第一，不参与 repoRoot 去重。
    drafts.push(
      makeRoot({
        id: normalizedProjectRoot,
        path: normalizedProjectRoot,
        repoRoot: null,
        kind: 'primary',
        isGit: false,
        error: null
      })
    )
  }

  /* 2) 嵌套仓库（项目根是仓库时也继续找子模块/多仓库项目） */
  if (projectIsDir) {
    let found = []
    try {
      found = await discoverRepos(projectDir, {
        includeRoot: false,
        maxDepth: MAX_DISCOVER_DEPTH,
        maxRepos: MAX_DISCOVER_REPOS
      })
    } catch (error) {
      warnings.push(`扫描子仓库失败：${describe(error)}`)
    }

    const probes = await Promise.all(
      found.map(async (item) => ({
        dir: toPosix(item.path),
        // .git 存在但 rev-parse 失败（损坏、权限、裸仓库）时 repo 为 null
        repo: await resolveRepo(item.path)
      }))
    )
    probes.sort((a, b) => naturalCompare(a.dir, b.dir))

    for (const probe of probes) {
      if (!probe.repo?.repoRoot) {
        if (seenRepos.has(keyOf(probe.dir))) continue
        seenRepos.add(keyOf(probe.dir))
        drafts.push(
          makeRoot({
            id: probe.dir,
            path: probe.dir,
            repoRoot: null,
            kind: 'discovered',
            isGit: false,
            error: '无法读取该仓库（git 命令失败）'
          })
        )
        warnings.push(`无法读取仓库信息：${probe.dir}`)
        continue
      }
      const repoRoot = toPosix(probe.repo.repoRoot)
      const repoKey = keyOf(repoRoot)
      if (seenRepos.has(repoKey)) continue
      seenRepos.add(repoKey)
      drafts.push(
        makeRoot({
          id: repoRoot,
          path: probe.dir,
          repoRoot,
          kind: 'discovered',
          isGit: true
        })
      )
    }
  }

  /* 3) 持久化的外部根（失效的也保留，交给 UI 提示/移除） */
  let extras = []
  try {
    extras = await listExtras(projectDir, { logger: options.logger })
  } catch (error) {
    warnings.push(`读取外部仓库配置失败：${describe(error)}`)
  }

  const extraDrafts = []
  for (const listed of extras) {
    const dir = toPosix(listed)
    const info = await statOrNull(listed)
    if (!info || !info.isDirectory()) {
      extraDrafts.push(
        makeRoot({
          id: dir,
          path: dir,
          repoRoot: null,
          kind: 'extra',
          isGit: false,
          error: '目录不存在'
        })
      )
      warnings.push(`外部仓库目录不存在：${dir}`)
      continue
    }

    const repo = await resolveRepo(listed)
    if (!repo?.repoRoot) {
      extraDrafts.push(
        makeRoot({
          id: dir,
          path: dir,
          repoRoot: null,
          kind: 'extra',
          isGit: false,
          error: '不是 git 仓库'
        })
      )
      warnings.push(`外部目录不是 git 仓库：${dir}`)
      continue
    }

    // 外部根的显示基准与 id 都取仓库根，和 add/remove 传回的路径保持一致
    const repoRoot = toPosix(repo.repoRoot)
    const repoKey = keyOf(repoRoot)
    if (seenRepos.has(repoKey)) {
      warnings.push(`外部仓库与项目内仓库重复，已忽略：${dir}`)
      continue
    }
    seenRepos.add(repoKey)
    extraDrafts.push(
      makeRoot({
        id: repoRoot,
        path: repoRoot,
        repoRoot,
        kind: 'extra',
        isGit: true
      })
    )
  }
  extraDrafts.sort((a, b) => naturalCompare(a.path, b.path))
  drafts.push(...extraDrafts)

  /* 4) 兜底按 id 去重（浏览根 repoRoot 为 null，不参与 repoRoot 去重，也不能被顶掉），
        然后并行补 head / branch / upstream / ahead-behind（每个根只跑 readHead） */
  const uniqueDrafts = dedupeById(drafts)
  await Promise.all(
    uniqueDrafts
      .filter((draft) => draft.isGit && draft.repoRoot)
      .map(async (draft) => {
        try {
          const head = await readHead(draft.repoRoot)
          draft.branch = head.branch ?? null
          draft.head = head.head ?? null
          draft.upstream = head.upstream ?? null
          draft.ahead = head.ahead ?? 0
          draft.behind = head.behind ?? 0
        } catch (error) {
          draft.error = describe(error)
          warnings.push(`读取仓库信息失败（${draft.path}）：${describe(error)}`)
        }
      })
  )

  assignNames(uniqueDrafts)
  return { projectRoot: normalizedProjectRoot, roots: uniqueDrafts, warnings }
}

/* -------------------------------------------------------- 外部根的增删 */

function requireAbsolute(target, field) {
  if (typeof target !== 'string' || target.trim() === '') {
    throw new GitError('bad-request', `缺少参数 ${field}`)
  }
  const value = target.trim()
  if (!path.isAbsolute(value)) {
    throw new GitError('bad-request', `参数 ${field} 必须是绝对路径：${value}`)
  }
  return path.resolve(value)
}

/**
 * 添加外部仓库根：校验存在且是仓库 → 持久化 → 返回最新的根列表。
 * 错误码：'bad-request' | 'not-found' | 'not-a-repository'
 */
export async function addExtraRoot(projectRoot, dir, options = {}) {
  const projectDir = requireAbsolute(projectRoot, 'projectRoot')
  const target = requireAbsolute(dir, 'path')

  const info = await statOrNull(target)
  if (!info) throw new GitError('not-found', `目录不存在：${normalizeSlashes(target)}`)
  if (!info.isDirectory()) throw new GitError('not-a-repository', `不是目录：${normalizeSlashes(target)}`)

  const repo = await resolveRepo(target)
  if (!repo?.repoRoot) {
    throw new GitError('not-a-repository', `不是 git 仓库：${normalizeSlashes(target)}`)
  }

  // 持久化仓库根（不是用户选中的子目录）：resolveRoots 的 path/id 也是仓库根，
  // 这样客户端拿 root.path 调 roots/remove 能精确命中。
  const repoRoot = toPosix(repo.repoRoot)
  await addExtra(projectDir, repoRoot, { logger: options.logger })
  return resolveRoots(projectDir, options)
}

/**
 * 移除外部仓库根。不校验存在性：目录被删掉之后用户仍然要能移除记录。
 * 同时尝试「传入路径」与「该路径所属仓库根」两种写法，兼容手工编辑过的配置。
 */
export async function removeExtraRoot(projectRoot, dir, options = {}) {
  const projectDir = requireAbsolute(projectRoot, 'projectRoot')
  const target = requireAbsolute(dir, 'path')

  await removeExtra(projectDir, target, { logger: options.logger })
  const repo = await resolveRepo(target)
  if (repo?.repoRoot) {
    const repoRoot = toPosix(repo.repoRoot)
    if (keyOf(repoRoot) !== keyOf(target)) {
      await removeExtra(projectDir, repoRoot, { logger: options.logger })
    }
  }
  return resolveRoots(projectDir, options)
}
