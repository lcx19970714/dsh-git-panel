/**
 * host/git.js —— 只读 Git 引擎
 *
 * 设计原则：
 *  1. 只用 node 内置模块，不依赖任何 DSH 包，因此可以脱离 DSH 单独跑测试。
 *  2. 只读：白名单命令（status/diff/rev-parse/ls-tree/show/check-ignore/log），
 *     绝不执行 add/commit/checkout/stash/reset/push 等写操作。
 *  3. 所有子进程都有超时、输出上限、可取消；错误一律抛 GitError（带 code）。
 *  4. 路径解析统一走 resolveInside()，拒绝逃逸出仓库根。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const DEFAULT_TIMEOUT_MS = 15_000
export const DIFF_TIMEOUT_MS = 30_000
export const MAX_GIT_OUTPUT = 16 * 1024 * 1024
export const MAX_TEXT_FILE_BYTES = 1024 * 1024
export const MAX_TREE_ENTRIES = 2000

/** 与 git 交互时的统一错误类型。 */
export class GitError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'GitError'
    this.code = code
    this.details = details
  }
}

// ---------------------------------------------------------------------------
// 子进程执行
// ---------------------------------------------------------------------------

const GIT_ENV_OVERRIDES = {
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
  GIT_PAGER: 'cat',
  GIT_ASKPASS: '',
  GIT_EDITOR: '',
  LC_ALL: 'C',
  LANG: 'C'
}

/** 命令前缀：关闭引号转义、颜色、分页，保证输出可解析。 */
const BASE_ARGS = [
  '-c', 'core.quotepath=false',
  '-c', 'color.ui=false',
  '-c', 'core.pager=cat',
  '-c', 'advice.detachedHead=false',
  '-c', 'diff.noprefix=false',
  '--no-pager'
]

/**
 * 运行 git 子进程。
 * @returns {Promise<{stdout: Buffer, stderr: string, code: number, truncated: boolean}>}
 */
export function runGit(cwd, args, options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxOutput = MAX_GIT_OUTPUT,
    signal,
    allowFailure = false,
    input
  } = options

  if (signal?.aborted) {
    return Promise.reject(new GitError('aborted', '操作已取消'))
  }

  const env = { ...process.env, ...GIT_ENV_OVERRIDES }

  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn('git', [...BASE_ARGS, ...args], {
        cwd,
        env,
        windowsHide: true,
        stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
      })
    } catch (error) {
      reject(new GitError('git-missing', '无法启动 git 进程：' + error.message))
      return
    }

    const outChunks = []
    const errChunks = []
    let outBytes = 0
    let errBytes = 0
    let truncated = false
    let settled = false

    const finish = (fn, value) => {
      if (settled) return
      settled = true
      cleanup()
      fn(value)
    }

    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      finish(reject, new GitError('timeout', `git ${args[0]} 超时（${timeoutMs}ms）`, { args }))
    }, timeoutMs)
    timer.unref?.()

    const onAbort = () => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      finish(reject, new GitError('aborted', '操作已取消', { args }))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    function cleanup() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }

    child.stdout.on('data', (chunk) => {
      if (outBytes >= maxOutput) { truncated = true; return }
      outBytes += chunk.length
      if (outBytes > maxOutput) {
        truncated = true
        outChunks.push(chunk.subarray(0, Math.max(0, chunk.length - (outBytes - maxOutput))))
        return
      }
      outChunks.push(chunk)
    })
    child.stderr.on('data', (chunk) => {
      if (errBytes >= 256 * 1024) return
      errBytes += chunk.length
      errChunks.push(chunk)
    })

    child.on('error', (error) => {
      if (error && error.code === 'ENOENT') {
        finish(reject, new GitError('git-missing', '系统里找不到 git 可执行文件'))
        return
      }
      finish(reject, new GitError('spawn-failed', error.message, { args }))
    })

    child.on('close', (code) => {
      const stdout = Buffer.concat(outChunks)
      const stderr = Buffer.concat(errChunks).toString('utf8').trim()
      if (code === 0 || allowFailure) {
        finish(resolve, { stdout, stderr, code: code ?? -1, truncated })
        return
      }
      finish(reject, new GitError(code === 128 ? 'not-a-repository' : 'git-failed',
        stderr || `git ${args[0]} 以退出码 ${code} 结束`, { args, code, stderr }))
    })

    if (input !== undefined) {
      try {
        child.stdin.end(input)
      } catch { /* ignore */ }
    }
  })
}

/** 运行 git 并以 utf8 拿 stdout。 */
export async function gitText(cwd, args, options = {}) {
  const result = await runGit(cwd, args, options)
  return { text: decodeGitOutput(result.stdout), ...result }
}

