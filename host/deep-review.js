/**
 * host/deep-review.js —— 深度审阅：把 PR 的 head 拉到临时目录后做「本地审阅」。
 *
 * 全程隔离，不碰用户的工作区与仓库：
 *   1. 在系统临时目录建一个**裸仓库**（git init --bare）
 *   2. `git fetch --depth=1 <平台地址> <refspec>` 只拉这个 PR 的 head（令牌用
 *      `-c http.extraHeader` 一次性传入，不落盘）
 *   3. `git worktree add --detach` 检出到临时目录，读改动文件的**完整内容**
 *   4. 交给 review 模块（deep 模式：diff + 完整文件），最后删掉整个临时目录
 *
 * 不用「切换到本地分支」的原因：那会改用户的工作区（未提交改动可能丢失），
 * 而且本地仓库不一定就是这个 PR 的克隆。裸仓库 + worktree 是等价且安全的做法。
 */
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { GitError, runGit } from './git.js'
import { DEEP_FILE_LIMIT, generateReview } from './review.js'

/** 超过这个字节数的文件不读（避免把几十 MB 的产物读进内存）。 */
const MAX_READ_BYTES = 2 * 1024 * 1024
const FETCH_TIMEOUT_MS = 5 * 60 * 1000

function authArgs(user, token) {
  if (typeof token !== 'string' || token === '') return []
  const basic = Buffer.from(String(user) + ':' + token, 'utf8').toString('base64')
  return ['-c', 'http.extraHeader=AUTHORIZATION: basic ' + basic]
}

/** 本地仓库的 origin 是否就是这个 PR 的仓库。 */
async function localRepoMatches(root, fullName) {
  const result = await runGit(root, ['config', '--get', 'remote.origin.url'], { allowFailure: true })
  if (result.code !== 0) return false
  const url = result.stdout.toString('utf8').trim().toLowerCase()
    .replace(/\\/g, '/')
    .replace(/\.git$/, '')
  return url.includes('/' + String(fullName).toLowerCase())
}

/**
 * 把 PR 的 head 检出到临时目录。
 *
 * 两条路径：
 *  - 本地仓库匹配（origin 指向同一个仓库）：复用它的对象库，fetch 一个临时 ref + 临时 worktree，
 *    已存在的提交不会再下载 —— 通常近乎瞬时；结束后删 worktree 与 ref，不碰当前分支。
 *  - 否则：在系统临时目录建裸仓库，`--depth=1` 只拉这个 PR 的 head，用完删除。
 *
 * @returns {Promise<{ root: string, tree: string, objectSource: 'local'|'temp', cleanup: () => Promise<void> }>}
 */
export async function materializePull(source, options = {}) {
  const { signal, tempRoot } = options
  const localRoot = typeof options.localRoot === 'string' && options.localRoot !== '' ? options.localRoot : null
  const useLocal = localRoot !== null && await localRepoMatches(localRoot, source.fullName)

  if (useLocal) {
    const tree = await mkdtemp(path.join(tempRoot ?? os.tmpdir(), 'dsh-deep-review-tree-'))
    const localRef = 'refs/dsh/review-' + randomBytes(4).toString('hex')
    const cleanup = async () => {
      await runGit(localRoot, ['worktree', 'remove', '--force', tree], { allowFailure: true })
      await runGit(localRoot, ['update-ref', '-d', localRef], { allowFailure: true })
      await rm(tree, { recursive: true, force: true })
    }
    try {
      await runGit(localRoot, [
        ...authArgs(source.user, source.token),
        'fetch', '--no-tags', 'origin', '+' + source.remoteRef + ':' + localRef
      ], { signal, timeoutMs: FETCH_TIMEOUT_MS })
      await runGit(localRoot, ['worktree', 'add', '--detach', tree, localRef], { signal })
    } catch (error) {
      await cleanup()
      if (error instanceof GitError) throw error
      throw new GitError('deep-review-failed', '从本地仓库取 PR 代码失败：' + (error instanceof Error ? error.message : String(error)))
    }
    return { root: localRoot, tree, objectSource: 'local', cleanup }
  }

  const base = await mkdtemp(path.join(tempRoot ?? os.tmpdir(), 'dsh-deep-review-'))
  const repoDir = path.join(base, 'repo.git')
  const tree = path.join(base, 'tree')
  const localRef = 'refs/dsh/review'
  const cleanup = async () => {
    await rm(base, { recursive: true, force: true })
  }
  try {
    await runGit(base, ['init', '--bare', '-q', repoDir], { signal })
    await runGit(base, [
      '-C', repoDir,
      ...authArgs(source.user, source.token),
      'fetch', '--depth=1', '--no-tags', source.url, '+' + source.remoteRef + ':' + localRef
    ], { signal, timeoutMs: FETCH_TIMEOUT_MS })
    await runGit(base, ['-C', repoDir, 'worktree', 'add', '--detach', tree, localRef], { signal })
  } catch (error) {
    await cleanup()
    if (error instanceof GitError) throw error
    throw new GitError('deep-review-failed', '拉取 PR 代码失败：' + (error instanceof Error ? error.message : String(error)))
  }
  return { root: base, tree, objectSource: 'temp', cleanup }
}

