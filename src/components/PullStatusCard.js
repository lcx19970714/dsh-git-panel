/**
 * src/components/PullStatusCard.js —— 变更页签顶部：当前分支的 PR 状态
 *
 * 只展示「平台事实 + 本地事实」，不编造：
 *  - 没有关联 PR / 没有账号 / origin 不是平台仓库：直说原因
 *  - 有 PR：状态（评审中 / 需要修改 / 可以合并 / 已合并 / 已关闭）、未读反馈数、最近评论预览
 */
import { h } from '../platform.js'
import { Icon } from '../ui/Icon.js'

function statusOf(pull, gate) {
  if (pull.merged === true) return 'merged'
  if (pull.state === 'closed') return 'closed'
  if (gate?.review?.state === 'changes-requested') return 'changes'
  if (gate?.review?.state === 'approved') return 'approved'
  if (pull.mergeable === true) return 'approved'
  return 'waiting'
}

export function PullStatusCard(props) {
  const source = props
  const t = source.t
  const card = source.card

  if (card === null || card === undefined) return null
  if (card.loading === true) {
    return h('div', { className: 'dgp-pr-card', 'data-dgp-pr-card': 'loading' },
      h('span', { className: 'dgp-detail-meta' }, t('prCard.loading')))
  }
  if (card.error !== null) {
    return h('div', { className: 'dgp-pr-card', 'data-dgp-pr-card': 'error' },
      h('p', { className: 'dgp-detail-failure' }, card.error),
      h('button', {
        type: 'button',
        className: 'dgp-btn',
        'data-size': 'sm',
        'data-dgp-pr-card': 'retry',
        onClick: () => source.onRefresh()
      }, t('prCard.retry')))
  }

  const data = card.data
  if (data === null || data.linked !== true) {
    const reason = data === null ? 'no-pull' : data.reason
    return h('div', { className: 'dgp-pr-card', 'data-dgp-pr-card': 'empty', 'data-reason': String(reason) },
      h('span', { className: 'dgp-detail-meta' }, t('prCard.' + reason)),
      h('button', {
        type: 'button',
        className: 'dgp-btn',
        'data-size': 'sm',
        'data-variant': 'ghost',
        'data-dgp-pr-card': 'retry',
        onClick: () => source.onRefresh()
      }, t('prCard.retry')))
  }

  const pull = data.pull
  const status = statusOf(pull, data.gate)
  const latest = Array.isArray(data.comments) && data.comments.length > 0
    ? data.comments[data.comments.length - 1]
    : null
  const unread = Number.isInteger(source.unread) && source.unread > 0 ? source.unread : 0

  return h('div', { className: 'dgp-pr-card', 'data-dgp-pr-card': status },
    h('div', { className: 'dgp-pr-card-head' },
      h('span', { className: 'dgp-pr-card-title' }, '#' + String(data.number) + ' ' + pull.title),
      h('span', { className: 'dgp-pr-card-status', 'data-status': status }, t('prCard.status.' + status))),
    h('div', { className: 'dgp-pr-card-meta' },
      h('span', { className: 'dgp-oneline' }, data.fullName),
      h('span', null, pull.baseBranch + ' ← ' + pull.headBranch),
      unread > 0
        ? h('span', { className: 'dgp-pr-card-unread', 'data-dgp-pr-card': 'unread' }, t('prCard.unread', { count: unread }))
        : null),
    latest === null
      ? null
      : h('p', { className: 'dgp-pr-card-latest dgp-oneline', title: latest.body },
        t('prCard.latest', { author: latest.author }) + ' ' + latest.body.split('\n')[0]),
    h('div', { className: 'dgp-pr-card-actions' },
      h('button', {
        type: 'button',
        className: 'dgp-btn',
        'data-size': 'sm',
        'data-variant': 'primary',
        'data-dgp-pr-card': 'open',
        onClick: () => source.onOpen()
      }, t('prCard.open'), h(Icon, { name: 'external', size: 12 }))))
}
