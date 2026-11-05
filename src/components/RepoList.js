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
 *   │     ├─ button.dgp-repo-branch[data-dgp-branch] ← 贴在行的最右侧；只有点它才打开分支菜单
 *   │     ├─ button.dgp-row-action[data-dgp-repo-hide]   ← 从储存库隐藏（项目本身不可隐藏）
 *   │     ├─ button.dgp-row-action[data-dgp-repo-unhide] ← 已隐藏的行：取消隐藏
 *   │     └─ button.dgp-row-action[data-dgp-repo-remove] ← 仅外部仓库：移除
 *   ├─ AddRootForm（展开时）
 *   └─ PopupMenu（分支菜单：切换已有分支，或输入名字创建并切过去）
 *
 * 分支菜单的取数、切换与创建都通过 props 交给 Panel：这里只负责交互与错误呈现，
 * 切换失败（例如本地改动会被覆盖）原样显示 git 的话，让用户自己决定怎么处理。
 */
import { h, useState } from '../platform.js'
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
function emptyBranchMenu(root, rect) {
  return {
    root,
    rect,
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
    error: null
  }
}

/**
 * 「从哪开新分支」的候选：当前分支 + 其它本地分支 + 远端分支。
 *
 * 数据全部来自 `branches/list`，所以切换它不需要任何额外请求。
 * 选项带上「（本地）/（远端）」后缀：只写 `origin/dev` 对不熟 git 的人等于天书。
 */
function baseOptionsOf(branches, current, translate) {
  const options = [{ ref: 'HEAD', label: translate('branch.baseHead', { branch: current ?? translate('root.noBranch') }) }]
  const seen = new Set(['HEAD'])
  // 先本地分支、再远端引用：本地分支是更常用的起点，混在一起会把列表打散
  for (const branch of branches) {
    if (branch.local !== true || branch.current === true || seen.has(branch.name)) continue
    seen.add(branch.name)
    options.push({ ref: branch.name, label: translate('branch.baseLocalOption', { name: branch.name }) })
  }
  for (const branch of branches) {
    if (typeof branch.remote !== 'string' || branch.remote === '') continue
    const ref = branch.remote + '/' + branch.name
    if (seen.has(ref)) continue
    seen.add(ref)
    options.push({ ref, label: translate('branch.baseRemoteOption', { ref }) })
  }
  return options
}

