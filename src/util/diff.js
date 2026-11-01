/**
 * src/util/diff.js —— diff 的纯函数层（无 react / 无 DOM）
 *
 * 输入是 Host 侧 `parseUnifiedDiff()` 产出的 `Hunk[]`（形状见 CONTRACT.md §2）：
 *
 *   Hunk = { header, section, oldStart, oldLines, newStart, newLines,
 *            lines: DiffLine[] }
 *   DiffLine = { kind: 'add'|'del'|'ctx', oldLine?, newLine?, text, noNewline? }
 *
 * 这一层只做「hunk → 行数组」的几何变换，渲染（React）与样式都在 DiffView.js。
 * 全部函数都是纯函数、对空值/缺字段宽容，可以直接在 Node 里单测（test/diff.test.mjs）。
 */

/** 全局行预算：一次渲染最多画这么多行，防止超大 patch 冻住浏览器。 */
export const MAX_DIFF_ROWS = 5000

/** 词级高亮的单行字符上限；超过则整行标记为 changed（不做逐字比对，保证 O(n)）。 */
export const MAX_WORD_DIFF_CHARS = 2000

// ---------------------------------------------------------------------------
// 内部小工具
// ---------------------------------------------------------------------------

/**
 * 像不像一个 hunk：有 lines 数组，或至少有非空 header。
 * 用来把 null / 数字 / 空对象这类脏数据挡在外面，而不是渲染出一个假的 hunk 头。
 */
function isHunkLike(value) {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value.lines)) return true
  return typeof value.header === 'string' && value.header !== ''
}

/** 把各种可能的行类型写法归一化成 add | del | ctx | nonewline。 */
function normalizeKind(kind) {
  if (kind === 'add' || kind === '+' || kind === 'insert') return 'add'
  if (kind === 'del' || kind === '-' || kind === 'delete' || kind === 'remove') return 'del'
  if (kind === 'nonewline' || kind === 'no-newline' || kind === 'noNewline') return 'nonewline'
  // 'ctx' / 'context' / ' ' / 未知值 一律当上下文，保证解析异常时不丢行
  return 'ctx'
}

/** 转整数，失败给 0（hunk 头缺字段时用）。 */function asInteger(value) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? Math.trunc(number) : 0
}

/** 行号：合法数字就用它，否则退回游标（缺 oldLine/newLine 时的兜底）。 */
function asLineNumber(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  return fallback
}

/** 正文：null/undefined → ''，并去掉行尾的 CR（Host 可能留下 CRLF 的 \r）。 */
function asText(value) {
  if (value === undefined || value === null) return ''
  const text = String(value)
  return text.charCodeAt(text.length - 1) === 13 ? text.slice(0, -1) : text
}

/**
 * 拆 hunk 头：`@@ -a,b +c,d @@ section` → { header: '@@ -a,b +c,d @@', section: 'section' }。
 * Host 的 `header` 是整行（含 section），这里必须拆开，否则 UI 上会重复显示一次 section。
 */
function splitHeader(hunk) {
  const raw = typeof hunk.header === 'string' ? hunk.header : ''
  const close = raw.indexOf(' @@')
  let head = raw
  let tail = ''
  if (close !== -1) {
    head = raw.slice(0, close + 3)
    tail = raw.slice(close + 3).trim()
  }
  if (head === '') {
    head = '@@ -' + asInteger(hunk.oldStart) + ',' + asInteger(hunk.oldLines)
      + ' +' + asInteger(hunk.newStart) + ',' + asInteger(hunk.newLines) + ' @@'
  }
  const section = typeof hunk.section === 'string' && hunk.section !== '' ? hunk.section : tail
  return { header: head, section }
}

/**
 * 把一个 hunk 的 lines 走一遍，补全行号、剔除 `\ No newline at end of file` 标记行。
 * 返回 [{ kind, oldLine, newLine, text, noNewline }]，顺序与 git 输出一致。
 *
 * 行号策略：优先用 Host 给的 oldLine/newLine；缺字段时用 hunk 头 + 游标推算，
 * 这样一个字段缺失的 hunk 也不会出现「整列空号」。
 */
function hunkLines(hunk) {
  const entries = []
  if (!hunk || typeof hunk !== 'object') return entries
  const lines = Array.isArray(hunk.lines) ? hunk.lines : []
  let oldNo = asInteger(hunk.oldStart)
  let newNo = asInteger(hunk.newStart)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line || typeof line !== 'object') continue
    const kind = normalizeKind(line.kind)

    // `\ No newline at end of file` 不是内容行：标记挂到上一行上，不单独成行
    if (kind === 'nonewline') {
      const previous = entries.length > 0 ? entries[entries.length - 1] : null
      if (previous !== null) previous.noNewline = true
      continue
    }

    const text = asText(line.text)
    const marked = line.noNewline === true

    if (kind === 'add') {
      const newLine = asLineNumber(line.newLine, newNo)
      newNo = newLine + 1
      entries.push({ kind: 'add', oldLine: undefined, newLine, text, noNewline: marked })
      continue
    }
    if (kind === 'del') {
      const oldLine = asLineNumber(line.oldLine, oldNo)
      oldNo = oldLine + 1
      entries.push({ kind: 'del', oldLine, newLine: undefined, text, noNewline: marked })
      continue
    }
    const oldLine = asLineNumber(line.oldLine, oldNo)
    const newLine = asLineNumber(line.newLine, newNo)
    oldNo = oldLine + 1
    newNo = newLine + 1
    entries.push({ kind: 'ctx', oldLine, newLine, text, noNewline: marked })
  }
  return entries
}

