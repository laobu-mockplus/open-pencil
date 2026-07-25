/**
 * 浏览器 CSS 运行时：在隔离 DOM 中执行真实 CSS 级联、响应式计算与排版测量。
 * iframe 是可配置视口的事实环境；输出的 DesignDOM 只记录浏览器已经算出的结果。
 */
import { serializeHTML } from '../serialize'
import type {
  CSSComputeOptions,
  CSSRuntime,
  DesignDocument,
  DesignElement,
  DesignNode,
  DesignText
} from '../types'

export interface BrowserCSSRuntimeOptions {
  document?: Document
  sandbox?: 'shadow-root' | 'iframe'
  viewport?: BrowserImportViewport
  embedExternalImages?: boolean
  baseURL?: string
}

export interface BrowserImportViewport {
  width: number
  height: number
}

const DEFAULT_COMPUTED_PROPERTIES = [
  'align-items',
  'aspect-ratio',
  'background-color',
  'background-image',
  'border-bottom-color',
  'border-bottom-style',
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'border-bottom-width',
  'border-left-color',
  'border-left-style',
  'border-left-width',
  'border-radius',
  'border-right-color',
  'border-right-style',
  'border-right-width',
  'border-top-color',
  'border-top-style',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-top-width',
  'box-shadow',
  'color',
  'column-gap',
  'display',
  'align-self',
  'bottom',
  'flex-direction',
  'flex-wrap',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'gap',
  'grid-auto-flow',
  'grid-column-end',
  'grid-column-start',
  'grid-row-end',
  'grid-row-start',
  'grid-template-columns',
  'grid-template-rows',
  'height',
  'justify-content',
  'letter-spacing',
  'left',
  'line-height',
  'margin-block-end',
  'margin-block-start',
  'margin-bottom',
  'margin-inline-end',
  'margin-inline-start',
  'margin-left',
  'margin-right',
  'margin-top',
  'max-height',
  'max-width',
  'min-height',
  'min-width',
  'object-fit',
  'opacity',
  'overflow',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'position',
  'right',
  'row-gap',
  'text-align',
  'text-decoration-line',
  'text-shadow',
  'text-transform',
  'top',
  'white-space',
  'width'
] as const

function resolveBrowserDocument(documentOverride: Document | undefined): Document {
  if (documentOverride) return documentOverride
  if (typeof document === 'undefined') {
    throw new TypeError('Browser CSS runtime requires a DOM document')
  }
  return document
}

function attributesToRecord(element: Element): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const attr of Array.from(element.attributes)) {
    attrs[attr.name] = attr.value
  }
  return attrs
}

function styleToRecord(style: CSSStyleDeclaration): Record<string, string> | undefined {
  const entries: Record<string, string> = {}
  for (const property of Array.from(style)) {
    const value = style.getPropertyValue(property)
    if (value) entries[property] = value
  }
  return Object.keys(entries).length > 0 ? entries : undefined
}

const NON_RENDERED_TAGS = new Set(['head', 'link', 'meta', 'script', 'style', 'template', 'title'])

function domNodeToDesignNode(node: Node): DesignNode | null {
  if (node.nodeType === 3) {
    const text = node.textContent ?? ''
    return text.length > 0 ? { type: 'text', text } : null
  }

  if (node.nodeType !== 1) return null

  const element = node as Element
  if (NON_RENDERED_TAGS.has(element.tagName.toLowerCase())) return null
  const children = Array.from(element.childNodes)
    .map(domNodeToDesignNode)
    .filter((child): child is DesignNode => child !== null)
  const style = 'style' in element ? (element.style as CSSStyleDeclaration) : undefined

  return {
    type: 'element',
    tagName: element.tagName.toLowerCase(),
    attrs: attributesToRecord(element),
    children,
    inlineStyle: style ? styleToRecord(style) : undefined
  }
}

function parseHTMLWithDocument(browserDocument: Document, html: string): DesignDocument {
  const Parser = browserDocument.defaultView?.DOMParser
  if (!Parser) throw new TypeError('Browser CSS runtime requires DOMParser')
  const parser = new Parser()
  const parsed = parser.parseFromString(html, 'text/html')
  return {
    type: 'document',
    children: Array.from(parsed.body.childNodes)
      .map(domNodeToDesignNode)
      .filter((node): node is DesignNode => node !== null)
  }
}

interface BrowserNodePairs {
  elements: [DesignElement, Element][]
  texts: [DesignText, Text][]
}

