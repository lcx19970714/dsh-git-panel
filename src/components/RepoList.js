/**
 * src/components/RepoList.js —— 「储存库」区域（VS Code 的 Repositories）
 *
 * 结构：
 *   div.dgp-repolist
 *   ├─ div.dgp-repolist-head
 *   │  ├─ button.dgp-repolist-toggle   ← 折叠/展开，带数量
 *   │  └─ button[data-action=add-root] ← 添加外部仓库
 *   ├─ ul.dgp-level
 *   │  └─ li > div.dgp-row-wrap
 *   │     ├─ button.dgp-repo-row[data-dgp-repo]   ← 只选中该仓库，不打开分支菜单
 *   │     ├─ button.dgp-repo-branch[data-dgp-branch] ← 贴在行的最右侧；只有点它才打开分支菜单
 *   │     └─ button.dgp-row-action                ← 仅外部仓库：移除
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

export function RepoList(props) {
  const source = props === null || props === undefined ? {} : props
  const translate = source.t
  const roots = Array.isArray(source.roots) ? source.roots : []
  const activeRootId = typeof source.activeRootId === 'string' ? source.activeRootId : null
  const open = source.open !== false
  const [formOpen, setFormOpen] = useState(false)
  // 分支菜单：{ root, rect, list, loading, switching, creating, name, error }
  const [branchMenu, setBranchMenu] = useState(null)

  if (roots.length === 0) return null

  const closeForm = () => setFormOpen(false)
  const closeBranches = () => setBranchMenu(null)

  const loadBranches = (root, rect) => {
    setBranchMenu({ root, rect, list: [], loading: true, switching: null, creating: false, name: '', error: null })
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

  const changeCreateName = (value) => {
    setBranchMenu((previous) => (previous === null ? previous : { ...previous, name: value, error: null }))
  }

  const createBranch = (menu) => {
    const name = menu.name.trim()
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

  const menuBusy = branchMenu !== null && (branchMenu.switching !== null || branchMenu.creating === true)
  const createName = branchMenu === null ? '' : branchMenu.name.trim()
  const branchMenuNode = branchMenu === null
    ? null
    : h(PopupMenu, { open: true, anchorRect: branchMenu.rect, onClose: closeBranches, minWidth: 240 },
      h(MenuLabel, null, translate('branch.title', { name: branchMenu.root.name })),
      branchMenu.loading ? h(MenuLabel, null, translate('branch.loading')) : null,
      branchMenu.list.map((branch) => h(MenuItem, {
        key: branch.name,
        label: branch.name,
        checked: branch.current,
        disabled: menuBusy,
        onClick: () => {
          if (branch.current) closeBranches()
          else chooseBranch(branchMenu, branch.name)
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
      h('span', { className: 'dgp-group-count' }, String(roots.length))),
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
        roots.map((root) => {
          const hasBranch = typeof root.branch === 'string' && root.branch !== ''
          return h('li', { key: root.id, className: 'dgp-item' },
            h('div', { className: 'dgp-row-wrap' },
              h('button', {
                type: 'button',
                className: 'dgp-row dgp-repo-row',
                'data-dgp-repo': root.id,
                'data-active': root.id === activeRootId ? 'true' : 'false',
                'aria-current': root.id === activeRootId ? 'true' : undefined,
                title: root.path,
                onClick: () => {
                  if (typeof source.onSelect === 'function') source.onSelect(root)
                }
              },
              h(Icon, { name: 'git-branch', size: 13 }),
              h('span', { className: 'dgp-name dgp-oneline' }, root.name)),
              root.isGit === false
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
