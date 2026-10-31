/**
 * test/client.test.mjs —— 客户端产物冒烟测试（不需要浏览器）
 *
 * 做的事情：
 *  1. 在假的 `window.__ModuleLoader__` 环境里装载 plugin/client.js；
 *  2. 用假的 react（支持 useState/useEffect/useMemo/useRef/useCallback/useLayoutEffect）
 *     和假的 ctx（locale / sidebarRightTabs / sidebarRight / slots / shortcuts / connection）
 *     调用 `apply(ctx)`；
 *  3. 断言注册契约：loader id、exports、tab 类型 id/kind/guide、body 槽 key、字典 ns、
 *     快捷键 resolve、样式只注入一次且不含字面量色值；
 *  4. 把注册进去的 tab body 组件真渲染一遍（单次渲染，不跑 effect），确认组件树能出来、
 *     没有在缺 props 时崩掉。
 *
 * 运行：node test/client.test.mjs   （需要先 node build/build-client.mjs）
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = path.resolve(HERE, '..')
const BUNDLE_PATH = path.join(PLUGIN_DIR, 'client.js')

let passed = 0
const failures = []

function test(name, fn) {
  try {
    fn()
    passed += 1
    console.log('  ok   ' + name)
  } catch (error) {
    failures.push({ name, error })
    console.log('  FAIL ' + name + '\n       ' + (error && error.message ? error.message : error))
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'assertion failed')
}

function eq(actual, expected, message) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error((message ?? 'eq') + ': expected ' + b + ', got ' + a)
}

/* ------------------------------------------------------------------ */
/* 假 react：单遍渲染 + hooks                                           */
/* ------------------------------------------------------------------ */

function createFakeReact() {
  let frame = null

  function createElement(type, props, ...children) {
    const flat = children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false && child !== true)
    return { $$el: true, type, props: props ?? {}, children: flat }
  }

  function Fragment(props) {
    return { $$el: true, type: '#fragment', props: {}, children: props && props.children ? [].concat(props.children) : [] }
  }

  function hook(slot) {
    if (frame === null) throw new Error('hook 在组件外被调用')
    const index = frame.cursor
    frame.cursor += 1
    if (frame.slots.length <= index) frame.slots[index] = slot()
    return [frame.slots[index], index]
  }

  function useState(initial) {
    const [value, index] = hook(() => (typeof initial === 'function' ? initial() : initial))
    const setter = (next) => {
      frame.slots[index] = typeof next === 'function' ? next(frame.slots[index]) : next
    }
    return [value, setter]
  }

  function useRef(initial) {
    const [value] = hook(() => ({ current: initial }))
    return value
  }

  function useMemo(factory, deps) {
    const [value] = hook(() => ({ value: factory(), deps }))
    return value.value
  }

  function useCallback(fn) {
    const [value] = hook(() => fn)
    return value
  }

  function useEffect(effect) {
    hook(() => effect)
    // 单遍渲染不执行 effect，避免测试里发起真实异步
  }

  function render(node) {
    if (node === null || node === undefined || node === false || node === true) return null
    if (Array.isArray(node)) return node.map(render).filter((child) => child !== null)
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (node.$$el !== true) return null
    if (typeof node.type === 'function') {
      const previous = frame
      frame = { slots: [], cursor: 0 }
      try {
        const result = node.type({ ...node.props, children: node.children })
        return render(result)
      } finally {
        frame = previous
      }
    }
    return {
      $$host: true,
      type: node.type,
      props: node.props,
      children: node.children.map(render).filter((child) => child !== null)
    }
  }

  return {
    createElement,
    Fragment,
    useState,
    useRef,
    useMemo,
    useCallback,
    useEffect,
    useLayoutEffect: useEffect,
    render
  }
}

function collect(node, predicate, out = []) {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) {
    for (const child of node) collect(child, predicate, out)
    return out
  }
  if (typeof node === 'string') {
    if (predicate(node)) out.push(node)
    return out
  }
  if (node.$$host === true) {
    if (predicate(node)) out.push(node)
    for (const child of node.children) collect(child, predicate, out)
  }
  return out
}

