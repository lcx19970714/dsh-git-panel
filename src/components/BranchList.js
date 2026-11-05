/**
 * src/components/BranchList.js —— 「远端」页签仓库详情里的「分支」区
 *
 * 解决的是远端仓库详情只能看代码 / Issues / PR、看不到分支的问题：
 *   · 远端有哪些分支、本地有没有同名分支、哪个是当前分支/默认分支；
 *   · 本地相对上游领先/落后多少、上游是否已被删除、远端是否已有本地还没 fetch 的新提交；
 *   · 快速操作：切换、建本地跟踪分支、复制分支名、打开网页、删除本地分支、删除远端分支。
 *
 * 数据由 Panel 取（remote/branches：远端 API + 本地 git 合成一条），这里只负责
 * 交互与错误呈现。删除是破坏性操作，一律先出二次确认；本地分支有未合并提交时
 * 只把「强制删除」按钮露出来，不默认 force。
 */
import { h, useEffect, useState } from '../platform.js'
import { Icon } from '../ui/Icon.js'
import { MenuItem, MenuLabel, PopupMenu } from '../ui/Menu.js'
import { copyText } from '../util/clipboard.js'

/** 分支行右侧的两个小标签：本地 / 远端。远端未知（API 失败）时用第三种表达。 */
function branchTags(row, translate) {
  return h('span', { className: 'dgp-branch-tags' },
    h('span', {
      className: 'dgp-branch-tag',
      'data-active': row.local === true ? 'true' : 'false',
      'data-kind': 'local'
    }, translate('branch.localTag')),
    h('span', {
      className: 'dgp-branch-tag',
      'data-active': row.remote === true ? 'true' : 'false',
      'data-kind': 'remote',
      // true/false/null 三态：null = 远端列表没读到，不能画成「没有」
      'data-unknown': row.remote === null ? 'true' : 'false',
      title: row.remote === null ? translate('branch.remoteUnknown') : undefined
    }, translate('branch.remoteTag')),
    row.default === true
      ? h('span', { className: 'dgp-branch-tag', 'data-active': 'false', 'data-kind': 'default' },
        translate('branch.defaultTag'))
      : null)
}

/** 分支的完整情况放进 title：窄面板里行内放不下，但鼠标停一下要能看到全部事实。 */
function branchTitle(row, translate) {
  const parts = [row.name]
  if (row.current === true) parts.push(translate('branch.currentTag'))
  if (row.default === true) parts.push(translate('branch.defaultTag'))
  if (row.protected === true) parts.push(translate('branch.protectedTag'))
  parts.push(translate(row.local === true ? 'branch.localTag' : 'branch.notLocal'))
  if (row.remote === true) parts.push(translate('branch.remoteTag'))
  else if (row.remote === null) parts.push(translate('branch.remoteUnknown'))
  else parts.push(translate('branch.notOnRemote'))
  if (row.upstreamGone === true || row.upstreamMissing === true) parts.push(translate('branch.upstreamGone'))
  if (row.ahead > 0 || row.behind > 0) {
    parts.push(translate('branch.aheadBehind', { ahead: row.ahead, behind: row.behind }))
  }
  if (row.remoteUpdated === true) parts.push(translate('branch.remoteUpdated'))
  return parts.join(' · ')
}

/** 领先/落后：两边都有值时用一条完整文案，只有一边时只画那一边（不写 ↓0 这种噪音）。 */
function aheadBehindText(row, translate) {
  if (row.ahead > 0 && row.behind > 0) return translate('branch.aheadBehind', { ahead: row.ahead, behind: row.behind })
  if (row.ahead > 0) return '↑' + row.ahead
  return '↓' + row.behind
}

/** 这一行点下去会发生什么；没有主操作时点行 = 打开菜单。 */
function primaryActionOf(row, hasLocalRepo) {
  if (row.current === true) return null
  if (row.local === true) return 'switch'
  if (hasLocalRepo && row.remote === true) return 'track'
  return null
}

