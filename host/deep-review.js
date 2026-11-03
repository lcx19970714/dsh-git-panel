/**
 * host/deep-review.js —— 深度审阅（直接读真实本地目录）
 *
 * 交互逻辑（越简单越好）：
 *  1. 变更那边（项目里所有仓库根）已经有这个项目 → 把那个目录切到 PR 对应的分支，直接审；
 *  2. 没有 → 返回 needsClone，由界面弹框确认「拉到项目工作区 / 指定目录」，克隆后再审。
 *
 * 因此这里不再有临时裸仓库与 worktree：审的就是真实目录，方便用户自己调试、切分支。
 * 克隆/切分支的编排在 index.js（那边能拿到 provider、凭据与项目根）。
 */
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { generateReview } from './review.js'

/** 超过这个字节数的文件不读完整内容（避免把几十 MB 的产物读进内存）。 */
const MAX_READ_BYTES = 2 * 1024 * 1024

/**
 * 读改动文件的完整内容（相对某个真实工作目录）。
 *
 * 只读普通文本文件；二进制（含 NUL 字节）与超大文件跳过，并在 skipped 里说明原因。
 */
export async function readChangedFiles(rootDir, files, options = {}) {
  const limitBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : MAX_READ_BYTES
  const root = path.resolve(rootDir)
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
      skipped.push({ filename, reason: '目录里没有这个文件' })
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
    fullFiles.push({ filename, text: buffer.toString('utf8'), size: info.size })
  }
  return { fullFiles, skipped }
}

/**
 * 深度审阅：从一个**已准备好的真实目录**读完整文件后交给模型。
 *
 * @param {{ llm: object, pair: {provider: string, model: string}, pull: object, files: object[],
 *           localRoot: string, branch?: string, filesTruncated?: boolean, signal?: AbortSignal }} input
 */
export async function deepReview(input) {
  const { llm, pair, pull, files, localRoot, signal } = input
  const { fullFiles, skipped } = await readChangedFiles(localRoot, files, {
    maxBytes: input.maxReadBytes
  })
  const review = await generateReview(llm, pair, { pull, files }, {
    mode: 'deep',
    fullFiles,
    filesTruncated: input.filesTruncated,
    signal,
    timeoutMs: input.timeoutMs
  })
  return {
    ...review,
    deep: true,
    objectSource: 'local',
    localRootUsed: localRoot,
    branch: typeof input.branch === 'string' ? input.branch : null,
    filesRead: fullFiles.length,
    fullFilesSkipped: skipped
  }
}
