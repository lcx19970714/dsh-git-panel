/**
 * src/components/SettingsView.js —— 插件设置页
 *
 * 三段：生成提交说明的模型、变更区显示偏好、代码托管账号。
 * 选项一律来自宿主读到的事实（模型目录、已保存账号），读不到就只展示错误，
 * 不给一个假的默认项。
 */
import { h, useState } from '../platform.js'
import { openExternalUrl } from '../util/openUrl.js'
import { Icon } from '../ui/Icon.js'
import { InlineNote } from './States.js'

export function SettingsView(props) {
  const source = props === null || props === undefined ? {} : props
  const translate = source.t
  const models = Array.isArray(source.models) ? source.models : []
  const accounts = Array.isArray(source.accounts) ? source.accounts : []
  const loading = source.loading === true
  const error = typeof source.error === 'string' && source.error !== '' ? source.error : null
  const saved = source.saved === true
  const accountsBusy = source.accountsBusy === true
  const accountsError = typeof source.accountsError === 'string' && source.accountsError !== ''
    ? source.accountsError
    : null
  const providers = Array.isArray(source.providers) ? source.providers : []

  const [provider, setProvider] = useState(providers.length > 0 ? providers[0].id : 'github')
  const [label, setLabel] = useState('')
  const [token, setToken] = useState('')
  // 点过「获取令牌」之后给什么提示：'opened' 或拦截时的地址
  const [tokenHint, setTokenHint] = useState(null)

  const selected = providers.find((item) => item.id === provider) ?? { id: provider, label: provider }
  // 每个平台的三步都不同（菜单路径、scope 名都不一样），文案按平台 id 取
  const steps = provider === 'gitee'
    ? ['accounts.guideGitee1', 'accounts.guideGitee2', 'accounts.guideGitee3'].map((key) => translate(key))
    : ['accounts.guideGithub1', 'accounts.guideGithub2', 'accounts.guideGithub3'].map((key) => translate(key))

  const submitAccount = () => {
    if (typeof source.onAddAccount !== 'function' || token.trim() === '') return
    source.onAddAccount({ provider, label: label.trim(), token: token.trim() })
    setToken('')
    setLabel('')
  }

  return h('div', { className: 'dgp-settings', 'data-dgp-view': 'settings' },
    h('div', { className: 'dgp-settings-head' },
      h('button', {
        type: 'button',
        className: 'dgp-btn',
        'data-size': 'sm',
        'data-dgp-settings': 'back',
        onClick: () => {
          if (typeof source.onBack === 'function') source.onBack()
        }
      }, translate('settings.back')),
      h('h2', { className: 'dgp-settings-title' }, translate('settings.title'))),
    loading
      ? h(InlineNote, { tone: 'info' }, translate('settings.loading'))
      : null,
    error !== null
      ? h(InlineNote, { tone: 'error' }, error)
      : null,
    loading || error !== null
      ? null
      : h('div', { className: 'dgp-settings-field' },
        h('label', { className: 'dgp-settings-label' }, translate('settings.modelLabel')),
        h('select', {
          className: 'dgp-select',
          'data-dgp-settings': 'model',
          value: typeof source.commitModel === 'string' ? source.commitModel : '',
          onChange: (event) => {
            if (typeof source.onChangeModel === 'function') source.onChangeModel(event.target.value)
          }
        },
        h('option', { value: '' }, translate('settings.modelNone')),
        models.map((model) => h('option', { key: model.ref, value: model.ref },
          model.providerLabel + ' · ' + model.modelLabel))),
        h('p', { className: 'dgp-settings-hint' }, translate('settings.modelHint')),
        saved ? h(InlineNote, { tone: 'info' }, translate('settings.saved')) : null),
    h('div', { className: 'dgp-settings-field' },
      h('label', { className: 'dgp-settings-label' }, translate('settings.viewLabel')),
      h('select', {
        className: 'dgp-select',
        'data-dgp-settings': 'changes-view',
        value: source.changesView === 'tree' ? 'tree' : 'list',
        onChange: (event) => {
          if (typeof source.onChangeChangesView === 'function') source.onChangeChangesView(event.target.value)
        }
      },
      h('option', { value: 'list' }, translate('settings.viewList')),
      h('option', { value: 'tree' }, translate('settings.viewTree')))),
    h('div', { className: 'dgp-settings-field' },
      h('label', { className: 'dgp-settings-label' }, translate('settings.untrackedLabel')),
      h('select', {
        className: 'dgp-select',
        'data-dgp-settings': 'untracked-mode',
        value: source.untrackedMode === 'separate' ? 'separate' : 'merge',
        onChange: (event) => {
          if (typeof source.onChangeUntrackedMode === 'function') source.onChangeUntrackedMode(event.target.value)
        }
      },
      h('option', { value: 'merge' }, translate('settings.untrackedMerge')),
      h('option', { value: 'separate' }, translate('settings.untrackedSeparate')))),

    /* ------------------------------ 代码托管账号 ------------------------------ */
    h('div', { className: 'dgp-settings-field' },
      h('label', { className: 'dgp-settings-label' }, translate('accounts.title')),
      h('p', { className: 'dgp-settings-hint' }, translate('accounts.hint')),
      accounts.length === 0
        ? h('p', { className: 'dgp-settings-hint', 'data-dgp-accounts': 'empty' }, translate('accounts.empty'))
        : h('ul', { className: 'dgp-account-list', 'data-dgp-accounts': 'list' },
          accounts.map((account) => h('li', { key: account.id, className: 'dgp-account-item' },
            h('span', { className: 'dgp-account-name dgp-oneline' }, account.label),
            h('span', { className: 'dgp-account-meta' }, account.providerLabel + ' · ' + account.login),
            h('button', {
              type: 'button',
              className: 'dgp-row-action',
              'data-dgp-account-remove': account.id,
              title: translate('accounts.remove', { name: account.label }),
              'aria-label': translate('accounts.remove', { name: account.label }),
              onClick: () => {
                if (typeof source.onRemoveAccount === 'function') source.onRemoveAccount(account.id)
              }
            }, h(Icon, { name: 'trash', size: 13 }))))),
      accountsError !== null
        ? h(InlineNote, { tone: 'error' }, accountsError)
        : null,
      typeof source.accountsNotice === 'string' && source.accountsNotice !== ''
        ? h(InlineNote, { tone: 'info' }, source.accountsNotice)
        : null,
      /* 引导：按当前平台给三步 + 一键打开令牌页，免得用户自己去翻设置菜单 */
      h('div', { className: 'dgp-account-guide', 'data-dgp-accounts': 'guide' },
        h('div', { className: 'dgp-account-guide-head' },
          h('span', { className: 'dgp-account-guide-title' },
            translate('accounts.guideTitle') + ' · ' + selected.label),
          selected.tokenUrl === undefined
            ? null
            : h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-dgp-accounts': 'open-token-page',
              onClick: () => {
                const result = openExternalUrl(selected.tokenUrl)
                setTokenHint(result.opened ? 'opened' : selected.tokenUrl)
              }
            }, translate('accounts.getToken'), h(Icon, { name: 'external', size: 12 }))),
        h('ol', { className: 'dgp-account-steps' },
          steps.map((step, index) => h('li', { key: String(index) }, step))),
        h('p', { className: 'dgp-settings-hint' }, translate('accounts.verifyHint'))),

      h('div', { className: 'dgp-account-form' },
        h('select', {
          className: 'dgp-select dgp-account-provider',
          'data-dgp-accounts': 'provider',
          value: provider,
          onChange: (event) => setProvider(event.target.value)
        },
        providers.map((item) => h('option', { key: item.id, value: item.id }, item.label))),
        h('input', {
          className: 'dgp-input',
          'data-dgp-accounts': 'label',
          placeholder: translate('accounts.label'),
          value: label,
          onChange: (event) => setLabel(event.target.value)
        }),
        h('input', {
          className: 'dgp-input',
          'data-dgp-accounts': 'token',
          type: 'password',
          placeholder: translate('accounts.tokenPlaceholder'),
          value: token,
          onChange: (event) => setToken(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Enter' && !accountsBusy && token.trim() !== '') submitAccount()
          }
        }),
        h('button', {
          type: 'button',
          className: 'dgp-btn',
          'data-size': 'sm',
          'data-variant': 'primary',
          'data-dgp-accounts': 'add',
          disabled: accountsBusy || token.trim() === '',
          onClick: submitAccount
        }, translate(accountsBusy ? 'accounts.adding' : 'accounts.add'))),

      tokenHint === null
        ? null
        : h('p', { className: 'dgp-settings-hint', 'data-dgp-accounts': 'token-hint' },
          tokenHint === 'opened'
            ? translate('accounts.openedPage')
            : translate('accounts.blockedPage') + ' ' + tokenHint)))
}
