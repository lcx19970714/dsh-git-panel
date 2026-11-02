/**
 * test/panel-flow.test.mjs —— Panel 交互流程测试（自建 reconciler + 脚本化 RPC）
 *
 * 与 client.test.mjs 的区别：
 *   client.test.mjs 是「单遍渲染」冒烟：拿假 react 渲一次，不跑 effect；
 *   这里实现的是一个**真的会重渲染**的迷你 reconciler（hook 状态按位置路径持久化、
 *   setState 排队下一遍、useLayoutEffect/useEffect 按 Object.is 依赖跑/清理、
 *   最多 10 遍后抛「render did not settle」），再把脚本化 RPC 路由接到
 *   `ctx.connection.rpc.call('/api', 'dsh-git/<endpoint>', payload, signal)` 上，端到端驱动 Panel：
 *   挂载 → 解析根 → status → 分组行 → 点选 → diff 载荷 → 切模式 → 刷新 → 切根 → 错误态。
 *
 * 运行：node test/panel-flow.test.mjs   （需要先 node build/build-client.mjs，仓库里已提交产物）
 *
 * ══ 两个已确认的 src 缺陷（本文件不修，只用 xfail 用例钉住）═══════════════════════
 *
 * 缺陷 #1（致命）—— store.js:117-125 / Panel.js:191,203,263,292
 *   `useLatestGuard()` 每次渲染都返回**新的** `{ begin, isLatest }` 对象（store.js:124）；
 *   Panel 的 `refreshStatus = useCallback(..., [statusSeq])`、以及依赖
 *   `[..., refreshStatus]` / `[..., diffSeq]` / `[..., fileSeq]` 的三个 effect 因此
 *   **每次渲染依赖都变**。后果是三重的：
 *     a) status effect 每次渲染都重跑，而它开头就是 `setStatus(null)/setSelection(null)/
 *        setDiff(null)/setFileData(null)` → 刚拿到的数据立刻被清掉。面板永久在
 *        「有内容 → 骨架屏 → 有内容」之间摆动（浏览器里表现为闪烁，且看不到 diff/文件内容）。
 *     b) 每遍渲染都会重新发 status / diff / file 请求；每个响应又触发两遍渲染 → 空闲时
 *        也在无限刷 RPC（实测 20 → 40 → 60 次/空闲轮）。
 *     c) diff/file 请求刚发出就被下一遍的 effect cleanup abort，响应永远到不了
 *        DiffView / FileView。
 *   预期：`useLatestGuard` 返回稳定引用（例如 useMemo），effect 只在真正的输入变化时重跑。
 *   实际：每次渲染都是新引用 → 面板永不收敛。
 *
 * 缺陷 #2 —— Panel.js:175
 *   `refreshStatus` 调 `api.readStatus({ rootPath })` 时**没有传 signal**，所以切根 /
 *   卸载时旧根的 in-flight status 请求不会被 abort，只有 statusSeq 序号守护丢弃迟到响应
 *   （正确性尚可，但 Panel.js 文件头「每次请求带序号守护，切根时 abort 掉旧请求」的约定
 *   没兑现）。预期：status 请求带 AbortSignal 并在切根时 abort；实际：signal 从不 abort。
 *
 * 行号对应 2026-10-29 13:51 构建的 client.js；src 若有并发改动，以锚点文本为准：
 *   }, [statusSeq])、[..., refreshStatus]、[..., diffSeq]、[..., fileSeq]、
 *   wait api.readStatus({ rootPath: root.path })（无 signal）。
 *
 * ══ 缺陷 #1 下的断言策略 ═════════════════════════════════════════════════════════
 * 因为面板每帧都在「有内容 / 骨架屏」之间摆动，任何「等它稳定后断言 DOM」的写法都不可能通过。
 * 所以本文件的 DOM 断言分两种：
 *   · 请求载荷 / 交互行为 → 断言「交互之后新发出的那批请求」（载荷逐字段比对）；
 *   · 渲染结果 → 断言「真正被提交过的那一帧」（reconciler 保留提交帧历史，
 *     等价于浏览器里用 MutationObserver 抓到的画面），见 `panel.changesFrame()`。
 * 而「画面本该稳定」「本该只请求一次」「本该 abort 旧请求」「diff/文件内容本该渲染」这几条
 * 用 xfail 用例显式钉住（跑起来必须失败，缺陷修好后会变成 XPASS → 让套件失败，提醒更新）。
 * RPC 响应一律走宏任务（setImmediate）投递，避免纯微任务风暴把 flush() 饿死；
 * 每个用例结束 unmount() + router.stop()，让后台循环停下。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = path.resolve(HERE, '..')
const BUNDLE_PATH = path.join(PLUGIN_DIR, 'client.js')
const CHANNEL = '/api'
const MAX_FLUSH_TURNS = 10
const MAX_RPC_CALLS = 400
/** 提交帧历史长度：Panel 的缺陷会让它在「有内容」/「骨架屏」之间反复提交，结构断言要看「真正提交过的帧」。 */
const FRAME_HISTORY = 160

/* ================================================================== */
/* 断言 + 收集器                                                       */
/* ================================================================== */

function assert(condition, message) {
  if (!condition) throw new Error(message ?? 'assertion failed')
}

/** 键序无关的稳定序列化（载荷比对要求「字段集合完全一致」，但不关心顺序）。 */
function stable(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function') return '[function]'
    if (typeof value === 'undefined') return '[undefined]'
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}'
}

function eq(actual, expected, message) {
  const a = stable(actual)
  const b = stable(expected)
  if (a !== b) throw new Error((message ?? 'eq') + '\n        期望: ' + b + '\n        实际: ' + a)
}

const cases = []
function test(name, fn) { cases.push({ name, fn, expect: 'pass' }) }
/** 预期失败：仍要「跑」，但允许抛；如果它意外通过，说明缺陷已修，按失败处理。 */
function xfail(name, fn, note) { cases.push({ name, fn, expect: 'fail', note }) }

/* ================================================================== */
/* 迷你 reconciler                                                     */
/* ================================================================== */

/**
 * 实例标识：**位置路径 + 组件类型**。
 *   · 位置路径（'r/0/1!...'）保证「同一个组件在树里出现多次」时各有独立 hook 状态；
 *   · 再拼上组件类型，等价于 React 的 (type, position) 语义：切换模式时同一位置
 *     换成 FileTree（原来是 ChangesList）会重挂载（跑旧实例的 cleanup、状态归零），
 *     不会把 Set 当成 Map 用。
 */
function createReconciler() {
  const instances = new Map()
  const typeIds = new WeakMap()
  let typeSeq = 0

  let rootElement = null
  let lastTree = null
  let rootContainerProps = {}

  let disposed = false
  let dirty = false
  let pumping = false
  let scheduled = false
  let renderError = null
  let passTotal = 0

  let activeInst = null
  let cursor = 0
  let effectQueue = []
  let refQueue = []
  let frameSeq = 0
  const frames = []

  /* ---------------------------- 元素 ---------------------------- */

  function pushChild(out, value) {
    if (value === null || value === undefined || value === false || value === true) return
    if (Array.isArray(value)) {
      for (const item of value) pushChild(out, item)
      return
    }
    out.push(value)
  }

  function createElement(type, props, ...children) {
    const flat = []
    for (const child of children) pushChild(flat, child)
    const source = props ?? {}
    const next = {}
    for (const name of Object.keys(source)) {
      if (name === 'key') continue // key 是 reconciler 的元数据，绝不进 DOM props
      next[name] = source[name]
    }
    return { $$el: true, type, key: source.key, props: next, children: flat }
  }

  /** Fragment：直接把 children 摊平（States.js 用它包 actions）。 */
  function Fragment(props) { return props === undefined ? null : props.children }

  function childrenOf(element) {
    if (element.children.length > 0) return element.children
    const fromProps = element.props.children
    if (fromProps === undefined) return []
    const out = []
    pushChild(out, fromProps)
    return out
  }

  /* ---------------------------- 宿主节点 ---------------------------- */

  function attachDomHelpers(host) {
    // ChangesList/FileTree/DiffView/FileView 会对 ref 指向的节点做这些调用（都带 typeof 保护，
    // 但 PopupMenu 的 useLayoutEffect 会直接调 getBoundingClientRect，所以必须给）。
    host.getBoundingClientRect = () => ({ left: 0, top: 0, right: 320, bottom: 24, width: 320, height: 24 })
    host.focus = () => {}
    host.blur = () => {}
    host.scrollIntoView = () => {}
    host.scrollTo = () => {}
    host.contains = () => false
    host.getAttribute = (name) => (
      Object.prototype.hasOwnProperty.call(host.props, name) && host.props[name] !== undefined
        ? String(host.props[name])
        : null
    )
    host.hasAttribute = (name) => (
      Object.prototype.hasOwnProperty.call(host.props, name) && host.props[name] !== undefined
    )
    host.style = host.props.style !== null && typeof host.props.style === 'object' ? host.props.style : {}
    return host
  }

  /* ---------------------------- hooks ---------------------------- */

  function hookSlot(create) {
    if (activeInst === null) throw new Error('hook 在组件外被调用')
    const inst = activeInst
    const index = cursor
    cursor += 1
    if (inst.slots.length <= index) inst.slots[index] = create()
    return inst.slots[index]
  }

  function useState(initial) {
    const slot = hookSlot(() => {
      const value = typeof initial === 'function' ? initial() : initial
      const state = { kind: 'state', value, setter: null }
      state.setter = (next) => {
        if (disposed) return
        const resolved = typeof next === 'function' ? next(state.value) : next
        if (Object.is(resolved, state.value)) return // React 的 bailout：同值不再渲染
        state.value = resolved
        dirty = true
        schedule()
      }
      return state
    })
    if (slot.kind !== 'state') throw new Error('hook 顺序变了：期望 state')
    return [slot.value, slot.setter]
  }

  function useRef(initial) {
    const slot = hookSlot(() => ({ kind: 'ref', value: { current: initial } }))
    if (slot.kind !== 'ref') throw new Error('hook 顺序变了：期望 ref')
    return slot.value
  }

  function depsChanged(previous, next) {
    if (next === undefined || next === null) return true
    if (!Array.isArray(previous) || previous.length !== next.length) return true
    for (let i = 0; i < next.length; i += 1) {
      if (!Object.is(previous[i], next[i])) return true
    }
    return false
  }

  function useMemo(factory, deps) {
    const slot = hookSlot(() => ({ kind: 'memo', value: undefined, deps: undefined, first: true }))
    if (slot.kind !== 'memo') throw new Error('hook 顺序变了：期望 memo')
    if (slot.first || depsChanged(slot.deps, deps)) {
      slot.value = factory()
      slot.deps = Array.isArray(deps) ? deps.slice() : undefined
      slot.first = false
    }
    return slot.value
  }

  function useCallback(fn, deps) {
    const slot = hookSlot(() => ({ kind: 'callback', value: undefined, deps: undefined, first: true }))
    if (slot.kind !== 'callback') throw new Error('hook 顺序变了：期望 callback')
    if (slot.first || depsChanged(slot.deps, deps)) {
      slot.value = fn
      slot.deps = Array.isArray(deps) ? deps.slice() : undefined
      slot.first = false
    }
    return slot.value
  }

  function useEffectImpl(effect, deps, layout) {
    const inst = activeInst
    if (inst === null) throw new Error('effect 在组件外被调用')
    const index = cursor
    cursor += 1
    let slot = inst.slots[index]
    if (slot === undefined) {
      slot = { kind: 'effect', deps: undefined, first: true, cleanup: undefined, pending: null, layout }
      inst.slots[index] = slot
      inst.effects.push(slot)
    }
    if (slot.kind !== 'effect') throw new Error('hook 顺序变了：期望 effect')
    slot.layout = layout
    const changed = slot.first || depsChanged(slot.deps, deps)
    slot.deps = Array.isArray(deps) ? deps.slice() : undefined
    slot.first = false
    if (changed) {
      slot.pending = effect
      effectQueue.push({ inst, slot })
    }
  }

  function useEffect(effect, deps) { useEffectImpl(effect, deps, false) }
  function useLayoutEffect(effect, deps) { useEffectImpl(effect, deps, true) }

  /* ---------------------------- 渲染 ---------------------------- */

  function typeId(type) {
    if (typeof type !== 'function') return 'h:' + String(type)
    let id = typeIds.get(type)
    if (id === undefined) {
      typeSeq += 1
      id = 'c' + typeSeq
      typeIds.set(type, id)
    }
    return id
  }

  function flattenInto(out, value) {
    if (value === null) return
    if (Array.isArray(value)) {
      for (const item of value) flattenInto(out, item)
      return
    }
    out.push(value)
  }

  function renderNode(node, position) {
    if (node === null || node === undefined || node === false || node === true) return null
    if (typeof node === 'string') return node
    if (typeof node === 'number') return String(node)
    if (Array.isArray(node)) {
      const out = []
      for (let i = 0; i < node.length; i += 1) flattenInto(out, renderNode(node[i], position + '/' + i))
      return out
    }
    if (typeof node !== 'object' || node.$$el !== true) {
      throw new Error('无法渲染的节点: ' + String(node))
    }
    if (node.type === Fragment) {
      const out = []
      const children = childrenOf(node)
      for (let i = 0; i < children.length; i += 1) flattenInto(out, renderNode(children[i], position + '/' + i))
      return out
    }
    if (typeof node.type === 'function') return renderComponent(node, position)
    return renderHost(node, position)
  }

  function renderHost(node, position) {
    const props = {}
    for (const name of Object.keys(node.props)) {
      if (name === 'ref' || name === 'children') continue
      props[name] = node.props[name]
    }
    const host = attachDomHelpers({ $$host: true, type: node.type, props, children: [] })
    const ref = node.props.ref
    if (typeof ref === 'function' || (ref !== null && typeof ref === 'object')) refQueue.push({ ref, node: host })
    const children = childrenOf(node)
    for (let i = 0; i < children.length; i += 1) {
      flattenInto(host.children, renderNode(children[i], position + '/' + i))
    }
    return host
  }

  function renderComponent(node, position) {
    const key = position + '#' + typeId(node.type)
    let inst = instances.get(key)
    if (inst === undefined) {
      inst = { key, type: node.type, slots: [], effects: [] }
      instances.set(key, inst)
    }
    inst.touched = true

    const props = { ...node.props }
    const children = childrenOf(node)
    if (children.length === 1) props.children = children[0]
    else if (children.length > 1) props.children = children.slice()

    const savedInst = activeInst
    const savedCursor = cursor
    activeInst = inst
    cursor = 0
    let output
    try {
      output = node.type(props)
    } finally {
      activeInst = savedInst
      cursor = savedCursor
    }
    return renderNode(output, position + '!')
  }

  /* ---------------------------- 提交 ---------------------------- */

  function runRefs() {
    const queue = refQueue
    refQueue = []
    for (const entry of queue) {
      try {
        if (typeof entry.ref === 'function') entry.ref(entry.node)
        else entry.ref.current = entry.node
      } catch (error) {
        throw new Error('ref 回调抛错: ' + (error && error.message ? error.message : error))
      }
    }
  }

  function cleanupInstance(inst) {
    for (const slot of inst.effects) {
      if (typeof slot.cleanup === 'function') {
        const cleanup = slot.cleanup
        slot.cleanup = undefined
        try {
          cleanup()
        } catch {
          /* 卸载期的 cleanup 错误不掩盖测试结果 */
        }
      }
      slot.pending = null
    }
  }

  function cleanupStale() {
    for (const inst of [...instances.values()]) {
      if (inst.touched === true) continue
      cleanupInstance(inst)
      instances.delete(inst.key)
    }
  }

  function runEffects(layout) {
    const queue = effectQueue
    for (const entry of queue) {
      const slot = entry.slot
      if (slot.layout !== layout) continue
      const effect = slot.pending
      if (typeof effect !== 'function') continue
      slot.pending = null
      if (typeof slot.cleanup === 'function') {
        const cleanup = slot.cleanup
        slot.cleanup = undefined
        cleanup()
      }
      const result = effect()
      slot.cleanup = typeof result === 'function' ? result : undefined
    }
  }

  function commitPass() {
    for (const inst of instances.values()) inst.touched = false
    effectQueue = []
    refQueue = []
    const tree = renderNode(rootElement, 'r')
    lastTree = tree
    cleanupStale()
    runRefs()
    runEffects(true)
    runEffects(false)
    frameSeq += 1
    frames.push({ seq: frameSeq, tree: lastTree })
    if (frames.length > FRAME_HISTORY) frames.shift()
  }

  function pump() {
    if (disposed) return
    pumping = true
    try {
      let passes = 0
      while (dirty && !disposed) {
        dirty = false
        passes += 1
        passTotal += 1
        if (passes > 10) throw new Error('render did not settle（10 遍后仍有 state 变化）')
        commitPass()
      }
    } finally {
      pumping = false
    }
  }

  function schedule() {
    if (disposed || pumping || scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      if (disposed) return
      try {
        pump()
      } catch (error) {
        renderError = renderError ?? error
      }
    })
  }

  function render(tree, containerProps) {
    rootElement = tree
    rootContainerProps = containerProps ?? {}
    disposed = false
    dirty = true
    renderError = null
    try {
      pump()
    } catch (error) {
      renderError = error
      throw error
    }
    return lastTree
  }

  /** flush() 里调用：把微任务里攒下的 dirty 立刻跑掉，并把渲染错误抛给测试。 */
  function flushSync() {
    pump()
    if (renderError !== null) {
      const error = renderError
      renderError = null
      throw error
    }
  }

  function unmount() {
    disposed = true
    dirty = false
    for (const inst of instances.values()) cleanupInstance(inst)
    instances.clear()
    effectQueue = []
    refQueue = []
    lastTree = null
  }

  return {
    createElement,
    Fragment,
    useState,
    useRef,
    useMemo,
    useCallback,
    useEffect,
    useLayoutEffect,
    render,
    unmount,
    flushSync,
    get tree() { return lastTree },
    get frames() { return frames },
    get frameSeq() { return frameSeq },
    get containerProps() { return rootContainerProps },
    get passes() { return passTotal },
    get instanceCount() { return instances.size }
  }
}

/* ================================================================== */
/* 脚本化 RPC 路由                                                     */
/* ================================================================== */

