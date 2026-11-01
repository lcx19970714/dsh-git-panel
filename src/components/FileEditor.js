/**
 * src/components/FileEditor.js —— 「文件」模式右栏：可编辑的文本查看器
 *
 * 设计要点（第一性原理：浏览器里编辑文本 = textarea，其余都是它的外壳）：
 *  1. 文本用原生 `<textarea>`：输入法、撤销、选区、剪贴板、无障碍全部由浏览器负责，
 *     不自己实现编辑器内核，也就没有"半套编辑器"的兼容分支。
 *  2. 行号是**独立的一列**，随 textarea 竖向滚动同步；换行（wrap）开启时行号与折行
 *     对不齐，所以那时直接不画行号 —— 不假装对齐。
 *  3. 非文本（二进制/过大/缺失/目录/出错）没有可编辑语义，仍走占位态，不显示输入框。
 *  4. Tab / Shift+Tab / Enter 只做三件事（缩进、反缩进、沿用上一行缩进），
 *     全部通过 `setRangeText` 落到原生输入上，因此**不会破坏原生撤销栈**。
 *  5. 保存的并发安全在宿主侧（内容哈希）；这里只负责把 `expectedHash` 带上，
 *     冲突就交给用户显式选择「重新加载 / 覆盖保存」。
 */
import { h, useMemo, useRef } from '../platform.js'
import { basename, dirname } from '../util/paths.js'
import { formatClock } from '../util/time.js'
import { Icon } from '../ui/Icon.js'
import { EmptyState, ErrorState, InlineNote, LoadingState } from './States.js'

/** 行号最多画这么多行：再多就不画（textarea 自身仍然可以编辑整篇）。 */
const MAX_GUTTER_LINES = 5000
/** 缩进单位。 */
const INDENT = '  '

function isBlank(value) {
  return value === undefined || value === null || value === ''
}

/** 逻辑行数（结尾换行不算多一行）。 */
function countLines(text) {
  if (text === '') return 1
  const breaks = text.split('\n').length
  return text.endsWith('\n') ? breaks - 1 : breaks
}

function formatSize(size) {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return ''
  if (size < 1024) return size + ' B'
  if (size < 1024 * 1024) return (size / 1024).toFixed(size < 10 * 1024 ? 1 : 0) + ' KB'
  return (size / (1024 * 1024)).toFixed(1) + ' MB'
}

/* ------------------------------ 编辑动作 ------------------------------ */

/** 选区覆盖到的整行范围 [from, to)。 */
function lineRange(value, start, end) {
  const from = value.lastIndexOf('\n', start - 1) + 1
  const found = value.indexOf('\n', end)
  return { from, to: found === -1 ? value.length : found }
}

/**
 * 缩进 / 反缩进选区覆盖的所有行，并把选区一起平移。
 * 一次性替换整块，避免多次 setRangeText 把撤销栈切碎。
 */
function indentBlock(node, onChange, outdent) {
  const { selectionStart, selectionEnd, value } = node
  const { from, to } = lineRange(value, selectionStart, selectionEnd)
  const block = value.slice(from, to)
  let firstDelta = 0
  let totalDelta = 0
  const next = block.split('\n').map((row, index) => {
    let delta = INDENT.length
    let text = INDENT + row
    if (outdent) {
      const removed = row.startsWith(INDENT) ? INDENT.length : (row.startsWith(' ') ? 1 : 0)
      delta = -removed
      text = row.slice(removed)
    }
    if (index === 0) firstDelta = delta
    totalDelta += delta
    return text
  }).join('\n')

  if (next === block) return
  node.setRangeText(next, from, to, 'preserve')
  node.setSelectionRange(
    Math.max(from, selectionStart + firstDelta),
    Math.max(from, selectionEnd + totalDelta)
  )
  onChange(node.value)
}