function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node.$$host === true) return node.children.map(textOf).join('')
  return ''
}

function classOf(node) {
  const value = node && node.props ? node.props.className : undefined
  return typeof value === 'string' ? value : ''
}

/* ------------------------------------------------------------------ */
/* 假 DOM / 假 ctx                                                     */
/* ------------------------------------------------------------------ */

function createFakeDocument() {
  const appended = []
  const headChildren = []
  return {
    appended,
    head: {
      appendChild(node) {
        headChildren.push(node)
        appended.push(node)
        node.parentNode = this
        return node
      },
      removeChild(node) {
        const index = headChildren.indexOf(node)
        if (index !== -1) headChildren.splice(index, 1)
        return node
      },
      get children() {
        return headChildren
      }
    },
    visibilityState: 'visible',
    hasFocus: () => true,
    getElementById(id) {
      return headChildren.find((node) => node.id === id) ?? null
    },
    createElement(tag) {
      return { tagName: String(tag).toUpperCase(), id: '', textContent: '', parentNode: null }
    },
    addEventListener() {},
    removeEventListener() {},
    body: { style: {}, setAttribute() {}, removeAttribute() {}, hasAttribute: () => false }
  }
}

function createFakeCtx(registrations) {
  const ctx = {
    _effectLabels: [],
    locale: {
      register(namespace, dictionaries) {
        registrations.dictionaries.push({ namespace, dictionaries })
        return () => {}
      },
      bind(namespace) {
        registrations.bound.push(namespace)
        return (key) => 'T:' + key
      }
    },
    sidebarRightTabs: {
      register(definition) {
        registrations.tabTypes.push(definition)
        return () => {}
      }
    },
    sidebarRight: {
      commandTarget() {
        return { sessionId: 'session-1' }
      },
      openTabFromTarget(kind, target) {
        registrations.openedTabs.push({ kind, target })
      },
      openTabIn(sessionId, kind, options) {
        registrations.openedTabs.push({ sessionId, kind, options })
      }
    },
    shortcuts: {
      register(definition) {
        registrations.shortcuts.push(definition)
        return () => {}
      }
    },
    uiConversation: {
      binding(sessionId) {
        return {
          activate(viewId) {
            registrations.activatedViews.push({ sessionId, viewId })
          }
        }
      }
    },
    layout: {
      selectPanel(id) {
        registrations.panels.push(id)
      },
      panelInfo: {
        getSnapshot: () => ({ activePanelId: 'conversation' }),
        subscribe: () => () => {}
      }
    },
    slots: {
      inject(name, factory) {
        registrations.slotInjects.push(name)
        return factory()
      },
      register(registration, component) {
        registrations.slots.push({ registration, component })
        return () => {}
      }
    },
    connection: {
      rpc: {
        call(channel, endpoint, payload) {
          registrations.rpcCalls.push({ channel, endpoint, payload })
          return Promise.resolve({ ok: true, value: { projectRoot: '/p', roots: [] } })
        },
        handle() {
          return () => {}
        }
      }
    },
    effect(fn, label) {
      ctx._effectLabels.push(label ?? '(anonymous)')
      const disposer = fn()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    inject(deps, callback) {
      registrations.injects.push({ deps, ran: true })
      return callback(ctx)
    },
    get(name) {
      return ctx[name] ?? undefined
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} }
  }
  return ctx
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

const fakeReact = createFakeReact()
let bundle
try {
  bundle = await readFile(BUNDLE_PATH, 'utf8')
} catch {
  console.error('client.js 不存在，请先运行： node build/build-client.mjs')
  process.exit(1)
}

const registrations = {
  dictionaries: [],
  bound: [],
  tabTypes: [],
  shortcuts: [],
  slots: [],
  slotInjects: [],
  openedTabs: [],
  rpcCalls: [],
  panels: [],
  activatedViews: [],
  injects: []
}

const fakeDocument = createFakeDocument()
let factory = null
const fakeWindow = {
  __ModuleLoader__: {
    load(definition) {
      assert(factory === null, '__ModuleLoader__.load 被调用了两次')
      factory = definition.factory
      registrations.loaderId = definition.id
    }
  },
  addEventListener() {},
  removeEventListener() {},
  innerWidth: 1280,
  innerHeight: 800,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval
}

const fakeRequire = (id) => {
  if (id === 'react') return fakeReact
  throw new Error('missed the module table: ' + id)
}

const ctx = createFakeCtx(registrations)

console.log('client bundle: ' + (bundle.length / 1024).toFixed(1) + ' KB')

// 在假全局里执行产物
const loader = new Function('window', 'document', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'require', 'localStorage',
  'return (function(){ ' + bundle + ' })()')
loader(fakeWindow, fakeDocument, setTimeout, clearTimeout, setInterval, clearInterval, fakeRequire, undefined)

test('产物注册了 __ModuleLoader__ 定义', () => {
  assert(typeof factory === 'function', 'factory 未注册')
  eq(registrations.loaderId, 'dsh-git-panel', 'loader id')
})

let exportsObject = null
test('工厂执行并返回模块导出', () => {
  exportsObject = factory(fakeRequire)
  assert(exportsObject !== null && typeof exportsObject === 'object', '导出不是对象')
})

test('导出 name / apply / inject', () => {
  eq(exportsObject.name, 'dsh-git-panel', 'name')
  eq(typeof exportsObject.apply, 'function', 'apply 是函数')
  assert(Array.isArray(exportsObject.inject), 'inject 是数组')
  eq(exportsObject.inject, ['slots', 'locale', 'connection', 'sidebarRightTabs', 'sidebarRight'], 'inject 清单')
})

test('执行 apply(ctx) 不抛错', () => {
  exportsObject.apply(ctx)
})

test('字典注册了同一个 namespace', () => {
  assert(registrations.dictionaries.length >= 1, '没有注册字典')
  const first = registrations.dictionaries[0]
  assert(first.namespace === 'dshGitPanel', 'ns 不是 dshGitPanel，实际 ' + first.namespace)
  assert(first.dictionaries.zh && first.dictionaries.en, '缺少 zh/en')
  const zhKeys = Object.keys(first.dictionaries.zh)
  const enKeys = Object.keys(first.dictionaries.en)
  assert(zhKeys.length > 50, 'zh 字典太小：' + zhKeys.length)
  eq(zhKeys.length, enKeys.length, 'zh/en key 数量应一致')
  const missing = zhKeys.filter((key) => !enKeys.includes(key))
  assert(missing.length === 0, 'en 缺少 key: ' + missing.slice(0, 5).join(', '))
  eq(registrations.bound[0], 'dshGitPanel', 'bind 的 ns')
})

test('tab 类型 id/kind/priority 正确', () => {
  assert(registrations.tabTypes.length === 1, 'tab 类型注册次数应为 1，实际 ' + registrations.tabTypes.length)
  const definition = registrations.tabTypes[0]
  eq(definition.id, 'dsh-git-panel', 'id')
  eq(definition.kind, 'git', 'kind')
  eq(definition.priority, 'extension', 'priority')
  eq(typeof definition.title, 'function', 'title 是函数')
  assert(typeof definition.title({}) === 'string' && definition.title({}) !== '', 'title 返回空串')
})

test('guide 条目带 id / 标题 / 描述 / 图标组件', () => {
  const definition = registrations.tabTypes[0]
  assert(Array.isArray(definition.guide) && definition.guide.length === 1, 'guide 数量不对')
  const entry = definition.guide[0]
  eq(typeof entry.title, 'function', 'guide.title 是函数')
  eq(typeof entry.description, 'function', 'guide.description 是函数')
  eq(typeof entry.icon, 'function', 'guide.icon 是组件')
  assert(typeof entry.id === 'string' && entry.id !== '', 'guide.id')
  assert(typeof entry.order === 'number', 'guide.order 是数字')
  eq(entry.commandId, undefined, '没有快捷键后不该再挂 commandId')
})

test('body 槽的 key 等于 tab 类型 id（不是 kind）', () => {
  const body = registrations.slots.find((slot) => slot.registration.name === 'sidebar.right.pane.tab')
  assert(body !== undefined, '没有注册 tab body')
  eq(body.registration.key, registrations.tabTypes[0].id, 'body key 必须等于 tab 类型的 id')
  eq(body.registration.locale, 'dshGitPanel', 'body locale')
  eq(typeof body.component, 'function', 'body 是组件')
})

test('样式只注入一次且用令牌取色', () => {
  const styles = fakeDocument.appended.filter((node) => node.tagName === 'STYLE')
  eq(styles.length, 1, '样式注入次数')
  const css = styles[0].textContent
  assert(css.length > 5000, '样式太短：' + css.length)
  const open = (css.match(/\{/g) ?? []).length
  const close = (css.match(/\}/g) ?? []).length
  eq(open, close, '花括号不平衡')
  assert(!css.includes('!important'), '不应使用 !important')
  const hexColors = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
  eq(hexColors, [], '不应出现字面量色值')
  assert(css.includes('var(--dsw-alias-'), '应使用 DSH 设计令牌')
  assert(css.includes('.dgp-root'), '缺少根类')
  assert(!css.includes('.dgp-root {\n  background'), '面板根不应自绘背景')
})

test('样式表是合法 CSS：没有会吞掉下一条规则的裸文本行', () => {
  // 曾经踩过的坑：样式表里混进一行「# 见文件末…」，浏览器把紧随其后的整条规则
  // 当作错误恢复吞掉，于是 .dgp-state 的居中样式从来没有生效过（现象：空态贴左上角）。
  const css = fakeDocument.appended.filter((node) => node.tagName === 'STYLE')[0].textContent
  // 去掉注释与引号内内容（content: "−" 这类是合法的非 ASCII）
  const stripped = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"[^"\n]*"/g, '""')
    .replace(/'[^'\n]*'/g, "''")

  // 1) 不使用 ID 选择器，所以裸的 # 行只可能是混进来的文本
  const hashLines = stripped.split('\n').filter((line) => line.trim().startsWith('#'))
  eq(hashLines, [], '样式表里出现了裸 # 行：' + hashLines.join(' | '))

  // 2) 注释和字符串之外全是 ASCII；出现非 ASCII 说明有说明文字漏在规则外面
  const nonAscii = stripped.split('\n').filter((line) => /[^\x00-\x7F]/.test(line))
  eq(nonAscii, [], '注释之外出现了非 ASCII 文本：' + nonAscii.slice(0, 3).join(' | '))

  // 3) 每条规则都必须有声明体：`选择器` 后面直接跟 `}` 或文件尾 = 规则被吃掉了
  const orphan = stripped.split('}').filter((chunk) => {
    const text = chunk.trim()
    if (text === '') return false
    return !text.includes('{')
  })
  eq(orphan, [], '有规则丢了声明体：' + orphan.slice(0, 2).join(' | '))
})

