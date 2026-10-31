/**
 * src/components/RootPicker.js —— 仓库/根切换器
 *
 * 交互：
 *  · 顶栏一个 pill 显示当前根（名字 + 类型徽标 + 分支），点开是根列表；
 *  · 列表里 primary/discovered/extra 三类并列，extra 额外带一个「移除」按钮；
 *  · 底部「添加外部仓库…」展开一个内联表单，粘贴绝对路径即可添加；
 *  · 出错（不是仓库 / 路径不存在）就地显示，不弹窗。
 */
import { h, useCallback, useRef, useState } from '../platform.js'
import { Icon } from '../ui/Icon.js'
import { PopupMenu, MenuLabel, MenuSeparator, MenuItem } from '../ui/Menu.js'
import { AddRootForm } from './AddRootForm.js'

function kindBadge(kind) {
  if (kind === 'extra') return 'extra'
  if (kind === 'discovered') return 'discovered'
  return 'primary'
}

function kindLabel(kind, t) {
  if (kind === 'extra') return t('root.extra')
  if (kind === 'discovered') return t('root.discovered')
  return t('root.primary')
}

/** 单个根的一行：主体按钮 + 可选的移除按钮（不能嵌套 button，所以并排）。 */
function RootRow(props) {
  const { root, active, onSelect, onRemove, t } = props
  const subtitle = root.isGit === false
    ? (root.error ?? t('status.notRepo'))
    : (root.branch ?? t('root.noBranch'))
  return h('div', { className: 'dgp-root-row', 'data-active': active ? 'true' : undefined },
    h('button', {
      type: 'button',
      className: 'dgp-menu-item',
      role: 'menuitemradio',
      'aria-checked': active ? 'true' : 'false',
      'data-checked': active ? 'true' : undefined,
      title: root.path,
      onClick: (event) => {
        event.preventDefault()
        event.stopPropagation()
        onSelect(root)
      }
    },
    h('span', { className: 'dgp-menu-check', style: { width: 14, display: 'flex' } },
      active ? h(Icon, { name: 'check', size: 14 }) : null),
    h('span', { className: 'dgp-menu-item-main', title: root.name }, root.name),
    h('span', { className: 'dgp-pill-badge', 'data-kind': kindBadge(root.kind) }, kindLabel(root.kind, t)),
    subtitle === '' || subtitle === null || subtitle === undefined
      ? null
      : h('span', { className: 'dgp-menu-item-sub', title: subtitle }, subtitle)),
    root.kind === 'extra'
      ? h('button', {
        type: 'button',
        className: 'dgp-iconbtn',
        style: { width: 24, height: 24 },
        title: t('toolbar.removeRoot', { name: root.name }),
        onClick: (event) => {
          event.preventDefault()
          event.stopPropagation()
          onRemove(root)
        }
      }, h(Icon, { name: 'trash', size: 13 }))
      : null)
}

export function RootPicker(props) {
  const { roots, activeRootId, projectRoot, onSelect, onAdd, onRemove, busy, t } = props ?? {}
  const list = Array.isArray(roots) ? roots : []
  const active = list.find((root) => root.id === activeRootId) ?? list[0] ?? null
  const [open, setOpen] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const anchorRef = useRef(null)
  const [anchorRect, setAnchorRect] = useState(null)

  const close = useCallback(() => {
    setOpen(false)
    setShowForm(false)
  }, [])

  const toggle = useCallback(() => {
    if (open) {
      close()
      return
    }
    const node = anchorRef.current
    setAnchorRect(node === null ? null : node.getBoundingClientRect())
    setOpen(true)
  }, [open, close])

  const activeName = active === null ? t('status.noRoots') : active.name
  const isDetached = active !== null && active.branch === null

  return h('div', { className: 'dgp-rootpicker', ref: anchorRef, style: { display: 'inline-flex', minWidth: 0 } },
    h('button', {
      type: 'button',
      className: 'dgp-pill',
      'data-empty': active === null ? 'true' : undefined,
      'aria-expanded': open ? 'true' : 'false',
      'aria-haspopup': 'menu',
      title: active === null ? t('root.select') : active.path,
      onClick: toggle
    },
    h(Icon, { name: 'git-branch', size: 13 }),
    h('span', { className: 'dgp-pill-label dgp-oneline' }, activeName),
    active !== null && active.kind !== 'primary'
      ? h('span', { className: 'dgp-pill-badge', 'data-kind': kindBadge(active.kind) }, kindLabel(active.kind, t))
      : null,
    active !== null && isDetached
      ? h('span', { className: 'dgp-pill-branch' }, t('root.detached'))
      : (active !== null && active.branch
        ? h('span', { className: 'dgp-pill-branch', title: active.branch }, active.branch)
        : null),
    list.length > 1 ? h('span', { className: 'dgp-pill-count' }, String(list.length)) : null,
    h(Icon, { name: 'chevron-down', size: 12 })),

    h(PopupMenu, { open, anchorRect, onClose: close, minWidth: 260 },
      h(MenuLabel, null, t('root.select')),
      list.length === 0
        ? h('div', { className: 'dgp-note' }, t('status.noRoots'))
        : list.map((root) => h(RootRow, {
          key: root.id,
          root,
          active: active !== null && root.id === active.id,
          t,
          onSelect: (next) => {
            close()
            onSelect(next)
          },
          onRemove
        })),
      h(MenuSeparator),
      showForm
        ? h(AddRootForm, {
          t,
          onCancel: () => setShowForm(false),
          onAdd: async (dir) => {
            await onAdd(dir)
            setShowForm(false)
            close()
          }
        })
        : h(MenuItem, {
          icon: 'plus',
          label: t('toolbar.addRoot'),
          disabled: projectRoot === '',
          onClick: () => setShowForm(true)
        }),
      busy === true ? h('div', { className: 'dgp-note' }, t('status.loading')) : null))
}
