/**
 * test/components.test.mjs —— 组件级渲染冒烟（不需要浏览器）
 *
 * 通过产物上的 `__modules` 测试钩子直接取组件模块，用假 react 渲染成宿主元素树，
 * 断言关键 DOM 结构。这是没有浏览器时对 DiffView / FileView / ChangesList /
 * FileTree / States / RootPicker 唯一的结构性验证。
 *
 * 运行：node test/components.test.mjs   （需先 node build/build-client.mjs）
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

/* ------------------------------- 假 react ------------------------------- */

function createFakeReact() {
  let frame = null

  function createElement(type, props, ...children) {
    const flat = children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false && child !== true)
    return { $$el: true, type, props: props ?? {}, children: flat }
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

  function render(node) {
    if (node === null || node === undefined || node === false || node === true) return null
    if (Array.isArray(node)) return node.map(render).filter((child) => child !== null)
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (node.$$el !== true) return null
    if (typeof node.type === 'function') {
      const previous = frame
      frame = { slots: [], cursor: 0 }
      try {
        return render(node.type({ ...node.props, children: node.children }))
      } finally {
        frame = previous
      }
    }
    return { $$host: true, type: node.type, props: node.props, children: node.children.map(render).filter((child) => child !== null) }
  }

  return { createElement, Fragment: 'Fragment', useState, useRef: (v) => ({ current: v }), useMemo: (fn) => fn(), useCallback: (fn) => fn, useEffect: () => {}, useLayoutEffect: () => {}, render }
}

