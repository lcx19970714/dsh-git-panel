/**
 * src/components/AddRootForm.js —— 「添加本机目录」的内联表单
 *
 * 语义很简单：加的是用户给的那一个目录，它自己必须含 .git。
 * 不向上找上级仓库、不向下扫描子仓库 —— 校验失败的原因就地显示。
 */
import { h, useCallback, useState } from '../platform.js'
import { stripWrappingQuotes } from '../util/paths.js'

export function AddRootForm(props) {
  const source = props === null || props === undefined ? {} : props
  const translate = source.t
  const onAdd = typeof source.onAdd === 'function' ? source.onAdd : null
  const onCancel = typeof source.onCancel === 'function' ? source.onCancel : null

  const [value, setValue] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = useCallback(async () => {
    // 粘贴「复制为路径」会带引号，先剥掉再提交
    const dir = stripWrappingQuotes(value)
    if (dir === '' || onAdd === null) return
    setSubmitting(true)
    setError(null)
    try {
      await onAdd(dir)
      setValue('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSubmitting(false)
    }
  }, [value, onAdd])

  return h('div', { className: 'dgp-addform', 'data-dgp-addform': 'true' },
    h('input', {
      className: 'dgp-input',
      placeholder: translate('root.addPlaceholder'),
      value,
      autoFocus: true,
      spellCheck: false,
      onChange: (event) => setValue(event.target.value),
      onKeyDown: (event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          submit()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          if (onCancel !== null) onCancel()
        }
      }
    }),
    h('div', { className: 'dgp-hint' }, translate('root.addHint')),
    error === null ? null : h('div', { className: 'dgp-note', 'data-tone': 'error' }, error),
    h('div', { className: 'dgp-addform-actions' },
      onCancel === null
        ? null
        : h('button', {
          type: 'button',
          className: 'dgp-btn',
          'data-size': 'sm',
          onClick: onCancel
        }, translate('root.addCancel')),
      h('button', {
        type: 'button',
        className: 'dgp-btn',
        'data-size': 'sm',
        'data-variant': 'primary',
        'data-dgp-addform-confirm': 'true',
        disabled: submitting || stripWrappingQuotes(value) === '',
        onClick: submit
      }, translate('root.addConfirm'))))
}
