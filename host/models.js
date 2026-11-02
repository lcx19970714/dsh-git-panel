/**
 * host/models.js —— 提交说明生成（走 DSH 自己的 LLM 服务）
 *
 * 模型目录与调用都来自宿主注入的 `llm` 服务（`ctx.llm`）：
 *   listProviders()                → 已注册的 provider 路由
 *   listModels(provider)           → 该路由提供的模型
 *   prepareCall(config, signal, …) → 解析并冻结一次调用的配置
 *   call.stream(options)           → 逐块返回；文本在 `text-delta` 块里
 *
 * 这里不读任何配置文件、不碰任何密钥：凭据由 provider 适配器自己管，
 * 用户在哪配好了模型，这里就列什么、调什么。
 */
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import { GitError } from './git.js'

const SETTINGS_FILE = 'settings.json'
const DIFF_PROMPT_LIMIT = 60_000
/** 输出上限：推理型模型会先花 token 思考，给太小就会「没有返回文本」。 */
const MAX_OUTPUT_TOKENS = 1024
const DEFAULT_TIMEOUT_MS = 60_000

const SYSTEM_PROMPT = [
  '你是 Git 提交说明生成器。',
  '根据给出的 diff 写一条提交说明：第一行是不超过 50 个字符的主题，空一行后用少量子项说明原因。',
  '使用与 diff 里代码注释相同的语言；没有注释时用中文。',
  '只输出提交说明本身，不要代码块、不要前缀、不要解释。'
].join('\n')

function dshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.trim() !== '') return path.resolve(configured.trim())
  return path.join(homedir(), '.dsh')
}

/* ------------------------------------------------------------- 模型目录 */

/**
 * 拉出完整模型目录：`ref` 是扁平标识，`provider`/`model` 是真正传给 llm 的两个参数。
 *
 * 字段形状以 dsh-llm 的契约为准，不做「这个没有就试那个」：
 *  - provider 路由由适配器的 `providerInfo()` 给出，固定是 `{ id, name }`；
 *  - 模型记录由 `llm.listModels()` 校验并重建过，`provider`/`id`/`name` 都是非空字符串。
 * 违反契约说明适配器或运行时有问题，直接报出来，不猜、不跳过。
 *
 * `failed` 只用于「某个 provider 自己读取失败」（例如它的凭据没配）——
 * 那是运行时不变量允许的部分失败，必须显示出来而不是藏掉其它 provider。
 */
export async function listModels(llm) {
  if (llm === null || llm === undefined) {
    throw new GitError('no-llm', '当前 profile 没有挂载 LLM 服务，无法列出模型')
  }
  const models = []
  const failed = []
  for (const route of llm.listProviders()) {
    if (typeof route?.id !== 'string' || route.id === '' || typeof route.name !== 'string' || route.name === '') {
      throw new GitError('bad-provider', 'llm 返回的 provider 路由缺少 id/name：' + JSON.stringify(route))
    }
    let listed
    try {
      listed = await llm.listModels(route.id)
    } catch (error) {
      failed.push({ provider: route.id, message: messageOf(error) })
      continue
    }
    for (const model of listed) {
      models.push({
        ref: route.id + '/' + model.id,
        provider: route.id,
        model: model.id,
        providerLabel: route.name,
        modelLabel: model.name
      })
    }
  }
  return { models, failed }
}

/** 把 `provider/model` 拆回两个参数（provider id 不含 `/`，按第一个斜杠切）。 */
export function parseRef(ref) {
  if (typeof ref !== 'string') return null
  const at = ref.indexOf('/')
  if (at <= 0 || at === ref.length - 1) return null
  return { provider: ref.slice(0, at), model: ref.slice(at + 1) }
}

/** 确认目录里确实有这对 provider/model；对不上就报错并列出可选项。 */
export async function requireModel(llm, pair) {
  const { models } = await listModels(llm)
  const found = models.find((item) => item.provider === pair.provider && item.model === pair.model)
  if (found === undefined) {
    const known = models.map((item) => item.ref).join(', ')
    throw new GitError('unknown-model', `模型不在当前目录里：${pair.provider}/${pair.model}（可用：${known || '无'}）`)
  }
  return found
}

/* --------------------------------------------------------------- 生成 */

/** 失败既可能是 Error，也可能是适配器给的 `{ message }` 普通对象，两种都要能读出原因。 */
function messageOf(error) {
  if (error instanceof Error) return error.message === '' ? error.name : error.message
  if (error !== null && typeof error === 'object' && typeof error.message === 'string' && error.message !== '') {
    return error.message
  }
  return String(error)
}

/**
 * 用指定模型为这段 diff 生成提交说明。
 *
 * 失败一律抛 GitError，且**把原因写进 message**：上层文案是
 * 「生成提交说明失败：{message}」，只有这里说清楚，用户才知道是额度、网络还是模型问题。
 *
 * 两个容易被忽略的失败点：
 *  - 推理型模型会先花 token 思考，输出上限给太小就会「没有返回文本」——
 *    这里显式取该模型最低档 reasoning effort，并把上限放到 1024。
 *  - 有的 provider 会一直挂着不回：这里用一条独立超时把请求掐断，报 timeout 而不是无限等。
 */
