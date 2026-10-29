/**
 * src/components/DiffView.js —— 右侧 diff 查看器（统一 / 并排）
 *
 * 只负责「把 Hunk[] 画成 DOM」：行几何全部来自 `../util/diff.js`（纯函数、可单测），
 * 这里只做 memo 化、状态分派、词级高亮贴片和无障碍钩子。
 *
 * DOM 结构（与 CONTRACT.md §5 的 class 词汇表一一对应）：
 *
 *   div.dgp-viewer
 *     ├─ div.dgp-viewer-head                 38px：状态字母 / 文件名 / 父路径 / +N −N
 *     └─ div.dgp-scroll[role=region][data-wrap]      ← 真正的滚动容器（overflow:auto）
 *          └─ div.dgp-diff[data-view][data-wrap]
 *               ├─（unified）div.dgp-hunk + div.dgp-diff-row[data-kind] × N
 *               └─（split）  div.dgp-diff-columns
 *                              ├─ div.dgp-diff-col[data-side=old]
 *                              └─ div.dgp-diff-col[data-side=new]
 *
 * 硬约束（Lead 的 styles.css 已按此实现）：
 *   - `.dgp-scroll` 是滚动容器（flex column + overflow:auto），`.dgp-diff` 是它里面的内容块
 *     （`flex:1 1 auto; min-height:0`，与 FileView 的 `.dgp-scroll > .dgp-file` 同构）。
 *     **不要**把两个类放在同一个节点上：`.dgp-diff-col{overflow:hidden}` 会把超长列表裁掉，
 *     导致 split 视图无法纵向滚动。
 *   - `.dgp-diff-row` 是 4 列 grid，所以 unified 行的直接子元素必须是
 *     `.dgp-ln` / `.dgp-ln` / `.dgp-marker` / `.dgp-diff-text` —— **不能**再包一层 `.dgp-diff-gutter`，
 *     否则 grid 列会错位（`.dgp-diff-gutter{display:contents}` 只是兜底）。
 *   - `.dgp-diff-cell` 是 2 列 grid，子元素顺序固定为 `.dgp-ln` + `.dgp-diff-text`。
 *   - `.dgp-hunk-head` 是 flex + 两侧 filler，`.dgp-hunk-section` 必须是它的**子元素**才能同行。
 *   - `+` / `−` 符号由 CSS 的 `::before` 负责，`.dgp-marker` 里只放空内容。
 *   - 行底色/正文色只靠 `data-kind`，diff 行禁止使用 `dgp-add` / `dgp-del` 类（那两个是计数色）。
 */
import { h, useState, useEffect, useMemo, useRef } from '../platform.js'
import { MAX_DIFF_ROWS, buildSplitRows, buildUnifiedRows, budgetRows, diffStats, highlightWordDiff } from '../util/diff.js'
import { basename, dirname } from '../util/paths.js'
import { Icon, StatusLetter } from '../ui/Icon.js'
import { EmptyState, ErrorState, InlineNote, LoadingState } from './States.js'

/** 空 hunk 列表的稳定引用（避免每次渲染都造新数组，把 memo 打穿）。 */
const EMPTY_HUNKS = []

const SIDE_OLD = 'old'
const SIDE_NEW = 'new'

/** 宿主或测试没给 t() 时的降级：原样回显 key，绝不抛错。 */
function missingT(key) {
  return String(key)
}

/** 空/加载/错误态用的图标节点（States.EmptyState 的 icon 是 React 节点）。 */
function stateIcon(name) {
  return h(Icon, { name, size: 16 })
}

/** 取第一个合法数字（diff.stats > entry > 本地统计）。 */
function firstNumber(first, second, fallback) {
  if (typeof first === 'number' && Number.isFinite(first)) return first
  if (typeof second === 'number' && Number.isFinite(second)) return second
  return typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : 0
}

// ---------------------------------------------------------------------------
// 词级高亮：把「配对好的行」标出同一行内的差异片段
// ---------------------------------------------------------------------------

/**
 * unified 视图的行是顺序排列的：一段 del 后面跟一段 add。这里用与 split 相同的
 * run 配对规则（按下标）把 del/add 行配起来，返回 rowIndex → segments 的两张表。
 */
