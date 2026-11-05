/**
 * src/components/PushHint.js —— 「这条分支的最新提交还没到远端」的提示
 *
 * 只有一个渲染点：变更页签、提交框上方。它回答「要不要推送」，是这个问题唯一的答案。
 * 打开「创建 PR」表单时左栏仍和表单同屏，所以表单不再重复同一块内容 ——
 * 表单只需要说明「创建」为什么还是灰的（CreatePullForm 的 pr.blockedNotPushed）。
 *
 * 状态也只有一个来源：宿主 `status` 的 `pushed`。推完 status 刷新，提示自己消失。
 * 命令照旧显示：按钮失败时用户能直接复制到终端排查。
 */
import { h } from '../platform.js'

export function PushHint(props) {
  const { branch, t, onPush, busy, error } = props
  return h('div', { className: 'dgp-push-hint', 'data-dgp-push': 'true' },
    h('p', { className: 'dgp-push-hint-title' }, t('push.title')),
    h('p', { className: 'dgp-push-hint-why' }, t('push.why')),
    h('div', { className: 'dgp-push-hint-action' },
      h('code', { className: 'dgp-command', 'data-dgp-push-command': 'true' }, t('push.command', { branch })),
      h('button', {
        type: 'button',
        className: 'dgp-btn',
        'data-size': 'sm',
        'data-variant': 'primary',
        'data-dgp-push-run': 'true',
        disabled: busy === true,
        onClick: () => onPush()
      }, t(busy === true ? 'push.pushing' : 'push.run'))),
    error === null || error === undefined
      ? null
      : h('p', { className: 'dgp-push-hint-error', 'data-dgp-push-error': 'true' }, error),
    h('p', { className: 'dgp-push-hint-after' }, t('push.after')))
}
