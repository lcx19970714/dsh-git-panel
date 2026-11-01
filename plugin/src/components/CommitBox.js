/**
 * src/components/CommitBox.js —— 变更列表顶部的提交框
 *
 * 结构：多行输入框，右上角一颗生成按钮；输入框下方一颗提交按钮。
 * 提交按钮只在「有说明 + 有已暂存改动」时可用，与 VS Code 的提交框一致。
 *
 * 生成提交说明是一个要等几秒的模型调用，所以这里必须让用户看得见：
 * 生成中显示一条走动的不确定进度条 + 转圈 + 已等待秒数（每 200ms 由 Panel 更新）。
 */
import { h } from '../platform.js'
import { Icon } from '../ui/Icon.js'

export function CommitBox(props) {
  const source = props === null || props === undefined ? {} : props
  const translate = source.t
  const message = typeof source.message === 'string' ? source.message : ''
  const stagedCount = typeof source.stagedCount === 'number' ? source.stagedCount : 0
  const busy = source.busy === true
  const generating = source.generating === true
  const elapsedMs = typeof source.elapsedMs === 'number' && source.elapsedMs > 0 ? source.elapsedMs : 0
  const canCommit = message.trim() !== '' && stagedCount > 0 && busy !== true && generating !== true

  return h('div', { className: 'dgp-commit' },
    h('div', { className: 'dgp-commit-input-wrap' },
      h('textarea', {
        className: 'dgp-commit-input',
        'data-dgp-commit': 'input',
        rows: 2,
        placeholder: translate(generating ? 'commit.generating' : 'commit.placeholder'),
        value: message,
        disabled: busy,
        onChange: (event) => {
          if (typeof source.onChange === 'function') source.onChange(event.target.value)
        },
        onKeyDown: (event) => {
          if ((event.ctrlKey === true || event.metaKey === true) && event.key === 'Enter' && canCommit) {
            event.preventDefault()
            source.onCommit()
          }
        }
      }),
      h('button', {
        type: 'button',
        className: 'dgp-commit-generate',
        'data-dgp-commit': 'generate',
        'data-busy': generating ? 'true' : undefined,
        disabled: generating || busy,
        title: translate(generating ? 'commit.generating' : 'commit.generate'),
        'aria-label': translate('commit.generate'),
        onClick: () => {
          if (typeof source.onGenerate === 'function') source.onGenerate()
        }
      },
      // 生成中把笔形图标换成转圈：一眼就能看出还在跑
      generating ? h('span', { className: 'dgp-spinner' }) : h(Icon, { name: 'sparkle', size: 14 }))),

    generating
      ? h('div', { className: 'dgp-commit-progress', 'data-dgp-commit': 'progress' },
        h('span', { className: 'dgp-progress', 'aria-hidden': 'true' }),
        h('span', { className: 'dgp-commit-progress-text' },
          translate('commit.generatingElapsed', { seconds: (elapsedMs / 1000).toFixed(1) })))
      : null,

    h('button', {
      type: 'button',
      className: 'dgp-btn dgp-commit-submit',
      'data-variant': 'primary',
      'data-dgp-commit': 'submit',
      disabled: canCommit !== true,
      onClick: () => {
        if (typeof source.onCommit === 'function') source.onCommit()
      }
    }, translate(busy ? 'commit.submitting' : 'commit.submit')))
}
