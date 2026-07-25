import { describe, expect, test } from 'bun:test'

import { exportSceneFragment, importSceneFragment, SceneGraph } from '@open-pencil/core'

describe('OpenPencil public scene fragment API', () => {
  test('appends a JSON-round-tripped fragment twice with fresh IDs and restored assets', () => {
    const source = new SceneGraph()
    const sourcePage = source.getPages()[0]
    if (!sourcePage) throw new Error('Expected source page')

    const imageHash = 'template-image'
    const imageBytes = new Uint8Array([10, 20, 30, 40])
    source.images.set(imageHash, imageBytes)

    const root = source.createNode('FRAME', sourcePage.id, {
      name: 'Pricing block',
      width: 720,
      height: 320,
      pluginData: [{ pluginId: 'a9-template', key: 'blockId', value: 'pricing.oxbow-01' }]
    })
    const image = source.createNode('RECTANGLE', root.id, {
      name: 'Product image',
      width: 160,
      height: 120,
      fills: [
        {
          type: 'IMAGE',
          color: { r: 0, g: 0, b: 0, a: 0 },
          opacity: 1,
          visible: true,
          imageHash,
          imageScaleMode: 'FILL'
        }
      ]
    })

    const fragment = exportSceneFragment(source, [root.id])
    const serialized = JSON.stringify(fragment)
    const transported = JSON.parse(serialized)

    expect(fragment.format).toBe('openpencil/v1')
    expect(fragment.images[imageHash]).toBeDefined()

    const target = new SceneGraph()
    const targetPage = target.getPages()[0]
    if (!targetPage) throw new Error('Expected target page')
    const existing = target.createNode('TEXT', targetPage.id, {
      name: 'Existing content',
      text: 'Do not replace me'
    })

    const first = importSceneFragment(target, targetPage.id, transported)
    const second = importSceneFragment(target, targetPage.id, transported)

    expect(target.getNode(existing.id)?.text).toBe('Do not replace me')
    expect(first.rootNodeIds).toHaveLength(1)
    expect(second.rootNodeIds).toHaveLength(1)
    expect(first.rootNodeIds[0]).not.toBe(second.rootNodeIds[0])
    expect(first.idMap.get(root.id)).toBe(first.rootNodeIds[0])
    expect(second.idMap.get(root.id)).toBe(second.rootNodeIds[0])
    expect(first.idMap.get(image.id)).not.toBe(second.idMap.get(image.id))
    expect(target.images.get(imageHash)).toEqual(imageBytes)

    const importedRoot = target.getNode(first.rootNodeIds[0] ?? '')
    expect(importedRoot?.pluginData).toContainEqual({
      pluginId: 'a9-template',
      key: 'blockId',
      value: 'pricing.oxbow-01'
    })
  })
})