function collect(node, predicate, out = []) {
  if (node === null || node === undefined) return out
  if (Array.isArray(node)) {
    for (const child of node) collect(child, predicate, out)
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

/* --------------------------- 装载产物 + 假 ctx --------------------------- */

const bundle = await readFile(BUNDLE_PATH, 'utf8')
const fakeReact = createFakeReact()
let factory = null
const fakeDocument = {
  styleSheets: [],
  appended: [],
  head: {
    appendChild(node) {
      this.children = this.children ?? []
      this.children.push(node)
      fakeDocument.appended.push(node)
      return node
    }
  },
  getElementById() {
    return null
  },
  createElement(tag) {
    return { tagName: String(tag).toUpperCase(), id: '', textContent: '' }
  },
  visibilityState: 'visible',
  hasFocus: () => true,
  addEventListener() {},
  removeEventListener() {},
  body: { style: {} }
}

const fakeWindow = {
  __ModuleLoader__: {
    load(definition) {
      factory = definition.factory
    }
  },
  addEventListener() {},
  removeEventListener() {},
  innerWidth: 1280,
  innerHeight: 800,
  setTimeout,
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {}
}

const fakeRequire = (id) => {
  if (id === 'react') return fakeReact
  throw new Error('missed the module table: ' + id)
}

const loader = new Function('window', 'document', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'require', 'localStorage',
  'return (function(){ ' + bundle + ' })()')
loader(fakeWindow, fakeDocument, setTimeout, clearTimeout, () => 0, () => {}, fakeRequire, undefined)

const exportsObject = factory(fakeRequire)
const loadModule = (id) => exportsObject.__modules(id)
const renderComponent = (component, props) => fakeReact.render(fakeReact.createElement(component, props))
const tKey = (key, params) => (params === undefined ? key : key + JSON.stringify(params))

const statusFixture = {
  repoRoot: 'C:/work/project',
  branch: 'main',
  head: 'abc1234',
  detached: false,
  upstream: 'origin/main',
  ahead: 1,
  behind: 0,
  files: [
    { path: 'src/app.js', status: 'M', staged: false, unstaged: true, untracked: false, conflicted: false, adds: 3, dels: 1, binary: false },
    { path: 'src/util.ts', status: 'M', staged: true, unstaged: false, untracked: false, conflicted: false, adds: 2, dels: 0, binary: false },
    { path: 'src/both.js', status: 'M', staged: true, unstaged: true, untracked: false, conflicted: false, adds: 1, dels: 1, binary: false },
    { path: 'docs/new.md', status: 'A', staged: true, unstaged: false, untracked: false, conflicted: false, adds: 9, dels: 0, binary: false },
    { path: 'src/gone.txt', status: 'D', staged: false, unstaged: true, untracked: false, conflicted: false, adds: 0, dels: 4, binary: false },
    { path: 'notes/todo.md', status: '?', staged: false, unstaged: false, untracked: true, conflicted: false, adds: 0, dels: 0, binary: false },
    { path: 'README.md', status: 'M', staged: false, unstaged: true, untracked: false, conflicted: false, adds: 1, dels: 0, binary: false }
  ],
  counts: { total: 7, staged: 3, unstaged: 3, untracked: 1, conflicted: 0 },
  truncated: false
}

const diffFixture = {
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

/* --------------------------------- 用例 --------------------------------- */

test('DiffView（统一视图）：行 / 状态字母 / 计数都在', () => {
  const { DiffView } = loadModule('./components/DiffView.js')
  const tree = renderComponent(DiffView, {
    diff: diffFixture, loading: false, error: null, path: 'src/app.js',
    entry: statusFixture.files[0], view: 'unified', wrap: false, onRetry: () => {}, t: tKey
  })
  eq(collect(tree, (node) => classOf(node).split(' ').includes('dgp-viewer')).length, 1, '.dgp-viewer')
  const rows = collect(tree, (node) => node.$$host === true && node.props['data-kind'] !== undefined && classOf(node).includes('dgp-diff-row'))
  assert(rows.length >= 5, 'diff 行太少：' + rows.length)
  const kinds = rows.map((row) => row.props['data-kind'])
  assert(kinds.includes('add') && kinds.includes('del') && kinds.includes('ctx'), '缺行类型: ' + kinds.join(','))
  assert(collect(tree, (node) => classOf(node).includes('dgp-diff-mark')).length > 0, '缺少词级高亮 mark')
  assert(textOf(tree).includes('const c = 4'), '缺少行内容')
})

test('DiffView（并排视图）：两列', () => {
  const { DiffView } = loadModule('./components/DiffView.js')
  const tree = renderComponent(DiffView, {
    diff: diffFixture, loading: false, error: null, path: 'src/app.js',
    entry: statusFixture.files[0], view: 'split', wrap: false, onRetry: () => {}, t: tKey
  })
  eq(collect(tree, (node) => classOf(node).split(' ').includes('dgp-diff-columns')).length, 1, '.dgp-diff-columns')
  eq(collect(tree, (node) => classOf(node).split(' ').includes('dgp-diff-col')).length, 2, '并排应有两列')
})

test('DiffView：各种 kind 不崩', () => {
  const { DiffView } = loadModule('./components/DiffView.js')
  for (const kind of ['binary', 'oversized', 'empty', 'submodule', 'deleted', 'directory', 'error']) {
    const tree = renderComponent(DiffView, {
      diff: { kind, hunks: [], stats: { adds: 0, dels: 0 } }, loading: false, error: null,
      path: 'x.bin', entry: statusFixture.files[0], view: 'unified', wrap: false, onRetry: () => {}, t: tKey
    })
    assert(tree !== null, kind + ' 渲染为 null')
  }
})

test('FileEditor：文本 → textarea + 行号列', () => {
  const { FileEditor } = loadModule('./components/FileEditor.js')
  const tree = renderComponent(FileEditor, {
    record: { kind: 'text', text: 'const a = 1\nconst b = 2\n', size: 24, language: 'javascript', lines: 2, hash: 'h1', bom: false, eol: 'lf' },
    text: 'const a = 1\nconst b = 2\n',
    loading: false, error: null, path: 'src/app.js', wrap: false,
    dirty: false, busy: false, conflict: null, savedAt: 0, saveError: null,
    onChange: () => {}, onSave: () => {}, onReload: () => {}, onOverwrite: () => {}, onRetry: () => {}, t: tKey
  })
  const areas = collect(tree, (node) => node.$$host === true && node.type === 'textarea')
  eq(areas.length, 1, '应有一个 textarea')
  eq(areas[0].props.value, 'const a = 1\nconst b = 2\n', 'textarea 内容来自 text prop')
  eq(areas[0].props['data-role'], 'editor', 'data-role')
  eq(areas[0].props.spellCheck, false, '应关闭拼写检查')
  const lns = collect(tree, (node) => classOf(node).split(' ').includes('dgp-editor-ln'))
  eq(lns.map(textOf), ['1', '2'], '行号列')
  const save = collect(tree, (node) => node.$$host === true && node.props['data-action'] === 'save')
  eq(save.length, 1, '应有保存按钮')
  eq(save[0].props.disabled, true, '不脏时保存按钮应禁用')
})

test('FileEditor：脏 / 保存中 / 冲突 / 刚保存 的状态呈现', () => {
  const { FileEditor } = loadModule('./components/FileEditor.js')
  const base = {
    record: { kind: 'text', text: 'a\n', size: 2, language: 'text', lines: 1, hash: 'h1', bom: false, eol: 'lf' },
    text: 'a\nb\n', loading: false, error: null, path: 'x.txt', wrap: false,
    busy: false, savedAt: 0, saveError: null,
    onChange: () => {}, onSave: () => {}, onReload: () => {}, onOverwrite: () => {}, onRetry: () => {}, t: tKey
  }
  // 有未保存改动：脏点 + 保存按钮可用
  const dirtyTree = renderComponent(FileEditor, { ...base, dirty: true, conflict: null })
  assert(collect(dirtyTree, (node) => node.props['data-dirty'] === 'true').length >= 1, '缺少未保存标记')
  eq(collect(dirtyTree, (node) => node.props['data-action'] === 'save')[0].props.disabled, false, '脏时保存应可点')

  // 冲突：出现冲突条与两个动作
  const conflictTree = renderComponent(FileEditor, { ...base, dirty: true, conflict: { path: 'x.txt' } })
  eq(collect(conflictTree, (node) => node.props['data-conflict'] === 'true').length, 1, '缺少冲突条')
  assert(collect(conflictTree, (node) => node.props['data-action'] === 'reload').length === 1, '缺少重新加载')
  assert(collect(conflictTree, (node) => node.props['data-action'] === 'overwrite').length === 1, '缺少覆盖保存')

  // 刚保存过：显示已保存时刻（tKey 会带上插值参数）
  const savedTree = renderComponent(FileEditor, { ...base, dirty: false, conflict: null, savedAt: Date.now() })
  assert(/editor\.saved\{"time":"\d{2}:\d{2}:\d{2}"\}/.test(textOf(savedTree)), '应显示已保存时刻，实际: ' + textOf(savedTree).slice(0, 160))
})

test('FileEditor：不可编辑的读取结果不出现输入框', () => {
  const { FileEditor } = loadModule('./components/FileEditor.js')
  const base = {
    text: null, loading: false, error: null, path: 'a.bin', wrap: false,
    dirty: false, busy: false, conflict: null, savedAt: 0, saveError: null,
    onChange: () => {}, onSave: () => {}, onReload: () => {}, onOverwrite: () => {}, onRetry: () => {}, t: tKey
  }
  for (const kind of ['binary', 'oversized', 'missing', 'directory', 'other', 'error']) {
    const tree = renderComponent(FileEditor, { ...base, record: { kind, size: 10, message: 'm' } })
    assert(tree !== null, kind + ' 渲染为 null')
    eq(collect(tree, (node) => node.$$host === true && node.type === 'textarea').length, 0, kind + ' 不应出现输入框')
  }
})

test('FileEditor：wrap 开启时不画行号（避免与折行错位）', () => {
  const { FileEditor } = loadModule('./components/FileEditor.js')
  const record = { kind: 'text', text: 'a\nb\nc\n', size: 6, language: 'text', lines: 3, hash: 'h', bom: false, eol: 'lf' }
  const props = {
    record, text: record.text, loading: false, error: null, path: 'x.txt',
    dirty: false, busy: false, conflict: null, savedAt: 0, saveError: null,
    onChange: () => {}, onSave: () => {}, onReload: () => {}, onOverwrite: () => {}, onRetry: () => {}, t: tKey
  }
  const wrapped = renderComponent(FileEditor, { ...props, wrap: true })
  eq(collect(wrapped, (node) => classOf(node).split(' ').includes('dgp-editor-ln')).length, 0, 'wrap 时不应有行号')
  const plain = renderComponent(FileEditor, { ...props, wrap: false })
  eq(collect(plain, (node) => classOf(node).split(' ').includes('dgp-editor-ln')).length, 3, '不 wrap 时应有三行行号')
})
test('ChangesList：四组齐全 + 数据钩子', () => {
  const { ChangesList } = loadModule('./components/ChangesList.js')
  const tree = renderComponent(ChangesList, {
    status: statusFixture, loading: false, error: null, selectedPath: 'README.md',
    onSelect: () => {}, filter: '', onFilterChange: () => {}, collapsedGroups: {}, onToggleGroup: () => {}, t: tKey
  })
  const keys = collect(tree, (node) => node.$$host === true && node.props['data-dgp-group'] !== undefined).map((node) => node.props['data-dgp-group'])
  for (const group of ['staged', 'unstaged', 'untracked']) assert(keys.includes(group), '缺少分组 ' + group)
  const paths = collect(tree, (node) => node.$$host === true && typeof node.props['data-dgp-path'] === 'string').map((node) => node.props['data-dgp-path'])
  assert(paths.length > 0, '没有 data-dgp-path 钩子')
  assert(collect(tree, (node) => node.$$host === true && node.props['data-active'] === 'true').length >= 1, '缺少选中态')
})

test('ChangesList：空工作区 / 加载中 / 报错', () => {
  const { ChangesList } = loadModule('./components/ChangesList.js')
  const base = { onSelect: () => {}, filter: '', onFilterChange: () => {}, collapsedGroups: {}, onToggleGroup: () => {}, t: tKey }
  const clean = renderComponent(ChangesList, { ...base, status: { ...statusFixture, files: [], counts: { total: 0, staged: 0, unstaged: 0, untracked: 0, conflicted: 0 } }, loading: false, error: null, selectedPath: null })
  assert(textOf(clean).includes('status.clean'), '空工作区文案缺失')
  assert(renderComponent(ChangesList, { ...base, status: null, loading: true, error: null, selectedPath: null }) !== null, '加载态渲染为 null')
  assert(renderComponent(ChangesList, { ...base, status: null, loading: false, error: 'boom', selectedPath: null }) !== null, '错误态渲染为 null')
})

test('ChangesList：行尾按钮按分组给出暂存 / 取消暂存，冲突行没有', () => {
  const { ChangesList } = loadModule('./components/ChangesList.js')
  const staged = []
  // 每个分组一个根级文件：目录默认折叠，放进子目录就看不到行尾按钮
  const flat = {
    ...statusFixture,
    files: [
      { path: 'staged.js', status: 'M', staged: true, unstaged: false, untracked: false, conflicted: false, adds: 1, dels: 0 },
      { path: 'work.js', status: 'M', staged: false, unstaged: true, untracked: false, conflicted: false, adds: 1, dels: 0 },
      { path: 'new.js', status: '?', staged: false, unstaged: false, untracked: true, conflicted: false, adds: 0, dels: 0 },
      { path: 'both.js', status: 'U', staged: false, unstaged: false, untracked: false, conflicted: true, adds: 0, dels: 0 }
    ]
  }
  const tree = renderComponent(ChangesList, {
    status: flat, loading: false, error: null, selectedPath: null,
    onSelect: () => {}, filter: '', onFilterChange: () => {}, collapsedGroups: {}, onToggleGroup: () => {},
    pendingPath: 'work.js',
    onStage: (path, action) => staged.push({ path, action }),
    onStageGroup: () => {},
    t: tKey
  })
  const actions = collect(tree, (node) => node.$$host === true && node.type === 'button' && node.props['data-dgp-action'] !== undefined)
  const byGroup = (key) => {
    const group = collect(tree, (node) => node.$$host === true && node.props['data-dgp-group'] === key)[0]
    return collect(group, (node) => node.$$host === true && node.type === 'button' && node.props['data-dgp-action'] !== undefined)
  }
  const stagedButtons = byGroup('staged')
  const unstagedButtons = byGroup('unstaged')
  const untrackedButtons = byGroup('untracked')
  assert(stagedButtons.length > 0, '已暂存组应有行尾按钮')
  assert(unstagedButtons.length > 0, '未暂存组应有行尾按钮')
  assert(untrackedButtons.length > 0, '未跟踪组应有行尾按钮')
  eq(stagedButtons.every((node) => node.props['data-dgp-action'] === 'unstage'), true, '已暂存行应是取消暂存')
  eq(unstagedButtons.every((node) => node.props['data-dgp-action'] === 'stage'), true, '未暂存行应是暂存')
  eq(untrackedButtons.every((node) => node.props['data-dgp-action'] === 'stage'), true, '未跟踪行应是暂存')
  eq(byGroup('conflicted').length, 0, '冲突行不应有暂存按钮')
  eq(actions.length, stagedButtons.length + unstagedButtons.length + untrackedButtons.length, '按钮数应等于三个可操作分组之和')
  const groupAction = (key) => {
    const group = collect(tree, (node) => node.$$host === true && node.props['data-dgp-group'] === key)[0]
    return collect(group, (node) => node.$$host === true && node.props['data-dgp-group-action'] !== undefined)
  }
  eq(groupAction('staged')[0].props['data-dgp-group-action'], 'unstage', '已暂存组头是全部取消暂存')
  eq(groupAction('unstaged')[0].props['data-dgp-group-action'], 'stage-unstaged', '未暂存组头是全部暂存')
  eq(groupAction('untracked')[0].props['data-dgp-group-action'], 'stage-untracked', '未跟踪组头是全部暂存')
  eq(groupAction('conflicted').length, 0, '冲突组头没有批量按钮')

  // 点按钮只触发暂存，不冒泡成选中
  stagedButtons[0].props.onClick({ preventDefault() {}, stopPropagation() {} })
  eq(staged.length, 1, '应回调一次')
  eq(staged[0].action, 'unstage', '已暂存行的动作')

  const busy = actions.find((node) => node.props.disabled === true)
  assert(busy !== undefined, 'pendingPath 对应的按钮应禁用')
  eq(busy.props['data-busy'], 'true', '忙状态钩子')
})

test('RepoList：列出全部仓库、当前仓库高亮、外部仓库可移除、折叠后不渲染行', () => {
  const { RepoList } = loadModule('./components/RepoList.js')
  const roots = [
    { id: 'r1', name: 'project', path: 'C:/work/project', kind: 'primary', isGit: true, branch: 'main' },
    { id: 'r2', name: 'web', path: 'C:/work/project/web', kind: 'discovered', isGit: true, branch: 'dev' },
    { id: 'r3', name: 'ext', path: 'D:/ext', kind: 'extra', isGit: true, branch: null }
  ]
  const picked = []
  const removed = []
  const base = {
    roots,
    activeRootId: 'r2',
    open: true,
    onToggleOpen: () => {},
    onSelect: (root) => picked.push(root.id),
    onRemove: (root) => removed.push(root.id),
    onAdd: () => Promise.resolve(),
    t: tKey
  }
  const tree = renderComponent(RepoList, base)
  const rows = collect(tree, (node) => node.$$host === true && node.props['data-dgp-repo'] !== undefined)
  eq(rows.length, 3, '每个仓库一行')
  eq(rows.map((node) => node.props['data-dgp-repo']), ['r1', 'r2', 'r3'], '顺序与入参一致')
  eq(rows.find((node) => node.props['data-dgp-repo'] === 'r2').props['data-active'], 'true', '当前仓库高亮')
  eq(rows.find((node) => node.props['data-dgp-repo'] === 'r1').props['data-active'], 'false', '其它仓库不高亮')
  assert(textOf(rows[0]).includes('main'), '行里应有分支')

  rows[0].props.onClick({ preventDefault() {}, stopPropagation() {} })
  eq(picked, ['r1'], '点行应切到该仓库')

  const removeButtons = collect(tree, (node) => node.$$host === true && node.props['data-dgp-repo-remove'] !== undefined)
  eq(removeButtons.length, 1, '只有外部仓库带移除按钮')
  eq(removeButtons[0].props['data-dgp-repo-remove'], 'r3')
  removeButtons[0].props.onClick({ preventDefault() {}, stopPropagation() {} })
  eq(removed, ['r3'], '移除回调')

  const collapsed = renderComponent(RepoList, { ...base, open: false })
  eq(collect(collapsed, (node) => node.$$host === true && node.props['data-dgp-repo'] !== undefined).length, 0, '折叠后不渲染仓库行')
  eq(collect(collapsed, (node) => node.$$host === true && node.props['data-dgp-repolist-toggle'] !== undefined).length, 1, '折叠后仍有标题行')
})

test('ChangesList：筛选无结果给出提示', () => {
  const { ChangesList } = loadModule('./components/ChangesList.js')
  const tree = renderComponent(ChangesList, {
    status: statusFixture, loading: false, error: null, selectedPath: null,
    onSelect: () => {}, filter: 'zzz-not-exist', onFilterChange: () => {}, collapsedGroups: {}, onToggleGroup: () => {}, t: tKey
  })
  assert(textOf(tree).includes('status.emptyFilter'), '缺少筛选无结果提示')
})

test('FileTree：无 rootPath 给空态，有 rootPath 不崩', () => {
  const { FileTree } = loadModule('./components/FileTree.js')
  const empty = renderComponent(FileTree, { rootPath: null, selectedPath: null, onSelectFile: () => {}, filter: '', onFilterChange: () => {}, loadDir: () => Promise.resolve({ entries: [], truncated: false }), t: tKey })
  assert(empty !== null, '空 rootPath 渲染为 null')
  const tree = renderComponent(FileTree, {
    rootPath: 'C:/work/project', selectedPath: 'src/app.js', onSelectFile: () => {}, filter: '', onFilterChange: () => {},
    loadDir: () => Promise.resolve({ entries: [{ name: 'src', path: 'src', type: 'dir' }], truncated: false }), t: tKey
  })
  assert(tree !== null, 'FileTree 渲染为 null')
})

test('States：四件套都能渲染文案', () => {
  const states = loadModule('./components/States.js')
  assert(textOf(renderComponent(states.EmptyState, { icon: 'check-circle', title: 'TITLE-A', description: 'DESC-A', actions: [], t: tKey })).includes('TITLE-A'), 'EmptyState 标题')
  assert(textOf(renderComponent(states.LoadingState, { label: 'LOADING-A', t: tKey })).includes('LOADING-A'), 'LoadingState 文案')
  assert(textOf(renderComponent(states.ErrorState, { message: 'BOOM', onRetry: () => {}, t: tKey })).includes('BOOM'), 'ErrorState 文案')
  assert(renderComponent(states.InlineNote, { tone: 'warn' }) !== undefined, 'InlineNote 渲染异常')
})

test('RootPicker：pill 显示当前根与分支', () => {
  const { RootPicker } = loadModule('./components/RootPicker.js')
  const roots = [
    { id: 'r1', path: 'C:/a', repoRoot: 'C:/a', name: 'alpha', kind: 'primary', isGit: true, branch: 'main' },
    { id: 'r2', path: 'C:/b', repoRoot: 'C:/b', name: 'beta', kind: 'extra', isGit: true, branch: null }
  ]
  const tree = renderComponent(RootPicker, { roots, activeRootId: 'r1', projectRoot: 'C:/a', onSelect: () => {}, onAdd: () => Promise.resolve(), onRemove: () => {}, busy: false, t: tKey })
  eq(collect(tree, (node) => classOf(node).split(' ').includes('dgp-pill')).length, 1, 'pill 数量')
  const text = textOf(tree)
  assert(text.includes('alpha'), 'pill 没显示根名字')
  assert(text.includes('main'), 'pill 没显示分支')
})

test('样式表覆盖了代码里用到的所有 dgp- class', () => {
  const css = fakeDocument.appended.filter((node) => node.tagName === 'STYLE')[0].textContent
  const defined = new Set()
  for (const match of css.matchAll(/\.([A-Za-z][\w-]*)/g)) defined.add(match[1])
  const used = new Set()
  for (const match of bundle.matchAll(/['"`]([^'"`\n]*\bdgp-[^'"`\n]*)['"`]/g)) {
    for (const token of match[1].split(/\s+/)) if (/^dgp-[a-z0-9-]+$/.test(token)) used.add(token)
  }
  const missing = [...used].filter((name) => !defined.has(name)).sort()
  eq(missing, [], '有 class 在代码里用到但样式表没定义')
})

console.log('')
if (failures.length > 0) {
  console.error(failures.length + ' failed, ' + passed + ' passed')
  for (const failure of failures) console.error(' - ' + failure.name + ': ' + (failure.error && failure.error.stack ? failure.error.stack : failure.error))
  process.exit(1)
}
console.log(passed + ' passed')
