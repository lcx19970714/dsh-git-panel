/**
 * scripts/install-profile.mjs —— 把本插件装进某个 DSH profile（开发用，免 pnpm/免发布）
 *
 * 做的事（幂等，可反复执行）：
 *   1. 校验 client.js / index.js 存在（**宁可不装也不要装半个包**，否则 Web 壳可能起不来）；
 *   2. 备份 profile 的 package.json；
 *   3. 在 profile package.json 的 dependencies 里加 `"dsh-git-panel": "link:<插件绝对路径>"`；
 *   4. 在 dsh.profile.bundles 里追加载入项 "dsh-git-panel"；
 *   5. 在 profile 的 node_modules 下建 junction（Windows）或 symlink，指向本插件目录；
 *   6. 打印校验结果与后续步骤。
 *
 * 用法：
 *   node scripts/install-profile.mjs                # 装到默认 profile（desktop）
 *   node scripts/install-profile.mjs --profile C:\Users\me\.dsh\profiles\other
 *   node scripts/install-profile.mjs --dry-run      # 只看会改什么
 *   node scripts/install-profile.mjs --uninstall    # 卸载（移除 junction / 依赖 / bundles 项）
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync, copyFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = path.resolve(HERE, '..')
const PACKAGE_NAME = 'dsh-git-panel'
const PACKAGE_JSON = JSON.parse(readFileSync(path.join(PLUGIN_DIR, 'package.json'), 'utf8'))

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const uninstall = args.includes('--uninstall')
const profileIndex = args.indexOf('--profile')
const profileDir = profileIndex !== -1
  ? path.resolve(args[profileIndex + 1])
  : path.join(os.homedir(), '.dsh', 'profiles', 'desktop')

const toForward = (p) => p.replace(/\\/g, '/')

function fail(message) {
  console.error('✗ ' + message)
  process.exit(1)
}

function info(message) {
  console.log('  ' + message)
}

/* --------------------------------- 预检 --------------------------------- */
if (!existsSync(profileDir)) fail('找不到 profile 目录: ' + profileDir)
const profilePackageJsonPath = path.join(profileDir, 'package.json')
if (!existsSync(profilePackageJsonPath)) fail('找不到 profile package.json: ' + profilePackageJsonPath)

const requiredFiles = ['index.js', 'client.js', 'cordis.patch.yml', 'host/git.js']
if (!uninstall) {
  for (const file of requiredFiles) {
    const abs = path.join(PLUGIN_DIR, file)
    if (!existsSync(abs)) fail('缺少必需文件 ' + file + '（先跑 node build/build-client.mjs）')
  }
  const clientSize = readFileSync(path.join(PLUGIN_DIR, 'client.js'), 'utf8').length
  if (clientSize < 20_000) fail('client.js 只有 ' + clientSize + ' 字节，看起来不是完整产物')
}

console.log('插件目录   : ' + PLUGIN_DIR)
console.log('profile    : ' + profileDir)
console.log('模式       : ' + (uninstall ? '卸载' : '安装') + (dryRun ? '（dry run）' : ''))
console.log('')

/* ------------------------------ package.json ------------------------------ */
const raw = readFileSync(profilePackageJsonPath, 'utf8')
let manifest
try {
  manifest = JSON.parse(raw)
} catch (error) {
  fail('profile package.json 不是合法 JSON: ' + error.message)
}

const linkSpec = 'link:' + toForward(PLUGIN_DIR)
const bundlesPath = () => {
  manifest.dsh = manifest.dsh ?? {}
  manifest.dsh.profile = manifest.dsh.profile ?? {}
  manifest.dsh.profile.bundles = Array.isArray(manifest.dsh.profile.bundles) ? manifest.dsh.profile.bundles : []
  return manifest.dsh.profile.bundles
}

if (uninstall) {
  if (manifest.dependencies) delete manifest.dependencies[PACKAGE_NAME]
  const bundles = bundlesPath()
  const index = bundles.indexOf(PACKAGE_NAME)
  if (index !== -1) bundles.splice(index, 1)
} else {
  manifest.dependencies = manifest.dependencies ?? {}
  const previous = manifest.dependencies[PACKAGE_NAME]
  manifest.dependencies[PACKAGE_NAME] = linkSpec
  if (previous !== undefined && previous !== linkSpec) info('依赖已存在，改为 link: 指向本目录（原值 ' + previous + '）')
  const bundles = bundlesPath()
  if (!bundles.includes(PACKAGE_NAME)) bundles.push(PACKAGE_NAME)
}

