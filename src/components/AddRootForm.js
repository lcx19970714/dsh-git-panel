/**
 * src/components/AddRootForm.js —— 「添加本机目录」的内联表单
 *
 * 语义很简单：加的是用户给的那一个目录，它自己必须含 .git。
 * 不向上找上级仓库、不向下扫描子仓库 —— 校验失败的原因就地显示。
 */
import { h, useCallback, useRef, useState, getPluginContext } from '../platform.js'
import { stripWrappingQuotes } from '../util/paths.js'

export function AddRootForm(props) {
  const source = props
  const translate = source.t
  const onAdd = source.onAdd
  const onCancel = source.onCancel

  const [value, setValue] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [picking, setPicking] = useState(false)
  const busy = useRef(false)
  const inputRef = useRef(null)

  const choosePath = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setPicking(true)
    setError(null)
    try {
      // 与宿主一致：桌面桥优先，否则使用宿主 RPC 的本机目录选择器。
      const desktop = globalThis.__DSH_DIRECTORY_PICKER__
      const path = await (desktop === undefined
        ? getPluginContext().uiWorkspace.pickDirectory()
        : desktop.pick())
      if (path !== null) {
        setValue(path)
        inputRef.current?.focus()
      }
    } catch (failure) {
      setError(translate('root.pickFailed', { message: failure instanceof Error ? failure.message : String(failure) }))
    } finally {
      busy.current = false
      setPicking(false)
    }
  }, [translate])

  const submit = useCallback(async () => {
    if (busy.current) return
    // 粘贴「复制为路径」会带引号，先剥掉再提交
    const dir = stripWrappingQuotes(value)
    if (dir === '') return
    busy.current = true
    setSubmitting(true)
    setError(null)
    try {
      await onAdd(dir)
      setValue('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      busy.current = false
      setSubmitting(false)
    }
  }, [value, onAdd])

  return h('div', {
    className: 'dgp-addform',
    'data-dgp-addform': 'true',
    onKeyDown: (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
    }
  },
    h('div', { className: 'dgp-addform-path' },
    h('input', {
      ref: inputRef,
      className: 'dgp-input',
      'aria-label': translate('root.pathLabel'),
      disabled: picking || submitting,
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
          onCancel()
        }
      }
    }),
    h('button', {
      type: 'button',
      className: 'dgp-btn',
      'data-dgp-addform-browse': 'true',
      disabled: picking || submitting,
      'aria-busy': picking,
      onClick: choosePath
    }, translate(picking ? 'root.picking' : 'root.pickPath'))),
    h('div', { className: 'dgp-hint' }, translate('root.addHint')),
    error === null ? null : h('div', { className: 'dgp-note', 'data-tone': 'error', role: 'alert' }, error),
    h('div', { className: 'dgp-addform-actions' },
      h('button', {
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
        disabled: submitting || picking || stripWrappingQuotes(value) === '',
        onClick: submit
      }, translate('root.addConfirm'))))
}
