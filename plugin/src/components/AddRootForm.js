/**
 * src/components/AddRootForm.js —— 「添加外部仓库」的内联表单
 *
 * 只有一处实现：储存库列表底部与文件模式的根选择器共用同一个表单，
 * 校验与错误显示的行为因此完全一致（不是仓库 / 路径不存在都在这里就地显示）。
 */
import { h, useCallback, useState } from '../platform.js'

export function AddRootForm(props) {
  const source = props === null || props === undefined ? {} : props
  const translate = source.t
  const onAdd = typeof source.onAdd === 'function' ? source.onAdd : null
  const onCancel = typeof source.onCancel === 'function' ? source.onCancel : null

  const [value, setValue] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = useCallback(async () => {
    const dir = value.trim()
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
        disabled: submitting || value.trim() === '',
        onClick: submit
      }, translate('root.addConfirm'))))
}