/**
 * git 的 stdout 对路径是原始字节；这里做宽松 utf8 解码。
 * 不走 TextDecoder('utf-8', {fatal:true})，避免个别非 utf8 文件名整段失败。
 */
function decodeGitOutput(buffer) {
  return buffer.toString('utf8')
}

// ---------------------------------------------------------------------------
// 仓库探测
// ---------------------------------------------------------------------------

/** 目录本身（或祖先）是否是 git 工作树；是则返回仓库根。 */
export async function resolveRepo(dir) {
  if (!dir || !existsSync(dir)) return null
  try {
    const { stdout } = await runGit(dir, ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--is-inside-work-tree'])
    const lines = stdout.toString('utf8').split('\n').map((l) => l.trim()).filter(Boolean)
    const insideWorkTree = lines[2] === 'true'
    if (!insideWorkTree) {
      return { repoRoot: lines[0] || null, gitDir: lines[1] || null, bare: true }
    }
    return { repoRoot: normalizeSlashes(lines[0]), gitDir: normalizeSlashes(lines[1]), bare: false }
  } catch {
    return null
  }
}

/** 目录内部是否有 .git（目录或 gitfile），不向上找祖先。 */
export function hasOwnGitDir(dir) {
  try {
    return existsSync(path.join(dir, '.git'))
  } catch {
    return false
  }
}

/** 读取当前 HEAD / 分支 / upstream / ahead-behind。 */
export async function readHead(repoRoot) {
  let branch = null
  let detached = false
  let head = null
  try {
    const symbolic = await runGit(repoRoot, ['symbolic-ref', '--short', '-q', 'HEAD'], { allowFailure: true })
    if (symbolic.code === 0) branch = symbolic.stdout.toString('utf8').trim()
    else detached = true
  } catch { /* ignore */ }

  try {
    const rev = await runGit(repoRoot, ['rev-parse', '--short', 'HEAD'], { allowFailure: true })
    if (rev.code === 0) head = rev.stdout.toString('utf8').trim()
  } catch { /* ignore */ }

  let upstream = null
  let ahead = 0
  let behind = 0
  if (branch) {
    try {
      const up = await runGit(repoRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], { allowFailure: true })
      if (up.code === 0) {
        upstream = up.stdout.toString('utf8').trim()
        const counts = await runGit(repoRoot, ['rev-list', '--count', '--left-right', '@{upstream}...HEAD'], { allowFailure: true })
        if (counts.code === 0) {
          const [left, right] = counts.stdout.toString('utf8').trim().split(/\s+/)
          behind = Number.parseInt(left, 10) || 0
          ahead = Number.parseInt(right, 10) || 0
        }
      }
    } catch { /* ignore */ }
  }

  return { branch, detached, head, upstream, ahead, behind }
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

const SKIP_ALWAYS_DISPLAY = new Set(['.git'])

/**
 * 读取工作区状态。
 * @returns {{ repoRoot, head: object, files: FileEntry[], counts: object, truncated: boolean }}
 */
export async function readStatus(repoRoot, options = {}) {
  const { withLineCounts = true, signal } = options
  const [head, remoteUrl] = await Promise.all([
    readHead(repoRoot),
    readRemoteUrl(repoRoot, { signal })
  ])

  const statusResult = await runGit(repoRoot, [
    'status',
    '--porcelain=v2',
    '-z',
    '--untracked-files=all',
    '--find-renames',
    '--ignored=no'
  ], { signal })

  const entries = parsePorcelainV2(statusResult.stdout.toString('utf8'))
  const files = []
  for (const entry of entries) {
    if (!entry.path || SKIP_ALWAYS_DISPLAY.has(entry.path)) continue
    if (entry.ignored) continue
    files.push(entry)
  }

  // 行数统计：脏文件很多时跳过，保证面板打开速度。命令失败也不影响主流程。
  const changed = files.length
  if (withLineCounts && changed > 0 && changed <= 400) {
    await attachLineCounts(repoRoot, files, signal)
  }

  const counts = {
    total: files.length,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0
  }
  for (const file of files) {
    if (file.conflicted) counts.conflicted += 1
    if (file.untracked) counts.untracked += 1
    if (file.staged) counts.staged += 1
    if (file.unstaged) counts.unstaged += 1
  }

  files.sort((a, b) => naturalCompare(a.path, b.path))

  return {
    repoRoot,
    ...head,
    remoteUrl,
    files,
    counts,
    truncated: statusResult.truncated
  }
}

/**
 * 解析 `git status --porcelain=v2 -z`。
 * 行格式（\0 分隔的 token 流）：
 *   1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
 *   2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\0<origPath>
 *   u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
 *   ? <path>
 *   ! <path>
 */
export function parsePorcelainV2(text) {
  const tokens = text.split('\u0000')
  const out = []
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (!token) continue
    const kind = token[0]
    if (kind === '\n' || kind === '\r') continue

    if (kind === '?') {
      const p = token.slice(2)
      if (!p) continue
      out.push(makeEntry(p, { untracked: true, status: '?', index: '.', worktree: '?' }))
      continue
    }
    if (kind === '!') {
      const p = token.slice(2)
      if (!p) continue
      out.push(makeEntry(p, { ignored: true, status: '!', index: '!', worktree: '!' }))
      continue
    }
    if (kind === '1') {
      const parts = token.split(' ')
      if (parts.length < 9) continue
      const xy = parts[1] || '..'
      const p = parts.slice(8).join(' ')
      out.push(makeEntry(p, { index: xy[0], worktree: xy[1] }))
      continue
    }
    if (kind === '2') {
      const parts = token.split(' ')
      if (parts.length < 10) continue
      const xy = parts[1] || '..'
      const p = parts.slice(9).join(' ')
      const oldPath = tokens[i + 1] || null
      i += 1
      const entry = makeEntry(p, { index: xy[0], worktree: xy[1] })
      if (oldPath) entry.oldPath = oldPath
      out.push(entry)
      continue
    }
    if (kind === 'u') {
      const parts = token.split(' ')
      if (parts.length < 11) continue
      const xy = parts[1] || 'UU'
      const p = parts.slice(10).join(' ')
      out.push(makeEntry(p, { index: xy[0], worktree: xy[1], conflicted: true }))
      continue
    }
    // 未知行：忽略
  }
  return out
}

