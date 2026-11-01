/**
 * build/build-client.mjs —— 零依赖的微型打包器
 *
 * 背景：本机没有 esbuild，而 DSH 的客户端插件必须是「经典脚本」（不能是 ESM），
 * 又要保持 src/ 下多文件模块化的可维护性。于是这里做一个只服务本项目 source style
 * 的极小打包器：把 src/ 下的 ESM 模块图打包成
 *
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ...模块表 + loader... } })
 *
 * 支持的语法（超出范围就报错，绝不静默产出坏包）：
 *   import def from './x.js'
 *   import { a, b as c } from './x.js'
 *   import * as ns from './x.js'
 *   import './x.js'
 *   export function f / export async function f / export class C
 *   export const/let/var x = ...
 *   export default <expr>
 *   export { a, b as c }            （不支持 `export * from`、`export {a} from`）
 *   import react, { useState } from 'react'   （唯一外部模块）
 *
 * 用法：
 *   node build/build-client.mjs           # 产出 client.js
 *   node build/build-client.mjs --check   # 只做语法/模块图校验，不写文件
 *   node build/build-client.mjs --stats   # 额外打印体积明细
 */
import { readFile, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

function argValue(args, flag) {
  const index = args.indexOf(flag)
  return index === -1 ? null : args[index + 1] ?? null
}

const ARGS = process.argv.slice(2)
const SRC = argValue(ARGS, '--src') !== null ? path.resolve(argValue(ARGS, '--src')) : path.join(ROOT, 'src')
const ENTRY = argValue(ARGS, '--entry') !== null ? path.resolve(argValue(ARGS, '--entry')) : path.join(SRC, 'index.js')
const OUTPUT = argValue(ARGS, '--out') !== null ? path.resolve(argValue(ARGS, '--out')) : path.join(ROOT, 'client.js')
export const PLUGIN_ID = 'dsh-git-panel'

const EXTERNALS = new Set(['react'])

class BuildError extends Error {}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

const IMPORT_NAMED = /^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?$/
const IMPORT_STAR = /^import\s*\*\s*as\s*([A-Za-z_$][\w$]*)\s*from\s*['"]([^'"]+)['"];?$/
const IMPORT_DEFAULT = /^import\s+([A-Za-z_$][\w$]*)\s*from\s*['"]([^'"]+)['"];?$/
const IMPORT_BARE = /^import\s*['"]([^'"]+)['"];?$/
const IMPORT_MIXED = /^import\s+([A-Za-z_$][\w$]*)\s*,\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?$/
const EXPORT_FN = /^export\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/
const EXPORT_CLASS = /^export\s+class\s+([A-Za-z_$][\w$]*)/
const EXPORT_VAR = /^export\s+(const|let|var)\s+([A-Za-z_$][\w$]*)/
const EXPORT_LIST = /^export\s*\{([^}]*)\}\s*;?$/
const EXPORT_DEFAULT = /^export\s+default\s+/
// export default function f(){} / export default class C{} / 匿名形式
const EXPORT_DEFAULT_FN_NAMED = /^export\s+default\s+(async\s+)?function\s+([A-Za-z_$][\w$]*)/
const EXPORT_DEFAULT_FN_ANON = /^export\s+default\s+(async\s+)?function\s*\(/
const EXPORT_DEFAULT_CLASS_NAMED = /^export\s+default\s+class\s+([A-Za-z_$][\w$]*)/
const EXPORT_DEFAULT_CLASS_ANON = /^export\s+default\s+class\s*\{/

function splitSpecifiers(raw) {
  return raw.split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
    const match = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(part)
    if (!match) throw new BuildError(`无法解析 import 说明符: ${part}`)
    return { imported: match[1], local: match[2] ?? match[1] }
  })
}

