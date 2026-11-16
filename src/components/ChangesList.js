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
 * 那里可以在 Node 里单测（见 `test/tree.test.mjs`）。键盘游标与「文件」树共用
 * `../ui/useTreeCursor.js`。
 *
 * 筛选时的展开规则：命中项必须看得见。所以只要筛选框非空，所有分组与目录
 * 一律按展开处理 —— 否则用户输入关键词，看到的却是一排折叠的分组标题。
 */
import { h, useEffect, useMemo, useState } from '../platform.js'
import { Icon, StatusLetter } from '../ui/Icon.js'
import { useTreeCursor } from '../ui/useTreeCursor.js'
import { dirname, formatCount } from '../util/paths.js'
import { ancestorsFor, buildGroupRows, buildListRows, countFilesUnder, filterEntries, groupChanges, groupActionOf, rowActionOf, rowDiscardKind } from '../util/changes.js'
import { EmptyState, SkeletonRows } from './States.js'

export function ChangesList(props) {
  const {
    status,
    loading = false,
    selectedPath = null,
    onSelect,
    filter = '',
    collapsedGroups = {},
    onToggleGroup,
    view = 'list',
    untrackedMode = 'merge',
    onStage,
    onDiscard,
    pendingPath = null,
    onStageGroup,
    pendingGroup = null,
    t
  } = props

  const files = status === null ? [] : status.files
  const filtering = filter.trim() !== ''

  const [expanded, setExpanded] = useState(() => new Set())
  /** 退回确认：{ path, kind: 'revert'|'delete' }；同一时刻只展开一行。 */
  const [discard, setDiscard] = useState(null)

  /**
   * 确认后执行退回：动作由 Panel 做（它负责请求与刷新），这里只收起确认。
   * 失败原因统一进 Panel 的错误条（CONTRACT：错误只由 Panel 渲染）。
   */
  async function runDiscard() {
    if (discard === null) return
    await onDiscard(discard.path)
    setDiscard(null)
  }

  const filteredFiles = useMemo(() => filterEntries(files, filter), [files, filter])
  const groups = useMemo(() => groupChanges(filteredFiles, { untrackedMode }), [filteredFiles, untrackedMode])

  /** 分组可见性 + 每组要渲染的行（offset 是跨分组的扁平行序号基数）。 */
  const layout = useMemo(() => {
    const out = []
    let offset = 0
    for (const group of groups) {
      const open = filtering || collapsedGroups[group.key] !== true
      const rows = open
        ? (view === 'tree'
          ? buildGroupRows(group.entries, (dirPath) => filtering || expanded.has(dirPath))
          : buildListRows(group.entries))
        : []
      out.push({ key: group.key, entries: group.entries, open, rows, offset })
      if (open) offset += rows.length
    }
    return out
  }, [groups, collapsedGroups, expanded, view, filtering])

  /** 键盘游标走查的扁平行序列（跨分组：冲突 → 已暂存 → 未暂存 → 未跟踪）。 */
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

  function toggleDirPath(dirPath) {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(dirPath)) next.delete(dirPath)
      else next.add(dirPath)
      return next
    })
  }

  function activateRow(item) {
    if (item.row.kind === 'file') onSelect(item.row.node.entry, item.group)
    else toggleDirPath(item.row.path)
  }

  const cursorState = useTreeCursor({
    rows: flatRows,
    isDir: (item) => item.row.kind === 'dir',
    isOpen: (item) => expanded.has(item.row.path),
    onToggle: (item) => toggleDirPath(item.row.path),
    onActivate: activateRow
  })
  const { cursor, rowRefs, focusRow, handleKeyDown } = cursorState

  // 把选中文件的目录链自动展开，保证选中项可见（Panel 可能在外部改 selectedPath）。
  // 列表模式没有目录行，不需要展开任何东西。
  useEffect(() => {
    if (view !== 'tree' || selectedPath === null) return
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
  }, [selectedPath, groups, view])

  // 外部（Panel / 鼠标）改了选中项时，键盘光标跟随它。
  useEffect(() => {
    if (selectedPath === null) return
    const index = flatRows.findIndex((item) => item.row.kind === 'file' && item.row.path === selectedPath)
    if (index >= 0) focusRow(index)
  }, [selectedPath, flatRows])

  // 那一行已经从 status 里消失（退回成功 / 外部改动）：确认态不能留到同名文件再次出现。
  useEffect(() => {
    if (discard === null || files.some((file) => file.path === discard.path)) return
    setDiscard(null)
  }, [discard, files])

  /* ------------------------------ 渲染 ------------------------------ */

  function renderRow(group, row, index) {
    const depth = row.depth
    const style = { '--dgp-depth': depth }
    const isActive = selectedPath !== null && row.path === selectedPath
    const isCursor = cursor === index
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
        key: 'dir:' + row.path,
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
          focusRow(index)
          toggleDirPath(row.path)
        }
      },
      h('span', { className: 'dgp-caret', 'data-open': open ? 'true' : 'false' },
        h(Icon, { name: 'chevron-right', size: 12 })),
      h(Icon, { name: open ? 'folder-open' : 'folder', size: 14 }),
      h('span', { className: 'dgp-name dgp-name-dir dgp-oneline' }, row.displayName),
      count > 0 ? h('span', { className: 'dgp-meta' }, formatCount(count)) : null))
    }

    const entry = row.node.entry
    const parent = dirname(row.path)
    const sideStats = group.key === 'staged' ? entry.stagedStats : entry.unstagedStats
    const stats = sideStats ?? entry
    const counts = []
    if (stats.adds >= 0) {
      counts.push(h('span', { key: 'add', className: 'dgp-add' }, t('viewer.adds', { count: String(stats.adds) })))
    }
    if (stats.dels >= 0) {
      counts.push(h('span', { key: 'del', className: 'dgp-del' }, t('viewer.dels', { count: String(stats.dels) })))
    }

    // 行尾操作只由所在分组决定：未暂存/未跟踪 = 退回 + 暂存，已暂存 = 取消暂存，冲突不给按钮。
    // 「退回」是不可恢复的操作，所以它先展开一行确认（与分支删除同一套做法）。
    const action = rowActionOf(group.key)
    const discardKind = rowDiscardKind(entry, group.key)
    const busy = pendingPath !== null && pendingPath === row.path
    const buttons = []
    if (discardKind !== null) {
      buttons.push(h('button', {
        key: 'discard',
        type: 'button',
        className: 'dgp-row-action',
        'data-dgp-action': 'discard',
        'data-dgp-discard-kind': discardKind,
        'data-busy': busy ? 'true' : undefined,
        disabled: busy,
        title: t(discardKind === 'delete' ? 'row.discardUntracked' : 'row.discard'),
        'aria-label': t(discardKind === 'delete' ? 'row.discardUntracked' : 'row.discard'),
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          setDiscard({ path: row.path, kind: discardKind })
        }
      }, h(Icon, { name: 'discard', size: 14 })))
    }
    if (action !== null) {
      buttons.push(h('button', {
        key: action,
        type: 'button',
        className: 'dgp-row-action',
        'data-dgp-action': action,
        'data-busy': busy ? 'true' : undefined,
        disabled: busy,
        title: t(action === 'stage' ? 'row.stage' : 'row.unstage'),
        'aria-label': t(action === 'stage' ? 'row.stage' : 'row.unstage'),
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          onStage(row.path, action)
        }
      }, h(Icon, { name: action === 'stage' ? 'plus' : 'minus', size: 14 })))
    }
    const actionArea = buttons.length === 0 ? null : h('div', { className: 'dgp-row-actions' }, buttons)
    const confirming = discard !== null && discard.path === row.path
    const confirmArea = confirming
      ? h('div', {
        className: 'dgp-row-confirm',
        'data-dgp-discard-confirm': discard.kind
      },
      h('div', { className: 'dgp-row-confirm-text' },
        t(discard.kind === 'delete' ? 'discard.confirmUntracked' : 'discard.confirmRevert', { path: row.path })),
      h('div', { className: 'dgp-row-confirm-actions' },
        h('button', {
          type: 'button',
          className: 'dgp-btn',
          'data-size': 'sm',
          'data-variant': 'ghost',
          'data-dgp-discard-cancel': 'true',
          disabled: busy,
          onClick: () => setDiscard(null)
        }, t('action.cancel')),
        h('button', {
          type: 'button',
          className: 'dgp-btn',
          'data-size': 'sm',
          'data-variant': 'danger',
          'data-dgp-discard-run': discard.kind,
          disabled: busy,
          onClick: runDiscard
        }, t(discard.kind === 'delete' ? 'discard.deleteFile' : 'discard.run'))))
      : null

    return h('li', {
      key: 'file:' + row.path,
      className: 'dgp-item',
      role: 'treeitem',
      'aria-level': depth + 1,
      'aria-selected': isActive ? 'true' : 'false'
    },
    h('div', { className: 'dgp-row-wrap dgp-change-row' },
      h('button', {
        ...common,
        'data-kind': 'file',
        'data-dgp-entry': 'file',
        onClick: () => {
          focusRow(index)
          activateRow({ group: group.key, row })
        }
      },
      h(StatusLetter, { status: entry.status }),
      h('span', { className: 'dgp-name dgp-oneline' }, row.displayName),
      parent === '' ? null : h('span', { className: 'dgp-sub dgp-oneline' }, parent),
      counts.length === 0 ? null : h('span', { className: 'dgp-meta' }, counts)),
      actionArea),
    confirmArea)
  }

  function renderGroup(group) {
    const action = groupActionOf(group.key, untrackedMode)
    const busy = pendingGroup !== null && pendingGroup === action
    const actionButton = action === null
      ? null
      : h('button', {
        type: 'button',
        className: 'dgp-group-action',
        'data-dgp-group-action': action,
        'data-busy': busy ? 'true' : undefined,
        disabled: busy,
        title: t(action === 'unstage' ? 'group.unstageAll' : 'group.stageAll'),
        'aria-label': t(action === 'unstage' ? 'group.unstageAll' : 'group.stageAll'),
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          onStageGroup(action)
        }
      }, h(Icon, { name: action === 'unstage' ? 'minus' : 'plus', size: 14 }))
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
          onToggleGroup(group.key)
        }
      },
      h('span', { className: 'dgp-group-caret', 'data-open': group.open ? 'true' : 'false' },
        h(Icon, { name: 'chevron-right', size: 12 })),
      h('span', { className: 'dgp-group-title' }, t('group.' + group.key)),
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
    'aria-label': t('mode.changes'),
    'data-dgp-list': 'changes',
    'data-view': view,
    onKeyDown: handleKeyDown
  }, children)

  /* --- 没有 status：加载 / 空仓库 --- */
  if (status === null) {
    if (loading) return container(h(SkeletonRows, { rows: 6 }))
    return container(h(EmptyState, {
      icon: 'git-branch',
      title: t('status.noRoots'),
      description: t('status.noRootsHint')
    }))
  }

  /* --- 工作区干净 --- */
  if (files.length === 0) {
    return container(h(EmptyState, {
      icon: 'check-circle',
      title: t('status.clean'),
      description: t('status.cleanHint')
    }))
  }

  /* --- 有改动，但被过滤词筛空了 --- */
  if (groups.length === 0) {
    return container(h(EmptyState, {
      icon: 'search',
      title: t('status.emptyFilter', { filter })
    }))
  }

  return container(layout.map((group) => renderGroup(group)))
}
