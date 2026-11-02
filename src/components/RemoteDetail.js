/**
 * src/components/RemoteDetail.js —— 远端仓库右侧详情：代码 / Issues / PR
 *
 * 只负责展示：数据由 Panel 拉（remote/detail），这里把「数量、最近条目、
 * 打开网页」三件事排清楚；拿不到总数的区块如实写「数量未知」。
 */
import { h } from '../platform.js'
import { Icon } from '../ui/Icon.js'
import { formatDateTime } from '../util/time.js'

function Section(props) {
  const { title, total, itemsTheLabel, items, emptyLabel, openLabel, onOpen, t, kind } = props
  const countText = total === null ? t('detail.countUnknown') : t('detail.countOf', { count: total })
  return h('section', { className: 'dgp-detail-section', 'data-dgp-section': kind },
    h('div', { className: 'dgp-detail-head' },
      h('span', { className: 'dgp-detail-title' }, title),
      h('span', { className: 'dgp-detail-count', 'data-dgp-count': kind }, countText),
      h('button', {
        type: 'button',
        className: 'dgp-btn',
        'data-size': 'sm',
        'data-variant': 'ghost',
        'data-dgp-open': kind,
        onClick: () => onOpen()
      }, openLabel, h(Icon, { name: 'external', size: 12 }))),
    items.length === 0
      ? h('p', { className: 'dgp-detail-empty' }, emptyLabel)
      : h('ul', { className: 'dgp-detail-list' },
        items.map((item, index) => h('li', { key: String(item.number ?? index), className: 'dgp-detail-item' },
          h('button', {
            type: 'button',
            className: 'dgp-detail-link',
            title: item.title,
            'data-dgp-item': kind,
            onClick: () => {
              if (kind === 'pulls' && item.number !== null && typeof props.onOpenPull === 'function') {
                props.onOpenPull(item.number)
                return
              }
              onOpen(item.url)
            }
          }, (item.number === null ? '' : '#' + item.number + ' ') + item.title),
          h('span', { className: 'dgp-detail-meta' },
            item.author === '' ? null : h('span', { className: 'dgp-detail-author' }, item.author),
            // 明确区分：创建 = 提交 PR 的时间，更新 = 最后一次有动静
            item.createdAt === '' ? null : h('span', null, t('detail.created', { time: formatDateTime(Date.parse(item.createdAt)) })),
            item.updatedAt === '' || item.updatedAt === item.createdAt
              ? null
              : h('span', null, t('detail.updated', { time: formatDateTime(Date.parse(item.updatedAt)) })))))))
}

export function RemoteDetail(props) {
  const source = props
  const t = source.t
  const selection = source.selection === null || source.selection === undefined ? null : source.selection
  const detail = source.detail === null || source.detail === undefined ? null : source.detail

  if (selection === null) {
    return h('div', { className: 'dgp-viewer' },
      h('div', { className: 'dgp-state', 'data-dgp-detail': 'empty' },
        h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'file-diff', size: 22 })),
        h('div', { className: 'dgp-state-title' }, t('detail.pickRepo')),
        h('div', { className: 'dgp-state-desc' }, t('detail.pickRepoHint'))))
  }

  if (detail === null || detail.loading === true) {
    return h('div', { className: 'dgp-viewer' },
      h('div', { className: 'dgp-state', 'data-dgp-detail': 'loading' },
        h('div', { className: 'dgp-state-icon' }, h('span', { className: 'dgp-spinner' })),
        h('div', { className: 'dgp-state-title' }, t('detail.loading', { name: selection.fullName }))))
  }

  if (detail.error !== null) {
    return h('div', { className: 'dgp-viewer' },
      h('div', { className: 'dgp-state', 'data-dgp-detail': 'error' },
        h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'warning', size: 20 })),
        h('div', { className: 'dgp-state-title' }, t('detail.failed')),
        h('div', { className: 'dgp-state-desc' }, detail.error),
        h('button', {
          type: 'button',
          className: 'dgp-btn',
          'data-size': 'sm',
          onClick: () => {
            if (typeof source.onRetry === 'function') source.onRetry()
          }
        }, t('action.retry'))))
  }

  const data = detail.data
  const repo = data.repo
  const sizeText = repo.sizeKb > 0 ? t('detail.sizeKb', { size: repo.sizeKb }) : ''
  const meta = [repo.language, sizeText, repo.defaultBranch === '' ? '' : repo.defaultBranch]
    .filter((part) => part !== '').join(' · ')

  return h('div', { className: 'dgp-detail', 'data-dgp-detail': 'repo' },
    h('div', { className: 'dgp-detail-top' },
      h('div', { className: 'dgp-detail-name-row' },
        h('span', { className: 'dgp-detail-name dgp-oneline', title: repo.fullName }, repo.fullName),
        repo.private === true ? h('span', { className: 'dgp-remote-badge' }, t('remote.private')) : null),
      h('div', { className: 'dgp-detail-actions' },
        h('button', {
          type: 'button',
          className: 'dgp-btn',
          'data-size': 'sm',
          'data-variant': 'primary',
          'data-dgp-detail-clone': repo.fullName,
          onClick: () => {
            if (typeof source.onClone === 'function') source.onClone(selection)
          }
        }, t('remote.clone')),
        h('button', {
          type: 'button',
          className: 'dgp-btn',
          'data-size': 'sm',
          'data-dgp-detail-open': 'repo',
          onClick: () => {
            if (typeof source.onOpenUrl === 'function') source.onOpenUrl(repo.htmlUrl)
          }
        }, t('remote.openWeb'), h(Icon, { name: 'external', size: 12 })))),
    repo.description === '' ? null : h('p', { className: 'dgp-detail-desc' }, repo.description),
    h('div', { className: 'dgp-detail-meta' },
      meta === '' ? null : h('span', null, meta),
      h('span', null, t('detail.stars', { count: repo.stars })),
      h('span', null, t('detail.forks', { count: repo.forks })),
      repo.updatedAt === '' ? null : h('span', null, t('remote.updatedAt', { time: formatDateTime(Date.parse(repo.updatedAt)) }))),

    (Array.isArray(data.failures) ? data.failures : []).map((failure) => h('p', {
      key: failure.section,
      className: 'dgp-detail-failure'
    }, t('detail.sectionFailed', { section: failure.section, message: failure.message }))),

    h('div', { className: 'dgp-detail-code' },
      h('span', { className: 'dgp-detail-title' }, t('detail.code')),
      h('span', { className: 'dgp-detail-meta' },
        [repo.language === '' ? '' : repo.language, sizeText, repo.defaultBranch === '' ? '' : t('detail.defaultBranch', { name: repo.defaultBranch })]
          .filter((part) => part !== '').join(' · '))),

    h(Section, {
      kind: 'issues',
      title: t('detail.issues'),
      total: data.issues.total,
      items: data.issues.items,
      emptyLabel: t('detail.noIssues'),
      openLabel: t('detail.openOnWeb'),
      onOpen: (url) => {
        if (typeof source.onOpenUrl === 'function') source.onOpenUrl(url ?? repo.issuesUrl)
      },
      t
    }),
    h(Section, {
      kind: 'pulls',
      title: t('detail.pulls'),
      total: data.pulls.total,
      items: data.pulls.items,
      emptyLabel: t('detail.noPulls'),
      openLabel: t('detail.openOnWeb'),
      onOpen: (url) => {
        if (typeof source.onOpenUrl === 'function') source.onOpenUrl(url ?? repo.pullsUrl)
      },
      onOpenPull: typeof source.onOpenPull === 'function' ? source.onOpenPull : undefined,
      t
    }))
}
