/**
 * CSS Grid 专用映射：把浏览器已经解析出的轨道和间距转换为 OP 原生 Grid 字段。
 * 本模块不负责浏览器计算，也不根据模板 class 或文案补写布局。
 */
import type { GridTrack, SceneNode } from '@open-pencil/scene-graph'

import { parseCSSNumber, pickStyle } from './css-values'
import { firstCSSNumber } from './layout-values'
import type { DesignStyleDeclaration } from './types'

function splitCSSValues(value: string): string[] {
  const values: string[] = []
  let depth = 0
  let current = ''

  for (const character of value.trim()) {
    if (character === '(') depth += 1
    if (character === ')') depth = Math.max(0, depth - 1)
    if (/\s/.test(character) && depth === 0) {
      if (current) values.push(current)
      current = ''
      continue
    }
    current += character
  }
  if (current) values.push(current)
  return values
}

function gridTrackFromCSS(value: string): GridTrack | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'auto' || normalized === 'min-content' || normalized === 'max-content') {
    return { sizing: 'AUTO', value: 0 }
  }
  if (normalized.endsWith('fr')) {
    const fraction = Number.parseFloat(normalized)
    return Number.isFinite(fraction) ? { sizing: 'FR', value: fraction } : null
  }
  const pixels = parseCSSNumber(normalized)
  if (pixels !== null) return { sizing: 'FIXED', value: pixels }

  const flexibleTrack = normalized.match(/minmax\([^,]+,\s*([0-9.]+)fr\)$/)
  if (!flexibleTrack) return null
  const fraction = Number.parseFloat(flexibleTrack[1] ?? '')
  return Number.isFinite(fraction) ? { sizing: 'FR', value: fraction } : null
}

function gridTracksFromCSS(value: string | undefined): GridTrack[] {
  if (!value || value === 'none' || value.includes('subgrid')) return []
  return splitCSSValues(value)
    .map(gridTrackFromCSS)
    .filter((track): track is GridTrack => track !== null)
}

export function applyGridLayout(node: SceneNode, style: DesignStyleDeclaration): void {
  node.layoutMode = 'GRID'
  node.gridTemplateColumns = gridTracksFromCSS(pickStyle(style, 'grid-template-columns'))
  node.gridTemplateRows = gridTracksFromCSS(pickStyle(style, 'grid-template-rows'))
  node.gridColumnGap = firstCSSNumber(style, 'column-gap', 'gap') ?? node.gridColumnGap
  node.gridRowGap = firstCSSNumber(style, 'row-gap', 'gap') ?? node.gridRowGap
}
