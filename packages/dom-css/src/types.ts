import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

export type DesignNode = DesignElement | DesignText

/**
 * 浏览器排版后的实际边界，坐标相对于本次导入内容的根容器。
 * 转换器只消费真实测量结果，不用字符数或固定常量猜测几何尺寸。
 */
export interface DesignBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface DesignDocument {
  type: 'document'
  children: DesignNode[]
  stylesheets?: DesignStyleSheet[]
  sourceGraph?: SceneGraph
}

export interface DesignElement {
  type: 'element'
  tagName: string
  attrs: Record<string, string>
  children: DesignNode[]
  inlineStyle?: DesignStyleDeclaration
  computedStyle?: DesignStyleDeclaration
  browserBounds?: DesignBounds
  sourceAssetURL?: string
  sourceSceneNodeId?: string
  sourceSceneNode?: SceneNode
}

export interface DesignText {
  type: 'text'
  text: string
  browserBounds?: DesignBounds
}

export interface DesignStyleSheet {
  type: 'stylesheet'
  cssText: string
  href?: string
}

export type DesignStyleDeclaration = Record<string, string>

export interface CSSComputeOptions {
  includeBrowserDefaults?: boolean
}

export interface CSSRuntime {
  readonly kind: 'browser' | 'headless'
  parseHTML(html: string): DesignDocument
  serializeHTML(document: DesignDocument): string
  computeStyles(
    document: DesignDocument,
    cssText?: string,
    options?: CSSComputeOptions
  ): Promise<DesignDocument>
}