function abortError() {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

/**
 * `on(endpoint, handler)` 注册脚本；handler(payload, record) 返回
 *   · 封套对象（{ok:true,value} / {ok:false,error}）→ 下个宏任务投递（不用微任务，避免把
 *     事件循环饿死：Panel 在 effect 里发请求，microtask 投递会形成纯微任务风暴）；
 *   · Promise → 等它（可用来制造「真正在途」的请求）。
 * hold() 之后所有请求只记录不投递（返回永不 settle 的 Promise），release() 再补投。
 */
function createRouter() {
  const routes = new Map()
  const calls = []
  const held = []
  let seq = 0
  let holding = false
  let stopped = false
  const state = { overflow: false, calls }

  function on(endpoint, handler) {
    routes.set(endpoint, handler)
    return state
  }

  function deliver(endpoint, payload, record, settle) {
    const handler = routes.get(endpoint)
    let produced
    try {
      if (typeof handler !== 'function') {
        throw new Error('测试没有为端点 ' + endpoint + ' 注册脚本（载荷 ' + stable(payload) + '）')
      }
      produced = handler(payload, record)
    } catch (error) {
      settle.fail(error)
      return
    }
    if (produced !== null && typeof produced === 'object' && typeof produced.then === 'function') {
      produced.then((envelope) => settle.finish(envelope), settle.fail)
      return
    }
    setImmediate(() => settle.finish(produced))
  }

  function call(channel, endpoint, payload, signal) {
    if (stopped) return new Promise(() => {})
    seq += 1
    // 客户端走的是 /api + 'dsh-git/<endpoint>'；脚本表按裸 endpoint 编写
    const bare = String(endpoint).replace(/^dsh-git\//, '')
    const record = {
      channel,
      endpoint: bare,
      payload,
      signal,
      seq,
      aborted: false,
      settled: false,
      held: false
    }
    calls.push(record)
    if (calls.length > MAX_RPC_CALLS) {
      state.overflow = true
      return new Promise(() => {}) // 安全阀：绝不让测试进程被请求风暴拖死
    }
    return new Promise((resolve, reject) => {
      let onAbort = null
      const detach = () => {
        if (onAbort !== null && signal && typeof signal.removeEventListener === 'function') {
          signal.removeEventListener('abort', onAbort)
        }
      }
      const settle = {
        finish(envelope) {
          if (record.settled === true || record.aborted === true) return
          record.settled = true
          detach()
          resolve(envelope)
        },
        fail(error) {
          if (record.settled === true || record.aborted === true) return
          record.settled = true
          detach()
          reject(error)
        }
      }
      if (signal && signal.aborted === true) {
        record.aborted = true
        reject(abortError())
        return
      }
      if (signal && typeof signal.addEventListener === 'function') {
        onAbort = () => {
          record.aborted = true
          detach()
          reject(abortError())
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      if (holding) {
        record.held = true
        held.push({ endpoint: record.endpoint, payload, record, settle })
        return
      }
      deliver(record.endpoint, payload, record, settle)
    })
  }

  function hold() {
    holding = true
    return state
  }

  function release() {
    holding = false
    const batch = held.splice(0, held.length)
    for (const entry of batch) {
      entry.record.held = false
      deliver(entry.endpoint, entry.payload, entry.record, entry.settle)
    }
    return state
  }

  function stop() {
    stopped = true
    holding = true
    held.length = 0
  }

  function mark() { return seq }

  function all(endpoint, since) {
    return calls.filter((record) => record.endpoint === endpoint && record.seq > (since ?? 0))
  }

  function count(endpoint, since) { return all(endpoint, since).length }

  function payloads(endpoint, since) { return all(endpoint, since).map((record) => record.payload) }

  state.call = call
  state.on = on
  state.hold = hold
  state.release = release
  state.stop = stop
  state.mark = mark
  state.all = all
  state.count = count
  state.payloads = payloads

  return state
}

/* ================================================================== */
/* 假 DOM / 假 ctx / 装载产物                                          */
/* ================================================================== */

function createFakeDocument() {
  const headChildren = []
  return {
    head: {
      appendChild(node) {
        headChildren.push(node)
        node.parentNode = this
        return node
      },
      removeChild(node) {
        const index = headChildren.indexOf(node)
        if (index !== -1) headChildren.splice(index, 1)
        return node
      },
      get children() { return headChildren }
    },
    visibilityState: 'visible',
    hasFocus: () => true,
    getElementById(id) { return headChildren.find((node) => node.id === id) ?? null },
    createElement(tag) {
      return { tagName: String(tag).toUpperCase(), id: '', textContent: '', parentNode: null }
    },
    addEventListener() {},
    removeEventListener() {},
    body: { style: {}, setAttribute() {}, removeAttribute() {}, hasAttribute: () => false }
  }
}

function createFakeCtx(registrations, router) {
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
      commandTarget() { return { sessionId: 'session-1' } },
      openTabFromTarget(kind, target) { registrations.openedTabs.push({ kind, target }) }
    },
    shortcuts: {
      register(definition) {
        registrations.shortcuts.push(definition)
        return () => {}
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
        call(channel, endpoint, payload, signal) {
          registrations.rpcCalls.push({ channel, endpoint, payload })
          return router.call(channel, endpoint, payload, signal)
        },
        handle() { return () => {} }
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
    get(name) { return ctx[name] ?? undefined },
    logger: { info() {}, warn() {}, error() {}, debug() {} }
  }
  return ctx
}

/** 一个永不触发的计时器：api.js 只用 setTimeout 做超时，不需要它真的到点。 */
function fakeSetTimeout() { return 0 }
function fakeClearTimeout() {}
function fakeSetInterval() { return 0 }
function fakeClearInterval() {}

let BUNDLE = null
try {
  BUNDLE = await readFile(BUNDLE_PATH, 'utf8')
} catch {
  console.error('client.js 不存在，请先运行： node build/build-client.mjs')
  process.exit(1)
}

function loadBundle() {
  let factory = null
  const fakeWindow = {
    __ModuleLoader__: {
      load(definition) {
        if (factory !== null) throw new Error('__ModuleLoader__.load 被调用了两次')
        factory = definition.factory
      }
    },
    addEventListener() {},
    removeEventListener() {},
    /** 「打开 Git 仓库」按钮走 window.open；测试里只记录，不真的开窗 */
    opened: [],
    openReturns: {}, // 置 null 可模拟「弹窗被拦截」
    open(url, target, features) {
      fakeWindow.opened.push({ url, target, features })
      return fakeWindow.openReturns
    },
    innerWidth: 1280,
    innerHeight: 800,
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    setInterval: fakeSetInterval,
    clearInterval: fakeClearInterval
  }
  const fakeDocument = createFakeDocument()
  let fakeReact = null
  const fakeRequire = (id) => {
    if (id === 'react') return fakeReact
    throw new Error('missed the module table: ' + id)
  }
  // 与 client.test.mjs 相同的装载方式：把产物当经典脚本执行，注入假全局。
  const script = new Function(
    'window', 'document', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'require', 'localStorage',
    'return (function(){ ' + BUNDLE + ' })()'
  )
  script(
    fakeWindow,
    fakeDocument,
    fakeSetTimeout,
    fakeClearTimeout,
    fakeSetInterval,
    fakeClearInterval,
    fakeRequire,
    undefined // 没有 localStorage → usePref 用内置默认值
  )
  if (typeof factory !== 'function') throw new Error('产物没有注册模块工厂')
  return {
    /// 每次调用 factory() 都会得到一套全新的模块表（bundle 里的 __cache 在 factory 作用域内），
    /// 因此每个用例都拿到干净的 platform bridge / store 状态。
    create(fakeReactImpl) {
      fakeReact = fakeReactImpl
      return factory(fakeRequire)
    },
    fakeDocument,
    fakeWindow
  }
}

/* ================================================================== */
/* 树查询 / 交互助手                                                   */
/* ================================================================== */

const isHost = (node) => node !== null && typeof node === 'object' && node.$$host === true

function findAll(node, predicate, out = []) {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out)
    return out
  }
  if (!isHost(node)) return out
  if (predicate(node) === true) out.push(node)
  for (const child of node.children) findAll(child, predicate, out)
  return out
}

function findOne(node, predicate) {
  const found = findAll(node, predicate)
  return found.length > 0 ? found[0] : null
}

function textOf(node) {
  if (node === null || node === undefined || node === false || node === true) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isHost(node)) return node.children.map(textOf).join('')
  return ''
}

const attr = (node, name) => (isHost(node) ? node.props[name] : undefined)
const classOf = (node) => (typeof attr(node, 'className') === 'string' ? attr(node, 'className') : '')
const hasClass = (node, name) => classOf(node).split(/\s+/).includes(name)
const byClass = (tree, name) => findAll(tree, (node) => hasClass(node, name))
const oneByClass = (tree, name) => findOne(tree, (node) => hasClass(node, name))
const byAttr = (tree, name, value) => findAll(tree, (node) => (
  value === undefined ? attr(node, name) !== undefined : attr(node, name) === value
))
const byText = (tree, text) => findAll(tree, (node) => textOf(node) === text)

function click(node, extra) {
  assert(isHost(node), 'click 目标不是宿主节点: ' + String(node))
  const handler = node.props.onClick
  assert(typeof handler === 'function', '节点没有 onClick（' + node.type + ' .' + classOf(node) + '）')
  handler({
    preventDefault() {},
    stopPropagation() {},
    button: 0,
    target: node,
    currentTarget: node,
    ...(extra ?? {})
  })
}

function keydown(node, key, extra) {
  const handler = node.props.onKeyDown
  assert(typeof handler === 'function', '节点没有 onKeyDown')
  handler({
    key,
    preventDefault() {},
    stopPropagation() {},
    target: node,
    currentTarget: node,
    ...(extra ?? {})
  })
}

/* ================================================================== */
/* 一套 harness                                                       */
/* ================================================================== */

async function setup(config) {
  const reconciler = createReconciler()
  const loaded = loadBundle()
  const api = loaded.create(reconciler)
  const router = createRouter()
  const registrations = {
    dictionaries: [],
    bound: [],
    tabTypes: [],
    shortcuts: [],
    slots: [],
    slotInjects: [],
    openedTabs: [],
    rpcCalls: [],
    injects: []
  }
  const ctx = createFakeCtx(registrations, router)
  api.apply(ctx)

  const slot = registrations.slots.find((entry) => entry.registration.name === 'sidebar.right.pane.tab')
  assert(slot !== undefined, 'apply() 没有注册 sidebar.right.pane.tab')
  assert(typeof api.__modules === 'function', '产物缺少 __modules 测试钩子')
  const loadModule = (id) => api.__modules(id)
  // 用插件自己的 zh 字典渲染文案（插件不再导出 makeT：t 由宿主 locale 服务注入）
const ZH = loadModule('./i18n.js').zh
const t = (key, params) => {
  const template = Object.prototype.hasOwnProperty.call(ZH, key) ? ZH[key] : key
  if (params === undefined || params === null) return template
  return String(template).replace(/\{(\w+)\}/g, (whole, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole
  ))
}

  // 路由必须在 render 之前装好：Panel 的解析 effect 在首帧就会发 project/resolve。
  for (const [endpoint, handler] of Object.entries(config.routes ?? {})) router.on(endpoint, handler)

  const cwd = config.cwd ?? 'C:/work/project'
  const props = {
    sessionId: 'session-1',
    t,
    useSessions: (selector) => selector({ byId: { 'session-1': { cwd } } }),
    useTabInfo: () => ({ tab: { id: 't', kind: 'git', signal: { aborted: false }, actions: {} } }),
    renderSlot: () => null
  }

  reconciler.render(reconciler.createElement(slot.component, props), {})
  const plugin = {
    api,
    loadModule,
    t,
    router,
    reconciler,
    registrations,
    ctx,
    document: loaded.fakeDocument,
    window: loaded.fakeWindow,
    get tree() { return reconciler.tree },
    get frameSeq() { return reconciler.frameSeq },
    flush(turns) { return flush(reconciler, turns) },
    unmount() {
      router.stop()
      reconciler.unmount()
    },
    /** 落到具体节点上的查询糖（当前帧）。 */
    all(predicate) { return findAll(reconciler.tree, predicate) },
    one(predicate) { return findOne(reconciler.tree, predicate) },
    class(name) { return byClass(reconciler.tree, name) },
    text() { return textOf(reconciler.tree) },
    /** 选中行（data-dgp-path + data-dgp-row=file）。 */
    fileRow(relPath, tree) {
      return findOne(tree ?? reconciler.tree, (node) => (
        isHost(node)
        && node.props['data-dgp-path'] === relPath
        && node.props['data-dgp-row'] === 'file'
      ))
    },
    /* ---- 帧历史：缺陷 #1 让 Panel 在「有内容」/「骨架屏」之间来回提交， ---- */
    /*      结构断言取「真正提交过的那一帧」（等价于浏览器里 MutationObserver 抓画面）。 */
    framesSince(seq) {
      return reconciler.frames.filter((frame) => frame.seq > (seq ?? 0))
    },
    /** 最近一帧满足 predicate(tree) 的树；没有就返回 null。 */
    findFrame(predicate, since) {
      const list = reconciler.frames
      for (let i = list.length - 1; i >= 0; i -= 1) {
        const frame = list[i]
        if (frame.seq <= (since ?? 0)) break
        if (predicate(frame.tree) === true) return frame.tree
      }
      return null
    },
    /** 最近一帧里同时含 changes 行 / diff 行 / 文件行的树。 */
    changesFrame(since) {
      return plugin.findFrame((tree) => byAttr(tree, 'data-dgp-row', 'file').length > 0, since)
    },
    diffFrame(since) {
      return plugin.findFrame((tree) => findAll(tree, (node) => (
        isHost(node) && hasClass(node, 'dgp-diff-row') && attr(node, 'data-kind') !== undefined
      )).length > 0, since)
    },
    /** 编辑器出现（文件模式）的那一帧。 */
    fileFrame(since) {
      return plugin.findFrame((tree) => byClass(tree, 'dgp-editor-input').length > 0, since)
    }
  }
  return plugin
}

async function withPanel(config, body) {
  const panel = await setup(config)
  try {
    await body(panel)
  } finally {
    if (panel.router.overflow === true) {
      console.log('        (提示：本用例触到了 RPC 调用上限 ' + MAX_RPC_CALLS + '，后台请求风暴被截断)')
    }
    panel.unmount()
  }
}

async function flush(reconciler, turns) {
  const total = typeof turns === 'number' ? turns : MAX_FLUSH_TURNS
  for (let turn = 0; turn < total; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve))
    reconciler.flushSync()
  }
}

/* ================================================================== */
/* 夹具                                                                */
/* ================================================================== */

const PROJECT = 'C:/work/project'

const ROOT = {
  id: 'root-1', path: PROJECT, repoRoot: PROJECT, name: 'project',
  kind: 'primary', isGit: true, branch: 'main'
}
const ROOT_OTHER = {
  id: 'root-2', path: 'C:/work/other', repoRoot: 'C:/work/other', name: 'other',
  kind: 'extra', isGit: true, branch: 'dev'
}
const ROOT_PLAIN = {
  id: 'root-3', path: 'C:/work/plain', repoRoot: null, name: 'plain',
  kind: 'primary', isGit: false, branch: null
}

function file(overrides) {
  return {
    status: 'M', staged: false, unstaged: false, untracked: false,
    conflicted: false, adds: 0, dels: 0, binary: false,
    ...overrides
  }
}

/** 3 个文件：仅暂存 / 仅未暂存 / 未跟踪（各占一组，组内只有 1 项 → 直接是文件行）。 */
function statusThree() {
  return {
    repoRoot: PROJECT,
    branch: 'main',
    head: 'abc1234',
    detached: false,
    upstream: 'origin/main',
    ahead: 1,
    behind: 0,
    files: [
      file({ path: 'util.ts', status: 'M', staged: true, adds: 2, dels: 0 }),
      file({ path: 'app.js', status: 'M', unstaged: true, adds: 3, dels: 1 }),
      file({ path: 'notes.txt', status: '?', untracked: true })
    ],
    counts: { total: 3, staged: 1, unstaged: 1, untracked: 1, conflicted: 0 },
    truncated: false
  }
}

/** 多一个 MM 文件（both.js 同时暂存 + 未暂存），用来验证 onSelect(entry, groupKey)。 */
function statusWithBoth() {
  const status = statusThree()
  status.files.splice(1, 0, file({ path: 'both.js', status: 'M', staged: true, unstaged: true, adds: 1, dels: 1 }))
  status.counts = { total: 4, staged: 2, unstaged: 2, untracked: 1, conflicted: 0 }
  return status
}

function diffText() {
  return {
    kind: 'text',
    language: 'javascript',
    stats: { adds: 2, dels: 1 },
    hunks: [{
      header: '@@ -1,3 +1,4 @@',
      section: 'function demo()',
      oldStart: 1,
      oldLines: 3,
      newStart: 1,
      newLines: 4,
      lines: [
        { kind: 'ctx', oldLine: 1, newLine: 1, text: 'const a = 1' },
        { kind: 'del', oldLine: 2, text: 'const b = 2' },
        { kind: 'add', newLine: 2, text: 'const b = 3' },
        { kind: 'add', newLine: 3, text: 'const c = 4' },
        { kind: 'ctx', oldLine: 3, newLine: 4, text: 'return a' }
      ]
    }]
  }
}

function fileText() {
  return {
    kind: 'text',
    text: 'const a = 1\n// note\n\nfunction demo() {\n  return a\n}\n',
    size: 52,
    language: 'javascript',
    eol: 'lf',
    lines: 6
  }
}

function resolveOk(roots, projectRoot) {
  return { ok: true, value: { projectRoot: projectRoot ?? (roots[0] ? roots[0].path : null), roots, warnings: [] } }
}

function sayOk(value) { return { ok: true, value } }
function sayFail(code, message) { return { ok: false, error: { code, message, details: {} } } }

/**
 * 手动刷新现在的入口是「⋯」菜单里的「立即刷新」（工具条上的刷新按钮已去掉，
 * 版本号 chip 换成「检测更新」）。这里封装成一次点击序列。
 */
async function refreshViaMenu(panel) {
  const more = findOne(panel.tree, (node) => (
    isHost(node) && node.type === 'button' && attr(node, 'title') === panel.t('toolbar.more')
  ))
  assert(more !== null, '找不到「更多」按钮')
  click(more)
  await panel.flush()
  const item = findOne(panel.tree, (node) => (
    isHost(node) && node.type === 'button' && textOf(node).includes(panel.t('toolbar.refreshNow'))
  ))
  assert(item !== null, '菜单里找不到「立即刷新」')
  click(item)
  await panel.flush()
}

/* ================================================================== */
/* harness 自检（不碰插件，证明 reconciler 的语义是对的）               */
/* ================================================================== */

test('harness 自检：实例状态 / 依赖与清理 / effect 内 setState / key 不外泄 / 不收敛保护', async () => {
  const r = createReconciler()
  const log = []
  const miniFlush = async () => {
    await new Promise((resolve) => setImmediate(resolve))
    r.flushSync()
  }

  function Counter(props) {
    const [n, setN] = r.useState(0)
    r.useEffect(() => {
      log.push('effect:' + props.name + ':' + n)
      return () => log.push('cleanup:' + props.name + ':' + n)
    }, [n])
    r.useEffect(() => { log.push('once:' + props.name) }, [])
    return r.createElement('button', {
      key: 'k-' + props.name,
      'data-name': props.name,
      onClick: () => setN((value) => value + 1)
    }, String(n))
  }

  function Lazy() {
    const [ready, setReady] = r.useState('no')
    r.useEffect(() => { setReady('yes') }, [])
    return r.createElement('span', { 'data-lazy': '' }, ready)
  }

  r.render(r.createElement('div', null,
    r.createElement(Counter, { name: 'a' }),
    r.createElement(Counter, { name: 'b' }),
    r.createElement(Lazy, null),
    r.createElement('i', null, 'tail')), {})
  await miniFlush()

  const buttons = findAll(r.tree, (node) => isHost(node) && node.type === 'button')
  eq(buttons.length, 2, '两个 Counter 实例')
  eq(buttons.map(textOf), ['0', '0'], '同一组件在不同位置各持一份 state')
  eq(Object.prototype.hasOwnProperty.call(buttons[0].props, 'key'), false, 'key 不应泄漏到宿主 props')
  eq(attr(buttons[1], 'data-name'), 'b', '普通 props 正常透传')
  eq(textOf(findOne(r.tree, (node) => isHost(node) && node.props['data-lazy'] !== undefined)), 'yes', 'effect 里的 setState 也能生效')
  eq(textOf(findOne(r.tree, (node) => node.type === 'i')), 'tail', '普通子节点渲染')

  click(buttons[0])
  await miniFlush()
  eq(findAll(r.tree, (node) => isHost(node) && node.type === 'button').map(textOf), ['1', '0'], '点第一个只改它自己的 state')
  assert(log.includes('effect:a:1'), '依赖 [n] 变化后应重跑 effect: ' + log.join(','))
  assert(log.includes('cleanup:a:0'), '依赖变化前应先跑上一次的 cleanup: ' + log.join(','))
  eq(log.filter((item) => item === 'once:a').length, 1, '[] 依赖只跑一次')

  r.unmount()
  assert(log.includes('cleanup:a:1') && log.includes('cleanup:b:0'), 'unmount 应跑掉所有 cleanup: ' + log.join(','))

  // 不收敛保护：每遍都 setState 的组件必须被 10 遍上限拦住
  const runaway = createReconciler()
  function Bad() {
    const [value, setValue] = runaway.useState(0)
    runaway.useEffect(() => { setValue(value + 1) })
    return runaway.createElement('div', null, String(value))
  }
  let thrown = null
  try {
    runaway.render(runaway.createElement(Bad, null), {})
  } catch (error) {
    thrown = error
  }
  assert(thrown !== null && /did not settle/.test(thrown.message), '不收敛时应抛 render did not settle，实际: ' + thrown)
})

