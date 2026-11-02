/**
 * src/components/RemotePane.js —— 「远端」页签：账号里的仓库，一键拉到项目里
 *
 * 结构：
 *   div.dgp-remote
 *   ├─ div.dgp-remote-head        账号行（每个账号一个 chip）+ 重新读取
 *   ├─ input.dgp-remote-filter     本地筛选
 *   ├─ div.dgp-remote-list         仓库行（名称 / 私有标记 / 描述 / 语言 / 更新时间 / 拉取按钮）
 *   └─ 空态 / 加载 / 错误（同一处，避免三套布局）
 *
 * 拉取走行内表单：点「拉取」展开目标文件夹名（默认仓库名），确认后交给 Panel 执行；
 * 克隆期间这一行显示已等待秒数，失败原因直接显示在该行下方。
 *
 * 添加账号同样就地完成：没账号时空态里直接给两个平台按钮，有账号时账号行尾是 ＋；
 * 表单里有「打开令牌页面」，提交结果就地显示（设置页那份引导仍然保留）。
 */
import { h, useState } from '../platform.js'
import { Icon } from '../ui/Icon.js'
import { formatClock } from '../util/time.js'

/** 秒数保留一位小数，避免每次 tick 都跳一大截。 */
function secondsOf(startedAt, now) {
  if (startedAt === 0) return '0.0'
  return ((now - startedAt) / 1000).toFixed(1)
}

