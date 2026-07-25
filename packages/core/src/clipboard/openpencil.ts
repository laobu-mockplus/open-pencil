/**
 * OpenPencil 原生节点片段编解码。
 * 公共 SceneFragment 与内部剪贴板共用同一 openpencil/v1 事实格式，避免模板导入另起协议。
 */
import { deflateSync, inflateSync } from 'fflate'

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import type { JsonObject } from '@open-pencil/scene-graph/primitives'

// --- Internal copy/paste (OpenPencil ↔ OpenPencil) ---

export type OpenPencilClipboardNode = JsonObject &
  SceneNode & {
    children?: OpenPencilClipboardNode[]
  }

export interface OpenPencilClipboardData {
  nodes: OpenPencilClipboardNode[]
  images: Map<string, Uint8Array>
  fragment: OpenPencilSceneFragment
}

export interface OpenPencilSceneFragment {
  format: 'openpencil/v1'
  nodes: JsonObject[]
  images: Record<string, string>
}

export interface ImportedSceneFragment {
  rootNodeIds: string[]
  idMap: Map<string, string>
}

export function parseOpenPencilClipboard(html: string): OpenPencilClipboardData | null {
  const match = html.match(/<!--\(openpencil\)(.*?)\(\/openpencil\)-->/s)
  if (!match) return null

  try {
    const raw = Uint8Array.fromBase64(match[1])
    let bytes: Uint8Array
    try {
      bytes = inflateSync(raw)
    } catch {
      bytes = raw
    }
    const decoded: unknown = JSON.parse(new TextDecoder().decode(bytes))
    const fragment = parseSceneFragment(decoded)
    if (!fragment) return null
    return sceneFragmentToClipboardData(fragment)
  } catch (e) {
    console.warn('Failed to parse OpenPencil clipboard data:', e)
  }
  return null
}

function restoreTextPictures(nodes: JsonObject[]): void {
  for (const node of nodes) {
    if (typeof node.textPicture === 'string') {
      node.textPicture = Uint8Array.fromBase64(node.textPicture)
    }
    if (Array.isArray(node.children)) {
      restoreTextPictures(node.children)
    }
  }
}

export type TextPictureBuilder = (node: SceneNode) => Uint8Array | null

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSceneFragmentNode(value: unknown): value is OpenPencilClipboardNode {
  if (!isJsonObject(value) || typeof value.id !== 'string' || typeof value.type !== 'string') {
    return false
  }
  if (value.children === undefined) return true
  return Array.isArray(value.children) && value.children.every(isSceneFragmentNode)
}

function parseSceneFragment(value: unknown): OpenPencilSceneFragment | null {
  if (!isJsonObject(value) || value.format !== 'openpencil/v1' || !Array.isArray(value.nodes)) {
    return null
  }
  if (!value.nodes.every(isJsonObject) || !isJsonObject(value.images)) return null

  const images: Record<string, string> = {}
  for (const [hash, bytes] of Object.entries(value.images)) {
    if (typeof bytes !== 'string') return null
    images[hash] = bytes
  }
  return { format: 'openpencil/v1', nodes: value.nodes, images }
}

function sceneFragmentToClipboardData(fragment: OpenPencilSceneFragment): OpenPencilClipboardData {
  const nodes = structuredClone(fragment.nodes)
  restoreTextPictures(nodes)
  if (!nodes.every(isSceneFragmentNode)) {
    throw new TypeError('节点片段包含无效的 SceneNode')
  }
  const images = new Map<string, Uint8Array>()
  for (const [hash, bytes] of Object.entries(fragment.images)) {
    images.set(hash, Uint8Array.fromBase64(bytes))
  }
  return {
    nodes,
    images,
    fragment
  }
}

function collectImageHashes(nodes: SceneNode[], graph: SceneGraph): Set<string> {
  const hashes = new Set<string>()
  function walk(nodeList: SceneNode[]) {
    for (const node of nodeList) {
      for (const fill of node.fills) {
        if (fill.imageHash) hashes.add(fill.imageHash)
      }
      walk(graph.getChildren(node.id))
    }
  }
  walk(nodes)
  return hashes
}

