/**
 * src/components/PullDetail.js —— 单个 PR 的详情与操作（审查 / 合并）
 *
 * 能力来自宿主返回的 capabilities：Gitee 只有「通过」一种结论、合并方式两种，
 * GitHub 三种都有。界面只渲染平台真正支持的动作，不做「点了才发现不支持」。
 */
import { h, useState } from '../platform.js'
import { Icon } from '../ui/Icon.js'
import { formatDateTime } from '../util/time.js'

const VERDICT_LABEL = {
  approve: 'pull.approve',
  'request-changes': 'pull.requestChanges',
  comment: 'pull.comment'
}

export function PullDetail(props) {
  const source = props
  const t = source.t
  const selection = source.selection === null || source.selection === undefined ? null : source.selection
  const detail = source.detail === null || source.detail === undefined ? null : source.detail
  const [note, setNote] = useState('')
  const [mergeMethod, setMergeMethod] = useState('merge')
  const [deleteBranch, setDeleteBranch] = useState(true)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  // AI 审阅：idle / loading / done(result) / error
  const [ai, setAi] = useState({ status: 'idle', mode: 'diff', result: null, error: null })
  // 评论草稿：AI 生成后填入，用户可改，只有点「提交评论」才发出去
  const [draft, setDraft] = useState('')
  const [commentBusy, setCommentBusy] = useState(false)
  const [commentNotice, setCommentNotice] = useState(null)

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
  const gate = data.gate ?? { review: { state: 'unknown' }, test: { state: 'unknown' }, mergeState: null }
  const gateLabel = (kind, state) => {
    if (kind === 'review') {
      if (state === 'approved') return t('pull.gateReviewPassed')
      if (state === 'changes-requested') return t('pull.gateReviewChanges')
      if (state === 'pending') return t('pull.gateReviewPending')
      return t('pull.gateUnknown')
    }
    if (state === 'passed') return t('pull.gateTestPassed')
    if (state === 'pending') return t('pull.gateTestPending')
    return t('pull.gateUnknown')
  }
  const caps = data.capabilities
  const canMerge = pull.state === 'open' && pull.merged !== true
  // mergeable：true 可以、false 明确不行、null 表示平台还在算 —— null 不该禁用按钮
  const mergeBlocked = pull.mergeable === false
  const mergeableText = pull.mergeable === true
    ? t('pull.mergeable')
    : (pull.mergeable === false ? t('pull.notMergeable') : t('pull.mergeableUnknown'))
  // 平台不一定给增删行/文件数，缺了显示 —— 而不是 0
  const statText = (value) => (pull.statsComplete === true ? String(value) : '—')

  /**
   * 评论草稿的可见行数：按换行切分，长行按每行约 80 字符折算。
   * 最少 6 行、最多 30 行 —— 内容多时输入框自己长高，不用手动拉。
   */
  const draftLines = draft.split('\n').reduce(
    (sum, line) => sum + Math.max(1, Math.ceil(line.length / 80)),
    0
  )
  const draftHeight = Math.min(Math.max(draftLines, 6), 30) * 19 + 24 + 'px'

  const run = async (kind, action) => {
    setBusy(kind)
    setError(null)
    setNotice(null)
    const result = await action()
    setBusy(null)
    // 合并成功时宿主已经把详情关掉了（closed:true），这里不再写任何提示
    if (result !== null && result !== undefined && result.ok === true && result.closed === true) return
    if (result !== null && result !== undefined && result.ok === true) {
      setNotice(result.message ?? null)
      if (typeof source.onChanged === 'function') source.onChanged()
      return
    }
    setError(result === null || result === undefined ? '操作失败' : result.error)
  }

  /** 跑一次 AI 审阅（宿主负责取 diff 与调模型）。 */
  const runAi = async (mode) => {
    const handler = mode === 'deep' ? source.onDeepReview : source.onAiReview
    if (typeof handler !== 'function') return
    setAi({ status: 'loading', mode, result: null, error: null })
    setCommentNotice(null)
    const result = await handler({
      accountId: selection.accountId,
      fullName: selection.fullName,
      number: pull.number,
      // 深度审阅：本地有对应仓库就带上，宿主据此复用它的对象库
      ...(mode === 'deep' && typeof source.localRepoRoot === 'string'
        ? { rootPath: source.localRepoRoot }
        : {})
    })
    if (result !== null && result !== undefined && result.ok === true) {
      setAi({ status: 'done', mode, result, error: null })
      setDraft(result.comment ?? '')
      return
    }
    setAi({
      status: 'error',
      mode,
      result: null,
      error: result === null || result === undefined ? '审阅失败' : result.error,
      // 只有「没配审阅模型」这种情况值得给快捷入口，其它错误去设置页也没用
      code: result === null || result === undefined ? null : (result.code ?? null)
    })
  }

  /** 提交评论：内容就是输入框里的（用户可改过的）文本。 */
  const submitComment = async () => {
    if (typeof source.onComment !== 'function' || commentBusy) return
    setCommentBusy(true)
    setCommentNotice(null)
    const result = await source.onComment({
      accountId: selection.accountId,
      fullName: selection.fullName,
      number: pull.number,
      comment: draft
    })
    setCommentBusy(false)
    if (result !== null && result !== undefined && result.ok === true) setCommentNotice(result.message ?? t('pull.aiCommentDone'))
    else setCommentNotice(result === null || result === undefined ? '评论失败' : result.error)
  }

  const submitReview = (verdict) => run('review', () => source.onReview({
    accountId: selection.accountId,
    fullName: selection.fullName,
    number: pull.number,
    verdict,
    body: note
  }))

  const submitPass = () => run('pass', () => source.onPass({
    accountId: selection.accountId,
    fullName: selection.fullName,
    number: pull.number,
    body: note
  }))

  const submitTest = () => run('test', () => source.onTest({
    accountId: selection.accountId,
    fullName: selection.fullName,
    number: pull.number
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

    /* 门禁状态：审查与测试并排一行，状态一眼可见 */
    h('div', { className: 'dgp-gate', 'data-dgp-pull': 'gate' },
      h('span', { className: 'dgp-gate-chip', 'data-gate': 'review', 'data-state': gate.review.state },
        t('pull.gateReview'), '：', gateLabel('review', gate.review.state)),
      h('span', { className: 'dgp-gate-chip', 'data-gate': 'test', 'data-state': gate.test.state },
        t('pull.gateTest'), '：', gateLabel('test', gate.test.state)),
      gate.mergeState === null ? null : h('span', { className: 'dgp-gate-chip', 'data-gate': 'merge-state' },
        t('pull.gateMergeState'), '：', gate.mergeState)),

    h('div', { className: 'dgp-detail-meta' },
      h('span', { 'data-dgp-pull-state': pull.state }, t('pull.state.' + pull.state === '' ? 'pull.state.unknown' : 'pull.state.' + pull.state)),
      pull.merged === true ? h('span', null, t('pull.merged')) : null,
      h('span', null, pull.author),
      h('span', null, pull.headBranch + ' → ' + pull.baseBranch),
      h('span', null, '+' + statText(pull.additions) + ' / −' + statText(pull.deletions)),
      h('span', null, t('pull.filesChanged', { count: statText(pull.changedFiles) })),
      h('span', null, t('pull.commits', { count: pull.commits })),
      typeof pull.createdAt === 'string' && pull.createdAt !== ''
        ? h('span', null, t('detail.created', { time: formatDateTime(Date.parse(pull.createdAt)) }))
        : null,
      typeof pull.updatedAt === 'string' && pull.updatedAt !== ''
        ? h('span', null, t('detail.updated', { time: formatDateTime(Date.parse(pull.updatedAt)) }))
        : null),

    pull.body === ''
      ? null
      : h('pre', { className: 'dgp-pull-body', 'data-dgp-pull': 'body' }, pull.body),

    /* --------------------------- AI 审阅 --------------------------- */
    h('section', { className: 'dgp-detail-section', 'data-dgp-pull': 'ai' },
      h('div', { className: 'dgp-detail-head' },
        h('span', { className: 'dgp-detail-title' }, t('pull.aiTitle')),
        ai.status === 'done'
          ? h('span', { className: 'dgp-detail-count', 'data-dgp-pull': 'ai-verdict', 'data-verdict': ai.result.verdict },
            t('pull.aiVerdict.' + ai.result.verdict))
          : null,
        h('button', {
          type: 'button',
          className: 'dgp-btn',
          'data-size': 'sm',
          'data-dgp-pull': 'ai-run',
          disabled: ai.status === 'loading' || busy !== null,
          onClick: () => runAi('diff')
        }, t(ai.status === 'done' && ai.mode === 'diff' ? 'pull.aiRerun' : 'pull.aiStart')),
        h('button', {
          type: 'button',
          className: 'dgp-btn',
          'data-size': 'sm',
          'data-dgp-pull': 'ai-deep-run',
          disabled: ai.status === 'loading' || busy !== null,
          title: t('pull.aiDeepHint'),
          onClick: () => runAi('deep')
        }, t(ai.status === 'done' && ai.mode === 'deep' ? 'pull.aiDeepRerun' : 'pull.aiDeepRun'))),
      ai.status === 'loading'
        ? h('p', { className: 'dgp-detail-meta', 'data-dgp-pull': 'ai-loading' },
          t(ai.mode === 'deep' ? 'pull.aiDeepRunning' : 'pull.aiRunning'))
        : null,
      ai.status === 'error'
        ? h('div', { className: 'dgp-ai-error' },
          h('p', { className: 'dgp-detail-failure', 'data-dgp-pull': 'ai-error' }, ai.error),
          ai.code === 'no-review-model' && typeof source.onOpenSettings === 'function'
            ? h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-dgp-pull': 'ai-open-settings',
              onClick: () => source.onOpenSettings()
            }, t('pull.aiOpenSettings'))
            : null)
        : null,
      ai.status !== 'done' ? null : h('div', { 'data-dgp-pull': 'ai-result' },
        ai.mode === 'deep'
          ? h('p', { className: 'dgp-detail-meta', 'data-dgp-pull': 'ai-deep-info' },
            t('pull.aiDeepInfo', { count: ai.result.filesRead ?? 0 }),
            ' · ',
            t(ai.result.objectSource === 'local' ? 'pull.aiDeepLocal' : 'pull.aiDeepTemp'))
          : null,
        Array.isArray(ai.result.fullFilesSkipped) && ai.result.fullFilesSkipped.length > 0
          ? h('div', { className: 'dgp-ai-skipped', 'data-dgp-pull': 'ai-deep-skipped' },
            h('p', { className: 'dgp-detail-notice' },
              t('pull.aiDeepSkipped', { count: ai.result.fullFilesSkipped.length })),
            h('ul', { className: 'dgp-skipped-list' },
              ai.result.fullFilesSkipped.map((file, index) => h('li', {
                key: String(file.filename) + '#' + String(index),
                className: 'dgp-skipped-item'
              },
              h('span', { className: 'dgp-skipped-name dgp-oneline', title: file.filename }, file.filename),
              h('span', { className: 'dgp-skipped-size' }, file.reason)))))
          : null,
        ai.result.truncated === true
          ? h('p', { className: 'dgp-detail-notice', 'data-dgp-pull': 'ai-truncated' }, t('pull.aiTruncated'))
          : null,
        Array.isArray(ai.result.skippedFiles) && ai.result.skippedFiles.length > 0
          ? h('div', { className: 'dgp-ai-skipped', 'data-dgp-pull': 'ai-skipped' },
            h('p', { className: 'dgp-detail-notice' },
              t('pull.aiSkippedTitle', { count: ai.result.skippedFiles.length })),
            h('ul', { className: 'dgp-skipped-list' },
              ai.result.skippedFiles.map((file) => h('li', {
                key: file.filename,
                className: 'dgp-skipped-item',
                'data-dgp-skipped': file.filename
              },
              h('span', { className: 'dgp-skipped-name dgp-oneline', title: file.filename }, file.filename),
              h('span', { className: 'dgp-skipped-size' },
                '+' + file.additions + ' / −' + file.deletions + (Number.isFinite(file.changes) ? '（' + file.changes + ' 行）' : ''))))),
            h('p', { className: 'dgp-settings-hint' }, t('pull.aiSkippedHint')))
          : null,
        h('p', { className: 'dgp-ai-summary', 'data-dgp-pull': 'ai-summary' }, ai.result.summary),
        ai.result.findings.length === 0
          ? h('p', { className: 'dgp-detail-meta' }, t('pull.aiNoFindings'))
          : h('ol', { className: 'dgp-findings' },
            ai.result.findings.map((finding, index) => h('li', {
              key: String(finding.file) + '#' + String(index),
              className: 'dgp-finding',
              'data-dgp-finding': String(index + 1),
              'data-severity': finding.severity
            },
            h('div', { className: 'dgp-finding-head' },
              h('span', { className: 'dgp-finding-no' }, String(index + 1) + '.'),
              h('span', { className: 'dgp-severity', 'data-severity': finding.severity }, t('pull.severity.' + finding.severity)),
              h('span', { className: 'dgp-finding-title' }, finding.title)),
            h('div', { className: 'dgp-finding-loc' },
              finding.file + (finding.line === null ? '' : ':' + String(finding.line))),
            h('div', { className: 'dgp-finding-detail' }, finding.detail),
            h('div', { className: 'dgp-finding-fix' }, t('pull.aiSuggestion'), finding.suggestion)))),
        h('div', { className: 'dgp-ai-comment' },
          h('div', { className: 'dgp-ai-comment-head' },
            h('span', { className: 'dgp-settings-label' }, t('pull.aiCommentLabel')),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-variant': 'primary',
              'data-dgp-pull': 'comment-submit',
              disabled: commentBusy || draft.trim() === '',
              onClick: submitComment
            }, t(commentBusy ? 'pull.aiCommentSubmitting' : 'pull.aiCommentSubmit'))),
          h('textarea', {
            className: 'dgp-input dgp-ai-textarea',
            'data-dgp-pull': 'ai-comment',
            style: { height: draftHeight },
            placeholder: t('pull.aiCommentPlaceholder'),
            value: draft,
            spellCheck: false,
            onChange: (event) => setDraft(event.target.value)
          }),
          commentNotice === null
            ? null
            : h('p', { className: 'dgp-detail-notice', 'data-dgp-pull': 'comment-notice' }, commentNotice)))),

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
              review.author + (review.submittedAt === '' ? '' : ' · ' + formatDateTime(Date.parse(review.submittedAt))),
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
          h('button', {
            type: 'button',
            className: 'dgp-btn',
            'data-size': 'sm',
            'data-variant': 'primary',
            'data-dgp-pull': 'pass-all',
            disabled: busy !== null,
            title: t('pull.passAllHint'),
            onClick: submitPass
          }, t(caps.test === true ? 'pull.passAll' : 'pull.passReviewOnly')),
          caps.test === true
            ? h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-dgp-pull': 'test-gate',
              disabled: busy !== null,
              title: t('pull.testHint'),
              onClick: submitTest
            }, t('pull.testRun'))
            : null,
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
