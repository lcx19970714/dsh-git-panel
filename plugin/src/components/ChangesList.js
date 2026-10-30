/**
 * src/components/ChangesList.js —— 「变更」模式的树
 *
 * 结构（与 src/styles.js 的 `.dgp-*` 选择器一一对应）：
 *
 *   div.dgp-list[role=tree]                      ← 滚动容器 + 键盘焦点
 *   ├─ div.dgp-group[data-dgp-group=key]         ← 冲突 / 已暂存 / 未暂存 / 未跟踪
 *   │  ├─ button.dgp-group-head[data-open]       ← 点击 = onToggleGroup(key)
 *   │  │  ├─ span.dgp-group-caret[data-open]
 *   │  │  ├─ span.dgp-group-title
 *   │  │  └─ span.dgp-group-count
 *   │  └─ ul.dgp-level[role=none]
 *   │     └─ li.dgp-item[role=treeitem][aria-level]
 *   │        └─ button.dgp-row[data-kind=dir|file][data-active][data-cursor]
 *   └─ ...
 *
 * 纯逻辑（分组、压树、折叠单链、过滤、自动展开链）全在 `../util/changes.js`，
 * 那里可以在 Node 里单测（见 `test/tree.test.mjs`）。
 */
import { h, useEffect, useMemo, useRef, useState } from '../platform.js'
import { Icon, StatusLetter } from '../ui/Icon.js'
import { basename, dirname, formatCount } from '../util/paths.js'
import { ancestorsFor, buildGroupRows, countFilesUnder, filterEntries, groupChanges, groupActionOf, rowActionOf } from '../util/changes.js'
import { EmptyState, InlineNote, SkeletonRows } from './States.js'

/** props.t 缺失时的兜底（本地字典，永不返回 undefined）。 */

/** 把 props 里可能出现的各种 error 形状收敛成一个字符串或 null。 */
function toErrorText(error) {
  if (error === null || error === undefined || error === '') return null
  if (typeof error === 'string') return error
  if (typeof error.message === 'string' && error.message !== '') return error.message
  return String(error)
}