/* ================================================================== */
/* 用例 1：挂载 → 解析根 → status → 分组行                              */
/* ================================================================== */

test('用例 1：挂载 → 解析根 → status → 分组与行', async () => {
  const status = statusThree()
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(status)
    }
  }, async (panel) => {
    await panel.flush()

    // project/resolve 用 sessionId 发起（Panel 有 sessionId 就不发 cwd）
    const resolveCalls = panel.router.all('project/resolve')
    eq(resolveCalls.length, 1, 'project/resolve 应只调用一次')
    eq(resolveCalls[0].payload, { sessionId: 'session-1' }, 'project/resolve 载荷')
    eq(resolveCalls[0].channel, CHANNEL, 'RPC channel')

    // status 只带 rootPath
    const statusCalls = panel.router.all('status')
    assert(statusCalls.length >= 1, '没有发 status')
    eq(statusCalls[0].payload, { rootPath: PROJECT }, 'status 载荷')

    // 变更模式的仓库切换在「储存库」列表里，顶栏不再有下拉（胶囊只属于文件模式）
    eq(panel.class('dgp-pill').length, 0, '变更模式不应有顶栏胶囊')
    const repoList = panel.class('dgp-repolist')[0]
    assert(repoList !== undefined, '缺少「储存库」区域')
    eq(textOf(repoList).includes('储存库'), true, '储存库标题')
    const repoRows = byAttr(repoList, 'data-dgp-repo')
    eq(repoRows.length, 1, '只有一个仓库时应有一行')
    eq(attr(repoRows[0], 'data-active'), 'true', '当前仓库应高亮')
    assert(textOf(repoRows[0]).includes('project'), '行里应有仓库名，实际 ' + textOf(repoRows[0]))
    const branchMark = byAttr(repoList, 'data-dgp-branch')[0]
    assert(branchMark !== undefined, '仓库行最右侧应有分支按钮')
    eq(branchMark.type, 'button', '当前分支是独立按钮')
    assert(textOf(branchMark).includes('main'), '分支按钮显示当前分支，实际 ' + textOf(branchMark))
    eq(textOf(repoRows[0]).includes('main'), false, '点仓库名的那一截不含分支名')

    // 顶层结构
    eq(panel.class('dgp-root').length, 1, '.dgp-root 数量')
    eq(panel.class('dgp-toolbar').length, 1, '.dgp-toolbar 数量')
    eq(panel.class('dgp-filter').length, 1, '.dgp-filter 数量')

    // 变更列表结构：取「真正提交过」的那一帧（缺陷 #1 让面板在内容/骨架屏之间摆动，见 xfail 诊断 1）
    const frame = panel.changesFrame()
    assert(frame !== null, '没有任何一帧渲染出变更行（见 xfail 诊断 1）')

    // 默认合并模式：未跟踪并进「未暂存」，所以只有两组，顺序固定
    const groups = byAttr(frame, 'data-dgp-group')
    eq(groups.map((node) => attr(node, 'data-dgp-group')), ['staged', 'unstaged'], '分组顺序（合并模式）')
    const unstagedGroup = groups.find((node) => attr(node, 'data-dgp-group') === 'unstaged')
    assert(byAttr(unstagedGroup, 'data-dgp-path').some((node) => attr(node, 'data-dgp-path') === 'notes.txt'),
      '未跟踪的 notes.txt 应该并进未暂存组')

    // 每个组 1 个文件 → 直接就是文件行，共 3 行
    const rows = byAttr(frame, 'data-dgp-row', 'file')
    eq(rows.length, 3, '文件行数量')
    eq(rows.map((node) => attr(node, 'data-dgp-path')).sort(), ['app.js', 'notes.txt', 'util.ts'], '文件行路径')

    // +N / −N（app.js 是 +3 / −1）
    const appRow = panel.fileRow('app.js', frame)
    assert(appRow !== null, '缺少 app.js 行')
    const appText = textOf(appRow)
    assert(appText.includes('+3'), 'app.js 行应显示 +3，实际 ' + appText)
    assert(appText.includes('\u22121'), 'app.js 行应显示 −1（U+2212），实际 ' + appText)

    // 单选：面板一次只渲染一条变更树
    eq(byAttr(frame, 'data-dgp-list', 'changes').length, 1, '变更树数量')
  })
})

/* ================================================================== */
/* 用例 1s：行尾 + / − 暂存与取消暂存                                   */
/* ================================================================== */

test('用例 1s：未暂存行点加号暂存，已暂存行点减号取消暂存', async () => {
  const stagedCalls = []
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'index/stage': (payload) => {
        stagedCalls.push(payload)
        return sayOk({ path: payload.path, action: payload.action })
      }
    }
  }, async (panel) => {
    await panel.flush()

    // 操作按钮和文件行包在同一个 dgp-row-wrap 里，按这个容器配对，不靠全局顺序。
    const buttonFor = (groupKey, relPath) => {
      const group = byAttr(panel.tree, 'data-dgp-group', groupKey)[0]
      assert(group !== undefined, '缺少分组 ' + groupKey)
      const wrap = findOne(group, (node) => (
        isHost(node)
        && hasClass(node, 'dgp-row-wrap')
        && findOne(node, (child) => (
          isHost(child) && attr(child, 'data-dgp-path') === relPath && attr(child, 'data-dgp-row') === 'file'
        )) !== null
      ))
      assert(wrap !== null, groupKey + ' 里缺少 ' + relPath + ' 的行')
      const button = findOne(wrap, (node) => (
        isHost(node) && node.type === 'button' && typeof attr(node, 'data-dgp-action') === 'string'
      ))
      assert(button !== null, relPath + ' 缺少行尾按钮')
      return button
    }

    const stageButton = buttonFor('unstaged', 'app.js')
    eq(attr(stageButton, 'data-dgp-action'), 'stage', '未暂存行应是加号（暂存）')
    const unstageButton = buttonFor('staged', 'util.ts')
    eq(attr(unstageButton, 'data-dgp-action'), 'unstage', '已暂存行应是减号（取消暂存）')
    // 合并模式下未跟踪文件就在「未暂存」组里，同样带加号
    const untrackedButton = buttonFor('unstaged', 'notes.txt')
    eq(attr(untrackedButton, 'data-dgp-action'), 'stage', '未跟踪行也应能暂存')

    const mark = panel.router.mark()
    click(stageButton)
    await panel.flush()
    eq(stagedCalls.length, 1, '点一次只暂存一次')
    eq(stagedCalls[0], { rootPath: PROJECT, path: 'app.js', action: 'stage' }, '暂存载荷')
    assert(panel.router.all('status', mark).length >= 1, '暂存后应重读 status，文件才会换组')

    click(unstageButton)
    await panel.flush()
    eq(stagedCalls[1], { rootPath: PROJECT, path: 'util.ts', action: 'unstage' }, '取消暂存载荷')
  })
})

test('用例 1t：提交框在有暂存且有说明时可提交，生成按钮走 commit/message', async () => {
  const commits = []
  const generated = []
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      commit: (payload) => {
        commits.push(payload)
        return sayOk({ head: 'def5678', subject: payload.message })
      },
      'commit/message': (payload) => {
        generated.push(payload)
        return sayOk({ message: 'feat: generated', model: 'kedaya-grok/grok-4.7', source: 'staged' })
      }
    }
  }, async (panel) => {
    await panel.flush()
    const submit = panel.one((node) => isHost(node) && attr(node, 'data-dgp-commit') === 'submit')
    assert(submit !== null, '应有提交按钮')
    eq(attr(submit, 'disabled'), true, '没有说明时提交按钮禁用')

    const input = panel.one((node) => isHost(node) && attr(node, 'data-dgp-commit') === 'input')
    input.props.onChange({ target: { value: 'feat: add panel' } })
    await panel.flush()
    const submitReady = panel.one((node) => isHost(node) && attr(node, 'data-dgp-commit') === 'submit')
    eq(attr(submitReady, 'disabled'), false, '有暂存且有说明时可以提交')

    click(submitReady)
    await panel.flush()
    eq(commits.length, 1, '应提交一次')
    eq(commits[0].message, 'feat: add panel', '提交说明')
    eq(commits[0].rootPath, PROJECT, '提交的仓库')

    // 提交成功：同一条状态行显示结果（短 SHA + 主题），输入框清空
    const statusEl = () => panel.one((node) => isHost(node) && attr(node, 'data-dgp-commit') === 'status')
    const done = statusEl()
    eq(attr(done, 'data-kind'), 'note', '成功后状态行显示结果')
    eq(attr(done, 'data-tone'), 'info', '成功用 info 色调')
    const doneText = textOf(done)
    assert(doneText.includes('def5678'), '结果里要带新提交的短 SHA：' + doneText)
    assert(doneText.includes('feat: add panel'), '结果里要带提交主题：' + doneText)
    eq(attr(panel.one((node) => isHost(node) && attr(node, 'data-dgp-commit') === 'input'), 'value'), '',
      '提交后输入框清空')

    // 开始写新说明时结果提示立刻让位：有说明 + 有暂存时可以提交，状态行整行消失
    panel.one((node) => isHost(node) && attr(node, 'data-dgp-commit') === 'input')
      .props.onChange({ target: { value: 'feat: next' } })
    await panel.flush()
    eq(statusEl(), null, '输入后结果提示消失，状态行不再占位')

    const generate = panel.one((node) => isHost(node) && attr(node, 'data-dgp-commit') === 'generate')
    click(generate)
    await panel.flush()
    eq(generated.length, 1, '应请求一次生成')
    eq(attr(panel.one((node) => isHost(node) && attr(node, 'data-dgp-commit') === 'input'), 'value'),
      'feat: generated', '生成结果应填进输入框')
  })
})

test('用例 1z：只有未暂存改动也能提交（按钮可用，提交时先暂存全部）', async () => {
  const commits = []
  const onlyUnstaged = {
    ...statusThree(),
    files: [
      file({ path: 'app.js', status: 'M', unstaged: true, adds: 3, dels: 1 }),
      file({ path: 'notes.txt', status: '?', untracked: true })
    ],
    counts: { total: 2, staged: 0, unstaged: 1, untracked: 1, conflicted: 0 }
  }
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(onlyUnstaged),
      commit: (payload) => {
        commits.push(payload)
        return sayOk({ head: 'abc9999', subject: payload.message, includedUnstaged: true })
      }
    }
  }, async (panel) => {
    await panel.flush()
    const statusEl = () => panel.one((node) => isHost(node) && attr(node, 'data-dgp-commit') === 'status')
    const submitEl = () => panel.one((node) => isHost(node) && attr(node, 'data-dgp-commit') === 'submit')

    // 有改动但都没暂存：按钮不可用时是因为还没写说明
    eq(textOf(statusEl()), '填写提交说明后提交')
    eq(attr(submitEl(), 'disabled'), true)

    panel.one((node) => isHost(node) && attr(node, 'data-dgp-commit') === 'input')
      .props.onChange({ target: { value: 'feat: 全部提交' } })
    await panel.flush()
    eq(attr(submitEl(), 'disabled'), false, '只有未暂存改动 + 有说明时也能提交')
    eq(textOf(statusEl()), '没有已暂存的改动，提交时会先暂存全部', '提示说明会发生什么')

    click(submitEl())
    await panel.flush()
    eq(commits.length, 1, '应提交一次')
    eq(commits[0].message, 'feat: 全部提交')
  })
})

test('用例 1u：设置按钮打开设置页，选择模型即保存', async () => {
  const saved = []
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'models/list': () => sayOk({ models: [
        { ref: 'kedaya-grok/grok-4.7', provider: 'kedaya-grok', model: 'grok-4.7', providerLabel: 'Kedaya Grok', modelLabel: 'Grok 4.7' }
      ], failed: [] }),
      'settings/get': () => sayOk({ commitModel: null }),
      'settings/set': (payload) => {
        saved.push(payload)
        const split = (ref) => {
          const at = String(ref).indexOf('/')
          return { provider: String(ref).slice(0, at), model: String(ref).slice(at + 1) }
        }
        return sayOk({
          commitModel: payload.commitModel === undefined ? null : (payload.commitModel === null ? null : split(payload.commitModel)),
          reviewModel: payload.reviewModel === undefined ? null : (payload.reviewModel === null ? null : split(payload.reviewModel))
        })
      }
    }
  }, async (panel) => {
    await panel.flush()
    click(panel.one((node) => isHost(node) && attr(node, 'data-action') === 'open-settings'))
    await panel.flush()
    const view = panel.one((node) => isHost(node) && attr(node, 'data-dgp-view') === 'settings')
    assert(view !== null, '应进入设置页')
    const select = panel.one((node) => isHost(node) && attr(node, 'data-dgp-settings') === 'model')
    assert(select !== null, '应有模型下拉')
    select.props.onChange({ target: { value: 'kedaya-grok/grok-4.7' } })
    await panel.flush()
    eq(saved.length, 1, '选择即保存')
    eq(saved[0].commitModel, 'kedaya-grok/grok-4.7', '保存的模型')

    // 审阅模型是独立的一项：只改它时请求里只带 reviewModel
    const reviewSelect = panel.one((node) => isHost(node) && attr(node, 'data-dgp-settings') === 'review-model')
    assert(reviewSelect !== null, '设置页应有 AI 审阅模型下拉')
    reviewSelect.props.onChange({ target: { value: 'kedaya-grok/grok-4.7' } })
    await panel.flush()
    eq(Object.keys(saved[saved.length - 1]), ['reviewModel'], '只改审阅模型时不要带 commitModel')
    eq(saved[saved.length - 1].reviewModel, 'kedaya-grok/grok-4.7')
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-settings') === 'back'))
    await panel.flush()
    eq(panel.one((node) => isHost(node) && attr(node, 'data-dgp-view') === 'settings'), null, '返回后离开设置页')
  })
})

/* ================================================================== */
/* 用例 2：点选 → diff 载荷 → diff 行                                  */
/* ================================================================== */

test('用例 1C：远端页签列出账号与仓库，点「拉取」把仓库克隆到项目里', async () => {
  const clones = []
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'accounts/list': () => sayOk({
        accounts: [{ id: 'github:alice', provider: 'github', login: 'alice', label: '工作号', providerLabel: 'GitHub' }],
        providers: [{ id: 'github', label: 'GitHub' }, { id: 'gitee', label: 'Gitee' }]
      }),
      'remote/repos': () => sayOk({
        repos: [{
          fullName: 'alice/app', name: 'app', private: false, description: '演示仓库', language: 'TypeScript',
          updatedAt: '2026-01-02T03:04:05Z', sizeKb: 120, defaultBranch: 'main',
          htmlUrl: 'https://github.com/alice/app', cloneUrl: 'https://github.com/alice/app.git',
          provider: 'github', accountId: 'github:alice'
        }],
        page: 1,
        hasMore: false
      }),
      'remote/clone': (payload) => {
        clones.push(payload)
        return sayOk({ path: PROJECT + '/app', name: 'app', fullName: 'alice/app' })
      }
    }
  }, async (panel) => {
    await panel.flush()
    const tabs = panel.all((node) => isHost(node) && hasClass(node, 'dgp-seg-btn'))
    click(tabs[2])
    await panel.flush()

    const chip = panel.one((node) => isHost(node) && attr(node, 'data-dgp-account') === 'github:alice')
    assert(chip !== null, '应有账号 chip')
    assert(textOf(chip).includes('工作号'), 'chip 显示账号备注名')

    const rows = panel.all((node) => isHost(node) && hasClass(node, 'dgp-remote-item'))
    eq(rows.length, 1, '应列出仓库')
    assert(textOf(rows[0]).includes('app'), '行里显示仓库名')
    assert(textOf(rows[0]).includes('演示仓库'), '行里显示描述')

    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote-clone') === 'alice/app'))
    await panel.flush()
    const folderInput = panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote-folder') === 'alice/app')
    assert(folderInput !== null, '应出现目标文件夹输入框')
    eq(folderInput.props.value, 'app', '默认用仓库名')

    folderInput.props.onChange({ target: { value: 'my-app' } })
    await panel.flush()
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote-confirm') === 'alice/app'))
    await panel.flush()

    eq(clones.length, 1, '应调用一次 remote/clone')
    eq(clones[0], {
      accountId: 'github:alice',
      fullName: 'alice/app',
      cloneUrl: 'https://github.com/alice/app.git',
      projectRoot: PROJECT,
      targetName: 'my-app'
    }, '克隆载荷')
  })
})

test('用例 1D：没有账号时远端页签给空态，可直接去设置', async () => {
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'accounts/list': () => sayOk({ accounts: [], providers: [{ id: 'github', label: 'GitHub' }] })
    }
  }, async (panel) => {
    await panel.flush()
    click(panel.all((node) => isHost(node) && hasClass(node, 'dgp-seg-btn'))[2])
    await panel.flush()

    const empty = panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote') === 'no-accounts')
    assert(empty !== null, '应给空态')
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote') === 'open-settings'))
    await panel.flush()

    assert(panel.one((node) => isHost(node) && attr(node, 'data-dgp-view') === 'settings') !== null,
      '点「去设置」应打开设置页')
    assert(panel.one((node) => isHost(node) && attr(node, 'data-dgp-accounts') === 'add') !== null,
      '设置页应有添加账号的入口')
  })
})

test('用例 1A：文件模式没有仓库选择器，固定浏览项目根', async () => {
  const calls = []
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'tree/list': (payload) => {
        calls.push(payload)
        return sayOk({ entries: [], truncated: false })
      }
    }
  }, async (panel) => {
    await panel.flush()
    const filesTab = panel.all((node) => isHost(node) && hasClass(node, 'dgp-seg-btn'))
    click(filesTab[1])
    await panel.flush()

    assert(panel.class('dgp-pill').length === 0, '文件模式不应出现仓库下拉框')
    assert(panel.all((node) => isHost(node) && hasClass(node, 'dgp-rootpicker')).length === 0, '也不应有根选择器')
    eq(calls.length >= 1, true, '应去列目录')
    eq(calls[0].rootPath, PROJECT, '固定浏览项目根')
    eq(calls[0].path, '', '根目录')
  })
})