/** 并列视图的一个格子；side 空缺时由调用方写 null。 */
function makeCell(kind, line, text, noNewline) {
  return { kind, line, text, noNewline: noNewline === true }
}

// ---------------------------------------------------------------------------
// 统一视图
// ---------------------------------------------------------------------------

/**
 * hunk 列表 → 统一视图的扁平行数组。
 *
 * Row = { type:'hunk', header, section }
 *     | { type:'line', kind:'add'|'del'|'ctx', oldLine, newLine, text, noNewline }
 *
 * @param {Array<object>|null|undefined} hunks
 * @returns {Array<object>}
 */
export function buildUnifiedRows(hunks) {
  const rows = []
  const list = Array.isArray(hunks) ? hunks : []
  for (let index = 0; index < list.length; index += 1) {
    const hunk = list[index]
    if (!isHunkLike(hunk)) continue
    const head = splitHeader(hunk)
    rows.push({ type: 'hunk', header: head.header, section: head.section })
    const entries = hunkLines(hunk)
    for (let at = 0; at < entries.length; at += 1) {
      const entry = entries[at]
      rows.push({
        type: 'line',
        kind: entry.kind,
        oldLine: entry.oldLine,
        newLine: entry.newLine,
        text: entry.text,
        noNewline: entry.noNewline
      })
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// 并列视图
// ---------------------------------------------------------------------------

/**
 * 把一个 hunk 的改动块配对成「左/右」行。
 *
 * 算法（与 DSH 自己的 FileDiff.splitRows 对齐）：
 *   1. 顺序扫行，连续的 del 收集成 del-run、连续的 add 收集成 add-run；
 *   2. 遇到 ctx 或 hunk 结束就 flush：两个 run 按**下标**逐行配对，长的一边多出的行另一侧补 null；
 *   3. ctx 行直接生成左右同文、各自行号的配对。
 *
 * 所以 `-a -b -c +x` 会得到三行：(-a,+x)、(-b,null)、(-c,null)，而不是把 -c 和 +x 错位。
 *
 * @param {object|null|undefined} hunk
 * @returns {Array<{left: object|null, right: object|null}>} cell = { kind, line, text, noNewline }
 */
export function pairChangedRuns(hunk) {
  const pairs = []
  const dels = []
  const adds = []

  const flush = () => {
    const total = dels.length > adds.length ? dels.length : adds.length
    for (let at = 0; at < total; at += 1) {
      const left = at < dels.length ? dels[at] : null
      const right = at < adds.length ? adds[at] : null
      pairs.push({ left, right })
    }
    dels.length = 0
    adds.length = 0
  }

  const entries = hunkLines(hunk)
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (entry.kind === 'add') {
      adds.push(makeCell('add', entry.newLine, entry.text, entry.noNewline))
      continue
    }
    if (entry.kind === 'del') {
      dels.push(makeCell('del', entry.oldLine, entry.text, entry.noNewline))
      continue
    }
    flush()
    pairs.push({
      left: makeCell('ctx', entry.oldLine, entry.text, entry.noNewline),
      right: makeCell('ctx', entry.newLine, entry.text, entry.noNewline)
    })
  }
  flush()
  return pairs
}

/**
 * hunk 列表 → 并列视图的行数组。
 *
 * Row = { type:'hunk', header, section }
 *     | { type:'pair', left: {kind,line,text}|null, right: {kind,line,text}|null }
 *
 * @param {Array<object>|null|undefined} hunks
 * @returns {Array<object>}
 */
export function buildSplitRows(hunks) {
  const rows = []
  const list = Array.isArray(hunks) ? hunks : []
  for (let index = 0; index < list.length; index += 1) {
    const hunk = list[index]
    if (!isHunkLike(hunk)) continue
    const head = splitHeader(hunk)
    rows.push({ type: 'hunk', header: head.header, section: head.section })
    const pairs = pairChangedRuns(hunk)
    for (let at = 0; at < pairs.length; at += 1) {
      const pair = pairs[at]
      rows.push({ type: 'pair', left: pair.left, right: pair.right })
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// 词级高亮
// ---------------------------------------------------------------------------

/**
 * 一段文本切成 [{ text, changed }]：去掉公共前后缀，把中间那段标成 changed。
 * 不做 LCS，代价 O(n)；超过 MAX_WORD_DIFF_CHARS 的行直接整行 changed，避免长行卡死。
 *
 * @param {string|null|undefined} oldText
 * @param {string|null|undefined} newText
 * @returns {{oldSegments: Array<{text: string, changed: boolean}>,
 *            newSegments: Array<{text: string, changed: boolean}>}}
 */
export function highlightWordDiff(oldText, newText) {
  const before = asText(oldText)
  const after = asText(newText)

  if (before.length > MAX_WORD_DIFF_CHARS || after.length > MAX_WORD_DIFF_CHARS) {
    return {
      oldSegments: before === '' ? [] : [{ text: before, changed: true }],
      newSegments: after === '' ? [] : [{ text: after, changed: true }]
    }
  }

  const shortest = before.length < after.length ? before.length : after.length
  let prefix = 0
  while (prefix < shortest && before.charCodeAt(prefix) === after.charCodeAt(prefix)) prefix += 1

  const ceiling = shortest - prefix
  let suffix = 0
  while (
    suffix < ceiling
    && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)
  ) {
    suffix += 1
  }

  const beforeMiddle = before.length - prefix - suffix
  const afterMiddle = after.length - prefix - suffix
  return {
    oldSegments: segmentsOf(before, prefix, beforeMiddle),
    newSegments: segmentsOf(after, prefix, afterMiddle)
  }
}

/** 按 [prefix, middle, rest] 三段切（空段不产出）。 */
function segmentsOf(text, prefixLength, middleLength) {
  const segments = []
  if (prefixLength > 0) segments.push({ text: text.slice(0, prefixLength), changed: false })
  if (middleLength > 0) {
    segments.push({ text: text.slice(prefixLength, prefixLength + middleLength), changed: true })
  }
  const rest = text.slice(prefixLength + middleLength)
  if (rest !== '') segments.push({ text: rest, changed: false })
  return segments
}

// ---------------------------------------------------------------------------
// 统计 / 预算
// ---------------------------------------------------------------------------

/**
 * 统计新增/删除行数。`\ No newline` 标记行、未知 kind 都不计数。
 * @param {Array<object>|null|undefined} hunks
 * @returns {{adds: number, dels: number}}
 */
export function diffStats(hunks) {
  const stats = { adds: 0, dels: 0 }
  const list = Array.isArray(hunks) ? hunks : []
  for (let index = 0; index < list.length; index += 1) {
    const hunk = list[index]
    if (!hunk || typeof hunk !== 'object') continue
    const lines = Array.isArray(hunk.lines) ? hunk.lines : []
    for (let at = 0; at < lines.length; at += 1) {
      const line = lines[at]
      if (!line || typeof line !== 'object') continue
      const kind = normalizeKind(line.kind)
      if (kind === 'add') stats.adds += 1
      else if (kind === 'del') stats.dels += 1
    }
  }
  return stats
}

/**
 * 按全局行预算裁剪行数组。
 *
 * 规则：
 *   - 以 **整个 hunk** 为单位保留：一个 hunk 放不下就整块丢弃，绝不把 hunk 从中间切开，
 *     以免并列视图（buildSplitRows）的配对在截断处错位；
 *   - 唯一的例外：第一个 hunk 本身就超过预算时（例如 10k 行的纯新增文件只有一个 hunk），
 *     为了不出现「一片空白 + 已截断」的页面，退化为在**行边界**上截取前 budget 行。
 *     行是原子的（split 的每一行已经是一对），因此在行边界截断不会撕裂配对；
 *   - 返回被丢弃的行数，供 DiffView 显示 `.dgp-diff-truncated` 提示。
 *
 * @param {Array<object>|null|undefined} rows 已经构建好的行（unified 或 split）
 * @param {number} [budget] 默认 MAX_DIFF_ROWS
 * @returns {{rows: Array<object>, truncatedCount: number}}
 */
export function budgetRows(rows, budget) {
  const list = Array.isArray(rows) ? rows : []
  const limit = typeof budget === 'number' && Number.isFinite(budget)
    ? Math.max(0, Math.floor(budget))
    : MAX_DIFF_ROWS

  if (list.length <= limit) return { rows: list, truncatedCount: 0 }
  if (limit === 0) return { rows: [], truncatedCount: list.length }

  const kept = []
  let cursor = 0
  while (cursor < list.length) {
    const start = cursor
    cursor += 1
    // 一个 hunk = hunk 行 + 后续所有非 hunk 行；裸行（没有 hunk 头）自成一组
    while (cursor < list.length && list[cursor] && list[cursor].type !== 'hunk') cursor += 1
    const size = cursor - start
    if (kept.length + size > limit) break
    for (let at = start; at < cursor; at += 1) kept.push(list[at])
  }

  if (kept.length === 0) {
    // 第一个 hunk 就超预算：只能在行边界上截断（见函数注释的例外条款）
    const head = list.slice(0, limit)
    return { rows: head, truncatedCount: list.length - head.length }
  }
  return { rows: kept, truncatedCount: list.length - kept.length }
}
