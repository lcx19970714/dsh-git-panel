import { h, useState } from './platform.js'
import { double, NAME as LIB_NAME } from './lib/math.js'
import * as mathNs from './lib/math.js'
import './side-effect.js'

export const CONSTANT = 42

export function greet(who) {
  return 'hi ' + who + ' ' + double(2) + ' ' + LIB_NAME + ' ' + mathNs.triple(1)
}

export async function later() {
  return CONSTANT
}

export class Thing {
  constructor() {
    this.value = CONSTANT
  }
}

export default function main() {
  return h('div', null, String(useState === undefined) + String(mathNs.double(5)))
}