function collectBrowserNodePairs(
  designNode: DesignNode,
  domNode: Node,
  pairs: BrowserNodePairs
): void {
  if (designNode.type === 'text') {
    if (domNode.nodeType === Node.TEXT_NODE) {
      pairs.texts.push([designNode, domNode as Text])
    }
    return
  }
  const view = domNode.ownerDocument?.defaultView
  if (!view || !(domNode instanceof view.Element)) return

  pairs.elements.push([designNode, domNode])

  const domChildren = Array.from(domNode.childNodes)
  for (const [index, child] of designNode.children.entries()) {
    const domChild = domChildren.at(index)
    if (domChild) collectBrowserNodePairs(child, domChild, pairs)
  }
}

function computedStyleToRecord(
  style: CSSStyleDeclaration,
  options: CSSComputeOptions
): Record<string, string> {
  const entries: Record<string, string> = {}
  const properties = options.includeBrowserDefaults
    ? Array.from(style)
    : DEFAULT_COMPUTED_PROPERTIES

  for (const property of properties) {
    const value = style.getPropertyValue(property)
    if (value) entries[property] = value
  }

  return entries
}

function requestFrame(browserDocument: Document): Promise<void> {
  const requestAnimationFrame = browserDocument.defaultView?.requestAnimationFrame
  if (!requestAnimationFrame) return Promise.resolve()
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

/**
 * 图片固有尺寸和 Web Font 都会改变浏览器最终排版；如果在资源尚未完成时测量，
 * 后续 SceneGraph 会永久记录一个只存在于加载过程中的临时几何值。
 */
async function waitForLayoutResources(browserDocument: Document): Promise<void> {
  const images = Array.from(browserDocument.images)
  for (const image of images) image.loading = 'eager'

  const imagePromises = images.map((image) => {
    if (image.complete) return Promise.resolve()
    return new Promise<void>((resolve) => {
      image.addEventListener('load', () => resolve(), { once: true })
      image.addEventListener('error', () => resolve(), { once: true })
    })
  })
  const resourcesReady = Promise.all([browserDocument.fonts.ready, ...imagePromises])
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      resourcesReady,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error('Browser CSS runtime timed out waiting for layout resources')),
          15_000
        )
      })
    ])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }

  // 资源完成后再跨两帧，让浏览器完成样式重算和布局提交。
  await requestFrame(browserDocument)
  await requestFrame(browserDocument)
}

function applySandboxHostStyle(element: HTMLElement, viewport?: BrowserImportViewport): void {
  const width = viewport?.width ?? 1000
  const height = viewport?.height
  element.style.cssText = [
    'position: fixed',
    'left: -100000px',
    'top: 0',
    `width: ${width}px`,
    height ? `height: ${height}px` : 'height: auto',
    'border: 0',
    'box-sizing: border-box',
    'visibility: hidden',
    'pointer-events: none',
    'contain: layout style paint'
  ].join(';')
}

async function computeStylesInShadowRoot(
  browserDocument: Document,
  designDocument: DesignDocument,
  cssText: string,
  options: CSSComputeOptions,
  viewport?: BrowserImportViewport,
  embedExternalImages = true,
  baseURL?: string
): Promise<DesignDocument> {
  if (baseURL) {
    throw new TypeError('Browser CSS runtime baseURL requires the iframe sandbox')
  }
  const host = browserDocument.createElement('div')
  applySandboxHostStyle(host, viewport)

  const shadow = host.attachShadow({ mode: 'open' })
  const style = browserDocument.createElement('style')
  style.textContent = cssText
  shadow.append(style)

  const content = browserDocument.createElement('div')
  content.style.width = '100%'
  content.innerHTML = serializeHTML(designDocument)
  shadow.append(content)
  browserDocument.body.append(host)

  try {
    await waitForLayoutResources(browserDocument)
    const assetView = browserDocument.defaultView
    if (!assetView) throw new TypeError('Browser CSS runtime requires a window for asset loading')
    return await copyComputedStyles(
      designDocument,
      content,
      options,
      embedExternalImages,
      assetView
    )
  } finally {
    host.remove()
  }
}

