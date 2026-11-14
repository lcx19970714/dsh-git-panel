/**
 * src/components/PushHint.js —— 「本地分支与远端不同步」时的提示条
 *
 * 由宿主 `status.sync.state` 驱动，只有两种形态，对应两种完全不同的下一步：
 *   · never-pushed / ahead → 该推送：说明 + 命令 + 「推送到远端」按钮
 *   · remote-deleted       → 远端分支已被删除（PR 合并后删分支是常态）：
 *                            **不能**再普通推送（那会把已合并的分支重新建出来），
 *                            只能「收尾」：取远程更新 → 切回默认分支 → 删除这条本地分支
 *
 * behind / diverged 不在这里处理：那是「该拉取 / 处理分叉」，不是推送问题。
 */
import { h } from '../platform.js'

export function PushHint(props) {
  const { branch, sync, t, onPush, onCleanup, busy, error } = props
  const deleted = sync.state === 'remote-deleted'

  const body = deleted
    ? h('div', { className: 'dgp-push-hint-action' },
      h('button', {
        type: 'button',
        className: 'dgp-btn',
        'data-size': 'sm',
        'data-variant': 'primary',
        'data-dgp-cleanup-run': 'true',
        disabled: busy === true,
        onClick: () => onCleanup()
      }, t(busy === true ? 'sync.cleaning' : 'sync.cleanupRun')))
    : h('div', { className: 'dgp-push-hint-action' },
      h('code', { className: 'dgp-command', 'data-dgp-push-command': 'true' }, t('sync.pushCommand', { branch })),
      h('button', {
        type: 'button',
        className: 'dgp-btn',
        'data-size': 'sm',
        'data-variant': 'primary',
        'data-dgp-push-run': 'true',
        disabled: busy === true,
        onClick: () => onPush()
      }, t(busy === true ? 'sync.pushing' : 'sync.pushRun')))

  return h('div', { className: 'dgp-push-hint', 'data-dgp-sync': sync.state },
    h('p', { className: 'dgp-push-hint-title' },
      deleted
        ? t('sync.deletedTitle', { branch })
        : (sync.state === 'ahead' ? t('sync.aheadTitle', { count: sync.ahead }) : t('sync.neverTitle'))),
    h('p', { className: 'dgp-push-hint-why' }, deleted ? t('sync.deletedWhy') : t('sync.pushWhy')),
    body,
    h('p', { className: 'dgp-push-hint-after' }, deleted ? t('sync.deletedAfter') : t('sync.pushAfter')),
    deleted ? h('p', { className: 'dgp-push-hint-after' }, t('sync.deletedNext')) : null,
    error === null
      ? null
      : h('p', { className: 'dgp-push-hint-error', 'data-dgp-sync-error': 'true' }, error))
}