test('用例 1B：点仓库行的分支名可以切换分支', async () => {
  const switches = []
  let resolveCalls = 0
  await withPanel({
    routes: {
      'project/resolve': () => {
        resolveCalls += 1
        return resolveOk([ROOT], PROJECT)
      },
      status: () => sayOk(statusThree()),
      'branches/list': () => sayOk({
        branches: [
          { name: 'main', local: true, current: true, remote: 'origin', upstream: 'origin/main', ahead: 1, behind: 0 },
          { name: 'feature', local: true, current: false, remote: null, upstream: null, ahead: 0, behind: 0 }
        ]
      }),
      'branch/switch': (payload) => {
        switches.push(payload)
        return sayOk({ branch: payload.name, head: 'aaa1111' })
      }
    }
  }, async (panel) => {
    await panel.flush()
    const before = resolveCalls
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-repo') !== undefined))
    await panel.flush()
    eq(panel.all((node) => isHost(node) && hasClass(node, 'dgp-menu')).length, 0, '点仓库名不应打开分支菜单')

    const branchButton = panel.one((node) => isHost(node) && attr(node, 'data-dgp-branch') !== undefined)
    click(branchButton)
    await panel.flush()

    const branchItems = panel.all((node) => isHost(node) && attr(node, 'data-menu-key') !== undefined
      && attr(node, 'data-menu-key').startsWith('branch:'))
    eq(branchItems.length, 2, '菜单里应列出两个分支')
    eq(branchItems.map((node) => attr(node, 'data-menu-key')), ['branch:main', 'branch:feature'], '顺序：当前分支在最前')
    eq(attr(branchItems[0], 'data-checked'), 'true', '当前分支打勾')
    assert(textOf(branchItems[0]).includes('↑1'), '领先要显示 ↑n：' + textOf(branchItems[0]))
    const badges = (node) => findAll(node, (child) => isHost(child) && hasClass(child, 'dgp-menu-badge'))
    eq(badges(branchItems[0]).map((node) => attr(node, 'data-active')), ['true', 'true'], 'main 本地与远程都亮')
    eq(badges(branchItems[1]).map((node) => attr(node, 'data-active')), ['true', 'false'], 'feature 只有本地亮')
    const feature = branchItems[1]

    click(feature)
    await panel.flush()
    eq(switches.length, 1, '应调用一次 branch/switch')
    eq(switches[0], { rootPath: PROJECT, name: 'feature' }, '切换载荷')
    eq(panel.all((node) => isHost(node) && hasClass(node, 'dgp-menu-item')).length, 0, '切完菜单应关闭')
    assert(resolveCalls > before, '切完要重新解析根，分支名才会更新')
  })
})

test('用例 1C：分支菜单底部输入名字后创建并切过去', async () => {
  const created = []
  let resolveCalls = 0
  await withPanel({
    routes: {
      'project/resolve': () => {
        resolveCalls += 1
        return resolveOk([ROOT], PROJECT)
      },
      status: () => sayOk(statusThree()),
      'branches/list': () => sayOk({
        branches: [{ name: 'main', current: true }]
      }),
      'branch/create': (payload) => {
        created.push(payload)
        return sayOk({ branch: payload.name, head: 'bbb2222' })
      }
    }
  }, async (panel) => {
    await panel.flush()
    const before = resolveCalls
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-branch') !== undefined))
    await panel.flush()

    const form = panel.one((node) => isHost(node) && attr(node, 'data-dgp-branch-create') === 'true')
    assert(form !== null, '分支菜单底部应有创建表单')
    const submit = panel.one((node) => isHost(node) && attr(node, 'data-dgp-branch-create-submit') === 'true')
    eq(attr(submit, 'disabled'), true, '没填名字时不能创建')

    const input = panel.one((node) => isHost(node) && attr(node, 'data-dgp-branch-name') === 'true')
    input.props.onChange({ target: { value: '  topic  ' } })
    await panel.flush()
    const ready = panel.one((node) => isHost(node) && attr(node, 'data-dgp-branch-create-submit') === 'true')
    eq(attr(ready, 'disabled'), false, '填了名字就可以创建')

    panel.one((node) => isHost(node) && attr(node, 'data-dgp-branch-create') === 'true')
      .props.onSubmit({ preventDefault() {} })
    await panel.flush()
    eq(created.length, 1, '应调用一次 branch/create')
    eq(created[0], { rootPath: PROJECT, name: 'topic' }, '名字要去掉首尾空白')
    eq(panel.all((node) => isHost(node) && hasClass(node, 'dgp-menu')).length, 0, '创建后菜单应关闭')
    assert(resolveCalls > before, '创建后要重新解析根，行上的分支名才会换成新的')
  })
})

test('用例 1F：没账号时远端页签就地添加账号，不用跳设置页', async () => {
  let accounts = []
  const added = []
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'accounts/list': () => sayOk({
        accounts,
        providers: [
          { id: 'github', label: 'GitHub', tokenUrl: 'https://github.com/settings/tokens/new?scopes=repo' },
          { id: 'gitee', label: 'Gitee', tokenUrl: 'https://gitee.com/profile/personal_access_tokens' }
        ]
      }),
      'accounts/add': (payload) => {
        added.push(payload)
        accounts = [{
          id: payload.provider + ':alice',
          provider: payload.provider,
          login: 'alice',
          label: payload.label === '' ? 'alice' : payload.label,
          providerLabel: payload.provider === 'gitee' ? 'Gitee' : 'GitHub'
        }]
        return sayOk({ account: accounts[0] })
      },
      'remote/repos': () => sayOk({ repos: [], page: 1, hasMore: false })
    }
  }, async (panel) => {
    await panel.flush()
    click(panel.all((node) => isHost(node) && hasClass(node, 'dgp-seg-btn'))[2])
    await panel.flush()

    // 空态只给一个「添加账号」入口，平台在表单的下拉里选
    const addButtons = panel.all((node) => isHost(node) && attr(node, 'data-dgp-remote') === 'add-account')
    eq(addButtons.length, 1, '空态应有一个添加账号入口')

    click(addButtons[0])
    await panel.flush()
    const form = panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote') === 'account-form')
    assert(form !== null, '点平台按钮应就地展开表单，而不是跳设置页')
    assert(panel.one((node) => isHost(node) && attr(node, 'data-dgp-view') === 'settings') === null,
      '不应跳到设置页')

    const providerSelect = panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote') === 'account-provider')
    assert(providerSelect !== null, '表单里应有平台下拉')
    eq(providerSelect.props.value, 'github', '默认选中第一个平台')

    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote') === 'open-token-page'))
    await panel.flush()
    eq(panel.window.opened.length, 1, '应打开令牌页面')
    assert(panel.window.opened[0].url.includes('github.com/settings/tokens'), '打开的是 GitHub 令牌页')

    // 打开成功后要告诉用户下一步做什么
    const hint = panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote') === 'token-hint')
    assert(hint !== null, '点过获取令牌后应有提示')
    assert(textOf(hint).includes('已在浏览器打开'), '提示文案：' + textOf(hint))

    panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote') === 'account-token')
      .props.onChange({ target: { value: 'ghp_zzz' } })
    await panel.flush()
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote') === 'account-submit'))
    await panel.flush()

    eq(added.length, 1, '应调用一次 accounts/add')
    eq(added[0], { provider: 'github', label: '', token: 'ghp_zzz' }, '添加载荷')
    eq(panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote') === 'account-form'), null,
      '成功后表单应收起')
    assert(panel.one((node) => isHost(node) && attr(node, 'data-dgp-account') === 'github:alice') !== null,
      '添加成功后出现账号 chip')
  })
})

test('用例 1G：已有账号时点 ＋ 也能就地添加', async () => {
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'accounts/list': () => sayOk({
        accounts: [{ id: 'github:alice', provider: 'github', login: 'alice', label: '工作号', providerLabel: 'GitHub' }],
        providers: [{ id: 'github', label: 'GitHub', tokenUrl: 'https://github.com/settings/tokens/new' }]
      }),
      'remote/repos': () => sayOk({ repos: [], page: 1, hasMore: false })
    }
  }, async (panel) => {
    await panel.flush()
    click(panel.all((node) => isHost(node) && hasClass(node, 'dgp-seg-btn'))[2])
    await panel.flush()

    const add = panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote') === 'add-account')
    assert(add !== null, '有账号时应有 ＋ 入口')
    click(add)
    await panel.flush()
    assert(panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote') === 'account-form') !== null,
      '点 ＋ 应展开表单')
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote') === 'account-cancel'))
    await panel.flush()
    eq(panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote') === 'account-form'), null, '取消应收起')
  })
})

test('用例 1I：账号可以改备注名、显示并复制令牌', async () => {
  const updates = []
  const tokenReads = []
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'models/list': () => sayOk({ models: [], failed: [] }),
      'settings/get': () => sayOk({ commitModel: null }),
      'accounts/list': () => sayOk({
        accounts: [{ id: 'github:alice', provider: 'github', login: 'alice', label: '工作号', providerLabel: 'GitHub' }],
        providers: [{ id: 'github', label: 'GitHub', tokenUrl: 'https://github.com/settings/tokens/new' }]
      }),
      'accounts/token': (payload) => {
        tokenReads.push(payload)
        return sayOk({ id: payload.id, token: 'ghp_secret_value' })
      },
      'accounts/update': (payload) => {
        updates.push(payload)
        return sayOk({
          account: { id: payload.id, provider: 'github', login: 'alice', label: payload.label, providerLabel: 'GitHub' }
        })
      }
    }
  }, async (panel) => {
    await panel.flush()
    click(panel.one((node) => isHost(node) && attr(node, 'data-action') === 'open-settings'))
    await panel.flush()

    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-account-edit') === 'github:alice'))
    await panel.flush()
    assert(panel.one((node) => isHost(node) && attr(node, 'data-dgp-accounts') === 'editor') !== null,
      '应展开编辑区')

    eq(tokenReads.length, 0, '没点显示之前不应读取令牌')
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-accounts') === 'reveal-token'))
    await panel.flush()
    eq(tokenReads.length, 1, '点显示后应读取一次令牌')
    eq(tokenReads[0], { id: 'github:alice' })
    const tokenNode = panel.one((node) => isHost(node) && attr(node, 'data-dgp-accounts') === 'token-value')
    assert(tokenNode !== null, '应显示令牌原文')
    assert(textOf(tokenNode).includes('ghp_secret_value'), '显示的是真实令牌：' + textOf(tokenNode))

    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-accounts') === 'copy-token'))
    await panel.flush()
    const notice = panel.one((node) => isHost(node) && attr(node, 'data-dgp-accounts') === 'editor-notice')
    assert(notice !== null, '复制后应有反馈')
    assert(textOf(notice).includes('剪贴板'), '反馈要提到剪贴板：' + textOf(notice))

    panel.one((node) => isHost(node) && attr(node, 'data-dgp-accounts') === 'edit-label')
      .props.onChange({ target: { value: '新名字' } })
    await panel.flush()
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-accounts') === 'save-account'))
    await panel.flush()
    eq(updates.length, 1, '应调用一次 accounts/update')
    eq(updates[0], { id: 'github:alice', label: '新名字', token: '' }, '保存载荷')
  })
})

test('用例 1J：选中远端仓库后，右侧显示代码概况与 issues / PR 数量', async () => {
  const detailCalls = []
  const payload = (fullName) => ({
    repo: {
      fullName, description: '演示仓库', language: 'TypeScript', private: false,
      defaultBranch: 'main', sizeKb: 120, stars: 9, forks: 2, updatedAt: '2026-02-02T00:00:00Z',
      htmlUrl: 'https://github.com/alice/' + fullName.split('/')[1],
      issuesUrl: 'https://github.com/alice/' + fullName.split('/')[1] + '/issues',
      pullsUrl: 'https://github.com/alice/' + fullName.split('/')[1] + '/pulls'
    },
    issues: {
      total: 7,
      items: [{ number: 7, title: 'issue A', url: 'https://github.com/alice/app/issues/7', author: 'bob', comments: 0, createdAt: '2026-01-01T00:00:00Z' }]
    },
    pulls: {
      total: 3,
      items: [{ number: 3, title: 'PR three', url: 'https://github.com/alice/app/pull/3', author: 'carl', comments: 0, createdAt: '2026-01-02T00:00:00Z' }]
    },
    failures: []
  })
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'accounts/list': () => sayOk({
        accounts: [{ id: 'github:alice', provider: 'github', login: 'alice', label: '工作号', providerLabel: 'GitHub' }],
        providers: [{ id: 'github', label: 'GitHub', tokenUrl: 'https://github.com/settings/tokens/new' }]
      }),
      'remote/repos': () => sayOk({
        repos: [
          { fullName: 'alice/app', name: 'app', private: false, description: '演示仓库', language: 'TypeScript', updatedAt: '2026-02-02T00:00:00Z', sizeKb: 120, defaultBranch: 'main', htmlUrl: 'https://github.com/alice/app', cloneUrl: 'https://github.com/alice/app.git', provider: 'github', accountId: 'github:alice' },
          { fullName: 'alice/tool', name: 'tool', private: true, description: '', language: 'Go', updatedAt: '', sizeKb: 8, defaultBranch: 'master', htmlUrl: 'https://github.com/alice/tool', cloneUrl: 'https://github.com/alice/tool.git', provider: 'github', accountId: 'github:alice' }
        ],
        page: 1,
        hasMore: false
      }),
      'remote/detail': (p) => {
        detailCalls.push(p)
        return sayOk(payload(p.fullName))
      }
    }
  }, async (panel) => {
    await panel.flush()
    click(panel.all((node) => isHost(node) && hasClass(node, 'dgp-seg-btn'))[2])
    await panel.flush()

    // 列表加载完默认选中第一个，右侧直接有内容
    eq(detailCalls.length >= 1, true, '进入远端页签应自动读取第一个仓库的详情')
    eq(detailCalls[0], { accountId: 'github:alice', fullName: 'alice/app' }, '详情载荷')

    const issuesSection = panel.one((node) => isHost(node) && attr(node, 'data-dgp-section') === 'issues')
    const pullsSection = panel.one((node) => isHost(node) && attr(node, 'data-dgp-section') === 'pulls')
    assert(issuesSection !== null && pullsSection !== null, '右侧应有 issues 与 PR 两块')
    assert(textOf(issuesSection).includes('7 个未关闭'), 'issue 数量：' + textOf(issuesSection))
    assert(textOf(pullsSection).includes('3 个未关闭'), 'PR 数量：' + textOf(pullsSection))
    assert(textOf(issuesSection).includes('issue A'), '应列出最近 issue')
    assert(textOf(pullsSection).includes('PR three'), '应列出最近 PR')
    assert(textOf(panel.tree).includes('TypeScript'), '代码概况里应有语言')

    // 点第二个仓库 → 重新拉详情
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote-item') === 'alice/tool'))
    await panel.flush()
    eq(detailCalls[detailCalls.length - 1], { accountId: 'github:alice', fullName: 'alice/tool' }, '切换仓库要重拉详情')
  })
})

test('用例 1K：点开 PR 能看详情并在面板里审查、合并', async () => {
  const reviews = []
  const merges = []
  const pullCalls = []
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'accounts/list': () => sayOk({
        accounts: [{ id: 'github:alice', provider: 'github', login: 'alice', label: '工作号', providerLabel: 'GitHub' }],
        providers: [{ id: 'github', label: 'GitHub', tokenUrl: 'https://github.com/settings/tokens/new' }]
      }),
      'remote/repos': () => sayOk({
        repos: [{
          fullName: 'alice/app', name: 'app', private: false, description: '', language: 'TypeScript',
          updatedAt: '', sizeKb: 10, defaultBranch: 'main',
          htmlUrl: 'https://github.com/alice/app', cloneUrl: 'https://github.com/alice/app.git',
          provider: 'github', accountId: 'github:alice'
        }],
        page: 1,
        hasMore: false
      }),
      'remote/detail': () => sayOk({
        repo: {
          fullName: 'alice/app', description: '', language: 'TypeScript', private: false, defaultBranch: 'main',
          sizeKb: 10, stars: 1, forks: 0, updatedAt: '', htmlUrl: 'https://github.com/alice/app',
          issuesUrl: 'https://github.com/alice/app/issues', pullsUrl: 'https://github.com/alice/app/pulls'
        },
        issues: { total: 1, items: [] },
        pulls: {
          total: 1,
          items: [{ number: 7, title: 'Add remote panel', url: 'https://github.com/alice/app/pull/7', author: 'alice', comments: 0, createdAt: '' }]
        },
        failures: []
      }),
      'remote/pull': (payload) => {
        pullCalls.push(payload)
        return sayOk({
          pull: {
            number: payload.number, title: 'Add remote panel', body: 'body text', state: 'open', draft: false,
            merged: false, mergeable: true, author: 'alice', baseBranch: 'main', headBranch: 'feature/remote',
            additions: 120, deletions: 8, changedFiles: 6, commits: 3, createdAt: '', updatedAt: '',
            htmlUrl: 'https://github.com/alice/app/pull/7'
          },
          reviews: [{ author: 'bob', state: 'APPROVED', body: 'LGTM', submittedAt: '' }],
          capabilities: { verdicts: ['approve', 'request-changes', 'comment'], reviews: true, mergeMethods: ['merge', 'squash', 'rebase'], deleteBranch: true }
        })
      },
      'remote/pull/review': (payload) => {
        reviews.push(payload)
        return sayOk({ verdict: payload.verdict })
      },
      'remote/pull/merge': (payload) => {
        merges.push(payload)
        return sayOk({ merged: true, headBranch: 'feature/remote' })
      }
    }
  }, async (panel) => {
    await panel.flush()
    click(panel.all((node) => isHost(node) && hasClass(node, 'dgp-seg-btn'))[2])
    await panel.flush()

    // 点详情里的 PR 条目 → 面板内打开 PR 详情（不再跳浏览器）
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-item') === 'pulls'))
    await panel.flush()
    eq(pullCalls.length, 1, '应请求一次 PR 详情')
    eq(pullCalls[0], { accountId: 'github:alice', fullName: 'alice/app', number: 7 }, 'PR 详情载荷')
    eq(panel.window.opened.length, 0, '不应打开浏览器')

    const detail = panel.one((node) => isHost(node) && attr(node, 'data-dgp-pull') === 'detail')
    assert(detail !== null, '右侧应显示 PR 详情')
    assert(textOf(detail).includes('Add remote panel'), '标题')
    assert(textOf(detail).includes('body text'), '正文')
    assert(textOf(detail).includes('LGTM'), '审查记录')

    // 审批
    panel.one((node) => isHost(node) && attr(node, 'data-dgp-pull') === 'note')
      .props.onChange({ target: { value: '可以合' } })
    await panel.flush()
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-pull') === 'verdict-approve'))
    await panel.flush()
    eq(reviews.length, 1, '应提交一次审查')
    eq(reviews[0], { accountId: 'github:alice', fullName: 'alice/app', number: 7, verdict: 'approve', body: '可以合' })

    // 合并（选 squash、删源分支）
    const method = panel.one((node) => isHost(node) && attr(node, 'data-dgp-pull') === 'merge-method')
    method.props.onChange({ target: { value: 'squash' } })
    await panel.flush()
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-pull') === 'merge-run'))
    await panel.flush()
    eq(merges.length, 1, '应合并一次')
    eq(merges[0].method, 'squash')
    eq(merges[0].deleteBranch, true)

    // 合并后 PR 已关闭：详情应自动关闭，回到仓库详情，并给出提示
    eq(panel.one((node) => isHost(node) && attr(node, 'data-dgp-pull') === 'detail'), null, '合并后应自动离开 PR 详情')
    const notice = panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote') === 'notice')
    assert(notice !== null, '合并后应有提示')
    assert(textOf(notice).includes('已合并'), '提示文案：' + textOf(notice))
    // 提示可以手动关闭
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote') === 'notice-dismiss'))
    await panel.flush()
    eq(panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote') === 'notice'), null, '提示可关闭')
  })
})