async function computeStylesInIframe(
  browserDocument: Document,
  designDocument: DesignDocument,
  cssText: string,
  options: CSSComputeOptions,
  viewport?: BrowserImportViewport,
  embedExternalImages = true,
  baseURL?: string
): Promise<DesignDocument> {
  const iframe = browserDocument.createElement('iframe')
  applySandboxHostStyle(iframe, viewport)
  browserDocument.body.append(iframe)

  try {
    const iframeDocument = iframe.contentDocument
    if (!iframeDocument) throw new TypeError('Browser CSS runtime could not create iframe document')
    iframeDocument.open()
    iframeDocument.write(`<!doctype html><html><head></head><body></body></html>`)
    iframeDocument.close()
    iframeDocument.documentElement.style.width = '100%'
    iframeDocument.documentElement.style.height = '100%'
    iframeDocument.body.style.margin = '0'
    iframeDocument.body.style.width = '100%'
    iframeDocument.body.style.minHeight = '100%'

    if (baseURL) {
      const base = iframeDocument.createElement('base')
      base.href = baseURL
      iframeDocument.head.append(base)
    }

    const style = iframeDocument.createElement('style')
    style.textContent = cssText
    iframeDocument.head.append(style)

    const content = iframeDocument.createElement('div')
    content.style.width = '100%'
    content.innerHTML = serializeHTML(designDocument)
    iframeDocument.body.append(content)

    await waitForLayoutResources(iframeDocument)
    const assetView = browserDocument.defaultView
    if (!assetView) throw new TypeError('Browser CSS runtime requires a window for asset loading')
    return await copyComputedStyles(
      designDocument,
      content,
      options,
      embedExternalImages,
      assetView
    )
  } finally {
    iframe.remove()
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return globalThis.btoa(binary)
}

async function embedImageSource(
  designElement: DesignElement,
  domElement: Element,
  view: Window
): Promise<void> {
  if (designElement.tagName.toLowerCase() !== 'img') return
  const image = domElement as HTMLImageElement
  const source = image.currentSrc || image.src || designElement.attrs.src
  if (!source || source.startsWith('data:')) return

  let response: Response
  try {
    response = await view.fetch(source, { credentials: 'same-origin' })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`无法下载图片资源：${source}（${reason}）`, { cause: error })
  }
  if (!response.ok) {
    throw new Error(`无法下载图片资源：${source}（HTTP ${response.status}）`)
  }

  const contentType =
    response.headers.get('content-type')?.split(';')[0] || 'application/octet-stream'
  if (!contentType.startsWith('image/')) {
    throw new Error(`图片资源类型无效：${source}（${contentType}）`)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length === 0) throw new Error(`图片资源内容为空：${source}`)

  designElement.sourceAssetURL = source
  designElement.attrs.src = `data:${contentType};base64,${bytesToBase64(bytes)}`
}

async function copyComputedStyles(
  designDocument: DesignDocument,
  content: Element,
  options: CSSComputeOptions,
  embedExternalImages: boolean,
  assetView: Window
): Promise<DesignDocument> {
  const view = content.ownerDocument.defaultView
  if (!view) throw new TypeError('Browser CSS runtime requires getComputedStyle')

  const nextDocument = structuredClone(designDocument)
  const pairs: BrowserNodePairs = { elements: [], texts: [] }
  const contentBounds = content.getBoundingClientRect()
  const domChildren = Array.from(content.childNodes)
  for (const [index, child] of nextDocument.children.entries()) {
    const domChild = domChildren.at(index)
    if (domChild) collectBrowserNodePairs(child, domChild, pairs)
  }

  for (const [designElement, domElement] of pairs.elements) {
    designElement.computedStyle = computedStyleToRecord(view.getComputedStyle(domElement), options)
    const bounds = domElement.getBoundingClientRect()
    designElement.browserBounds = {
      x: bounds.x - contentBounds.x,
      y: bounds.y - contentBounds.y,
      width: bounds.width,
      height: bounds.height
    }
    if (embedExternalImages) await embedImageSource(designElement, domElement, assetView)
  }

  for (const [designText, domText] of pairs.texts) {
    const range = domText.ownerDocument.createRange()
    range.selectNodeContents(domText)
    const bounds = range.getBoundingClientRect()
    designText.browserBounds = {
      x: bounds.x - contentBounds.x,
      y: bounds.y - contentBounds.y,
      width: bounds.width,
      height: bounds.height
    }
    range.detach()
  }

  return nextDocument
}

export function createBrowserCSSRuntime(options: BrowserCSSRuntimeOptions = {}): CSSRuntime {
  const browserDocument = resolveBrowserDocument(options.document)
  const sandbox = options.sandbox ?? 'shadow-root'
  if (sandbox === 'shadow-root' && options.viewport) {
    throw new TypeError('Browser CSS runtime viewport requires the iframe sandbox')
  }

  return {
    kind: 'browser',
    parseHTML: (html) => parseHTMLWithDocument(browserDocument, html),
    serializeHTML,
    computeStyles: (designDocument, cssText = '', computeOptions = {}) =>
      sandbox === 'iframe'
        ? computeStylesInIframe(
            browserDocument,
            designDocument,
            cssText,
            computeOptions,
            options.viewport,
            options.embedExternalImages,
            options.baseURL
          )
        : computeStylesInShadowRoot(
            browserDocument,
            designDocument,
            cssText,
            computeOptions,
            options.viewport,
            options.embedExternalImages,
            options.baseURL
          )
  }
}
