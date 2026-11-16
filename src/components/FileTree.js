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
 * 每个请求一个 AbortController：根切换 / 卸载 / 手动刷新时全部 abort，晚到的响应不会再写回缓存。
 *
 * `reloadNonce` 由 Panel 在「立即刷新 / R」时 +1：清空已加载的目录缓存、保留展开状态并重读 ——
 * 否则外部新建/删除的文件在面板里永远看不到（目录缓存命中就直接返回）。
 *
 * 键盘游标与「变更」树共用 `../ui/useTreeCursor.js`。
 */
import { h, useEffect, useMemo, useRef, useState } from '../platform.js'
import { Icon } from '../ui/Icon.js'
import { useTreeCursor } from '../ui/useTreeCursor.js'
import { basename, matchesFilter, parentChain } from '../util/paths.js'
import { childPath, orderTreeEntries } from '../util/changes.js'
import { describeError } from '../api.js'
import { EmptyState, InlineNote } from './States.js'

export function FileTree(props) {
  const { rootPath, selectedPath, onSelectFile, filter, loadDir, dirtyPaths, reloadNonce, t } = props
  const hasRoot = rootPath !== null
  const filtering = filter.trim() !== ''

  /** relPath -> { status:'loading'|'ok'|'failed', entries, truncated, message } */
  const levelsRef = useRef(new Map())
  /** relPath -> AbortController */
  const controllersRef = useRef(new Map())
  /** 根切换 / 刷新的世代号：晚到的响应据此丢弃。 */
  const generationRef = useRef(0)
  const previousRootRef = useRef(rootPath)

  const [tick, setTick] = useState(0)
  const [expanded, setExpanded] = useState(() => new Set())

  const bump = () => setTick((value) => value + 1)

  /* ------------------------------ 取目录 ------------------------------ */

  function abortAll() {
    for (const controller of controllersRef.current.values()) controller.abort()
    controllersRef.current.clear()
  }

  function request(relPath) {
    const key = relPath
    const cached = levelsRef.current.get(key)
    if (cached !== undefined && (cached.status === 'loading' || cached.status === 'ok')) return
    controllersRef.current.get(key)?.abort()

    const controller = new AbortController()
    controllersRef.current.set(key, controller)
    const generation = generationRef.current
    levelsRef.current.set(key, { status: 'loading', entries: [], truncated: false, message: null })
    bump()

    loadDir(key, controller.signal).then((result) => {
      if (generation !== generationRef.current) return
      levelsRef.current.set(key, {
        status: 'ok',
        entries: result.entries,
        truncated: result.truncated,
        message: null
      })
      controllersRef.current.delete(key)
      bump()
    }, (error) => {
      if (generation !== generationRef.current) return
      levelsRef.current.set(key, {
        status: 'failed',
        entries: [],
        truncated: false,
        message: describeError(error, t)
      })
      controllersRef.current.delete(key)
      bump()
    })
  }

  /* ------------------------------ 副作用 ------------------------------ */

  // 根变化：清缓存、清展开状态、重读根目录；手动刷新（同一根）：保留展开状态重读。
  // 卸载时同样 abort 掉全部在途请求。
  useEffect(() => {
    generationRef.current += 1
    abortAll()
    levelsRef.current.clear()

    const rootChanged = previousRootRef.current !== rootPath
    previousRootRef.current = rootPath

    if (rootChanged) {
      setExpanded(new Set())
      if (hasRoot) request('')
      else setTick((value) => value + 1)
      return abortAll
    }
    request('')
    for (const dirPath of expanded) request(dirPath)
    return abortAll
    // eslint-disable-next-line -- 只跟随根与手动刷新序号
  }, [rootPath, reloadNonce])

  // 任何「已展开但还没缓存」的目录都在渲染后补一次请求（展开、自动展开、临时失败重试都走这里）。
  useEffect(() => {
    if (!hasRoot) return
    for (const dirPath of expanded) {
      if (dirPath === '') continue
      if (!levelsRef.current.has(dirPath)) request(dirPath)
    }
  }, [expanded, tick, hasRoot])

  // 外部改 selectedPath 时，把它的祖先链展开（缺失的层级由上面的副作用加载）。
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
  function entryMatches(relPath, entry) {
    const rel = childPath(relPath, entry)
    if (matchesFilter(rel, filter) || matchesFilter(entry.name, filter)) return true
    if (entry.type !== 'dir') return false
    const level = levelsRef.current.get(rel)
    if (level === undefined || level.status !== 'ok') return false
    return level.entries.some((child) => entryMatches(rel, child))
  }

  /**
   * 把「已加载 + 已展开」的部分压成一个扁平行数组（深度优先）。
   * 筛选时把所有已加载目录都当成展开：命中项不能藏在折叠的目录里。
   */
  function collectLevel(relPath, depth, out) {
    const level = levelsRef.current.get(relPath)
    const baseKey = relPath === '' ? 'root' : relPath
    if (level === undefined || level.status === 'loading') {
      out.push({ kind: 'note', key: baseKey + ':loading', tone: 'info', text: t('status.loading'), depth })
      return
    }
    if (level.status === 'failed') {
      out.push({ kind: 'note', key: baseKey + ':failed', tone: 'error', text: level.message, depth })
      return
    }

    const visible = filtering ? level.entries.filter((entry) => entryMatches(relPath, entry)) : level.entries
    const ordered = orderTreeEntries(visible)

    if (ordered.length === 0) {
      const text = filtering ? t('status.emptyFilter', { filter }) : t('status.emptyDir')
      out.push({ kind: 'note', key: baseKey + ':empty', tone: 'info', text, depth })
    }

    for (const entry of ordered) {
      const rel = childPath(relPath, entry)
      const type = entry.type === 'dir' ? 'dir' : (entry.type === 'file' ? 'file' : 'other')
      const name = entry.name !== '' ? entry.name : basename(rel)
      if (type === 'dir') {
        const open = filtering || expanded.has(rel)
        out.push({ kind: 'dir', key: 'dir:' + rel, path: rel, name, depth, open })
        if (open) collectLevel(rel, depth + 1, out)
      } else {
        out.push({ kind: 'file', key: type + ':' + rel, path: rel, name, depth, other: type === 'other' })
      }
    }

    if (level.truncated === true) {
      out.push({ kind: 'note', key: baseKey + ':truncated', tone: 'info', text: t('status.truncated'), depth })
    }
  }

  const rows = useMemo(() => {
    const out = []
    if (hasRoot) collectLevel('', 0, out)
    return out
    // eslint-disable-next-line -- tick 让 ref 缓存的变化进入依赖
  }, [hasRoot, rootPath, tick, expanded, filter, t])

  const rootLevel = hasRoot ? levelsRef.current.get('') : undefined
  const rootFailed = rootLevel !== undefined && rootLevel.status === 'failed'
  const rootReady = rootLevel !== undefined && rootLevel.status === 'ok'
  const hasVisibleRows = rows.some((row) => row.kind === 'dir' || row.kind === 'file')
  const filterNote = filtering ? t('filter.loadedOnly') : null
  const filterEmpty = filtering && rootReady && !hasVisibleRows

  /* ------------------------------ 交互 ------------------------------ */

  function toggleDir(dirPath) {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(dirPath)) next.delete(dirPath)
      else next.add(dirPath)
      return next
    })
  }

  function activateRow(row) {
    if (row.kind === 'note') return
    if (row.kind === 'dir') toggleDir(row.path)
    else if (row.other !== true) onSelectFile(row.path)
  }

  // 提示行仅用于展示，没有可聚焦按钮；导航和 ref 必须共用过滤后的下标。
  const cursorRows = useMemo(() => rows.filter((row) => row.kind !== 'note'), [rows])
  const cursorIndexes = useMemo(() => new Map(cursorRows.map((row, index) => [row, index])), [cursorRows])
  const cursorState = useTreeCursor({
    rows: cursorRows,
    isDir: (row) => row.kind === 'dir',
    isOpen: (row) => expanded.has(row.path),
    onToggle: (row) => toggleDir(row.path),
    onActivate: activateRow
  })
  const { cursor, rowRefs, focusRow, handleKeyDown } = cursorState

  // 外部选中项变化 → 键盘游标跟随。
  useEffect(() => {
    if (selectedPath === null) return
    const index = cursorRows.findIndex((row) => row.kind === 'file' && row.path === selectedPath)
    if (index >= 0) focusRow(index)
  }, [selectedPath, cursorRows])

  /* ------------------------------ 渲染 ------------------------------ */

  function renderRow(row) {
    const depth = row.depth

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

    const index = cursorIndexes.get(row)
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
          focusRow(index)
          toggleDir(row.path)
        }
      },
      h('span', { className: 'dgp-caret', 'data-open': open ? 'true' : 'false' },
        h(Icon, { name: 'chevron-right', size: 12 })),
      h(Icon, { name: open ? 'folder-open' : 'folder', size: 14 }),
      h('span', { className: 'dgp-name dgp-name-dir dgp-oneline' }, row.name)))
    }

    const isActive = selectedPath !== null && row.path === selectedPath
    const dirty = dirtyPaths.has(row.path) === true
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
        focusRow(index)
        activateRow(row)
      }
    },
    h(Icon, { name: 'file', size: 14 }),
    h('span', { className: 'dgp-name dgp-oneline' }, row.name),
    dirty === true
      ? h('span', { className: 'dgp-dirty-dot', 'data-dirty': 'true', 'aria-label': t('editor.unsaved') })
      : null))
  }

  const container = (children) => h('div', {
    className: 'dgp-list',
    role: 'tree',
    tabIndex: 0,
    'aria-label': t('mode.files'),
    'data-dgp-list': 'files',
    onKeyDown: handleKeyDown
  }, children)

  if (!hasRoot) {
    return container(h(EmptyState, {
      icon: 'folder',
      title: t('status.noRoots'),
      description: t('status.noRootsHint')
    }))
  }

  if (rootFailed) return container(h(InlineNote, { tone: 'error' }, rootLevel.message))

  if (filterEmpty) {
    return container([
      filterNote === null ? null : h(InlineNote, { key: 'filter-note', tone: 'info' }, filterNote),
      h(EmptyState, {
        key: 'empty',
        icon: 'search',
        title: t('status.emptyFilter', { filter })
      })
    ])
  }

  return container([
    filterNote === null ? null : h(InlineNote, { key: 'filter-note', tone: 'info' }, filterNote),
    h('ul', { key: 'level', className: 'dgp-level', role: 'none' }, rows.map((row) => renderRow(row)))
  ])
}