test('用例 1L：Gitee 的 PR 可以标记测试通过（合并门禁）', async () => {
  const tests = []
  let pullReads = 0
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'accounts/list': () => sayOk({
        accounts: [{ id: 'gitee:bob', provider: 'gitee', login: 'bob', label: 'Gitee 号', providerLabel: 'Gitee' }],
        providers: [{ id: 'gitee', label: 'Gitee', tokenUrl: 'https://gitee.com/profile/personal_access_tokens' }]
      }),
      'remote/repos': () => sayOk({
        repos: [{
          fullName: 'bob/tool', name: 'tool', private: false, description: '', language: 'Go',
          updatedAt: '', sizeKb: 1, defaultBranch: 'master',
          htmlUrl: 'https://gitee.com/bob/tool', cloneUrl: 'https://gitee.com/bob/tool.git',
          provider: 'gitee', accountId: 'gitee:bob'
        }],
        page: 1,
        hasMore: false
      }),
      'remote/detail': () => sayOk({
        repo: {
          fullName: 'bob/tool', description: '', language: 'Go', private: false, defaultBranch: 'master',
          sizeKb: 1, stars: 0, forks: 0, updatedAt: '', htmlUrl: 'https://gitee.com/bob/tool',
          issuesUrl: 'https://gitee.com/bob/tool/issues', pullsUrl: 'https://gitee.com/bob/tool/pulls'
        },
        issues: { total: 0, items: [] },
        pulls: { total: 1, items: [{ number: 2, title: 'Fix thing', url: 'https://gitee.com/bob/tool/pulls/2', author: 'bob', comments: 0, createdAt: '' }] },
        failures: []
      }),
      'remote/pull': (payload) => {
        pullReads += 1
        return sayOk({
          pull: {
            number: payload.number, title: 'Fix thing', body: '', state: 'open', draft: false,
            merged: false, mergeable: true, author: 'bob', baseBranch: 'master', headBranch: 'dev',
            additions: 0, deletions: 0, changedFiles: 0, commits: 1, statsComplete: false,
            createdAt: '', updatedAt: '', htmlUrl: 'https://gitee.com/bob/tool/pulls/2'
          },
          reviews: [],
          capabilities: { verdicts: ['approve'], reviews: false, mergeMethods: ['merge', 'squash'], deleteBranch: true, test: true }
        })
      },
      'remote/pull/test': (payload) => {
        tests.push(payload)
        return sayOk({ tested: true })
      }
    }
  }, async (panel) => {
    await panel.flush()
    click(panel.all((node) => isHost(node) && hasClass(node, 'dgp-seg-btn'))[2])
    await panel.flush()
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-item') === 'pulls'))
    await panel.flush()

    const gate = panel.one((node) => isHost(node) && attr(node, 'data-dgp-pull') === 'test-gate')
    assert(gate !== null, 'Gitee 的 PR 应有「标记测试通过」按钮')
    const before = pullReads
    click(gate)
    await panel.flush()

    eq(tests.length, 1, '应调用一次 remote/pull/test')
    eq(tests[0], { accountId: 'gitee:bob', fullName: 'bob/tool', number: 2 }, '载荷')
    assert(pullReads > before, '操作后应刷新 PR 详情')
    const notice = panel.one((node) => isHost(node) && attr(node, 'data-dgp-pull') === 'notice')
    assert(notice !== null, '成功应有提示')
    assert(textOf(notice).includes('测试通过'), '提示文案：' + textOf(notice))
  })
})

test('用例 1M：门禁状态并排显示，一键按钮按平台能力执行', async () => {
  const passes = []
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'accounts/list': () => sayOk({
        accounts: [{ id: 'github:alice', provider: 'github', login: 'alice', label: '工作号', providerLabel: 'GitHub' }],
        providers: [{ id: 'github', label: 'GitHub', tokenUrl: 'https://github.com/settings/tokens/new' }]
      }),
      'remote/repos': () => sayOk({
        repos: [{
          fullName: 'alice/app', name: 'app', private: false, description: '', language: 'Go',
          updatedAt: '', sizeKb: 1, defaultBranch: 'main',
          htmlUrl: 'https://github.com/alice/app', cloneUrl: 'https://github.com/alice/app.git',
          provider: 'github', accountId: 'github:alice'
        }],
        page: 1,
        hasMore: false
      }),
      'remote/detail': () => sayOk({
        repo: {
          fullName: 'alice/app', description: '', language: 'Go', private: false, defaultBranch: 'main',
          sizeKb: 1, stars: 0, forks: 0, updatedAt: '', htmlUrl: 'https://github.com/alice/app',
          issuesUrl: 'https://github.com/alice/app/issues', pullsUrl: 'https://github.com/alice/app/pulls'
        },
        issues: { total: 0, items: [] },
        pulls: {
          total: 1,
          items: [{
            number: 5, title: 'PR five', url: 'https://github.com/alice/app/pull/5', author: 'alice', comments: 0,
            createdAt: '2026-10-01T08:00:00Z', updatedAt: '2026-11-02T12:00:00Z'
          }]
        },
        failures: []
      }),
      'remote/pull': () => sayOk({
        pull: {
          number: 5, title: 'PR five', body: '', state: 'open', draft: false, merged: false, mergeable: true,
          author: 'alice', baseBranch: 'main', headBranch: 'feat', additions: 1, deletions: 1, changedFiles: 1,
          commits: 1, statsComplete: true, createdAt: '', updatedAt: '', htmlUrl: 'https://github.com/alice/app/pull/5'
        },
        reviews: [],
        gate: { review: { state: 'approved', approvals: 1, changesRequested: 0 }, test: { state: 'unknown' }, mergeState: 'blocked' },
        capabilities: { verdicts: ['approve', 'request-changes', 'comment'], reviews: true, mergeMethods: ['merge'], deleteBranch: true, test: false }
      }),
      'remote/pull/pass': (payload) => {
        passes.push(payload)
        return sayOk({ completed: ['review'], failures: [] })
      }
    }
  }, async (panel) => {
    await panel.flush()
    click(panel.all((node) => isHost(node) && hasClass(node, 'dgp-seg-btn'))[2])
    await panel.flush()
    // 先断言列表里的时间（打开详情后列表就不在了）
    const listRow = panel.one((node) => isHost(node) && hasClass(node, 'dgp-detail-item') && textOf(node).includes('PR five'))
    assert(listRow !== null, '应找到 PR 行')
    const listMeta = textOf(listRow)
    assert(listMeta.includes('创建'), 'PR 列表要标出创建时间：' + listMeta)
    assert(listMeta.includes('更新'), 'PR 列表要标出更新时间：' + listMeta)

    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-item') === 'pulls'))
    await panel.flush()

    // 门禁状态一行：审查已通过、测试平台未提供、合并状态 blocked
    const gate = panel.one((node) => isHost(node) && attr(node, 'data-dgp-pull') === 'gate')
    assert(gate !== null, '应有门禁状态行')
    const chips = findAll(gate, (node) => isHost(node) && hasClass(node, 'dgp-gate-chip'))
    eq(chips.map((node) => attr(node, 'data-gate')), ['review', 'test', 'merge-state'], '三项并排')
    assert(textOf(gate).includes('已通过'), '审查已通过：' + textOf(gate))
    assert(textOf(gate).includes('平台未提供'), '测试状态如实显示未提供：' + textOf(gate))
    assert(textOf(gate).includes('blocked'), '透出合并状态')

    // PR 列表要能看出「创建」与「更新」分别是哪个时间

    // GitHub 没有测试动作 → 一键按钮是「通过审查」
    const pass = panel.one((node) => isHost(node) && attr(node, 'data-dgp-pull') === 'pass-all')
    assert(pass !== null, '应有一键通过按钮')
    assert(textOf(pass).includes('通过审查'), '按钮文案按能力变化：' + textOf(pass))

    click(pass)
    await panel.flush()
    eq(passes.length, 1, '应调用一次 remote/pull/pass')
    eq(passes[0], { accountId: 'github:alice', fullName: 'alice/app', number: 5, body: '' })
  })
})

test('用例 1N：有未合并 PR 的仓库在列表里显示红点数字', async () => {
  const counts = []
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'accounts/list': () => sayOk({
        accounts: [{ id: 'github:alice', provider: 'github', login: 'alice', label: '工作号', providerLabel: 'GitHub' }],
        providers: [{ id: 'github', label: 'GitHub', tokenUrl: 'https://github.com/settings/tokens/new' }]
      }),
      'remote/repos': () => sayOk({
        repos: [
          { fullName: 'alice/app', name: 'app', private: false, description: '', language: 'Go', updatedAt: '', sizeKb: 1, defaultBranch: 'main', htmlUrl: 'https://github.com/alice/app', cloneUrl: 'https://github.com/alice/app.git', provider: 'github', accountId: 'github:alice' },
          { fullName: 'alice/tool', name: 'tool', private: false, description: '', language: 'Go', updatedAt: '', sizeKb: 1, defaultBranch: 'main', htmlUrl: 'https://github.com/alice/tool', cloneUrl: 'https://github.com/alice/tool.git', provider: 'github', accountId: 'github:alice' }
        ],
        page: 1,
        hasMore: false
      }),
      'remote/pr-counts': (payload) => {
        counts.push(payload)
        return sayOk({ counts: { 'alice/app': 3, 'alice/tool': 0 }, failures: [] })
      },
      'remote/detail': () => sayOk({
        repo: { fullName: 'alice/app', description: '', language: 'Go', private: false, defaultBranch: 'main', sizeKb: 1, stars: 0, forks: 0, updatedAt: '', htmlUrl: 'x', issuesUrl: 'x', pullsUrl: 'x' },
        issues: { total: 0, items: [] },
        pulls: { total: 0, items: [] },
        failures: []
      })
    }
  }, async (panel) => {
    await panel.flush()
    click(panel.all((node) => isHost(node) && hasClass(node, 'dgp-seg-btn'))[2])
    await panel.flush()

    eq(counts.length, 1, '列表加载后应取一次数量')
    eq(counts[0].accountId, 'github:alice')
    eq(counts[0].fullNames, ['alice/app', 'alice/tool'], '只问当前列表里的仓库')

    const badge = panel.one((node) => isHost(node) && attr(node, 'data-dgp-pr-count') === 'alice/app')
    assert(badge !== null, '有未合并 PR 的仓库要有红点数字')
    eq(textOf(badge), '3', '数字就是未合并数量')
    eq(panel.one((node) => isHost(node) && attr(node, 'data-dgp-pr-count') === 'alice/tool'), null,
      '数量为 0 的仓库不显示红点')
  })
})

test('用例 1O：分支菜单区分本地与仅远程，可跟踪远程分支并获取远程更新', async () => {
  const fetches = []
  const tracks = []
  let listCalls = 0
  const branchesPayload = {
    branches: [
      { name: 'main', local: true, current: true, remote: 'origin', upstream: 'origin/main', ahead: 0, behind: 2 },
      { name: 'feat', local: false, current: false, remote: 'origin', upstream: null, ahead: 0, behind: 0 }
    ]
  }
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'branches/list': () => {
        listCalls += 1
        return sayOk(branchesPayload)
      },
      'remote/fetch': (payload) => {
        fetches.push(payload)
        return sayOk({ fetchedAt: 1 })
      },
      'branch/track': (payload) => {
        tracks.push(payload)
        return sayOk({ branch: payload.name, head: 'aaa1111', upstream: payload.remote + '/' + payload.name })
      }
    }
  }, async (panel) => {
    await panel.flush()
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-branch') !== undefined))
    await panel.flush()

    // 本地分支：落后 2 → ↓2；远程只有的：单独的远程区
    const mainItem = panel.one((node) => isHost(node) && attr(node, 'data-menu-key') === 'branch:main')
    assert(mainItem !== null, '应有分支 main')
    assert(textOf(mainItem).includes('↓2'), '落后要显示 ↓n：' + textOf(mainItem))
    const remoteItem = panel.one((node) => isHost(node) && attr(node, 'data-menu-key') === 'branch:feat')
    assert(remoteItem !== null, '应有只有远程的 feat 分支')
    const featBadges = findAll(remoteItem, (node) => isHost(node) && hasClass(node, 'dgp-menu-badge'))
    eq(featBadges.map((node) => attr(node, 'data-active')), ['false', 'true'], 'feat 只有远程亮')

    // 点仅远程的分支 → 创建本地跟踪分支
    click(remoteItem)
    await panel.flush()
    eq(tracks.length, 1, '应调用 branch/track')
    eq(tracks[0], { rootPath: PROJECT, remote: 'origin', name: 'feat' })

    // 重新打开菜单，点「获取远程更新」→ 先 fetch 再重读
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-branch') !== undefined))
    await panel.flush()
    const before = listCalls
    click(panel.one((node) => isHost(node) && attr(node, 'data-menu-key') === 'fetch-branches'))
    await panel.flush()
    eq(fetches.length, 1, '应调用 remote/fetch')
    eq(fetches[0], { rootPath: PROJECT })
    assert(listCalls > before, 'fetch 后应重读分支列表')
  })
})

test('用例 1P：粘贴带引号的路径/分支名会自动去掉引号', async () => {
  const addedRoots = []
  const createdBranches = []
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'roots/add': (payload) => {
        addedRoots.push(payload)
        return resolveOk([ROOT], PROJECT)
      },
      'branches/list': () => sayOk({
        branches: [{ name: 'main', local: true, current: true, remote: null, ahead: 0, behind: 0 }]
      }),
      'branch/create': (payload) => {
        createdBranches.push(payload)
        return sayOk({ branch: payload.name, head: 'aaa1111' })
      }
    }
  }, async (panel) => {
    await panel.flush()

    // 1) 储存库的 + 里粘贴 Windows「复制为路径」的结果：带引号
    click(panel.one((node) => isHost(node) && attr(node, 'data-action') === 'add-root'))
    await panel.flush()
    let addForm = panel.one((node) => isHost(node) && attr(node, 'data-dgp-addform') !== undefined)
    assert(addForm !== null, '应展开添加表单')
    findOne(addForm, (node) => isHost(node) && node.type === 'input')
      .props.onChange({ target: { value: '"H:\\invitation-system-backend"' } })
    await panel.flush()
    addForm = panel.one((node) => isHost(node) && attr(node, 'data-dgp-addform') !== undefined)
    const confirm = findOne(addForm, (node) => isHost(node) && attr(node, 'data-dgp-addform-confirm') !== undefined)
    assert(confirm !== null, '应有添加按钮')
    click(confirm)
    await panel.flush()
    eq(addedRoots.length, 1, '应提交一次 roots/add')
    eq(addedRoots[0].path, 'H:\\invitation-system-backend', '引号必须被去掉')

    // 2) 分支菜单底部新建分支，名字同样粘贴带引号
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-branch') !== undefined))
    await panel.flush()
    panel.one((node) => isHost(node) && attr(node, 'data-dgp-branch-name') !== undefined)
      .props.onChange({ target: { value: '"feature/from-clipboard"' } })
    await panel.flush()
    panel.one((node) => isHost(node) && attr(node, 'data-dgp-branch-create') !== undefined)
      .props.onSubmit({ preventDefault() {} })
    await panel.flush()
    eq(createdBranches.length, 1, '应创建分支一次')
    eq(createdBranches[0].name, 'feature/from-clipboard', '分支名的引号也要去掉')
  })
})

test('用例 1Q：AI 审阅 PR，问题编号列出，评论草稿可编辑后手动提交', async () => {
  const comments = []
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'accounts/list': () => sayOk({
        accounts: [{ id: 'github:alice', provider: 'github', login: 'alice', label: '工作号', providerLabel: 'GitHub' }],
        providers: [{ id: 'github', label: 'GitHub', tokenUrl: 'https://github.com/settings/tokens/new' }]
      }),
      'remote/repos': () => sayOk({
        repos: [{
          fullName: 'alice/app', name: 'app', private: false, description: '', language: 'Go',
          updatedAt: '', sizeKb: 1, defaultBranch: 'main',
          htmlUrl: 'https://github.com/alice/app', cloneUrl: 'https://github.com/alice/app.git',
          provider: 'github', accountId: 'github:alice'
        }],
        page: 1,
        hasMore: false
      }),
      'remote/detail': () => sayOk({
        repo: {
          fullName: 'alice/app', description: '', language: 'Go', private: false, defaultBranch: 'main',
          sizeKb: 1, stars: 0, forks: 0, updatedAt: '', htmlUrl: 'https://github.com/alice/app',
          issuesUrl: 'https://github.com/alice/app/issues', pullsUrl: 'https://github.com/alice/app/pulls'
        },
        issues: { total: 0, items: [] },
        pulls: { total: 1, items: [{ number: 7, title: 'PR seven', url: 'https://github.com/alice/app/pull/7', author: 'alice', comments: 0, createdAt: '' }] },
        failures: []
      }),
      'remote/pull': () => sayOk({
        pull: {
          number: 7, title: 'PR seven', body: '', state: 'open', draft: false, merged: false, mergeable: true,
          author: 'alice', baseBranch: 'main', headBranch: 'feat', additions: 9, deletions: 2, changedFiles: 2,
          commits: 2, statsComplete: true, createdAt: '', updatedAt: '', htmlUrl: 'https://github.com/alice/app/pull/7'
        },
        reviews: [],
        gate: { review: { state: 'pending', approvals: 0, changesRequested: 0 }, test: { state: 'unknown' }, mergeState: null },
        capabilities: { verdicts: ['approve', 'request-changes', 'comment'], reviews: true, mergeMethods: ['merge'], deleteBranch: true, test: false }
      }),
      'remote/pull/ai-review': () => sayOk({
        summary: '整体方向正确，但重试没有上限。',
        verdict: 'request-changes',
        findings: [
          { severity: 'blocker', file: 'src/retry.js', line: 12, title: '重试没有上限', detail: '可能无限重试', suggestion: '加最大次数' },
          { severity: 'nit', file: 'src/retry.js', line: null, title: '命名不一致', detail: '两个变量风格不同', suggestion: '统一命名' }
        ],
        skippedFiles: [
          { filename: 'assets/logo.png', additions: 0, deletions: 0, changes: 0 },
          { filename: 'src/big.js', additions: 900, deletions: 400, changes: 1300 }
        ],
        comment: '1. src/retry.js:12 重试没有上限，建议加最大次数。\n2. 命名建议统一。',
        model: 'p1/m1',
        truncated: false,
        filesIncluded: 2
      }),
      'remote/pull/comment': (payload) => {
        comments.push(payload)
        return sayOk({ posted: true, url: null })
      }
    }
  }, async (panel) => {
    await panel.flush()
    click(panel.all((node) => isHost(node) && hasClass(node, 'dgp-seg-btn'))[2])
    await panel.flush()
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-item') === 'pulls'))
    await panel.flush()

    // 触发 AI 审阅
    const runButton = panel.one((node) => isHost(node) && attr(node, 'data-dgp-pull') === 'ai-run')
    assert(runButton !== null, '应有 AI 审阅按钮')
    // 区块标题已经是「AI 审阅」，按钮必须换一个说法，不能重复
    eq(textOf(runButton), panel.t('pull.aiStart'), '按钮文案应为「开始审阅」')
    click(runButton)
    await panel.flush()

    // 结论：总评 + 编号清单 + 严重度
    const summary = panel.one((node) => isHost(node) && attr(node, 'data-dgp-pull') === 'ai-summary')
    assert(summary !== null, '应显示总评')
    assert(textOf(summary).includes('重试没有上限'), '总评内容：' + textOf(summary))

    const findings = panel.all((node) => isHost(node) && attr(node, 'data-dgp-finding') !== undefined)
    eq(findings.length, 2, '应列出两条问题')
    eq(findings.map((node) => attr(node, 'data-dgp-finding')), ['1', '2'], '问题要编号')
    eq(attr(findings[0], 'data-severity'), 'blocker', '严重度要带上')
    assert(textOf(findings[0]).includes('src/retry.js:12'), '要显示文件与行号：' + textOf(findings[0]))
    assert(textOf(findings[0]).includes('加最大次数'), '要给出调整建议：' + textOf(findings[0]))

    // 平台没给内容的文件要列出来，并显示它有多大
    const skipped = panel.one((node) => isHost(node) && attr(node, 'data-dgp-pull') === 'ai-skipped')
    assert(skipped !== null, '应列出未审阅的文件')
    assert(textOf(skipped).includes('assets/logo.png'), '要有文件名：' + textOf(skipped))
    assert(textOf(skipped).includes('src/big.js'), '第二个文件也要列出')
    assert(textOf(skipped).includes('1300 行'), '要显示改动行数：' + textOf(skipped))

    // 评论草稿：默认是 AI 写的，用户可以改
    const draftBox = panel.one((node) => isHost(node) && attr(node, 'data-dgp-pull') === 'ai-comment')
    assert(draftBox !== null, '应有评论草稿输入框')
    assert(String(draftBox.props.value).includes('重试没有上限'), '草稿默认带 AI 内容')
    assert(typeof draftBox.props.placeholder === 'string' && draftBox.props.placeholder !== '',
      '说明应收进 placeholder，不再单独占一行')

    // 高度自适应：默认至少 6 行
    const baseHeight = Number.parseInt(String(draftBox.props.style.height), 10)
    assert(Number.isFinite(baseHeight) && baseHeight >= 138, '默认高度至少 6 行：' + draftBox.props.style.height)

    // 内容变多：高度跟着长，不需要手动拉
    draftBox.props.onChange({ target: { value: Array.from({ length: 20 }, (_, i) => '第 ' + (i + 1) + ' 条：这里是一条建议').join('\n') } })
    await panel.flush()
    const tallerBox = panel.one((node) => isHost(node) && attr(node, 'data-dgp-pull') === 'ai-comment')
    const tallerHeight = Number.parseInt(String(tallerBox.props.style.height), 10)
    assert(tallerHeight > baseHeight, '内容变多后高度应变高：' + tallerHeight + ' vs ' + baseHeight)

    tallerBox.props.onChange({ target: { value: '我自己改过的评论内容' } })
    await panel.flush()

    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-pull') === 'comment-submit'))
    await panel.flush()
    eq(comments.length, 1, '应提交一次评论')
    eq(comments[0].comment, '我自己改过的评论内容', '提交的是用户编辑后的内容')
    eq(comments[0].number, 7)
    assert(panel.one((node) => isHost(node) && attr(node, 'data-dgp-pull') === 'comment-notice') !== null, '提交后要有提示')
  })
})