const STATUS_RANK = { M: 5, A: 4, D: 3, R: 2, C: 2, T: 1, U: 6, '?': 0 }

function normalizeStatusCode(char) {
  if (!char || char === '.' || char === ' ') return '.'
  return char
}

function makeEntry(p, raw) {
  const index = normalizeStatusCode(raw.index)
  const worktree = normalizeStatusCode(raw.worktree)
  const staged = index !== '.'
  const unstaged = worktree !== '.' && worktree !== '?'
  const untracked = raw.untracked === true

  let status = '.'
  if (raw.conflicted) status = 'U'
  else if (untracked) status = '?'
  else {
    const candidates = [index, worktree].filter((c) => c !== '.')
    candidates.sort((a, b) => (STATUS_RANK[b] ?? 0) - (STATUS_RANK[a] ?? 0))
    status = candidates[0] ?? '.'
  }

  return {
    path: p,
    status,
    index,
    worktree,
    staged,
    unstaged,
    untracked,
    conflicted: raw.conflicted === true,
    ignored: raw.ignored === true,
    adds: -1,
    dels: -1,
    binary: false
  }
}

/** 用 numstat 补上增删行数；失败静默（面板不显示 counts 而已）。 */
async function attachLineCounts(repoRoot, files, signal) {
  const byPath = new Map()
  for (const file of files) byPath.set(file.path, file)

  try {
    const [unstaged, staged] = await Promise.all([
      numstat(repoRoot, ['diff', '--numstat', '-z', '--no-color', '--no-ext-diff'], signal),
      numstat(repoRoot, ['diff', '--cached', '--numstat', '-z', '--no-color', '--no-ext-diff'], signal)
    ])
    applyNumstat(byPath, unstaged, false)
    applyNumstat(byPath, staged, true)
  } catch { /* ignore */ }

  // 未跟踪文件：小文件直接数行，让面板也能显示 +N。
  let budget = 40
  await Promise.all(files.map(async (file) => {
    if (!file.untracked || budget <= 0) return
    budget -= 1
    try {
      const abs = path.join(repoRoot, file.path)
      const info = await stat(abs)
      if (!info.isFile() || info.size > 512 * 1024) return
      const buffer = await readFile(abs)
      if (buffer.includes(0)) { file.binary = true; return }
      const text = buffer.toString('utf8')
      file.adds = text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
      file.dels = 0
    } catch { /* ignore */ }
  }))
}

function applyNumstat(byPath, entries, stagedOnly) {
  for (const item of entries) {
    const file = byPath.get(item.path)
    if (!file) continue
    if (stagedOnly ? !file.staged : !file.unstaged) continue
    file.binary = file.binary || item.binary
    if (item.binary) continue
    file.adds = Math.max(file.adds, 0) + item.adds
    file.dels = Math.max(file.dels, 0) + item.dels
  }
}

