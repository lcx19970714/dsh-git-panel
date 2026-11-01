/**
 * src/util/remote.js —— 远端地址 → 可打开的网页地址
 *
 * 面板上的「打开 Git 仓库」按钮需要把 `git remote get-url origin` 的原始形式
 * 转成浏览器能开的 https 地址。支持的形式：
 *
 *   git@github.com:owner/repo.git          → https://github.com/owner/repo
 *   ssh://git@host:22/owner/repo.git       → https://host/owner/repo
 *   https://host/owner/repo.git            → https://host/owner/repo
 *   http://host/owner/repo                 → http://host/owner/repo
 *   git://host/owner/repo.git              → https://host/owner/repo
 *
 * 本地路径（`C:\\repos\\x`、`/home/me/x`、`file://…`）没有网页可开，返回 null ——
 * 调用方据此把按钮禁用，而不是弹一个必然失败的窗口。
 */

/** 去掉尾部斜杠与 `.git` 后缀。 */
function normalizeWebPath(value) {
  const cleaned = value.replace(/\/+$/, '').replace(/\.git$/, '').replace(/\/+$/, '')
  return cleaned === '' ? null : cleaned
}

/**
 * @param {string|null|undefined} remoteUrl `git config --get remote.origin.url` 的原始值
 * @returns {string|null} 可在浏览器打开的地址；无法转换时为 null
 */
export function webUrlOf(remoteUrl) {
  if (typeof remoteUrl !== 'string') return null
  const raw = remoteUrl.trim()
  if (raw === '') return null

  // scp 形式：user@host:path（注意本地 Windows 路径不含 @，不会走到这里）
  const scp = /^[^@/\s]+@([^:/\s]+):(.+)$/.exec(raw)
  if (scp !== null) return normalizeWebPath(`https://${scp[1]}/${scp[2].replace(/^\/+/, '')}`)

  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    // 丢掉 userinfo 与查询串：不要把凭据带进浏览器地址栏
    return normalizeWebPath(`${url.protocol}//${url.host}${url.pathname}`)
  }
  if (url.protocol === 'ssh:' || url.protocol === 'git:') {
    const pathname = url.pathname.replace(/^\/+/, '')
    return pathname === '' ? null : normalizeWebPath(`https://${url.hostname}/${pathname}`)
  }
  return null
}