test('用例 1R：没配 AI 审阅模型时，报错旁边有「去设置模型」入口', async () => {
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'accounts/list': () => sayOk({
        accounts: [{ id: 'github:alice', provider: 'github', login: 'alice', label: '工作号', providerLabel: 'GitHub' }],
        providers: [{ id: 'github', label: 'GitHub', tokenUrl: 'https://github.com/settings/tokens/new' }]
      }),
      'remote/repos': () => sayOk({
        repos: [{
          fullName: 'alice/app', name: 'app', private: false, description: '', language: 'Go',
          updatedAt: '', sizeKb: 1, defaultBranch: 'main',
          htmlUrl: 'https://github.com/alice/app', cloneUrl: 'https://github.com/alice/app.git',
          provider: 'github', accountId: 'github:alice'
        }],
        page: 1,
        hasMore: false
      }),
      'remote/detail': () => sayOk({
        repo: {
          fullName: 'alice/app', description: '', language: 'Go', private: false, defaultBranch: 'main',
          sizeKb: 1, stars: 0, forks: 0, updatedAt: '', htmlUrl: 'https://github.com/alice/app',
          issuesUrl: 'x', pullsUrl: 'x'
        },
        issues: { total: 0, items: [] },
        pulls: { total: 1, items: [{ number: 7, title: 'PR seven', url: 'x', author: 'alice', comments: 0, createdAt: '' }] },
        failures: []
      }),
      'remote/pull': () => sayOk({
        pull: {
          number: 7, title: 'PR seven', body: '', state: 'open', draft: false, merged: false, mergeable: true,
          author: 'alice', baseBranch: 'main', headBranch: 'feat', additions: 0, deletions: 0, changedFiles: 0,
          commits: 1, statsComplete: true, createdAt: '', updatedAt: '', htmlUrl: 'https://github.com/alice/app/pull/7'
        },
        reviews: [],
        gate: { review: { state: 'pending' }, test: { state: 'unknown' }, mergeState: null },
        capabilities: { verdicts: ['approve'], reviews: true, mergeMethods: ['merge'], deleteBranch: true, test: false }
      }),
      // 宿主明确报「没配审阅模型」
      'remote/pull/ai-review': () => sayFail('no-review-model', '还没有配置 AI 审阅模型（设置页里选「审阅模型」）'),
      'models/list': () => sayOk({ models: [], failed: [] }),
      'settings/get': () => sayOk({ commitModel: null, reviewModel: null })
    }
  }, async (panel) => {
    await panel.flush()
    click(panel.all((node) => isHost(node) && hasClass(node, 'dgp-seg-btn'))[2])
    await panel.flush()
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-item') === 'pulls'))
    await panel.flush()

    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-pull') === 'ai-run'))
    await panel.flush()

    const error = panel.one((node) => isHost(node) && attr(node, 'data-dgp-pull') === 'ai-error')
    assert(error !== null, '应显示错误')
    const jump = panel.one((node) => isHost(node) && attr(node, 'data-dgp-pull') === 'ai-open-settings')
    assert(jump !== null, '错误旁边应有「去设置模型」')
    click(jump)
    await panel.flush()
    assert(panel.one((node) => isHost(node) && attr(node, 'data-dgp-view') === 'settings') !== null,
      '点击后应进入设置页')
  })
})

test('用例 1H：浏览器拦截新窗口时，把令牌页地址原样显示出来', async () => {
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'accounts/list': () => sayOk({
        accounts: [],
        providers: [{ id: 'github', label: 'GitHub', tokenUrl: 'https://github.com/settings/tokens/new?scopes=repo' }]
      }),
      'remote/repos': () => sayOk({ repos: [], page: 1, hasMore: false })
    }
  }, async (panel) => {
    await panel.flush()
    panel.window.openReturns = null // 模拟弹窗被拦截
    click(panel.all((node) => isHost(node) && hasClass(node, 'dgp-seg-btn'))[2])
    await panel.flush()
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote') === 'add-account'))
    await panel.flush()
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote') === 'open-token-page'))
    await panel.flush()

    const hint = panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote') === 'token-hint')
    assert(hint !== null, '被拦截时应有提示')
    const hintText = textOf(hint)
    assert(hintText.includes('拦截'), '要说明被拦截：' + hintText)
    assert(hintText.includes('https://github.com/settings/tokens/new'), '要把地址显示出来：' + hintText)
    eq(panel.window.opened.length, 1, '仍然尝试打开过')
  })
})

test('用例 1E：设置页的账号引导按平台给三步，并能一键打开令牌页面', async () => {
  const added = []
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'models/list': () => sayOk({ models: [], failed: [] }),
      'settings/get': () => sayOk({ commitModel: null }),
      'accounts/list': () => sayOk({
        accounts: [],
        providers: [
          { id: 'github', label: 'GitHub', tokenUrl: 'https://github.com/settings/tokens/new?scopes=repo' },
          { id: 'gitee', label: 'Gitee', tokenUrl: 'https://gitee.com/profile/personal_access_tokens' }
        ]
      }),
      'accounts/add': (payload) => {
        added.push(payload)
        return sayOk({ account: { id: 'github:alice', provider: 'github', login: 'alice', label: 'alice' } })
      }
    }
  }, async (panel) => {
    await panel.flush()
    // 进「远端」页签 → 空态 → 去设置
    click(panel.all((node) => isHost(node) && hasClass(node, 'dgp-seg-btn'))[2])
    await panel.flush()
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-remote') === 'open-settings'))
    await panel.flush()

    const guide = panel.one((node) => isHost(node) && attr(node, 'data-dgp-accounts') === 'guide')
    assert(guide !== null, '设置页应有获取令牌的引导')
    const steps = findOne(guide, (node) => isHost(node) && node.type === 'ol')
    assert(steps !== null, '引导里应有序步骤')
    eq(findAll(steps, (node) => isHost(node) && node.type === 'li').length, 3, '三步')
    assert(textOf(guide).includes('repo'), 'GitHub 引导应提到 repo scope')

    // 一键打开令牌页面
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-accounts') === 'open-token-page'))
    await panel.flush()
    eq(panel.window.opened.length, 1, '应打开一次新页面')
    assert(panel.window.opened[0].url.includes('github.com/settings/tokens'), '打开的是 GitHub 令牌页')

    // 切到 Gitee：步骤跟着换
    const providerSelect = panel.one((node) => isHost(node) && attr(node, 'data-dgp-accounts') === 'provider')
    providerSelect.props.onChange({ target: { value: 'gitee' } })
    await panel.flush()
    const guideAfter = panel.one((node) => isHost(node) && attr(node, 'data-dgp-accounts') === 'guide')
    assert(textOf(guideAfter).includes('projects'), 'Gitee 引导应提到 projects scope')

    // 填令牌并添加：成功后给出「已连接」
    panel.one((node) => isHost(node) && attr(node, 'data-dgp-accounts') === 'token')
      .props.onChange({ target: { value: 'ghp_abc' } })
    await panel.flush()
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-accounts') === 'add'))
    await panel.flush()
    eq(added.length, 1, '应调用一次 accounts/add')
    eq(added[0].provider, 'gitee', '用的是当前选择的平台')
    eq(added[0].token, 'ghp_abc')
    assert(textOf(panel.tree).includes('已连接：alice'), '添加成功应有反馈')
  })
})

test('用例 1v：多仓库时储存库列表列出全部，点另一个仓库切走变更区', async () => {
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT, ROOT_OTHER], PROJECT),
      status: (payload) => (payload.rootPath === ROOT_OTHER.path
        ? sayOk({
          ...statusThree(),
          repoRoot: ROOT_OTHER.path,
          branch: 'dev',
          files: [file({ path: 'only-in-other.js', status: 'M', unstaged: true, adds: 2, dels: 0 })],
          counts: { total: 1, staged: 0, unstaged: 1, untracked: 0, conflicted: 0 }
        })
        : sayOk(statusThree()))
    }
  }, async (panel) => {
    await panel.flush()
    const rows = panel.all((node) => isHost(node) && attr(node, 'data-dgp-repo') !== undefined)
    eq(rows.map((node) => attr(node, 'data-dgp-repo')), [ROOT.id, ROOT_OTHER.id], '储存库行')
    eq(attr(rows[0], 'data-active'), 'true', '默认在第一个仓库')

    const other = rows.find((node) => attr(node, 'data-dgp-repo') === ROOT_OTHER.id)
    click(other)
    await panel.flush()

    assert(panel.fileRow('only-in-other.js') !== null, '变更区应换成第二个仓库的改动')
    assert(panel.fileRow('app.js') === null, '第一个仓库的改动不应还留着')
    eq(attr(panel.one((node) => isHost(node) && attr(node, 'data-dgp-repo') === ROOT_OTHER.id), 'data-active'), 'true', '高亮跟着切')
    eq(attr(panel.one((node) => isHost(node) && attr(node, 'data-dgp-repo') === ROOT.id), 'data-active'), 'false', '旧仓库不再高亮')

    // 折叠储存库区：行消失，标题还在
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-repolist-toggle') !== undefined))
    await panel.flush()
    eq(panel.all((node) => isHost(node) && attr(node, 'data-dgp-repo') !== undefined).length, 0, '折叠后不显示仓库行')
    assert(panel.text().includes('储存库') || panel.text().includes('Repositories'), '折叠后仍有标题')
  })
})

test('用例 1v2：可以在储存库里隐藏仓库，再展开「已隐藏」并取消隐藏', async () => {
  const hiddenCalls = []
  const unhiddenCalls = []
  let currentRoots = [ROOT, ROOT_OTHER]
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk(currentRoots, PROJECT),
      status: () => sayOk(statusThree()),
      'roots/hide': (payload) => {
        hiddenCalls.push(payload)
        currentRoots = [{ ...ROOT }, { ...ROOT_OTHER, hidden: true }]
        return sayOk({ projectRoot: PROJECT, roots: currentRoots, warnings: [] })
      },
      'roots/unhide': (payload) => {
        unhiddenCalls.push(payload)
        currentRoots = [{ ...ROOT }, { ...ROOT_OTHER }]
        return sayOk({ projectRoot: PROJECT, roots: currentRoots, warnings: [] })
      }
    }
  }, async (panel) => {
    await panel.flush()

    eq(panel.all((node) => isHost(node) && attr(node, 'data-dgp-repo-hide') === ROOT.id).length, 0,
      '项目本身没有隐藏按钮')
    const hideButton = panel.one((node) => isHost(node) && attr(node, 'data-dgp-repo-hide') === ROOT_OTHER.id)
    assert(hideButton !== null, '其它仓库行应有隐藏按钮')

    click(hideButton)
    await panel.flush()
    eq(hiddenCalls.length, 1, '应调用一次 roots/hide')
    eq(hiddenCalls[0], { projectRoot: PROJECT, path: ROOT_OTHER.path }, '隐藏载荷')
    eq(panel.all((node) => isHost(node) && attr(node, 'data-dgp-repo') === ROOT_OTHER.id).length, 0,
      '隐藏后那一行不再显示')

    const toggle = panel.one((node) => isHost(node) && attr(node, 'data-dgp-repolist-hidden') !== undefined)
    assert(toggle !== null, '有隐藏仓库时应出现「显示已隐藏」开关')
    click(toggle)
    await panel.flush()

    const hiddenRow = panel.one((node) => isHost(node) && attr(node, 'data-dgp-repo') === ROOT_OTHER.id)
    assert(hiddenRow !== null, '展开后能再次看到该行')
    eq(attr(hiddenRow, 'data-hidden'), 'true', '已隐藏的行带标记')

    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-repo-unhide') === ROOT_OTHER.id))
    await panel.flush()
    eq(unhiddenCalls.length, 1, '应调用一次 roots/unhide')
    eq(unhiddenCalls[0], { projectRoot: PROJECT, path: ROOT_OTHER.path }, '取消隐藏载荷')
    eq(panel.all((node) => isHost(node) && attr(node, 'data-dgp-repolist-hidden') !== undefined).length, 0,
      '没有隐藏仓库后开关消失')
  })
})

test('用例 1w：变更列表的列表 / 树形两种显示方式，设置页与 ⋯ 菜单共用同一个偏好', async () => {
  const nested = {
    repoRoot: PROJECT,
    branch: 'main',
    head: 'abc1234',
    detached: false,
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    files: [
      file({ path: 'src/app.js', status: 'M', unstaged: true, adds: 1, dels: 0 }),
      file({ path: 'src/util.ts', status: 'M', unstaged: true, adds: 1, dels: 0 })
    ],
    counts: { total: 2, staged: 0, unstaged: 2, untracked: 0, conflicted: 0 },
    truncated: false
  }
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(nested),
      'models/list': () => sayOk({ models: [], failed: [] }),
      'settings/get': () => sayOk({ commitModel: null })
    }
  }, async (panel) => {
    await panel.flush()

    // 默认列表模式：两个文件各自一行（没有目录行）
    eq(panel.all((node) => isHost(node) && attr(node, 'data-dgp-row') === 'file').length, 2, '列表模式两个文件行')
    eq(panel.all((node) => isHost(node) && attr(node, 'data-dgp-row') === 'dir').length, 0, '列表模式没有目录行')
    const row = panel.fileRow('src/app.js')
    assert(row !== null, '列表模式要能按路径找到行')
    assert(textOf(row).includes('app.js'), '文件名是主体：' + textOf(row))
    assert(textOf(row).includes('src'), '路径在行内弱化显示：' + textOf(row))

    // 设置页切成树形
    click(panel.one((node) => isHost(node) && attr(node, 'data-action') === 'open-settings'))
    await panel.flush()
    const select = panel.one((node) => isHost(node) && attr(node, 'data-dgp-settings') === 'changes-view')
    assert(select !== null, '设置页应有显示方式选项')
    eq(attr(select, 'value'), 'list', '默认是列表')
    select.props.onChange({ target: { value: 'tree' } })
    await panel.flush()
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-settings') === 'back'))
    await panel.flush()

    // 树形：出现目录行，文件行收在折叠的目录里
    eq(panel.all((node) => isHost(node) && attr(node, 'data-dgp-row') === 'dir').length, 1, '树形模式应有 src 目录行')
    eq(panel.fileRow('src/app.js'), null, '目录折叠时看不到文件行')

    // ⋯ 菜单切回列表（同一个偏好）
    const more = panel.one((node) => isHost(node) && node.type === 'button' && attr(node, 'title') === panel.t('toolbar.more'))
    click(more)
    await panel.flush()
    const toggle = panel.one((node) => isHost(node) && node.type === 'button' && textOf(node).includes('以列表显示'))
    assert(toggle !== null, '树形模式下菜单项应提示「以列表显示」')
    click(toggle)
    await panel.flush()
    eq(panel.all((node) => isHost(node) && attr(node, 'data-dgp-row') === 'file').length, 2, '切回列表后又是两个文件行')
  })
})

test('用例 1x：未跟踪文件可以并进未暂存，也可以单列一组（设置里切）', async () => {
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'models/list': () => sayOk({ models: [], failed: [] }),
      'settings/get': () => sayOk({ commitModel: null })
    }
  }, async (panel) => {
    await panel.flush()
    const groupKeys = () => panel.all((node) => isHost(node) && attr(node, 'data-dgp-group') !== undefined)
      .map((node) => attr(node, 'data-dgp-group'))

    // 默认合并：notes.txt（未跟踪）在「未暂存」里，没有单独的未跟踪组
    eq(groupKeys(), ['staged', 'unstaged'], '默认合并成两组')
    const unstaged = panel.one((node) => isHost(node) && attr(node, 'data-dgp-group') === 'unstaged')
    assert(findAll(unstaged, (node) => isHost(node) && attr(node, 'data-dgp-path') === 'notes.txt').length > 0,
      '未跟踪文件应出现在未暂存组里')
    // 合并模式下这一组的批量按钮是「全部暂存」
    const stageAllButton = panel.one((node) => isHost(node) && attr(node, 'data-dgp-group-action') === 'stage-all')
    assert(stageAllButton !== null, '合并模式的未暂存组应是「全部暂存」')

    // 设置里改成单列
    click(panel.one((node) => isHost(node) && attr(node, 'data-action') === 'open-settings'))
    await panel.flush()
    const select = panel.one((node) => isHost(node) && attr(node, 'data-dgp-settings') === 'untracked-mode')
    assert(select !== null, '设置页应有未跟踪文件的分组选项')
    eq(attr(select, 'value'), 'merge', '默认合并')
    select.props.onChange({ target: { value: 'separate' } })
    await panel.flush()
    click(panel.one((node) => isHost(node) && attr(node, 'data-dgp-settings') === 'back'))
    await panel.flush()

    eq(groupKeys(), ['staged', 'unstaged', 'untracked'], '单列后三组')
    eq(panel.all((node) => isHost(node) && attr(node, 'data-dgp-group-action') === 'stage-untracked').length, 1,
      '未跟踪组的批量按钮应只暂存新文件')
    eq(panel.all((node) => isHost(node) && attr(node, 'data-dgp-group-action') === 'stage-unstaged').length, 1,
      '未暂存组的批量按钮应只暂存已跟踪改动')
  })
})

