/**
 * src/components/PullDetail.js —— 单个 PR 的详情与操作（审查 / 合并）
 *
 * 能力来自宿主返回的 capabilities：Gitee 只有「通过」一种结论、合并方式两种，
 * GitHub 三种都有。界面只渲染平台真正支持的动作，不做「点了才发现不支持」。
 */
import { h, useState, useRef } from '../platform.js'
import { Icon, StatusLetter } from '../ui/Icon.js'
import { DiffView } from './DiffView.js'
import { formatDateTime } from '../util/time.js'

const VERDICT_LABEL = {
  approve: 'pull.approve',
  'request-changes': 'pull.requestChanges',
  comment: 'pull.comment'
}

/** 平台给的是 added / modified / removed / renamed 这类词，界面要单个字母。 */
const FILE_LETTER = {
  added: 'A',
  copied: 'C',
  changed: 'M',
  deleted: 'D',
  modified: 'M',
  removed: 'D',
  renamed: 'R',
  unchanged: 'M'
}

const fileLetter = (status) => {
  if (typeof status !== 'string' || status === '') return '?'
  return FILE_LETTER[status] ?? status.slice(0, 1).toUpperCase()
}

/** PR 状态 → 文案 key。平台给了没见过的状态就原样显示，不拼一个不存在的 key。 */
const PULL_STATE_KEYS = {
  open: 'pull.state.open',
  closed: 'pull.state.closed',
  merged: 'pull.state.merged'
}

const pullStateLabel = (t, state) => {
  const key = PULL_STATE_KEYS[state]
  if (key !== undefined) return t(key)
  return typeof state === 'string' && state !== '' ? state : t('pull.state.unknown')
}

