/**
 * src/components/PullDetail.js —— 单个 PR 的详情与操作（审查 / 合并）
 *
 * 能力来自宿主返回的 capabilities：Gitee 只有「通过」一种结论、合并方式两种，
 * GitHub 三种都有。界面只渲染平台真正支持的动作，不做「点了才发现不支持」。
 */
import { h, useState } from '../platform.js'
import { Icon } from '../ui/Icon.js'
import { formatClock } from '../util/time.js'

const VERDICT_LABEL = {
  approve: 'pull.approve',
  'request-changes': 'pull.requestChanges',
  comment: 'pull.comment'
}

export function PullDetail(props) {
  const source = props === null || props === undefined ? {} : props
  const t = source.t
  const selection = source.selection === null || source.selection === undefined ? null : source.selection
  const detail = source.detail === null || source.detail === undefined ? null : source.detail
  const [note, setNote] = useState('')
  const [mergeMethod, setMergeMethod] = useState('merge')
  const [deleteBranch, setDeleteBranch] = useState(true)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  if (selection === null) return null

  const back = () => {
    if (typeof source.onBack === 'function') source.onBack()
  }

  if (detail === null || detail.loading === true) {
    return h('div', { className: 'dgp-viewer' },
      h('div', { className: 'dgp-state', 'data-dgp-pull': 'loading' },
        h('div', { className: 'dgp-state-icon' }, h('span', { className: 'dgp-spinner' })),
        h('div', { className: 'dgp-state-title' }, t('pull.loading', { number: selection.number }))))
  }

  if (detail.error !== null) {
    return h('div', { className: 'dgp-viewer' },
      h('div', { className: 'dgp-state', 'data-dgp-pull': 'error' },
        h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'warning', size: 20 })),
        h('div', { className: 'dgp-state-title' }, t('pull.failed')),
        h('div', { className: 'dgp-state-desc' }, detail.error),
        h('div', { className: 'dgp-state-actions' },
          h('button', {
            type: 'button',
            className: 'dgp-btn',
            'data-size': 'sm',
            onClick: () => {
              if (typeof source.onRetry === 'function') source.onRetry()
            }
          }, t('action.retry')),
          h('button', {
            type: 'button',
            className: 'dgp-btn',
            'data-size': 'sm',
            'data-variant': 'ghost',
            onClick: back
          }, t('pull.back')))))
  }

  const data = detail.data
  const pull = data.pull
  const caps = data.capabilities
  const canMerge = pull.state === 'open' && pull.merged !== true
  // mergeable：true 可以、false 明确不行、null 表示平台还在算 —— null 不该禁用按钮
  const mergeBlocked = pull.mergeable === false
  const mergeableText = pull.mergeable === true
    ? t('pull.mergeable')
    : (pull.mergeable === false ? t('pull.notMergeable') : t('pull.mergeableUnknown'))
  // 平台不一定给增删行/文件数，缺了显示 —— 而不是 0
  const statText = (value) => (pull.statsComplete === true ? String(value) : '—')

  const run = async (kind, action) => {
    setBusy(kind)
    setError(null)
    setNotice(null)
    const result = await action()
    setBusy(null)
    if (result !== null && result !== undefined && result.ok === true) {
      setNotice(result.message ?? null)
      if (typeof source.onChanged === 'function') source.onChanged()
      return
    }
    setError(result === null || result === undefined ? '操作失败' : result.error)
  }

  const submitReview = (verdict) => run('review', () => source.onReview({
    accountId: selection.accountId,
    fullName: selection.fullName,
    number: pull.number,
    verdict,
    body: note
  }))

  const submitMerge = () => run('merge', () => source.onMerge({
    accountId: selection.accountId,
    fullName: selection.fullName,
    number: pull.number,
    method: mergeMethod,
    deleteBranch
  }))

  return h('div', { className: 'dgp-detail dgp-pull', 'data-dgp-pull': 'detail' },
    h('div', { className: 'dgp-detail-top' },
      h('div', { className: 'dgp-detail-name-row' },
        h('button', {
          type: 'button',
          className: 'dgp-btn',
          'data-size': 'sm',
          'data-variant': 'ghost',
          'data-dgp-pull': 'back',
          onClick: back
        }, t('pull.back')),
        h('span', { className: 'dgp-detail-name dgp-oneline', title: pull.title },
          '#' + pull.number + ' ' + pull.title)),
      h('button', {
        type: 'button',
        className: 'dgp-btn',
        'data-size': 'sm',
        'data-dgp-pull': 'open-web',
        onClick: () => {
          if (typeof source.onOpenUrl === 'function') source.onOpenUrl(pull.htmlUrl)
        }
      }, t('remote.openWeb'), h(Icon, { name: 'external', size: 12 }))),

    h('div', { className: 'dgp-detail-meta' },
      h('span', { 'data-dgp-pull-state': pull.state }, t('pull.state.' + pull.state === '' ? 'pull.state.unknown' : 'pull.state.' + pull.state)),
      pull.merged === true ? h('span', null, t('pull.merged')) : null,
      h('span', null, pull.author),
      h('span', null, pull.headBranch + ' → ' + pull.baseBranch),
      h('span', null, '+' + statText(pull.additions) + ' / −' + statText(pull.deletions)),
      h('span', null, t('pull.filesChanged', { count: statText(pull.changedFiles) })),
      h('span', null, t('pull.commits', { count: pull.commits })),
      pull.updatedAt === '' ? null : h('span', null, t('remote.updatedAt', { time: formatClock(Date.parse(pull.updatedAt)) }))),

    pull.body === ''
      ? null
      : h('pre', { className: 'dgp-pull-body', 'data-dgp-pull': 'body' }, pull.body),

    /* ------------------------------ 审查 ------------------------------ */
    h('section', { className: 'dgp-detail-section', 'data-dgp-pull': 'review' },
      h('div', { className: 'dgp-detail-head' },
        h('span', { className: 'dgp-detail-title' }, t('pull.review')),
        h('span', { className: 'dgp-detail-count' },
          caps.reviews === true ? t('pull.reviewCount', { count: data.reviews.length }) : t('pull.reviewUnsupported'))),
      data.reviews.length === 0
        ? null
        : h('ul', { className: 'dgp-detail-list' },
          data.reviews.map((review, index) => h('li', { key: String(index), className: 'dgp-detail-item' },
            h('span', { className: 'dgp-pull-verdict', 'data-state': review.state }, review.state),
            h('span', { className: 'dgp-detail-meta dgp-oneline' },
              review.author + (review.submittedAt === '' ? '' : ' · ' + formatClock(Date.parse(review.submittedAt))),
              review.body === '' ? '' : ' · ' + review.body)))),
      canMerge
        ? h('div', { className: 'dgp-pull-actions' },
          h('input', {
            className: 'dgp-input dgp-pull-note',
            'data-dgp-pull': 'note',
            placeholder: t('pull.notePlaceholder'),
            value: note,
            onChange: (event) => setNote(event.target.value)
          }),
          caps.verdicts.map((verdict) => h('button', {
            key: verdict,
            type: 'button',
            className: 'dgp-btn',
            'data-size': 'sm',
            'data-variant': verdict === 'approve' ? 'primary' : undefined,
            'data-dgp-pull': 'verdict-' + verdict,
            disabled: busy !== null,
            onClick: () => submitReview(verdict)
          }, t(VERDICT_LABEL[verdict]))))
        : null),

    /* ------------------------------ 合并 ------------------------------ */
    canMerge
      ? h('section', { className: 'dgp-detail-section', 'data-dgp-pull': 'merge' },
        h('div', { className: 'dgp-detail-head' },
          h('span', { className: 'dgp-detail-title' }, t('pull.merge')),
          h('span', { className: 'dgp-detail-count' }, mergeableText)),
        h('div', { className: 'dgp-pull-actions' },
          h('select', {
            className: 'dgp-select dgp-pull-method',
            'data-dgp-pull': 'merge-method',
            value: mergeMethod,
            onChange: (event) => setMergeMethod(event.target.value)
          },
          caps.mergeMethods.map((method) => h('option', { key: method, value: method }, t('pull.method.' + method)))),
          h('label', { className: 'dgp-pull-check' },
            h('input', {
              type: 'checkbox',
              'data-dgp-pull': 'delete-branch',
              checked: deleteBranch,
              onChange: (event) => setDeleteBranch(event.target.checked)
            }),
            t('pull.deleteBranch', { branch: pull.headBranch })),
          h('button', {
            type: 'button',
            className: 'dgp-btn',
            'data-size': 'sm',
            'data-variant': 'primary',
            'data-dgp-pull': 'merge-run',
            disabled: busy !== null || mergeBlocked,
            onClick: submitMerge
          }, t(busy === 'merge' ? 'pull.merging' : 'pull.mergeRun'))))
      : null,

    busy === null ? null : h('p', { className: 'dgp-detail-meta' }, t('pull.working')),
    notice === null ? null : h('p', { className: 'dgp-detail-notice', 'data-dgp-pull': 'notice' }, notice),
    error === null ? null : h('p', { className: 'dgp-detail-failure', 'data-dgp-pull': 'error' }, error))
}