test('用例 1y：生成提交说明时显示进度，失败时把真实原因显示出来', async () => {
  let pending = null
  let reply = 'pending'
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'models/list': () => sayOk({ models: [], failed: [] }),
      'settings/get': () => sayOk({ commitModel: null }),
      'commit/message': () => {
        if (reply === 'ok') return sayOk({ message: 'feat: 生成好了', model: 'p1/m1', source: 'staged' })
        if (reply === 'error') return sayFail('model-failed', '额度不足，请稍后再试')
        // 挂住不返回：由测试决定它最后成功还是失败
        return new Promise((resolve) => { pending = resolve })
      }
    }
  }, async (panel) => {
    await panel.flush()
    const generate = () => panel.one((node) => isHost(node) && attr(node, 'data-dgp-commit') === 'generate')
    const statusEl = () => panel.one((node) => isHost(node) && attr(node, 'data-dgp-commit') === 'status')

    eq(attr(statusEl(), 'data-kind'), 'hint', '空闲时是提示行')

    click(generate())
    await panel.flush()
    const running = statusEl()
    eq(attr(running, 'data-kind'), 'progress', '生成中状态行切到进度')
    assert(textOf(running).includes('正在生成'), '进度行应带说明文字：' + textOf(running))
    eq(findAll(generate(), (node) => isHost(node) && hasClass(node, 'dgp-spinner')).length, 1,
      '生成按钮里应换成转圈')
    eq(attr(panel.one((node) => isHost(node) && attr(node, 'data-dgp-commit') === 'submit'), 'disabled'), true,
      '生成中提交按钮应禁用')

    // 让它以失败结束：必须显示服务端给的真实原因，而不是字面的 {message}
    assert(pending !== null, '请求没有挂住')
    pending(sayFail('model-failed', '额度不足，请稍后再试'))
    await panel.flush()
    const failed = statusEl()
    eq(attr(failed, 'data-kind'), 'note', '失败后同一条状态行显示结果')
    eq(attr(failed, 'data-tone'), 'error', '错误色调')
    const noteText = textOf(failed)
    assert(noteText.includes('额度不足'), '错误提示要带上真实原因，实际：' + noteText)
    assert(!noteText.includes('{message}'), '占位符不能被原样显示：' + noteText)

    // 成功：说明填进输入框
    reply = 'ok'
    click(generate())
    await panel.flush()
    eq(attr(panel.one((node) => isHost(node) && attr(node, 'data-dgp-commit') === 'input'), 'value'),
      'feat: 生成好了', '生成结果应填进输入框')
  })
})

test('用例 2a：点未暂存文件 → diff 载荷', async () => {
  const status = statusWithBoth()
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(status),
      diff: () => sayOk(diffText())
    }
  }, async (panel) => {
    await panel.flush()

    const frame = panel.changesFrame()
    assert(frame !== null, '没有渲染出变更行')
    const row = panel.fileRow('app.js', frame)
    assert(row !== null, '缺少 app.js 行')

    const mark = panel.router.mark()
    click(row)
    await panel.flush()

    const expected = {
      rootPath: PROJECT,
      path: 'app.js',
      staged: false,
      untracked: false,
      contextLines: 3,
      ignoreWhitespace: false
    }
    const calls = panel.router.all('diff', mark)
    assert(calls.length >= 1, '点选后没有发 diff')
    for (const call of calls) eq(call.payload, expected, 'diff 载荷')
    // 注意：这里不再断言「选中行变绿」——缺陷 #1 让 status 在两次响应之间恒为 null，
    // 点选发生在骨架屏帧上，选中态与行永远不会同时出现（见 xfail 用例 4b）。
  })
})

test('用例 2b：MM 文件从「已暂存」组点选 → staged:true', async () => {
  const status = statusWithBoth()
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(status),
      diff: () => sayOk(diffText())
    }
  }, async (panel) => {
    await panel.flush()

    const frame = panel.changesFrame()
    assert(frame !== null, '没有渲染出变更行')
    // 同一个路径在两个组里各有一行：取 staged 组里那一行 = 「已暂存」视角
    const group = byAttr(frame, 'data-dgp-group', 'staged')[0]
    assert(group !== undefined, '缺少已暂存组')
    const row = findOne(group, (node) => (
      isHost(node) && node.props['data-dgp-path'] === 'both.js' && node.props['data-dgp-row'] === 'file'
    ))
    assert(row !== null, '已暂存组里没有 both.js 行')

    const mark = panel.router.mark()
    const frameMark = panel.frameSeq
    click(row)
    await panel.flush()

    const calls = panel.router.all('diff', mark)
    assert(calls.length >= 1, '点选后没有发 diff')
    for (const call of calls) {
      eq(call.payload, {
        rootPath: PROJECT,
        path: 'both.js',
        staged: true,
        untracked: false,
        contextLines: 3,
        ignoreWhitespace: false
      }, 'MM 文件从已暂存组点选的 diff 载荷')
    }

    // 两侧都有改动 → 面板给出「未暂存 / 已暂存」切换
    const sidesFrame = panel.findFrame((tree) => {
      const labels = findAll(tree, (node) => isHost(node) && hasClass(node, 'dgp-seg-btn')).map(textOf)
      return labels.includes('已暂存') && labels.includes('未暂存')
    }, frameMark)
    assert(sidesFrame !== null, '两侧都有改动时应出现「未暂存/已暂存」切换')
  })
})

/* ================================================================== */
/* 用例 3：文件模式                                                    */
/* ================================================================== */

test('用例 3：文件模式 → tree/list → file/read', async () => {
  const status = statusThree()
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(status),
      'tree/list': () => sayOk({
        entries: [
          { name: 'app.js', type: 'file' },
          { name: 'src', type: 'dir' }
        ],
        truncated: false
      }),
      'file/read': () => sayOk(fileText())
    }
  }, async (panel) => {
    await panel.flush()

    const filesTab = findOne(panel.tree, (node) => (
      isHost(node) && hasClass(node, 'dgp-seg-btn') && textOf(node) === '文件'
    ))
    assert(filesTab !== null, '找不到「文件」段按钮')

    const mark = panel.router.mark()
    click(filesTab)
    await panel.flush()

    eq(attr(panel.class('dgp-root')[0], 'data-mode'), 'files', 'root data-mode 应切到 files')

    // tree/list：根目录列举，path 是空串
    const treeCalls = panel.router.all('tree/list', mark)
    assert(treeCalls.length >= 1, '切到文件模式后没有发 tree/list')
    for (const call of treeCalls) eq(call.payload, { rootPath: PROJECT, path: '' }, 'tree/list 载荷')

    // 目录优先 + 文件行（FileTree 的缓存活在 ref 里，不受缺陷 #1 清 state 影响）
    const fileRows = byAttr(panel.tree, 'data-dgp-row', 'file')
    eq(fileRows.map((node) => attr(node, 'data-dgp-path')), ['app.js'], '文件行')
    eq(byAttr(panel.tree, 'data-dgp-row', 'dir').map((node) => attr(node, 'data-dgp-path')), ['src'], '目录行')

    // 点文件 → file/read
    const readRow = panel.fileRow('app.js')
    assert(readRow !== null, '文件模式里找不到 app.js 行')
    const readMark = panel.router.mark()
    click(readRow)
    await panel.flush()

    const readCalls = panel.router.all('file/read', readMark)
    assert(readCalls.length >= 1, '点文件后没有发 file/read')
    for (const call of readCalls) eq(call.payload, { rootPath: PROJECT, path: 'app.js' }, 'file/read 载荷')
  })
})

/* ================================================================== */
/* 用例 4：刷新重新拉 status（+ 保留选中见 xfail 4b）                   */
/* ================================================================== */

test('用例 4：刷新按钮重新拉 status', async () => {
  const status = statusWithBoth()
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(status),
      diff: () => sayOk(diffText())
    }
  }, async (panel) => {
    await panel.flush()

    const frame = panel.changesFrame()
    const row = panel.fileRow('app.js', frame)
    assert(row !== null, '缺少 app.js 行')
    click(row)
    await panel.flush()

    // 冻结后台请求：确保后数到的 status 调用确实来自刷新按钮
    panel.router.hold()
    await panel.flush()

    // 手动刷新走「⋯」菜单（工具条按钮已移除）

    const mark = panel.router.mark()
    await refreshViaMenu(panel)

    const calls = panel.router.all('status', mark)
    assert(calls.length >= 1, '点刷新没有重新请求 status')
    for (const call of calls) eq(call.payload, { rootPath: PROJECT }, '刷新时 status 载荷')

    // 放行响应：面板应能重新拿到 status（随后再被缺陷清空，见诊断 1）
    const frameMark = panel.frameSeq
    panel.router.release()
    await panel.flush()
    assert(panel.changesFrame(frameMark) !== null, '刷新后应重新渲染出变更行')
  })
})

test('用例 4b：刷新后应保留选中', async () => {
  const status = statusWithBoth()
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(status),
      diff: () => sayOk(diffText())
    }
  }, async (panel) => {
    await panel.flush()

    const frame = panel.changesFrame()
    const row = panel.fileRow('app.js', frame)
    assert(row !== null, '缺少 app.js 行')
    click(row)
    await panel.flush()

    panel.router.hold()
    await panel.flush()

    // 手动刷新走「⋯」菜单（工具条按钮已移除）

    const frameMark = panel.frameSeq
    panel.router.release()
    await refreshViaMenu(panel)
    panel.router.hold()
    await panel.flush()
    panel.router.release()
    await panel.flush()

    // 刷新后 app.js 行仍应是选中态
    const kept = panel.findFrame((tree) => {
      const active = panel.fileRow('app.js', tree)
      return active !== null && attr(active, 'data-active') === 'true'
    }, frameMark)
    assert(kept !== null, '刷新后没有任何一帧显示 app.js 仍被选中')
  })
}, '缺陷 #1：status effect 每帧先 setSelection(null)，选中态在刷新前就已经被清掉，refreshStatus 里的「按 path 重新映射 selection」永远拿到 null。')

/* ================================================================== */
/* 用例 5：切根                                                        */
/* ================================================================== */

test('用例 5：切根会 abort 旧根的 in-flight status 请求', async () => {
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT, ROOT_OTHER], PROJECT),
      status: (payload) => {
        if (payload.rootPath === PROJECT) return new Promise(() => {}) // 旧根：永远在途
        return sayOk({ ...statusThree(), repoRoot: ROOT_OTHER.path, branch: 'dev' })
      }
    }
  }, async (panel) => {
    await panel.flush()

    const otherRow = findOne(panel.tree, (node) => (
      isHost(node) && attr(node, 'data-dgp-repo') === ROOT_OTHER.id
    ))
    assert(otherRow !== null, '储存库列表里找不到第二个仓库')

    const mark = panel.router.mark()
    click(otherRow)
    await panel.flush()

    // 新根有发 status
    const nextCalls = panel.router.all('status', mark)
    assert(nextCalls.length >= 1, '切根后没有为新根发 status')
    assert(nextCalls.every((call) => call.payload.rootPath === ROOT_OTHER.path), '切根后的 status 应指向新根')

    // 旧根的请求必须被 abort（这个断言记录 src 缺陷 #2）
    const stale = panel.router.all('status', 0).filter((call) => call.payload.rootPath === PROJECT)
    assert(stale.length >= 1, '旧根应至少发过一次 status')
    const aborted = stale.filter((call) => call.aborted === true || (call.signal && call.signal.aborted === true))
    eq(aborted.length, stale.length, '旧根的 in-flight status 请求应全部被 abort（实际一个都没 abort）')
  })
}, '缺陷 #2：Panel.js:175 refreshStatus 调 readStatus 时没有传 signal；切根只有 statusSeq 序号守护，没有 abort（与 Panel.js 文件头「切根时 abort 掉旧请求」的约定不符）。')

test('用例 5b：切根后旧根的迟到响应不会覆盖新根', async () => {
  const pending = []
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT, ROOT_OTHER], PROJECT),
      status: (payload) => {
        if (payload.rootPath === PROJECT) {
          return new Promise((resolve) => pending.push(() => resolve(sayOk({
            ...statusThree(),
            files: [file({ path: 'stale-only.js', status: 'M', unstaged: true, adds: 1, dels: 0 })],
            counts: { total: 1, staged: 0, unstaged: 1, untracked: 0, conflicted: 0 }
          }))))
        }
        return sayOk({
          ...statusThree(),
          repoRoot: ROOT_OTHER.path,
          files: [file({ path: 'fresh-only.js', status: 'M', unstaged: true, adds: 5, dels: 0 })],
          counts: { total: 1, staged: 0, unstaged: 1, untracked: 0, conflicted: 0 }
        })
      }
    }
  }, async (panel) => {
    await panel.flush()

    const otherRow = findOne(panel.tree, (node) => (
      isHost(node) && attr(node, 'data-dgp-repo') === ROOT_OTHER.id
    ))
    assert(otherRow !== null, '储存库列表里找不到第二个仓库')

    const mark = panel.router.mark()
    click(otherRow)
    await panel.flush()

    const fresh = panel.findFrame((tree) => findAll(tree, (node) => (
      isHost(node) && node.props['data-dgp-path'] === 'fresh-only.js'
    )).length > 0, mark)
    assert(fresh !== null, '新根的行应渲染')

    // 旧根的响应现在才到：序号守护应丢弃它
    for (const resume of pending.splice(0)) resume()
    const after = panel.frameSeq
    await panel.flush()

    // 旧响应被丢弃时，状态可能完全没变 —— 那就不会提交新帧，所以这里看「当前画面」。
    const staleNow = findAll(panel.tree, (node) => (
      isHost(node) && node.props['data-dgp-path'] === 'stale-only.js'
    ))
    eq(staleNow.length, 0, '旧根的迟到响应不应写回当前画面')
    const freshAfter = findAll(panel.tree, (node) => (
      isHost(node) && node.props['data-dgp-path'] === 'fresh-only.js'
    ))
    assert(freshAfter.length > 0, '新根的行应仍然在（当前画面）')
    const staleFrame = panel.findFrame((tree) => findAll(tree, (node) => (
      isHost(node) && node.props['data-dgp-path'] === 'stale-only.js'
    )).length > 0, after)
    eq(staleFrame, null, '旧根的迟到响应也不应产生任何新帧')
  })
})

/* ================================================================== */
/* 用例 6：status 失败 → 错误文案 + 重试                               */
/* ================================================================== */

test('用例 6：status 失败 → 错误文案 + 重试控件', async () => {
  let fail = true
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => {
        if (fail === true) {
          return {
            ok: false,
            error: { code: 'git-missing', message: 'git not found', details: {} }
          }
        }
        return sayOk(statusThree())
      }
    }
  }, async (panel) => {
    await panel.flush()

    // 错误文案：errorMessageKey('git-missing') → error.gitMissing → 中文文案
    const errorFrame = panel.findFrame((tree) => textOf(tree).includes('系统里找不到 git'))
    assert(errorFrame !== null, '没有任何一帧显示 git-missing 的错误文案，当前文本: ' + panel.text().slice(0, 200))
    const notes = findAll(errorFrame, (node) => (
      isHost(node) && hasClass(node, 'dgp-inline-note') && attr(node, 'data-tone') === 'error'
    ))
    eq(notes.length >= 1, true, '应有 data-tone=error 的行内提示')

    // 重试控件（status 失败态没有专属的行内重试，只能点工具栏刷新；见报告）
    const retry = findOne(panel.tree, (node) => (
      isHost(node) && node.type === 'button' && textOf(node).includes(panel.t('action.retry'))
    ))
    assert(retry !== null, '找不到可重试的控件')

    const mark = panel.router.mark()
    click(retry)
    await panel.flush()
    assert(panel.router.count('status', mark) >= 1, '点重试后没有重新请求 status')

    // 恢复后应重新渲染出正常内容
    fail = false
    const okMark = panel.frameSeq
    click(retry)
    await panel.flush()
    const okFrame = panel.findFrame((tree) => byAttr(tree, 'data-dgp-row', 'file').length === 3, okMark)
    assert(okFrame !== null, '重试成功后应渲染出 3 行')
  })
})

/* ================================================================== */
/* 用例 7：非 git 的浏览根                                             */
/* ================================================================== */

test('用例 7：isGit:false 根 → 非仓库态 → 切文件模式', async () => {
  await withPanel({
    cwd: 'C:/work/plain',
    routes: {
      'project/resolve': () => resolveOk([ROOT_PLAIN], 'C:/work/plain'),
      'tree/list': () => sayOk({
        entries: [{ name: 'readme.md', type: 'file' }],
        truncated: false
      }),
      status: () => { throw new Error('非 git 根不应该请求 status') }
    }
  }, async (panel) => {
    await panel.flush()

    const text = panel.text()
    assert(text.includes('当前目录不是 Git 仓库'), '缺少「不是仓库」文案，实际: ' + text.slice(0, 200))
    eq(panel.router.count('status'), 0, '非 git 根不应发 status')

    // 「不是仓库」空态里的按钮 → 切到文件模式
    const state = panel.class('dgp-state')[0]
    assert(state !== undefined, '缺少空态')
    const actions = oneByClass(state, 'dgp-state-actions')
    assert(actions !== null, '空态缺少 actions')
    const browse = findOne(actions, (node) => isHost(node) && node.type === 'button' && textOf(node) === '文件')
    assert(browse !== null, '空态里没有「文件」按钮')

    const mark = panel.router.mark()
    click(browse)
    await panel.flush()

    eq(attr(panel.class('dgp-root')[0], 'data-mode'), 'files', '应切到文件模式')
    const treeCalls = panel.router.all('tree/list', mark)
    assert(treeCalls.length >= 1, '文件模式应发 tree/list')
    for (const call of treeCalls) eq(call.payload, { rootPath: 'C:/work/plain', path: '' }, '浏览根的 tree/list 载荷')
    eq(panel.router.count('status'), 0, '整个流程都不应发 status')
    eq(panel.fileRow('readme.md') !== null, true, '浏览根的文件应能列出')
  })
})

/* ================================================================== */
/* 用例 2c / 3b：diff 行与文件内容行（xfail）                          */
/* ================================================================== */

test('用例 2c/3b：diff 行与文件内容行应渲染', async () => {
  const status = statusThree()
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(status),
      diff: () => sayOk(diffText()),
      'tree/list': () => sayOk({ entries: [{ name: 'app.js', type: 'file' }], truncated: false }),
      'file/read': () => sayOk(fileText())
    }
  }, async (panel) => {
    await panel.flush()

    // ---- 变更模式：点一行 → DiffView 应画出 diff 行 ----
    const frame = panel.changesFrame()
    const row = panel.fileRow('app.js', frame)
    assert(row !== null, '缺少 app.js 行')
    const mark = panel.frameSeq
    click(row)
    await panel.flush()

    const problems = []
    if (panel.diffFrame(mark) === null) {
      problems.push('diff 行一帧都没渲染出来（DiffView 永远拿不到 diff）')
    }

    // ---- 文件模式：点文件 → FileView 应画出内容行 ----
    const filesTab = findOne(panel.tree, (node) => (
      isHost(node) && hasClass(node, 'dgp-seg-btn') && textOf(node) === '文件'
    ))
    assert(filesTab !== null, '找不到「文件」段按钮')
    click(filesTab)
    await panel.flush()
    const readRow = panel.fileRow('app.js')
    assert(readRow !== null, '文件模式里找不到 app.js 行')
    const readMark = panel.frameSeq
    click(readRow)
    await panel.flush()
    if (panel.fileFrame(readMark) === null) {
      problems.push('编辑器一帧都没渲染出来（FileEditor 永远拿不到 file）')
    }

    eq(problems, [], '渲染结果')
  })
}, '缺陷 #1：status effect 每次渲染都重跑（store.js:124 每次返回新对象 → Panel.js:191/203），它先 setStatus(null)/setSelection(null)，于是 diff/file 请求刚发出就在同一个 pump 的 cleanup 里被 abort（Panel.js:263/292），响应永远到不了 DiffView/FileView。')

/* ================================================================== */
/* ================================================================== */
/* 用例 11：编辑 → 变脏 → 保存（payload 带 expectedHash）                */
/* ================================================================== */

