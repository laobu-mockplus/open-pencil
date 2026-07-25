/**
 * 内联 SVG → SceneGraph 映射：复用 OP 既有 SVG path 解析器并创建真实 Vector。
 */
import { extractSVGPaths, scaleSVGPathInfos } from '@open-pencil/core/icons'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { colorToFillFromCSS, colorToStrokeFromCSS, pickStyle } from './css-values'
import { applyPositioning, firstCSSNumber } from './layout-values'
import { serializeHTML } from './serialize'
import type { DesignElement, DesignStyleDeclaration } from './types'

function optionalAttribute(element: DesignElement, name: string): string | undefined {
  return Object.hasOwn(element.attrs, name) ? element.attrs[name] : undefined
}

function svgViewBox(element: DesignElement): { width: number; height: number } {
  const value = optionalAttribute(element, 'viewBox') ?? optionalAttribute(element, 'viewbox')
  if (!value) return { width: 0, height: 0 }
  const parts = value
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  return { width: parts[2] ?? 0, height: parts[3] ?? 0 }
}

function svgInheritedAttributes(element: DesignElement): string {
  const attributeNames = [
    'fill',
    'stroke',
    'stroke-width',
    'stroke-linecap',
    'stroke-linejoin'
  ] as const
  return attributeNames
    .map((name) => {
      const value = optionalAttribute(element, name)
      return value ? `${name}="${value.replaceAll('"', '&quot;')}"` : ''
    })
    .filter(Boolean)
    .join(' ')
}

function resolveSVGPaint(value: string | null, style: DesignStyleDeclaration): string | undefined {
  if (value === null) return undefined
  return value === 'currentColor' ? pickStyle(style, 'color') : value
}

function strokeCapFromSVG(value: string): SceneNode['strokeCap'] {
  if (value === 'round') return 'ROUND'
  if (value === 'square') return 'SQUARE'
  return 'NONE'
}

function strokeJoinFromSVG(value: string): SceneNode['strokeJoin'] {
  if (value === 'round') return 'ROUND'
  if (value === 'bevel') return 'BEVEL'
  return 'MITER'
}

export function createSVGNode(
  graph: SceneGraph,
  parentId: string,
  element: DesignElement,
  style: DesignStyleDeclaration
): SceneNode {
  const viewBox = svgViewBox(element)
  const attributeWidth = Number.parseFloat(optionalAttribute(element, 'width') ?? '')
  const attributeHeight = Number.parseFloat(optionalAttribute(element, 'height') ?? '')
  const width =
    firstCSSNumber(style, 'width') ??
    (Number.isFinite(attributeWidth) && attributeWidth > 0 ? attributeWidth : null) ??
    (viewBox.width > 0 ? viewBox.width : 24)
  const height =
    firstCSSNumber(style, 'height') ??
    (Number.isFinite(attributeHeight) && attributeHeight > 0 ? attributeHeight : null) ??
    (viewBox.height > 0 ? viewBox.height : 24)
  const frame = graph.createNode('FRAME', parentId, {
    name: optionalAttribute(element, 'id') ?? optionalAttribute(element, 'class') ?? 'svg',
    width,
    height,
    fills: [],
    clipsContent: false
  })
  applyPositioning(frame, style)

  const body = serializeHTML({ type: 'document', children: element.children })
  const pathInfos = extractSVGPaths(`<g ${svgInheritedAttributes(element)}>${body}</g>`)
  const scaleX = viewBox.width > 0 ? width / viewBox.width : 1
  const scaleY = viewBox.height > 0 ? height / viewBox.height : 1

  for (const path of scaleSVGPathInfos(pathInfos, scaleX, scaleY)) {
    const fill = resolveSVGPaint(path.fill, style)
    const vector = graph.createNode('VECTOR', frame.id, {
      name: 'path',
      width,
      height,
      fills: fill ? colorToFillFromCSS(fill) : [],
      strokes: colorToStrokeFromCSS(resolveSVGPaint(path.stroke, style), String(path.strokeWidth)),
      vectorNetwork: path.vectorNetwork,
      strokeCap: strokeCapFromSVG(path.strokeCap),
      strokeJoin: strokeJoinFromSVG(path.strokeJoin)
    })
    vector.x = 0
    vector.y = 0
  }
  return frame
}