export function PullDetail(props) {
  const source = props
  const t = source.t
  const selection = source.selection
  const detail = source.detail
  const [note, setNote] = useState('')
  const [mergeMethod, setMergeMethod] = useState('merge')
  const [deleteBranch, setDeleteBranch] = useState(true)
  // 合并是破坏性操作（可能连源分支一起删）：两步确认，与关闭 PR 同口径
  const [mergeConfirm, setMergeConfirm] = useState(false)
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
  // 评论转会话：{ busyId, error, notice }
  const [commentAi, setCommentAi] = useState({ busyId: null, error: null, notice: null })
  // 关闭 PR 是两步操作：先确认再发，避免误点
  const [closeConfirm, setCloseConfirm] = useState(false)
  const [stateBusy, setStateBusy] = useState(false)
  // 变动文件：当前展开的文件、每个文件按需读到的 diff（filename -> { status, diff, error }）
  const [openFile, setOpenFile] = useState(null)
  const [fileLoads, setFileLoads] = useState({})
  // 已读到的 diff 与正在读的文件：折叠再展开不重复请求，连点也不会发两次
  const fileCache = useRef(new Map())
  const filePending = useRef(new Set())

  if (selection === null) return null

  const back = () => {
    source.onBack()
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
        h('div', { className: 'dgp-state-icon' }, h(Icon, { name: 'warning', size: 24 })),
        h('div', { className: 'dgp-state-title' }, t('pull.failed')),
        h('div', { className: 'dgp-state-desc' }, detail.error),
        h('div', { className: 'dgp-state-actions' },
          h('button', {
            type: 'button',
            className: 'dgp-btn',
            'data-size': 'sm',
            onClick: () => {
              source.onRetry()
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

  /* ---------------------- 变动文件：按需读单个文件的 diff ---------------------- */

  /** 读一个文件的 diff（已读过就用缓存；同一文件正在读时不重复发请求）。 */
  const loadFileDiff = async (file) => {
    const name = file.filename
    const cached = fileCache.current.get(name)
    if (cached !== undefined) {
      setFileLoads((previous) => ({ ...previous, [name]: cached }))
      return
    }
    if (filePending.current.has(name)) return
    filePending.current.add(name)
    setFileLoads((previous) => ({ ...previous, [name]: { status: 'loading' } }))
    let result
    try {
      result = await source.onPullFile({
        accountId: selection.accountId,
        fullName: selection.fullName,
        number: pull.number,
        filename: name
      })
    } catch (caught) {
      result = { ok: false, error: caught instanceof Error ? caught.message : String(caught) }
    } finally {
      filePending.current.delete(name)
    }
    if (result.ok === true) {
      const entry = { status: 'done', diff: result.diff }
      fileCache.current.set(name, entry)
      setFileLoads((previous) => ({ ...previous, [name]: entry }))
      return
    }
    setFileLoads((previous) => ({
      ...previous,
      [name]: {
        status: 'error',
        error: result.error
      }
    }))
  }

  /** 点一行：展开 / 收起；第一次展开时读 diff。 */
  const toggleFile = (file) => {
    const name = file.filename
    if (openFile === name) {
      setOpenFile(null)
      return
    }
    setOpenFile(name)
    void loadFileDiff(file)
  }

  /** 读失败后重试：先丢掉缓存（错误结果本来也不进缓存）。 */
  const retryFile = (file) => {
    fileCache.current.delete(file.filename)
    setFileLoads((previous) => ({ ...previous, [file.filename]: { status: 'loading' } }))
    void loadFileDiff(file)
  }

  /** 展开区的内容：加载中 / 失败 + 重试 / DiffView。 */
  const renderFileDiff = (file) => {
    const load = fileLoads[file.filename]
    if (load === undefined || load.status === 'loading') {
      return h('p', { className: 'dgp-detail-meta', 'data-dgp-pull': 'file-loading' }, t('pull.fileDiffLoading'))
    }
    if (load.status === 'error') {
      return h('div', { className: 'dgp-pull-file-error' },
        h('p', { className: 'dgp-detail-failure', 'data-dgp-pull': 'file-error' }, load.error),
        h('button', {
          type: 'button',
          className: 'dgp-btn',
          'data-size': 'sm',
          'data-variant': 'ghost',
          'data-dgp-pull': 'file-retry',
          onClick: () => retryFile(file)
        }, t('action.retry')))
    }
    return h(DiffView, {
      diff: load.diff,
      loading: false,
      error: null,
      path: file.filename,
      entry: {
        status: fileLetter(file.status),
        adds: file.additions,
        dels: file.deletions
      },
      view: 'unified',
      wrap: false,
      onRetry: () => retryFile(file),
      t
    })
  }

  /**
   * 评论草稿的可见行数：按换行切分，长行按每行约 80 字符折算。
   * 最少 6 行、最多 30 行 —— 内容多时输入框自己长高，不用手动拉。
   */
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
    if (result.ok === true && result.closed === true) return
    if (result.ok === true) {
      setNotice(result.message ?? null)
      return
    }
    setError({ text: result.error, code: result.code ?? null })
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
      logPath === null
        ? null
        : h('p', { className: 'dgp-settings-hint' }, t('pull.aiLogHint', { path: logPath })))
  }

  /** 跑一次 AI 审阅（宿主负责取 diff 与调模型）。 */
  const runAi = async (mode, prepared = null) => {
    setCommentNotice(null)
    setClonePrompt(null)
    if (mode === 'session') setAi({ status: 'loading', mode, result: null, error: null, steps: [], logPath: null, phase: 'prepare' })
    else setAi({ status: 'loading', mode, result: null, error: null, steps: [], logPath: null, phase: null })

    const base = { accountId: selection.accountId, fullName: selection.fullName, number: pull.number }
    let result

    if (mode === 'session') {
      let target = prepared
      if (target === null) {
        const prep = await source.onPrepareReview({
          ...base,
          rootPaths: source.localRepoRoots
        })
        if (prep.ok !== true) {
          setAi({
            status: 'error', mode, result: null,
            error: prep.error,
            code: prep.code ?? null,
            steps: prep.details?.steps ?? [],
            logPath: prep.details?.logPath ?? null,
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
      // 阶段二：会话级审阅（新开会话 + Agent 工具）。这是唯一实现，没有本地退路。
      setAi({ status: 'loading', mode, result: null, error: null, steps: target.steps ?? [], logPath: target.logPath ?? null, phase: 'review' })
      const started = await source.onSessionReview({ ...base, rootPath: target.rootPath, branch: target.branch })
      if (started.ok === true && typeof started.sessionId === 'string') {
        setAi({ status: 'done', mode: 'session', result: started, error: null, steps: [], logPath: started.logPath ?? null, phase: null })
        setCommentNotice(t('pull.sessionReviewStarted', { id: started.sessionId }))
        return
      }
      setAi({
        status: 'error',
        mode: 'session',
        result: null,
        error: started.error,
        code: started.code ?? null,
        steps: started.details?.steps ?? target.steps,
        logPath: started.details?.logPath ?? target.logPath,
        phase: null
      })
      return
    } else {
      result = await source.onAiReview({ ...base })
    }

    if (result.ok === true) {
      setAi({
        status: 'done', mode, result, error: null,
        steps: result.steps ?? [],
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
      error: result.error,
      code: result.code ?? null,
      steps: result.details?.steps ?? [],
      logPath: result.details?.logPath ?? null,
      phase: null
    })
  }

  /** 确认克隆位置：workspace = 项目工作区；custom = 用户填的绝对路径。 */
  /**
   * 把一条评论交给会话处理：宿主准备目录 → 新建会话（先判断再改，不自动 push）。
   * 本地没有仓库时复用克隆确认框，克隆完继续处理同一条评论。
   */
  const runCommentAi = async (comment) => {
    if (commentAi.busyId !== null) return
    setCommentAi({ busyId: comment.id ?? 0, error: null, notice: null })
    const result = await source.onCommentSession({
      accountId: selection.accountId,
      fullName: selection.fullName,
      number: pull.number,
      rootPaths: source.localRepoRoots,
      comment: {
        id: comment.id,
        author: comment.author,
        body: comment.body,
        createdAt: comment.createdAt
      }
    })
    if (result.ok === true && result.needsClone === true) {
      setCommentAi({ busyId: null, error: null, notice: null })
      setClonePrompt({
        repoUsed: result.repoUsed,
        suggestedName: result.suggestedName,
        headBranch: result.headBranch,
        customPath: '',
        busy: false,
        error: null,
        intent: 'comment',
        comment
      })
      return
    }
    if (result.ok === true) {
      setCommentAi({ busyId: null, error: null, notice: t('pull.commentAiStarted', { id: result.sessionId }) })
      return
    }
    setCommentAi({ busyId: null, error: result.error, notice: null })
  }

  const startClone = async (target) => {
    if (clonePrompt === null) return
    const targetDir = target === 'workspace'
      ? (source.projectRoot === null ? '' : source.projectRoot + '/' + clonePrompt.suggestedName)
      : clonePrompt.customPath.trim()
    if (targetDir === '') {
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
    if (result.ok !== true) {
      setClonePrompt((previous) => (previous === null ? previous : { ...previous, busy: false, error: result.error }))
      return
    }
    if (clonePrompt.intent === 'comment' && clonePrompt.comment !== undefined) {
      // 克隆完继续处理那条评论（用刚准备好的目录）
      const comment = clonePrompt.comment
      setClonePrompt(null)
      const handled = await source.onCommentSession({
        accountId: selection.accountId,
        fullName: selection.fullName,
        number: pull.number,
        rootPath: result.rootPath,
        branch: result.branch,
        comment: { id: comment.id, author: comment.author, body: comment.body, createdAt: comment.createdAt }
      })
      if (handled.ok === true) {
        setCommentAi({ busyId: null, error: null, notice: t('pull.commentAiStarted', { id: handled.sessionId }) })
      } else {
        setCommentAi({ busyId: null, error: handled.error, notice: null })
      }
      return
    }
    await runAi('session', { rootPath: result.rootPath, branch: result.branch })
  }

  /** 关闭 / 重新打开。关闭需要二次确认；重新打开直接执行（无破坏性）。 */
  const changeState = async (nextState) => {
    if (stateBusy) return
    setStateBusy(true)
    const result = await source.onSetPullState({
      accountId: selection.accountId,
      fullName: selection.fullName,
      number: pull.number,
      state: nextState
    })
    setStateBusy(false)
    setCloseConfirm(false)
    if (result.ok === true) {
      setNotice(t(nextState === 'closed' ? 'pull.closedNotice' : 'pull.reopenedNotice'))
      return
    }
    setError({ text: result.error, code: result.code ?? null })
  }

  const submitComment = async () => {
    if (commentBusy) return
    setCommentBusy(true)
    setCommentNotice(null)
    const result = await source.onComment({
      accountId: selection.accountId,
      fullName: selection.fullName,
      number: pull.number,
      comment: commentDraft
    })
    setCommentBusy(false)
    if (result.ok === true) {
      // 发出去之后清空输入框：否则内容留在框里，用户会以为没发出去
      setCommentDraft('')
      setCommentNotice(result.message ?? t('pull.aiCommentDone'))
      return
    }
    setCommentNotice(result.error)
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

  /* --------------------------- 变动文件 --------------------------- */
  // 宿主在 pullDetail 里带回文件清单（不含 patch）：点开某一行时才去读那个文件的 diff。
  const files = data.files
  const filesUnavailable = data.filesUnavailable
  // 数量以平台给的总数为准：文件列表可能读失败或被截断，此时列表条数不是真实改动数。
  const filesCount = filesUnavailable !== null || data.filesTruncated === true ? statText(pull.changedFiles) : files.length
  const filesSection =
    h('section', { className: 'dgp-detail-section', 'data-dgp-pull': 'files' },
      h('div', { className: 'dgp-detail-head' },
        h('span', { className: 'dgp-detail-title' }, t('pull.filesTitle')),
        h('span', { className: 'dgp-detail-count' }, t('pull.filesChanged', { count: filesCount }))),
      filesUnavailable === null
        ? null
        : h('p', { className: 'dgp-detail-failure', 'data-dgp-pull': 'files-error' },
          t('pull.filesUnavailable', { message: filesUnavailable })),
      files.length === 0
        ? (filesUnavailable === null
          ? h('p', { className: 'dgp-detail-empty' }, t('pull.filesEmpty'))
          : null)
        : h('ul', { className: 'dgp-pull-files' },
          files.map((file) => {
            const open = openFile === file.filename
            return h('li', {
              key: file.filename,
              className: 'dgp-pull-file',
              'data-dgp-file': file.filename,
              'data-open': open ? 'true' : undefined
            },
            h('button', {
              type: 'button',
              className: 'dgp-pull-file-row',
              'data-dgp-pull': 'file-row',
              'data-file': file.filename,
              'aria-expanded': open ? 'true' : 'false',
              onClick: () => toggleFile(file)
            },
            h(StatusLetter, { status: fileLetter(file.status) }),
            h('span', { className: 'dgp-pull-file-name dgp-oneline', title: file.filename }, file.filename),
            h('span', { className: 'dgp-pull-file-stat' },
              h('span', { className: 'dgp-add' }, '+' + String(file.additions)),
              h('span', { className: 'dgp-del' }, '−' + String(file.deletions))),
            h(Icon, { name: open ? 'chevron-down' : 'chevron-right', size: 12 })),
            open
              ? h('div', {
                className: 'dgp-pull-file-diff',
                'data-dgp-pull': 'file-diff',
                'data-file': file.filename
              }, renderFileDiff(file))
              : null)
          })),
      data.filesTruncated === true
        ? h('p', { className: 'dgp-detail-notice', 'data-dgp-pull': 'files-truncated' },
          t('pull.filesTruncated', { count: files.length }))
        : null)

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
          source.onOpenUrl(pull.htmlUrl)
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
        : (pull.merged === true
          ? null
          : h('button', {
            type: 'button',
            className: 'dgp-btn',
            'data-size': 'sm',
            'data-dgp-pull': 'reopen-pull',
            disabled: stateBusy,
            onClick: () => changeState('open')
          }, t('pull.reopenRun')))),

    /* 门禁状态：审查与测试并排一行，状态一眼可见 */
    h('div', { className: 'dgp-gate', 'data-dgp-pull': 'gate' },
      h('span', { className: 'dgp-gate-chip', 'data-gate': 'review', 'data-state': gate.review.state },
        t('pull.gateReview'), '：', gateLabel('review', gate.review.state)),
      h('span', { className: 'dgp-gate-chip', 'data-gate': 'test', 'data-state': gate.test.state },
        t('pull.gateTest'), '：', gateLabel('test', gate.test.state)),
      gate.mergeState === null ? null : h('span', { className: 'dgp-gate-chip', 'data-gate': 'merge-state' },
        t('pull.gateMergeState'), '：', gate.mergeState)),

    h('div', { className: 'dgp-detail-meta' },
      h('span', { 'data-dgp-pull-state': pull.state }, pullStateLabel(t, pull.state)),
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

    filesSection,

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
          onClick: () => runAi('session')
        }, t('pull.aiDeepRun'))),
      ai.status === 'loading'
        ? h('p', { className: 'dgp-detail-meta', 'data-dgp-pull': 'ai-loading' },
          t(ai.mode !== 'session' ? 'pull.aiRunning' : (ai.phase === 'prepare' ? 'pull.aiPreparing' : 'pull.aiReviewing')))
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
          ai.code === 'no-review-model'
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
            h('p', { className: 'dgp-detail-notice' }, t('pull.sessionReviewStarted', { id: ai.result.sessionId })))
          : h('div', { 'data-dgp-pull': 'ai-result' },
        ai.result.truncated === true
          ? h('p', { className: 'dgp-detail-notice', 'data-dgp-pull': 'ai-truncated' }, t('pull.aiTruncated'))
          : null,
        ai.result.filesTruncated === true
          ? h('p', { className: 'dgp-detail-notice', 'data-dgp-pull': 'ai-files-truncated' }, t('pull.aiFilesTruncated'))
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
    data.commits.length === 0 && data.commitsUnavailable === null
      ? null
      : h('section', { className: 'dgp-detail-section', 'data-dgp-pull': 'commits' },
        h('div', { className: 'dgp-detail-head' },
          h('span', { className: 'dgp-detail-title' }, t('pull.commitsTitle')),
          h('span', { className: 'dgp-detail-count' }, data.commitsUnavailable === null ? statText(pull.commits) : '—')),
        data.commitsUnavailable === null
          ? null
          : h('p', { className: 'dgp-detail-failure', 'data-dgp-pull': 'commits-error' }, data.commitsUnavailable),
        data.commits.length < pull.commits
          ? h('p', { className: 'dgp-detail-notice', 'data-dgp-pull': 'commits-limited' },
            t('pull.commitsLimited', { shown: data.commits.length, total: pull.commits }))
          : null,
        h('ul', { className: 'dgp-detail-list' },
          data.commits.map((commit) => h('li', {
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
          data.commentsUnavailable === null ? data.comments.length : '—')),
      data.commentsUnavailable === null
        ? null
        : h('p', { className: 'dgp-detail-failure', 'data-dgp-pull': 'comments-error' }, data.commentsUnavailable),
      data.comments.length === 0
        ? h('p', { className: 'dgp-detail-empty' }, t('pull.commentsEmpty'))
        : h('ul', { className: 'dgp-detail-list' },
          data.comments.map((comment, index) => h('li', {
            key: String(comment.id ?? index),
            className: 'dgp-detail-item',
            'data-dgp-comment': String(comment.id ?? index)
          },
          h('div', { className: 'dgp-comment-head' },
            h('span', { className: 'dgp-detail-meta' },
              h('span', { className: 'dgp-detail-author' }, comment.author),
              comment.createdAt === '' ? null : h('span', null, formatDateTime(Date.parse(comment.createdAt)))),
            h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-variant': 'ghost',
              'data-dgp-pull': 'comment-ai',
              disabled: commentAi.busyId !== null,
              onClick: () => runCommentAi(comment)
            }, t(commentAi.busyId === (comment.id ?? 0) ? 'pull.commentAiBusy' : 'pull.commentAi'))),
          h('pre', { className: 'dgp-comment-body' }, comment.body)))),
      commentAi.notice === null
        ? null
        : h('p', { className: 'dgp-detail-notice', 'data-dgp-pull': 'comment-ai-notice' }, commentAi.notice),
      commentAi.error === null
        ? null
        : h('p', { className: 'dgp-detail-failure', 'data-dgp-pull': 'comment-ai-error' }, commentAi.error),
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
          caps.reviews !== true
            ? t('pull.reviewUnsupported')
            : (data.reviewsUnavailable === null ? t('pull.reviewCount', { count: data.reviews.length }) : '—'))),
      data.reviewsUnavailable === null
        ? null
        : h('p', { className: 'dgp-detail-failure', 'data-dgp-pull': 'reviews-error' },
          t('pull.reviewsUnavailable', { message: data.reviewsUnavailable })),
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
            onChange: (event) => {
              setMergeMethod(event.target.value)
              setMergeConfirm(false)
            }
          },
          caps.mergeMethods.map((method) => h('option', { key: method, value: method }, t('pull.method.' + method)))),
          h('label', { className: 'dgp-pull-check' },
            h('input', {
              type: 'checkbox',
              'data-dgp-pull': 'delete-branch',
              checked: deleteBranch,
              onChange: (event) => {
                setDeleteBranch(event.target.checked)
                setMergeConfirm(false)
              }
            }),
            t('pull.deleteBranch', { branch: pull.headBranch })),
          mergeConfirm
            ? h('span', { className: 'dgp-pull-confirm', 'data-dgp-pull': 'merge-confirm' },
              h('button', {
                type: 'button',
                className: 'dgp-btn',
                'data-size': 'sm',
                'data-variant': 'ghost',
                disabled: busy !== null,
                onClick: () => setMergeConfirm(false)
              }, t('action.cancel')),
              h('button', {
                type: 'button',
                className: 'dgp-btn',
                'data-size': 'sm',
                'data-variant': 'primary',
                'data-dgp-pull': 'merge-confirm-run',
                disabled: busy !== null || mergeBlocked,
                onClick: () => run('merge', () => source.onMerge({
                  accountId: selection.accountId,
                  fullName: selection.fullName,
                  number: pull.number,
                  method: mergeMethod,
                  deleteBranch
                }))
              }, t(busy === 'merge' ? 'pull.merging' : 'pull.mergeConfirm')))
            : h('button', {
              type: 'button',
              className: 'dgp-btn',
              'data-size': 'sm',
              'data-variant': 'primary',
              'data-dgp-pull': 'merge-run',
              disabled: busy !== null || mergeBlocked,
              onClick: () => setMergeConfirm(true)
            }, t('pull.mergeRun'))))
      : null,

    busy === null ? null : h('p', { className: 'dgp-detail-meta' }, t('pull.working')),
    notice === null ? null : h('p', { className: 'dgp-detail-notice', 'data-dgp-pull': 'notice' }, notice),
    error === null ? null : h('div', { className: 'dgp-pull-error', 'data-dgp-pull': 'error' },
      h('p', { className: 'dgp-detail-failure' }, error.text),
      // 冲突是「可以去网页上解决」的状态问题，不是一个死胡同：给一条直达 PR 的出口
      error.code === 'pull-conflict'
        ? h('button', {
          type: 'button',
          className: 'dgp-btn',
          'data-size': 'sm',
          'data-variant': 'ghost',
          'data-dgp-pull': 'conflict-open-web',
          onClick: () => {
            source.onOpenUrl(pull.htmlUrl)
          }
        }, t('pull.conflictOpenWeb'), h(Icon, { name: 'external', size: 12 }))
        : null))
}
