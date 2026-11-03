/**
 * src/components/PullStatusCard.js —— 变更页签顶部：当前分支的 PR 状态
 *
 * 只在「有 PR」或「查询失败」时出现：
 *  - 没有关联 PR / 没有账号 / origin 不是平台仓库：**什么都不显示**
 *    （此时「创建 PR」按钮就是唯一的下一步，不需要一张空卡片占地方）
 *  - 查询失败：显示错误 + 重试（这是用户真正需要知道的信息，不能吞）
 *  - 有 PR：状态、未读反馈、最近评论、查看/刷新
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

  if (card.error !== null) {
    return h('div', { className: 'dgp-pr-card', 'data-dgp-pr-card': 'error' },
      h('p', { className: 'dgp-detail-failure', 'data-dgp-pr-card': 'error-message' }, card.error),
      h('button', {
        type: 'button',
        className: 'dgp-btn',
        'data-size': 'sm',
        'data-dgp-pr-card': 'retry',
        disabled: card.loading === true,
        onClick: () => source.onRefresh()
      }, t('prCard.retry')))
  }

  const data = card.data
  // 还在读，或者根本没有 PR：不占位
  if (data === null || data.linked !== true) return null

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
        'data-variant': 'ghost',
        'data-dgp-pr-card': 'refresh',
        disabled: card.loading === true,
        onClick: () => source.onRefresh()
      }, t('prCard.refresh')),
      h('button', {
        type: 'button',
        className: 'dgp-btn',
        'data-size': 'sm',
        'data-variant': 'primary',
        'data-dgp-pr-card': 'open',
        onClick: () => source.onOpen()
      }, t('prCard.open'), h(Icon, { name: 'external', size: 12 }))))
}
