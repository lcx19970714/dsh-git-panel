/**
 * host/models.js —— 提交说明生成用的模型目录
 *
 * 模型清单只有一个来源：当前 profile 的 cordis.patch.yml 里 id 为 `llm-pi-ai`
 * 的插件配置（`DSH_PROFILE_DIR` 指向该 profile）。密钥只有一个来源：
 * `$DSH_HOME/.credentials.yaml` 的 `refs` 段，按配置里的 `apiKeyEnv` 取。
 *
 * 缺 profile、缺这段配置、缺密钥、或接口报错，全部直接抛 GitError。
 * 不读进程环境变量里的密钥，也不回退到别的配置文件。
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { homedir } from 'node:os'

import { GitError } from './git.js'

const PATCH_FILE = 'cordis.patch.yml'
const LLM_PLUGIN_ID = 'llm-pi-ai'
const SETTINGS_FILE = 'settings.json'

/** 送给模型的差异文本上限（字符）。超出就截断并注明，避免一次请求塞进整个仓库。 */
const DIFF_PROMPT_LIMIT = 60_000

function dshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.trim() !== '') return path.resolve(configured.trim())
  return path.join(homedir(), '.dsh')
}

/** 当前 profile 目录。只认 `DSH_PROFILE_DIR`，宿主进程由 DSH 注入。 */
function profileDir() {
  const configured = process.env.DSH_PROFILE_DIR
  if (typeof configured !== 'string' || configured.trim() === '') {
    throw new GitError('no-profile', '宿主进程没有 DSH_PROFILE_DIR，无法定位模型配置')
  }
  return path.resolve(configured.trim())
}

/**
 * 取一段 YAML 值：折叠引号、去掉行尾注释。
 * 只覆盖 cordis.patch.yml 里实际出现的写法（裸值、双引号）。
 */
function yamlScalar(raw) {
  const text = String(raw).replace(/\s+#.*$/, '').trim()
  if (text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\"/g, '"')
  }
  return text
}

/**
 * 解析 `llm-pi-ai` 配置块里的 providers。
 *
 * 输入是从 `providers:` 到下一个同级键之间的文本，缩进固定为配置文件的实际缩进。
 * 不引入 YAML 库：这段配置的形状是稳定的（provider → 标量字段 → models 列表）。
 */
export function parseProviders(block) {
  const providers = []
  let current = null
  let model = null
  for (const line of String(block).split('\n')) {
    const providerMatch = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line)
    if (providerMatch !== null) {
      current = { id: providerMatch[1], displayName: providerMatch[1], api: '', baseURL: '', apiKeyEnv: '', models: [] }
      providers.push(current)
      model = null
      continue
    }
    if (current === null) continue
    const fieldMatch = /^ {4}(displayName|api|baseURL|apiKeyEnv):\s*(.*)$/.exec(line)
    if (fieldMatch !== null) {
      current[fieldMatch[1]] = yamlScalar(fieldMatch[2])
      continue
    }
    const modelMatch = /^ {6}- id:\s*(.*)$/.exec(line)
    if (modelMatch !== null) {
      model = { id: yamlScalar(modelMatch[1]), name: yamlScalar(modelMatch[1]) }
      current.models.push(model)
      continue
    }
    const nameMatch = /^ {8}name:\s*(.*)$/.exec(line)
    if (nameMatch !== null && model !== null) model.name = yamlScalar(nameMatch[1])
  }
  return providers.filter((provider) => provider.baseURL !== '' && provider.apiKeyEnv !== '' && provider.models.length > 0)
}

/** 从 profile 的 cordis.patch.yml 读出模型目录。 */
export async function readModelCatalog() {
  const file = path.join(profileDir(), PATCH_FILE)
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error !== null && error.code === 'ENOENT') {
      throw new GitError('no-models', '找不到模型配置：' + file)
    }
    throw error
  }
  const marker = text.indexOf('\n- id: ' + LLM_PLUGIN_ID + '\n')
  const start = marker === -1 && text.startsWith('- id: ' + LLM_PLUGIN_ID + '\n') ? 0 : marker
  if (start === -1) throw new GitError('no-models', PATCH_FILE + ' 里没有 ' + LLM_PLUGIN_ID + ' 的配置')
  const rest = text.slice(start)
  const providersAt = rest.indexOf('\n    providers:\n')
  if (providersAt === -1) throw new GitError('no-models', LLM_PLUGIN_ID + ' 配置里没有 providers')
  const after = rest.slice(providersAt + '\n    providers:\n'.length)
  const nextPlugin = after.search(/\n- id: /)
  const block = nextPlugin === -1 ? after : after.slice(0, nextPlugin)
  const providers = parseProviders(block)
  if (providers.length === 0) throw new GitError('no-models', LLM_PLUGIN_ID + ' 配置里没有可用的模型')
  return providers
}

