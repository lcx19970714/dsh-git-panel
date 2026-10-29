/**
 * 构造一个覆盖各种 git 状态的沙盒仓库，用于解析器测试。
 * 用法：node test/make-fixture.mjs <targetDir>
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync, unlinkSync, existsSync } from 'node:fs'
import path from 'node:path'

const target = process.argv[2]
if (!target) {
  console.error('usage: node test/make-fixture.mjs <targetDir>')
  process.exit(1)
}

if (existsSync(target)) rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })

const git = (...args) => execFileSync('git', args, { cwd: target, stdio: 'pipe' }).toString()
const write = (rel, content) => {
  const abs = path.join(target, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

git('init', '-q', '-b', 'main')
git('config', 'user.email', 'test@example.com')
git('config', 'user.name', 'Test User')
git('config', 'core.autocrlf', 'false')

// 基线提交
write('README.md', '# Fixture\n\nhello\n')
write('src/app.js', 'export function main() {\n  return 1\n}\n')
write('src/util.ts', 'export const a = 1\nexport const b = 2\n')
write('src/will-delete.txt', 'bye\n')
write('src/will-rename.txt', 'rename me\ncontent stays\n')
write('docs/guide.md', '# Guide\nline2\nline3\nline4\nline5\n')
write('assets/logo.bin', Buffer.from([0x00, 0x01, 0x02, 0x03, 0x00, 0xff]))
git('add', '-A')
git('commit', '-q', '-m', 'initial')

// 1) 未暂存修改
write('src/app.js', 'export function main() {\n  return 42\n}\n\nexport const extra = true\n')
// 2) 已暂存修改
write('src/util.ts', 'export const a = 1\nexport const b = 2\nexport const c = 3\n')
git('add', 'src/util.ts')
// 3) 已暂存 + 再修改（同一文件 staged 与 unstaged 同时存在）
write('docs/guide.md', '# Guide\nline2 CHANGED\nline3\nline4\nline5\n')
git('add', 'docs/guide.md')
write('docs/guide.md', '# Guide\nline2 CHANGED\nline3\nline4\nline5\nline6 added later\n')
// 4) 删除（未暂存）
unlinkSync(path.join(target, 'src/will-delete.txt'))
// 5) 重命名（已暂存，git mv 只动索引与工作区）
mkdirSync(path.join(target, 'src/renamed'), { recursive: true })
git('mv', 'src/will-rename.txt', 'src/renamed/renamed.txt')
// 6) 未跟踪
write('notes/todo.md', '- buy milk\n- ship it\n')
write('中文目录/说明.md', '# 中文内容\n第二行\n')
// 7) 二进制改动（未暂存）
write('assets/logo.bin', Buffer.from([0x00, 0x09, 0x09, 0x00, 0xee]))
// 8) CRLF 文件（未跟踪）
write('src/crlf.txt', 'line one\r\nline two\r\n')
// 9) 空文件（未跟踪）
write('src/empty.txt', '')
// 10) 子目录里的独立仓库（用于多仓库发现测试）
const nested = path.join(target, 'packages', 'sub-repo')
mkdirSync(nested, { recursive: true })
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: nested })
execFileSync('git', ['config', 'user.email', 't@e.com'], { cwd: nested })
execFileSync('git', ['config', 'user.name', 'T'], { cwd: nested })
writeFileSync(path.join(nested, 'index.js'), 'console.log(1)\n')
execFileSync('git', ['add', '-A'], { cwd: nested })
execFileSync('git', ['commit', '-q', '-m', 'nested initial'], { cwd: nested })
writeFileSync(path.join(nested, 'index.js'), 'console.log(2)\n')

// 11) 一个普通文件目录
write('misc/readme.txt', 'not a repo\n')

console.log('fixture ready at ' + target)
console.log(execFileSync('git', ['status', '--short'], { cwd: target, stdio: 'pipe' }).toString())
