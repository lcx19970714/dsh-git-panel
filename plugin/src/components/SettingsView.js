/**
 * src/components/SettingsView.js —— 插件设置页
 *
 * 目前只有一项：生成提交说明用的模型。选项来自宿主读到的模型目录，
 * 选中即保存；目录为空或读取失败时只展示错误，不给一个假的默认项。
 */
import { h } from '../platform.js'
import { Icon } from '../ui/Icon.js'
import { InlineNote } from './States.js'

export function SettingsView(props) {
  const source = props === null || props === undefined ? {} : props
  const translate = source.t
  const models = Array.isArray(source.models) ? source.models : []
  const loading = source.loading === true
  const error = typeof source.error === 'string' && source.error !== '' ? source.error : null
  const saved = source.saved === true

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
        saved ? h(InlineNote, { tone: 'info' }, translate('settings.saved')) : null))
}
