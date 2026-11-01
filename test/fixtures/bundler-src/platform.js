import { useState } from 'react'

export const h = function h(tag, props, ...children) {
  return { tag, props: props ?? null, children: children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false) }
}

export { useState }