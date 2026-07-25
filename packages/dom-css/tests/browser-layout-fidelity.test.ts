import { describe, expect, it } from 'bun:test'

import type { DesignElement } from '../src/index'
import {
  createHeadlessCSSRuntime,
  designDocumentToSceneGraph,
  htmlToSceneGraph
} from '../src/index'

const TRANSPARENT_PIXEL_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('@open-pencil/dom-css browser layout fidelity', () => {
  it('preserves temporary source keys as conversion trace metadata', async () => {
    const graph = await htmlToSceneGraph(
      '<section data-openpencil-source-key="root"><h1 data-openpencil-source-key="title">Title</h1></section>',
      { runtime: createHeadlessCSSRuntime() }
    )
    const sourceKeys = [...graph.getAllNodes()].flatMap((node) =>
      node.pluginData
        .filter((entry) => entry.pluginId === 'open-pencil-dom-css' && entry.key === 'source-key')
        .map((entry) => entry.value)
    )

    expect(sourceKeys).toEqual(['root', 'title'])
  })

  it('uses browser-relative positions for ordinary block flow', () => {
    const graph = designDocumentToSceneGraph({
      type: 'document',
      children: [
        {
          type: 'element',
          tagName: 'section',
          attrs: {},
          browserBounds: { x: 100, y: 200, width: 320, height: 240 },
          computedStyle: { display: 'block' },
          children: [
            {
              type: 'element',
              tagName: 'h1',
              attrs: {},
              browserBounds: { x: 124, y: 264, width: 180, height: 32 },
              computedStyle: { display: 'block' },
              children: [{ type: 'text', text: 'Measured title' }]
            }
          ]
        }
      ]
    })
    const page = graph.getPages()[0]
    const section = page ? graph.getChildren(page.id)[0] : undefined
    const heading = section ? graph.getChildren(section.id)[0] : undefined

    expect(section?.x).toBe(100)
    expect(section?.y).toBe(200)
    expect(heading?.x).toBe(24)
    expect(heading?.y).toBe(64)
  })

  it('preserves negative flex spacing with measured child positions', () => {
    const children: DesignElement[] = [0, 1, 2].map((index) => ({
      type: 'element',
      tagName: 'img',
      attrs: { src: TRANSPARENT_PIXEL_DATA_URL },
      browserBounds: { x: index * 24, y: 0, width: 32, height: 32 },
      computedStyle: {
        display: 'block',
        width: '32px',
        height: '32px',
        'margin-inline-end': index === 2 ? '0px' : '-8px'
      },
      children: []
    }))
    const graph = designDocumentToSceneGraph({
      type: 'document',
      children: [
        {
          type: 'element',
          tagName: 'div',
          attrs: {},
          browserBounds: { x: 0, y: 0, width: 80, height: 32 },
          computedStyle: {
            display: 'flex',
            'flex-direction': 'row',
            width: '80px',
            height: '32px'
          },
          children
        }
      ]
    })
    const page = graph.getPages()[0]
    const row = page ? graph.getChildren(page.id)[0] : undefined
    const rowChildren = row ? graph.getChildren(row.id) : []

    expect(row?.itemSpacing).toBe(-8)
    expect(rowChildren.map((child) => child.layoutPositioning)).toEqual([
      'ABSOLUTE',
      'ABSOLUTE',
      'ABSOLUTE'
    ])
    expect(rowChildren.map((child) => child.x)).toEqual([0, 24, 48])
  })

  it('preserves unsupported grid alignment with measured child positions', () => {
    const graph = designDocumentToSceneGraph({
      type: 'document',
      children: [
        {
          type: 'element',
          tagName: 'div',
          attrs: {},
          browserBounds: { x: 0, y: 0, width: 400, height: 100 },
          computedStyle: {
            display: 'grid',
            'align-items': 'end',
            'grid-template-columns': '1fr 1fr',
            width: '400px',
            height: '100px'
          },
          children: [
            {
              type: 'element',
              tagName: 'div',
              attrs: {},
              browserBounds: { x: 0, y: 80, width: 80, height: 20 },
              computedStyle: { display: 'block', width: '80px', height: '20px' },
              children: []
            },
            {
              type: 'element',
              tagName: 'div',
              attrs: {},
              browserBounds: { x: 200, y: 40, width: 80, height: 60 },
              computedStyle: { display: 'block', width: '80px', height: '60px' },
              children: []
            }
          ]
        }
      ]
    })
    const page = graph.getPages()[0]
    const grid = page ? graph.getChildren(page.id)[0] : undefined
    const children = grid ? graph.getChildren(grid.id) : []

    expect(grid?.counterAxisAlign).toBe('MAX')
    expect(children.map((child) => child.layoutPositioning)).toEqual(['ABSOLUTE', 'ABSOLUTE'])
    expect(children.map((child) => child.y)).toEqual([80, 40])
  })

  it('preserves non-uniform flex margins with measured child positions', () => {
    const graph = designDocumentToSceneGraph({
      type: 'document',
      children: [
        {
          type: 'element',
          tagName: 'div',
          attrs: {},
          browserBounds: { x: 0, y: 0, width: 200, height: 104 },
          computedStyle: {
            display: 'flex',
            'flex-direction': 'column',
            width: '200px',
            height: '104px'
          },
          children: [
            {
              type: 'element',
              tagName: 'div',
              attrs: {},
              browserBounds: { x: 0, y: 0, width: 200, height: 24 },
              computedStyle: { display: 'block', width: '200px', height: '24px' },
              children: []
            },
            {
              type: 'element',
              tagName: 'div',
              attrs: {},
              browserBounds: { x: 0, y: 64, width: 200, height: 24 },
              computedStyle: {
                display: 'block',
                width: '200px',
                height: '24px',
                'margin-top': '40px'
              },
              children: []
            },
            {
              type: 'element',
              tagName: 'div',
              attrs: {},
              browserBounds: { x: 0, y: 88, width: 200, height: 16 },
              computedStyle: { display: 'block', width: '200px', height: '16px' },
              children: []
            }
          ]
        }
      ]
    })
    const page = graph.getPages()[0]
    const column = page ? graph.getChildren(page.id)[0] : undefined
    const columnChildren = column ? graph.getChildren(column.id) : []

    expect(columnChildren.map((child) => child.layoutPositioning)).toEqual([
      'ABSOLUTE',
      'ABSOLUTE',
      'ABSOLUTE'
    ])
    expect(columnChildren.map((child) => child.y)).toEqual([0, 64, 88])
  })
})
