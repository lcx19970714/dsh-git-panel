/**
 * src/store.js —— 显示偏好 + 两个通用 hook
 *
 * 只放「跨会话应该记住的显示偏好」。status/diff 数据与当前选中项都是每次
 * 重新取的组件状态，不进这里。
 *
 * 偏好存在 localStorage 里；读取时只做「结构校验 + 数值钳制」，
 * 保证手改/旧版本残留的坏数据不会把面板布局搞坏。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from './platform.js'

export const MODE = { changes: 'changes', files: 'files' }

const STORAGE_KEY = 'dsh-git-panel:prefs:v1'

const DEFAULTS = {
  mode: MODE.changes,
  diffView: 'unified',
  wrap: false,
  contextLines: 3,
  ignoreWhitespace: false,
  autoRefresh: true,
  leftWidth: 264,
  collapsedGroups: {}
}

const GROUPS = ['conflicted', 'staged', 'unstaged', 'untracked']

/** 把任意输入收敛成合法的偏好对象。 */
function sanitize(input) {
  const out = { ...DEFAULTS }
  if (input.mode === MODE.changes || input.mode === MODE.files) out.mode = input.mode
  if (input.diffView === 'unified' || input.diffView === 'split') out.diffView = input.diffView
  if (typeof input.wrap === 'boolean') out.wrap = input.wrap
  if (typeof input.ignoreWhitespace === 'boolean') out.ignoreWhitespace = input.ignoreWhitespace
  if (typeof input.autoRefresh === 'boolean') out.autoRefresh = input.autoRefresh
  if (Number.isFinite(input.contextLines)) {
    out.contextLines = Math.min(20, Math.max(0, Math.round(input.contextLines)))
  }
  if (Number.isFinite(input.leftWidth)) {
    out.leftWidth = Math.min(720, Math.max(180, Math.round(input.leftWidth)))
  }
  if (input.collapsedGroups && typeof input.collapsedGroups === 'object') {
    const groups = {}
    for (const key of GROUPS) if (input.collapsedGroups[key] === true) groups[key] = true
    out.collapsedGroups = groups
  }
  return out
}

function loadPrefs() {
  let raw = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return { ...DEFAULTS }
  }
  if (raw === null) return { ...DEFAULTS }
  try {
    return sanitize(JSON.parse(raw))
  } catch {
    return { ...DEFAULTS }
  }
}

function savePrefs(patch) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...loadPrefs(), ...patch }))
  } catch {
    /* 隐私模式/配额满时静默：偏好存不下不影响当前会话 */
  }
}

/**
 * 一个会持久化到 localStorage 的 state。
 * @param {string} key DEFAULTS 的键
 */
export function usePref(key) {
  const [value, setValue] = useState(() => loadPrefs()[key])
  const set = useCallback((next) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next
      savePrefs({ [key]: resolved })
      return resolved
    })
  }, [key])
  return [value, set]
}

/**
 * 只保留最新一次异步结果的守护器。
 *
 * 返回对象必须**引用稳定**：调用方普遍写成
 *   const refresh = useCallback(..., [guard]);  useEffect(..., [refresh])
 * 每次返回新对象会让 refresh 每次渲染都变，effect 就会每渲染重跑 ——
 * 那会变成「取数 → 渲染 → 再取数」的死循环。
 */
export function useLatestGuard() {
  const seqRef = useRef(0)
  const begin = useCallback(() => {
    seqRef.current += 1
    return seqRef.current
  }, [])
  const isLatest = useCallback((token) => token === seqRef.current, [])
  return useMemo(() => ({ begin, isLatest }), [begin, isLatest])
}