export function BranchList(props) {
  const source = props
  const translate = source.t
  const state = source.state === null || source.state === undefined ? null : source.state
  const rawData = state === null || state.data === null || state.data === undefined ? null : state.data
  const selection = source.selection === null || source.selection === undefined ? null : source.selection
  /**
   * 数据是「按仓库」的：切到另一个仓库而新数据还没回来时，手里这份是上一个仓库的分支。
   * 这种情况当加载中处理，不能把别人的分支列表画在标题下面。
   */
  const dataBelongsToSelection = rawData === null || selection === null
    || typeof rawData.fullName !== 'string' || rawData.fullName === selection.fullName
  const data = dataBelongsToSelection ? rawData : null
  const loading = (state !== null && state.loading === true) || (rawData !== null && dataBelongsToSelection !== true)
  const loadError = state !== null && typeof state.error === 'string' && state.error !== '' ? state.error : null
  const branches = data !== null && Array.isArray(data.branches) ? data.branches : []
  const hasLocalRepo = data !== null && data.local !== null && data.local !== undefined
  const localRootPath = hasLocalRepo ? data.local.rootPath : null
  // 分支少时不放筛选框；此时残留的筛选词也必须失效，否则列表看着被过滤却找不到筛选框
  const showFilter = branches.length > 8

  const [filter, setFilter] = useState('')
  // 行尾「⋯」菜单：{ row, rect }
  const [menu, setMenu] = useState(null)
  // 删除确认：{ row, kind: 'local'|'remote', force, error }
  const [confirm, setConfirm] = useState(null)
  // 正在执行操作的物理行名（切换/跟踪/删除共用）
  const [busy, setBusy] = useState(null)
  const [fetching, setFetching] = useState(false)
  // 最近一次操作的结果：{ tone: 'info'|'error', text }
  const [note, setNote] = useState(null)

  const closeMenu = () => setMenu(null)
  const closeConfirm = () => setConfirm(null)

  // 换仓库时把筛选 / 菜单 / 确认 / 提示全部清掉：它们都属于上一个仓库的上下文
  const dataRepo = data === null || typeof data.fullName !== 'string' ? null : data.fullName
  useEffect(() => {
    setFilter('')
    setMenu(null)
    setConfirm(null)
    setNote(null)
  }, [dataRepo])

  const needle = showFilter ? filter.trim().toLowerCase() : ''
  const visible = needle === ''
    ? branches
    : branches.filter((row) => row.name.toLowerCase().includes(needle))

  const openMenu = (row, target) => {
    setNote(null)
    setMenu({ row, rect: target.getBoundingClientRect() })
  }

  const runPrimary = (row, action) => {
    if (busy !== null) return
    setBusy(row.name)
    setNote(null)
    const started = action === 'switch'
      ? source.onSwitchBranch(row)
      : source.onTrackBranch(row)
    Promise.resolve(started)
      .then((result) => {
        setBusy(null)
        if (result !== null && result !== undefined && result.ok === true) {
          setNote({
            tone: 'info',
            text: translate(action === 'switch' ? 'branch.switched' : 'branch.tracked', { name: row.name })
          })
          return
        }
        setNote({ tone: 'error', text: result === null || result === undefined ? translate('branch.failed', { message: '' }) : result.error })
      })
      .catch((error) => {
        setBusy(null)
        setNote({ tone: 'error', text: translate('branch.failed', { message: error && error.message ? error.message : String(error) }) })
      })
  }

  const startDelete = (row, kind) => {
    setMenu(null)
    setNote(null)
    setConfirm({ row, kind, force: false, error: null })
  }

  const runDelete = (force) => {
    if (confirm === null || busy !== null) return
    const { row, kind } = confirm
    setBusy(row.name)
    setNote(null)
    const started = kind === 'local'
      ? source.onDeleteLocalBranch(row, force)
      : source.onDeleteRemoteBranch(row)
    Promise.resolve(started)
      .then((result) => {
        if (result !== null && result !== undefined && result.ok === true) {
          setBusy(null)
          setConfirm(null)
          setNote({
            tone: 'info',
            text: translate(kind === 'local' ? 'branch.deletedLocal' : 'branch.deletedRemote', { name: row.name })
          })
          return
        }
        const error = result === null || result === undefined ? translate('branch.failed', { message: '' }) : result.error
        // 未合并的本地分支：把「强制删除」按钮放出来，让用户明确决定，不默认 force
        if (kind === 'local' && result !== null && result !== undefined && result.code === 'branch-unmerged') {
          setBusy(null)
          setConfirm({ row, kind, force: true, error })
          return
        }
        setBusy(null)
        setConfirm({ row, kind, force: false, error })
      })
      .catch((error) => {
        setBusy(null)
        setConfirm({
          row,
          kind,
          force: false,
          error: translate('branch.failed', { message: error && error.message ? error.message : String(error) })
        })
      })
  }

  const runFetch = () => {
    if (fetching === true) return
    setFetching(true)
    setNote(null)
    Promise.resolve(source.onFetchBranches())
      .then((result) => {
        setFetching(false)
        if (result !== null && result !== undefined && result.ok === true) {
          setNote({ tone: 'info', text: translate('branch.fetchingDone') })
          return
        }
        setNote({ tone: 'error', text: result === null || result === undefined ? translate('branch.failed', { message: '' }) : result.error })
      })
      .catch((error) => {
        setFetching(false)
        setNote({ tone: 'error', text: translate('branch.failed', { message: error && error.message ? error.message : String(error) }) })
      })
  }

  const copyName = (row) => {
    setMenu(null)
    Promise.resolve(copyText(row.name)).then((result) => {
      setNote(result.ok === true
        ? { tone: 'info', text: translate('branch.copied', { name: row.name }) }
        : { tone: 'error', text: translate('branch.failed', { message: String(result.reason) }) })
    })
  }

  const openWeb = (row) => {
    setMenu(null)
    if (data === null || typeof data.htmlUrl !== 'string' || data.htmlUrl === '') return
    if (typeof source.onOpenUrl === 'function') source.onOpenUrl(data.htmlUrl + '/tree/' + encodeURI(row.name))
  }

  const summary = data !== null && data.localKnown === true
    ? translate('branch.summary', { total: branches.length, local: data.counts.local })
    : null
  const remoteShown = branches.filter((row) => row.remote === true).length

  const failures = data !== null && Array.isArray(data.failures) ? data.failures : []

  const statusNodes = []
  if (loadError !== null) {
    statusNodes.push(h('div', { key: 'error', className: 'dgp-branch-status', 'data-tone': 'error' },
      h('span', { className: 'dgp-oneline' }, translate('branch.loadFailed', { message: loadError })),
      h('button', {
        type: 'button',
        className: 'dgp-btn',
        'data-size': 'sm',
        'data-variant': 'ghost',
        'data-dgp-branch-retry': 'true',
        disabled: loading,
        onClick: () => {
          setNote(null)
          if (typeof source.onReloadBranches === 'function') source.onReloadBranches()
        }
      }, translate('action.retry'))))
  } else if (loading === true && data === null) {
    statusNodes.push(h('div', { key: 'loading', className: 'dgp-branch-status' },
      h('span', { className: 'dgp-spinner' }),
      h('span', null, translate('branch.loading'))))
  } else if (loading === true) {
    statusNodes.push(h('div', { key: 'refreshing', className: 'dgp-branch-status' },
      h('span', { className: 'dgp-spinner' }),
      h('span', null, translate('branch.refreshing'))))
  }
  for (const failure of failures) {
    statusNodes.push(h('div', { key: 'failure-' + String(failure.section), className: 'dgp-branch-status', 'data-tone': 'warn' },
      h('span', null, translate('detail.sectionFailed', {
        section: translate(failure.section === 'local' ? 'branch.localTag' : 'branch.remoteTag'),
        message: String(failure.message)
      }))))
  }
  if (note !== null) {
    statusNodes.push(h('div', { key: 'note', className: 'dgp-branch-status', 'data-tone': note.tone === 'error' ? 'error' : 'info' },
      h('span', { className: 'dgp-oneline' }, note.text)))
  }

  const hints = []
  if (data !== null && data.localKnown === true && data.local === null) {
    hints.push(h('div', { key: 'not-cloned', className: 'dgp-branch-hint' }, translate('branch.notCloned')))
  } else if (hasLocalRepo === true) {
    const folder = String(localRootPath).split(/[\\/]/).filter(Boolean).pop() ?? String(localRootPath)
    hints.push(h('div', { key: 'local-repo', className: 'dgp-branch-hint' }, translate('branch.localRepo', { name: folder })))
  }
  if (data !== null && data.truncated === true) {
    hints.push(h('div', { key: 'truncated', className: 'dgp-branch-hint' },
      translate('branch.truncated', { count: remoteShown })))
  }
  if (data !== null && data.remoteKnown === true && remoteShown === 0) {
    hints.push(h('div', { key: 'remote-empty', className: 'dgp-branch-hint' }, translate('branch.emptyRemote')))
  }

  const rows = visible.map((row) => {
    const action = primaryActionOf(row, hasLocalRepo === true)
    const rowBusy = busy === row.name
    const confirmHere = confirm !== null && confirm.row.name === row.name
    const canDeleteLocal = row.local === true
    const canDeleteRemote = row.remote === true
    return h('li', {
      key: row.name,
      className: 'dgp-branch-item',
      'data-current': row.current === true ? 'true' : undefined,
      'data-busy': rowBusy ? 'true' : undefined
    },
    h('button', {
      type: 'button',
      className: 'dgp-branch-row',
      'data-dgp-branch-row': row.name,
      title: branchTitle(row, translate),
      disabled: rowBusy,
      onClick: (event) => {
        const target = event.currentTarget
        if (action === null) {
          openMenu(row, target)
          return
        }
        runPrimary(row, action)
      }
    },
    h('span', {
      className: 'dgp-branch-ico',
      'data-current': row.current === true ? 'true' : undefined
    }, h(Icon, { name: row.current === true ? 'check' : 'git-branch', size: 12 })),
    h('span', { className: 'dgp-branch-name dgp-oneline' }, row.name),
    row.ahead > 0 || row.behind > 0
      ? h('span', { className: 'dgp-branch-track' }, aheadBehindText(row, translate))
      : null,
    branchTags(row, translate)),
    h('button', {
      type: 'button',
      className: 'dgp-branch-more',
      'data-dgp-branch-more': row.name,
      title: translate('branch.more'),
      'aria-label': translate('branch.more'),
      disabled: rowBusy,
      onClick: (event) => {
        event.stopPropagation()
        openMenu(row, event.currentTarget)
      }
    }, rowBusy ? h('span', { className: 'dgp-spinner' }) : h(Icon, { name: 'more', size: 12 })),
    confirmHere
      ? h('div', { className: 'dgp-branch-confirm', 'data-dgp-branch-confirm': confirm.kind },
        h('div', { className: 'dgp-branch-confirm-text' },
          translate(confirm.kind === 'local' ? 'branch.deleteLocalConfirm' : 'branch.deleteRemoteConfirm', { name: row.name })),
        confirm.error === null
          ? null
          : h('div', { className: 'dgp-branch-status', 'data-tone': 'error' }, h('span', null, confirm.error)),
        h('div', { className: 'dgp-branch-confirm-actions' },
          h('button', {
            type: 'button',
            className: 'dgp-btn',
            'data-size': 'sm',
            'data-variant': 'ghost',
            disabled: busy !== null,
            onClick: closeConfirm
          }, translate('action.cancel')),
          confirm.force === true
            ? h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-variant': 'danger',
              'data-dgp-branch-delete-force': row.name,
              disabled: busy !== null,
              onClick: () => runDelete(true)
            }, translate('branch.deleteForce'))
            : null,
          h('button', {
            type: 'button',
            className: 'dgp-btn',
            'data-size': 'sm',
            'data-variant': 'danger',
            'data-dgp-branch-delete-run': row.name,
            disabled: busy !== null,
            onClick: () => runDelete(confirm.force === true)
          }, translate('branch.deleteRun'))))
      : null)
  })

  const menuRow = menu === null ? null : menu.row
  const menuNode = menuRow === null
    ? null
    : h(PopupMenu, { open: true, anchorRect: menu.rect, onClose: closeMenu, minWidth: 220 },
      h(MenuLabel, null, menuRow.name),
      menuRow.current === true
        ? null
        : (menuRow.local === true
          ? h(MenuItem, {
            icon: 'git-branch',
            label: translate('branch.switchTo', { name: menuRow.name }),
            dataKey: 'branch-switch',
            disabled: busy !== null,
            onClick: () => {
              setMenu(null)
              runPrimary(menuRow, 'switch')
            }
          })
          : (hasLocalRepo === true && menuRow.remote === true
            ? h(MenuItem, {
              icon: 'plus',
              label: translate('branch.track'),
              dataKey: 'branch-track',
              disabled: busy !== null,
              onClick: () => {
                setMenu(null)
                runPrimary(menuRow, 'track')
              }
            })
            : h(MenuLabel, null, translate('branch.noLocalOps')))),
      h('div', { className: 'dgp-menu-sep', role: 'separator' }),
      h(MenuItem, {
        icon: 'file',
        label: translate('branch.copy'),
        dataKey: 'branch-copy',
        onClick: () => copyName(menuRow)
      }),
      h(MenuItem, {
        icon: 'external',
        label: translate('branch.openWeb'),
        dataKey: 'branch-open',
        disabled: data === null || typeof data.htmlUrl !== 'string' || data.htmlUrl === '',
        onClick: () => openWeb(menuRow)
      }),
      h('div', { className: 'dgp-menu-sep', role: 'separator' }),
      canDeleteMenuLocal(menuRow)
        ? h(MenuItem, {
          icon: 'trash',
          label: translate('branch.deleteLocal'),
          dataKey: 'branch-delete-local',
          danger: true,
          disabled: busy !== null,
          onClick: () => startDelete(menuRow, 'local')
        })
        : h(MenuItem, {
          icon: 'trash',
          label: translate('branch.deleteLocal'),
          dataKey: 'branch-delete-local-disabled',
          sub: canDeleteLocalReason(menuRow, translate),
          disabled: true
        }),
      canDeleteMenuRemote(menuRow)
        ? h(MenuItem, {
          icon: 'trash',
          label: translate('branch.deleteRemote'),
          dataKey: 'branch-delete-remote',
          danger: true,
          disabled: busy !== null,
          onClick: () => startDelete(menuRow, 'remote')
        })
        : h(MenuItem, {
          icon: 'trash',
          label: translate('branch.deleteRemote'),
          dataKey: 'branch-delete-remote-disabled',
          sub: canDeleteRemoteReason(menuRow, translate),
          disabled: true
        }))

  if (data === null && loadError === null && loading !== true) return null

  return h('section', { className: 'dgp-branch-section', 'data-dgp-branch': 'section' },
    h('div', { className: 'dgp-branch-head' },
      h('span', { className: 'dgp-branch-title' }, translate('branch.sectionTitle')),
      summary === null ? null : h('span', { className: 'dgp-branch-summary dgp-oneline' }, summary),
      h('div', { className: 'dgp-branch-head-actions' },
        hasLocalRepo
          ? h('button', {
            type: 'button',
            className: 'dgp-iconbtn',
            style: { width: 22, height: 22 },
            title: translate('branch.fetch'),
            'aria-label': translate('branch.fetch'),
            'data-dgp-branch-fetch': 'true',
            disabled: fetching,
            onClick: runFetch
          }, fetching ? h('span', { className: 'dgp-spinner' }) : h(Icon, { name: 'sync', size: 12 }))
          : null,
        h('button', {
          type: 'button',
          className: 'dgp-iconbtn',
          style: { width: 22, height: 22 },
          title: translate('remote.refresh'),
          'aria-label': translate('remote.refresh'),
          'data-dgp-branch-refresh': 'true',
          disabled: loading,
          onClick: () => {
            setNote(null)
            if (typeof source.onReloadBranches === 'function') source.onReloadBranches()
          }
        }, h(Icon, { name: 'refresh', size: 12 })))),
    showFilter
      ? h('input', {
        className: 'dgp-input dgp-branch-filter',
        'data-dgp-branch-filter': 'true',
        placeholder: translate('branch.filter'),
        spellCheck: false,
        value: filter,
        onChange: (event) => setFilter(event.target.value),
        onKeyDown: (event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            setFilter('')
          }
        }
      })
      : null,
    statusNodes.length > 0 ? h('div', { className: 'dgp-branch-statuses' }, statusNodes) : null,
    data !== null && visible.length === 0
      ? h('div', { className: 'dgp-branch-empty' }, branches.length === 0 ? translate('branch.empty') : '')
      : h('ul', { className: 'dgp-branch-list', role: 'list' }, rows),
    hints.length > 0 ? h('div', null, hints) : null,
    menuNode)
}

/** 删除本地分支：当前分支不能删；只读行（无本地仓库）没有这个动作的来源。 */
function canDeleteMenuLocal(row) {
  return row.local === true && row.current !== true
}

function canDeleteLocalReason(row, translate) {
  if (row.local !== true) return translate('branch.noLocalOps')
  return translate('branch.currentNoDelete')
}

/** 删除远端分支：远端已知且存在，并且不是默认 / 受保护分支。 */
function canDeleteMenuRemote(row) {
  return row.remote === true && row.default !== true && row.protected !== true
}

function canDeleteRemoteReason(row, translate) {
  if (row.remote === null) return translate('branch.remoteUnknown')
  if (row.remote !== true) return translate('branch.notOnRemote')
  if (row.default === true) return translate('branch.defaultNoDelete')
  return translate('branch.protectedNoDelete')
}
