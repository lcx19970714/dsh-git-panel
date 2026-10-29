/**
 * scripts/verify-live.mjs —— 检查运行中的 DSH 到底有没有把这个插件加载起来
 *
 * 用法：
 *   node scripts/verify-live.mjs                 # 默认 127.0.0.1:49259
 *   node scripts/verify-live.mjs --port 49260
 *
 * 它做三件事（都不需要登录态）：
 *   1. 读公开的 SSE `/plugins/events`，确认插件出现在客户端 bundle 表里、rev 与磁盘一致；
 *   2. 探测插件自有 RPC 通道 `/dsh-git/<endpoint>`：
 *        405 → 宿主半体还没被组合进去（需要重启/重组合 profile）
 *        401 → 通道已注册、只是没登录态 —— 这才说明宿主插件跑起来了
 *   3. 打印结论与下一步。
 */
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = path.resolve(HERE, '..')
const PACKAGE_NAME = 'dsh-git-panel'
const CHANNEL_PREFIX = '/dsh-git'

const args = process.argv.slice(2)
const argValue = (flag, fallback) => {
  const index = args.indexOf(flag)
  return index === -1 ? fallback : args[index + 1] ?? fallback
}
const port = argValue('--port', '49259')
const baseUrl = (argValue('--url', `http://127.0.0.1:${port}`)).replace(/\/+$/, '')

const ok = (message) => console.log('  ✓ ' + message)
const bad = (message) => console.log('  ✗ ' + message)
const info = (message) => console.log('    ' + message)

async function readGraph() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    const res = await fetch(`${baseUrl}/plugins/events`, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal
    })
    if (!res.ok) throw new Error('GET /plugins/events -> ' + res.status)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      if (buffer.includes('\n\n')) break
    }
    reader.cancel().catch(() => {})
    const dataLine = buffer.split('\n').find((line) => line.startsWith('data:'))
    if (dataLine === undefined) throw new Error('SSE 里没有 data 行')
    return JSON.parse(dataLine.slice(5).trim()).graph
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 与 @deepseek-ai/dsh-client-modules 相同的产物版本算法：
 *   rev = sha1("plugin-artifact\0" + framed([mtimeMs, ctimeMs, size])).slice(0,12)
 * 注意：它是 **文件元数据** 的哈希，不是内容哈希（内容一变 mtime/size 就变，因此等价可用）。
 */
function revOf(stat) {
  const hash = createHash('sha1').update('plugin-artifact').update('\0')
  for (const part of [String(stat.mtimeMs), String(stat.ctimeMs), String(stat.size)]) {
    hash.update(String(Buffer.byteLength(part)) + ':').update(part)
  }
  return hash.digest('hex').slice(0, 12)
}

async function probeChannel() {
  const body = JSON.stringify({
    type: 'client-request',
    rpcId: 'verify-live',
    method: 'invoke',
    endpoint: 'project/resolve',
    payload: { cwd: PLUGIN_DIR }
  })
  const res = await fetch(`${baseUrl}${CHANNEL_PREFIX}/project/resolve`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body
  }).catch((error) => ({ status: 0, statusText: String(error && error.message), text: async () => '' }))
  return { status: res.status, statusText: res.statusText }
}

console.log('base   ' + baseUrl)
console.log('plugin ' + PLUGIN_DIR)
console.log('')

let graph = null
try {
  graph = await readGraph()
  ok(`SSE 可读：graph rev=${graph.rev} 共 ${graph.entries.length} 个客户端 bundle`)
} catch (error) {
  bad('读不到 /plugins/events：' + (error && error.message))
  info('DSH 桌面端/Web 服务可能没在跑，或端口不对')
  process.exit(1)
}

const entry = graph.entries.find((item) => item.id === PACKAGE_NAME)
if (entry === undefined) {
  bad(`客户端 bundle 表里没有 ${PACKAGE_NAME}`)
  info('检查 profile package.json 的 dsh.profile.bundles 是否包含它，以及 node_modules 链接是否存在')
  process.exit(1)
}
ok(`客户端 bundle 已在表里：rev=${entry.rev} immediately=${entry.immediately === true}`)

const diskStat = await stat(path.join(PLUGIN_DIR, 'client.js')).catch(() => null)
if (diskStat === null) {
  bad('磁盘上没有 client.js（先跑 node build/build-client.mjs）')
} else {
  const diskRev = revOf(diskStat)
  if (diskRev === entry.rev) ok('运行中的 client bundle 与磁盘一致（热更新已生效）')
  else {
    bad(`rev 不一致：磁盘 ${diskRev} ≠ 运行中 ${entry.rev}`)
    info('宿主每 500ms 轮询一次，等 1-2 秒再跑本脚本；仍然不一致就说明热更新没生效')
  }
}

const channel = await probeChannel()
console.log('')
console.log('RPC 通道 ' + CHANNEL_PREFIX)
if (channel.status === 401 || channel.status === 403) {
  ok(`通道已注册（HTTP ${channel.status} = 只是没带登录态），宿主半体是活的`)
} else if (channel.status === 405 || channel.status === 404) {
  bad(`通道不存在（HTTP ${channel.status}）—— 宿主半体还没被组合进去`)
  info('解决：重启 DSH 桌面端；或在 设置 → 插件 页做一次「关掉再打开」触发 profile 重组')
  info('（客户端 bundle 会在启动时自动加载，但仍需要宿主半体注册 RPC 通道才能取数据）')
} else if (channel.status === 0) {
  bad('请求失败：' + channel.statusText)
} else {
  bad('意外的状态码：HTTP ' + channel.status + ' ' + channel.statusText)
}

console.log('')
console.log('结论')
if (entry !== undefined && (channel.status === 401 || channel.status === 403)) {
  console.log('  ✅ 插件已经完整加载。打开方式：顶部/左侧面板列表里的「Git 变更」，或 Ctrl+Alt+G')
} else {
  console.log('  ⏳ 客户端已在表里，但宿主还没加载 —— 需要重启 DSH 桌面端（或让 profile 真正重新组合）')
}