test('用例 11：文件模式编辑后变脏，Ctrl+S 保存带上 expectedHash 并刷新 status', async () => {
  const writes = []
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'tree/list': () => sayOk({ entries: [{ name: 'app.js', type: 'file' }], truncated: false }),
      'file/read': () => sayOk({
        kind: 'text',
        text: 'const a = 1\n',
        size: 12,
        language: 'javascript',
        eol: 'lf',
        bom: false,
        hash: 'hash-v1',
        lines: 1
      }),
      'file/write': () => {
        writes.push('write')
        return sayOk({ size: 20, mtimeMs: 1, hash: 'hash-v2' })
      }
    }
  }, async (panel) => {
    await panel.flush()

    const filesTab = findOne(panel.tree, (node) => (
      isHost(node) && hasClass(node, 'dgp-seg-btn') && textOf(node) === '文件'
    ))
    assert(filesTab !== null, '找不到「文件」段按钮')
    click(filesTab)
    await panel.flush()

    const row = panel.fileRow('app.js')
    assert(row !== null, '找不到 app.js 行')
    click(row)
    await panel.flush()

    const area = findOne(panel.tree, (node) => isHost(node) && node.type === 'textarea')
    assert(area !== null, '没有编辑区')

    // 输入 → 变脏
    area.props.onChange({ target: { value: 'const a = 1\nconst b = 2\n' } })
    await panel.flush()
    const dirtyDot = findOne(panel.tree, (node) => isHost(node) && node.props['data-dirty'] === 'true')
    assert(dirtyDot !== null, '编辑后应出现未保存标记')
    const saveBtn = findOne(panel.tree, (node) => (
      isHost(node) && node.props['data-action'] === 'save'
    ))
    eq(saveBtn.props.disabled, false, '脏时保存按钮应可点')

    // Ctrl+S（编辑器内）→ file/write
    const writer = panel.router.mark()
    const latest = findOne(panel.tree, (node) => isHost(node) && node.type === 'textarea')
    latest.props.onKeyDown({
      key: 's', ctrlKey: true, metaKey: false, altKey: false,
      preventDefault() {},
      currentTarget: { value: 'const a = 1\nconst b = 2\n', selectionStart: 0, selectionEnd: 0 }
    })
    await panel.flush()

    const calls = panel.router.all('file/write', writer)
    eq(calls.length, 1, '应只保存一次')
    eq(calls[0].channel, '/api', 'channel')
    const payload = calls[0].payload
    eq(payload.rootPath, PROJECT, 'rootPath')
    eq(payload.path, 'app.js', 'path')
    eq(payload.text, 'const a = 1\nconst b = 2\n', 'text 是编辑后的内容')
    eq(payload.expectedHash, 'hash-v1', '必须带读取时拿到的 hash')
    eq(payload.eol, 'lf', 'eol 原样回传')
    eq(payload.bom, false, 'bom 原样回传')
    eq(payload.force, undefined, '普通保存不应带 force')

    // 保存成功：脏标记消失 + 提示已保存 + status 被刷新
    const dirtyLeft = findOne(panel.tree, (node) => isHost(node) && node.props['data-dirty'] === 'true')
    assert(dirtyLeft === null, '保存后不应再有未保存标记')
    assert(/已保存 \d{2}:\d{2}:\d{2}/.test(panel.text()), '应显示已保存提示，实际: ' + panel.text().slice(0, 160))
    assert(panel.router.all('status', writer).length >= 1, '保存后应刷新 status')
  })
})

/* ================================================================== */
/* 用例 12：外部改动 → 冲突 → 重新加载 / 覆盖保存                        */
/* ================================================================== */

test('用例 12：磁盘改动导致冲突时给出两个显式选择', async () => {
  let readRound = 0
  const writes = []
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'tree/list': () => sayOk({ entries: [{ name: 'app.js', type: 'file' }], truncated: false }),
      'file/read': () => {
        readRound += 1
        return sayOk({
          kind: 'text',
          text: readRound === 1 ? 'v1\n' : 'external\n',
          size: 3,
          language: 'text',
          eol: 'lf',
          bom: false,
          hash: readRound === 1 ? 'hash-v1' : 'hash-ext',
          lines: 1
        })
      },
      'file/write': (payload) => {
        writes.push(payload)
        if (payload.force === true) return sayOk({ size: 9, mtimeMs: 2, hash: 'hash-forced' })
        return sayFail('conflict', '文件在磁盘上已被修改')
      }
    }
  }, async (panel) => {
    await panel.flush()
    const filesTab = findOne(panel.tree, (node) => (
      isHost(node) && hasClass(node, 'dgp-seg-btn') && textOf(node) === '文件'
    ))
    click(filesTab)
    await panel.flush()
    click(panel.fileRow('app.js'))
    await panel.flush()

    // 改内容后保存 → 宿主回冲突
    findOne(panel.tree, (node) => isHost(node) && node.type === 'textarea')
      .props.onChange({ target: { value: 'mine\n' } })
    await panel.flush()
    click(findOne(panel.tree, (node) => isHost(node) && node.props['data-action'] === 'save'))
    await panel.flush()

    eq(writes.length, 1, '应尝试保存一次')
    const bar = findOne(panel.tree, (node) => isHost(node) && node.props['data-conflict'] === 'true')
    assert(bar !== null, '冲突时应出现冲突条')
    const actions = findAll(panel.tree, (node) => (
      isHost(node) && (node.props['data-action'] === 'reload' || node.props['data-action'] === 'overwrite')
    )).map((node) => node.props['data-action'])
    eq(actions.sort(), ['overwrite', 'reload'], '冲突条应给出两个显式选择')

    // 覆盖保存：显式带 force，且不带 expectedHash
    click(findOne(panel.tree, (node) => isHost(node) && node.props['data-action'] === 'overwrite'))
    await panel.flush()
    eq(writes.length, 2, '应再次写入')
    eq(writes[1].force, true, '覆盖保存必须显式 force')
    eq(writes[1].expectedHash, undefined, '覆盖保存不应伪装成带凭据的保存')
    eq(writes[1].text, 'mine\n', '覆盖的是本地内容')
  })
})

/* ================================================================== */
/* 用例 13：切走再切回，未保存的草稿还在                                  */
/* ================================================================== */

test('用例 13：切到别的文件再切回，未保存改动仍在（草稿按路径保留）', async () => {
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'tree/list': () => sayOk({
        entries: [{ name: 'app.js', type: 'file' }, { name: 'b.js', type: 'file' }],
        truncated: false
      }),
      'file/read': (payload) => sayOk({
        kind: 'text',
        text: payload.path === 'app.js' ? 'A\n' : 'B\n',
        size: 2,
        language: 'text',
        eol: 'lf',
        bom: false,
        hash: payload.path === 'app.js' ? 'hash-a' : 'hash-b',
        lines: 1
      })
    }
  }, async (panel) => {
    await panel.flush()
    click(findOne(panel.tree, (node) => isHost(node) && hasClass(node, 'dgp-seg-btn') && textOf(node) === '文件'))
    await panel.flush()

    click(panel.fileRow('app.js'))
    await panel.flush()
    findOne(panel.tree, (node) => isHost(node) && node.type === 'textarea')
      .props.onChange({ target: { value: 'A-edited\n' } })
    await panel.flush()

    // 切到 b.js
    click(panel.fileRow('b.js'))
    await panel.flush()
    const bArea = findOne(panel.tree, (node) => isHost(node) && node.type === 'textarea')
    eq(bArea.props.value, 'B\n', 'b.js 应是磁盘内容')

    // 切回 app.js：草稿还在，且文件树上有脏点
    click(panel.fileRow('app.js'))
    await panel.flush()
    const aArea = findOne(panel.tree, (node) => isHost(node) && node.type === 'textarea')
    eq(aArea.props.value, 'A-edited\n', '切回后未保存的改动必须还在')
    const dirtyRow = findOne(panel.tree, (node) => (
      isHost(node) && node.props['data-dgp-path'] === 'app.js' && node.props['data-dirty'] === 'true'
    ))
    assert(dirtyRow !== null, '文件树上该有未保存脏点')
  })
})
/* 诊断 1：面板应当稳定（xfail）                                        */
/* ================================================================== */

/* ================================================================== */
/* 用例 8：文件模式刷新 —— 保留选中 + 重读文件内容                        */
/* ================================================================== */

test('用例 8：文件模式下刷新不清空选中，并重读文件内容', async () => {
  const reads = []
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'tree/list': () => sayOk({
        entries: [{ name: 'README.md', type: 'file' }],
        truncated: false
      }),
      'file/read': () => {
        reads.push(1)
        return sayOk(fileText())
      }
    }
  }, async (panel) => {
    await panel.flush()

    const filesTab = findOne(panel.tree, (node) => (
      isHost(node) && hasClass(node, 'dgp-seg-btn') && textOf(node) === '文件'
    ))
    assert(filesTab !== null, '找不到「文件」段按钮')
    click(filesTab)
    await panel.flush()

    // README.md 是「未修改」的文件：它不在 status.files 里
    const row = panel.fileRow('README.md')
    assert(row !== null, '找不到 README.md 行')
    click(row)
    await panel.flush()
    assert(reads.length >= 1, '点文件后没有读文件')
    const before = reads.length

    // 手动刷新走「⋯」菜单（工具条按钮已移除）
    await refreshViaMenu(panel)

    // ① 选中不能被清空（根因：刷新时不该拿 status.files 去校验「路径型选中」）
    const active = findOne(panel.tree, (node) => (
      isHost(node) && node.props['data-dgp-path'] === 'README.md' && node.props['data-active'] === 'true'
    ))
    assert(active !== null, '刷新后选中被清空了：文件模式下刷新不应清空正在浏览的文件')

    // ② 主动刷新要重读文件内容（文件模式没有轮询，这是唯一的手动更新入口）
    assert(reads.length > before, '刷新没有重读文件内容')
    const area = findOne(panel.tree, (node) => isHost(node) && node.type === 'textarea')
    assert(area !== null, '刷新后编辑区应仍在画面上')
    assert(String(area.props.value).includes('function demo'), '刷新后文件内容应仍在编辑区')
  })
})

/* ================================================================== */
/* 用例 9：变更模式刷新 —— 文件从 status 消失则清空选中                    */
/* ================================================================== */

test('用例 9：变更模式下刷新，文件消失则清空选中与 diff', async () => {
  let round = 0
  const after = statusThree()
  after.files = after.files.filter((entry) => entry.path !== 'app.js')
  after.counts = { total: 2, staged: 1, unstaged: 0, untracked: 1, conflicted: 0 }

  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => {
        round += 1
        return sayOk(round === 1 ? statusThree() : after)
      },
      diff: () => sayOk(diffText())
    }
  }, async (panel) => {
    await panel.flush()

    const appRow = panel.fileRow('app.js')
    assert(appRow !== null, '找不到 app.js 行')
    click(appRow)
    await panel.flush()
    assert(panel.text().includes('const c = 4'), '选中后 diff 没渲染出来')

    // 手动刷新走「⋯」菜单（工具条按钮已移除）
    await refreshViaMenu(panel)

    // 文件已不在 status 里 → 选中清空、diff 区域回到空态
    const stillActive = findOne(panel.tree, (node) => (
      isHost(node) && node.props['data-dgp-path'] === 'app.js' && node.props['data-active'] === 'true'
    ))
    assert(stillActive === null, '文件已从 status 消失，选中应被清空')
    assert(!panel.text().includes('const c = 4'), '文件消失后 diff 应清空')
    assert(panel.fileRow('app.js') === null, 'app.js 行本身也应消失')
  })
})

/* ================================================================== */
/* 用例 10：刷新按钮提示带上次刷新时刻                                    */
/* ================================================================== */

/* ================================================================== */
/* 用例 10a：版本号 chip = 当前提交短 SHA，点击 = 检测更新               */
/* ================================================================== */

test('用例 10a：点版本号触发 git fetch 检测更新，并给出结果与刷新 status', async () => {
  const checks = []
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk({ ...statusThree(), remoteUrl: 'git@github.com:owner/repo.git' }),
      'remote/fetch': () => {
        checks.push('fetch')
        return sayOk({
          url: 'git@github.com:owner/repo.git',
          branch: 'main',
          head: 'abc1234',
          upstream: 'origin/main',
          ahead: 0,
          behind: 3,
          fetchedAt: Date.now()
        })
      }
    }
  }, async (panel) => {
    await panel.flush()

    const chip = findOne(panel.tree, (node) => (
      isHost(node) && node.type === 'button' && attr(node, 'data-action') === 'check-updates'
    ))
    assert(chip !== null, '找不到版本号按钮')
    eq(textOf(chip), 'abc1234', '版本号应显示提交短 SHA')
    assert(textOf(chip).length > 0, '版本号不应为空')

    const mark = panel.router.mark()
    click(chip)
    await panel.flush()

    eq(checks.length, 1, '点一次只应检测一次')
    const fetchCalls = panel.router.all('remote/fetch', mark)
    eq(fetchCalls.length, 1, '应调用 remote/fetch')
    eq(fetchCalls[0].payload, { rootPath: PROJECT }, 'remote/fetch 载荷')

    const note = findOne(panel.tree, (node) => isHost(node) && node.props['data-update-note'] !== undefined)
    assert(note !== null, '应显示检测结果')
    eq(attr(note, 'data-update-note'), 'warn', '落后时应是 warn')
    assert(textOf(note).includes('落后 3 个提交'), '结果文案：' + textOf(note))
    assert(textOf(note).includes('origin/main'), '结果里应带上游名')

    // 结果贴在版本号左边，不单独占一行
    const toolbar = panel.one((node) => isHost(node) && hasClass(node, 'dgp-toolbar'))
    assert(findOne(toolbar, (node) => isHost(node) && attr(node, 'data-update-note') !== undefined) !== null,
      '检测结果应在工具条里')
    eq(panel.class('dgp-notebar').length, 0, '不应再单独起一行提示')

    assert(panel.router.all('status', mark).length >= 1, '检测后应刷新 status（fetch 改了远端跟踪引用）')
  })
})

/* ================================================================== */
/* 用例 10b：已是最新 / 无远端的呈现                                    */
/* ================================================================== */

test('用例 10b：已是最新时给 info 提示', async () => {
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk({ ...statusThree(), remoteUrl: 'https://github.com/owner/repo.git' }),
      'remote/fetch': () => sayOk({
        url: 'https://github.com/owner/repo.git',
        branch: 'main', head: 'abc1234', upstream: 'origin/main',
        ahead: 0, behind: 0, fetchedAt: Date.now()
      })
    }
  }, async (panel) => {
    await panel.flush()
    click(findOne(panel.tree, (node) => isHost(node) && attr(node, 'data-action') === 'check-updates'))
    await panel.flush()
    const note = findOne(panel.tree, (node) => isHost(node) && node.props['data-update-note'] !== undefined)
    eq(attr(note, 'data-update-note'), 'info')
    assert(textOf(note).includes('已是最新'), '文案：' + textOf(note))
  })
})

test('用例 10c：远端检测失败 → 错误提示（不留"看起来成功"的状态）', async () => {
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(statusThree()),
      'remote/fetch': () => sayFail('no-remote', '这个仓库没有配置远端（origin）')
    }
  }, async (panel) => {
    await panel.flush()
    click(findOne(panel.tree, (node) => isHost(node) && attr(node, 'data-action') === 'check-updates'))
    await panel.flush()
    const note = findOne(panel.tree, (node) => isHost(node) && node.props['data-update-note'] !== undefined)
    eq(attr(note, 'data-update-note'), 'error')
    assert(textOf(note).includes('检测更新失败'), '文案：' + textOf(note))
  })
})

/* ================================================================== */
/* 用例 10d：打开 Git 仓库（远端地址 → https，本地路径则禁用）           */
/* ================================================================== */

test('用例 10d：点「打开仓库」在新标签打开转换后的 https 地址', async () => {
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk({ ...statusThree(), remoteUrl: 'git@github.com:owner/repo.git' })
    }
  }, async (panel) => {
    await panel.flush()
    const open = findOne(panel.tree, (node) => (
      isHost(node) && node.type === 'button' && attr(node, 'data-action') === 'open-remote'
    ))
    assert(open !== null, '找不到「打开仓库」按钮')
    eq(open.props.disabled, false, '有远端时应可点')
    click(open)
    const opened = panel.window.opened
    eq(opened.length, 1, '应调用一次 window.open')
    eq(opened[0].url, 'https://github.com/owner/repo', 'scp 形式应转成 https')
    eq(opened[0].target, '_blank', '新标签打开')
  })
})

test('用例 10e：没有远端（或本地路径远端）时「打开仓库」禁用', async () => {
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk({ ...statusThree(), remoteUrl: 'C:\\repos\\local-only' })
    }
  }, async (panel) => {
    await panel.flush()
    const open = findOne(panel.tree, (node) => (
      isHost(node) && node.type === 'button' && attr(node, 'data-action') === 'open-remote'
    ))
    assert(open !== null, '找不到「打开仓库」按钮')
    eq(open.props.disabled, true, '本地路径远端没有网页可开，按钮必须禁用')
  })
})


test('诊断 1：空闲时画面应当稳定，不应在内容/骨架屏之间摆动', async () => {
  const status = statusThree()
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(status)
    }
  }, async (panel) => {
    await panel.flush()

    // 稳定态：当前画面就是 3 行
    eq(byAttr(panel.tree, 'data-dgp-row', 'file').length, 3, '空闲时当前画面应稳定显示 3 行')

    const mark = panel.frameSeq
    await panel.flush()
    const frames = panel.framesSince(mark)
    const withSkeleton = frames.filter((frame) => byClass(frame.tree, 'dgp-skeleton').length > 0)
    console.log('       (空闲一轮: ' + frames.length + ' 帧提交, ' + withSkeleton.length + ' 帧是骨架屏)')
    eq(withSkeleton.length, 0, '空闲时不应提交「骨架屏」帧（面板在内容与骨架屏之间无限摆动）')
    // 状态没变就不该有反复提交：最多允许一次收敛帧
    assert(frames.length <= 1, '空闲时不应反复提交渲染（实际 ' + frames.length + ' 帧）')
  })
})

/* ================================================================== */
/* 诊断 2：空闲时不应重复请求（xfail）                                  */
/* ================================================================== */

test('诊断 2：空闲时不应重复请求同一份 status', async () => {
  const status = statusThree()
  await withPanel({
    routes: {
      'project/resolve': () => resolveOk([ROOT], PROJECT),
      status: () => sayOk(status)
    }
  }, async (panel) => {
    await panel.flush()

    const first = panel.router.count('status')
    await panel.flush()
    const second = panel.router.count('status')
    await panel.flush()
    const third = panel.router.count('status')

    console.log('       (status 调用次数: ' + first + ' → ' + second + ' → ' + third + ')')
    eq(second, first, '空闲一轮后 status 调用次数不应增加')
    eq(third, second, '再空闲一轮后 status 调用次数不应再增加')
  })
}, '缺陷 #1 的另一个后果：每个响应都会触发两遍渲染，两遍都重跑 status effect，于是每个响应又换出两个新请求（面板空闲时也在刷 RPC）。')

/* ================================================================== */
/* 跑                                                                */
/* ================================================================== */

let passed = 0
let failed = 0
let xfailed = 0

for (const item of cases) {
  try {
    await item.fn()
    if (item.expect === 'fail') {
      failed += 1
      console.log('  XPASS ' + item.name)
      console.log('        这个用例本来预期失败（缺陷已修？）：' + (item.note ?? ''))
    } else {
      passed += 1
      console.log('  ok    ' + item.name)
    }
  } catch (error) {
    if (item.expect === 'fail') {
      xfailed += 1
      console.log('  xfail ' + item.name)
      console.log('        已知缺陷：' + (item.note ?? ''))
      console.log('        未通过断言：' + (error && error.message ? error.message : String(error)).split('\n')[0])
    } else {
      failed += 1
      console.log('  FAIL  ' + item.name)
      console.log('        ' + (error && error.message ? error.message : String(error)))
    }
  }
}

console.log('')
if (failed > 0) {
  console.error(failed + ' failed, ' + passed + ' passed, ' + xfailed + ' xfailed')
  process.exit(1)
}
console.log(passed + ' passed' + (xfailed > 0 ? ', ' + xfailed + ' xfail（已记录 src 缺陷）' : ''))
