/**
 * src/components/RepoList.js —— 「储存库」区域（VS Code 的 Repositories）
 *
 * 结构：
 *   div.dgp-repolist
 *   ├─ div.dgp-repolist-head
 *   │  ├─ button.dgp-repolist-toggle   ← 折叠/展开，带数量
 *   │  ├─ button[data-dgp-repolist-hidden] ← 有隐藏仓库时才出现：展开/收起它们
 *   │  └─ button[data-action=add-root] ← 添加外部仓库
 *   ├─ ul.dgp-level
 *   │  └─ li > div.dgp-row-wrap
 *   │     ├─ button.dgp-repo-row[data-dgp-repo][data-hidden] ← 只选中该仓库，不打开分支菜单
 *   │     ├─ span.dgp-repo-stats[data-dgp-repo-stats]        ← 改动文件数 + 增删行数（有改动才出现）
 *   │     ├─ button.dgp-repo-branch[data-dgp-branch] ← 贴在行的最右侧；只有点它才打开分支菜单
 *   │     └─ AddRootForm / 分支菜单（菜单里也能隐藏 / 取消隐藏 / 移除）
 *
 * 分支菜单的取数、切换与创建都通过 props 交给 Panel：这里只负责交互与错误呈现，
 * 切换失败（例如本地改动会被覆盖）原样显示 git 的话，让用户自己决定怎么处理。
 */
import { h, useRef, useState } from '../platform.js'
import { Icon } from '../ui/Icon.js'
import { MenuItem, MenuLabel, PopupMenu } from '../ui/Menu.js'
import { AddRootForm } from './AddRootForm.js'
import { stripWrappingQuotes } from '../util/paths.js'

/**
 * 分支菜单的初始状态。
 *
 * 打开菜单与「根操作失败后重开菜单」共用这一份：字段集合（尤其 `state` / `base` /
 * `checkout` / `blocked`）只在这里定义一次，不至于两处各写一遍慢慢长歪。
 */
function emptyBranchMenu(root, rect, seq) {
  return {
    root,
    rect,
    seq,
    list: [],
    current: null,      // branches/list 的 current：当前分支名（游离 HEAD 时为 null）
    state: null,        // branches/list 的 state：head / detached / unborn / inProgress / dirty
    loading: true,
    switching: null,
    creating: false,
    fetching: false,
    pulling: false,
    name: '',
    base: 'HEAD',       // 创建基准；'HEAD' = 从当前 HEAD 建（零风险路径）
    checkout: true,     // 建完是否立刻切过去
    blocked: null,      // 撞车说明（would-overwrite 的 message），非空时只给两个出口
    error: null,
    filter: ''
  }
}

/**
 * 「从哪开新分支」的候选：当前分支 + 其它本地分支 + 远端分支。
 *
 * 数据全部来自 `branches/list`，所以切换它不需要任何额外请求。
 * 选项带上「（本地）/（远端）」后缀：只写 `origin/dev` 对不熟 git 的人等于天书。
 */
function baseOptionsOf(branches, current, t) {
  const options = [{ ref: 'HEAD', label: t('branch.baseHead', { branch: current ?? t('root.noBranch') }) }]
  const seen = new Set(['HEAD'])
  // 先本地分支、再远端引用：本地分支是更常用的起点，混在一起会把列表打散
  for (const branch of branches) {
    if (branch.local !== true || branch.current === true || seen.has(branch.name)) continue
    seen.add(branch.name)
    options.push({ ref: branch.name, label: t('branch.baseLocalOption', { name: branch.name }) })
  }
  for (const branch of branches) {
    if (branch.remote === null) continue
    const ref = branch.remote + '/' + branch.name
    if (seen.has(ref)) continue
    seen.add(ref)
    options.push({ ref, label: t('branch.baseRemoteOption', { ref }) })
  }
  return options
}

/** 输入的名字恰好是一个「仅远端」分支时，返回 `origin/x`（提示用，不改变默认行为）。 */
function sameRemoteOf(branches, name) {
  if (name === '') return null
  for (const branch of branches) {
    if (branch.name !== name || branch.local === true) continue
    if (branch.remote !== null) return branch.remote + '/' + name
  }
  return null
}

/** 进行中的多步操作 → 文案 key。 */
const PROGRESS_KEYS = {
  merge: 'branch.progressMerge',
  rebase: 'branch.progressRebase',
  'cherry-pick': 'branch.progressCherryPick',
  revert: 'branch.progressRevert'
}

