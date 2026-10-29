/**
 * host/config.js —— 外部仓库根配置（每个项目一份额外根列表）
 *
 * 落盘位置：<DSH_HOME>/dsh-git-panel/roots.json
 *   DSH_HOME = process.env.DSH_HOME || ~/.dsh   ← **每次调用时解析**，不在模块加载期固化，
 *   这样测试可以先设置 DSH_HOME 再调用；生产环境改用 $DSH_HOME 也能立即生效。
 *
 * 文件形状：
 *   {
 *     "version": 1,
 *     "projects": {
 *       "<规范化的小写项目根>": ["<绝对路径，正斜杠，无尾斜杠>", ...]
 *     }
 *   }
 *
 * 约束：
 *  - 原子写：先写 <file>.tmp-<random>，再 rename 覆盖；rename 在 Windows 上同样覆盖已存在文件。
 *  - 并发写：进程内单条 Promise 链串行化，避免 read-modify-write 互相覆盖。
 *  - 读取健壮：文件不存在 → 空配置；JSON 损坏 → 备份为 roots.json.broken-<ts> 后从空配置开始，
 *    只告警、绝不抛异常。
 */
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'

import { normalizeSlashes } from './git.js'

export const CONFIG_VERSION = 1

const IS_WINDOWS = process.platform === 'win32'
const CONFIG_DIR_NAME = 'dsh-git-panel'
const CONFIG_FILE_NAME = 'roots.json'

/* ------------------------------------------------------------------ 路径 */

/** 解析 DSH 主目录（调用时解析，$DSH_HOME 空白视作未设置）。 */
function dshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.trim() !== '') {
    return path.resolve(configured.trim())
  }
  return path.join(homedir(), '.dsh')
}

/** 配置文件的绝对路径（每次调用时重新计算）。 */
export function configPath() {
  return path.join(dshHome(), CONFIG_DIR_NAME, CONFIG_FILE_NAME)
}

/**
 * 项目根的配置键：绝对路径 → 正斜杠 → Windows 上再小写。
 * 只用于对象键的比较，不用于展示。
 */
export function projectKey(projectRoot) {
  if (typeof projectRoot !== 'string' || projectRoot.trim() === '') {
    throw new TypeError('projectKey: 项目根必须是非空字符串')
  }
  const normalized = normalizeSlashes(path.resolve(projectRoot.trim()))
  return IS_WINDOWS ? normalized.toLowerCase() : normalized
}

/** 入库前规范化一个目录：绝对路径 + 正斜杠 + 去尾斜杠（保留用户原本的大小写）。 */
function normalizeDirPath(dir) {
  if (typeof dir !== 'string' || dir.trim() === '') {
    throw new TypeError('外部仓库路径必须是非空字符串')
  }
  return normalizeSlashes(path.resolve(dir.trim()))
}

/* ------------------------------------------------------------------ 日志 */

/** 允许调用方注入 ctx.logger；没有就用 console.warn（绝不因为日志失败而抛）。 */
function warn(options, message) {
  const text = `dsh-git-panel: ${message}`
  const logger = options?.logger
  try {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(text)
      return
    }
  } catch {
    /* ignore */
  }
  try {
    console.warn(text)
  } catch {
    /* ignore */
  }
}

function describe(error) {
  if (error instanceof Error) return error.message || error.name
  return String(error)
}

/* ------------------------------------------------------------------ 读写 */

function emptyConfig() {
  return { version: CONFIG_VERSION, projects: {} }
}

/** 把任意解析结果收敛成合法形状；不认识的东西直接丢弃。 */
function normalizeConfig(parsed) {
  const config = emptyConfig()
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return config
  const projects = parsed.projects
  if (!projects || typeof projects !== 'object' || Array.isArray(projects)) return config

  for (const [rawKey, rawList] of Object.entries(projects)) {
    if (!Array.isArray(rawList)) continue
    let key
    try {
      key = projectKey(rawKey)
    } catch {
      continue
    }
    const seen = new Set()
    const values = []
    for (const item of rawList) {
      if (typeof item !== 'string' || item.trim() === '') continue
      let normalized
      let itemKey
      try {
        normalized = normalizeDirPath(item)
        itemKey = projectKey(normalized)
      } catch {
        continue
      }
      if (seen.has(itemKey)) continue
      seen.add(itemKey)
      values.push(normalized)
    }
    config.projects[key] = values
  }
  return config
}

