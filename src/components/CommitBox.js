/**
 * src/components/CommitBox.js —— 变更列表顶部的提交框
 *
 * 布局只有三块，纵向紧凑：
 *
 *   [ 提交说明（多行）                      ✦ ]
 *   [ 状态一行（提示 / 进度 / 结果）       提交 ]
 *
 * 设计要点：
 *  - **状态只有一行**，按「结果 > 生成中 > 提交中 > 无法提交的原因」取一个显示，
 *    所以成功/失败/进度都不会把下面的变更列表顶下去，也不会并排堆三条提示。
 *  - 提交按钮不可用时，状态行会说清**为什么**（没改动 / 没写说明），不做无声禁用。
 *  - 生成期间输入框禁用：模型结果会直接写进输入框，边等边打字再被覆盖是最糟的体验。
 *  - 输入框随内容长高：生成的说明常常有好几行，固定两行会让用户只能看到尾巴；
 *    长到上限就停止长高、改为滚动，不会把下面的列表挤没。
 */
import { h, useEffect, useRef } from '../platform.js'
import { Icon } from '../ui/Icon.js'

/** 输入框的最小高度（两行）与最大高度（约七行）：到上限就不再长高，改成内部滚动。 */
export const COMMIT_INPUT_MIN_HEIGHT = 52
export const COMMIT_INPUT_MAX_HEIGHT = 160

/**
 * 由内容的实际高度（`scrollHeight`）算出输入框该有多高：
 * 不低于两行、不高于上限。拿不到有效数字时按最小高度处理。
 */
export function commitInputHeight(scrollHeight) {
  const measured = typeof scrollHeight === 'number' && Number.isFinite(scrollHeight) ? scrollHeight : 0
  return Math.min(COMMIT_INPUT_MAX_HEIGHT, Math.max(COMMIT_INPUT_MIN_HEIGHT, Math.ceil(measured)))
}

export function CommitBox(props) {
  const source = props
  const translate = source.t
  const message = typeof source.message === 'string' ? source.message : ''
  const stagedCount = typeof source.stagedCount === 'number' ? source.stagedCount : 0
  const changeCount = typeof source.changeCount === 'number' ? source.changeCount : stagedCount
  const busy = source.busy === true
  const generating = source.generating === true
  const elapsedMs = typeof source.elapsedMs === 'number' && source.elapsedMs > 0 ? source.elapsedMs : 0
  const note = source.note === null || source.note === undefined ? null : source.note

  // 内容变了就重新量一次高度（生成填充、手动输入、清空都走这里）
  const inputRef = useRef(null)
  useEffect(() => {
    const element = inputRef.current
    if (element === null || element === undefined) return
    element.style.height = 'auto'
    element.style.height = commitInputHeight(element.scrollHeight) + 'px'
  }, [message])

  const hasMessage = message.trim() !== ''
  const hasChanges = changeCount > 0
  // 有改动 + 有说明就能提交：没有暂存时，提交会先把全部改动暂存（smart commit）
  const canCommit = hasMessage && hasChanges && busy !== true && generating !== true

  // 状态行只显示一件事：结果 > 生成中 > 提交中 > 不能提交的原因
  let statusKind = null
  let statusText = null
  if (note !== null) {
    statusKind = 'note'
    statusText = note.text
  } else if (generating) {
    statusKind = 'progress'
    statusText = translate('commit.generatingElapsed', { seconds: (elapsedMs / 1000).toFixed(1) })
  } else if (busy) {
    statusKind = 'busy'
    statusText = translate('commit.submitting')
  } else if (!hasChanges) {
    statusKind = 'hint'
    statusText = translate('commit.hintNoChanges')
  } else if (!hasMessage) {
    statusKind = 'hint'
    statusText = translate('commit.hintNoMessage')
  } else if (stagedCount === 0) {
    statusKind = 'hint'
    statusText = translate('commit.hintStageAll')
  }

  return h('div', { className: 'dgp-commit' },
    h('div', { className: 'dgp-commit-input-wrap' },
      h('textarea', {
        ref: inputRef,
        className: 'dgp-commit-input',
        'data-dgp-commit': 'input',
        rows: 2,
        placeholder: translate('commit.placeholder'),
        value: message,
        disabled: busy === true || generating === true,
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

    h('div', { className: 'dgp-commit-actions' },
      statusKind === null
        ? null
        : h('div', {
          className: 'dgp-commit-status',
          'data-dgp-commit': 'status',
          'data-kind': statusKind,
          'data-tone': note === null ? undefined : (note.tone === 'error' ? 'error' : 'info'),
          title: statusText
        },
        statusKind === 'progress' ? h('span', { className: 'dgp-spinner' }) : null,
        h('span', { className: 'dgp-commit-status-text dgp-oneline' }, statusText)),
      h('button', {
        type: 'button',
        className: 'dgp-btn dgp-commit-submit',
        'data-variant': 'primary',
        'data-size': 'sm',
        'data-dgp-commit': 'submit',
        disabled: canCommit !== true,
        title: canCommit ? translate('commit.submit') : translate(hasChanges ? 'commit.hintNoMessage' : 'commit.hintNoChanges'),
        onClick: () => {
          if (typeof source.onCommit === 'function') source.onCommit()
        }
      }, translate(busy ? 'commit.submitting' : 'commit.submit')),
      typeof source.onCreatePull === 'function'
        ? h('button', {
          type: 'button',
          className: 'dgp-btn dgp-commit-pr',
          'data-variant': 'ghost',
          'data-size': 'sm',
          'data-dgp-commit': 'create-pr',
          disabled: busy,
          onClick: () => source.onCreatePull()
        }, translate('pr.open'))
        : null))
}