/** 解析 `git diff --numstat -z`；重命名条目把两条路径放在额外 token 里。 */
export function parseNumstat(text) {
  const tokens = text.split('\u0000')
  const out = []
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (!token) continue
    const parts = token.split('\t')
    if (parts.length < 2) continue
    const addsRaw = parts[0]
    const delsRaw = parts[1]
    let filePath = parts.slice(2).join('\t')
    if (filePath === '') {
      // 重命名/复制：路径在后续两个 token 中
      const oldPath = tokens[i + 1] ?? ''
      const newPath = tokens[i + 2] ?? ''
      i += 2
      filePath = newPath
      out.push({
        path: filePath,
        oldPath,
        adds: addsRaw === '-' ? 0 : Number.parseInt(addsRaw, 10) || 0,
        dels: delsRaw === '-' ? 0 : Number.parseInt(delsRaw, 10) || 0,
        binary: addsRaw === '-' || delsRaw === '-'
      })
      continue
    }
    out.push({
      path: filePath,
      adds: addsRaw === '-' ? 0 : Number.parseInt(addsRaw, 10) || 0,
      dels: delsRaw === '-' ? 0 : Number.parseInt(delsRaw, 10) || 0,
      binary: addsRaw === '-' || delsRaw === '-'
    })
  }
  return out
}

async function numstat(repoRoot, args, signal) {
  const result = await runGit(repoRoot, args, { signal, allowFailure: true })
  if (result.code !== 0) return []
  return parseNumstat(result.stdout.toString('utf8'))
}

// ---------------------------------------------------------------------------
// diff
// ---------------------------------------------------------------------------

/**
 * 单文件 diff。
 * @param {string} repoRoot
 * @param {string} relPath 相对仓库根、正斜杠
 * @param {{staged?:boolean, contextLines?:number, ignoreWhitespace?:boolean, untracked?:boolean, signal?:AbortSignal}} options
 */
export async function readDiff(repoRoot, relPath, options = {}) {
  const {
    staged = false,
    contextLines = 3,
    ignoreWhitespace = false,
    untracked = false,
    signal
  } = options

  const abs = resolveInside(repoRoot, relPath)

  if (untracked) {
    return synthesizeNewFileDiff(abs, relPath, signal)
  }

  const args = ['diff', '--no-color', '--no-ext-diff', '--no-textconv', `-U${clampInt(contextLines, 0, 200, 3)}`]
  if (staged) args.push('--cached')
  if (ignoreWhitespace) args.push('-w')
  args.push('--', relPath)

  let result
  try {
    result = await runGit(repoRoot, args, { signal, timeoutMs: DIFF_TIMEOUT_MS })
  } catch (error) {
    if (error instanceof GitError && error.code === 'aborted') throw error
    return { kind: 'error', hunks: [], stats: { adds: 0, dels: 0 }, message: error.message }
  }

  const text = result.stdout.toString('utf8')
  if (result.truncated) {
    return { kind: 'oversized', hunks: [], stats: { adds: 0, dels: 0 }, message: '差异内容过大，已截断' }
  }
  if (/^GIT binary patch$/m.test(text) || /^Binary files /m.test(text)) {
    return { kind: 'binary', hunks: [], stats: { adds: 0, dels: 0 }, message: '二进制文件，无法显示文本差异' }
  }

  const parsed = parseUnifiedDiff(text)
  if (parsed.hunks.length === 0) {
    const head = await readHead(repoRoot)
    return {
      kind: parsed.isSubmodule ? 'submodule' : 'empty',
      hunks: [],
      stats: { adds: 0, dels: 0 },
      message: parsed.isSubmodule
        ? '子模块指向变更（内部改动需进入子仓库查看）'
        : '该文件在此侧没有内容差异',
      head
    }
  }

  return {
    kind: 'text',
    hunks: parsed.hunks,
    stats: parsed.stats,
    language: languageForPath(relPath),
    oldPath: parsed.oldPath,
    newPath: parsed.newPath,
    modeOnly: parsed.modeOnly,
    renameOnly: parsed.renameOnly
  }
}

