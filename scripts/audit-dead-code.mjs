/**
 * scripts/audit-dead-code.mjs —— 死代码体检（零依赖，CI 会跑）
 *
 * 三件事，任何一条不过就以非 0 退出：
 *  1. src/、host/ 下的每个文件都必须能被入口直接或间接 import 到；
 *  2. 不许有「导出了但没人 import」的符号（内部用到的就别 export）；
 *  3. styles.js 里定义的每个 .dgp-* 类都必须在 src/ 的代码里出现过。
 *
 * 用法：node scripts/audit-dead-code.mjs
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ENTRY_FILES = ['index.js', 'src/index.js']
const SCAN_DIRS = ['src', 'host']
const TOOL_DIRS = ['scripts', 'build']

function listFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) listFiles(file, out)
    else if (/\.(mjs|js)$/.test(entry.name)) out.push(file.split(path.sep).join('/'))
  }
  return out
}

const files = [...ENTRY_FILES, ...SCAN_DIRS.flatMap((dir) => listFiles(dir)), ...TOOL_DIRS.flatMap((dir) => listFiles(dir))]
const source = new Map()
for (const file of files) source.set(file, readFileSync(file, 'utf8'))

const IMPORT_PATTERN = /from\s+'(\.[^']+)'/g

/** 解析相对 import，返回真实存在的文件（允许省略 .js）。 */
function resolveImport(fromFile, spec) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec))
  for (const candidate of [base, base + '.js', base + '.mjs']) {
    if (source.has(candidate)) return candidate
  }
  return null
}

const problems = []

/* ---------------- 1. 可达性 ---------------- */
const reachable = new Set()
const queue = [...ENTRY_FILES]
while (queue.length > 0) {
  const file = queue.pop()
  if (reachable.has(file)) continue
  reachable.add(file)
  for (const match of source.get(file).matchAll(IMPORT_PATTERN)) {
    const target = resolveImport(file, match[1])
    if (target !== null) queue.push(target)
  }
}
for (const file of files) {
  if (file.startsWith('scripts/') || file.startsWith('build/')) continue
  if (!reachable.has(file)) problems.push('没有任何入口引用这个文件: ' + file)
}

/* ---------------- 2. 未被使用的导出 ---------------- */
for (const [file, text] of source) {
  if (file.startsWith('scripts/') || file.startsWith('build/')) continue
  for (const match of text.matchAll(/export (?:async )?(?:function|class|const|let)\s+([A-Za-z_$][\w$]*)/g)) {
    const name = match[1]
    let imported = false
    for (const [other, otherText] of source) {
      if (other === file) continue
      // 只有真的 import 了它才算用到；仅仅同名出现在别处（比如注释）不算
      const used = new RegExp('import\\s*\\{[^}]*\\b' + name + '\\b[^}]*\\}\\s*from').test(otherText)
        || new RegExp('import\\s+\\*\\s+as\\s+\\w+\\s+from[^\\n]*\\n').test(otherText)
      if (used) {
        imported = true
        break
      }
    }
    if (!imported) problems.push('导出了但没人 import: ' + file + ' → ' + name)
  }
}

/* ---------------- 3. 孤儿 CSS 类 ---------------- */
const { CSS } = await import('../src/styles.js')
const defined = new Set()
for (const match of CSS.matchAll(/\.(dgp-[a-z0-9-]+)/g)) defined.add(match[1])
const used = new Set()
for (const [file, text] of source) {
  if (!file.startsWith('src/')) continue
  for (const match of text.matchAll(/['"`]([^'"`\n]*)['"`]/g)) {
    for (const token of match[1].split(/\s+/)) if (/^dgp-[a-z0-9-]+$/.test(token)) used.add(token)
  }
}
for (const name of [...defined].sort()) {
  if (!used.has(name)) problems.push('样式里定义了但代码没用: .' + name)
}

/* ---------------- 结论 ---------------- */
if (problems.length === 0) {
  console.log('死代码体检通过：' + files.length + ' 个文件、' + defined.size + ' 个样式类')
  process.exit(0)
}
console.error('死代码体检未通过（' + problems.length + ' 项）：')
for (const problem of problems) console.error('  - ' + problem)
process.exit(1)