/** 回车：沿用当前行的前导空白。 */
function insertNewline(node, onChange) {
  const { selectionStart, selectionEnd, value } = node
  const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
  const leading = /^[ \t]*/.exec(value.slice(lineStart, selectionStart))[0]
  node.setRangeText('\n' + leading, selectionStart, selectionEnd, 'end')
  onChange(node.value)
}

/* ------------------------------ 占位态 ------------------------------ */

/** 不可编辑的读取结果 → 占位态（二进制 / 过大 / 缺失 / 目录 / 出错）。 */
function placeholderFor(record, kind, sizeText, relPath, onRetry, t) {
  if (kind === 'binary' || kind === 'oversized') {
    return h(EmptyState, {
      icon: 'file',
      title: t(kind === 'binary' ? 'viewer.binary' : 'viewer.oversized'),
      description: isBlank(sizeText) ? undefined : sizeText,
      t
    })
  }
  if (kind === 'directory') {
    return h(EmptyState, { icon: 'folder', title: t('viewer.directory'), t })
  }
  if (kind === 'missing') {
    return h(EmptyState, {
      icon: 'warning',
      title: t('viewer.missing'),
      description: isBlank(relPath) ? undefined : relPath,
      actions: retryAction(t, onRetry),
      t
    })
  }
  const message = record !== null && typeof record.message === 'string' && record.message !== ''
    ? record.message
    : t('viewer.placeholder')
  if (kind === 'error') return h(ErrorState, { message, onRetry, t })
  return h(EmptyState, {
    icon: 'info',
    title: message,
    description: isBlank(sizeText) ? undefined : sizeText,
    actions: retryAction(t, onRetry),
    t
  })
}

function retryAction(t, onRetry) {
  return h('button', {
    type: 'button',
    className: 'dgp-btn',
    'data-variant': 'ghost',
    'data-size': 'sm',
    'data-action': 'retry',
    onClick: onRetry
  }, h(Icon, { name: 'refresh', size: 14 }), t('action.retry'))
}

/* ------------------------------ 组件 ------------------------------ */