/** 未跟踪/新增文件 → 整篇都是新增行的伪 diff。 */
async function synthesizeNewFileDiff(abs, relPath, signal) {
  if (signal?.aborted) throw new GitError('aborted', '操作已取消')
  let info
  try {
    info = await stat(abs)
  } catch {
    return { kind: 'empty', hunks: [], stats: { adds: 0, dels: 0 }, message: '文件不存在' }
  }
  if (info.isDirectory()) {
    return { kind: 'directory', hunks: [], stats: { adds: 0, dels: 0 }, message: '这是一个目录' }
  }
  if (info.size > MAX_TEXT_FILE_BYTES) {
    return { kind: 'oversized', hunks: [], stats: { adds: 0, dels: 0 }, message: '文件过大，未生成差异' }
  }
  const buffer = await readFile(abs)
  if (looksBinary(buffer)) {
    return { kind: 'binary', hunks: [], stats: { adds: 0, dels: 0 }, message: '二进制文件，无法显示文本差异' }
  }
  const text = stripBom(buffer.toString('utf8'))
  const rawLines = text.split('\n')
  if (text.endsWith('\n')) rawLines.pop()
  const lines = rawLines.map((line, index) => ({
    kind: 'add',
    oldLine: undefined,
    newLine: index + 1,
    text: stripTrailingCr(line)
  }))
  return {
    kind: 'text',
    hunks: lines.length === 0 ? [] : [{
      header: `@@ -0,0 +1,${lines.length} @@`,
      section: '',
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: lines.length,
      lines
    }],
    stats: { adds: lines.length, dels: 0 },
    language: languageForPath(relPath),
    newFile: true
  }
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

/** 解析 unified diff 文本为结构化 hunk。 */
export function parseUnifiedDiff(text) {
  const hunks = []
  const stats = { adds: 0, dels: 0 }
  let current = null
  let oldNo = 0
  let newNo = 0
  let isSubmodule = false
  let oldPath = null
  let newPath = null
  let modeOnly = false
  let renameOnly = false

  const lines = text.split('\n')
  for (const rawLine of lines) {
    const line = stripTrailingCr(rawLine)

    const hunk = HUNK_RE.exec(line)
    if (hunk) {
      if (current) hunks.push(finalizeHunk(current))
      oldNo = Number.parseInt(hunk[1], 10)
      newNo = Number.parseInt(hunk[3], 10)
      current = {
        header: line,
        section: hunk[5] || '',
        oldStart: oldNo,
        oldLines: hunk[2] === undefined ? 1 : Number.parseInt(hunk[2], 10),
        newStart: newNo,
        newLines: hunk[4] === undefined ? 1 : Number.parseInt(hunk[4], 10),
        lines: []
      }
      continue
    }

    if (line.startsWith('diff --git ')) {
      if (current) { hunks.push(finalizeHunk(current)); current = null }
      const match = /^diff --git a\/(.*) b\/(.*)$/.exec(line)
      if (match) { oldPath = match[1]; newPath = match[2] }
      continue
    }
    if (line.startsWith('Submodule ') || /^\+Subproject commit /m.test(line)) {
      isSubmodule = true
      continue
    }
    if (line.startsWith('old mode ') || line.startsWith('new mode ')) { modeOnly = true; continue }
    if (line.startsWith('similarity index ') || line.startsWith('rename from ') || line.startsWith('rename to ')) {
      renameOnly = true
      continue
    }
    if (line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')
      || line.startsWith('new file mode ') || line.startsWith('deleted file mode ')
      || line.startsWith('Binary files ') || line.startsWith('Submodule ')
      || line.startsWith('literal ') || line.startsWith('delta ')) {
      continue
    }

    if (!current) continue
    if (line === '') continue

    const marker = line[0]
    if (marker === '\\') {
      const previous = current.lines[current.lines.length - 1]
      if (previous) previous.kind = previous.kind === 'add' || previous.kind === 'del' ? previous.kind : 'ctx'
      if (previous) previous.noNewline = true
      continue
    }
    if (marker === ' ') {
      current.lines.push({ kind: 'ctx', oldLine: oldNo, newLine: newNo, text: line.slice(1) })
      oldNo += 1
      newNo += 1
      continue
    }
    if (marker === '+') {
      current.lines.push({ kind: 'add', oldLine: undefined, newLine: newNo, text: line.slice(1) })
      newNo += 1
      stats.adds += 1
      continue
    }
    if (marker === '-') {
      current.lines.push({ kind: 'del', oldLine: oldNo, newLine: undefined, text: line.slice(1) })
      oldNo += 1
      stats.dels += 1
      continue
    }
    // 已知 marker 之外的文本：当作上下文，避免整段解析崩掉
    current.lines.push({ kind: 'ctx', oldLine: oldNo, newLine: newNo, text: line })
    oldNo += 1
    newNo += 1
  }
  if (current) hunks.push(finalizeHunk(current))

  return { hunks, stats, isSubmodule, oldPath, newPath, modeOnly, renameOnly: renameOnly && hunks.length === 0 }
}

/** 按实际行数校准 hunk 头（git 偶尔省略计数）。 */
function finalizeHunk(hunk) {
  let oldCount = 0
  let newCount = 0
  for (const line of hunk.lines) {
    if (line.kind === 'ctx') { oldCount += 1; newCount += 1 }
    else if (line.kind === 'add') newCount += 1
    else if (line.kind === 'del') oldCount += 1
  }
  if (hunk.oldLines === 0 && oldCount > 0) hunk.oldLines = oldCount
  if (hunk.newLines === 0 && newCount > 0) hunk.newLines = newCount
  return hunk
}

// ---------------------------------------------------------------------------
// 文件读取 / 目录列举
// ---------------------------------------------------------------------------

/** 读取文本文件（浏览模式 / 老版本内容）。 */
export async function readTextFile(absPath, options = {}) {
  const { maxBytes = MAX_TEXT_FILE_BYTES, signal } = options
  if (signal?.aborted) throw new GitError('aborted', '操作已取消')

  let info
  try {
    info = await stat(absPath)
  } catch (error) {
    return { kind: 'missing', size: 0, message: error.code === 'EACCES' ? '没有权限读取该文件' : '文件不存在' }
  }
  if (info.isDirectory()) return { kind: 'directory', size: 0, message: '这是一个目录' }
  if (!info.isFile()) return { kind: 'other', size: 0, message: '不支持预览该类型' }
  if (info.size > maxBytes) {
    return { kind: 'oversized', size: info.size, message: `文件大于 ${Math.round(maxBytes / 1024)} KB，未加载内容` }
  }

  let buffer
  try {
    buffer = await readFile(absPath)
  } catch (error) {
    return { kind: 'error', size: info.size, message: error.code === 'EACCES' ? '没有权限读取该文件' : error.message }
  }
  if (buffer.includes(0)) {
    return { kind: 'binary', size: info.size, message: '二进制文件，无法预览' }
  }

  const rawText = buffer.toString('utf8')
  // 编辑器契约：文本一律 LF 归一（浏览器输入框只承认 \n），换行形式记在 eol 里，保存时还原。
  const text = stripBom(rawText).replace(/\r\n/g, '\n')
  return {
    kind: 'text',
    text,
    size: info.size,
    hash: hashBytes(buffer),
    bom: hasBom(buffer),
    language: languageForPath(absPath),
    eol: detectEol(rawText),
    lines: text.length === 0 ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
  }
}

/** 原始字节的 sha1（保存时的乐观并发校验用）。 */
export function hashBytes(buffer) {
  return createHash('sha1').update(buffer).digest('hex')
}

/**
 * 判断文件的换行形式。
 *
 * 只有"全部换行都是 CRLF"才认为该文件是 CRLF；混合换行按 LF 处理（保存后统一成 LF）。
 * 这是一个确定的取舍：逐行保留混合换行需要额外的元数据与还原逻辑，而混合换行文件极罕见。
 */
function detectEol(rawText) {
  let crlf = 0
  let lf = 0
  for (let index = 0; index < rawText.length; index += 1) {
    if (rawText[index] !== '\n') continue
    if (index > 0 && rawText[index - 1] === '\r') crlf += 1
    else lf += 1
  }
  return crlf > 0 && lf === 0 ? 'crlf' : 'lf'
}

/** UTF-8 BOM 判定。 */
function hasBom(buffer) {
  return buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
}

/**
 * 原子写回文本文件（编辑器保存）。
 *
 * 三条不变量：
 *  1. **不丢别人的改动** —— 保存必须带上"我读到的那份内容"的 sha1，与磁盘当前内容比对；
 *     不一致就抛 `conflict`，由用户显式选择「重新加载」或「覆盖保存」。只有 `force === true`
 *     才跳过校验（那是用户点过覆盖之后的事）。
 *  2. **不产生残文件** —— 同目录临时文件写完再 rename：要么旧内容、要么新内容，不会写一半。
 *  3. **不制造伪 diff** —— 换行（CRLF/LF）与 BOM 按读取时的形式原样还原。
 *
 * @param {string} absPath 绝对路径（已由 resolveInside 校验过在根内）
 * @param {string} text 编辑器内容（统一 `\n`，不含 BOM）
 * @param {{expectedHash?: string|null, force?: boolean, eol?: 'lf'|'crlf', bom?: boolean, signal?: AbortSignal}} options
 * @returns {Promise<{size: number, mtimeMs: number, hash: string}>}
 */
export async function writeTextFile(absPath, text, options = {}) {
  const { expectedHash = null, force = false, eol = 'lf', bom = false, signal } = options
  if (signal?.aborted) throw new GitError('aborted', '操作已取消')

  let info
  try {
    info = await stat(absPath)
  } catch (error) {
    if (error.code === 'ENOENT') throw new GitError('not-found', '文件不存在（可能已被删除或移动）')
    throw new GitError('bad-request', '无法写入该文件：' + error.message)
  }
  if (info.isDirectory()) throw new GitError('not-a-file', '目标是目录，不能作为文件保存')
  if (!info.isFile()) throw new GitError('not-a-file', '不支持写入该类型')

  const current = await readFile(absPath)
  const currentHash = hashBytes(current)
  if (force !== true && currentHash !== expectedHash) {
    throw new GitError('conflict', '文件在磁盘上已被修改，保存会覆盖别人的改动', {
      currentHash,
      expectedHash,
      mtimeMs: info.mtimeMs
    })
  }

  const body = (bom === true ? '\uFEFF' : '') + (eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text)
  const buffer = Buffer.from(body, 'utf8')
  if (buffer.length > MAX_TEXT_FILE_BYTES) {
    throw new GitError('bad-request', `内容大于 ${Math.round(MAX_TEXT_FILE_BYTES / 1024)} KB，拒绝写入`)
  }
  if (signal?.aborted) throw new GitError('aborted', '操作已取消')

  const temp = `${absPath}.dgp-${process.pid}-${randomUUID()}.tmp`
  try {
    await writeFile(temp, buffer, { mode: info.mode & 0o777 })
    await rename(temp, absPath)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw new GitError('write-failed', '写入失败：' + error.message)
  }

  const after = await stat(absPath)
  return { size: buffer.length, mtimeMs: after.mtimeMs, hash: hashBytes(buffer) }
}

/** 列举目录的直接子项。 */
export async function listDirectory(absPath, options = {}) {
  const { limit = MAX_TREE_ENTRIES, signal, showHidden = true } = options
  if (signal?.aborted) throw new GitError('aborted', '操作已取消')
  let dirents
  try {
    dirents = await readdir(absPath, { withFileTypes: true })
  } catch (error) {
    const code = error.code === 'ENOENT' ? 'not-found' : error.code === 'EACCES' ? 'no-permission' : 'list-failed'
    throw new GitError(code, error.code === 'EACCES' ? '没有权限读取该目录' : '无法读取目录：' + error.message)
  }

  const entries = []
  let truncated = false
  for (const dirent of dirents) {
    if (!showHidden && dirent.name.startsWith('.')) continue
    if (entries.length >= limit) { truncated = true; break }
    const type = dirent.isDirectory() ? 'dir' : dirent.isFile() ? 'file' : 'other'
    entries.push({ name: dirent.name, path: dirent.name, type })
  }
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return naturalCompare(a.name, b.name)
  })
  return { entries, truncated }
}