/**
 * 读改动文件的完整内容。
 *
 * 只读普通文本文件；二进制（含 NUL 字节）与超大文件跳过，并在 skipped 里说明原因。
 */
export async function readChangedFiles(tree, files, options = {}) {
  const limitBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : MAX_READ_BYTES
  const root = path.resolve(tree)
  const fullFiles = []
  const skipped = []
  for (const file of files) {
    const filename = typeof file.filename === 'string' ? file.filename : ''
    if (filename === '') continue
    if (file.status === 'deleted') {
      skipped.push({ filename, reason: '文件已删除' })
      continue
    }
    const abs = path.resolve(root, filename)
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      skipped.push({ filename, reason: '路径越界' })
      continue
    }
    let info
    try {
      info = await stat(abs)
    } catch {
      skipped.push({ filename, reason: '工作区里没有这个文件' })
      continue
    }
    if (!info.isFile()) {
      skipped.push({ filename, reason: '不是普通文件' })
      continue
    }
    if (info.size > limitBytes) {
      skipped.push({ filename, reason: '文件过大（' + info.size + ' 字节），未读取' })
      continue
    }
    const buffer = await readFile(abs)
    if (buffer.includes(0)) {
      skipped.push({ filename, reason: '二进制文件' })
      continue
    }
    const text = buffer.toString('utf8')
    fullFiles.push({ filename, text, size: info.size })
  }
  return { fullFiles, skipped }
}

/**
 * 深度审阅：拉代码 → 读完整文件 → 调模型 → 清理。
 *
 * @param {{ llm: object, pair: {provider: string, model: string}, source: {url: string, refspec: string, user?: string, token?: string}, pull: object, files: object[], signal?: AbortSignal, tempRoot?: string }} input
 */
export async function deepReview(input) {
  const { llm, pair, source, pull, files, signal } = input
  const materialized = await materializePull(source, {
    signal,
    tempRoot: input.tempRoot,
    localRoot: input.localRoot
  })
  let result
  let cleanupError = null
  try {
    const { fullFiles, skipped } = await readChangedFiles(materialized.tree, files, {
      maxBytes: input.maxReadBytes
    })
    result = await generateReview(llm, pair, { pull, files }, {
      mode: 'deep',
      fullFiles,
      signal,
      timeoutMs: input.timeoutMs
    })
    result = {
      ...result,
      deep: true,
      objectSource: materialized.objectSource,
      filesRead: fullFiles.length,
      // 没读到完整内容的文件（二进制/过大/已删除）要如实带出去
      fullFilesSkipped: skipped
    }
  } finally {
    try {
      await materialized.cleanup()
    } catch (error) {
      cleanupError = error instanceof Error ? error.message : String(error)
    }
  }
  return cleanupError === null ? result : { ...result, cleanupError }
}

export { DEEP_FILE_LIMIT }
