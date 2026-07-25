/**
 * 浏览器布局保真补偿。
 *
 * 只处理 OP 原生自动布局当前无法等价表达、但浏览器已给出确定几何事实的场景：
 * 普通块流坐标、逐子项 Flex margin 与 Grid 非起始对齐。补偿不识别模板、class
 * 或文案；能用原生统一 gap 表达时仍优先保留自动布局。
 */
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { mergedStyle, parseCSSNumber, pickStyle } from './css-values'
import type { DesignBounds, DesignElement, DesignNode } from './types'

const DOM_CSS_PLUGIN_ID = 'open-pencil-dom-css'
const SOURCE_KEY_ATTRIBUTE = 'data-openpencil-source-key'
const SOURCE_KEY_PLUGIN_KEY = 'source-key'

export function applySourceKey(node: SceneNode, element: DesignElement): void {
  const sourceKey = element.attrs[SOURCE_KEY_ATTRIBUTE]?.trim()
  if (!sourceKey) return
  node.pluginData.push({
    pluginId: DOM_CSS_PLUGIN_ID,
    key: SOURCE_KEY_PLUGIN_KEY,
    value: sourceKey
  })
}

export function applyBrowserRelativePosition(
  node: SceneNode,
  bounds: DesignBounds | undefined,
  parentBounds: DesignBounds | undefined,
  parentLayoutMode: SceneNode['layoutMode']
): void {
  if (!bounds) return
  if (parentLayoutMode !== 'NONE' && node.layoutPositioning !== 'ABSOLUTE') return
  node.x = bounds.x - (parentBounds?.x ?? 0)
  node.y = bounds.y - (parentBounds?.y ?? 0)
}

function readMargin(child: DesignElement, properties: string[]): number {
  const style = mergedStyle(child)
  for (const property of properties) {
    const value = parseCSSNumber(pickStyle(style, property))
    if (value !== null) return value
  }
  return 0
}

function useMeasuredChildPositions(
  graph: SceneGraph,
  node: SceneNode,
  elementChildren: DesignElement[],
  parentBounds: DesignBounds | undefined
): void {
  if (!parentBounds) return
  const sceneChildren = graph.getChildren(node.id)
  if (
    sceneChildren.length !== elementChildren.length ||
    elementChildren.some((child) => !child.browserBounds)
  ) {
    return
  }
  for (const [index, childNode] of sceneChildren.entries()) {
    const bounds = elementChildren[index].browserBounds as DesignBounds
    childNode.layoutPositioning = 'ABSOLUTE'
    childNode.x = bounds.x - parentBounds.x
    childNode.y = bounds.y - parentBounds.y
  }
}

export function applyFlexChildMargins(
  graph: SceneGraph,
  node: SceneNode,
  children: DesignNode[],
  parentBounds?: DesignBounds
): void {
  if (node.layoutMode !== 'HORIZONTAL' && node.layoutMode !== 'VERTICAL') return
  const elementChildren = children.filter(
    (child): child is DesignElement => child.type === 'element'
  )
  if (elementChildren.length < 2) return
  const primaryStartProperties =
    node.layoutMode === 'HORIZONTAL'
      ? ['margin-inline-start', 'margin-left']
      : ['margin-block-start', 'margin-top']
  const primaryEndProperties =
    node.layoutMode === 'HORIZONTAL'
      ? ['margin-inline-end', 'margin-right']
      : ['margin-block-end', 'margin-bottom']
  const crossStartProperties =
    node.layoutMode === 'HORIZONTAL'
      ? ['margin-block-start', 'margin-top']
      : ['margin-inline-start', 'margin-left']
  const crossEndProperties =
    node.layoutMode === 'HORIZONTAL'
      ? ['margin-block-end', 'margin-bottom']
      : ['margin-inline-end', 'margin-right']
  const primaryStarts = elementChildren.map((child) => readMargin(child, primaryStartProperties))
  const primaryEnds = elementChildren.map((child) => readMargin(child, primaryEndProperties))
  const crossMargins = elementChildren.flatMap((child) => [
    readMargin(child, crossStartProperties),
    readMargin(child, crossEndProperties)
  ])
  const gapMargins = elementChildren.slice(1).map((child, index) => {
    const previous = elementChildren[index]
    return readMargin(previous, primaryEndProperties) + readMargin(child, primaryStartProperties)
  })
  const firstMargin = gapMargins[0]
  const hasAnyMargin = [...primaryStarts, ...primaryEnds, ...crossMargins].some(
    (margin) => Math.abs(margin) >= 0.01
  )
  if (!hasAnyMargin) return

  const uniformGap = gapMargins.every((margin) => Math.abs(margin - firstMargin) < 0.01)
  const canUseNativeGap =
    uniformGap &&
    firstMargin >= 0 &&
    Math.abs(primaryStarts[0]) < 0.01 &&
    Math.abs(primaryEnds.at(-1) ?? 0) < 0.01 &&
    crossMargins.every((margin) => Math.abs(margin) < 0.01)
  if (canUseNativeGap) {
    node.itemSpacing += firstMargin
    return
  }
  if (uniformGap) node.itemSpacing += firstMargin

  // Yoga 没有逐子项 margin，负 gap 也会被钳制。不能等价为统一正 gap 时，
  // 使用浏览器已确认的相对坐标，避免常见 mt-* 与重叠头像在画布里发生漂移。
  useMeasuredChildPositions(graph, node, elementChildren, parentBounds)
}

export function applyUnsupportedGridAlignment(
  graph: SceneGraph,
  node: SceneNode,
  children: DesignNode[],
  parentBounds?: DesignBounds
): void {
  if (
    node.layoutMode !== 'GRID' ||
    (node.counterAxisAlign !== 'CENTER' &&
      node.counterAxisAlign !== 'MAX' &&
      node.counterAxisAlign !== 'BASELINE')
  ) {
    return
  }
  const elementChildren = children.filter(
    (child): child is DesignElement => child.type === 'element'
  )

  // 当前 Yoga Grid 不执行 align-items。保留 GRID 与轨道事实，同时用浏览器测得的
  // 直接子项坐标兜底，避免 items-end/center 在画布中统一贴到行首。
  useMeasuredChildPositions(graph, node, elementChildren, parentBounds)
}
