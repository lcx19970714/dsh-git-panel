/**
 * src/components/CreatePullForm.js —— 变更 Tab 的「创建 PR」表单（渲染在右侧面板）
 *
 * 交互顺序按用户真实操作：
 *   仓库与源分支（只读）→ 目标分支（记住上次）→ 生成标题与描述 → 自己改 → 创建 PR
 * 未推送时给出明确阻断（先 git push），不假装能创建。
 */
import { h } from '../platform.js'
import { Icon } from '../ui/Icon.js'

export function CreatePullForm(props) {
  const source = props
  const t = source.t
  const form = source.form
  if (form === null || form === undefined) return null

  const header = h('div', { className: 'dgp-detail-top' },
    h('div', { className: 'dgp-detail-name-row' },
      h('span', { className: 'dgp-detail-name dgp-oneline' },
        t('pr.title') + ' · ' + (form.repo === null ? '' : form.repo.fullName))),
    h('button', {
      type: 'button',
      className: 'dgp-btn',
      'data-size': 'sm',
      'data-dgp-pr': 'cancel',
      onClick: () => source.onCancel()
    }, t('pr.cancel')))

  if (form.loading === true) {
    return h('div', { className: 'dgp-detail dgp-pr-form', 'data-dgp-pr': 'form' },
      header,
      h('p', { className: 'dgp-detail-meta' }, t('pr.loading')))
  }
  if (form.error !== null) {
    return h('div', { className: 'dgp-detail dgp-pr-form', 'data-dgp-pr': 'form' },
      header,
      h('p', { className: 'dgp-detail-failure', 'data-dgp-pr': 'error' }, form.error))
  }

  /* 创建成功后：只显示结果与打开入口 */
  if (form.created !== null) {
    return h('div', { className: 'dgp-detail dgp-pr-form', 'data-dgp-pr': 'form' },
      header,
      h('div', { className: 'dgp-detail-section' },
        h('p', { className: 'dgp-detail-title' }, t('pr.createdTitle', { number: form.created.number })),
        h('p', { className: 'dgp-detail-meta' }, form.head + ' → ' + form.base),
        h('div', { className: 'dgp-pull-actions' },
          h('button', {
            type: 'button',
            className: 'dgp-btn',
            'data-size': 'sm',
            'data-variant': 'primary',
            'data-dgp-pr': 'open-created',
            onClick: () => source.onOpenUrl(form.created.url)
          }, t('pr.openCreated'), h(Icon, { name: 'external', size: 12 })),
          h('button', {
            type: 'button',
            className: 'dgp-btn',
            'data-size': 'sm',
            'data-dgp-pr': 'done',
            onClick: () => source.onCancel()
          }, t('pr.done')))))
  }

  const baseOptions = Array.isArray(form.bases) ? form.bases : []
  const accountOptions = Array.isArray(form.accounts) ? form.accounts : []

  return h('div', { className: 'dgp-detail dgp-pr-form', 'data-dgp-pr': 'form' },
    header,
    h('div', { className: 'dgp-pr-row' },
      h('span', { className: 'dgp-settings-label' }, t('pr.repo')),
      h('span', { className: 'dgp-detail-meta' }, form.repo.fullName + '（' + form.repo.provider + '）')),
    h('div', { className: 'dgp-pr-row' },
      h('span', { className: 'dgp-settings-label' }, t('pr.head')),
      h('span', { className: 'dgp-detail-meta' }, form.head)),
    accountOptions.length > 1
      ? h('div', { className: 'dgp-pr-row' },
        h('span', { className: 'dgp-settings-label' }, t('pr.account')),
        h('select', {
          className: 'dgp-select',
          'data-dgp-pr': 'account',
          value: form.accountId,
          onChange: (event) => source.onChangeAccount(event.target.value)
        }, accountOptions.map((account) => h('option', { key: account.id, value: account.id },
          account.label + '（' + account.id + '）'))))
      : null,
    h('div', { className: 'dgp-pr-row' },
      h('span', { className: 'dgp-settings-label' }, t('pr.base')),
      h('select', {
        className: 'dgp-select',
        'data-dgp-pr': 'base',
        value: form.base,
        onChange: (event) => source.onChangeBase(event.target.value)
      }, baseOptions.map((branch) => h('option', { key: branch, value: branch }, branch))),
      h('span', { className: 'dgp-settings-hint' }, t('pr.baseHint'))),

    form.pushed !== true
      ? h('p', { className: 'dgp-detail-notice', 'data-dgp-pr': 'not-pushed' }, t('pr.notPushed'))
      : null,

    h('div', { className: 'dgp-pr-row' },
      h('span', { className: 'dgp-settings-label' }, t('pr.subject')),
      h('button', {
        type: 'button',
        className: 'dgp-btn',
        'data-size': 'sm',
        'data-dgp-pr': 'generate',
        disabled: form.generating === true || form.creating === true,
        onClick: () => source.onGenerate()
      }, t(form.generating === true ? 'pr.generating' : 'pr.generate'))),
    h('input', {
      className: 'dgp-input',
      'data-dgp-pr': 'title',
      placeholder: t('pr.titlePlaceholder'),
      value: form.title,
      spellCheck: false,
      onChange: (event) => source.onChangeTitle(event.target.value)
    }),
    h('textarea', {
      className: 'dgp-input dgp-pr-body',
      'data-dgp-pr': 'body',
      placeholder: t('pr.bodyPlaceholder'),
      value: form.body,
      spellCheck: false,
      style: { height: form.bodyHeight },
      onChange: (event) => source.onChangeBody(event.target.value)
    }),
    h('div', { className: 'dgp-pull-actions' },
      h('button', {
        type: 'button',
        className: 'dgp-btn',
        'data-size': 'sm',
        'data-variant': 'primary',
        'data-dgp-pr': 'create',
        disabled: form.creating === true || form.pushed !== true || form.title.trim() === '' || form.base === '',
        onClick: () => source.onCreate()
      }, t(form.creating === true ? 'pr.creating' : 'pr.create')),
      form.notice === null ? null : h('span', { className: 'dgp-detail-notice', 'data-dgp-pr': 'notice' }, form.notice)))
}