/** 分支多到这个数才放筛选框：少数分支时它只是噪音。 */
const BRANCH_FILTER_THRESHOLD = 8

export function RepoList(props) {
  const { roots, activeRootId, open, stats, onToggleOpen, onSelect, onAdd, onHide, onUnhide, onRemove, onLoadBranches, onSwitchBranch, onTrackBranch, onPullBranch, onFetchBranches, onCreateBranch, t } = props
  const [formOpen, setFormOpen] = useState(false)
  /** 已隐藏的仓库默认收起；这里只记「要不要放出来看」，持久化的是隐藏列表本身。 */
  const [showHidden, setShowHidden] = useState(false)
  const [branchMenu, setBranchMenu] = useState(null)
  /** 菜单世代号：晚到的响应只能写回「发起它的那一次打开」的菜单。 */
  const menuSeqRef = useRef(0)

  if (roots.length === 0) return null

  const visibleRoots = roots.filter((root) => root.hidden !== true)
  const hiddenRoots = roots.filter((root) => root.hidden === true)
  const listedRoots = showHidden ? visibleRoots.concat(hiddenRoots) : visibleRoots

  const closeForm = () => setFormOpen(false)
  const closeBranches = () => setBranchMenu(null)

  /**
   * 打开一份新菜单：seq 自增一次。
   * 之后所有异步结果都带着这个 seq 回来，只写回同一次打开的菜单 ——
   * 否则「点 A 建分支 → 关掉 → 再打开 A → 旧响应落地」会把旧错误/旧列表画上去。
   */
  const openBranches = (root, rect) => {
    menuSeqRef.current += 1
    setBranchMenu(emptyBranchMenu(root, rect, menuSeqRef.current))
  }

  /** 同步修补当前菜单（输入框、勾选框这类只可能属于屏幕上这一份菜单的操作）。 */
  const patchMenu = (patch) => {
    setBranchMenu((previous) => (previous === null ? null : { ...previous, ...patch }))
  }

  /** 异步结果：只写给「发起它的同一份菜单」。 */
  const patchMenuFor = (menu, patch) => {
    setBranchMenu((previous) => (previous !== null && previous.seq === menu.seq ? { ...previous, ...patch } : previous))
  }

  /** 异步成功：只有菜单还停在发起它的那一份时才关掉。 */
  const closeMenuFor = (menu) => {
    setBranchMenu((previous) => (previous !== null && previous.seq === menu.seq ? null : previous))
  }

  /** 隐藏 / 取消隐藏 / 移除：都从分支菜单触发，执行后关掉菜单；失败就把菜单重开在最上面报错。 */
  const runRootAction = (handler, root) => {
    closeBranches()
    handler(root).catch((error) => {
      menuSeqRef.current += 1
      setBranchMenu({
        ...emptyBranchMenu(root, null, menuSeqRef.current),
        loading: false,
        error: error.message
      })
    })
  }

  const loadBranches = (root, rect) => {
    openBranches(root, rect)
    const menu = { root, seq: menuSeqRef.current }
    onLoadBranches(root).then((value) => {
      patchMenuFor(menu, {
        list: value.branches,
        current: value.current,
        state: value.state,
        loading: false,
        // 合并 / 变基进行中 git 不允许切分支：默认就落在「只建分支」上，不摆一个必然失败的勾选
        checkout: value.state.inProgress === null
      })
    }, (error) => {
      patchMenuFor(menu, { loading: false, error: error.message })
    })
  }

  const chooseBranch = (menu, name) => {
    patchMenu({ switching: name, error: null })
    onSwitchBranch(menu.root, name).then(() => closeMenuFor(menu), (error) => {
      patchMenuFor(menu, { switching: null, error: error.message })
    })
  }

  /**
   * 拉取当前分支最新代码（真正的 pull）。
   * 与「获取远程更新」不同：那只是 fetch（更新远端跟踪引用），不会改工作区文件。
   */
  const pullCurrent = (menu) => {
    patchMenu({ pulling: true, error: null })
    onPullBranch(menu.root).then(() => closeMenuFor(menu), (error) => {
      patchMenuFor(menu, { pulling: false, error: error.message })
    })
  }

  /** 拉取远程更新（git fetch）后重读分支列表：别人新推的分支这时才会出现。 */
  const fetchRemote = (menu) => {
    patchMenu({ fetching: true, error: null, blocked: null })
    onFetchBranches(menu.root).then((value) => {
      patchMenuFor(menu, {
        fetching: false,
        list: value.branches,
        current: value.current,
        state: value.state
      })
    }, (error) => {
      patchMenuFor(menu, { fetching: false, error: error.message })
    })
  }

  /** 「仅远程」的分支：建本地跟踪分支并切过去。 */
  const trackBranch = (menu, branch) => {
    patchMenu({ switching: branch.ref, error: null })
    onTrackBranch(menu.root, branch).then(() => closeMenuFor(menu), (error) => {
      patchMenuFor(menu, { switching: null, error: error.message })
    })
  }

  const changeCreateName = (value) => patchMenu({ name: value, error: null, blocked: null })
  const changeBase = (value) => patchMenu({ base: value, error: null, blocked: null })
  const changeCheckout = (value) => patchMenu({ checkout: value, error: null, blocked: null })

  /**
   * 创建分支：默认从当前 HEAD 建并切过去。
   *
   * `overrides` 是撞车后两个出口用的（改为从当前分支创建 / 只建分支），
   * 它们都是「同一件事换个参数重试一次」，所以共用这一条路径。
   */
  const runCreate = (menu, overrides = {}) => {
    const name = stripWrappingQuotes(menu.name)
    if (name === '' || menu.creating || menu.switching !== null) return
    const base = overrides.base ?? menu.base
    const checkout = overrides.checkout ?? menu.checkout
    patchMenuFor(menu, { ...overrides, name, creating: true, error: null, blocked: null })
    onCreateBranch(menu.root, { name, base, checkout }).then(() => closeMenuFor(menu), (error) => {
      patchMenuFor(menu, {
        creating: false,
        error: error.message,
        // 撞车不是「失败」而是「需要换个选择」：单独呈现，并给出两个零风险出口
        blocked: error.code === 'would-overwrite' ? error.message : null
      })
    })
  }

  const menuBranches = branchMenu === null ? [] : branchMenu.list
  /** 副标题只留会变化的信息：↑n ↓m，或上游被删 */
  const branchMeta = (branch) => {
    const parts = []
    if (branch.upstreamGone === true) parts.push(t('branch.upstreamGone'))
    if (branch.ahead > 0) parts.push('↑' + branch.ahead)
    if (branch.behind > 0) parts.push('↓' + branch.behind)
    return parts.join(' ')
  }
  const branchBadges = (branch) => [
    { label: t('branch.localTag'), active: branch.local === true },
    { label: t('branch.remoteTag'), active: branch.remote !== null }
  ]

  const menuBusy = branchMenu !== null && (branchMenu.switching !== null || branchMenu.creating || branchMenu.fetching || branchMenu.pulling)
  const createName = branchMenu === null ? '' : stripWrappingQuotes(branchMenu.name)
  /**
   * 创建区的现状提示。三件事各自独立，所以分开渲染而不是拼一坨：
   *  · 有合并 / 变基在跑 → git 不允许切分支，只能只建分支；
   *  · 工作区脏 → 说清有多少改动会跟着走（base=HEAD 时这是零风险路径）；
   *  · 输入的名字恰好是已有远端分支 → 提示要跟踪该选哪个基准。
   */
  const branchState = branchMenu === null ? null : branchMenu.state
  const inProgress = branchState === null ? null : branchState.inProgress
  const progressKey = inProgress === null ? null : PROGRESS_KEYS[inProgress]
  const sameRemote = branchMenu === null ? null : sameRemoteOf(branchMenu.list, createName)
  const baseOptions = branchMenu === null ? [] : baseOptionsOf(branchMenu.list, branchMenu.current, t)
  const dirtyHint = branchState === null || branchState.dirty.total === 0
    ? null
    : t('branch.dirtyHint', {
      branch: branchMenu.current ?? t('root.noBranch'),
      total: branchState.dirty.total,
      staged: branchState.dirty.staged
    })
  /**
   * 选了「不是当前分支」当起点时，用一句人话说明后果。
   * 这个下拉框对不熟 git 的人很难自解释，只靠 tooltip 不够 —— 选项一改就把话说出来。
   */
  const baseIsHead = branchMenu === null || branchMenu.base === 'HEAD'
  const baseNote = baseIsHead
    ? null
    : (branchState !== null && branchState.dirty.total > 0
      ? t('branch.baseNoteDirty', { base: branchMenu.base, total: branchState.dirty.total })
      : t('branch.baseNoteClean', { base: branchMenu.base }))
  const branchFilter = branchMenu === null ? '' : branchMenu.filter.trim().toLowerCase()
  const listedBranches = branchFilter === ''
    ? menuBranches
    : menuBranches.filter((branch) => branch.name.toLowerCase().includes(branchFilter))
  const branchMenuNode = branchMenu === null
    ? null
    : h(PopupMenu, { open: true, anchorRect: branchMenu.rect, onClose: closeBranches, minWidth: 240 },
      h(MenuLabel, null, t('branch.title', { name: branchMenu.root.name })),
      h(MenuItem, {
        icon: 'refresh',
        label: branchMenu.pulling ? t('branch.pulling') : t('branch.pull'),
        disabled: menuBusy,
        dataKey: 'pull-branch',
        onClick: () => pullCurrent(branchMenu)
      }),
      h(MenuItem, {
        icon: 'sync',
        label: branchMenu.fetching ? t('branch.fetching') : t('branch.fetch'),
        disabled: menuBusy,
        dataKey: 'fetch-branches',
        onClick: () => fetchRemote(branchMenu)
      }),
      h('div', { className: 'dgp-menu-sep', role: 'separator' }),
      menuBranches.length > BRANCH_FILTER_THRESHOLD
        ? h('div', { className: 'dgp-branch-filter' },
          h(Icon, { name: 'search', size: 12 }),
          h('input', {
            className: 'dgp-input',
            type: 'search',
            'data-dgp-branch-filter': 'true',
            placeholder: t('branch.filterPlaceholder'),
            value: branchMenu.filter,
            spellCheck: false,
            onChange: (event) => patchMenu({ filter: event.target.value }),
            onKeyDown: (event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                patchMenu({ filter: '' })
              }
            }
          }))
        : null,
      branchMenu.loading ? h(MenuLabel, null, t('branch.loading')) : null,
      listedBranches.map((branch) => h(MenuItem, {
        key: branch.name,
        label: branch.name,
        badges: branchBadges(branch),
        sub: branchMeta(branch),
        checked: branch.current,
        disabled: menuBusy,
        dataKey: 'branch:' + branch.name,
        // 只有远程的行：点一下在本地创建并切过去（不写长文案，放 title 里）
        title: branch.local !== true ? t('branch.trackHint', { ref: branch.remote + '/' + branch.name }) : undefined,
        onClick: () => {
          if (branch.current) closeBranches()
          else if (branch.local === true) chooseBranch(branchMenu, branch.name)
          else trackBranch(branchMenu, branch)
        }
      })),
      menuBranches.length > 0 && listedBranches.length === 0
        ? h(MenuLabel, null, t('branch.noMatch', { filter: branchMenu.filter }))
        : null,
      branchMenu.list.length === 0 && branchMenu.loading !== true
        ? h(MenuLabel, null, t('branch.empty'))
        : null,
      h('div', { className: 'dgp-menu-sep', role: 'separator' }),
      h('form', {
        className: 'dgp-branch-create',
        'data-dgp-branch-create': 'true',
        onSubmit: (event) => {
          event.preventDefault()
          runCreate(branchMenu)
        }
      },
      h('div', { className: 'dgp-branch-create-row' },
        h('input', {
          className: 'dgp-input',
          'data-dgp-branch-name': 'true',
          value: branchMenu.name,
          placeholder: t('branch.createPlaceholder'),
          spellCheck: false,
          disabled: menuBusy,
          onChange: (event) => changeCreateName(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              closeBranches()
            }
          }
        }),
        h('button', {
          type: 'submit',
          className: 'dgp-btn',
          'data-size': 'sm',
          'data-variant': 'primary',
          'data-dgp-branch-create-submit': 'true',
          disabled: menuBusy || createName === '',
          title: t(branchMenu.checkout ? 'branch.create' : 'branch.createOnly')
        }, t(branchMenu.checkout ? 'branch.create' : 'branch.createOnly'))),
      h('div', { className: 'dgp-branch-create-opts' },
        h('span', { className: 'dgp-branch-base-label' }, t('branch.baseLabel')),
        h('select', {
          className: 'dgp-input dgp-branch-base',
          'data-dgp-branch-base': 'true',
          value: branchMenu.base,
          disabled: menuBusy,
          title: t('branch.baseHint'),
          onChange: (event) => changeBase(event.target.value)
        }, baseOptions.map((option) => h('option', { key: option.ref, value: option.ref }, option.label))),
        h('label', { className: 'dgp-branch-check', title: t('branch.checkoutHint') },
          h('input', {
            type: 'checkbox',
            'data-dgp-branch-checkout': 'true',
            checked: branchMenu.checkout,
            disabled: menuBusy || inProgress !== null,
            onChange: (event) => changeCheckout(event.target.checked)
          }),
          t('branch.checkoutLabel'))),
      baseNote === null
        ? null
        : h('p', {
          className: 'dgp-branch-hint',
          'data-dgp-branch-base-note': branchMenu.base
        }, baseNote),
      progressKey === null
        ? null
        : h('p', {
          className: 'dgp-branch-hint',
          'data-dgp-branch-dirty': 'in-progress',
          'data-tone': 'warn'
        }, t('branch.inProgressHint', {
          kind: t(progressKey),
          action: t('branch.createOnlyAction')
        })),
      dirtyHint === null
        ? null
        : h('p', { className: 'dgp-branch-hint', 'data-dgp-branch-dirty': 'dirty' }, dirtyHint),
      sameRemote === null
        ? null
        : h('p', {
          className: 'dgp-branch-hint',
          'data-dgp-branch-same-remote': sameRemote
        }, t('branch.sameRemoteHint', { ref: sameRemote })),
      // 撞车 = 「需要换个选择」，不是失败：说清冲突文件，并只给两个零风险出口
      branchMenu.blocked === null
        ? null
        : h('div', { className: 'dgp-branch-blocked', 'data-dgp-branch-blocked': 'true' },
          h('p', { className: 'dgp-branch-hint', 'data-tone': 'warn' }, branchMenu.blocked),
          h('div', { className: 'dgp-branch-actions' },
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-dgp-branch-from-head': 'true',
              disabled: menuBusy,
              onClick: () => runCreate(branchMenu, { base: 'HEAD', checkout: true })
            }, t('branch.fromHead')),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-dgp-branch-only': 'true',
              disabled: menuBusy,
              onClick: () => runCreate(branchMenu, { checkout: false })
            }, t('branch.createOnlyAction'))))),
      branchMenu.switching === null
        ? null
        : h(MenuLabel, null, t('branch.switching', { name: branchMenu.switching })),
      branchMenu.creating !== true
        ? null
        : h(MenuLabel, null, t(branchMenu.checkout ? 'branch.creating' : 'branch.creatingOnly', { name: createName })),
      branchMenu.error === null || branchMenu.blocked !== null
        ? null
        : h(MenuLabel, null, t('branch.failed', { message: branchMenu.error })),
      branchMenu.root.kind === 'primary'
        ? null
        : h('div', { className: 'dgp-menu-sep', role: 'separator' }),
      branchMenu.root.kind === 'primary'
        ? null
        : (branchMenu.root.hidden === true
          ? h(MenuItem, {
            icon: 'eye',
            label: t('roots.unhide', { name: branchMenu.root.name }),
            dataKey: 'repo-unhide',
            onClick: () => runRootAction(onUnhide, branchMenu.root)
          })
          : h(MenuItem, {
            icon: 'eye-off',
            label: t('roots.hide', { name: branchMenu.root.name }),
            dataKey: 'repo-hide',
            onClick: () => runRootAction(onHide, branchMenu.root)
          })),
      branchMenu.root.kind === 'extra'
        ? h(MenuItem, {
          icon: 'trash',
          label: t('toolbar.removeRoot', { name: branchMenu.root.name }),
          dataKey: 'repo-remove',
          onClick: () => runRootAction(onRemove, branchMenu.root)
        })
        : null)

  /**
   * 行上的改动规模：只显示「有改动」的仓库。
   * 单个仓库失败给一个可悬停的 `!`，不把整张列表变成错误态。
   */
  const renderStats = (root) => {
    const summary = stats[root.path]
    if (summary === undefined) return null
    if (summary.error !== undefined) {
      return h('span', {
        className: 'dgp-repo-stats',
        'data-dgp-repo-stats': 'error',
        title: summary.error
      }, '!')
    }
    const { counts, adds, dels, binary } = summary
    if (counts.total === 0) return null
    const title = binary > 0
      ? t('roots.statsTitleBinary', { files: counts.total, binary, adds, dels })
      : t('roots.statsTitle', { files: counts.total, adds, dels })
    return h('span', {
      className: 'dgp-repo-stats',
      'data-dgp-repo-stats': String(counts.total),
      title,
      'aria-label': title
    },
    h(Icon, { name: 'file', size: 12 }),
    h('span', { className: 'dgp-repo-stats-files' }, String(counts.total)),
    adds > 0 ? h('span', { className: 'dgp-add' }, '+' + adds) : null,
    dels > 0 ? h('span', { className: 'dgp-del' }, '−' + dels) : null,
    counts.conflicted > 0
      ? h('span', { className: 'dgp-repo-conflict', title: t('group.conflicted') }, '!')
      : null)
  }

  return h('div', { className: 'dgp-repolist', 'data-dgp-repolist': 'true' },
    h('div', { className: 'dgp-repolist-head' },
      h('button', {
        type: 'button',
        className: 'dgp-repolist-toggle',
        'data-dgp-repolist-toggle': 'true',
        'data-open': open ? 'true' : 'false',
        'aria-expanded': open,
        onClick: onToggleOpen
      },
      h('span', { className: 'dgp-caret', 'data-open': open ? 'true' : 'false' },
        h(Icon, { name: 'chevron-right', size: 12 })),
      h('span', { className: 'dgp-repolist-title' }, t('roots.title')),
      h('span', { className: 'dgp-group-count' }, String(visibleRoots.length))),
      hiddenRoots.length === 0
        ? null
        : h('button', {
          type: 'button',
          className: 'dgp-iconbtn',
          style: { width: 22, height: 22, gap: 2 },
          'data-dgp-repolist-hidden': showHidden ? 'true' : 'false',
          'aria-pressed': showHidden,
          title: t(showHidden ? 'roots.hiddenCollapse' : 'roots.hiddenShow', { count: hiddenRoots.length }),
          'aria-label': t(showHidden ? 'roots.hiddenCollapse' : 'roots.hiddenShow', { count: hiddenRoots.length }),
          onClick: () => setShowHidden((previous) => !previous)
        },
        h(Icon, { name: showHidden ? 'eye-off' : 'eye', size: 14 }),
        h('span', { className: 'dgp-repolist-hidden-count' }, String(hiddenRoots.length))),
      h('button', {
        type: 'button',
        className: 'dgp-iconbtn',
        style: { width: 22, height: 22 },
        'data-action': 'add-root',
        title: t('toolbar.addRoot'),
        'aria-label': t('toolbar.addRoot'),
        onClick: () => setFormOpen((previous) => !previous)
      }, h(Icon, { name: 'plus', size: 14 }))),

    open
      ? h('ul', { className: 'dgp-level dgp-repolist-rows', role: 'none' },
        listedRoots.map((root) => {
          const hidden = root.hidden === true
          const hasBranch = root.branch !== null && root.branch !== ''
          return h('li', { key: root.id, className: 'dgp-item' },
            h('div', {
              className: 'dgp-row-wrap dgp-repo-wrap',
              'data-active': !hidden && root.id === activeRootId ? 'true' : 'false',
              'data-hidden': hidden ? 'true' : undefined
            },
            h('button', {
              type: 'button',
              className: 'dgp-row dgp-repo-row',
              'data-dgp-repo': root.id,
              'data-active': !hidden && root.id === activeRootId ? 'true' : 'false',
              'data-hidden': hidden ? 'true' : undefined,
              'aria-current': !hidden && root.id === activeRootId ? 'true' : undefined,
              title: root.path,
              onClick: () => {
                // 已隐藏的行不参与切换：先取消隐藏，才能重新成为当前仓库
                if (hidden) return
                onSelect(root)
              }
            },
            h(Icon, { name: 'git-branch', size: 14 }),
            h('span', { className: 'dgp-name dgp-oneline' }, root.name)),
            // 改动规模：有改动才出现，没有改动时保持行安静
            renderStats(root),
            // 分支按钮是所有仓库操作（分支 / 拉取 / 隐藏 / 移除）的入口
            h('button', {
              type: 'button',
              className: 'dgp-repo-branch dgp-oneline',
              'data-dgp-branch': root.id,
              title: t(hidden ? 'branch.hintHidden' : 'branch.hint', {
                branch: hasBranch ? root.branch : t('root.noBranch')
              }),
              onClick: (event) => {
                event.stopPropagation()
                loadBranches(root, event.currentTarget.getBoundingClientRect())
              }
            }, hasBranch ? root.branch : t('root.noBranch'))))
        })
      )
      : null,

    open && formOpen
      ? h(AddRootForm, {
        t,
        onCancel: closeForm,
        onAdd: async (dir) => {
          await onAdd(dir)
          setFormOpen(false)
        }
      })
      : null,

    branchMenuNode)
}
