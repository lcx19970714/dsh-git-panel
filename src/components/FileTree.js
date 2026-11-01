/**
 * src/components/FileTree.js —— 「文件」模式的浏览树（懒加载）
 *
 * 结构（与 src/styles.js 的 `.dgp-*` 选择器一一对应）：
 *
 *   div.dgp-list[role=tree]                    ← 滚动容器 + 键盘焦点
 *   └─ ul.dgp-level[role=none]
 *      └─ li.dgp-item[role=treeitem][aria-level]
 *         └─ button.dgp-row[data-kind=dir|file][data-active][data-cursor]
 *
 * 每个目录只在第一次展开时调用 `loadDir(relPath, signal)`；结果按 `relPath` 缓存在 useRef(Map) 里，
 * 每个请求一个 AbortController：根切换 / 卸载时全部 abort，晚到的响应不会再写回缓存。
 *
 * 注意：`onFilterChange` 由 Panel 消费（它渲染筛选输入框），这里只读 `filter`。
 */
import { h, useEffect, useMemo, useRef, useState } from '../platform.js'
import { Icon } from '../ui/Icon.js'
import { basename, matchesFilter, parentChain } from '../util/paths.js'
import { childPath, orderTreeEntries } from '../util/changes.js'
import { describeError } from '../api.js'
import { EmptyState, InlineNote } from './States.js'

/** props.t 缺失时的兜底（本地字典，永不返回 undefined）。 */

/** 某个 key 是否真的在字典里（宿主/本地字典都没有时会回显 key 本身）。 */
function hasKey(translate, key) {
  return translate(key) !== key
}

function messageOf(error, translate) {
  try {
    const text = describeError(error, translate)
    if (typeof text === 'string' && text !== '') return text
  } catch {
    /* describeError 不该抛，兜底继续 */
  }
  return translate('error.generic', { message: '' })
}