// ---------------------------------------------------------------------------
// 仓库发现（形态②：项目内多个仓库）
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.pnpm', '.venv', 'venv', '__pycache__',
  'dist', 'build', 'out', 'target', 'vendor', '.next', '.nuxt', '.svelte-kit',
  'coverage', '.cache', '.turbo', '.gradle', '.idea', '.vs', 'obj', 'bin',
  'third_party', '.terraform', '.tox', 'site-packages'
])

/**
 * 在项目目录内发现 git 仓库。
 *
 * @param {string} projectRoot
 * @param {{maxDepth?:number, maxRepos?:number, maxDirs?:number, includeRoot?:boolean}} options
 *   includeRoot=false 时把根目录视为「已经单独处理过的仓库」，改为深入其中寻找子仓库
 *   （用于项目根本身就是仓库、但里面还嵌套着其它仓库/子模块的情况）。
 */
export async function discoverRepos(projectRoot, options = {}) {
  const { maxDepth = 3, maxRepos = 24, maxDirs = 4000, includeRoot = true } = options
  const found = []
  const queue = [{ dir: projectRoot, depth: 0 }]
  let visited = 0

  while (queue.length > 0 && found.length < maxRepos && visited < maxDirs) {
    const { dir, depth } = queue.shift()
    visited += 1
    if (hasOwnGitDir(dir)) {
      if (depth > 0 || includeRoot) {
        found.push({ path: normalizeSlashes(dir), depth })
        continue // 不再深入已发现的仓库
      }
      // depth === 0 && !includeRoot：根仓库本身已单独处理，继续往下找嵌套仓库
    }
    if (depth >= maxDepth) continue
    let dirents
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) continue
      if (SKIP_DIRS.has(dirent.name)) continue
      if (dirent.name.startsWith('.')) continue
      queue.push({ dir: path.join(dir, dirent.name), depth: depth + 1 })
    }
  }
  return found
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** 把相对路径解析进 root，并拒绝逃逸。 */
export function resolveInside(root, relPath) {
  const normalizedRoot = path.resolve(root)
  const abs = path.resolve(normalizedRoot, relPath ?? '')
  const rel = path.relative(normalizedRoot, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new GitError('outside-root', '路径不在仓库根目录内：' + relPath)
  }
  if (rel.split(path.sep).includes('.git')) {
    throw new GitError('forbidden-path', '不允许访问 .git 内部路径')
  }
  return abs
}