const nextRaw = JSON.stringify(manifest, null, 2) + '\n'
const manifestChanged = nextRaw !== raw

/* -------------------------------- junction -------------------------------- */
const linkPath = path.join(profileDir, 'node_modules', PACKAGE_NAME)
let linkAction = 'none'
let existingIsOurs = false
if (existsSync(linkPath) || (() => { try { lstatSync(linkPath); return true } catch { return false } })()) {
  try {
    const stat = lstatSync(linkPath)
    if (stat.isSymbolicLink()) {
      let target = ''
      try {
        target = readlinkSync(linkPath)
      } catch {
        target = ''
      }
      target = path.resolve(path.dirname(linkPath), target)
      existingIsOurs = path.resolve(target) === path.resolve(PLUGIN_DIR)
    } else {
      fail(linkPath + ' 已存在且不是链接/目录联接 —— 为避免误删真实文件，请手工处理后再运行')
    }
  } catch (error) {
    if (String(error && error.message).includes('请手工处理')) throw error
  }
}

if (uninstall) {
  if (existingIsOurs) linkAction = 'remove'
} else if (!existingIsOurs) {
  linkAction = 'create'
}

/* -------------------------------- 执行 --------------------------------- */
if (dryRun) {
  console.log('将执行：')
  if (manifestChanged) info('改写 profile package.json（dependencies 与 dsh.profile.bundles）')
  else info('package.json 无需改动')
  if (linkAction === 'create') info('创建链接 ' + linkPath + ' -> ' + PLUGIN_DIR)
  if (linkAction === 'remove') info('删除链接 ' + linkPath)
  if (linkAction === 'none') info('链接已就绪，无需改动')
  process.exit(0)
}

if (manifestChanged) {
  const backupPath = profilePackageJsonPath + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-')
  copyFileSync(profilePackageJsonPath, backupPath)
  writeFileSync(profilePackageJsonPath, nextRaw, 'utf8')
  info('已备份到 ' + path.basename(backupPath))
  info('已更新 package.json')
} else {
  info('package.json 无需改动')
}

if (linkAction === 'create') {
  mkdirSync(path.dirname(linkPath), { recursive: true })
  try {
    // Windows 用目录联接（不需要管理员权限）；POSIX 用普通符号链接。
    symlinkSync(PLUGIN_DIR, linkPath, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    fail('创建目录链接失败: ' + error.message)
  }
  info('已创建 ' + linkPath)
} else if (linkAction === 'remove') {
  try {
    if (lstatSync(linkPath).isSymbolicLink()) unlinkSync(linkPath)
    else rmSync(linkPath, { recursive: true, force: true })
  } catch (error) {
    fail('删除链接失败: ' + error.message)
  }
  info('已删除 ' + linkPath)
} else {
  info('链接已就绪，无需改动')
}

/* -------------------------------- 校验 --------------------------------- */
console.log('')
console.log('校验：')
const checkPackage = path.join(linkPath, 'package.json')
if (uninstall) {
  info('已卸载。重启 DSH 桌面端后生效。')
  process.exit(0)
}
if (!existsSync(checkPackage)) fail('链接目录里读不到 package.json，安装不完整')

const linked = JSON.parse(readFileSync(checkPackage, 'utf8'))
info('node_modules/' + PACKAGE_NAME + ' → name=' + linked.name + ' version=' + linked.version)
info('client 入口 exports["./client"] = ' + (linked.exports && linked.exports['./client']))
if (!existsSync(path.join(linkPath, linked.exports['./client']))) {
  fail('exports["./client"] 指向的文件不存在 —— 这种情况可能导致 Web 壳启动失败，已中止')
}
info('client 产物存在: ' + Math.round(readFileSync(path.join(linkPath, linked.exports['./client'])).length / 1024) + ' KB')
info('bundles 列表包含: ' + (bundlesPath().includes(PACKAGE_NAME) ? '是' : '否'))
info('bundles 顺序: ' + bundlesPath().join(', '))

console.log('')
console.log('下一步：')
console.log('  1) 让 profile 重新组合以加载新插件（二选一）：')
console.log('     · 重启 DSH 桌面端；或')
console.log('     · 设置 → 插件 页把任意一个插件关掉再打开（会触发 profile 热重组）')
console.log('  2) 在任意会话按 Ctrl+Alt+G，或右侧栏「+」里选「Git 变更」')
console.log('  3) 之后只改 client.js 不需要重启：宿主会 stat 轮询并热替换（约 1s）')
