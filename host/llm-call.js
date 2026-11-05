/**
 * host/llm-call.js —— 一次模型调用（prepareCall → stream → 收集文本）
 *
 * 为什么要有这一层：提交说明、PR 标题描述、AI 审阅三个地方原先各自抄了一遍
 * 「建超时 → prepareCall → 拼 text-delta → 看 finish」。抄三遍的代价是同一个坑犯了三次：
 * **没有一处看 `finish.reason.kind === 'max-tokens'`**。于是输出被上限截断时，
 * 上层只会看到「JSON 不完整」，再报成「模型输出不是合法 JSON」——
 * 把人往「模型格式不对」的方向带，而真实原因是「预算不够，正文被砍断了」。
 *
 * 协议（dsh-llm 的 FinishReason 是封闭联合，见 dsh 的 terminalFinish）：
 *   stop / tool-calls / max-tokens / error / aborted
 * 这里把「成功 / 截断 / 失败」的判定收成一处：成功的只有 stop 与 tool-calls，
 * max-tokens 是**明确可识别的失败**（model-truncated），不是待解析的内容问题。
 */
import { GitError } from './git.js'

/** 失败原因里保留的模型文本：够看清在哪断的，又不会把信封撑爆。 */
const PREVIEW_TAIL = 160

function messageOf(error) {
  if (error instanceof Error) return error.message === '' ? error.name : error.message
  if (error !== null && typeof error === 'object' && typeof error.message === 'string') return error.message
  return String(error)
}

/**
 * 模型输出的诊断预览：长度 + **末尾**。
 *
 * 末尾而不是开头，是因为「看起来合法、其实不合法」的输出，问题一定在断点上；
 * 开头永远长得像正常 JSON（曾经就是只打印开头，才把人误导到格式问题上）。
 */
export function modelOutputPreview(text) {
  const value = String(text)
  if (value.length <= PREVIEW_TAIL) return '共 ' + value.length + ' 字符：' + JSON.stringify(value)
  return '共 ' + value.length + ' 字符，末尾：' + JSON.stringify(value.slice(-PREVIEW_TAIL))
}

/**
 * 跑一次模型调用并返回拼好的文本。
 *
 * @param {{
 *   llm: object,
 *   pair: {provider: string, model: string},
 *   system: string,
 *   prompt: string,
 *   purpose: string,
 *   maxTokens: number,
 *   timeoutMs: number,
 *   signal?: AbortSignal,
 *   lowestEffort?: boolean
 * }} args lowestEffort=true 时把推理档位压到该模型的最低档（把预算留给正文）
 * @returns {Promise<{text: string, finish: 'stop'|'tool-calls'}>}
 */
export async function callModel(args) {
  const { llm, pair, system, prompt, purpose, maxTokens, timeoutMs, signal, lowestEffort = false } = args
  const target = pair.provider + '/' + pair.model

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const forward = () => controller.abort()
  if (signal !== undefined) {
    if (signal.aborted === true) {
      clearTimeout(timer)
      throw new GitError('aborted', '操作已取消')
    }
    signal.addEventListener('abort', forward, { once: true })
  }

  let text = ''
  let finish = null
  let failure = null
  try {
    const call = await llm.prepareCall(
      { provider: pair.provider, model: pair.model, maxTokens },
      controller.signal,
      (controls, info) => {
        if (lowestEffort !== true) return controls
        const effort = info?.reasoning?.efforts?.[0]?.id
        return effort === undefined ? controls : { ...controls, reasoningEffort: effort }
      }
    )
    const stream = call.stream({
      ...call.config,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      system,
      purpose,
      signal: controller.signal
    })
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
        text += chunk.text
        continue
      }
      if (chunk?.type !== 'finish') continue
      const kind = chunk.reason === null || chunk.reason === undefined ? null : chunk.reason.kind
      if (kind === 'error' || kind === 'aborted') {
        failure = chunk.reason.failure === undefined || chunk.reason.failure === null
          ? kind
          : messageOf(chunk.reason.failure)
        continue
      }
      finish = kind
    }
  } catch (error) {
    if (timedOut) {
      throw new GitError('timeout', '模型 ' + Math.round(timeoutMs / 1000) + ' 秒内没有返回（' + target + '）')
    }
    if (signal !== undefined && signal.aborted === true) throw new GitError('aborted', '操作已取消')
    if (error instanceof GitError) throw error
    throw new GitError('model-failed', '模型调用失败（' + target + '）：' + messageOf(error))
  } finally {
    clearTimeout(timer)
    if (signal !== undefined) signal.removeEventListener('abort', forward)
  }

  if (failure !== null) {
    throw new GitError('model-failed', '模型返回了错误（' + target + '）：' + failure)
  }
  // 没有结束原因 = 流被中断：不能假装成功（那会把半截文本交给上层去解析）
  if (finish === null) {
    throw new GitError('model-failed', '模型没有给出结束原因（' + target + '）：' + modelOutputPreview(text))
  }
  if (finish === 'max-tokens') {
    throw new GitError('model-truncated',
      '模型输出达到上限（' + maxTokens + ' tokens）被截断，返回内容不完整（' + target + '）：'
      + '把输入改小（例如减少 diff），或换一个输出上限更高的模型。' + modelOutputPreview(text))
  }
  if (finish !== 'stop' && finish !== 'tool-calls') {
    throw new GitError('model-failed', '模型以未预期的方式结束（' + finish + '，' + target + '）')
  }
  return { text, finish }
}
