/**
 * src/components/SettingsView.js —— 插件设置页
 *
 * 三段：生成提交说明的模型、变更区显示偏好、代码托管账号。
 * 选项一律来自宿主读到的事实（模型目录、已保存账号），读不到就只展示错误，
 * 不给一个假的默认项。
 */
import { h, useEffect, useRef, useState } from '../platform.js'
import { openExternalUrl } from '../util/openUrl.js'
import { copyText } from '../util/clipboard.js'
import { Icon } from '../ui/Icon.js'
import { InlineNote } from './States.js'

export function SettingsView(props) {
  const { models, accounts, providers, loading, error, saved, accountsBusy, accountsError, accountsNotice, commitModel: commitModelRef, reviewModel, commitThinking, commitReasoningEffort, changesView, untrackedMode, postCommitPush, t } = props
  /** 回调集中在 props 上，渲染代码只关心「点了会发生什么」。 */
  const source = props
  const translate = t

  const commitModel = models.find((model) => model.ref === commitModelRef)
  const reasoning = commitModel === undefined || commitModel.reasoning === undefined ? null : commitModel.reasoning
  const efforts = reasoning === null || reasoning.efforts === undefined ? [] : reasoning.efforts.filter((effort) => effort.id !== 'off')
  const thinkingSupported = reasoning !== null && reasoning.supported === true && efforts.length > 0
  const thinkingHint = commitModel === undefined ? 'settings.thinkingSelectModel'
    : !thinkingSupported ? 'settings.thinkingUnsupported'
      : reasoning.toggleable !== true ? 'settings.thinkingRequired' : 'settings.commitThinkingHint'

  // 初始 provider 为空：平台列表是异步读到的，等它到了再选第一个（不在列表里也重新选）。
  const [provider, setProvider] = useState('')
  const [label, setLabel] = useState('')
  const [token, setToken] = useState('')
  // 点过「获取令牌」之后给什么提示：'opened' 或拦截时的地址
  const [tokenHint, setTokenHint] = useState(null)
  /** 添加账号失败的原因：显示在表单下方（不只看页面顶部的账号区错误）。 */
  const [addError, setAddError] = useState(null)
  const [addBusy, setAddBusy] = useState(false)
  // 正在编辑的账号：{ id, label, token, tokenText, revealed, busy, error, notice }
  const [editing, setEditing] = useState(null)
  /** 编辑区的世代号：关闭 / 换账号后，旧的令牌读取结果不能再把编辑区「复活」。 */
  const editAttemptRef = useRef(0)

  useEffect(() => {
    setProvider((previous) => (providers.some((item) => item.id === previous) ? previous : (providers[0]?.id ?? '')))
  }, [providers])

  // 被删掉的账号不能继续留在编辑区（否则再点保存会报「账号不存在」）。
  useEffect(() => {
    if (editing === null) return
    if (accounts.some((account) => account.id === editing.id)) return
    setEditing(null)
  }, [accounts, editing])

  const selected = providers.find((item) => item.id === provider) ?? null
  // 每个平台的三步都不同（菜单路径、scope 名都不一样），文案按平台 id 取
  const steps = provider === 'gitee'
    ? ['accounts.guideGitee1', 'accounts.guideGitee2', 'accounts.guideGitee3'].map((key) => translate(key))
    : ['accounts.guideGithub1', 'accounts.guideGithub2', 'accounts.guideGithub3'].map((key) => translate(key))

  const submitAccount = async () => {
    if (token.trim() === '' || provider === '' || addBusy || accountsBusy) return
    setAddError(null)
    setAddBusy(true)
    try {
      const result = await source.onAddAccount({ provider, label: label.trim(), token: token.trim() })
      if (result.ok) {
        setToken('')
        setLabel('')
        return
      }
      setAddError(result.error)
    } finally {
      setAddBusy(false)
    }
  }

  /* ------------------------------ 账号编辑区 ------------------------------ */

  const patchEditing = (patch) => {
    setEditing((previous) => (previous === null ? null : { ...previous, ...patch }))
  }

  const openEditing = (account) => {
    editAttemptRef.current += 1
    setEditing({
      id: account.id,
      label: account.label,
      token: '',
      tokenText: null,
      revealed: false,
      busy: false,
      error: null,
      notice: null
    })
  }

  const closeEditing = () => {
    editAttemptRef.current += 1
    setEditing(null)
  }

  const readToken = async () => {
    if (editing === null || editing.busy) return
    const attempt = editAttemptRef.current
    patchEditing({ busy: true, error: null })
    const result = await source.onReadToken(editing.id)
    if (editAttemptRef.current !== attempt) return
    if (result.ok === true) {
      patchEditing({ busy: false, revealed: true, tokenText: result.token })
      return
    }
    patchEditing({ busy: false, error: result.error })
  }

  const copyToken = async () => {
    if (editing === null || editing.tokenText === null) return
    const attempt = editAttemptRef.current
    const copied = await copyText(editing.tokenText)
    if (editAttemptRef.current !== attempt) return
    patchEditing({
      notice: copied.ok ? translate('accounts.copied') : translate('accounts.copyFailed'),
      error: null
    })
  }

  const saveEditing = async () => {
    if (editing === null || editing.busy) return
    const attempt = editAttemptRef.current
    const submitted = { id: editing.id, label: editing.label, token: editing.token }
    patchEditing({ busy: true, error: null, notice: null })
    const result = await source.onUpdateAccount(submitted)
    if (editAttemptRef.current !== attempt) return
    if (result.ok === true) {
      patchEditing({ busy: false, token: '', notice: translate('accounts.updated') })
      return
    }
    patchEditing({ busy: false, error: result.error })
  }

  return h('div', { className: 'dgp-settings', 'data-dgp-view': 'settings' },
    h('div', { className: 'dgp-settings-head' },
      h('button', {
        type: 'button',
        className: 'dgp-btn',
        'data-size': 'sm',
        'data-dgp-settings': 'back',
        onClick: () => {
          source.onBack()
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
          value: commitModelRef ?? '',
          onChange: (event) => {
            source.onChangeModel(event.target.value)
          }
        },
        h('option', { value: '' }, translate('settings.modelNone')),
        models.map((model) => h('option', { key: model.ref, value: model.ref },
          model.providerLabel + ' · ' + model.modelLabel))),
        h('p', { className: 'dgp-settings-hint' }, translate('settings.modelHint')),
        h('label', { className: 'dgp-settings-field dgp-settings-label' },
          h('span', null, translate('settings.commitThinkingLabel')),
          h('select', {
            className: 'dgp-select',
            'data-dgp-settings': 'commit-thinking',
            value: commitThinking ? 'on' : 'off',
            disabled: !thinkingSupported,
            onChange: (event) => source.onChangeCommitThinking({ commitThinking: event.target.value === 'on' })
          },
          h('option', { value: 'off' }, translate('settings.thinkingOff')),
          h('option', { value: 'on' }, translate('settings.thinkingOn')))),
        h('p', { className: 'dgp-settings-hint' }, translate(thinkingHint)),
        commitThinking && thinkingSupported
          ? h('label', { className: 'dgp-settings-field dgp-settings-label' },
            h('span', null, translate('settings.commitEffortLabel')),
            h('select', {
              className: 'dgp-select',
              'data-dgp-settings': 'commit-reasoning-effort',
              value: commitReasoningEffort ?? '',
              onChange: (event) => source.onChangeCommitThinking({ commitReasoningEffort: event.target.value || null })
            },
            h('option', { value: '' }, translate('settings.effortDefault')),
            efforts.map((effort) => h('option', { key: effort.id, value: effort.id, title: effort.description }, effort.name))))
          : null),
      h('div', { className: 'dgp-settings-field' },
        h('label', { className: 'dgp-settings-label' }, translate('settings.reviewModelLabel')),
        h('select', {
          className: 'dgp-select',
          'data-dgp-settings': 'review-model',
          value: reviewModel ?? '',
          onChange: (event) => {
            source.onChangeReviewModel(event.target.value)
          }
        },
        h('option', { value: '' }, translate('settings.modelNone')),
        models.map((model) => h('option', { key: model.ref, value: model.ref },
          model.providerLabel + ' · ' + model.modelLabel))),
        h('p', { className: 'dgp-settings-hint' }, translate('settings.reviewModelHint')),
        saved ? h(InlineNote, { tone: 'info' }, translate('settings.saved')) : null),
    h('div', { className: 'dgp-settings-field' },
      h('label', { className: 'dgp-settings-label' }, translate('settings.viewLabel')),
      h('select', {
        className: 'dgp-select',
        'data-dgp-settings': 'changes-view',
        value: changesView === 'tree' ? 'tree' : 'list',
        onChange: (event) => {
          source.onChangeChangesView(event.target.value)
        }
      },
      h('option', { value: 'list' }, translate('settings.viewList')),
      h('option', { value: 'tree' }, translate('settings.viewTree')))),
    h('div', { className: 'dgp-settings-field' },
      h('label', { className: 'dgp-settings-label' }, translate('settings.untrackedLabel')),
      h('select', {
        className: 'dgp-select',
        'data-dgp-settings': 'untracked-mode',
        value: untrackedMode === 'separate' ? 'separate' : 'merge',
        onChange: (event) => {
          source.onChangeUntrackedMode(event.target.value)
        }
      },
      h('option', { value: 'merge' }, translate('settings.untrackedMerge')),
      h('option', { value: 'separate' }, translate('settings.untrackedSeparate')))),
    h('div', { className: 'dgp-settings-field' },
      h('label', { className: 'dgp-settings-label' }, translate('settings.postPushLabel')),
      h('select', {
        className: 'dgp-select',
        'data-dgp-settings': 'post-commit-push',
        value: postCommitPush ? 'on' : 'off',
        onChange: (event) => {
          source.onChangePostCommitPush(event.target.value === 'on')
        }
      },
      h('option', { value: 'on' }, translate('settings.postPushOn')),
      h('option', { value: 'off' }, translate('settings.postPushOff'))),
      h('p', { className: 'dgp-settings-hint' }, translate('settings.postPushHint'))),

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
              'data-dgp-account-edit': account.id,
              title: translate('accounts.edit', { name: account.label }),
              'aria-label': translate('accounts.edit', { name: account.label }),
              onClick: () => openEditing(account)
            }, h(Icon, { name: 'file', size: 14 })),
            h('button', {
              type: 'button',
              className: 'dgp-row-action',
              'data-dgp-account-remove': account.id,
              title: translate('accounts.remove', { name: account.label }),
              'aria-label': translate('accounts.remove', { name: account.label }),
              onClick: () => {
                source.onRemoveAccount(account.id)
              }
            }, h(Icon, { name: 'trash', size: 14 }))))),
      editing === null
        ? null
        : h('div', {
          className: 'dgp-account-inline',
          'data-dgp-accounts': 'editor',
          onKeyDown: (event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              closeEditing()
              return
            }
            if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
              event.preventDefault()
              saveEditing()
            }
          }
        },
          h('div', { className: 'dgp-account-inline-head' },
            h('span', { className: 'dgp-account-guide-title' },
              translate('accounts.edit', { name: editing.label })),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-variant': 'ghost',
              'data-dgp-accounts': 'hide-token',
              onClick: () => patchEditing({ revealed: false, tokenText: null })
            }, translate('accounts.hide'))),
          h('div', { className: 'dgp-account-form' },
            h('input', {
              className: 'dgp-input',
              'data-dgp-accounts': 'edit-label',
              placeholder: translate('accounts.editLabel'),
              value: editing.label,
              disabled: editing.busy,
              onChange: (event) => patchEditing({ label: event.target.value })
            }),
            h('input', {
              className: 'dgp-input',
              'data-dgp-accounts': 'edit-token',
              placeholder: translate('accounts.tokenReplaceHint'),
              value: editing.token,
              disabled: editing.busy,
              onChange: (event) => patchEditing({ token: event.target.value })
            }),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-dgp-accounts': 'reveal-token',
              disabled: editing.busy,
              onClick: () => {
                if (editing.revealed) {
                  patchEditing({ revealed: false, tokenText: null })
                  return
                }
                readToken()
              }
            }, translate(editing.revealed ? 'accounts.hide' : 'accounts.reveal')),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-dgp-accounts': 'copy-token',
              disabled: editing.tokenText === null,
              onClick: () => copyToken()
            }, translate('accounts.copy')),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-variant': 'primary',
              'data-dgp-accounts': 'save-account',
              disabled: editing.busy,
              onClick: () => saveEditing()
            }, translate(editing.busy ? 'accounts.saving' : 'accounts.saveLabel')),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              onClick: closeEditing
            }, translate('remote.cloneCancel'))),
          editing.revealed && editing.tokenText !== null
            ? h('code', {
              className: 'dgp-account-token dgp-oneline',
              'data-dgp-accounts': 'token-value',
              title: editing.tokenText
            }, editing.tokenText)
            : null,
          editing.notice !== null
            ? h('div', { className: 'dgp-remote-status', 'data-dgp-accounts': 'editor-notice' },
              h('span', null, editing.notice))
            : null,
          editing.error !== null
            ? h('div', { className: 'dgp-remote-status', 'data-tone': 'error' }, h('span', null, editing.error))
            : null),

      accountsError !== null
        ? h(InlineNote, { tone: 'error' }, accountsError)
        : null,
      accountsNotice === null
        ? null
        : h(InlineNote, { tone: 'info' }, accountsNotice),
      /* 引导：按当前平台给三步 + 一键打开令牌页（平台列表还没读到时整块不渲染） */
      selected === null ? null : h('div', { className: 'dgp-account-guide', 'data-dgp-accounts': 'guide' },
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
          disabled: addBusy,
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
          disabled: accountsBusy || addBusy || provider === '' || token.trim() === '',
          onClick: submitAccount
        }, translate(addBusy ? 'accounts.adding' : 'accounts.add')),
      addError === null
        ? null
        : h('div', { className: 'dgp-remote-status', 'data-tone': 'error' }, h('span', null, addError))),

      tokenHint === null
        ? null
        : h('p', { className: 'dgp-settings-hint', 'data-dgp-accounts': 'token-hint' },
          tokenHint === 'opened'
            ? translate('accounts.openedPage')
            : translate('accounts.blockedPage') + ' ' + tokenHint)))
}