/** 归一化成绝对路径 + 正斜杠。 */
export function normalizeSlashes(p) {
  if (typeof p !== 'string') return ''
  return p.replace(/\\/g, '/')
}

/** 自然序、忽略大小写的比较（目录/文件名用）。 */
export function naturalCompare(a, b) {
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

function stripTrailingCr(line) {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

function looksBinary(buffer) {
  const probe = buffer.subarray(0, 8000)
  return probe.includes(0)
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

const LANGUAGE_BY_EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  json: 'json', jsonc: 'json', json5: 'json',
  css: 'css', scss: 'scss', less: 'less', sass: 'sass',
  html: 'html', htm: 'html', vue: 'html', svelte: 'html',
  md: 'markdown', markdown: 'markdown', mdx: 'markdown',
  py: 'python', pyi: 'python', ipynb: 'json',
  go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp',
  cs: 'csharp', fs: 'fsharp', vb: 'vb',
  rb: 'ruby', php: 'php', swift: 'swift', m: 'objectivec', mm: 'objectivec',
  sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell', ps1: 'powershell', psm1: 'powershell',
  bat: 'bat', cmd: 'bat',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', env: 'ini',
  xml: 'xml', svg: 'xml', xsl: 'xml', csproj: 'xml', props: 'xml',
  sql: 'sql', graphql: 'graphql', gql: 'graphql',
  lua: 'lua', r: 'r', dart: 'dart', scala: 'scala', clj: 'clojure', ex: 'elixir', exs: 'elixir',
  dockerfile: 'dockerfile', makefile: 'makefile', cmake: 'makefile',
  txt: 'text', log: 'text', csv: 'text', tsv: 'text'
}

const LANGUAGE_BY_NAME = {
  dockerfile: 'dockerfile', makefile: 'makefile', 'cmakelists.txt': 'makefile',
  '.gitignore': 'ini', '.gitattributes': 'ini', '.npmrc': 'ini', '.editorconfig': 'ini',
  '.env': 'ini', 'license': 'text', 'readme': 'markdown'
}

/** 从路径推断语言（供客户端着色与图标）。 */
export function languageForPath(p) {
  const base = path.basename(String(p || '')).toLowerCase()
  if (LANGUAGE_BY_NAME[base]) return LANGUAGE_BY_NAME[base]
  const ext = path.extname(base).slice(1).toLowerCase()
  return LANGUAGE_BY_EXT[ext] || 'text'
}

// ---------------------------------------------------------------------------
// 远端：读地址 / 检测更新（fetch）
// ---------------------------------------------------------------------------

/** fetch 的默认超时：网络操作比本地 git 慢，给足但必须有上限。 */
export const FETCH_TIMEOUT_MS = 30_000

/**
 * 读 origin 的地址（没有配置返回 null）。
 * 只读本地配置，不联网。
 */
export async function readRemoteUrl(repoRoot, options = {}) {
  const { signal } = options
  const result = await runGit(repoRoot, ['config', '--get', 'remote.origin.url'], { signal, allowFailure: true })
  if (result.code !== 0) return null
  const url = result.stdout.toString('utf8').trim()
  return url === '' ? null : url
}

/**
 * 检测更新：`git fetch --prune` 之后重新计算 ahead/behind。
 *
 * 这是**只读**操作：只更新远端跟踪引用（`refs/remotes/*`），不动工作区、不动本地分支、
 * 不做 merge/rebase —— 所以它不属于"版本控制写操作"。认证失败会立刻返回错误
 * （`GIT_TERMINAL_PROMPT=0` + 空 `GIT_ASKPASS`，不会挂住等输入）。
 *
 * @returns {Promise<{url: string, branch: string|null, head: string|null, upstream: string|null, ahead: number, behind: number, fetchedAt: number}>}
 */
export async function fetchRemote(repoRoot, options = {}) {
  const { signal, timeoutMs = FETCH_TIMEOUT_MS } = options
  const url = await readRemoteUrl(repoRoot, { signal })
  if (url === null) throw new GitError('no-remote', '这个仓库没有配置远端（origin）')

  await runGit(repoRoot, ['fetch', '--prune', '--quiet'], { signal, timeoutMs })
  const head = await readHead(repoRoot)
  return { url, ...head, fetchedAt: Date.now() }
}