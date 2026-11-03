/**
 * host/plugin-meta.js —— 插件自身版本与更新检查
 *
 * 只做一件事：把当前安装版本与 GitHub 最新 release 比较。
 * 与「git fetch 看代码是否最新」完全无关，两者不再共用一个按钮。
 */
import { readFileSync } from 'node:fs'

import { GitError } from './git.js'

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

/** 当前安装的插件信息（本地读，不联网）。 */
export function pluginInfo() {
  const url = typeof PACKAGE.repository === 'string'
    ? PACKAGE.repository
    : (PACKAGE.repository?.url ?? '')
  const match = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(url)
  return {
    name: typeof PACKAGE.name === 'string' ? PACKAGE.name : '',
    version: typeof PACKAGE.version === 'string' ? PACKAGE.version : '',
    repositoryUrl: url,
    fullName: match === null ? null : match[1] + '/' + match[2]
  }
}

/** 版本比较：只比数字段，预发布后缀（-beta.1）忽略。 */
export function compareVersions(left, right) {
  const parse = (value) => String(value).split('-')[0].split('.').map((part) => {
    const number = Number.parseInt(part, 10)
    return Number.isFinite(number) ? number : 0
  })
  const a = parse(left)
  const b = parse(right)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index += 1) {
    const x = a[index] ?? 0
    const y = b[index] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

/**
 * 查最新 release 并与当前版本比较。
 *
 * 任何失败都明确抛出：把「查不到」当成「已是最新」是错的。
 */
export async function checkPluginUpdate(options = {}) {
  const info = pluginInfo()
  if (info.fullName === null) {
    throw new GitError('update-check-failed', 'package.json 里没有 GitHub 仓库地址，无法检查插件更新')
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new GitError('update-check-failed', '当前运行环境没有 fetch，无法检查插件更新')
  }
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : 15000
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const forward = () => controller.abort()
  const signal = options.signal
  if (signal !== undefined) signal.addEventListener('abort', forward, { once: true })

  try {
    const url = 'https://api.github.com/repos/' + info.fullName + '/releases/latest'
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': info.name, Accept: 'application/vnd.github+json' },
      signal: controller.signal
    })
    if (response.ok !== true) {
      throw new GitError('update-check-failed', 'HTTP ' + response.status + '：检查插件更新失败'
        + (response.status === 403 ? '（GitHub 未登录的请求有频率限制，稍后再试）' : ''))
    }
    const body = await response.json()
    const tag = typeof body.tag_name === 'string' ? body.tag_name.replace(/^v/i, '') : ''
    if (tag === '') throw new GitError('update-check-failed', 'GitHub 返回的 release 没有 tag_name')
    return {
      currentVersion: info.version,
      latestVersion: tag,
      url: typeof body.html_url === 'string' ? body.html_url : '',
      publishedAt: typeof body.published_at === 'string' ? body.published_at : '',
      newer: compareVersions(tag, info.version) > 0
    }
  } catch (error) {
    if (timedOut) throw new GitError('update-check-failed', '检查插件更新超时（' + Math.round(timeoutMs / 1000) + ' 秒）')
    if (error instanceof GitError) throw error
    throw new GitError('update-check-failed', '检查插件更新失败：' + (error instanceof Error ? error.message : String(error)))
  } finally {
    clearTimeout(timer)
    if (signal !== undefined) signal.removeEventListener('abort', forward)
  }
}
