/**
 * src/components/RemoteDetail.js —— 远端仓库右侧详情：分支 / Issues / PR
 *
 * 只负责展示：数据由 Panel 拉（remote/detail 与 remote/branches），这里把
 * 「代码概况、分支、数量、最近条目、打开网页」几件事排清楚；拿不到总数的区块
 * 如实写「数量未知」。
 *
 * 分支区（BranchList）是这一版新增的主角：远端仓库的所有分支、本地有没有、
 * 远端有没有、当前/默认/领先落后都在这一个列表里，操作也都在行上完成。
 * 原先单独的「代码」块与顶部 meta 行重复（语言 / 大小 / 默认分支两处都写），
 * 已合并进 meta，把纵向空间让给分支列表。
 */
import { h } from '../platform.js'
import { Icon } from '../ui/Icon.js'
import { formatDateTime } from '../util/time.js'
import { BranchList } from './BranchList.js'

function Section(props) {
  const { title, total, items, emptyLabel, openLabel, onOpen, t, kind } = props
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
              if (kind === 'pulls' && item.number !== null) {
                props.onOpenPull(item.number)
                return
              }
              onOpen(item.url)
            }
          }, (item.number === null ? '' : '#' + item.number + ' ') + item.title),
          h('span', { className: 'dgp-detail-meta' },
            item.author === '' ? null : h('span', { className: 'dgp-detail-author' }, item.author),
            // 明确区分：创建 = 提交 PR 的时间，更新 = 最后一次有动静
            item.createdAt !== ''
              ? h('span', null, t('detail.created', { time: formatDateTime(Date.parse(item.createdAt)) }))
              : null,
            // 只有确实给了更新时间、且与创建时间不同才显示；缺失就不显示（不要占位符）
            item.updatedAt !== '' && item.updatedAt !== item.createdAt
              ? h('span', null, t('detail.updated', { time: formatDateTime(Date.parse(item.updatedAt)) }))
              : null)))))
}

export function RemoteDetail(props) {
  const { selection, detail, branchState, t } = props

  if (selection === null) {
    return h('div', { className: 'dgp-viewer' },
      h('div', { className: 'dgp-state', 'data-dgp-detail': 'empty' },
        h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'file-diff', size: 24 })),
        h('div', { className: 'dgp-state-title' }, t('detail.pickRepo')),
        h('div', { className: 'dgp-state-desc' }, t('detail.pickRepoHint'))))
  }

  if (detail === null || detail.loading) {
    return h('div', { className: 'dgp-viewer' },
      h('div', { className: 'dgp-state', 'data-dgp-detail': 'loading' },
        h('div', { className: 'dgp-state-icon' }, h('span', { className: 'dgp-spinner' })),
        h('div', { className: 'dgp-state-title' }, t('detail.loading', { name: selection.fullName }))))
  }

  if (detail.error !== null) {
    return h('div', { className: 'dgp-viewer' },
      h('div', { className: 'dgp-state', 'data-dgp-detail': 'error' },
        h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'warning', size: 24 })),
        h('div', { className: 'dgp-state-title' }, t('detail.failed')),
        h('div', { className: 'dgp-state-desc' }, detail.error),
        h('button', {
          type: 'button',
          className: 'dgp-btn',
          'data-size': 'sm',
          onClick: () => {
            props.onRetry()
          }
        }, t('action.retry'))))
  }

  const data = detail.data
  // 切仓库时旧数据还在手里：不属于当前选中的一份按加载中处理，绝不画在别的标题下。
  if (data.accountId !== selection.accountId || data.repo.fullName !== selection.fullName) {
    return h('div', { className: 'dgp-viewer' },
      h('div', { className: 'dgp-state', 'data-dgp-detail': 'loading' },
        h('div', { className: 'dgp-state-icon' }, h('span', { className: 'dgp-spinner' })),
        h('div', { className: 'dgp-state-title' }, t('detail.loading', { name: selection.fullName }))))
  }
  const repo = data.repo
  const sizeText = repo.sizeKb > 0 ? t('detail.sizeKb', { size: repo.sizeKb }) : ''
  // 语言 / 大小只在这里说一次；「默认分支」唯一来源是分支区（remote/branches 的 default 标签），不在两处各存一份快照。
  const meta = [repo.language, sizeText]
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
            props.onClone(selection)
          }
        }, t('remote.clone')),
        h('button', {
          type: 'button',
          className: 'dgp-btn',
          'data-size': 'sm',
          'data-dgp-detail-open': 'repo',
          onClick: () => {
            props.onOpenUrl(repo.htmlUrl)
          }
        }, t('remote.openWeb'), h(Icon, { name: 'external', size: 12 })))),
    repo.description === '' ? null : h('p', { className: 'dgp-detail-desc' }, repo.description),
    h('div', { className: 'dgp-detail-meta' },
      meta === '' ? null : h('span', null, meta),
      h('span', null, t('detail.stars', { count: repo.stars })),
      h('span', null, t('detail.forks', { count: repo.forks })),
      repo.updatedAt === '' ? null : h('span', null, t('remote.updatedAt', { time: formatDateTime(Date.parse(repo.updatedAt)) }))),

    data.failures.map((failure) => h('p', {
      key: failure.section,
      className: 'dgp-detail-failure'
    }, t('detail.sectionFailed', { section: t('detail.' + failure.section), message: failure.message }))),

    h(BranchList, {
      key: selection.accountId + '#' + selection.fullName,
      selection,
      state: branchState,
      onReloadBranches: props.onReloadBranches,
      onFetchBranches: props.onFetchBranches,
      onSwitchBranch: props.onSwitchBranch,
      onTrackBranch: props.onTrackBranch,
      onDeleteLocalBranch: props.onDeleteLocalBranch,
      onDeleteRemoteBranch: props.onDeleteRemoteBranch,
      onOpenUrl: props.onOpenUrl,
      t
    }),

    h(Section, {
      kind: 'issues',
      title: t('detail.issues'),
      total: data.issues.total,
      items: data.issues.items,
      emptyLabel: t('detail.noIssues'),
      openLabel: t('detail.openOnWeb'),
      onOpen: (url) => {
        props.onOpenUrl(url || repo.issuesUrl)
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
        props.onOpenUrl(url || repo.pullsUrl)
      },
      onOpenPull: props.onOpenPull,
      t
    }))
}
