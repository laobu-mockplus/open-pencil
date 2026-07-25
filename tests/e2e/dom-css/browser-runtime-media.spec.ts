import process from 'node:process'

import {
  browserRuntimeComputeStyles,
  computedStyleProperties,
  publicBrowserImageNode,
  publicBrowserStructure,
  setStyledContent
} from '#tests/helpers/dom-css-browser'

import { expect, test } from '../fixtures'

const TRANSPARENT_PIXEL_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

test.describe('@open-pencil/dom-css browser CSS media and image oracle', () => {
  test('uses the requested import viewport and records browser geometry', async ({ page }) => {
    const document = {
      type: 'document' as const,
      children: [
        {
          type: 'element' as const,
          tagName: 'section',
          attrs: { class: 'feature-grid' },
          children: [
            {
              type: 'element' as const,
              tagName: 'article',
              attrs: {},
              children: [{ type: 'text' as const, text: 'One' }]
            },
            {
              type: 'element' as const,
              tagName: 'article',
              attrs: {},
              children: [{ type: 'text' as const, text: 'Two' }]
            }
          ]
        }
      ]
    }
    const css = `
      * { box-sizing: border-box; }
      .feature-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 24px;
        width: 100%;
        padding: 16px;
      }
      .feature-grid article { height: 80px; }
      @media (max-width: 639px) {
        .feature-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
      }
    `

    const desktop = await browserRuntimeComputeStyles(page, document, css, 'iframe', {
      width: 1440,
      height: 900
    })
    const mobile = await browserRuntimeComputeStyles(page, document, css, 'iframe', {
      width: 390,
      height: 844
    })
    const desktopGrid = desktop.children[0]
    const mobileGrid = mobile.children[0]

    expect(desktopGrid?.type).toBe('element')
    expect(mobileGrid?.type).toBe('element')
    if (desktopGrid?.type !== 'element' || mobileGrid?.type !== 'element') return

    expect(desktopGrid.computedStyle?.['grid-template-columns']).toBe('692px 692px')
    expect(mobileGrid.computedStyle?.['grid-template-columns']).toBe('358px')
    expect(desktopGrid.browserBounds).toEqual({ x: 0, y: 0, width: 1440, height: 112 })
    expect(mobileGrid.browserBounds).toEqual({ x: 0, y: 0, width: 390, height: 204 })
  })

  test('resolves media queries and inherited em/rem units in a real browser', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 600 })
    await setStyledContent(
      page,
      `
        :root { font-size: 10px; }
        .panel {
          font-size: 20px;
          width: 20rem;
          padding: 2em;
        }
        @media (min-width: 800px) {
          .panel { width: 30rem; }
        }
      `,
      '<section class="panel">OpenPencil</section>'
    )

    const widePanel = await computedStyleProperties(page, '.panel', [
      'font-size',
      'padding-left',
      'width'
    ])
    expect(widePanel['font-size']).toBe('20px')
    expect(widePanel['padding-left']).toBe('40px')
    expect(widePanel.width).toBe('300px')

    await page.setViewportSize({ width: 640, height: 600 })
    const narrowPanel = await computedStyleProperties(page, '.panel', ['width'])
    expect(narrowPanel.width).toBe('200px')
  })

  test('projects browser image sizing and object fit into scene graph fields', async ({ page }) => {
    const imageNode = await publicBrowserImageNode(
      page,
      `<img class="media" alt="Preview" src="${TRANSPARENT_PIXEL_DATA_URL}" />`,
      '.media { aspect-ratio: 16 / 9; object-fit: contain; width: 320px; }'
    )

    expect(imageNode?.type).toBe('FRAME')
    expect(imageNode?.width).toBe(320)
    expect(imageNode?.height).toBe(180)
    expect(imageNode?.fillType).toBe('IMAGE')
    expect(imageNode?.imageScaleMode).toBe('FIT')
    expect(imageNode?.hasImageBytes).toBe(true)
  })

  test('downloads same-origin image assets into the scene graph image store', async ({ page }) => {
    const imageNode = await publicBrowserImageNode(
      page,
      '<img class="media" alt="OpenPencil" src="/pwa-192.png" />',
      '.media { object-fit: cover; width: 192px; height: 192px; }'
    )

    expect(imageNode?.type).toBe('FRAME')
    expect(imageNode?.fillType).toBe('IMAGE')
    expect(imageNode?.hasImageBytes).toBe(true)
  })

  test('waits for delayed image intrinsic sizing before measuring browser geometry', async ({
    page
  }) => {
    await page.route('**/delayed-wide.svg', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 200))
      await route.fulfill({
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1790 1162"></svg>',
        contentType: 'image/svg+xml'
      })
    })

    const imageNode = await publicBrowserImageNode(
      page,
      '<img class="media" alt="Preview" src="/delayed-wide.svg" />',
      '.media { display: block; width: 320px; height: auto; }'
    )

    expect(imageNode?.width).toBe(320)
    expect(imageNode?.height).toBeCloseTo(207.73, 1)
  })

  test('resolves relative assets against the registered source base URL', async ({ page }) => {
    const baseURL = `http://localhost:1420/@fs${process.cwd()}/tests/fixtures/dom-css/`
    const imageNode = await publicBrowserImageNode(
      page,
      '<img class="media" alt="Fixture" src="test-image.svg" />',
      '.media { width: 20px; height: 20px; }',
      { baseURL }
    )

    expect(imageNode?.fillType).toBe('IMAGE')
    expect(imageNode?.hasImageBytes).toBe(true)
    expect(imageNode?.sourceURL).toBe(`${baseURL}test-image.svg`)
  })

  test('projects responsive Grid, SVG vectors, and embedded images together', async ({ page }) => {
    const structure = await publicBrowserStructure(
      page,
      `
        <section class="feature-grid">
          <article>
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M5 12l4 4L19 6" stroke-width="2" stroke-linecap="round" />
            </svg>
          </article>
          <img class="preview" src="${TRANSPARENT_PIXEL_DATA_URL}" alt="Preview" />
        </section>
      `,
      `
        * { box-sizing: border-box; }
        .feature-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 24px;
          width: 100%;
        }
        .icon { color: #16a34a; width: 24px; height: 24px; }
        .preview { width: 120px; height: 80px; object-fit: cover; }
        @media (max-width: 639px) {
          .feature-grid { grid-template-columns: minmax(0, 1fr); gap: 12px; }
        }
      `,
      { width: 390, height: 844 }
    )

    expect(structure.rootLayoutMode).toBe('GRID')
    expect(structure.rootColumns).toHaveLength(1)
    expect(structure.gridCount).toBe(1)
    expect(structure.vectorCount).toBe(1)
    expect(structure.imageCount).toBe(1)
  })
})