function buildUnifiedMarks(rows) {
  const oldMarks = new Map()
  const newMarks = new Map()
  let delIndexes = []
  let addIndexes = []

  const flush = () => {
    const total = delIndexes.length > addIndexes.length ? delIndexes.length : addIndexes.length
    for (let at = 0; at < total; at += 1) {
      if (at >= delIndexes.length || at >= addIndexes.length) continue
      const delAt = delIndexes[at]
      const addAt = addIndexes[at]
      const pair = highlightWordDiff(rows[delAt].text, rows[addAt].text)
      oldMarks.set(delAt, pair.oldSegments)
      newMarks.set(addAt, pair.newSegments)
    }
    delIndexes = []
    addIndexes = []
  }

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (row.type !== 'line') {
      flush()
      continue
    }
    if (row.kind === 'del') delIndexes.push(index)
    else if (row.kind === 'add') addIndexes.push(index)
    else flush()
  }
  flush()
  return { oldMarks, newMarks }
}

/** split 视图的每一行本身就是一个已配对的 pair，直接按行算即可。 */
function buildSplitMarks(rows) {
  const oldMarks = new Map()
  const newMarks = new Map()
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (row.type !== 'pair') continue
    const left = row.left
    const right = row.right
    if (left === null || left === undefined || right === null || right === undefined) continue
    if (left.kind !== 'del' || right.kind !== 'add') continue
    const pair = highlightWordDiff(left.text, right.text)
    oldMarks.set(index, pair.oldSegments)
    newMarks.set(index, pair.newSegments)
  }
  return { oldMarks, newMarks }
}

// ---------------------------------------------------------------------------
// 行渲染（模块级纯渲染函数，避免每次渲染重建闭包）
// ---------------------------------------------------------------------------

function lineNumberNode(side, line) {
  const text = line === undefined || line === null ? null : String(line)
  return h('span', { className: 'dgp-ln', 'data-side': side }, text)
}

function diffTextNode(text, segments) {
  if (segments === undefined || segments === null || segments.length === 0) {
    return h('span', { className: 'dgp-diff-text' }, text === '' || text === undefined || text === null ? null : text)
  }
  const children = []
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    if (segment.changed) {
      children.push(h('mark', { key: index, className: 'dgp-diff-mark' }, segment.text))
    } else {
      children.push(segment.text)
    }
  }
  return h('span', { className: 'dgp-diff-text' }, children)
}

function hunkNode(row, index, keyBase) {
  const sectionNode = typeof row.section === 'string' && row.section !== ''
    ? h('span', { className: 'dgp-hunk-section' }, row.section)
    : null
  // section 必须放在 head 里面：head 是 flex + 两侧 filler，放外面会掉到第二行
  return h(
    'div',
    { key: keyBase + ':' + index, className: 'dgp-hunk' },
    h('div', { className: 'dgp-hunk-head' }, row.header, sectionNode)
  )
}

/**
 * 统一视图的一行。
 * 注意：直接子元素就是 4 列 grid 的 4 个格子，不包 `.dgp-diff-gutter`。
 */
function unifiedRowNode(row, index, keyBase, marks) {
  let segments
  if (row.kind === 'add') segments = marks.newMarks.get(index)
  else if (row.kind === 'del') segments = marks.oldMarks.get(index)
  return h(
    'div',
    { key: keyBase + ':' + index, className: 'dgp-diff-row', 'data-kind': row.kind },
    lineNumberNode(SIDE_OLD, row.oldLine),
    lineNumberNode(SIDE_NEW, row.newLine),
    h('span', { className: 'dgp-marker', 'aria-hidden': 'true' }),
    diffTextNode(row.text, segments)
  )
}

/** 并排视图某一侧的一行；该侧没有内容时给一个空槽（data-kind="empty"）。 */
function splitSideRowNode(row, index, side, marks, keyBase) {
  const cell = side === SIDE_OLD ? row.left : row.right
  const key = keyBase + ':' + side + ':' + index
  if (cell === null || cell === undefined) {
    return h(
      'div',
      { key, className: 'dgp-diff-row', 'data-kind': 'empty' },
      h('span', { className: 'dgp-diff-cell', 'data-side': side, 'data-kind': 'empty', 'data-empty': 'true' })
    )
  }
  const segments = side === SIDE_OLD ? marks.oldMarks.get(index) : marks.newMarks.get(index)
  return h(
    'div',
    { key, className: 'dgp-diff-row', 'data-kind': cell.kind },
    h(
      'span',
      { className: 'dgp-diff-cell', 'data-side': side, 'data-kind': cell.kind },
      lineNumberNode(side, cell.line),
      diffTextNode(cell.text, segments)
    )
  )
}

/** 截断提示行：说明 + 省略的行数 + 「展开全部」。 */
function truncatedNode(count, key, t, onExpand) {
  return h(
    'div',
    { key, className: 'dgp-diff-truncated' },
    h('span', { className: 'dgp-hint' }, t('viewer.truncated')),
    h('span', { className: 'dgp-meta' }, t('viewer.lines', { count })),
    h(
      'button',
      {
        className: 'dgp-btn',
        'data-size': 'sm',
        'data-variant': 'ghost',
        type: 'button',
        onClick: onExpand
      },
      t('viewer.expandAll')
    )
  )
}

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

