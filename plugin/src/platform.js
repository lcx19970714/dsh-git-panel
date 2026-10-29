/**
 * src/platform.js —— 与 DSH 客户端运行时的唯一接触面
 *
 * 全插件只从这里拿 react 与宿主 ctx，其它模块一律 `import ... from './platform.js'`。
 * 没有降级分支：这些能力由 index.js 的 `inject` 声明保证存在。
 */
import react from 'react'

/** createElement 简写。 */
export const h = react.createElement

/** 组件片段。 */
export const Fragment = react.Fragment

/** 只导出实际用到的 hooks。 */
export const useState = react.useState
export const useEffect = react.useEffect
export const useLayoutEffect = react.useLayoutEffect
export const useMemo = react.useMemo
export const useCallback = react.useCallback
export const useRef = react.useRef

/** apply(ctx) 时写入一次；api.js 用它取 connection 服务。 */
let pluginContext = null

export function setPluginContext(ctx) {
  pluginContext = ctx
}

export function getPluginContext() {
  return pluginContext
}