test('渲染 tab body：组件树能出来', () => {
  const body = registrations.slots.find((slot) => slot.registration.name === 'sidebar.right.pane.tab')
  const props = {
    sessionId: 'session-1',
    t: (key) => 'T:' + key,
    useSessions: (selector) => selector({ byId: { 'session-1': { cwd: 'C:/work/project' } } }),
    useTabInfo: () => ({ tab: { id: 't1', kind: 'git', signal: { aborted: false }, actions: {} } }),
    renderSlot: () => null
  }
  const tree = fakeReact.render(fakeReact.createElement(body.component, props))
  assert(tree !== null, '渲染结果是 null')
  const roots = collect(tree, (node) => node.$$host === true && classOf(node).split(' ').includes('dgp-root'))
  eq(roots.length, 1, '应有且只有一个 .dgp-root')
  const toolbars = collect(tree, (node) => node.$$host === true && classOf(node).split(' ').includes('dgp-toolbar'))
  eq(toolbars.length, 1, '应有一个 .dgp-toolbar')
  const filters = collect(tree, (node) => node.$$host === true && classOf(node).split(' ').includes('dgp-filter'))
  eq(filters.length, 1, '应有一个 .dgp-filter')
  const segs = collect(tree, (node) => node.$$host === true && classOf(node).split(' ').includes('dgp-seg'))
  assert(segs.length >= 1, '应有模式切换')
  const buttons = collect(tree, (node) => node.$$host === true && node.type === 'button')
  assert(buttons.length >= 3, '按钮太少：' + buttons.length)
})