/**
 * @param {object} props
 * @param {object|null} props.diff      DiffResult | null
 * @param {boolean} props.loading
 * @param {string|null} props.error
 * @param {string|null} props.path      显示用路径（相对 repoRoot）
 * @param {object|null} props.entry     FileEntry（状态字母 / 重命名前路径 / 计数兜底）
 * @param {'unified'|'split'} props.view
 * @param {boolean} props.wrap
 * @param {Function} props.onRetry
 * @param {Function} props.t
 */
export function DiffView(props) {
  const { diff, loading, error, path, entry, view, wrap, onRetry, t: tProp } = props ?? {}
  const t = typeof tProp === 'function' ? tProp : missingT

  const split = view === 'split'
  const filePath = typeof path === 'string' ? path : ''
  const hasFile = filePath !== '' || (entry !== null && entry !== undefined)
  const hunks = diff !== null && diff !== undefined && Array.isArray(diff.hunks) ? diff.hunks : EMPTY_HUNKS

  const [expanded, setExpanded] = useState(false)
  const scrollRef = useRef(null)

  // 换文件 / 换布局：回到顶部并收起「全部展开」
  useEffect(() => {
    setExpanded(false)
  }, [filePath, view])

  useEffect(() => {
    const element = scrollRef.current
    if (element === null || element === undefined) return
    if (typeof element.scrollTo === 'function') element.scrollTo(0, 0)
    else element.scrollTop = 0
  }, [filePath, view])

  // 行构建 + 预算 + 词级高亮：只依赖 diff / view（以及本地的展开开关）
  const built = useMemo(() => {
    const source = diff !== null && diff !== undefined && Array.isArray(diff.hunks) ? diff.hunks : EMPTY_HUNKS
    const sourceRows = split ? buildSplitRows(source) : buildUnifiedRows(source)
    const budgeted = expanded
      ? { rows: sourceRows, truncatedCount: 0 }
      : budgetRows(sourceRows, MAX_DIFF_ROWS)
    return {
      rows: budgeted.rows,
      truncatedCount: budgeted.truncatedCount,
      marks: split ? buildSplitMarks(budgeted.rows) : buildUnifiedMarks(budgeted.rows)
    }
  }, [diff, view, expanded])

  const computedStats = diffStats(hunks)
  const diffAdds = diff !== null && diff !== undefined && diff.stats ? diff.stats.adds : undefined
  const diffDels = diff !== null && diff !== undefined && diff.stats ? diff.stats.dels : undefined
  const adds = firstNumber(diffAdds, entry ? entry.adds : undefined, computedStats.adds)
  const dels = firstNumber(diffDels, entry ? entry.dels : undefined, computedStats.dels)

  const keyBase = filePath + '|' + (split ? 'split' : 'unified')
  const regionLabel = t(split ? 'toolbar.split' : 'toolbar.unified')

  // ---- 头部：状态字母 + 文件名 + 父路径（+ 重命名来源）+ 计数 ----
  let headNode = null
  if (hasFile) {
    const headChildren = []
    if (entry !== null && entry !== undefined && entry.status) {
      headChildren.push(h(StatusLetter, { key: 'status', status: entry.status }))
    }
    const titleChildren = [
      h('span', { key: 'name', className: 'dgp-name dgp-oneline' }, basename(filePath))
    ]
    const parentPath = dirname(filePath)
    if (parentPath !== '') {
      titleChildren.push(h('span', { key: 'parent', className: 'dgp-viewer-sub dgp-oneline' }, parentPath))
    }
    if (entry !== null && entry !== undefined && typeof entry.oldPath === 'string' && entry.oldPath !== '') {
      titleChildren.push(h(
        'span',
        { key: 'oldPath', className: 'dgp-viewer-sub dgp-oneline' },
        t('viewer.oldPath', { path: entry.oldPath })
      ))
    }
    headChildren.push(h('div', { key: 'title', className: 'dgp-viewer-title' }, titleChildren))
    headChildren.push(h(
      'div',
      { key: 'actions', className: 'dgp-viewer-actions' },
      h('span', { key: 'adds', className: 'dgp-add' }, t('viewer.adds', { count: adds })),
      h('span', { key: 'dels', className: 'dgp-del' }, t('viewer.dels', { count: dels }))
    ))
    headNode = h('div', { className: 'dgp-viewer-head' }, headChildren)
  }

  // ---- 主体：加载 / 错误 / 各种「不能画 diff」的 kind / 正常渲染 ----
  let bodyNode = null

  if (error !== null && error !== undefined && error !== '') {
    bodyNode = h(ErrorState, { message: String(error), onRetry, t })
  } else if (loading === true && (diff === null || diff === undefined)) {
    bodyNode = h(LoadingState, { label: t('status.loadingDiff'), t })
  } else if (diff === null || diff === undefined) {
    bodyNode = h(EmptyState, {
      icon: stateIcon('file-diff'),
      title: t('viewer.placeholderDiff'),
      t
    })
  } else {
    const kind = typeof diff.kind === 'string' ? diff.kind : 'text'
    const message = typeof diff.message === 'string' ? diff.message : ''

    if (kind === 'binary') {
      bodyNode = h(EmptyState, { icon: stateIcon('file'), title: t('viewer.binary'), t })
    } else if (kind === 'oversized') {
      bodyNode = h(EmptyState, {
        icon: stateIcon('file'),
        title: t('viewer.oversized'),
        description: message !== '' ? message : undefined,
        t
      })
    } else if (kind === 'directory') {
      bodyNode = h(EmptyState, { icon: stateIcon('folder'), title: t('viewer.directory'), t })
    } else if (kind === 'submodule') {
      bodyNode = h(EmptyState, { icon: stateIcon('git-merge'), title: t('viewer.submodule'), t })
    } else if (kind === 'error') {
      bodyNode = h(ErrorState, {
        message: message !== '' ? message : t('error.generic', { message: '' }),
        onRetry,
        t
      })
    } else if (kind === 'deleted' && hunks.length === 0) {
      bodyNode = h(EmptyState, { icon: stateIcon('trash'), title: t('viewer.deletedFile'), t })
    } else if (hunks.length === 0) {
      const renamed = entry !== null && entry !== undefined
        && typeof entry.oldPath === 'string' && entry.oldPath !== ''
      let title = t('viewer.noChanges')
      if (renamed) title = t('viewer.renameOnly')
      else if (diff.newFile === true) title = t('viewer.newFile')
      bodyNode = h(EmptyState, {
        icon: stateIcon(diff.newFile === true ? 'plus' : 'file-diff'),
        title,
        description: message !== '' ? message : undefined,
        t
      })
    } else {
      const rows = built.rows
      const content = []

      if (diff.truncated === true) {
        content.push(h(InlineNote, { key: 'host-truncated', tone: 'warn' }, t('viewer.truncated')))
      }
      if (diff.newFile === true) {
        content.push(h(InlineNote, { key: 'new-file', tone: 'info' }, t('viewer.newFile')))
      }

      if (split) {
        const columns = []
        const sides = [SIDE_OLD, SIDE_NEW]
        for (let at = 0; at < sides.length; at += 1) {
          const side = sides[at]
          const cells = []
          for (let index = 0; index < rows.length; index += 1) {
            const row = rows[index]
            if (row.type === 'hunk') cells.push(hunkNode(row, index, keyBase))
            else cells.push(splitSideRowNode(row, index, side, built.marks, keyBase))
          }
          columns.push(h('div', { key: side, className: 'dgp-diff-col', 'data-side': side }, cells))
        }
        content.push(h('div', { key: 'columns', className: 'dgp-diff-columns' }, columns))
      } else {
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index]
          if (row.type === 'hunk') content.push(hunkNode(row, index, keyBase))
          else content.push(unifiedRowNode(row, index, keyBase, built.marks))
        }
      }

      if (built.truncatedCount > 0) {
        content.push(truncatedNode(
          built.truncatedCount,
          'truncated',
          t,
          () => setExpanded(true)
        ))
      }

      bodyNode = h(
        'div',
        {
          className: 'dgp-scroll',
          ref: scrollRef,
          role: 'region',
          'aria-label': regionLabel,
          'aria-busy': loading === true ? 'true' : undefined,
          'data-wrap': wrap === true ? 'true' : undefined
        },
        // .dgp-diff 是滚动容器里的内容块（与 FileView 的 .dgp-scroll > .dgp-file 同构）；
        // data-wrap 同时挂两层，让 `.dgp-diff[data-wrap="true"]` 这类选择器都能命中。
        h(
          'div',
          {
            className: 'dgp-diff',
            'data-view': split ? 'split' : 'unified',
            'data-wrap': wrap === true ? 'true' : undefined
          },
          content
        )
      )
    }
  }

  // 两个子节点分开传（而不是塞进数组），避免 React 要求数组 child 带 key
  return h(
    'div',
    { className: 'dgp-viewer', 'data-dgp-path': filePath !== '' ? filePath : undefined },
    headNode,
    bodyNode
  )
}