/** 把一个源文件翻译成模块体，返回 { body, deps }。deps 是解析后的模块 id 列表。 */
function transformModule(id, source, resolveId) {
  const lines = source.split('\n')
  const deps = new Set()
  const exportNames = new Set()
  const out = []
  let pendingDefault = null
  let sawExportList = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()
    const location = `${id}:${index + 1}`

    if (trimmed === '') { out.push(line); continue }

    // ---- import ----
    if (trimmed.startsWith('import ')) {
      let match = IMPORT_MIXED.exec(trimmed)
      if (match) {
        const [, def, named, spec] = match
        checkSpecifier(spec, location)
        deps.add(resolveId(spec))
        out.push(`const __mod_${def} = __m(${JSON.stringify(resolveId(spec))});`)
        out.push(`const ${def} = __mod_${def}.default;`)
        for (const { imported, local } of splitSpecifiers(named)) {
          out.push(`const ${local} = __mod_${def}[${JSON.stringify(imported)}];`)
        }
        continue
      }
      match = IMPORT_NAMED.exec(trimmed)
      if (match) {
        const [, named, spec] = match
        checkSpecifier(spec, location)
        deps.add(resolveId(spec))
        const fields = splitSpecifiers(named)
        out.push(`const { ${fields.map((f) => (f.imported === f.local ? f.local : `${f.imported}: ${f.local}`)).join(', ')} } = __m(${JSON.stringify(resolveId(spec))});`)
        continue
      }
      match = IMPORT_STAR.exec(trimmed)
      if (match) {
        const [, ns, spec] = match
        checkSpecifier(spec, location)
        deps.add(resolveId(spec))
        out.push(`const ${ns} = __m(${JSON.stringify(resolveId(spec))});`)
        continue
      }
      match = IMPORT_DEFAULT.exec(trimmed)
      if (match) {
        const [, def, spec] = match
        checkSpecifier(spec, location)
        deps.add(resolveId(spec))
        out.push(`const ${def} = __m(${JSON.stringify(resolveId(spec))}).default;`)
        continue
      }
      match = IMPORT_BARE.exec(trimmed)
      if (match) {
        checkSpecifier(match[1], location)
        deps.add(resolveId(match[1]))
        out.push(`__m(${JSON.stringify(resolveId(match[1]))});`)
        continue
      }
      throw new BuildError(`${location}: 不支持的 import 写法: ${trimmed}`)
    }

    // ---- export ----
    if (trimmed.startsWith('export ')) {
      let match = EXPORT_LIST.exec(trimmed)
      if (match) {
        sawExportList = true
        for (const { imported, local } of splitSpecifiers(match[1])) exportNames.add(`${local}: ${imported}`)
        continue
      }
      match = EXPORT_FN.exec(trimmed)
      if (match) {
        const name = match[2]
        exportNames.add(name)
        out.push(line.replace(/^(\s*)export\s+/, '$1'))
        continue
      }
      match = EXPORT_CLASS.exec(trimmed)
      if (match) {
        const name = match[1]
        exportNames.add(name)
        out.push(line.replace(/^(\s*)export\s+/, '$1'))
        continue
      }
      match = EXPORT_VAR.exec(trimmed)
      if (match) {
        const name = match[2]
        exportNames.add(name)
        out.push(line.replace(/^(\s*)export\s+/, '$1'))
        continue
      }
      if (EXPORT_DEFAULT.test(trimmed)) {
        // 具名函数/类声明：去掉 `export default `，默认导出指向该名字（不能包括号，body 跨行）
        let match = EXPORT_DEFAULT_FN_NAMED.exec(trimmed)
        if (match) {
          out.push(line.replace(/^(\s*)export\s+default\s+/, '$1'))
          pendingDefault = match[2]
          exportNames.add(`default: ${match[2]}`)
          continue
        }
        match = EXPORT_DEFAULT_CLASS_NAMED.exec(trimmed)
        if (match) {
          out.push(line.replace(/^(\s*)export\s+default\s+/, '$1'))
          pendingDefault = match[1]
          exportNames.add(`default: ${match[1]}`)
          continue
        }
        // 匿名函数/类：补一个内部名字
        if (EXPORT_DEFAULT_FN_ANON.test(trimmed) || EXPORT_DEFAULT_CLASS_ANON.test(trimmed)) {
          out.push(line.replace(/^(\s*)export\s+default\s+/, '$1__default '))
          pendingDefault = '__default'
          exportNames.add('default: __default')
          continue
        }
        // 表达式形式（必须整条在同一行）
        const rest = trimmed.replace(EXPORT_DEFAULT, '')
        if (rest === '') {
          const next = lines[index + 1]
          if (next === undefined) throw new BuildError(`${location}: export default 后缺少表达式`)
          out.push(`const __default = (${next.trim().replace(/;$/, '')});`)
          pendingDefault = '__default'
          exportNames.add('default: __default')
          index += 1
        } else {
          out.push(`const __default = (${rest.replace(/;$/, '')});`)
          pendingDefault = '__default'
          exportNames.add('default: __default')
        }
        continue
      }
      throw new BuildError(`${location}: 不支持的 export 写法: ${trimmed}`)
    }

    out.push(line)
  }

  if (pendingDefault !== null) exportNames.add(`default: ${pendingDefault}`)
  if (exportNames.size === 0 && !sawExportList && deps.size === 0 && !source.includes('export')) {
    // 纯工具文件（无导出）也允许，但通常是写错了；给个提示
  }

  const assign = exportNames.size > 0
    ? `\nObject.assign(exports, { ${[...exportNames].join(', ')} });\n`
    : ''

  return { body: out.join('\n') + assign, deps: [...deps] }
}

