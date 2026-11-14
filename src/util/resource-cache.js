/**
 * src/util/resource-cache.js —— 首屏快照缓存（内存，模块级）
 *
 * 解决的是「切走再切回来」的卡顿：
 *   右侧栏 tab 被切走时组件会卸载，切回来时重新挂载 —— 状态全部归零，
 *   于是先骨架屏、再等 `project/resolve`、再等 `status`，一屏白两次。
 *
 * 这里存的是**上次成功结果的快照**：挂载时先同步渲染旧画面（零延迟），
 * 同时在后台重新验证。只有「从来没有过快照」时才显示骨架屏。
 *
 * 三条硬约束：
 *  1. 只放内存，不落 localStorage（快照是缓存，不是持久化数据）；
 *  2. 只存成功结果（失败不进缓存，否则会把错误画面当成首屏）；
 *  3. 有上限，满了淘汰最旧的键（Map 的插入序 + 重新 set 刷新位置）。
 */

/** 缓存的键数量上限：面板一次会话也就几十个键，120 足够，且不会无限增长。 */
const MAX_ENTRIES = 120

/** key -> { value, at } */
const entries = new Map()

/** 读快照；没有就是 undefined（调用方据此决定要不要显示骨架屏）。 */
export function readSnapshot(key) {
  const entry = entries.get(key)
  return entry === undefined ? undefined : entry.value
}

/** 写入快照（成功结果才写）。已存在的键会被移到队尾，等价于 LRU 的「最近使用」。 */
export function writeSnapshot(key, value) {
  if (entries.has(key)) entries.delete(key)
  else if (entries.size >= MAX_ENTRIES) {
    const oldest = entries.keys().next()
    if (oldest.done !== true) entries.delete(oldest.value)
  }
  entries.set(key, { value, at: Date.now() })
}

/** 删除一个快照（例如根被移除、账号被删）。 */
export function dropSnapshot(key) {
  entries.delete(key)
}

/** 快照年龄（毫秒）；没有快照返回 Infinity。 */
export function snapshotAge(key) {
  const entry = entries.get(key)
  return entry === undefined ? Infinity : Date.now() - entry.at
}

/** 清空（测试用：保证每个用例从「没有快照」开始）。 */
export function clearSnapshots() {
  entries.clear()
}
