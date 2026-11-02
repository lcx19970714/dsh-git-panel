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

export function RepoList(props) {
  const source = props === null || props === undefined ? {} : props
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

  const loadBranches = (root, rect) => {
    setBranchMenu({ root, rect, list: [], loading: true, switching: null, creating: false, fetching: false, name: '', error: null })
    Promise.resolve(source.onLoadBranches(root))
      .then((value) => {
        setBranchMenu((previous) => (previous === null || previous.root.id !== root.id
          ? previous
          : { ...previous, list: value.branches, loading: false }))
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

  /** 拉取远程更新（git fetch）后重读分支列表：别人新推的分支这时才会出现。 */
  const fetchRemote = (menu) => {
    if (typeof source.onFetchBranches !== 'function') return
    setBranchMenu({ ...menu, fetching: true, error: null })
    Promise.resolve(source.onFetchBranches(menu.root))
      .then((value) => {
        setBranchMenu((previous) => (previous === null
          ? previous
          : { ...previous, fetching: false, list: value.branches, loading: false }))
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
    setBranchMenu((previous) => (previous === null ? previous : { ...previous, name: value, error: null }))
  }

  const createBranch = (menu) => {
    const name = stripWrappingQuotes(menu.name)
    if (name === '' || menu.creating === true || menu.switching !== null) return
    setBranchMenu({ ...menu, name, creating: true, error: null })
    Promise.resolve(source.onCreateBranch(menu.root, name))
      .then(() => setBranchMenu(null))
      .catch((error) => {
        setBranchMenu((previous) => (previous === null
          ? previous
          : { ...previous, creating: false, error: error && error.message ? error.message : String(error) }))
      })
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
  const branchMenuNode = branchMenu === null
    ? null
    : h(PopupMenu, { open: true, anchorRect: branchMenu.rect, onClose: closeBranches, minWidth: 240 },
      h(MenuLabel, null, translate('branch.title', { name: branchMenu.root.name })),
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
          createBranch(branchMenu)
        }
      },
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
        title: translate('branch.create')
      }, translate('branch.create'))),
      branchMenu.switching === null
        ? null
        : h(MenuLabel, null, translate('branch.switching', { name: branchMenu.switching })),
      branchMenu.creating !== true
        ? null
        : h(MenuLabel, null, translate('branch.creating', { name: createName })),
      branchMenu.error === null
        ? null
        : h(MenuLabel, null, translate('branch.failed', { message: branchMenu.error })))

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
            h('div', { className: 'dgp-row-wrap' },
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
              // 隐藏的行不提供分支菜单：它不参与切换，点开也只会让人以为切过去了
              hidden
                ? null
                : h('button', {
                  type: 'button',
                  className: 'dgp-repo-branch dgp-oneline',
                  'data-dgp-branch': root.id,
                  title: translate('branch.hint', { branch: hasBranch ? root.branch : translate('root.noBranch') }),
                  onClick: (event) => {
                    event.stopPropagation()
                    loadBranches(root, event.currentTarget.getBoundingClientRect())
                  }
                }, hasBranch ? root.branch : translate('root.noBranch')),
              root.kind === 'primary'
                ? null
                : h('button', {
                  type: 'button',
                  className: 'dgp-row-action',
                  'data-dgp-repo-hide': root.id,
                  title: translate('roots.hide', { name: root.name }),
                  'aria-label': translate('roots.hide', { name: root.name }),
                  onClick: (event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    if (typeof source.onHide === 'function') source.onHide(root)
                  }
                }, h(Icon, { name: 'eye-off', size: 13 })),
              hidden
                ? h('button', {
                  type: 'button',
                  className: 'dgp-row-action',
                  'data-dgp-repo-unhide': root.id,
                  title: translate('roots.unhide', { name: root.name }),
                  'aria-label': translate('roots.unhide', { name: root.name }),
                  onClick: (event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    if (typeof source.onUnhide === 'function') source.onUnhide(root)
                  }
                }, h(Icon, { name: 'eye', size: 13 }))
                : null,
              root.kind === 'extra'
                ? h('button', {
                  type: 'button',
                  className: 'dgp-row-action',
                  'data-dgp-repo-remove': root.id,
                  title: translate('toolbar.removeRoot', { name: root.name }),
                  'aria-label': translate('toolbar.removeRoot', { name: root.name }),
                  onClick: (event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    if (typeof source.onRemove === 'function') source.onRemove(root)
                  }
                }, h(Icon, { name: 'trash', size: 13 }))
                : null))
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
