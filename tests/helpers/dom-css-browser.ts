import process from 'node:process'

import type { Page } from '@playwright/test'

import type { DesignDocument } from '@open-pencil/dom-css'

const BROWSER_RUNTIME_MODULE = `http://localhost:1420/@fs${process.cwd()}/packages/dom-css/src/runtime/browser.ts`
const DOM_CSS_BROWSER_MODULE = 'http://localhost:1420/@id/@open-pencil/dom-css/browser'

async function ensureAppPage(page: Page) {
  if (!page.url().startsWith('http://localhost:1420')) {
    await page.goto('/')
  }
}

export async function setStyledContent(page: Page, css: string, body: string) {
  await page.setContent(`
    <style>${css}</style>
    ${body}
  `)
}

export async function browserRuntimeComputeStyles(
  page: Page,
  document: DesignDocument,
  cssText: string,
  sandbox: 'shadow-root' | 'iframe' = 'iframe',
  viewport?: { width: number; height: number }
) {
  await ensureAppPage(page)

  return page.evaluate(
    async ({ designDocument, css, modulePath, sandboxMode, runtimeViewport }) => {
      const { createBrowserCSSRuntime } = await import(modulePath)
      const runtime = createBrowserCSSRuntime({
        document: window.document,
        sandbox: sandboxMode,
        viewport: runtimeViewport
      })
      return runtime.computeStyles(designDocument, css)
    },
    {
      designDocument: document,
      css: cssText,
      modulePath: BROWSER_RUNTIME_MODULE,
      sandboxMode: sandbox,
      runtimeViewport: viewport
    }
  )
}

export async function publicBrowserHTMLSceneGraph(page: Page, html: string, cssText = '') {
  await ensureAppPage(page)
  await page.setContent('<main></main>')

  return page.evaluate(
    async ({ sourceHTML, css, modulePath }) => {
      const { browserHTMLToSceneGraph } = await import(modulePath)
      const graph = await browserHTMLToSceneGraph(sourceHTML, { cssText: css })
      const pageNode = graph.getPages()[0]
      const card = pageNode ? graph.getChildren(pageNode.id)[0] : undefined
      return card
        ? {
            height: card.height,
            itemSpacing: card.itemSpacing,
            layoutMode: card.layoutMode,
            paddingLeft: card.paddingLeft,
            type: card.type,
            width: card.width
          }
        : null
    },
    { sourceHTML: html, css: cssText, modulePath: DOM_CSS_BROWSER_MODULE }
  )
}

export async function publicBrowserSceneGraph(page: Page, classes: string[], cssText: string) {
  await ensureAppPage(page)
  await page.setContent('<main></main>')

  return page.evaluate(
    async ({ candidates, css, modulePath }) => {
      const { browserJSXToSceneGraph, jsx } = await import(modulePath)
      const graph = await browserJSXToSceneGraph(
        jsx('article', {
          class: candidates.join(' '),
          children: jsx('h1', { children: 'OpenPencil' })
        }),
        { cssText: css }
      )
      const pageNode = graph.getPages()[0]
      const card = pageNode ? graph.getChildren(pageNode.id)[0] : undefined
      return card
        ? {
            height: card.height,
            itemSpacing: card.itemSpacing,
            layoutMode: card.layoutMode,
            paddingLeft: card.paddingLeft,
            type: card.type,
            width: card.width
          }
        : null
    },
    { candidates: classes, css: cssText, modulePath: DOM_CSS_BROWSER_MODULE }
  )
}

export async function publicBrowserImageNode(
  page: Page,
  html: string,
  cssText: string,
  options: { baseURL?: string } = {}
) {
  await ensureAppPage(page)
  await page.setContent('<main></main>')

  return page.evaluate(
    async ({ sourceHTML, css, modulePath, baseURL }) => {
      const { browserHTMLToSceneGraph } = await import(modulePath)
      const graph = await browserHTMLToSceneGraph(sourceHTML, { cssText: css, baseURL })
      const pageNode = graph.getPages()[0]
      const image = pageNode ? graph.getChildren(pageNode.id)[0] : undefined
      const fill = image?.fills[0]
      const imageBytes =
        fill?.type === 'IMAGE' && fill.imageHash
          ? graph.images.get(fill.imageHash)
          : undefined
      return image
        ? {
            fillType: fill?.type,
            hasImageBytes: fill?.imageHash ? graph.images.has(fill.imageHash) : false,
            height: image.height,
            imageBytesPrefix: imageBytes ? Array.from(imageBytes.slice(0, 4)) : [],
            imageScaleMode: fill?.imageScaleMode,
            sourceURL: image.pluginData.find(
              (entry) =>
                entry.pluginId === 'open-pencil-dom-css' && entry.key === 'image-source-url'
            )?.value,
            type: image.type,
            width: image.width
          }
        : null
    },
    { sourceHTML: html, css: cssText, modulePath: DOM_CSS_BROWSER_MODULE, baseURL: options.baseURL }
  )
}

export async function publicBrowserTextNode(page: Page, html: string, cssText: string) {
  await ensureAppPage(page)
  await page.setContent('<main></main>')

  return page.evaluate(
    async ({ sourceHTML, css, modulePath }) => {
      const { browserHTMLToSceneGraph } = await import(modulePath)
      const graph = await browserHTMLToSceneGraph(sourceHTML, { cssText: css })
      return graph.getAllNodes().find((node) => node.type === 'TEXT')
    },
    { sourceHTML: html, css: cssText, modulePath: DOM_CSS_BROWSER_MODULE }
  )
}

export async function publicBrowserStructure(
  page: Page,
  html: string,
  cssText: string,
  viewport: { width: number; height: number }
) {
  await ensureAppPage(page)
  await page.setContent('<main></main>')

  return page.evaluate(
    async ({ sourceHTML, css, modulePath, importViewport }) => {
      const { browserHTMLToSceneGraph } = await import(modulePath)
      const graph = await browserHTMLToSceneGraph(sourceHTML, {
        cssText: css,
        viewport: importViewport
      })
      const nodes = [...graph.getAllNodes()]
      const pageNode = graph.getPages()[0]
      const root = pageNode ? graph.getChildren(pageNode.id)[0] : undefined
      return {
        gridCount: nodes.filter((node) => node.layoutMode === 'GRID').length,
        imageCount: nodes.filter((node) => node.fills.some((fill) => fill.type === 'IMAGE')).length,
        rootColumns: root?.gridTemplateColumns,
        rootLayoutMode: root?.layoutMode,
        vectorCount: nodes.filter((node) => node.type === 'VECTOR').length
      }
    },
    { sourceHTML: html, css: cssText, modulePath: DOM_CSS_BROWSER_MODULE, importViewport: viewport }
  )
}

export async function computedStyleProperties(
  page: Page,
  selector: string,
  properties: readonly string[]
) {
  return page.locator(selector).evaluate((element, styleProperties) => {
    const computed = getComputedStyle(element)
    return Object.fromEntries(
      styleProperties.map((property) => [property, computed.getPropertyValue(property)])
    )
  }, properties)
}