function checkSpecifier(spec, location) {
  if (EXTERNALS.has(spec)) return
  if (!spec.startsWith('./') && !spec.startsWith('../')) {
    throw new BuildError(`${location}: 只允许相对路径或 react，收到 "${spec}"`)
  }
}

// ---------------------------------------------------------------------------
// 模块图
// ---------------------------------------------------------------------------

async function collectModules() {
  const modules = new Map() // absPath -> { id, body, deps }
  const visiting = new Set()

  async function load(absPath, requestedBy) {
    // 注意顺序：visiting 必须在 modules 之前判断。modules.set() 发生在递归依赖之前，
    // 否则 A→B→A 里那个「正在加载中」的 A 会被当成已加载，循环就被静默放过了。
    if (visiting.has(absPath)) {
      throw new BuildError(`检测到循环依赖: ${rel(absPath)}（由 ${rel(requestedBy)} 引入）`)
    }
    if (modules.has(absPath)) return
    visiting.add(absPath)
    let source
    try {
      source = await readFile(absPath, 'utf8')
    } catch {
      throw new BuildError(`找不到模块: ${rel(absPath)}（由 ${rel(requestedBy)} 引入）`)
    }
    // 换行符统一成 LF，再进入 transform/indent。
    // 否则 CRLF 源里的「空行」是 "\r" 而非空串，indent() 会给它补缩进，
    // 产物里就出现行尾空白 + CRLF，CI 用 LF checkout 构建时结果会不一致。
    source = source.replace(/\r\n/g, '\n')
    const id = rel(absPath)
    // 说明符 → 模块 id：'react' 原样保留，其余按「相对当前文件」解析成 SRC 相对 id
    const resolveId = (spec) => (
      spec === 'react' ? 'react' : rel(path.resolve(path.dirname(absPath), spec))
    )
    const { body, deps } = transformModule(id, source, resolveId)
    modules.set(absPath, { id, body, deps })
    for (const dep of deps) {
      if (dep === 'react') continue
      // dep 已经是 SRC 相对 id，拼回绝对路径再递归
      const depAbs = path.resolve(SRC, dep.replace(/^\.\//, ''))
      await load(depAbs, absPath)
    }
    visiting.delete(absPath)
  }

  await load(ENTRY, ENTRY)
  return modules
}

function rel(absPath) {
  return './' + path.relative(SRC, absPath).split(path.sep).join('/')
}

// ---------------------------------------------------------------------------
// 生成
// ---------------------------------------------------------------------------

function renderBundle(modules) {
  const parts = []
  parts.push('/* eslint-disable */')
  parts.push('/* 由 build/build-client.mjs 从 src/ 生成，请勿手工编辑。 */')
  parts.push(`/* 模块: ${modules.size} 个 */`)
  parts.push('window.__ModuleLoader__.load({')
  parts.push(`  id: ${JSON.stringify(PLUGIN_ID)},`)
  parts.push('  factory: (require) => {')
  parts.push('    "use strict";')
  parts.push('    var module = { exports: {} };')
  parts.push('    var exports = module.exports;')
  parts.push('    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });')
  parts.push('    var __factories = {};')
  parts.push('    var __cache = {};')
  parts.push('    function __define(id, factory) { __factories[id] = factory; }')
  parts.push('    function __m(id) {')
  parts.push('      if (Object.prototype.hasOwnProperty.call(__cache, id)) return __cache[id].exports;')
  parts.push('      var factory = __factories[id];')
  parts.push('      if (factory === undefined) throw new Error("dsh-git-panel: unknown module " + id);')
  parts.push('      var mod = { exports: {} };')
  parts.push('      __cache[id] = mod;')
  parts.push('      factory(mod.exports, mod);')
  parts.push('      return mod.exports;')
  parts.push('    }')
  parts.push('    // react 是平台种子模块，由外层 require 提供')
  parts.push('    __define("react", (exports, module) => {')
  parts.push('      var seed = require("react");')
  parts.push('      module.exports = seed;')
  parts.push('      if (seed && seed.default === undefined) {')
  parts.push('        try { Object.defineProperty(seed, "default", { value: seed, enumerable: false, configurable: true }); } catch (e) { /* ignore */ }')
  parts.push('      }')
  parts.push('    });')

  for (const { id, body } of modules.values()) {
    parts.push(`    __define(${JSON.stringify(id)}, (exports, module) => {`)
    parts.push(indent(body, 6))
    parts.push('    });')
  }

  parts.push(`    var api = __m(${JSON.stringify('./index.js')});`)
  parts.push('    // 测试钩子：冒烟测试可借它直接取任意模块（生产运行路径不使用）')
  parts.push('    if (api !== null && typeof api === "object") { try { api.__modules = __m; } catch (e) { /* frozen */ } }')
  parts.push('    return api;')
  parts.push('  }')
  parts.push('});')
  parts.push('')
  return parts.join('\n')
}

function indent(text, spaces) {
  const pad = ' '.repeat(spaces)
  return text.split('\n').map((line) => (line === '' ? '' : pad + line)).join('\n')
}

/** 产物统一成 LF（含末尾换行），保证任何平台构建结果逐字节一致。 */
function normalizeOutput(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n*$/, '\n')
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2)
  const checkOnly = args.includes('--check')
  const showStats = args.includes('--stats')

  const started = Date.now()
  const modules = await collectModules()
  const bundle = renderBundle(modules)

  // 产物必须先通过 Node 自身的语法检查，避免把坏包写出去
  const { execFileSync } = await import('node:child_process')
  const tmp = path.join(path.dirname(OUTPUT), '.client.check.mjs')
  await writeFile(tmp, 'const window = { __ModuleLoader__: { load() {} } };\n' + bundle, 'utf8')
  try {
    execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' })
  } catch (error) {
    throw new BuildError('产物语法检查失败:\n' + String(error.stderr ?? error.message))
  } finally {
    await (await import('node:fs/promises')).unlink(tmp).catch(() => {})
  }

  if (!checkOnly) {
    await writeFile(OUTPUT, normalizeOutput(bundle), 'utf8')
  }

  const bytes = Buffer.byteLength(bundle, 'utf8')
  const target = checkOnly ? '(未写入)' : path.basename(OUTPUT)
  console.log(`${checkOnly ? '[check]' : '[built]'} ${modules.size} modules, ${(bytes / 1024).toFixed(1)} KB, ${Date.now() - started}ms -> ${target}`)
  if (showStats) {
    const rows = [...modules.values()]
      .map(({ id, body }) => ({ id, bytes: Buffer.byteLength(body, 'utf8') }))
      .sort((a, b) => b.bytes - a.bytes)
    for (const row of rows) console.log(`  ${String((row.bytes / 1024).toFixed(1)).padStart(7)} KB  ${row.id}`)
  }
}

main().catch((error) => {
  if (error instanceof BuildError) {
    console.error('build failed: ' + error.message)
  } else {
    console.error(error)
  }
  process.exit(1)
})
