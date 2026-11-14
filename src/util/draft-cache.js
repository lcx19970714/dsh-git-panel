/**
 * src/util/draft-cache.js —— 编辑器草稿（内存，模块级）
 *
 * 编辑器草稿的生命周期必须比组件长：切到右侧栏别的页签、关掉面板再打开，
 * 没保存的改动都应该还在。原先草稿只存在 Panel 组件的 state 里，一次 unmount
 * 就静默丢光 —— 那是最不能接受的失败方式，所以它需要和 resource-cache（首屏快照）
 * 一样，活在模块级。
 *
 * 三条硬约束（与 resource-cache 一致）：
 *  1. 只在内存里，不落 localStorage：草稿是编辑现场，不是配置；
 *  2. 键 = 仓库根 + 文件相对路径：同一个相对路径在不同项目/仓库里是不同文件；
 *  3. 有上限（条数 + 总字符数）：淘汰最久没写过的，避免长会话里攒出几百 MB。
 */

/** 最多保留多少个文件的草稿。 */
const MAX_ENTRIES = 60
/** 所有草稿正文加起来的字符上限（约 8MB，按 UTF-16 字符数算）。 */
const MAX_CHARS = 4_000_000

/** key -> { rootPath, path, draft } */
const entries = new Map()
let totalChars = 0

function keyOf(rootPath, path) {
  return rootPath + '\u0000' + path
}

function charsOf(draft) {
  return draft.text.length + draft.savedText.length
}

/** 读某个仓库根下所有草稿：Map<相对路径, draft>。 */
export function readDrafts(rootPath) {
  const out = new Map()
  for (const entry of entries.values()) {
    if (entry.rootPath === rootPath) out.set(entry.path, entry.draft)
  }
  return out
}

/** 写一个草稿（覆盖同名）。 */
export function writeDraft(rootPath, path, draft) {
  const key = keyOf(rootPath, path)
  const existing = entries.get(key)
  if (existing !== undefined) {
    totalChars -= charsOf(existing.draft)
    entries.delete(key)
  }
  entries.set(key, { rootPath, path, draft })
  totalChars += charsOf(draft)

  while (entries.size > MAX_ENTRIES || totalChars > MAX_CHARS) {
    const oldest = entries.keys().next()
    if (oldest.done === true) break
    const dropped = entries.get(oldest.value)
    entries.delete(oldest.value)
    totalChars -= charsOf(dropped.draft)
  }
}

/** 丢掉一个草稿（重新加载 / 文件变成不可编辑 / 已保存并清理时）。 */
export function dropDraft(rootPath, path) {
  const key = keyOf(rootPath, path)
  const existing = entries.get(key)
  if (existing === undefined) return
  entries.delete(key)
  totalChars -= charsOf(existing.draft)
}

/** 清空（测试用：保证每个用例从「没有草稿」开始）。 */
export function clearDrafts() {
  entries.clear()
  totalChars = 0
}
