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
import { h, useRef, useState } from '../platform.js'
import { Icon } from '../ui/Icon.js'
import { formatDateTime } from '../util/time.js'
import { openExternalUrl } from '../util/openUrl.js'

/** 秒数保留一位小数，避免每次 tick 都跳一大截。 */
function secondsOf(startedAt, now) {
  if (startedAt === 0) return '0.0'
  return ((now - startedAt) / 1000).toFixed(1)
}

export function RemotePane(props) {
  const { accounts, accountId, repos, loading, error, hasMore, filter, selectedFullName, prCounts, clone, now, providers, t } = props
  /** 回调集中在 props 上：渲染代码里只关心「点了会发生什么」，不重新包装一层。 */
  const source = props
  const translate = t
  const [folderFor, setFolderFor] = useState(null)
  const [folderName, setFolderName] = useState('')
  // 添加账号的行内表单：{ provider, label, token, busy, error }
  const [form, setForm] = useState(null)
  // 点过「获取令牌」后的提示：'opened' 或拦截时的地址
  const [tokenHint, setTokenHint] = useState(null)
  /** 表单的世代号：关闭 / 重新打开后，旧请求的结果不能把表单「复活」。 */
  const formAttemptRef = useRef(0)

  /** 账号 id（provider:login）→ 平台 id。 */
  const providerIdOfAccount = (id) => {
    const account = accounts.find((item) => item.id === id) ?? accounts[0]
    return account.provider
  }
  /** 平台 id → 平台定义（下拉框里的值一定来自 providers）。 */
  const providerOf = (id) => providers.find((item) => item.id === id) ?? providers[0]

  const openForm = (providerId) => {
    if (providers.length === 0) return
    formAttemptRef.current += 1
    setTokenHint(null)
    // null = 从空态「添加账号」进来：默认选第一个平台
    setForm({ provider: providerId === null ? providers[0].id : providerId, label: '', token: '', busy: false, error: null })
  }

  const closeForm = () => {
    formAttemptRef.current += 1
    setForm(null)
  }

  const submitForm = async () => {
    if (form.token.trim() === '' || form.busy) return
    const attempt = formAttemptRef.current
    const submitted = form
    setForm({ ...submitted, busy: true, error: null })
    const result = await source.onAddAccount({
      provider: submitted.provider,
      label: submitted.label.trim(),
      token: submitted.token.trim()
    })
    if (formAttemptRef.current !== attempt) return
    if (result.ok === true) {
      setForm(null)
      return
    }
    setForm((previous) => (previous === null ? null : { ...previous, busy: false, error: result.error }))
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
    setFolderFor(null)
    source.onClone(repo, folderName.trim())
  }

  const formNode = form === null
    ? null
    : h('div', {
      className: 'dgp-account-inline',
      'data-dgp-remote': 'account-form',
      onKeyDown: (event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          closeForm()
        }
      }
    },
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
            onClick: () => {
              const result = openExternalUrl(providerOf(form.provider).tokenUrl)
              setTokenHint(result.opened ? 'opened' : providerOf(form.provider).tokenUrl)
            }
          }, translate('accounts.getToken'), h(Icon, { name: 'external', size: 12 }))),
      h('div', { className: 'dgp-account-form' },
        h('select', {
          className: 'dgp-select dgp-account-provider',
          'data-dgp-remote': 'account-provider',
          value: form.provider,
          disabled: form.busy,
          onChange: (event) => setForm({ ...form, provider: event.target.value })
        },
        providers.map((item) => h('option', { key: item.id, value: item.id }, item.label))),
        h('input', {
          className: 'dgp-input',
          'data-dgp-remote': 'account-label',
          placeholder: translate('accounts.label'),
          value: form.label,
          disabled: form.busy,
          onChange: (event) => setForm({ ...form, label: event.target.value })
        }),
        h('input', {
          className: 'dgp-input',
          'data-dgp-remote': 'account-token',
          type: 'password',
          placeholder: translate('accounts.tokenPlaceholder'),
          value: form.token,
          disabled: form.busy,
          onChange: (event) => setForm({ ...form, token: event.target.value }),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && !form.busy) submitForm()
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
      tokenHint === null
        ? null
        : h('div', { className: 'dgp-remote-status', 'data-dgp-remote': 'token-hint' },
          h('span', null, tokenHint === 'opened'
            ? translate('accounts.openedPage')
            : translate('accounts.blockedPage') + ' ' + tokenHint)),
      form.error === null
        ? null
        : h('div', { className: 'dgp-remote-status', 'data-tone': 'error' },
          h('span', null, translate('accounts.failed', { message: form.error }))))

  let body = null
  if (error !== null) {
    body = h('div', { className: 'dgp-state', 'data-dgp-remote': 'error' },
      h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'warning', size: 20 })),
      h('div', { className: 'dgp-state-title' }, translate('remote.failedTitle')),
      h('div', { className: 'dgp-state-desc' }, error),
      h('button', {
        type: 'button',
        className: 'dgp-btn',
        'data-size': 'sm',
        onClick: () => {
          source.onRefresh()
        }
      }, translate('remote.refresh')))
  } else if (accounts.length === 0) {
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
        h('button', {
            type: 'button',
            className: 'dgp-btn',
            'data-variant': 'ghost',
            'data-dgp-remote': 'open-settings',
            onClick: () => source.onOpenSettings()
          }, translate('accounts.guideTitle'))))
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
        const cloning = clone !== null && clone.fullName === repo.fullName && clone.error === null
        return h('div', {
          key: repo.fullName,
          className: 'dgp-remote-item',
          role: 'listitem',
          'data-dgp-remote-item': repo.fullName,
          'data-active': repo.fullName === selectedFullName ? 'true' : undefined,
          onClick: () => {
            source.onSelectRepo(repo)
          }
        },
          h('div', { className: 'dgp-remote-row' },
            h('span', { className: 'dgp-remote-name dgp-oneline', title: repo.fullName }, repo.name),
            prCounts[repo.fullName] > 0
              ? h('span', {
                className: 'dgp-remote-prcount',
                'data-dgp-pr-count': repo.fullName,
                title: translate('remote.openPulls', { count: prCounts[repo.fullName] })
              }, String(prCounts[repo.fullName]))
              : null,
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
              onClick: (event) => {
                event.stopPropagation()
                beginClone(repo)
              }
            }, translate('remote.clone'))),
          h('div', { className: 'dgp-remote-meta dgp-oneline' },
            repo.description !== '' ? repo.description + ' · ' : '',
            repo.language !== '' ? repo.language + ' · ' : '',
            repo.updatedAt !== '' ? translate('remote.updatedAt', { time: formatDateTime(Date.parse(repo.updatedAt)) }) : ''),
          folderFor === repo.fullName
            ? h('div', {
              className: 'dgp-remote-cloneform',
              onClick: (event) => event.stopPropagation(),
              onKeyDown: (event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  cancelClone()
                }
              }
            },
              h('label', { className: 'dgp-remote-cloneform-label' }, translate('remote.cloneFolder')),
              h('input', {
                className: 'dgp-input dgp-remote-cloneform-input',
                'data-dgp-remote-folder': repo.fullName,
                value: folderName,
                onChange: (event) => setFolderName(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    confirmClone(repo)
                  }
                }
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
              h('span', null, clone.error),
              h('button', {
                type: 'button',
                className: 'dgp-btn',
                'data-size': 'sm',
                'data-dgp-remote-retry': repo.fullName,
                onClick: (event) => {
                  event.stopPropagation()
                  beginClone(repo)
                }
              }, translate('action.retry')))
            : null)
      }),
      hasMore
        ? h('button', {
          type: 'button',
          className: 'dgp-btn dgp-remote-more',
          'data-size': 'sm',
          disabled: loading,
          onClick: () => {
            source.onLoadMore()
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
            source.onSelectAccount(account)
          }
        }, account.label)),
        h('button', {
          type: 'button',
          className: 'dgp-iconbtn dgp-remote-refresh',
          title: translate('remote.addAccount'),
          'aria-label': translate('remote.addAccount'),
          'data-dgp-remote': 'add-account',
          onClick: () => openForm(providerIdOfAccount(accountId))
        }, h(Icon, { name: 'plus', size: 13 })),
        h('button', {
          type: 'button',
          className: 'dgp-iconbtn',
          title: translate('remote.refresh'),
          'aria-label': translate('remote.refresh'),
          onClick: () => {
            source.onRefresh()
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
          source.onFilterChange(event.target.value)
        }
      }),
    body)
}