export function FileEditor(props) {
  const {
    record, loading, error, path: relPath, wrap,
    dirty, busy, conflict, savedAt, saveError,
    onChange, onSave, onReload, onOverwrite, onRetry, t
  } = props

  const inputRef = useRef(null)
  const gutterRef = useRef(null)

  // 编辑器显示的内容：优先用草稿（props.text），没有草稿才退回磁盘内容
  const providedText = props.text
  const text = typeof providedText === 'string'
    ? providedText
    : (record !== null && typeof record.text === 'string' ? record.text : null)
  const kind = record === null ? null : (typeof record.kind === 'string' ? record.kind : 'text')
  const name = relPath !== '' && relPath !== undefined ? basename(relPath) : ''
  const parent = relPath !== '' && relPath !== undefined ? dirname(relPath) : ''
  const sizeText = formatSize(record === null ? 0 : record.size)
  const lineCount = useMemo(() => (text === null ? 0 : countLines(text)), [text])
  const showGutter = wrap !== true && text !== null && lineCount <= MAX_GUTTER_LINES
  const gutterNumbers = useMemo(() => {
    if (showGutter !== true) return null
    const numbers = []
    for (let index = 1; index <= lineCount; index += 1) numbers.push(index)
    return numbers
  }, [showGutter, lineCount])

  const editable = text !== null && Boolean(loading) !== true && isBlank(error)

  const subParts = []
  if (text !== null && record !== null && typeof record.language === 'string' && record.language !== 'text') {
    subParts.push(record.language)
  }
  if (text !== null) subParts.push(t('viewer.lines', { count: lineCount }))
  if (!isBlank(sizeText)) subParts.push(sizeText)

  const head = h('div', { className: 'dgp-viewer-head' },
    name === '' ? null : h('span', { className: 'dgp-viewer-title' }, name),
    parent === '' ? null : h('span', { className: 'dgp-sub' }, parent),
    h('span', { className: 'dgp-spacer' }),
    subParts.length === 0 ? null : h('span', { className: 'dgp-viewer-sub' }, subParts.join(' \u00b7 ')),
    dirty === true
      ? h('span', { className: 'dgp-dirty', 'data-dirty': 'true', title: t('editor.unsaved') },
        h('span', { className: 'dgp-dirty-dot', 'aria-hidden': 'true' }), t('editor.unsaved'))
      : (savedAt > 0
        ? h('span', { className: 'dgp-editor-saved' }, t('editor.saved', { time: formatClock(savedAt) }))
        : null),
    h('button', {
      type: 'button',
      className: 'dgp-btn',
      'data-size': 'sm',
      'data-action': 'save',
      disabled: dirty !== true || busy === true,
      title: t('editor.save'),
      onClick: onSave
    }, t('editor.save')))

  const conflictBar = conflict === null || conflict === undefined
    ? null
    : h('div', { className: 'dgp-errorbar', 'data-conflict': 'true' },
      h(InlineNote, { tone: 'warn' }, t('editor.conflict')),
      h('button', {
        type: 'button',
        className: 'dgp-btn',
        'data-size': 'sm',
        'data-action': 'reload',
        onClick: onReload
      }, t('editor.reload')),
      h('button', {
        type: 'button',
        className: 'dgp-btn',
        'data-size': 'sm',
        'data-tone': 'danger',
        'data-action': 'overwrite',
        onClick: onOverwrite
      }, t('editor.overwrite')))

  const saveErrorBar = isBlank(saveError)
    ? null
    : h('div', { className: 'dgp-errorbar' },
      h(InlineNote, { tone: 'error' }, String(saveError)),
      h('button', {
        type: 'button',
        className: 'dgp-btn',
        'data-size': 'sm',
        onClick: onSave
      }, t('action.retry')))

  let body = null
  if (Boolean(loading)) {
    body = h(LoadingState, { label: t('status.loading'), t })
  } else if (!isBlank(error)) {
    body = h(ErrorState, { message: String(error), onRetry, t })
  } else if (record === null) {
    body = h(EmptyState, {
      icon: 'file',
      title: t('viewer.placeholder'),
      description: isBlank(relPath) ? undefined : relPath,
      t
    })
  } else if (kind !== 'text') {
    body = placeholderFor(record, kind, sizeText, relPath, onRetry, t)
  } else {
    body = h('div', { className: 'dgp-editor', 'data-wrap': wrap === true ? 'true' : 'false' },
      showGutter
        ? h('div', { className: 'dgp-editor-gutter', ref: gutterRef, 'aria-hidden': 'true' },
          gutterNumbers.map((number) => h('div', { key: number, className: 'dgp-editor-ln' }, String(number))))
        : null,
      h('textarea', {
        ref: inputRef,
        className: 'dgp-editor-input',
        value: text,
        spellCheck: false,
        autoCapitalize: 'off',
        autoCorrect: 'off',
        wrap: wrap === true ? 'soft' : 'off',
        'data-role': 'editor',
        'aria-label': name === '' ? t('viewer.placeholder') : name,
        onChange: (event) => onChange(event.target.value),
        onScroll: (event) => {
          if (gutterRef.current !== null) gutterRef.current.scrollTop = event.target.scrollTop
        },
        onKeyDown: (event) => {
          const node = event.currentTarget
          if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === 's' || event.key === 'S')) {
            event.preventDefault()
            if (dirty === true && busy !== true) onSave()
            return
          }
          if (event.key === 'Tab') {
            event.preventDefault()
            indentBlock(node, onChange, event.shiftKey === true)
            return
          }
          if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault()
            insertNewline(node, onChange)
          }
        }
      }))
  }

  return h('div', {
    className: 'dgp-viewer dgp-viewer-editor',
    'data-editable': editable ? 'true' : 'false'
  }, head, conflictBar, saveErrorBar, body)
}