export async function generateCommitMessage(llm, pair, diffText, options = {}) {
  if (typeof diffText !== 'string' || diffText.trim() === '') {
    throw new GitError('nothing-to-commit', '没有可生成提交说明的改动')
  }
  const target = await requireModel(llm, pair)
  const input = diffText.length > DIFF_PROMPT_LIMIT
    ? diffText.slice(0, DIFF_PROMPT_LIMIT) + '\n\n[diff 已截断，只保留前 ' + DIFF_PROMPT_LIMIT + ' 个字符]'
    : diffText
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : DEFAULT_TIMEOUT_MS

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const forward = () => controller.abort()
  if (options.signal !== undefined) {
    if (options.signal.aborted === true) {
      clearTimeout(timer)
      throw new GitError('aborted', '操作已取消')
    }
    options.signal.addEventListener('abort', forward, { once: true })
  }

  let text = ''
  let failure = null
  try {
    const call = await llm.prepareCall(
      { provider: pair.provider, model: pair.model, maxTokens: MAX_OUTPUT_TOKENS },
      controller.signal,
      (controls, info) => {
        // 提交说明不需要深思：有可用档位就取最低一档，把 token 留给正文
        const effort = info?.reasoning?.efforts?.[0]?.id
        return effort === undefined ? controls : { ...controls, reasoningEffort: effort }
      }
    )

    const stream = call.stream({
      ...call.config,
      messages: [{ role: 'user', content: [{ type: 'text', text: input }] }],
      system: SYSTEM_PROMPT,
      purpose: 'dsh-git-panel/commit-message',
      signal: controller.signal
    })
    for await (const chunk of stream) {
      if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
        text += chunk.text
      } else if (chunk?.type === 'finish') {
        const kind = chunk.reason === null || chunk.reason === undefined ? null : chunk.reason.kind
        if (kind === 'error' || kind === 'aborted') {
          failure = chunk.reason.failure === undefined || chunk.reason.failure === null
            ? kind
            : messageOf(chunk.reason.failure)
        }
      }
    }
  } catch (error) {
    if (timedOut) {
      throw new GitError('timeout', `模型 ${Math.round(timeoutMs / 1000)} 秒内没有返回（${target.ref}）`)
    }
    if (options.signal !== undefined && options.signal.aborted === true) {
      throw new GitError('aborted', '操作已取消')
    }
    if (error instanceof GitError) throw error
    throw new GitError('model-failed', `模型调用失败（${target.ref}）：${messageOf(error)}`)
  } finally {
    clearTimeout(timer)
    if (options.signal !== undefined) options.signal.removeEventListener('abort', forward)
  }

  if (failure !== null) {
    throw new GitError('model-failed', `模型返回了错误（${target.ref}）：${failure}`)
  }
  const message = text.trim()
  if (message === '') {
    throw new GitError('model-failed', `模型没有返回任何文本（${target.ref}），可能被输出上限截断或该模型不支持此用法`)
  }
  return { message, model: target.ref, providerLabel: target.providerLabel, modelLabel: target.modelLabel }
}

/* ------------------------------------------------------------ 插件设置 */

export function settingsPath() {
  return path.join(dshHome(), 'dsh-git-panel', SETTINGS_FILE)
}

/**
 * 读设置。
 *
 * 只有「文件不存在」等于「都还没配置」；文件在但解析失败、或字段形状不对，
 * 都是坏配置，直接报错 —— 把坏数据悄悄当成「未设置」等于掩盖问题。
 * 两个模型互相独立：缺一个不影响另一个。
 */
export async function readSettings() {
  const file = settingsPath()
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error !== null && error.code === 'ENOENT') return { commitModel: null, reviewModel: null }
    throw error
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new GitError('bad-config', '设置文件不是合法 JSON：' + file)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new GitError('bad-config', '设置文件顶层必须是对象：' + file)
  }
  return {
    commitModel: readPair(parsed.commitModel, 'commitModel', file),
    reviewModel: readPair(parsed.reviewModel, 'reviewModel', file)
  }
}

function readPair(value, field, file) {
  if (value === undefined || value === null) return null
  const valid = typeof value === 'object' && !Array.isArray(value)
    && typeof value.provider === 'string' && value.provider !== ''
    && typeof value.model === 'string' && value.model !== ''
  if (!valid) {
    throw new GitError('bad-config', '设置里的 ' + field + ' 必须是 {provider, model}：' + file)
  }
  return { provider: value.provider, model: value.model }
}

/**
 * 保存设置（部分更新）。
 *
 * 设置文件被手工改坏时：先把坏文件备份为 `settings.json.broken-<时间戳>`，再写新值。
 * 这不是「猜」——用户明确改了某个模型，意图清楚；坏文件留档，不静默丢弃。
 *
 * @param {{commitModel?: {provider: string, model: string}|null, reviewModel?: {provider: string, model: string}|null}} patch
 *   只处理传入的字段：传 null 表示清空该模型，未传表示保持原值。
 */
export async function writeSettings(patch) {
  const target = settingsPath()
  let current = { commitModel: null, reviewModel: null }
  let corrupt = null
  try {
    current = await readSettings()
  } catch (error) {
    if (error instanceof GitError && error.code === 'bad-config') corrupt = error
    else throw error
  }
  const next = {
    version: 2,
    commitModel: patch.commitModel === undefined ? current.commitModel : patch.commitModel,
    reviewModel: patch.reviewModel === undefined ? current.reviewModel : patch.reviewModel
  }
  await mkdir(path.dirname(target), { recursive: true })
  if (corrupt !== null) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await rename(target, target + '.broken-' + stamp)
  }
  const temp = target + '.tmp-' + randomBytes(6).toString('hex')
  await writeFile(temp, JSON.stringify(next, null, 2), 'utf8')
  await rename(temp, target)
  return { commitModel: next.commitModel, reviewModel: next.reviewModel, backedUp: corrupt === null ? null : target + '.broken-*' }
}
