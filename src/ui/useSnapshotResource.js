/**
 * src/ui/useSnapshotResource.js —— 一个「有首屏快照、有请求序号、失败留在原地」的资源
 *
 * 远端详情、分支全貌、PR 详情、当前分支 PR 卡片原先各写了一遍同样的代码：
 * 读快照 → 置 loading → await → 序号守护 → 写快照 → catch 转人话。
 * 四份实现里已经有细微漂移（错误该不该保留上一份数据、loading 该不该保留旧画面）。
 * 这里把语义定死成三个开关，调用方只描述「key 怎么算、怎么取数、取到后做什么」：
 *
 *   snapshot     有快照就先渲染（默认 true）
 *   keepPrevious 刷新时保留上一份数据，列表/卡片不会先消失再出现
 *   keepOnError  失败时保留上一份数据（否则清空，让错误态独自占屏）
 *
 * 请求序号用 `useLatestGuard`：切仓库/切 PR 时，晚到的旧响应不会写进新选中项。
 * 快照只存成功结果（失败进缓存会把错误画面当成首屏）。
 */
import { useCallback, useRef, useState } from '../platform.js'
import { readSnapshot, writeSnapshot } from '../util/resource-cache.js'
import { useLatestGuard } from '../store.js'
import { describeError } from '../api.js'

/**
 * @param {{
 *   keyOf?: (input: any) => string,        // 快照键；不传 = 不用快照
 *   load: (input: any) => Promise<any>,    // 取数；失败时抛 RpcError
 *   snapshot?: boolean,                     // 默认 true
 *   keepPrevious?: boolean,                 // 默认 false
 *   keepOnError?: boolean,                  // 默认 false
 *   onLoaded?: (input: any, data: any) => void,
 *   t: (key: string, params?: object) => string
 * }} options
 * @returns {{ state: {loading: boolean, error: string|null, data: any}|null, reload: (input: any) => Promise<any|null>, clear: () => void }}
 */
export function useSnapshotResource(options) {
  const { keyOf, load, snapshot = true, keepPrevious = false, keepOnError = false, onLoaded, t } = options
  const [state, setState] = useState(null)
  const stateRef = useRef(state)
  stateRef.current = state
  /**
   * 同步更新 state 与它的 ref。
   * 同一轮里先 clear() 再 reload() 时，reload 必须看到「已经清空」，
   * 否则 keepPrevious 会把上一个仓库的数据当成这一份继续渲染。
   */
  const apply = useCallback((next) => {
    stateRef.current = next
    setState(next)
  }, [])
  const guard = useLatestGuard()

  // 回调与翻译函数放进 ref：reload 的引用必须稳定，否则依赖它的 effect 每次渲染都重跑。
  const keyOfRef = useRef(keyOf)
  keyOfRef.current = keyOf
  const loadRef = useRef(load)
  loadRef.current = load
  const onLoadedRef = useRef(onLoaded)
  onLoadedRef.current = onLoaded
  const tRef = useRef(t)
  tRef.current = t

  const reload = useCallback(async (input) => {
    const token = guard.begin()
    if (input === null) {
      apply(null)
      return null
    }
    const key = keyOfRef.current === undefined ? null : keyOfRef.current(input)
    const cached = snapshot && key !== null ? readSnapshot(key) : undefined
    const previous = stateRef.current
    const previousData = keepPrevious && previous !== null ? previous.data : null
    const data = cached === undefined ? previousData : cached
    apply({ loading: data === null, error: null, data })
    try {
      const value = await loadRef.current(input)
      if (!guard.isLatest(token)) return null
      if (key !== null) writeSnapshot(key, value)
      if (onLoadedRef.current !== undefined) onLoadedRef.current(input, value)
      apply({ loading: false, error: null, data: value })
      return value
    } catch (error) {
      if (!guard.isLatest(token)) return null
      apply({
        loading: false,
        error: describeError(error, tRef.current),
        data: keepOnError ? previousData : null
      })
      return null
    }
  }, [guard, snapshot, keepPrevious, keepOnError, apply])

  // clear 也要让在途请求作废，否则旧响应会在清空之后把状态又写回来。
  const clear = useCallback(() => {
    guard.begin()
    apply(null)
  }, [guard, apply])

  return { state, reload, clear }
}