export function buildOpenPencilClipboardHTML(
  nodes: SceneNode[],
  graph: SceneGraph,
  textPictureBuilder?: TextPictureBuilder
): string {
  const data = createSceneFragment(nodes, graph, textPictureBuilder)
  const compressed = deflateSync(new TextEncoder().encode(JSON.stringify(data)))
  return `<!--(openpencil)${compressed.toBase64()}(/openpencil)-->`
}

function createSceneFragment(
  nodes: SceneNode[],
  graph: SceneGraph,
  textPictureBuilder?: TextPictureBuilder
): OpenPencilSceneFragment {
  const nodeTree = collectNodeTree(nodes, graph, textPictureBuilder)
  const hashes = collectImageHashes(nodes, graph)
  const images: Record<string, string> = {}
  for (const hash of hashes) {
    const bytes = graph.images.get(hash)
    if (bytes) images[hash] = bytes.toBase64()
  }
  return {
    format: 'openpencil/v1',
    nodes: nodeTree,
    images
  }
}

export function exportSceneFragment(
  graph: SceneGraph,
  rootNodeIds: string[]
): OpenPencilSceneFragment {
  const nodes = rootNodeIds.map((id) => {
    const node = graph.getNode(id)
    if (!node) throw new Error(`无法导出不存在的节点：${id}`)
    return node
  })
  return createSceneFragment(nodes, graph)
}

function decodedFragment(fragment: OpenPencilSceneFragment): {
  nodes: OpenPencilClipboardNode[]
  images: Map<string, Uint8Array>
} {
  const parsed = parseSceneFragment(fragment)
  if (!parsed) throw new TypeError('无效的 openpencil/v1 节点片段')
  const clipboardData = sceneFragmentToClipboardData(parsed)
  return {
    nodes: clipboardData.nodes,
    images: clipboardData.images
  }
}

export function importSceneFragment(
  targetGraph: SceneGraph,
  parentId: string,
  fragment: OpenPencilSceneFragment
): ImportedSceneFragment {
  if (!targetGraph.getNode(parentId)) throw new Error(`无法导入到不存在的父节点：${parentId}`)
  const decoded = decodedFragment(fragment)
  const idMap = new Map<string, string>()
  const rootNodeIds: string[] = []
  const createdNodeIds: string[] = []
  const previousImages = new Map<string, Uint8Array | undefined>()

  for (const [hash, bytes] of decoded.images) {
    previousImages.set(hash, targetGraph.images.get(hash))
    targetGraph.images.set(hash, bytes)
  }

  const createNodeTree = (source: OpenPencilClipboardNode, targetParentId: string): string => {
    const {
      id: sourceId,
      childIds: _sourceChildIds,
      children = [],
      parentId: _sourceParentId,
      ...properties
    } = source
    const node = targetGraph.createNode(source.type, targetParentId, {
      ...structuredClone(properties),
      childIds: []
    })
    createdNodeIds.push(node.id)
    idMap.set(sourceId, node.id)
    for (const child of children) createNodeTree(child, node.id)
    return node.id
  }

  try {
    for (const node of decoded.nodes) rootNodeIds.push(createNodeTree(node, parentId))

    for (const newId of idMap.values()) {
      const node = targetGraph.getNode(newId)
      if (!node?.componentId) continue
      const remappedComponentId = idMap.get(node.componentId)
      if (remappedComponentId) targetGraph.updateNode(newId, { componentId: remappedComponentId })
    }
    return { rootNodeIds, idMap }
  } catch (error) {
    for (const createdNodeId of [...createdNodeIds].reverse()) {
      targetGraph.deleteNode(createdNodeId)
    }
    for (const [hash, previous] of previousImages) {
      if (previous) targetGraph.images.set(hash, previous)
      else targetGraph.images.delete(hash)
    }
    throw error
  }
}

function collectNodeTree(
  nodes: SceneNode[],
  graph: SceneGraph,
  textPictureBuilder?: TextPictureBuilder
): JsonObject[] {
  return nodes.map((node) => {
    const children = graph.getChildren(node.id)
    const serialized: Record<string, unknown> = { ...node }

    if (node.type === 'TEXT' && node.text) {
      const pic = node.textPicture ?? textPictureBuilder?.(node)
      if (pic) serialized.textPicture = pic.toBase64()
      else delete serialized.textPicture
    } else {
      delete serialized.textPicture
    }

    if (children.length > 0) {
      serialized.children = collectNodeTree(children, graph, textPictureBuilder)
    }
    return serialized
  })
}