/** 输入的名字恰好是一个「仅远端」分支时，返回 `origin/x`（提示用，不改变默认行为）。 */
function sameRemoteOf(branches, name) {
  if (name === '') return null
  for (const branch of branches) {
    if (branch.name !== name || branch.local === true) continue
    if (typeof branch.remote === 'string' && branch.remote !== '') return branch.remote + '/' + name
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

export function RepoList(props) {
  const source = props
  const translate = source.t
  const roots = Array.isArray(source.roots) ? source.roots : []
  const activeRootId = typeof source.activeRootId === 'string' ? source.activeRootId : null
  const open = source.open !== false
  const [formOpen, setFormOpen] = useState(false)
  /** 已隐藏的仓库默认收起；这里只记「要不要放出来看」，持久化的是隐藏列表本身。 */
  const [showHidden, setShowHidden] = useState(false)
  // 分支菜单：{ root, rect, list, loading, switching, creating, name, error }
  const [branchMenu, setBranchMenu] = useState(null)

  if (roots.length === 0) return null

  const visibleRoots = roots.filter((root) => root.hidden !== true)
  const hiddenRoots = roots.filter((root) => root.hidden === true)
  const listedRoots = showHidden ? visibleRoots.concat(hiddenRoots) : visibleRoots

  const closeForm = () => setFormOpen(false)
  const closeBranches = () => setBranchMenu(null)

  /** 隐藏 / 取消隐藏 / 移除：都从分支菜单触发，执行后关掉菜单；失败就把菜单重开在最上面报错。 */
  const runRootAction = (handler, root) => {
    if (typeof source[handler] !== 'function') return
    closeBranches()
    Promise.resolve(source[handler](root)).catch((error) => {
      setBranchMenu({
        ...emptyBranchMenu(root, null),
        loading: false,
        error: error && error.message ? error.message : String(error)
      })
    })
  }

  const loadBranches = (root, rect) => {
    setBranchMenu(emptyBranchMenu(root, rect))
    Promise.resolve(source.onLoadBranches(root))
      .then((value) => {
        setBranchMenu((previous) => (previous === null || previous.root.id !== root.id
          ? previous
          : {
            ...previous,
            list: value.branches,
            current: value.current,
            state: value.state,
            loading: false,
            // 合并 / 变基进行中 git 不允许切分支：默认就落在「只建分支」上，不摆一个必然失败的勾选
            checkout: value.state.inProgress === null
          }))
      })
      .catch((error) => {
        setBranchMenu((previous) => (previous === null || previous.root.id !== root.id
          ? previous
          : { ...previous, loading: false, error: error && error.message ? error.message : String(error) }))
      })
  }

  const chooseBranch = (menu, name) => {
    setBranchMenu({ ...menu, switching: name, error: null })
    Promise.resolve(source.onSwitchBranch(menu.root, name))
      .then(() => setBranchMenu(null))
      .catch((error) => {
        setBranchMenu((previous) => (previous === null
          ? previous
          : { ...previous, switching: null, error: error && error.message ? error.message : String(error) }))
      })
  }

  /**
   * 拉取当前分支最新代码（真正的 pull）。
   * 与「获取远程更新」不同：那只是 fetch（更新远端跟踪引用），不会改工作区文件。
   */
  const pullCurrent = (menu) => {
    if (typeof source.onPullBranch !== 'function') return
    setBranchMenu({ ...menu, pulling: true, error: null })
    Promise.resolve(source.onPullBranch(menu.root))
      .then(() => setBranchMenu(null))
      .catch((error) => {
        setBranchMenu((previous) => (previous === null
          ? previous
          : { ...previous, pulling: false, error: error && error.message ? error.message : String(error) }))
      })
  }

  /** 拉取远程更新（git fetch）后重读分支列表：别人新推的分支这时才会出现。 */
  const fetchRemote = (menu) => {
    if (typeof source.onFetchBranches !== 'function') return
    setBranchMenu({ ...menu, fetching: true, error: null, blocked: null })
    Promise.resolve(source.onFetchBranches(menu.root))
      .then((value) => {
        setBranchMenu((previous) => (previous === null
          ? previous
          : {
            ...previous,
            fetching: false,
            list: value.branches,
            current: value.current,
            state: value.state,
            loading: false
          }))
      })
      .catch((error) => {
        setBranchMenu((previous) => (previous === null
          ? previous
          : { ...previous, fetching: false, error: error && error.message ? error.message : String(error) }))
      })
  }

  /** 「仅远程」的分支：建本地跟踪分支并切过去。 */
  const trackBranch = (menu, branch) => {
    setBranchMenu({ ...menu, switching: branch.ref, error: null })
    Promise.resolve(source.onTrackBranch(menu.root, branch))
      .then(() => setBranchMenu(null))
      .catch((error) => {
        setBranchMenu((previous) => (previous === null
          ? previous
          : { ...previous, switching: null, error: error && error.message ? error.message : String(error) }))
      })
  }

  const changeCreateName = (value) => {
    setBranchMenu((previous) => (previous === null
      ? previous
      : { ...previous, name: value, error: null, blocked: null }))
  }

  const changeBase = (value) => {
    setBranchMenu((previous) => (previous === null
      ? previous
      : { ...previous, base: value, error: null, blocked: null }))
  }

  const changeCheckout = (value) => {
    setBranchMenu((previous) => (previous === null
      ? previous
      : { ...previous, checkout: value, error: null, blocked: null }))
  }

  /**
   * 创建分支：默认从当前 HEAD 建并切过去。
   *
   * `overrides` 是撞车后两个出口用的（改为从当前分支创建 / 只建分支），
   * 它们都是「同一件事换个参数重试一次」，所以共用这一条路径。
   */
  const runCreate = (menu, overrides = {}) => {
    const name = stripWrappingQuotes(menu.name)
    if (name === '' || menu.creating === true || menu.switching !== null) return
    const base = overrides.base ?? menu.base
    const checkout = overrides.checkout ?? menu.checkout
    setBranchMenu({
      ...menu,
      ...overrides,
      name,
      creating: true,
      error: null,
      blocked: null
    })
    Promise.resolve(source.onCreateBranch(menu.root, { name, base, checkout }))
      .then(() => setBranchMenu(null))
      .catch((error) => setBranchMenu((previous) => (previous === null
        ? previous
        : {
          ...previous,
          creating: false,
          error: error && error.message ? error.message : String(error),
          // 撞车不是「失败」而是「需要换个选择」：单独呈现，并给出两个零风险出口
          blocked: error !== null && error !== undefined && error.code === 'would-overwrite'
            ? (error && error.message ? error.message : String(error))
            : null
        })))
  }

  const menuBranches = branchMenu === null ? [] : branchMenu.list
  /** 副标题只留会变化的信息：↑n ↓m，或上游被删 */
  const branchMeta = (branch) => {
    const parts = []
    if (branch.upstreamGone === true) parts.push(translate('branch.upstreamGone'))
    if (typeof branch.ahead === 'number' && branch.ahead > 0) parts.push('↑' + branch.ahead)
    if (typeof branch.behind === 'number' && branch.behind > 0) parts.push('↓' + branch.behind)
    return parts.join(' ')
  }
  const branchBadges = (branch) => [
    { label: translate('branch.localTag'), active: branch.local === true },
    { label: translate('branch.remoteTag'), active: branch.remote !== null && branch.remote !== undefined }
  ]

  const menuBusy = branchMenu !== null && (branchMenu.switching !== null || branchMenu.creating === true || branchMenu.fetching === true)
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
  const baseOptions = branchMenu === null ? [] : baseOptionsOf(branchMenu.list, branchMenu.current, translate)
  const dirtyHint = branchState === null || branchState.dirty.total === 0
    ? null
    : translate('branch.dirtyHint', {
      branch: branchMenu.current ?? translate('root.noBranch'),
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
      ? translate('branch.baseNoteDirty', { base: branchMenu.base, total: branchState.dirty.total })
      : translate('branch.baseNoteClean', { base: branchMenu.base }))
  const branchMenuNode = branchMenu === null
    ? null
    : h(PopupMenu, { open: true, anchorRect: branchMenu.rect, onClose: closeBranches, minWidth: 240 },
      h(MenuLabel, null, translate('branch.title', { name: branchMenu.root.name })),
      h(MenuItem, {
        icon: 'refresh',
        label: branchMenu.pulling === true ? translate('branch.pulling') : translate('branch.pull'),
        disabled: menuBusy,
        dataKey: 'pull-branch',
        onClick: () => pullCurrent(branchMenu)
      }),
      h(MenuItem, {
        icon: 'sync',
        label: branchMenu.fetching === true ? translate('branch.fetching') : translate('branch.fetch'),
        disabled: menuBusy,
        dataKey: 'fetch-branches',
        onClick: () => fetchRemote(branchMenu)
      }),
      h('div', { className: 'dgp-menu-sep', role: 'separator' }),
      branchMenu.loading ? h(MenuLabel, null, translate('branch.loading')) : null,
      menuBranches.map((branch) => h(MenuItem, {
        key: branch.name,
        label: branch.name,
        badges: branchBadges(branch),
        sub: branchMeta(branch),
        checked: branch.current,
        disabled: menuBusy,
        dataKey: 'branch:' + branch.name,
        // 只有远程的行：点一下在本地创建并切过去（不写长文案，放 title 里）
        title: branch.local !== true ? translate('branch.trackHint', { ref: branch.remote + '/' + branch.name }) : undefined,
        onClick: () => {
          if (branch.current) closeBranches()
          else if (branch.local === true) chooseBranch(branchMenu, branch.name)
          else trackBranch(branchMenu, branch)
        }
      })),
      branchMenu.list.length === 0 && branchMenu.loading !== true
        ? h(MenuLabel, null, translate('branch.empty'))
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
          placeholder: translate('branch.createPlaceholder'),
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
          title: translate(branchMenu.checkout ? 'branch.create' : 'branch.createOnly')
        }, translate(branchMenu.checkout ? 'branch.create' : 'branch.createOnly'))),
      h('div', { className: 'dgp-branch-create-opts' },
        h('span', { className: 'dgp-branch-base-label' }, translate('branch.baseLabel')),
        h('select', {
          className: 'dgp-input dgp-branch-base',
          'data-dgp-branch-base': 'true',
          value: branchMenu.base,
          disabled: menuBusy,
          title: translate('branch.baseHint'),
          onChange: (event) => changeBase(event.target.value)
        }, baseOptions.map((option) => h('option', { key: option.ref, value: option.ref }, option.label))),
        h('label', { className: 'dgp-branch-check', title: translate('branch.checkoutHint') },
          h('input', {
            type: 'checkbox',
            'data-dgp-branch-checkout': 'true',
            checked: branchMenu.checkout,
            disabled: menuBusy || inProgress !== null,
            onChange: (event) => changeCheckout(event.target.checked)
          }),
          translate('branch.checkoutLabel'))),
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
        }, translate('branch.inProgressHint', {
          kind: translate(progressKey),
          action: translate('branch.createOnlyAction')
        })),
      dirtyHint === null
        ? null
        : h('p', { className: 'dgp-branch-hint', 'data-dgp-branch-dirty': 'dirty' }, dirtyHint),
      sameRemote === null
        ? null
        : h('p', {
          className: 'dgp-branch-hint',
          'data-dgp-branch-same-remote': sameRemote
        }, translate('branch.sameRemoteHint', { ref: sameRemote })),
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
            }, translate('branch.fromHead')),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-dgp-branch-only': 'true',
              disabled: menuBusy,
              onClick: () => runCreate(branchMenu, { checkout: false })
            }, translate('branch.createOnlyAction'))))),
      branchMenu.switching === null
        ? null
        : h(MenuLabel, null, translate('branch.switching', { name: branchMenu.switching })),
      branchMenu.creating !== true
        ? null
        : h(MenuLabel, null, translate(branchMenu.checkout ? 'branch.creating' : 'branch.creatingOnly', { name: createName })),
      branchMenu.error === null || branchMenu.blocked !== null
        ? null
        : h(MenuLabel, null, translate('branch.failed', { message: branchMenu.error })),
      branchMenu.root.kind === 'primary'
        ? null
        : h('div', { className: 'dgp-menu-sep', role: 'separator' }),
      branchMenu.root.kind === 'primary'
        ? null
        : (branchMenu.root.hidden === true
          ? h(MenuItem, {
            icon: 'eye',
            label: translate('roots.unhide', { name: branchMenu.root.name }),
            dataKey: 'repo-unhide',
            onClick: () => {
              runRootAction('onUnhide', branchMenu.root)
            }
          })
          : h(MenuItem, {
            icon: 'eye-off',
            label: translate('roots.hide', { name: branchMenu.root.name }),
            dataKey: 'repo-hide',
            onClick: () => {
              runRootAction('onHide', branchMenu.root)
            }
          })),
      branchMenu.root.kind === 'extra'
        ? h(MenuItem, {
          icon: 'trash',
          label: translate('toolbar.removeRoot', { name: branchMenu.root.name }),
          dataKey: 'repo-remove',
          onClick: () => {
            runRootAction('onRemove', branchMenu.root)
          }
        })
        : null)

  return h('div', { className: 'dgp-repolist', 'data-dgp-repolist': 'true' },
    h('div', { className: 'dgp-repolist-head' },
      h('button', {
        type: 'button',
        className: 'dgp-repolist-toggle',
        'data-dgp-repolist-toggle': 'true',
        'data-open': open ? 'true' : 'false',
        'aria-expanded': open,
        onClick: () => {
          if (typeof source.onToggleOpen === 'function') source.onToggleOpen()
        }
      },
      h('span', { className: 'dgp-caret', 'data-open': open ? 'true' : 'false' },
        h(Icon, { name: 'chevron-right', size: 12 })),
      h('span', { className: 'dgp-repolist-title' }, translate('roots.title')),
      h('span', { className: 'dgp-group-count' }, String(visibleRoots.length))),
      hiddenRoots.length === 0
        ? null
        : h('button', {
          type: 'button',
          className: 'dgp-iconbtn',
          style: { width: 22, height: 22, gap: 2 },
          'data-dgp-repolist-hidden': showHidden ? 'true' : 'false',
          'aria-pressed': showHidden,
          title: translate(showHidden ? 'roots.hiddenCollapse' : 'roots.hiddenShow', { count: hiddenRoots.length }),
          'aria-label': translate(showHidden ? 'roots.hiddenCollapse' : 'roots.hiddenShow', { count: hiddenRoots.length }),
          onClick: () => setShowHidden((previous) => !previous)
        },
        h(Icon, { name: showHidden ? 'eye-off' : 'eye', size: 13 }),
        h('span', { className: 'dgp-repolist-hidden-count' }, String(hiddenRoots.length))),
      h('button', {
        type: 'button',
        className: 'dgp-iconbtn',
        style: { width: 22, height: 22 },
        'data-action': 'add-root',
        title: translate('toolbar.addRoot'),
        'aria-label': translate('toolbar.addRoot'),
        onClick: () => setFormOpen((previous) => !previous)
      }, h(Icon, { name: 'plus', size: 13 }))),

    open
      ? h('ul', { className: 'dgp-level dgp-repolist-rows', role: 'none' },
        listedRoots.map((root) => {
          const hidden = root.hidden === true
          const hasBranch = typeof root.branch === 'string' && root.branch !== ''
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
                if (typeof source.onSelect === 'function') source.onSelect(root)
              }
            },
            h(Icon, { name: 'git-branch', size: 13 }),
            h('span', { className: 'dgp-name dgp-oneline' }, root.name)),
            // 分支按钮是所有仓库操作的唯一入口：切分支、拉取、隐藏/取消隐藏、移除
            h('button', {
              type: 'button',
              className: 'dgp-repo-branch dgp-oneline',
              'data-dgp-branch': root.id,
              title: translate(hidden ? 'branch.hintHidden' : 'branch.hint', {
                branch: hasBranch ? root.branch : translate('root.noBranch')
              }),
              onClick: (event) => {
                event.stopPropagation()
                loadBranches(root, event.currentTarget.getBoundingClientRect())
              }
            }, hasBranch ? root.branch : translate('root.noBranch'))))
        })
      )
      : null,

    open && formOpen
      ? h(AddRootForm, {
        t: translate,
        onCancel: closeForm,
        onAdd: async (dir) => {
          if (typeof source.onAdd !== 'function') return
          await source.onAdd(dir)
          setFormOpen(false)
        }
      })
      : null,

    branchMenuNode)
}