test('只注册会话侧栏入口：不再注册 main / sidebar.panellist / 快捷键', () => {
  const names = registrations.slots.map((slot) => slot.registration.name)
  eq(names.includes('main'), false, '不应再注册 main 面板')
  eq(names.includes('sidebar.panellist'), false, '不应再注册左侧导航区条目')
  eq(names.includes('conversation.view'), false, '不应再注册顶部会话视图')
  eq(registrations.shortcuts.length, 0, '快捷键已移除（focus 不能开新 tab）')
})

test('会话标题栏按钮：注册在 conversation.session.header.utilities（最右侧）', () => {
  const entry = registrations.slots.find((slot) => slot.registration.name === 'conversation.session.header.utilities')
  assert(entry !== undefined, '没有注册标题栏按钮')
  eq(entry.registration.id, 'git-changes', 'header action id')
  eq(entry.registration.locale, 'dshGitPanel', 'header action locale')
  assert(typeof entry.registration.order === 'number', 'order 应是数字')
  eq(typeof entry.component, 'function', 'header action 是组件')
  eq(typeof entry.registration.inject, 'function', 'inject 应提供 openPanel')
  const injected = entry.registration.inject()
  eq(typeof injected.openPanel, 'function', 'openPanel 是函数')
})

test('会话标题栏按钮：点击打开当前会话的 git 页签', () => {
  const entry = registrations.slots.find((slot) => slot.registration.name === 'conversation.session.header.utilities')
  const injected = entry.registration.inject()
  const tree = fakeReact.render(fakeReact.createElement(entry.component, {
    sessionId: 'session-1',
    t: (key) => 'T:' + key,
    openPanel: injected.openPanel
  }))
  assert(tree !== null && tree.$$host === true, '按钮渲染异常')
  eq(tree.type, 'button', '应是 button')
  eq(tree.props['data-dgp-header'], 'git', 'data-dgp-header')
  assert(textOf(tree).includes('T:header.label'), '应显示文案，实际 ' + textOf(tree))
  eq(collect(tree, (node) => node.$$host === true && node.type === 'svg').length, 1, '应有一个 svg 图标')
  assert(typeof tree.props.onClick === 'function', '缺少 onClick')
  tree.props.onClick()
  eq(registrations.openedTabs, [{ sessionId: 'session-1', kind: 'git', options: undefined }], '点击应打开 git 页签')
})

test('样式表定义了标题栏按钮的类', () => {
  const styles = fakeDocument.appended.filter((node) => node.tagName === 'STYLE')
  assert(styles[0].textContent.includes('.dgp-headerbtn'), '缺少 .dgp-headerbtn 样式')
})
console.log('')
if (failures.length > 0) {
  console.error(failures.length + ' failed, ' + passed + ' passed')
  for (const failure of failures) {
    console.error(' - ' + failure.name + ': ' + (failure.error && failure.error.stack ? failure.error.stack : failure.error))
  }
  process.exit(1)
}
console.log(passed + ' passed')