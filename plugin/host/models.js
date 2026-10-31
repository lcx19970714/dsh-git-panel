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
const MAX_OUTPUT_TOKENS = 512

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

/** provider 路由的 id：不同适配器给的字段名不一致，只按确定顺序取第一个存在的。 */
function providerIdOf(route) {
  for (const key of ['id', 'provider', 'name']) {
    const value = route === null || route === undefined ? undefined : route[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return null
}

function displayOf(route, fallback) {
  if (route !== null && route !== undefined && typeof route.displayName === 'string' && route.displayName !== '') {
    return route.displayName
  }
  return fallback
}

/** 拉出完整模型目录：`ref` 是扁平标识，`provider`/`model` 是真正传给 llm 的两个参数。 */
export async function listModels(llm) {
  if (llm === null || llm === undefined) {
    throw new GitError('no-llm', '当前 profile 没有挂载 LLM 服务，无法列出模型')
  }
  const models = []
  const failed = []
  for (const route of llm.listProviders()) {
    const provider = providerIdOf(route)
    if (provider === null) {
      failed.push({ provider: null, message: '有一个 provider 路由没有 id' })
      continue
    }
    let listed
    try {
      listed = await llm.listModels(provider)
    } catch (error) {
      // 单个 provider 配置坏了不该藏起其它 provider，但必须把它报出来
      failed.push({ provider, message: error instanceof Error ? error.message : String(error) })
      continue
    }
    const providerLabel = displayOf(route, provider)
    for (const model of listed) {
      if (typeof model?.id !== 'string' || model.id === '') continue
      models.push({
        ref: provider + '/' + model.id,
        provider,
        model: model.id,
        providerLabel,
        modelLabel: typeof model.name === 'string' && model.name !== '' ? model.name : model.id
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

/**
 * 用指定模型为这段 diff 生成提交说明。
 * 失败一律抛 GitError：模型没返回文本、finish 是错误/取消，都算失败，不伪造内容。
 */
export async function generateCommitMessage(llm, pair, diffText, options = {}) {
  if (typeof diffText !== 'string' || diffText.trim() === '') {
    throw new GitError('nothing-to-commit', '没有可生成提交说明的改动')
  }
  const target = await requireModel(llm, pair)
  const input = diffText.length > DIFF_PROMPT_LIMIT
    ? diffText.slice(0, DIFF_PROMPT_LIMIT) + '\n\n[diff 已截断，只保留前 ' + DIFF_PROMPT_LIMIT + ' 个字符]'
    : diffText

  const call = await llm.prepareCall(
    { provider: pair.provider, model: pair.model, maxTokens: MAX_OUTPUT_TOKENS },
    options.signal,
    (controls) => controls
  )

  let text = ''
  let failure = null
  const stream = call.stream({
    ...call.config,
    messages: [{ role: 'user', content: [{ type: 'text', text: input }] }],
    system: SYSTEM_PROMPT,
    purpose: 'dsh-git-panel/commit-message',
    signal: options.signal
  })
  for await (const chunk of stream) {
    if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') {
      text += chunk.text
    } else if (chunk?.type === 'finish') {
      const kind = chunk.reason === null || chunk.reason === undefined ? null : chunk.reason.kind
      if (kind === 'error' || kind === 'aborted') {
        failure = chunk.reason.failure?.message ?? kind
      }
    }
  }
  if (failure !== null) throw new GitError('model-failed', '模型调用失败：' + failure)
  const message = text.trim()
  if (message === '') throw new GitError('model-failed', '模型没有返回提交说明')
  return { message, model: target.ref, providerLabel: target.providerLabel, modelLabel: target.modelLabel }
}

/* ------------------------------------------------------------ 插件设置 */

export function settingsPath() {
  return path.join(dshHome(), 'dsh-git-panel', SETTINGS_FILE)
}

/** 读设置：文件不存在就是「还没选模型」；损坏直接报错，不静默重置。 */
export async function readSettings() {
  let text
  try {
    text = await readFile(settingsPath(), 'utf8')
  } catch (error) {
    if (error !== null && error.code === 'ENOENT') return { commitModel: null }
    throw error
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new GitError('bad-config', '设置文件损坏：' + settingsPath())
  }
  const pair = parsed?.commitModel
  const valid = pair !== null && typeof pair === 'object'
    && typeof pair.provider === 'string' && pair.provider !== ''
    && typeof pair.model === 'string' && pair.model !== ''
  return { commitModel: valid ? { provider: pair.provider, model: pair.model } : null }
}

/** 保存「生成提交说明用的模型」。传 null 表示清空。 */
export async function writeCommitModel(pair) {
  const target = settingsPath()
  await mkdir(path.dirname(target), { recursive: true })
  const temp = target + '.tmp-' + randomBytes(6).toString('hex')
  await writeFile(temp, JSON.stringify({ version: 1, commitModel: pair }, null, 2), 'utf8')
  await rename(temp, target)
  return { commitModel: pair }
}
