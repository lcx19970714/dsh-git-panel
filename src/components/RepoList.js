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
 *   │     ├─ button.dgp-row[data-dgp-repo]  ← 选中该仓库
 *   │     └─ button.dgp-row-action          ← 仅外部仓库：移除
 *   └─ AddRootForm（展开时）
 *
 * 只管展示与交互；选中、增删都由 Panel 通过 props 提供。
 */
import { h, useState } from '../platform.js'
import { Icon } from '../ui/Icon.js'
import { AddRootForm } from './AddRootForm.js'

export function RepoList(props) {
  const source = props === null || props === undefined ? {} : props
  const translate = source.t
  const roots = Array.isArray(source.roots) ? source.roots : []
  const activeRootId = typeof source.activeRootId === 'string' ? source.activeRootId : null
  const open = source.open !== false
  const [formOpen, setFormOpen] = useState(false)

  if (roots.length === 0) return null

  const closeForm = () => setFormOpen(false)

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
        roots.map((root) => h('li', { key: root.id, className: 'dgp-item' },
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
            h('span', { className: 'dgp-name dgp-oneline' }, root.name),
            h('span', { className: 'dgp-repo-branch dgp-oneline' },
              root.branch === null || root.branch === undefined ? translate('root.noBranch') : root.branch)),
            root.kind === 'extra'
              ? h('button', {
                type: 'button',
                className: 'dgp-row-action',
                'data-dgp-repo-remove': root.id,
                title: translate('toolbar.removeRoot', { name: root.name }),
                'aria-label': translate('toolbar.removeRoot', { name: root.name }),
                onClick: (event) => {
                  if (event !== null && event !== undefined) {
                    event.preventDefault()
                    event.stopPropagation()
                  }
                  if (typeof source.onRemove === 'function') source.onRemove(root)
                }
              }, h(Icon, { name: 'trash', size: 13 }))
              : null))))
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
      : null)
}