export function ChangesList(props) {
  const source = props === null || props === undefined ? {} : props
  const status = source.status === undefined ? null : source.status
  const loading = source.loading === true
  const selectedPath = typeof source.selectedPath === 'string' && source.selectedPath !== ''
    ? source.selectedPath
    : null
  const filter = typeof source.filter === 'string' ? source.filter : ''
  const collapsedGroups = source.collapsedGroups !== null && typeof source.collapsedGroups === 'object'
    ? source.collapsedGroups
    : null
  const onSelect = typeof source.onSelect === 'function' ? source.onSelect : null
  const onToggleGroup = typeof source.onToggleGroup === 'function' ? source.onToggleGroup : null
  const onStage = typeof source.onStage === 'function' ? source.onStage : null
  const onStageGroup = typeof source.onStageGroup === 'function' ? source.onStageGroup : null
  const pendingPath = typeof source.pendingPath === 'string' && source.pendingPath !== ''
    ? source.pendingPath
    : null
  const pendingGroup = typeof source.pendingGroup === 'string' && source.pendingGroup !== ''
    ? source.pendingGroup
    : null
  const translate = source.t
  // 注意：`onFilterChange` 归 Panel 管（它渲染筛选输入框），这里只消费 `filter`。

  const errorText = toErrorText(source.error)
  const files = status !== null && status !== undefined && Array.isArray(status.files) ? status.files : []

  const [expanded, setExpanded] = useState(() => new Set())
  const [cursor, setCursor] = useState(-1)
  const rowRefs = useRef([])
  const wantFocusRef = useRef(false)

  /* ------------------------------ 派生数据 ------------------------------ */

  const filteredFiles = useMemo(() => filterEntries(files, filter), [files, filter])
  const groups = useMemo(() => groupChanges(filteredFiles), [filteredFiles])

  /** 分组可见性 + 每组要渲染的行（含固定顺序的扁平序号基数）。 */
  const layout = useMemo(() => {
    const out = []
    let offset = 0
    for (const group of groups) {
      const open = !(collapsedGroups !== null && collapsedGroups[group.key] === true)
      const rows = open ? buildGroupRows(group.entries, (dirPath) => expanded.has(dirPath)) : []
      out.push({ key: group.key, entries: group.entries, open, rows, offset })
      if (open) offset += rows.length
    }
    return out
  }, [groups, collapsedGroups, expanded])

  /** 键盘光标走查的扁平行序列（跨分组：冲突 → 已暂存 → 未暂存 → 未跟踪）。 */
  const flatRows = useMemo(() => {
    const out = []
    for (const group of layout) {
      if (!group.open) continue
      for (let index = 0; index < group.rows.length; index += 1) {
        out.push({ group: group.key, row: group.rows[index], index: group.offset + index })
      }
    }
    return out
  }, [layout])

  /* ------------------------------ 副作用 ------------------------------ */

  // 把选中文件的目录链自动展开，保证选中项可见（Panel 可能在外部改 selectedPath）。
  useEffect(() => {
    if (selectedPath === null) return
    setExpanded((previous) => {
      let next = null
      for (const group of groups) {
        for (const dirPath of ancestorsFor(group.entries, selectedPath)) {
          if (previous.has(dirPath)) continue
          if (next === null) next = new Set(previous)
          next.add(dirPath)
        }
      }
      return next === null ? previous : next
    })
  }, [selectedPath, groups])

  // 外部（Panel / 鼠标）改了选中项时，键盘光标跟随它。
  useEffect(() => {
    if (selectedPath === null) return
    const index = flatRows.findIndex((item) => item.row.kind === 'file' && item.row.path === selectedPath)
    if (index >= 0) setCursor(index)
  }, [selectedPath, flatRows])

  // 行数变少（折叠分组 / 过滤）时收敛光标。
  useEffect(() => {
    setCursor((previous) => (previous >= flatRows.length ? flatRows.length - 1 : previous))
  }, [flatRows.length])

  // 光标行滚进可视区；键盘移动时顺带把真实焦点也移过去（Enter 由原生 click 处理）。
  useEffect(() => {
    const element = rowRefs.current[cursor]
    if (element === null || element === undefined) return
    try {
      if (typeof element.scrollIntoView === 'function') element.scrollIntoView({ block: 'nearest' })
    } catch {
      /* 老宿主/测试环境里没有 scrollIntoView，忽略 */
    }
    if (wantFocusRef.current) {
      wantFocusRef.current = false
      try {
        if (typeof element.focus === 'function') element.focus()
      } catch {
        /* 忽略 */
      }
    }
  }, [cursor])

  /* ------------------------------ 交互 ------------------------------ */

  const toggleDirPath = (dirPath) => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(dirPath)) next.delete(dirPath)
      else next.add(dirPath)
      return next
    })
  }

  const selectRow = (row, groupKey) => {
    if (row === null || row === undefined || onSelect === null) return
    const node = row.node
    const entry = node !== null && node !== undefined && node.entry !== undefined ? node.entry : null
    if (entry === null || entry === undefined) return
    onSelect(entry, groupKey)
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
    // 只在「列表自身」范围内响应按键，绝不抢 Panel 的全局快捷键。
    if (!onContainer && !inside) return

    const key = event.key
    const total = flatRows.length

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
      // 行上的 Enter 交给原生 button click（避免重复 onSelect）。
      if (!onContainer) return
      const item = flatRows[cursor]
      if (item === undefined) return
      consume(event)
      if (item.row.kind === 'file') selectRow(item.row, item.group)
      else toggleDirPath(item.row.path)
      return
    }

    if (key === 'ArrowRight' || key === 'ArrowLeft') {
      const item = flatRows[cursor]
      if (item === undefined || item.row.kind !== 'dir') return
      const open = expanded.has(item.row.path)
      if (key === 'ArrowRight' && !open) {
        consume(event)
        toggleDirPath(item.row.path)
      } else if (key === 'ArrowLeft' && open) {
        consume(event)
        toggleDirPath(item.row.path)
      }
    }
  }

  /* ------------------------------ 渲染 ------------------------------ */

  const renderRow = (group, row, index) => {
    const depth = typeof row.depth === 'number' && row.depth > 0 ? row.depth : 0
    const style = { '--dgp-depth': depth }
    const isActive = selectedPath !== null && row.path === selectedPath
    const isCursor = cursor === index
    const displayName = typeof row.displayName === 'string' && row.displayName !== ''
      ? row.displayName
      : basename(row.path)
    const common = {
      type: 'button',
      className: 'dgp-row',
      style,
      'data-dgp-path': row.path,
      'data-active': isActive ? 'true' : 'false',
      'aria-selected': isActive ? 'true' : 'false',
      'data-cursor': isCursor ? 'true' : undefined,
      'data-dgp-row': row.kind,
      title: row.path,
      ref: (element) => {
        rowRefs.current[index] = element
      }
    }

    if (row.kind === 'dir') {
      const open = expanded.has(row.path)
      const count = countFilesUnder(group.entries, row.path)
      return h('li', {
        key: index,
        className: 'dgp-item',
        role: 'treeitem',
        'aria-level': depth + 1,
        'aria-expanded': open
      },
      h('button', {
        ...common,
        'data-kind': 'dir',
        'data-dgp-entry': 'dir',
        'aria-expanded': open,
        'data-open': open ? 'true' : 'false',
        onClick: () => {
          setCursor(index)
          toggleDirPath(row.path)
        }
      },
      h('span', { className: 'dgp-caret', 'data-open': open ? 'true' : 'false' },
        h(Icon, { name: 'chevron-right', size: 12 })),
      h(Icon, { name: open ? 'folder-open' : 'folder', size: 14 }),
      h('span', { className: 'dgp-name dgp-name-dir dgp-oneline' }, displayName),
      count > 0 ? h('span', { className: 'dgp-meta' }, formatCount(count)) : null))
    }

    const entry = row.node !== null && row.node !== undefined && row.node.entry !== undefined
      ? row.node.entry
      : null
    const parent = dirname(row.path)
    const adds = entry !== null && entry !== undefined && typeof entry.adds === 'number' ? entry.adds : -1
    const dels = entry !== null && entry !== undefined && typeof entry.dels === 'number' ? entry.dels : -1
    const counts = []
    if (adds > 0) {
      counts.push(h('span', { key: 'add', className: 'dgp-add' }, translate('viewer.adds', { count: formatCount(adds) })))
    }
    if (dels > 0) {
      counts.push(h('span', { key: 'del', className: 'dgp-del' }, translate('viewer.dels', { count: formatCount(dels) })))
    }

    // 行尾操作只由所在分组决定：已暂存 = 取消暂存，未暂存/未跟踪 = 暂存，冲突不给按钮。
    const action = rowActionOf(group.key)
    const busy = pendingPath !== null && pendingPath === row.path
    const actionButton = action === null || onStage === null
      ? null
      : h('button', {
        type: 'button',
        className: 'dgp-row-action',
        'data-dgp-action': action,
        'data-busy': busy ? 'true' : undefined,
        disabled: busy,
        title: translate(action === 'stage' ? 'row.stage' : 'row.unstage'),
        'aria-label': translate(action === 'stage' ? 'row.stage' : 'row.unstage'),
        onClick: (event) => {
          if (event !== null && event !== undefined) {
            event.preventDefault()
            event.stopPropagation()
          }
          onStage(row.path, action)
        }
      }, h(Icon, { name: action === 'stage' ? 'plus' : 'minus', size: 13 }))

    return h('li', {
      key: index,
      className: 'dgp-item',
      role: 'treeitem',
      'aria-level': depth + 1,
      'aria-selected': isActive ? 'true' : 'false'
    },
    h('div', { className: 'dgp-row-wrap' },
      h('button', {
        ...common,
        'data-kind': 'file',
        'data-dgp-entry': 'file',
        onClick: () => {
          setCursor(index)
          selectRow(row, group.key)
        }
      },
      entry !== null && entry !== undefined
        ? h(StatusLetter, { status: entry.status })
        : null,
      h('span', { className: 'dgp-name dgp-oneline' }, displayName),
      parent === '' ? null : h('span', { className: 'dgp-sub dgp-oneline' }, parent),
      counts.length === 0 ? null : h('span', { className: 'dgp-meta' }, counts)),
      actionButton))
  }

  const renderGroup = (group) => {
    const action = groupActionOf(group.key)
    const busy = pendingGroup !== null && pendingGroup === action
    const actionButton = action === null || onStageGroup === null
      ? null
      : h('button', {
        type: 'button',
        className: 'dgp-group-action',
        'data-dgp-group-action': action,
        'data-busy': busy ? 'true' : undefined,
        disabled: busy,
        title: translate(action === 'unstage' ? 'group.unstageAll' : 'group.stageAll'),
        'aria-label': translate(action === 'unstage' ? 'group.unstageAll' : 'group.stageAll'),
        onClick: (event) => {
          if (event !== null && event !== undefined) {
            event.preventDefault()
            event.stopPropagation()
          }
          onStageGroup(action)
        }
      }, h(Icon, { name: action === 'unstage' ? 'minus' : 'plus', size: 13 }))
    return h('div', {
      key: group.key,
      className: 'dgp-group',
      'data-dgp-group': group.key
    },
    h('div', { className: 'dgp-group-head-wrap' },
      h('button', {
        type: 'button',
        className: 'dgp-group-head',
        'data-open': group.open ? 'true' : 'false',
        'aria-expanded': group.open,
        onClick: () => {
          if (onToggleGroup !== null) onToggleGroup(group.key)
        }
      },
      h('span', { className: 'dgp-group-caret', 'data-open': group.open ? 'true' : 'false' },
        h(Icon, { name: 'chevron-right', size: 12 })),
      h('span', { className: 'dgp-group-title' }, translate('group.' + group.key)),
      h('span', { className: 'dgp-group-count' }, formatCount(group.entries.length))),
      actionButton),
    group.open
      ? h('ul', { className: 'dgp-level', role: 'none' },
        group.rows.map((row, index) => renderRow(group, row, group.offset + index)))
      : null)
  }

  const container = (children) => h('div', {
    className: 'dgp-list',
    role: 'tree',
    tabIndex: 0,
    'aria-label': translate('mode.changes'),
    'data-dgp-list': 'changes',
    onKeyDown: handleKeyDown
  }, children)

  /* --- 状态分支（没有 status：加载 / 出错 / 无仓库） --- */
  if (status === null || status === undefined) {
    if (errorText !== null) {
      return container(h(InlineNote, { tone: 'error' }, translate('error.generic', { message: errorText })))
    }
    if (loading) return container(h(SkeletonRows, { rows: 6 }))
    return container(h(EmptyState, {
      icon: 'git-branch',
      title: translate('status.noRoots'),
      description: translate('status.noRootsHint'),
      t: translate
    }))
  }

  /* --- 工作区干净 --- */
  if (files.length === 0) {
    return container(h(EmptyState, {
      icon: 'check-circle',
      title: translate('status.clean'),
      description: translate('status.cleanHint'),
      t: translate
    }))
  }

  /* --- 有改动，但被过滤词筛空了 --- */
  if (groups.length === 0) {
    if (filter === '') {
      return container(h(EmptyState, {
        icon: 'check-circle',
        title: translate('status.clean'),
        description: translate('status.cleanHint'),
        t: translate
      }))
    }
    return container(h(EmptyState, {
      icon: 'search',
      title: translate('status.emptyFilter', { filter }),
      t: translate
    }))
  }

  // 注意：status 有值时的 statusError 由 Panel 统一渲染（避免重复提示），这里只在「没有 status」时自己提示。
  return container(layout.map((group) => renderGroup(group)))
}