export function FileTree(props) {
  const source = props === null || props === undefined ? {} : props
  const rootPath = typeof source.rootPath === 'string' && source.rootPath !== '' ? source.rootPath : null
  const selectedPath = typeof source.selectedPath === 'string' && source.selectedPath !== ''
    ? source.selectedPath
    : null
  const filter = typeof source.filter === 'string' ? source.filter : ''
  const onSelectFile = typeof source.onSelectFile === 'function' ? source.onSelectFile : null
  const loadDir = typeof source.loadDir === 'function' ? source.loadDir : null
  const translate = source.t
  /** 有未保存改动的文件路径集合（文件模式编辑器草稿）。 */
  const dirtyPaths = source.dirtyPaths instanceof Set ? source.dirtyPaths : null

  const hasRoot = rootPath !== null

  /** relPath -> { status:'loading'|'ok'|'failed', entries, truncated, message } */
  const levelsRef = useRef(new Map())
  /** relPath -> AbortController */
  const controllersRef = useRef(new Map())
  /** 根切换的世代号：晚到的响应据此丢弃。 */
  const generationRef = useRef(0)
  const rootRef = useRef(rootPath)
  const rowRefs = useRef([])
  const wantFocusRef = useRef(false)

  const [tick, setTick] = useState(0)
  const [expanded, setExpanded] = useState(() => new Set())
  const [cursor, setCursor] = useState(-1)

  const bump = () => setTick((value) => value + 1)

  /* ------------------------------ 取目录 ------------------------------ */

  function request(relPath) {
    const key = typeof relPath === 'string' ? relPath : ''
    const cached = levelsRef.current.get(key)
    if (cached !== undefined && (cached.status === 'loading' || cached.status === 'ok')) return
    if (loadDir === null) {
      levelsRef.current.set(key, { status: 'failed', entries: [], truncated: false, message: messageOf(null, translate) })
      bump()
      return
    }

    const previous = controllersRef.current.get(key)
    if (previous !== undefined && previous !== null && typeof previous.abort === 'function') {
      try {
        previous.abort()
      } catch {
        /* 忽略 */
      }
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    if (controller !== null) controllersRef.current.set(key, controller)
    const generation = generationRef.current
    const rootAtRequest = rootPath
    levelsRef.current.set(key, { status: 'loading', entries: [], truncated: false, message: null })
    bump()

    let pending
    try {
      pending = loadDir(key, controller === null ? undefined : controller.signal)
    } catch (error) {
      pending = Promise.reject(error)
    }

    Promise.resolve(pending).then((result) => {
      if (generation !== generationRef.current) return
      if (rootRef.current !== rootAtRequest) return
      if (controller !== null && controller.signal.aborted) return
      const entries = result !== null && result !== undefined && Array.isArray(result.entries)
        ? result.entries
        : []
      levelsRef.current.set(key, {
        status: 'ok',
        entries,
        truncated: result !== null && result !== undefined && result.truncated === true,
        message: null
      })
      controllersRef.current.delete(key)
      bump()
    }, (error) => {
      if (generation !== generationRef.current) return
      if (rootRef.current !== rootAtRequest) return
      if (controller !== null && controller.signal.aborted) return
      levelsRef.current.set(key, {
        status: 'failed',
        entries: [],
        truncated: false,
        message: messageOf(error, translate)
      })
      controllersRef.current.delete(key)
      bump()
    })
  }

  /* ------------------------------ 副作用 ------------------------------ */

  // 根变化：清缓存、abort 全部在途请求、重新读根目录；卸载时同样 abort。
  useEffect(() => {
    generationRef.current += 1
    rootRef.current = rootPath
    for (const controller of controllersRef.current.values()) {
      if (controller !== null && controller !== undefined && typeof controller.abort === 'function') {
        try {
          controller.abort()
        } catch {
          /* 忽略 */
        }
      }
    }
    controllersRef.current.clear()
    levelsRef.current.clear()
    setExpanded(new Set())
    setCursor(-1)
    if (hasRoot) request('')
    else setTick((value) => value + 1)
    return () => {
      generationRef.current += 1
      for (const controller of controllersRef.current.values()) {
        if (controller !== null && controller !== undefined && typeof controller.abort === 'function') {
          try {
            controller.abort()
          } catch {
            /* 忽略 */
          }
        }
      }
      controllersRef.current.clear()
      levelsRef.current.clear()
    }
    // eslint-disable-next-line -- 只跟随根变化
  }, [rootPath])

  // 任何「已展开但还没缓存」的目录都在渲染后补一次请求（展开、自动展开、重试都走这里）。
  useEffect(() => {
    if (!hasRoot || loadDir === null) return
    for (const dirPath of expanded) {
      if (dirPath === '') continue
      if (!levelsRef.current.has(dirPath)) request(dirPath)
    }
  })

  // 外部改 selectedPath 时，把它的祖先链展开（缺失的层级由上一条副作用加载）。
  useEffect(() => {
    if (!hasRoot || selectedPath === null) return
    const ancestors = parentChain(selectedPath)
    if (ancestors.length === 0) return
    setExpanded((previous) => {
      let next = null
      for (const dirPath of ancestors) {
        if (previous.has(dirPath)) continue
        if (next === null) next = new Set(previous)
        next.add(dirPath)
      }
      return next === null ? previous : next
    })
  }, [rootPath, selectedPath, hasRoot])

  /* ------------------------------ 行模型 ------------------------------ */

  /**
   * 过滤判定：条目自身（名字 / 根相对路径）命中，或**已加载**的子项里有命中
   * （这样 `src/app.js` 命中时祖先目录 `src` 仍然显示，用户能点进去）。
   * 只看已加载的层级，不做服务端搜索。
   */
  function entryMatches(relPath, entry, guard) {
    const depth = typeof guard === 'number' ? guard : 0
    if (depth > 64) return false
    const rel = childPath(relPath, entry)
    const name = entry !== null && entry !== undefined && typeof entry.name === 'string' ? entry.name : ''
    if (matchesFilter(rel, filter) || matchesFilter(name, filter)) return true
    if (entry === null || entry === undefined || entry.type !== 'dir') return false
    const level = levelsRef.current.get(rel)
    if (level === undefined || level.status !== 'ok' || !Array.isArray(level.entries)) return false
    return level.entries.some((child) => entryMatches(rel, child, depth + 1))
  }

  /**
   * 把「已加载 + 已展开」的部分压成一个扁平行数组（深度优先）。
   * 不在 tree 里做虚拟列表：单侧栏规模下扁平数组最简单，也最好做键盘走查。
   */
  function collectLevel(relPath, depth, out) {
    const level = levelsRef.current.get(relPath)
    const baseKey = relPath === '' ? 'root' : relPath
    if (level === undefined || level.status === 'loading') {
      out.push({ kind: 'note', key: baseKey + ':loading', tone: 'info', text: translate('status.loading'), depth })
      return
    }
    if (level.status === 'failed') {
      out.push({ kind: 'note', key: baseKey + ':failed', tone: 'error', text: level.message, depth })
      return
    }

    const all = Array.isArray(level.entries) ? level.entries : []
    const visible = filter === '' ? all : all.filter((entry) => entryMatches(relPath, entry))
    const ordered = orderTreeEntries(visible)

    if (ordered.length === 0) {
      let text = null
      if (filter !== '') text = translate('status.emptyFilter', { filter })
      else if (hasKey(translate, 'status.emptyDir')) text = translate('status.emptyDir')
      if (text !== null) out.push({ kind: 'note', key: baseKey + ':empty', tone: 'info', text, depth })
    }

    for (const entry of ordered) {
      const rel = childPath(relPath, entry)
      const type = entry !== null && entry !== undefined && entry.type === 'dir'
        ? 'dir'
        : (entry !== null && entry !== undefined && entry.type === 'file' ? 'file' : 'other')
      const name = entry !== null && entry !== undefined && typeof entry.name === 'string' && entry.name !== ''
        ? entry.name
        : basename(rel)
      if (type === 'dir') {
        const open = expanded.has(rel)
        out.push({ kind: 'dir', key: 'dir:' + rel, path: rel, name, depth, open })
        if (open) collectLevel(rel, depth + 1, out)
      } else {
        out.push({ kind: 'file', key: type + ':' + rel, path: rel, name, depth, other: type === 'other' })
      }
    }

    if (level.truncated === true) {
      out.push({ kind: 'note', key: baseKey + ':truncated', tone: 'info', text: translate('status.truncated'), depth })
    }
  }

  const rows = useMemo(() => {
    const out = []
    if (hasRoot) collectLevel('', 0, out)
    return out
    // eslint-disable-next-line -- tick 让 ref 缓存的变化进入依赖
  }, [hasRoot, rootPath, tick, expanded, filter, translate])

  const rootLevel = hasRoot ? levelsRef.current.get('') : undefined
  const rootFailed = rootLevel !== undefined && rootLevel !== null && rootLevel.status === 'failed'
  const rootReady = rootLevel !== undefined && rootLevel !== null && rootLevel.status === 'ok'
  const hasVisibleRows = rows.some((row) => row.kind === 'dir' || row.kind === 'file')
  const filterNote = filter !== '' && hasKey(translate, 'filter.loadedOnly')
    ? translate('filter.loadedOnly')
    : null
  const filterEmpty = filter !== '' && rootReady && !hasVisibleRows

  /* ------------------------------ 副作用（光标） ------------------------------ */

  useEffect(() => {
    if (selectedPath === null) return
    const index = rows.findIndex((row) => row.kind === 'file' && row.path === selectedPath)
    if (index >= 0) setCursor(index)
  }, [selectedPath, rows])

  useEffect(() => {
    setCursor((previous) => (previous >= rows.length ? rows.length - 1 : previous))
  }, [rows.length])

  useEffect(() => {
    const element = rowRefs.current[cursor]
    if (element === null || element === undefined) return
    try {
      if (typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest' })
    } catch {
      /* 忽略 */
    }
    if (wantFocusRef.current) {
      wantFocusRef.current = false
      try {
        if (typeof element.focus === 'function') element.focus()
      } catch {
        /* 忽略 */
      }
    }
  }, [cursor, rows])

  /* ------------------------------ 交互 ------------------------------ */

  const toggleDir = (dirPath) => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(dirPath)) next.delete(dirPath)
      else next.add(dirPath)
      return next
    })
  }

  const openFile = (row) => {
    if (row === null || row === undefined || row.other === true || onSelectFile === null) return
    onSelectFile(row.path)
  }

  const consume = (event) => {
    try {
      event.preventDefault()
      event.stopPropagation()
    } catch {
      /* 忽略 */
    }
  }

  const handleKeyDown = (event) => {
    if (event === null || event === undefined || typeof event.key !== 'string') return
    const container = event.currentTarget
    const target = event.target
    const onContainer = target !== null && target !== undefined && target === container
    const inside = !onContainer
      && container !== null && container !== undefined
      && typeof container.contains === 'function'
      && target !== null && target !== undefined
      && container.contains(target)
    // 只在列表内部消费按键，绝不抢 Panel 的全局快捷键。
    if (!onContainer && !inside) return

    const key = event.key
    const total = rows.length

    if (key === 'ArrowDown') {
      consume(event)
      if (total === 0) return
      wantFocusRef.current = true
      setCursor((previous) => {
        if (previous < 0 || previous >= total) return 0
        return Math.min(previous + 1, total - 1)
      })
      return
    }

    if (key === 'ArrowUp') {
      consume(event)
      if (total === 0) return
      wantFocusRef.current = true
      setCursor((previous) => {
        if (previous <= 0) return 0
        return Math.min(previous - 1, total - 1)
      })
      return
    }

    if (key === 'Enter') {
      // 行上的 Enter 交给原生 button click，避免重复回调。
      if (!onContainer) return
      const row = rows[cursor]
      if (row === undefined || row.kind === 'note') return
      consume(event)
      if (row.kind === 'dir') toggleDir(row.path)
      else openFile(row)
      return
    }

    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      const row = rows[cursor]
      if (row === undefined || row.kind !== 'dir') return
      if (key === 'ArrowRight' && !expanded.has(row.path)) {
        consume(event)
        toggleDir(row.path)
      } else if (key === 'ArrowLeft' && expanded.has(row.path)) {
        consume(event)
        toggleDir(row.path)
      }
    }
  }

  /* ------------------------------ 渲染 ------------------------------ */

  const renderRow = (row, index) => {
    const depth = typeof row.depth === 'number' && row.depth > 0 ? row.depth : 0

    if (row.kind === 'note') {
      return h('li', { key: row.key, className: 'dgp-item', role: 'none' },
        h('span', {
          className: 'dgp-note',
          'data-tone': row.tone,
          'data-dgp-note': row.key,
          // 提示文字缩进跟层级走（唯一允许的内联布局属性）
          style: { paddingLeft: String(8 + depth * 14) + 'px' }
        }, row.text))
    }

    const isCursor = cursor === index
    if (row.kind === 'dir') {
      const open = expanded.has(row.path)
      return h('li', {
        key: row.key,
        className: 'dgp-item',
        role: 'treeitem',
        'aria-level': depth + 1,
        'aria-expanded': open
      },
      h('button', {
        type: 'button',
        className: 'dgp-row',
        style: { '--dgp-depth': depth },
        'data-kind': 'dir',
        'data-dgp-entry': 'dir',
        'data-dgp-path': row.path,
        'data-dgp-row': 'dir',
        'data-open': open ? 'true' : 'false',
        'data-cursor': isCursor ? 'true' : undefined,
        title: row.path,
        'aria-expanded': open,
        ref: (element) => {
          rowRefs.current[index] = element
        },
        onClick: () => {
          setCursor(index)
          toggleDir(row.path)
        }
      },
      h('span', { className: 'dgp-caret', 'data-open': open ? 'true' : 'false' },
        h(Icon, { name: 'chevron-right', size: 12 })),
      h(Icon, { name: open ? 'folder-open' : 'folder', size: 14 }),
      h('span', { className: 'dgp-name dgp-name-dir dgp-oneline' }, row.name)))
    }

    const isActive = selectedPath !== null && row.path === selectedPath
    const dirty = dirtyPaths !== null && dirtyPaths.has(row.path) === true
    return h('li', {
      key: row.key,
      className: 'dgp-item',
      role: 'treeitem',
      'aria-level': depth + 1,
      'aria-selected': isActive ? 'true' : 'false'
    },
    h('button', {
      type: 'button',
      className: 'dgp-row',
      style: { '--dgp-depth': depth },
      'data-kind': 'file',
      'data-dgp-entry': 'file',
      'data-dgp-path': row.path,
      'data-dgp-row': 'file',
      'data-active': isActive ? 'true' : 'false',
      'aria-selected': isActive ? 'true' : 'false',
      'data-dirty': dirty === true ? 'true' : undefined,
      'data-cursor': isCursor ? 'true' : undefined,
      'aria-disabled': row.other === true ? 'true' : undefined,
      title: row.path,
      ref: (element) => {
        rowRefs.current[index] = element
      },
      onClick: () => {
        setCursor(index)
        openFile(row)
      }
    },
    h(Icon, { name: 'file', size: 14 }),
    h('span', { className: 'dgp-name dgp-oneline' }, row.name),
    dirty === true
      ? h('span', { className: 'dgp-dirty-dot', 'data-dirty': 'true', 'aria-label': translate('editor.unsaved') })
      : null))
  }

  const container = (children) => h('div', {
    className: 'dgp-list',
    role: 'tree',
    tabIndex: 0,
    'aria-label': translate('mode.files'),
    'data-dgp-list': 'files',
    onKeyDown: handleKeyDown
  }, children)

  /* --- 没有根：不崩，给空态 --- */
  if (!hasRoot) {
    return container(h(EmptyState, {
      icon: 'folder',
      title: translate('status.noRoots'),
      description: translate('status.noRootsHint'),
      t: translate
    }))
  }

  /* --- 根目录读取失败 --- */
  if (rootFailed) {
    return container(h(InlineNote, { tone: 'error' }, rootLevel.message))
  }

  /* --- 过滤后没有任何已加载的命中项 --- */
  if (filterEmpty) {
    return container([
      filterNote === null ? null : h(InlineNote, { key: 'filter-note', tone: 'info' }, filterNote),
      h(EmptyState, {
        key: 'empty',
        icon: 'search',
        title: translate('status.emptyFilter', { filter }),
        t: translate
      })
    ])
  }

  return container([
    filterNote === null ? null : h(InlineNote, { key: 'filter-note', tone: 'info' }, filterNote),
    h('ul', { key: 'level', className: 'dgp-level', role: 'none' }, rows.map((row, index) => renderRow(row, index)))
  ])
}