/** 时间戳用于备份文件名：2026-10-29T05-27-04-123Z */
function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/** 损坏文件挪走存档，绝不删除。 */
async function quarantine(file, options, cause) {
  const backup = `${file}.broken-${timestamp()}`
  try {
    await rename(file, backup)
    warn(options, `配置文件已损坏，已备份到 ${backup}（${describe(cause)}）`)
  } catch (error) {
    warn(options, `配置文件已损坏且备份失败（${describe(cause)}；备份错误：${describe(error)}）`)
  }
}

/**
 * 读取配置。
 * @param {{logger?: object}} [options]
 * @returns {Promise<{version: number, projects: Record<string, string[]>}>}
 */
export async function readConfig(options = {}) {
  const file = configPath()

  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') warn(options, `读取配置文件失败（${file}）：${describe(error)}`)
    return emptyConfig()
  }

  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('配置根节点必须是 JSON 对象')
    }
    return normalizeConfig(parsed)
  } catch (error) {
    await quarantine(file, options, error)
    return emptyConfig()
  }
}

/** 原子写：临时文件 + rename。失败时清理临时文件并把错误抛给调用方。 */
async function writeConfig(config, options = {}) {
  const file = configPath()
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp-${randomBytes(6).toString('hex')}`
  const payload = `${JSON.stringify(config, null, 2)}\n`
  try {
    await writeFile(temp, payload, 'utf8')
    await rename(temp, file)
  } catch (error) {
    try {
      await unlink(temp)
    } catch {
      /* ignore */
    }
    throw error
  }
  return file
}

/* ------------------------------------------------------------ 写入串行化 */

let writeChain = Promise.resolve()

/**
 * 把 read-modify-write 放进同一条 Promise 链：并发请求按调用顺序执行，
 * 前一个失败不会丢掉后一个。
 */
function serialize(task) {
  const result = writeChain.then(task, task)
  writeChain = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

/* -------------------------------------------------------------- 对外 API */

/** 某个项目已持久化的外部仓库根（副本）。 */
export async function listExtras(projectRoot, options = {}) {
  const key = projectKey(projectRoot)
  const config = await readConfig(options)
  const list = config.projects[key]
  return Array.isArray(list) ? list.slice() : []
}

/**
 * 追加一个外部仓库根；已存在（按规范化路径比较，Windows 忽略大小写）则不重复写。
 * @returns {Promise<string[]>} 该项目的完整外部根列表
 */
export async function addExtra(projectRoot, dir, options = {}) {
  const key = projectKey(projectRoot)
  const normalized = normalizeDirPath(dir)
  const itemKey = projectKey(normalized)

  return serialize(async () => {
    const config = await readConfig(options)
    const list = Array.isArray(config.projects[key]) ? config.projects[key] : (config.projects[key] = [])
    const exists = list.some((entry) => {
      try {
        return projectKey(entry) === itemKey
      } catch {
        return false
      }
    })
    if (!exists) {
      list.push(normalized)
      await writeConfig(config, options)
    }
    return config.projects[key].slice()
  })
}

/**
 * 移除一个外部仓库根；不存在时保持原样（幂等，不写盘）。
 * @returns {Promise<string[]>} 该项目的完整外部根列表
 */
export async function removeExtra(projectRoot, dir, options = {}) {
  const key = projectKey(projectRoot)
  const itemKey = projectKey(dir)

  return serialize(async () => {
    const config = await readConfig(options)
    const list = Array.isArray(config.projects[key]) ? config.projects[key] : []
    const next = list.filter((entry) => {
      try {
        return projectKey(entry) !== itemKey
      } catch {
        return true
      }
    })
    if (next.length !== list.length) {
      config.projects[key] = next
      await writeConfig(config, options)
    }
    return next.slice()
  })
}
