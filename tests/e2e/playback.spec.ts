import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const shots = join(root, 'test-results', 'screens')
mkdirSync(shots, { recursive: true })

const deckPath = join(root, 'tests', 'fixtures', 'deck-16x9.pptx')
const deckName = 'deck-16x9.pptx'

let app: ElectronApplication
let win: Page

/**
 * Wake the chrome and click a control until the page indicator reaches the
 * expected value. The chrome fades after 2.5s of idle and stops taking pointer
 * events, so a click can otherwise land on the slide.
 */
async function clickUntilPage(page: Page, testId: string, expected: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.mouse.move(400, 400).catch(() => undefined)
        const control = page.getByTestId(testId)
        await control.click({ timeout: 3000 }).catch(() => undefined)
        return await page.getByTestId('page-indicator').textContent().catch(() => '')
      },
      { timeout: 60_000, intervals: [300, 800, 1500] }
    )
    .toContain(expected)
}

/** True when the window reports itself as fullscreen. */
async function isFullScreen(): Promise<boolean> {
  return await app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows()
    return all.length > 0 && all[0].isFullScreen()
  })
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  expect(existsSync(deckPath), 'fixture deck must exist before e2e').toBe(true)
  app = await electron.launch({
    args: ['.', deckPath],
    cwd: root,
    env: { ...process.env, NODE_ENV: 'test' }
  })

  const mainProc = app.process()
  mainProc.stdout?.on('data', (chunk: Buffer) => console.log('[main:out]', chunk.toString().trim()))
  mainProc.stderr?.on('data', (chunk: Buffer) => console.log('[main:err]', chunk.toString().trim()))

  win = await app.firstWindow()
  win.on('console', (msg) => console.log('[renderer]', msg.type(), msg.text()))
  win.on('pageerror', (err) => console.log('[renderer:error]', err.message))
  await win.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('1. preview opens the deck passed on the command line', async () => {
  await expect(win.getByTestId('preview-page')).toBeVisible()

  await expect
    .poll(async () => win.evaluate("document.querySelector('[data-testid=\"deck-name\"]').textContent"), {
      timeout: 180_000
    })
    .toBe(deckName)

  const errorText = await win
    .evaluate("(document.querySelector('[data-testid=\"error-overlay\"]')||{}).textContent || ''")
    .catch(() => '')
  if (errorText) console.log('[e2e] error card:', errorText)

  await expect(win.getByTestId('deck-format')).toHaveText('PPTX')
  await win.screenshot({ path: join(shots, 'preview.png') })
})

test('2. thumbnail rail lists every slide', async () => {
  await expect(win.getByTestId('thumb-rail')).toBeVisible()
  await expect(win.getByTestId('thumb-1')).toBeVisible()
  await expect(win.getByTestId('thumb-2')).toBeVisible()
  await expect(win.getByTestId('thumb-3')).toBeVisible()
})

test('3. clicking a thumbnail moves the stage to that slide', async () => {
  await expect(win.getByTestId('preview-pager')).toHaveText('1 / 3')
  await win.getByTestId('thumb-2').click()
  await expect(win.getByTestId('preview-pager')).toHaveText('2 / 3')
})

test('4. playback uses the same window and goes fullscreen', async () => {
  const windowsBefore = app.windows().length
  await win.getByTestId('start-here').click()

  await expect.poll(async () => isFullScreen(), { timeout: 30_000 }).toBe(true)
  // No second BrowserWindow: entering a show must not spawn a new renderer.
  expect(app.windows().length).toBe(windowsBefore)

  await expect(win.getByTestId('playback-page')).toBeVisible()
  // A PPTX now renders natively, so the canvas only exists for converted decks.
  // The frame is the stable thing to assert on, and data-painted proves it drew.
  const frame = win.getByTestId('slide-frame')
  await expect(frame).toBeVisible()
  await expect(frame).toHaveAttribute('data-painted', 'true', { timeout: 30_000 })
  await win.screenshot({ path: join(shots, 'playback.png') })
})

test('5. playback starts on the slide the preview was showing', async () => {
  await expect(win.getByTestId('page-indicator')).toContainText('2 / 3')
})

test('6. keyboard navigation advances and rewinds', async () => {
  await win.mouse.move(400, 300)
  await expect
    .poll(
      async () => {
        await win.keyboard.press('ArrowRight').catch(() => undefined)
        return await win.getByTestId('page-indicator').textContent().catch(() => '')
      },
      { timeout: 30_000, intervals: [250, 500, 1000] }
    )
    .toContain('3 / 3')

  await expect
    .poll(
      async () => {
        await win.keyboard.press('ArrowLeft').catch(() => undefined)
        return await win.getByTestId('page-indicator').textContent().catch(() => '')
      },
      { timeout: 30_000, intervals: [250, 500, 1000] }
    )
    .toContain('2 / 3')
})

test('7. the toolbar drives paging', async () => {
  await clickUntilPage(win, 'tool-next', '3 / 3')
  await clickUntilPage(win, 'tool-prev', '2 / 3')
})

