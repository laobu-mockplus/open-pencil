/**
 * SceneGraph 布局映射共享值：统一读取 CSS 数值并映射绝对定位。
 */
import type { SceneNode } from '@open-pencil/scene-graph'

import { parseCSSNumber, pickStyle } from './css-values'
import type { DesignStyleDeclaration } from './types'

export function firstCSSNumber(
  style: DesignStyleDeclaration,
  ...properties: string[]
): number | null {
  for (const property of properties) {
    const parsed = parseCSSNumber(pickStyle(style, property))
    if (parsed !== null) return parsed
  }
  return null
}

export function applyPositioning(node: SceneNode, style: DesignStyleDeclaration): void {
  const position = pickStyle(style, 'position')
  if (position === 'absolute' || position === 'fixed') node.layoutPositioning = 'ABSOLUTE'

  const left = firstCSSNumber(style, 'left')
  const top = firstCSSNumber(style, 'top')
  if (left !== null) node.x = left
  if (top !== null) node.y = top
}
