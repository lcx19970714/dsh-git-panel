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
 *  - 输入框随内容长高：高度由实测 scrollHeight 决定（与「创建 PR」描述框共用
 *    `../ui/useAutoGrow.js`），长到上限就停止长高、改为内部滚动。
 */
import { h, useRef } from '../platform.js'
import { Icon } from '../ui/Icon.js'
import { useAutoGrow } from '../ui/useAutoGrow.js'

/** 输入框的最小高度（两行）与最大高度（约七行）：到上限就不再长高，改成内部滚动。 */
export const COMMIT_INPUT_MIN_HEIGHT = 52
export const COMMIT_INPUT_MAX_HEIGHT = 160

/**
 * 这些错误码是「模型本身有问题」：余额、密钥、限流、模型不存在、输出被截断。
 * 共同点是**换个模型就能继续**，所以提示旁边给一个直达设置页的按钮，而不是让用户自己找齿轮。
 */
const MODEL_NOTE_CODES = new Set(['model-failed', 'model-truncated', 'unknown-model', 'no-commit-model'])

export function CommitBox(props) {
  const {
    message,
    stagedCount,
    changeCount,
    busy,
    generating,
    elapsedMs,
    note,
    onChange,
    onCommit,
    onGenerate,
    onOpenSettings,
    onCreatePull,
    t
  } = props

  const inputRef = useRef(null)
  useAutoGrow(inputRef, message, { min: COMMIT_INPUT_MIN_HEIGHT, max: COMMIT_INPUT_MAX_HEIGHT })

  const hasMessage = message.trim() !== ''
  const hasChanges = changeCount > 0
  // 有改动 + 有说明就能提交：没有暂存时，提交会先把全部改动暂存（smart commit）
  const canCommit = hasMessage && hasChanges && busy !== true && generating !== true

  // 错误提示要能读：换行显示（最多 5 行），并在「换模型就能解决」时给一个直达设置页的按钮
  const noteIsError = note !== null && note.tone === 'error'
  const noteOffersSettings = noteIsError && MODEL_NOTE_CODES.has(note.code)

  // 状态行只显示一件事：结果 > 生成中 > 提交中 > 不能提交的原因
  let statusKind = null
  let statusText = null
  if (note !== null) {
    statusKind = 'note'
    statusText = note.text
  } else if (generating) {
    statusKind = 'progress'
    statusText = t('commit.generatingElapsed', { seconds: (elapsedMs / 1000).toFixed(1) })
  } else if (busy) {
    statusKind = 'busy'
    statusText = t('commit.submitting')
  } else if (!hasChanges) {
    statusKind = 'hint'
    statusText = t('commit.hintNoChanges')
  } else if (!hasMessage) {
    statusKind = 'hint'
    statusText = t('commit.hintNoMessage')
  } else if (stagedCount === 0) {
    statusKind = 'hint'
    statusText = t('commit.hintStageAll')
  }

  return h('div', { className: 'dgp-commit' },
    h('div', { className: 'dgp-commit-input-wrap' },
      h('textarea', {
        ref: inputRef,
        className: 'dgp-commit-input',
        'data-dgp-commit': 'input',
        rows: 2,
        placeholder: t('commit.placeholder'),
        value: message,
        disabled: busy === true || generating === true,
        onChange: (event) => {
          onChange(event.target.value)
        },
        onKeyDown: (event) => {
          if ((event.ctrlKey === true || event.metaKey === true) && event.key === 'Enter' && canCommit) {
            event.preventDefault()
            onCommit()
          }
        }
      }),
      h('button', {
        type: 'button',
        className: 'dgp-commit-generate',
        'data-dgp-commit': 'generate',
        'data-busy': generating ? 'true' : undefined,
        disabled: generating || busy,
        title: t(generating ? 'commit.generating' : 'commit.generate'),
        'aria-label': t('commit.generate'),
        onClick: () => {
          onGenerate()
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
          // 错误提示换行显示（其余状态仍然单行省略，避免列表被顶下去）
          'data-wrap': noteIsError ? 'true' : undefined,
          title: statusText
        },
        statusKind === 'progress' ? h('span', { className: 'dgp-spinner' }) : null,
        h('span', { className: 'dgp-commit-status-text' + (noteIsError ? '' : ' dgp-oneline') }, statusText),
        noteOffersSettings
          ? h('button', {
            type: 'button',
            className: 'dgp-btn dgp-commit-settings',
            'data-size': 'sm',
            'data-variant': 'ghost',
            'data-dgp-commit': 'open-settings',
            onClick: () => onOpenSettings()
          }, t('commit.openSettings'))
          : null),
      h('button', {
        type: 'button',
        className: 'dgp-btn dgp-commit-submit',
        'data-variant': 'primary',
        'data-size': 'sm',
        'data-dgp-commit': 'submit',
        disabled: canCommit !== true,
        title: canCommit ? t('commit.submit') : t(hasChanges ? 'commit.hintNoMessage' : 'commit.hintNoChanges'),
        onClick: () => {
          onCommit()
        }
      }, t(busy ? 'commit.submitting' : 'commit.submit')),
      onCreatePull === undefined
        ? null
        : h('button', {
          type: 'button',
          className: 'dgp-btn dgp-commit-pr',
          'data-variant': 'ghost',
          'data-size': 'sm',
          'data-dgp-commit': 'create-pr',
          disabled: busy,
          onClick: () => onCreatePull()
        }, t('pr.open'))))
}
