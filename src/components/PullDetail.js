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
  const [ai, setAi] = useState({ status: 'idle', mode: 'diff', result: null, error: null, steps: [], logPath: null })
  // 本地没有这个仓库时：{ repoUsed, suggestedName, headBranch, target, customPath, busy, error }
  const [clonePrompt, setClonePrompt] = useState(null)
  // 评论草稿：AI 生成后填入，用户可改，只有点「提交评论」才发出去
  const [draft, setDraft] = useState('')
  const [commentBusy, setCommentBusy] = useState(false)
  const [commentNotice, setCommentNotice] = useState(null)
  // 常驻评论框：人工审阅后也能随时给对方留言
  const [commentDraft, setCommentDraft] = useState('')
  // 关闭 PR 是两步操作：先确认再发，避免误点
  const [closeConfirm, setCloseConfirm] = useState(false)
  const [stateBusy, setStateBusy] = useState(false)

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
  const commentLines = commentDraft.split('\n').reduce(
    (sum, line) => sum + Math.max(1, Math.ceil(line.length / 80)),
    0
  )
  const commentHeight = Math.min(Math.max(commentLines, 4), 20) * 19 + 24 + 'px'

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

  /** 执行步骤列表（宿主回传）：每一步做了什么、耗时、是否失败。 */
  const renderSteps = (steps, logPath) => {
    if (!Array.isArray(steps) || steps.length === 0) return null
    return h('div', { className: 'dgp-ai-steps', 'data-dgp-pull': 'ai-steps' },
      h('p', { className: 'dgp-settings-label' }, t('pull.aiStepsTitle')),
      h('ul', { className: 'dgp-step-list' },
        steps.map((step, index) => h('li', {
          key: String(index),
          className: 'dgp-step',
          'data-level': step.level ?? 'info',
          'data-step': step.step
        },
        h('span', { className: 'dgp-step-time' }, '+' + String(step.at ?? 0) + 'ms'),
        h('span', { className: 'dgp-step-name' }, step.step),
        step.detail === '' ? null : h('span', { className: 'dgp-step-detail' }, step.detail)))),
      logPath === null || logPath === undefined
        ? null
        : h('p', { className: 'dgp-settings-hint' }, t('pull.aiLogHint', { path: logPath })))
  }

  /** 跑一次 AI 审阅（宿主负责取 diff 与调模型）。 */
  const runAi = async (mode, prepared = null) => {
    setCommentNotice(null)
    setClonePrompt(null)
    if (mode === 'deep') setAi({ status: 'loading', mode, result: null, error: null, steps: [], logPath: null, phase: 'prepare' })
    else setAi({ status: 'loading', mode, result: null, error: null, steps: [], logPath: null, phase: null })

    const base = { accountId: selection.accountId, fullName: selection.fullName, number: pull.number }
    let result

    if (mode === 'deep') {
      let target = prepared
      if (target === null) {
        if (typeof source.onPrepareReview !== 'function') return
        const prep = await source.onPrepareReview({
          ...base,
          rootPaths: Array.isArray(source.localRepoRoots) ? source.localRepoRoots : []
        })
        if (prep === null || prep === undefined || prep.ok !== true) {
          setAi({
            status: 'error', mode, result: null,
            error: prep === null || prep === undefined ? '准备失败' : prep.error,
            code: prep?.code ?? null,
            steps: prep?.details?.steps ?? [],
            logPath: prep?.details?.logPath ?? null,
            phase: null
          })
          return
        }
        if (prep.needsClone === true) {
          setAi({ status: 'idle', mode, result: null, error: null, steps: [], logPath: null, phase: null })
          setClonePrompt({
            repoUsed: prep.repoUsed,
            suggestedName: prep.suggestedName,
            headBranch: prep.headBranch,
            customPath: '',
            busy: false,
            error: null
          })
          return
        }
        target = { rootPath: prep.rootPath, branch: prep.branch, steps: prep.steps ?? [], logPath: prep.logPath ?? null }
      }
      // 阶段二：优先走会话级审阅（新开会话 + Agent 工具）；没有该能力时退回本地深度。
      if (typeof source.onSessionReview === 'function') {
        setAi({ status: 'loading', mode, result: null, error: null, steps: target.steps ?? [], logPath: target.logPath ?? null, phase: 'review' })
        const started = await source.onSessionReview({ ...base, rootPath: target.rootPath, branch: target.branch })
        if (started !== null && started !== undefined && started.ok === true && typeof started.sessionId === 'string') {
          setAi({ status: 'done', mode: 'session', result: started, error: null, steps: [], logPath: started.logPath ?? null, phase: null })
          setCommentNotice(t('pull.sessionReviewStarted', { id: started.sessionId }))
          return
        }
        setAi({
          status: 'error',
          mode: 'deep',
          result: null,
          error: started === null || started === undefined ? '启动会话审阅失败' : started.error,
          code: started?.code ?? null,
          steps: started?.details?.steps ?? target.steps ?? [],
          logPath: started?.details?.logPath ?? target.logPath ?? null,
          phase: null
        })
        return
      }
      setAi({ status: 'loading', mode, result: null, error: null, steps: target.steps ?? [], logPath: target.logPath ?? null, phase: 'review' })
      if (typeof source.onDeepReview !== 'function') return
      const reviewed = await source.onDeepReview({ ...base, rootPath: target.rootPath, branch: target.branch })
      const mergedSteps = [...(target.steps ?? []), ...((reviewed?.steps) ?? [])]
      result = reviewed === null || reviewed === undefined
        ? reviewed
        : reviewed.ok === true
          ? { ...reviewed, steps: mergedSteps, logPath: reviewed.logPath ?? target.logPath ?? null }
          : {
              ...reviewed,
              details: {
                ...(reviewed.details ?? {}),
                steps: mergedSteps,
                logPath: reviewed.details?.logPath ?? target.logPath ?? null
              }
            }
    } else {
      if (typeof source.onAiReview !== 'function') return
      result = await source.onAiReview({ ...base })
    }

    if (result !== null && result !== undefined && result.ok === true) {
      setAi({
        status: 'done', mode, result, error: null,
        steps: Array.isArray(result.steps) ? result.steps : [],
        logPath: result.logPath ?? null,
        phase: null
      })
      setDraft(result.comment ?? '')
      return
    }
    setAi({
      status: 'error',
      mode,
      result: null,
      error: result === null || result === undefined ? '审阅失败' : result.error,
      code: result === null || result === undefined ? null : (result.code ?? null),
      steps: result !== null && result !== undefined && result.details !== null && result.details !== undefined
        && Array.isArray(result.details.steps) ? result.details.steps : [],
      logPath: result !== null && result !== undefined && result.details !== null && result.details !== undefined
        ? result.details.logPath ?? null : null,
      phase: null
    })
  }

  /** 确认克隆位置：workspace = 项目工作区；custom = 用户填的绝对路径。 */
  const startClone = async (target) => {
    if (typeof source.onCloneForReview !== 'function' || clonePrompt === null) return
    const targetDir = target === 'workspace'
      ? String(source.projectRoot ?? '') + '/' + clonePrompt.suggestedName
      : clonePrompt.customPath.trim()
    if (targetDir === '' || targetDir === '/undefined') {
      setClonePrompt((previous) => (previous === null ? previous : { ...previous, error: t('pull.aiCloneNoPath') }))
      return
    }
    setClonePrompt((previous) => (previous === null ? previous : { ...previous, busy: true, error: null }))
    const result = await source.onCloneForReview({
      accountId: selection.accountId,
      fullName: selection.fullName,
      number: pull.number,
      targetDir
    })
    if (result === null || result === undefined || result.ok !== true) {
      setClonePrompt((previous) => (previous === null
        ? previous
        : { ...previous, busy: false, error: result === null || result === undefined ? '克隆失败' : result.error }))
      return
    }
    await runAi('deep', { rootPath: result.rootPath, branch: result.branch })
  }

  /** 关闭 / 重新打开。关闭需要二次确认；重新打开直接执行（无破坏性）。 */
  const changeState = async (nextState) => {
    if (typeof source.onSetPullState !== 'function' || stateBusy) return
    setStateBusy(true)
    const result = await source.onSetPullState({
      accountId: selection.accountId,
      fullName: selection.fullName,
      number: pull.number,
      state: nextState
    })
    setStateBusy(false)
    setCloseConfirm(false)
    if (result !== null && result !== undefined && result.ok === true) {
      if (typeof source.onChanged === 'function') source.onChanged()
      setNotice(t(nextState === 'closed' ? 'pull.closedNotice' : 'pull.reopenedNotice'))
      return
    }
    setError(result === null || result === undefined ? '操作失败' : result.error)
  }

  const submitComment = async () => {
    if (typeof source.onComment !== 'function' || commentBusy) return
    setCommentBusy(true)
    setCommentNotice(null)
    const result = await source.onComment({
      accountId: selection.accountId,
      fullName: selection.fullName,
      number: pull.number,
      comment: commentDraft
    })
    setCommentBusy(false)
    if (result !== null && result !== undefined && result.ok === true) {
      // 发出去之后清空输入框：否则内容留在框里，用户会以为没发出去
      setCommentDraft('')
      setCommentNotice(result.message ?? t('pull.aiCommentDone'))
      return
    }
    setCommentNotice(result === null || result === undefined ? '评论失败' : result.error)
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
      }, t('remote.openWeb'), h(Icon, { name: 'external', size: 12 })),
      pull.state === 'open'
        ? (closeConfirm
          ? h('span', { className: 'dgp-pull-confirm', 'data-dgp-pull': 'close-confirm' },
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-variant': 'ghost',
              disabled: stateBusy,
              onClick: () => setCloseConfirm(false)
            }, t('action.cancel')),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-dgp-pull': 'close-run',
              disabled: stateBusy,
              onClick: () => changeState('closed')
            }, t('pull.closeConfirm')))
          : h('button', {
            type: 'button',
            className: 'dgp-btn',
            'data-size': 'sm',
            'data-dgp-pull': 'close-pull',
            disabled: stateBusy,
            onClick: () => setCloseConfirm(true)
          }, t('pull.closeRun')))
        : h('button', {
          type: 'button',
          className: 'dgp-btn',
          'data-size': 'sm',
          'data-dgp-pull': 'reopen-pull',
          disabled: stateBusy,
          onClick: () => changeState('open')
        }, t('pull.reopenRun'))),

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
          t(ai.mode !== 'deep' ? 'pull.aiRunning' : (ai.phase === 'prepare' ? 'pull.aiPreparing' : 'pull.aiReviewing')))
        : null,
      clonePrompt === null ? null : h('div', { className: 'dgp-ai-clone', 'data-dgp-pull': 'clone-prompt' },
        h('p', { className: 'dgp-ai-summary' }, t('pull.aiCloneTitle', { repo: clonePrompt.repoUsed })),
        h('p', { className: 'dgp-detail-meta' }, t('pull.aiCloneHint')),
        clonePrompt.error === null
          ? null
          : h('p', { className: 'dgp-detail-failure' }, clonePrompt.error),
        h('div', { className: 'dgp-pull-actions' },
          h('button', {
            type: 'button',
            className: 'dgp-btn',
            'data-size': 'sm',
            'data-variant': 'primary',
            'data-dgp-pull': 'clone-workspace',
            disabled: clonePrompt.busy,
            onClick: () => startClone('workspace')
          }, t('pull.aiCloneWorkspace')),
          h('button', {
            type: 'button',
            className: 'dgp-btn',
            'data-size': 'sm',
            'data-variant': 'ghost',
            'data-dgp-pull': 'clone-cancel',
            disabled: clonePrompt.busy,
            onClick: () => setClonePrompt(null)
          }, t('action.cancel'))),
        h('div', { className: 'dgp-ai-clone-custom' },
          h('input', {
            className: 'dgp-input',
            'data-dgp-pull': 'clone-path',
            placeholder: t('pull.aiClonePlaceholder'),
            value: clonePrompt.customPath,
            spellCheck: false,
            disabled: clonePrompt.busy,
            onChange: (event) => setClonePrompt((previous) => (previous === null
              ? previous
              : { ...previous, customPath: event.target.value, error: null }))
          }),
          h('button', {
            type: 'button',
            className: 'dgp-btn',
            'data-size': 'sm',
            'data-dgp-pull': 'clone-custom',
            disabled: clonePrompt.busy || clonePrompt.customPath.trim() === '',
            onClick: () => startClone('custom')
          }, t('pull.aiCloneCustom')))),
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
            : null,
          renderSteps(ai.steps, ai.logPath))
        : null,
      ai.status !== 'done' ? null
        : ai.mode === 'session'
          ? h('div', { 'data-dgp-pull': 'ai-session' },
            h('p', { className: 'dgp-detail-notice' }, t('pull.sessionReviewStarted', { id: String(ai.result.sessionId ?? '') })))
          : h('div', { 'data-dgp-pull': 'ai-result' },
        ai.mode === 'deep'
          ? h('p', { className: 'dgp-detail-meta', 'data-dgp-pull': 'ai-deep-info' },
            t('pull.aiDeepInfo', { count: ai.result.filesRead ?? 0 }),
            ' · ',
            ai.result.objectSource === 'local'
              ? t('pull.aiDeepLocal', { repo: String(ai.result.localRootUsed ?? '').split(/[\\/]/).pop() })
              : t('pull.aiDeepTemp'))
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
        ai.result.filesTruncated === true
          ? h('p', { className: 'dgp-detail-notice', 'data-dgp-pull': 'ai-files-truncated' }, t('pull.aiFilesTruncated'))
          : null,
        typeof ai.result.cleanupError === 'string' && ai.result.cleanupError !== ''
          ? h('p', { className: 'dgp-detail-notice', 'data-dgp-pull': 'ai-cleanup-warn' },
            t('pull.aiCleanupWarn', { message: ai.result.cleanupError }))
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
              'data-dgp-pull': 'ai-fill-comment',
              disabled: draft.trim() === '',
              onClick: () => {
                setCommentDraft(draft)
                setCommentNotice(t('pull.commentFilled'))
              }
            }, t('pull.aiFillComment'))),
          h('pre', { className: 'dgp-ai-draft', 'data-dgp-pull': 'ai-comment' }, draft)),
        renderSteps(ai.steps, ai.logPath))),

    /* ------------------------------ 提交 ------------------------------ */
    (data.commits ?? []).length === 0 && (data.commitsUnavailable === null || data.commitsUnavailable === undefined)
      ? null
      : h('section', { className: 'dgp-detail-section', 'data-dgp-pull': 'commits' },
        h('div', { className: 'dgp-detail-head' },
          h('span', { className: 'dgp-detail-title' }, t('pull.commitsTitle')),
          h('span', { className: 'dgp-detail-count' }, String((data.commits ?? []).length))),
        data.commitsUnavailable === null || data.commitsUnavailable === undefined
          ? null
          : h('p', { className: 'dgp-detail-failure', 'data-dgp-pull': 'commits-error' }, data.commitsUnavailable),
        h('ul', { className: 'dgp-detail-list' },
          (data.commits ?? []).map((commit) => h('li', {
            key: commit.sha,
            className: 'dgp-detail-item',
            'data-dgp-commit-row': commit.sha
          },
          h('span', { className: 'dgp-detail-link dgp-oneline', title: commit.message }, commit.message.split('\n')[0]),
          h('span', { className: 'dgp-detail-meta' },
            h('span', { className: 'dgp-detail-author' }, commit.sha.slice(0, 7)),
            commit.author === '' ? null : h('span', null, commit.author),
            commit.date === '' ? null : h('span', null, formatDateTime(Date.parse(commit.date)))))))),

    /* ------------------------------ 评论 ------------------------------ */
    h('section', { className: 'dgp-detail-section', 'data-dgp-pull': 'comments' },
      h('div', { className: 'dgp-detail-head' },
        h('span', { className: 'dgp-detail-title' }, t('pull.commentsTitle')),
        h('span', { className: 'dgp-detail-count' },
          Array.isArray(data.comments) ? data.comments.length : 0)),
      data.commentsUnavailable === null || data.commentsUnavailable === undefined
        ? null
        : h('p', { className: 'dgp-detail-failure', 'data-dgp-pull': 'comments-error' }, data.commentsUnavailable),
      (data.comments ?? []).length === 0
        ? h('p', { className: 'dgp-detail-empty' }, t('pull.commentsEmpty'))
        : h('ul', { className: 'dgp-detail-list' },
          data.comments.map((comment, index) => h('li', {
            key: String(comment.id ?? index),
            className: 'dgp-detail-item',
            'data-dgp-comment': String(comment.id ?? index)
          },
          h('span', { className: 'dgp-detail-meta' },
            h('span', { className: 'dgp-detail-author' }, comment.author),
            comment.createdAt === '' ? null : h('span', null, formatDateTime(Date.parse(comment.createdAt)))),
          h('pre', { className: 'dgp-comment-body' }, comment.body)))),
      h('div', { className: 'dgp-comment-compose' },
        h('textarea', {
          className: 'dgp-input dgp-ai-textarea',
          'data-dgp-pull': 'comment-draft',
          placeholder: t('pull.commentPlaceholder'),
          value: commentDraft,
          spellCheck: false,
          style: { height: commentHeight },
          onChange: (event) => setCommentDraft(event.target.value)
        }),
        h('div', { className: 'dgp-pull-actions' },
          h('button', {
            type: 'button',
            className: 'dgp-btn',
            'data-size': 'sm',
            'data-variant': 'primary',
            'data-dgp-pull': 'comment-submit',
            disabled: commentBusy || commentDraft.trim() === '',
            onClick: submitComment
          }, t(commentBusy ? 'pull.aiCommentSubmitting' : 'pull.aiCommentSubmit')))),
      commentNotice === null
        ? null
        : h('p', { className: 'dgp-detail-notice', 'data-dgp-pull': 'comment-notice' }, commentNotice)),

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
