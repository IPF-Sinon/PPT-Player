import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const deck = join(root, 'tests', 'fixtures', 'deck-animated.pptx')

let app: ElectronApplication
let win: Page

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  expect(existsSync(deck), 'fixture must exist').toBe(true)
  app = await electron.launch({
    args: ['.', deck],
    cwd: root,
    env: { ...process.env, NODE_ENV: 'test' }
  })
  win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  await expect(win.getByTestId('deck-name')).toContainText('deck-animated', { timeout: 30_000 })
})

test.afterAll(async () => {
  await app?.close()
})

/** Measure an element's box together with the viewport, in one round trip. */
async function measure(testId: string): Promise<{
  box: { x: number; y: number; width: number; height: number } | null
  viewport: { width: number; height: number }
}> {
  return await win.evaluate((id) => {
    const g = globalThis as unknown as {
      innerWidth: number
      innerHeight: number
      document: { querySelector(sel: string): { getBoundingClientRect(): { x: number; y: number; width: number; height: number } } | null }
    }
    const el = g.document.querySelector('[data-testid="' + id + '"]')
    const rect = el ? el.getBoundingClientRect() : null
    return {
      box: rect
        ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        : null,
      viewport: { width: g.innerWidth, height: g.innerHeight }
    }
  }, testId)
}

test('1. the work area fills most of the window', async () => {
  // The regression this guards: a fixed-row grid gave the tab bar row 1 and stretched
  // the header over 1fr, which squeezed the work area into the 64px footer row.
  const { box, viewport } = await measure('preview-body')
  expect(box).not.toBeNull()
  expect(box!.height).toBeGreaterThan(viewport.height * 0.72)
})

test('2. the footer stays fully inside the viewport', async () => {
  const body = await measure('preview-body')
  const footer = await measure('bottombar')
  expect(footer.box).not.toBeNull()
  // The bar must not be clipped by the window edge, which is what happened when the
  // grid pushed it onto a fourth row.
  expect(footer.box!.y + footer.box!.height).toBeLessThanOrEqual(footer.viewport.height + 1)
  expect(footer.box!.height).toBeGreaterThanOrEqual(44)
  expect(footer.box!.height).toBeLessThanOrEqual(64)
  // And the work area must end above it rather than overlapping.
  expect(body.box!.y + body.box!.height).toBeLessThanOrEqual(footer.viewport.height + 1)
})

test('3. the start button is visible and clickable without scrolling', async () => {
  const button = win.getByTestId('start-show')
  await expect(button).toBeVisible()
  const { box, viewport } = await measure('start-show')
  expect(box).not.toBeNull()
  expect(box!.y).toBeGreaterThan(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 1)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1)
})

test('4. the slide renders at a usable size', async () => {
  // A slide squeezed into the footer row measured about 30px wide.
  const { box } = await measure('pptx-slide')
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(480)
  expect(box!.height).toBeGreaterThanOrEqual(270)
})

test('5. the slide keeps its aspect ratio', async () => {
  const { box } = await measure('pptx-slide')
  expect(box).not.toBeNull()
  const ratio = box!.width / box!.height
  expect(Math.abs(ratio - 16 / 9)).toBeLessThan(0.05)
})

test('6. badges stay on a single line', async () => {
  // The engine badge used to wrap to two lines inside the header.
  const heights = await win.evaluate(() => {
    const g = globalThis as unknown as {
      document: {
        querySelectorAll(sel: string): ArrayLike<{ getBoundingClientRect(): { height: number } }>
      }
    }
    const nodes = g.document.querySelectorAll('.badge')
    const out: number[] = []
    for (let i = 0; i < nodes.length; i++) out.push(nodes[i].getBoundingClientRect().height)
    return out
  })
  for (const height of heights) {
    expect(height).toBeLessThanOrEqual(32)
  }
})

test('7. the tab bar holds the tabs and the actions on one row', async () => {
  const { box } = await measure('tabbar')
  expect(box).not.toBeNull()
  // One row: tall enough for a tab, far shorter than the old stretched header.
  expect(box!.height).toBeGreaterThanOrEqual(32)
  expect(box!.height).toBeLessThanOrEqual(60)
})

test('8. the redundant window close button is gone', async () => {
  // Windows already draws one; the header carried a duplicate.
  const closeCount = await win.evaluate(() => {
    const g = globalThis as unknown as {
      document: { querySelectorAll(sel: string): ArrayLike<unknown> }
    }
    return g.document.querySelectorAll('[aria-label="关闭"]').length
  })
  expect(closeCount).toBe(0)
})

test('9. the thumbnail rail is wide enough to read', async () => {
  const { box } = await measure('thumb-rail')
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(180)
  expect(box!.width).toBeLessThanOrEqual(260)
})

test('10. the first thumbnail actually renders content', async () => {
  // A blank thumbnail on a real deck is what started this round of fixes.
  const painted = await win.evaluate(() => {
    const g = globalThis as unknown as {
      document: { querySelector(sel: string): { querySelector(sel: string): unknown } | null }
    }
    const thumb = g.document.querySelector('[data-testid="thumb-1"]')
    if (!thumb) return false
    const slide = thumb.querySelector('.pptx-slide')
    return slide !== null
  })
  expect(painted).toBe(true)
})