export function RemotePane(props) {
  const source = props === null || props === undefined ? {} : props
  const translate = source.t
  const accounts = Array.isArray(source.accounts) ? source.accounts : []
  const accountId = typeof source.accountId === 'string' ? source.accountId : null
  const repos = Array.isArray(source.repos) ? source.repos : []
  const loading = source.loading === true
  const error = typeof source.error === 'string' && source.error !== '' ? source.error : null
  const hasMore = source.hasMore === true
  const filter = typeof source.filter === 'string' ? source.filter : ''
  const clone = source.clone === null || source.clone === undefined ? null : source.clone
  const now = typeof source.now === 'number' ? source.now : 0
  const [folderFor, setFolderFor] = useState(null)
  const [folderName, setFolderName] = useState('')
  // 添加账号的行内表单：{ provider, label, token, busy, error }
  const [form, setForm] = useState(null)

  const providers = Array.isArray(source.providers) ? source.providers : []
  const providerOf = (id) => providers.find((item) => item.id === id) ?? { id, label: id }

  const openForm = (providerId) => {
    const id = typeof providerId === 'string' && providerId !== ''
      ? providerId
      : (providers.length > 0 ? providers[0].id : 'github')
    setForm({ provider: id, label: '', token: '', busy: false, error: null })
  }

  const closeForm = () => setForm(null)

  const submitForm = async () => {
    if (form === null || typeof source.onAddAccount !== 'function') return
    if (form.token.trim() === '') return
    setForm({ ...form, busy: true, error: null })
    const result = await source.onAddAccount({
      provider: form.provider,
      label: form.label.trim(),
      token: form.token.trim()
    })
    if (result !== null && result !== undefined && result.ok === true) {
      setForm(null)
      return
    }
    setForm({ ...form, busy: false, error: result === null || result === undefined ? '添加失败' : result.error })
  }

  const beginClone = (repo) => {
    setFolderFor(repo.fullName)
    setFolderName(repo.name)
  }

  const cancelClone = () => {
    setFolderFor(null)
    setFolderName('')
  }

  const confirmClone = (repo) => {
    if (typeof source.onClone !== 'function') return
    setFolderFor(null)
    source.onClone(repo, folderName.trim())
  }

  const formNode = form === null
    ? null
    : h('div', { className: 'dgp-account-inline', 'data-dgp-remote': 'account-form' },
      h('div', { className: 'dgp-account-inline-head' },
        h('span', { className: 'dgp-account-guide-title' },
          translate('remote.addAccountOn', { provider: providerOf(form.provider).label })),
        providerOf(form.provider).tokenUrl === undefined
          ? null
          : h('button', {
            type: 'button',
            className: 'dgp-btn',
            'data-size': 'sm',
            'data-dgp-remote': 'open-token-page',
            onClick: () => window.open(providerOf(form.provider).tokenUrl, '_blank', 'noopener,noreferrer')
          }, translate('accounts.openTokenPage'), h(Icon, { name: 'external', size: 12 }))),
      h('div', { className: 'dgp-account-form' },
        h('select', {
          className: 'dgp-select dgp-account-provider',
          'data-dgp-remote': 'account-provider',
          value: form.provider,
          onChange: (event) => setForm({ ...form, provider: event.target.value })
        },
        providers.map((item) => h('option', { key: item.id, value: item.id }, item.label))),
        h('input', {
          className: 'dgp-input',
          'data-dgp-remote': 'account-label',
          placeholder: translate('accounts.label'),
          value: form.label,
          onChange: (event) => setForm({ ...form, label: event.target.value })
        }),
        h('input', {
          className: 'dgp-input',
          'data-dgp-remote': 'account-token',
          type: 'password',
          placeholder: translate('accounts.tokenPlaceholder'),
          value: form.token,
          onChange: (event) => setForm({ ...form, token: event.target.value }),
          onKeyDown: (event) => {
            if (event.key === 'Enter') submitForm()
          }
        }),
        h('button', {
          type: 'button',
          className: 'dgp-btn',
          'data-size': 'sm',
          'data-variant': 'primary',
          'data-dgp-remote': 'account-submit',
          disabled: form.busy || form.token.trim() === '',
          onClick: submitForm
        }, translate(form.busy ? 'accounts.adding' : 'accounts.add')),
        h('button', {
          type: 'button',
          className: 'dgp-btn',
          'data-size': 'sm',
          'data-dgp-remote': 'account-cancel',
          onClick: closeForm
        }, translate('remote.cloneCancel'))),
      form.error === null
        ? null
        : h('div', { className: 'dgp-remote-status', 'data-tone': 'error' },
          h('span', null, translate('accounts.failed', { message: form.error }))))

  let body = null
  if (accounts.length === 0) {
    body = h('div', { className: 'dgp-state', 'data-dgp-remote': 'no-accounts' },
      h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'external', size: 22 })),
      h('div', { className: 'dgp-state-title' }, translate('remote.noAccounts')),
      h('div', { className: 'dgp-state-desc' }, translate('remote.noAccountsHint')),
      h('div', { className: 'dgp-state-actions' },
        h('button', {
          type: 'button',
          className: 'dgp-btn',
          'data-variant': 'primary',
          'data-dgp-remote': 'add-account',
          onClick: () => openForm(null)
        }, translate('remote.addAccount')),
        typeof source.onOpenSettings === 'function'
          ? h('button', {
            type: 'button',
            className: 'dgp-btn',
            'data-variant': 'ghost',
            'data-dgp-remote': 'open-settings',
            onClick: () => source.onOpenSettings()
          }, translate('accounts.guideTitle'))
          : null))
  } else if (error !== null) {
    body = h('div', { className: 'dgp-state', 'data-dgp-remote': 'error' },
      h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'warning', size: 20 })),
      h('div', { className: 'dgp-state-title' }, translate('remote.failed', { message: '' })),
      h('div', { className: 'dgp-state-desc' }, error),
      h('button', {
        type: 'button',
        className: 'dgp-btn',
        'data-size': 'sm',
        onClick: () => {
          if (typeof source.onRefresh === 'function') source.onRefresh()
        }
      }, translate('remote.refresh')))
  } else if (loading && repos.length === 0) {
    body = h('div', { className: 'dgp-state', 'data-dgp-remote': 'loading' },
      h('div', { className: 'dgp-state-icon' }, h('span', { className: 'dgp-spinner' })),
      h('div', { className: 'dgp-state-title' }, translate('remote.loading')))
  } else if (repos.length === 0) {
    body = h('div', { className: 'dgp-state', 'data-dgp-remote': 'empty' },
      h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'folder-open', size: 20 })),
      h('div', { className: 'dgp-state-title' }, translate('remote.empty')))
  } else {
    body = h('div', { className: 'dgp-list', 'data-dgp-remote': 'list', role: 'list' },
      repos.map((repo) => {
        const cloning = clone !== null && clone.fullName === repo.fullName
        return h('div', { key: repo.fullName, className: 'dgp-remote-item', role: 'listitem' },
          h('div', { className: 'dgp-remote-row' },
            h('span', { className: 'dgp-remote-name dgp-oneline', title: repo.fullName }, repo.name),
            repo.private === true
              ? h('span', { className: 'dgp-remote-badge' }, translate('remote.private'))
              : null,
            h('button', {
              type: 'button',
              className: 'dgp-btn dgp-remote-action',
              'data-size': 'sm',
              'data-dgp-remote-clone': repo.fullName,
              disabled: cloning || folderFor !== null,
              title: translate('remote.cloneTitle'),
              onClick: () => beginClone(repo)
            }, translate('remote.clone'))),
          h('div', { className: 'dgp-remote-meta dgp-oneline' },
            repo.description !== '' ? repo.description + ' · ' : '',
            repo.language !== '' ? repo.language + ' · ' : '',
            repo.updatedAt !== '' ? translate('remote.updatedAt', { time: formatClock(Date.parse(repo.updatedAt)) }) : ''),
          folderFor === repo.fullName
            ? h('div', { className: 'dgp-remote-cloneform' },
              h('label', { className: 'dgp-remote-cloneform-label' }, translate('remote.cloneFolder')),
              h('input', {
                className: 'dgp-input dgp-remote-cloneform-input',
                'data-dgp-remote-folder': repo.fullName,
                value: folderName,
                onChange: (event) => setFolderName(event.target.value)
              }),
              h('button', {
                type: 'button',
                className: 'dgp-btn',
                'data-size': 'sm',
                'data-variant': 'primary',
                'data-dgp-remote-confirm': repo.fullName,
                onClick: () => confirmClone(repo)
              }, translate('remote.cloneConfirm')),
              h('button', {
                type: 'button',
                className: 'dgp-btn',
                'data-size': 'sm',
                onClick: cancelClone
              }, translate('remote.cloneCancel')))
            : null,
          cloning
            ? h('div', { className: 'dgp-remote-status', 'data-dgp-remote-cloning': repo.fullName },
              h('span', { className: 'dgp-spinner' }),
              h('span', null, translate('remote.cloning', { seconds: secondsOf(clone.startedAt, now) })))
            : null,
          clone !== null && clone.error !== null && clone.fullName === repo.fullName
            ? h('div', { className: 'dgp-remote-status', 'data-tone': 'error' },
              h('span', null, clone.error))
            : null)
      }),
      hasMore
        ? h('button', {
          type: 'button',
          className: 'dgp-btn dgp-remote-more',
          'data-size': 'sm',
          disabled: loading,
          onClick: () => {
            if (typeof source.onLoadMore === 'function') source.onLoadMore()
          }
        }, translate('remote.loadMore'))
        : null)
  }

  return h('div', { className: 'dgp-remote', 'data-dgp-view': 'remote' },
    formNode,
    accounts.length === 0
      ? null
      : h('div', { className: 'dgp-remote-head' },
        h('span', { className: 'dgp-remote-head-label' }, translate('remote.account')),
        accounts.map((account) => h('button', {
          key: account.id,
          type: 'button',
          className: 'dgp-remote-chip',
          'data-dgp-account': account.id,
          'data-active': account.id === accountId ? 'true' : undefined,
          title: account.providerLabel + ' · ' + account.login,
          onClick: () => {
            if (typeof source.onSelectAccount === 'function') source.onSelectAccount(account)
          }
        }, account.label)),
        h('button', {
          type: 'button',
          className: 'dgp-iconbtn dgp-remote-refresh',
          title: translate('remote.addAccount'),
          'aria-label': translate('remote.addAccount'),
          'data-dgp-remote': 'add-account',
          onClick: () => openForm(providerOf(accountId).id)
        }, h(Icon, { name: 'plus', size: 13 })),
        h('button', {
          type: 'button',
          className: 'dgp-iconbtn',
          title: translate('remote.refresh'),
          'aria-label': translate('remote.refresh'),
          onClick: () => {
            if (typeof source.onRefresh === 'function') source.onRefresh()
          }
        }, h(Icon, { name: 'refresh', size: 13 }))),
    accounts.length === 0
      ? null
      : h('input', {
        className: 'dgp-input dgp-remote-filter',
        'data-dgp-remote-filter': 'true',
        placeholder: translate('remote.filter'),
        value: filter,
        onChange: (event) => {
          if (typeof source.onFilterChange === 'function') source.onFilterChange(event.target.value)
        }
      }),
    body)
}