test('8. the slide fills the screen without padding', async () => {
  // A 16:9 deck on a 16:9 viewport must cover the whole area: the old layout kept a
  // fixed 48px inset, which showed as a black border on every show.
  const box = await win.getByTestId('slide-frame').boundingBox()
  expect(box).not.toBeNull()
  // The e2e tsconfig has no DOM lib, so the page-side globals are reached
  // through evaluate's own function scope rather than referenced directly.
  const viewport = await win.evaluate(() => {
    const g = globalThis as unknown as { innerWidth: number; innerHeight: number }
    return { width: g.innerWidth, height: g.innerHeight }
  })

  const ratio = box!.width / box!.height
  expect(Math.abs(ratio - 16 / 9)).toBeLessThan(0.05)

  // At least one dimension must be flush with the edge.
  const touchesEdge =
    Math.abs(box!.width - viewport.width) < 2 || Math.abs(box!.height - viewport.height) < 2
  expect(touchesEdge).toBe(true)
})

test('9. the toolbar is translucent', async () => {
  const alpha = await win.getByTestId('play-toolbar').evaluate((node) => {
    const cluster = node.querySelector('.tool-cluster')
    if (!cluster) return null
    const g = globalThis as unknown as {
      getComputedStyle(el: unknown): { backgroundColor: string }
    }
    const bg = g.getComputedStyle(cluster).backgroundColor
    const match = /rgba?\(([^)]+)\)/.exec(bg)
    if (!match) return null
    const parts = match[1].split(',').map((v) => Number(v.trim()))
    return parts.length === 4 ? parts[3] : 1
  })
  expect(alpha).not.toBeNull()
  expect(alpha!).toBeGreaterThan(0.1)
  expect(alpha!).toBeLessThan(0.9)
})

test('10. annotations survive switching back to the pointer tool', async () => {
  // This is the regression that erased every stroke the moment the presenter
  // returned to the pointer: the ink canvas was unmounted when not drawing.
  await win.mouse.move(400, 300)
  await win.getByTestId('tool-pen').click()
  const canvas = win.getByTestId('slide-frame')
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()

  await win.mouse.move(box!.x + box!.width * 0.3, box!.y + box!.height * 0.4)
  await win.mouse.down()
  await win.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5, { steps: 6 })
  await win.mouse.move(box!.x + box!.width * 0.6, box!.y + box!.height * 0.45, { steps: 6 })
  await win.mouse.up()

  const paintedBefore = await win.getByTestId('ink-layer').evaluate((node) => {
    const canvas = node as unknown as {
      width: number
      height: number
      getContext(id: '2d'): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } | null
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return 0
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let painted = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++
    return painted
  })
  expect(paintedBefore).toBeGreaterThan(0)

  // Switch to the pointer tool; the strokes must stay on screen.
  await win.getByTestId('tool-pointer').click()
  await expect(win.getByTestId('ink-layer')).toHaveCount(1)
  const paintedAfter = await win.getByTestId('ink-layer').evaluate((node) => {
    const canvas = node as unknown as {
      width: number
      height: number
      getContext(id: '2d'): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } | null
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return 0
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let painted = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++
    return painted
  })
  expect(paintedAfter).toBe(paintedBefore)
  await win.screenshot({ path: join(shots, 'playback-ink.png') })
})

test('11. undo removes the last stroke', async () => {
  await win.mouse.move(400, 300)
  const before = await win.getByTestId('ink-layer').evaluate((node) => {
    const canvas = node as unknown as { width: number; height: number }
    return canvas.width
  })
  expect(before).toBeGreaterThan(0)
  await win.getByTestId('tool-undo').click()
  const painted = await win.getByTestId('ink-layer').evaluate((node) => {
    const canvas = node as unknown as {
      width: number
      height: number
      getContext(id: '2d'): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } | null
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return 0
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let count = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) count++
    return count
  })
  expect(painted).toBe(0)
})

test('12. the whiteboard opens, takes ink, and closes with Escape', async () => {
  await win.mouse.move(400, 300)
  await expect
    .poll(
      async () => {
        await win.getByTestId('tool-board').click({ timeout: 2000 }).catch(() => undefined)
        return await win.getByTestId('whiteboard').isVisible().catch(() => false)
      },
      { timeout: 20_000, intervals: [300, 800, 1500] }
    )
    .toBe(true)

  const board = win.getByTestId('whiteboard')
  const box = await board.boundingBox()
  expect(box).not.toBeNull()

  await win.mouse.move(box!.x + box!.width * 0.3, box!.y + box!.height * 0.4)
  await win.mouse.down()
  await win.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.55, { steps: 8 })
  await win.mouse.move(box!.x + box!.width * 0.7, box!.y + box!.height * 0.45, { steps: 8 })
  await win.mouse.up()

  const inked = await board.evaluate((node) => {
    const canvas = node as unknown as {
      width: number
      height: number
      getContext(id: '2d'): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } | null
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return 0
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let painted = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++
    return painted
  })
  expect(inked).toBeGreaterThan(0)
  await win.screenshot({ path: join(shots, 'whiteboard.png') })

  await win.keyboard.press('Escape')
  await expect(board).toBeHidden()
})

test('13. leaving playback returns to preview in the same window', async () => {
  await win.getByTestId('tool-end').click({ timeout: 5000 }).catch(async () => {
    await win.keyboard.press('Escape')
  })
  await expect.poll(async () => isFullScreen(), { timeout: 30_000 }).toBe(false)
  await expect(win.getByTestId('preview-page')).toBeVisible()
  // Still one window, and the deck is still mounted: nothing was reloaded.
  expect(app.windows().length).toBe(1)
  await expect(win.getByTestId('deck-name')).toHaveText(deckName)
})

test('14. the window title carries the file name', async () => {
  expect(await win.title()).toContain(deckName)
})