/** 从 `$DSH_HOME/.credentials.yaml` 的 refs 段取一个密钥。 */
export async function readCredential(name) {
  const file = path.join(dshHome(), '.credentials.yaml')
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error !== null && error.code === 'ENOENT') {
      throw new GitError('no-credential', '找不到凭据文件：' + file)
    }
    throw error
  }
  const refsAt = text.indexOf('\nrefs:\n')
  if (refsAt === -1) throw new GitError('no-credential', '凭据文件里没有 refs 段')
  const pattern = new RegExp('^\\s+' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*(.+)$', 'm')
  const match = pattern.exec(text.slice(refsAt))
  if (match === null) throw new GitError('no-credential', '凭据文件的 refs 里没有 ' + name)
  const value = match[1].trim().replace(/,$/, '')
  if (value === '') throw new GitError('no-credential', name + ' 的值是空的')
  return value
}

/** 扁平的模型列表：`providerId/modelId` 是稳定标识，展示用 provider 与模型的名字。 */
export async function listModels() {
  const providers = await readModelCatalog()
  const models = []
  for (const provider of providers) {
    for (const model of provider.models) {
      models.push({
        ref: provider.id + '/' + model.id,
        providerId: provider.id,
        providerName: provider.displayName,
        modelId: model.id,
        modelName: model.name
      })
    }
  }
  return models
}

/** 按 `provider/model` 找到目录项；对不上就抛错，不挑一个"差不多"的。 */
async function resolveModel(ref) {
  const models = await listModels()
  const found = models.find((model) => model.ref === ref)
  if (found === undefined) throw new GitError('unknown-model', '模型不在目录里：' + ref)
  const providers = await readModelCatalog()
  const provider = providers.find((item) => item.id === found.providerId)
  return { model: found, provider }
}

const SYSTEM_PROMPT = [
  '你是 Git 提交说明生成器。',
  '根据给出的 diff 写一条提交说明：第一行是不超过 50 个字符的主题，空一行后用少量子项说明原因。',
  '使用与 diff 里代码注释相同的语言；没有注释时用中文。',
  '只输出提交说明本身，不要代码块、不要前缀、不要解释。'
].join('\n')

/** 用目录里的一个模型为这段 diff 生成提交说明。 */
export async function generateCommitMessage(ref, diffText, options = {}) {
  if (typeof diffText !== 'string' || diffText.trim() === '') {
    throw new GitError('nothing-to-commit', '没有可生成提交说明的改动')
  }
  const { model, provider } = await resolveModel(ref)
  const apiKey = await readCredential(provider.apiKeyEnv)
  const body = diffText.length > DIFF_PROMPT_LIMIT
    ? diffText.slice(0, DIFF_PROMPT_LIMIT) + '\n\n[diff 已截断，只保留前 ' + DIFF_PROMPT_LIMIT + ' 个字符]'
    : diffText
  const endpoint = provider.baseURL.replace(/\/+$/, '') + '/chat/completions'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  const forward = () => controller.abort()
  if (options.signal !== undefined) options.signal.addEventListener('abort', forward, { once: true })
  let response
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + apiKey },
      body: JSON.stringify({
        model: model.modelId,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: body }
        ]
      }),
      signal: controller.signal
    })
  } catch (error) {
    if (controller.signal.aborted) throw new GitError('timeout', '模型请求超时或已取消')
    throw new GitError('model-failed', '模型请求失败：' + (error instanceof Error ? error.message : String(error)))
  } finally {
    clearTimeout(timer)
    if (options.signal !== undefined) options.signal.removeEventListener('abort', forward)
  }
  if (!response.ok) {
    throw new GitError('model-failed', '模型接口返回 HTTP ' + response.status)
  }
  const payload = await response.json()
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim() === '') {
    throw new GitError('model-failed', '模型没有返回提交说明')
  }
  return { message: content.trim(), model: model.ref }
}

/* ---------------------------------------------------------- 插件设置 */

/** 设置文件：与外部根配置放在同一目录。 */
export function settingsPath() {
  return path.join(dshHome(), 'dsh-git-panel', SETTINGS_FILE)
}

/** 读设置。文件不存在就是空设置；损坏直接报错，不静默重置。 */
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
  const commitModel = typeof parsed.commitModel === 'string' && parsed.commitModel !== '' ? parsed.commitModel : null
  return { commitModel }
}

/** 保存"生成提交说明用的模型"。传空字符串表示清除。ref 必须在目录里。 */
export async function writeCommitModel(ref) {
  const { mkdir, rename, writeFile } = await import('node:fs/promises')
  const { randomBytes } = await import('node:crypto')
  let commitModel = null
  if (typeof ref === 'string' && ref !== '') {
    await resolveModel(ref)
    commitModel = ref
  }
  const target = settingsPath()
  await mkdir(path.dirname(target), { recursive: true })
  const temp = target + '.tmp-' + randomBytes(6).toString('hex')
  await writeFile(temp, JSON.stringify({ version: 1, commitModel }, null, 2), 'utf8')
  await rename(temp, target)
  return { commitModel }
}
