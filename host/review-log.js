/**
 * host/review-log.js —— 深度审阅的分步日志
 *
 * 每一次深度审阅都会：
 *  - 把带时间戳的步骤写进 ~/.dsh/dsh-git-panel/review.log（追加）
 *  - 同时通过宿主 logger 输出（DSH 自己的日志里也能看到）
 *  - 把步骤数组回传给界面，结果里能直接看到每一步做了什么、耗时、是否失败
 *
 * 日志写入失败不影响审阅本身，但会在步骤里标记 warn。
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function dshHomeDir() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.trim() !== '') return path.resolve(configured.trim())
  return path.join(os.homedir(), '.dsh')
}

export function reviewLogPath() {
  return path.join(dshHomeDir(), 'dsh-git-panel', 'review.log')
}

/**
 * @param {{ logger?: {info?: Function, warn?: Function} }} deps
 * @param {string} title 这次审阅的标题（仓库 #PR）
 */
export function createReviewLog(deps, title) {
  const logger = deps === null || deps === undefined ? null : deps.logger ?? null
  const file = reviewLogPath()
  const steps = []
  const startedAt = Date.now()
  let writeFailed = false

  const write = (level, step, detail) => {
    const elapsed = Date.now() - startedAt
    const line = new Date().toISOString() + ' ' + level + ' +' + elapsed + 'ms [' + title + '] '
      + step + (detail === undefined || detail === null || detail === '' ? '' : ' · ' + detail)
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      appendFileSync(file, line + '\n', 'utf8')
    } catch (error) {
      writeFailed = true
      // 日志写不进去不能反过来搞挂审阅，但要把它作为一条 warn 步骤带出去
      steps.push({ at: elapsed, level: 'warn', step: '日志写入失败', detail: error instanceof Error ? error.message : String(error) })
    }
    try {
      if (level === 'error') logger?.warn?.(line)
      else if (level === 'warn') logger?.warn?.(line)
      else logger?.info?.(line)
    } catch {
      // DSH logger 异常同样不能影响审阅
    }
  }

  const add = (level) => (step, detail) => {
    const elapsed = Date.now() - startedAt
    steps.push({ at: elapsed, level, step, detail: detail === undefined || detail === null ? '' : String(detail) })
    write(level, step, detail)
  }

  return {
    steps,
    file,
    logPath: file,
    info: add('info'),
    warn: add('warn'),
    error: add('error'),
    /** 一次操作的耗时摘要，例如 fetch 用了多少毫秒 */
    async time(step, detail, action) {
      const began = Date.now()
      try {
        const result = await action()
        add('info')(step, (detail === undefined || detail === null || detail === '' ? '' : detail + '，')
          + '耗时 ' + (Date.now() - began) + 'ms')
        return result
      } catch (error) {
        add('error')(step + '失败', (error instanceof Error ? error.message : String(error)))
        throw error
      }
    },
    get writeFailed() {
      return writeFailed
    }
  }
}
