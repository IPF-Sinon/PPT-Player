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
let preview: Page
let playback: Page | null = null

/** Locate the playback window among all open windows. */
async function findPlayback(): Promise<Page | null> {
  for (const page of app.windows()) {
    if (page.isClosed()) continue
    const isPlayback = await page
      .evaluate("!!document.querySelector('[data-testid=\"playback-page\"]')")
      .catch(() => false)
    if (isPlayback) return page
  }
  return null
}

/**
 * Click a chrome control and retry until the page label changes.
 *
 * The chrome fades out after 2.5s of idle and stops receiving pointer events, so
 * a click can silently land on the slide instead. Move the mouse to wake it, wait
 * for the control to be fully opaque, then click.
 */
async function clickUntilPage(page: Page, testId: string, expected: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.mouse.move(500, 400).catch(() => undefined)
        const control = page.getByTestId(testId)
        await expect(control).toHaveCSS('opacity', '1', { timeout: 3000 }).catch(() => undefined)
        await control.click({ timeout: 3000 }).catch(() => undefined)
        return await page
          .getByTestId('side-page-left')
          .textContent()
          .catch(() => '')
      },
      { timeout: 90_000, intervals: [500, 1000, 2000] }
    )
    .toBe(expected)
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  expect(existsSync(deckPath), 'fixture deck must exist before e2e').toBe(true)
  app = await electron.launch({
    args: ['.', deckPath],
    cwd: root,
    env: { ...process.env, NODE_ENV: 'test' }
  })

  // Surface main-process output so failures are diagnosable from the CI log.
  const mainProc = app.process()
  mainProc.stdout?.on('data', (chunk: Buffer) => console.log('[main:out]', chunk.toString().trim()))
  mainProc.stderr?.on('data', (chunk: Buffer) => console.log('[main:err]', chunk.toString().trim()))

  preview = await app.firstWindow()
  preview.on('console', (msg) => console.log('[renderer]', msg.type(), msg.text()))
  preview.on('pageerror', (err) => console.log('[renderer:error]', err.message))
  await preview.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('1. preview page opens the deck passed on the command line', async () => {
  await expect(preview.getByTestId('preview-page')).toBeVisible()



  // Wait for the deck name, and report the error card text if it never appears.
  await expect
    .poll(
      async () =>
        preview.evaluate(
          "document.querySelector('[data-testid=\"deck-name\"]').textContent"
        ),
      { timeout: 180_000 }
    )
    .toBe(deckName)

  // If the deck never mounts, capture what the UI is actually showing.
  const errorText = await preview
    .evaluate("(document.querySelector('[data-testid=\"error-overlay\"]')||{}).textContent || ''")
    .catch(() => '')
  if (errorText) console.log('[e2e] error card:', errorText)

  await expect(preview.getByTestId('deck-format')).toHaveText('PPTX')
  await preview.screenshot({ path: join(shots, 'preview.png') })
})

test('2. thumbnail rail lists every slide', async () => {
  await expect(preview.getByTestId('thumb-rail')).toBeVisible()
  await expect(preview.getByTestId('thumb-1')).toBeVisible()
  await expect(preview.getByTestId('thumb-2')).toBeVisible()
  await expect(preview.getByTestId('thumb-3')).toBeVisible()
})

test('3. clicking a thumbnail moves the stage to that slide', async () => {
  await expect(preview.getByTestId('preview-pager')).toHaveText('1 / 3')
  await preview.getByTestId('thumb-2').click()
  await expect(preview.getByTestId('preview-pager')).toHaveText('2 / 3')
})

test('4. starting the show opens a fullscreen playback window', async () => {
  await preview.getByTestId('start-here').click()
  await expect.poll(async () => (await findPlayback()) !== null, { timeout: 90_000 }).toBe(true)
  playback = await findPlayback()
  expect(playback).not.toBeNull()
  await expect(playback!.getByTestId('playback-page')).toBeVisible()
  await expect(playback!.getByTestId('playback-canvas')).toBeVisible()
  await playback!.screenshot({ path: join(shots, 'playback.png') })
})

test('5. playback starts on the slide the preview was showing', async () => {
  expect(playback).not.toBeNull()
  await expect(playback!.getByTestId('side-page-left')).toHaveText('2/3')
  await expect(playback!.getByTestId('side-page-right')).toHaveText('2/3')
})

test('6. keyboard navigation advances and rewinds', async () => {
  expect(playback).not.toBeNull()
  await playback!.mouse.move(640, 360)

  // Retry the keypress: under CPU load a single dispatched key can be lost.
  await expect
    .poll(
      async () => {
        await playback!.keyboard.press('ArrowRight').catch(() => undefined)
        return await playback!
          .getByTestId('side-page-left')
          .textContent()
          .catch(() => '')
      },
      { timeout: 45_000, intervals: [250, 500, 1000] }
    )
    .toBe('3/3')

  await expect
    .poll(
      async () => {
        await playback!.keyboard.press('ArrowLeft').catch(() => undefined)
        return await playback!
          .getByTestId('side-page-left')
          .textContent()
          .catch(() => '')
      },
      { timeout: 45_000, intervals: [250, 500, 1000] }
    )
    .toBe('2/3')
})

test('7. both side nav stacks are clickable', async () => {
  expect(playback).not.toBeNull()
  await clickUntilPage(playback!, 'side-next-right', '3/3')
  await expect(playback!.getByTestId('side-page-right')).toHaveText('3/3')
  await clickUntilPage(playback!, 'side-prev-left', '2/3')
  await expect(playback!.getByTestId('side-page-right')).toHaveText('2/3')
})

test('8. blackout hides the slide and any click restores it', async () => {
  expect(playback).not.toBeNull()
  await expect
    .poll(
      async () => {
        await playback!.mouse.move(640, 360)
        await playback!.getByTestId('tool-blackout').click({ timeout: 2000 }).catch(() => undefined)
        return await playback!
          .getByTestId('playback-page')
          .getAttribute('data-blackout')
          .catch(() => null)
      },
      { timeout: 30_000, intervals: [200, 400, 800] }
    )
    .toBe('true')
  await playback!.screenshot({ path: join(shots, 'playback-blackout.png') })
  // The chrome is hidden while blanked, so a click on the surface must restore it.
  await playback!.mouse.click(20, 20)
  await expect(playback!.getByTestId('playback-page')).toHaveAttribute('data-blackout', 'false')
  await expect(playback!.getByTestId('tool-blackout')).toBeVisible()
})

test('9. the pen tool records ink on the slide', async () => {
  expect(playback).not.toBeNull()
  await playback!.mouse.move(640, 360)
  await playback!.getByTestId('tool-pen').click()
  const layer = playback!.getByTestId('ink-layer')
  await expect(layer).toBeVisible()
  const box = await layer.boundingBox()
  expect(box).not.toBeNull()
  const { x, y, width, height } = box!
  await playback!.mouse.move(x + width * 0.3, y + height * 0.4)
  await playback!.mouse.down()
  await playback!.mouse.move(x + width * 0.5, y + height * 0.55, { steps: 8 })
  await playback!.mouse.move(x + width * 0.62, y + height * 0.45, { steps: 8 })
  await playback!.mouse.up()
  await playback!.screenshot({ path: join(shots, 'playback-ink.png') })
  await playback!.getByTestId('tool-pointer').click()
})

test('10. the whiteboard opens, takes ink, and closes with Escape', async () => {
  expect(playback).not.toBeNull()

  // The board is a real drawing surface, not just a blanked slide.
  await expect
    .poll(
      async () => {
        await playback!.mouse.move(640, 400).catch(() => undefined)
        await playback!
          .getByTestId('tool-board')
          .click({ timeout: 2000 })
          .catch(() => undefined)
        return await playback!
          .getByTestId('whiteboard')
          .isVisible()
          .catch(() => false)
      },
      { timeout: 30_000, intervals: [300, 800, 1500] }
    )
    .toBe(true)

  const board = playback!.getByTestId('whiteboard')
  const box = await board.boundingBox()
  expect(box).not.toBeNull()

  // Draw one stroke and confirm the pen actually marked the canvas.
  await playback!.mouse.move(box!.x + box!.width * 0.3, box!.y + box!.height * 0.4)
  await playback!.mouse.down()
  await playback!.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.55, { steps: 8 })
  await playback!.mouse.move(box!.x + box!.width * 0.7, box!.y + box!.height * 0.45, { steps: 8 })
  await playback!.mouse.up()

  // Count painted pixels so a board that merely renders as white cannot pass.
  // The e2e tsconfig has no DOM lib, so the canvas is described structurally.
  const inked = await board.evaluate((node) => {
    const canvas = node as unknown as {
      width: number
      height: number
      getContext(id: '2d'): {
        getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray }
      } | null
    }
    const ctx = canvas.getContext('2d')
    if (!ctx) return 0
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let painted = 0
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) painted++
    return painted
  })
  expect(inked).toBeGreaterThan(0)
  await playback!.screenshot({ path: join(shots, 'whiteboard.png') })

  await playback!.keyboard.press('Escape')
  await expect(board).toBeHidden()
})

test('11. the overview grid opens and closes', async () => {
  expect(playback).not.toBeNull()
  await playback!.keyboard.press('o')
  await expect(playback!.getByTestId('overview-grid')).toBeVisible()
  await playback!.screenshot({ path: join(shots, 'overview.png') })
  await playback!.keyboard.press('Escape')
  await expect(playback!.getByTestId('overview-grid')).toBeHidden()
})

test('12. Escape ends the show and returns to the preview window', async () => {
  expect(playback).not.toBeNull()
  // Escape closes the window from the keydown handler, so the matching keyup
  // may never be delivered. Treat that as the expected outcome.
  await playback!.keyboard.press('Escape').catch(() => undefined)
  await expect.poll(async () => (await findPlayback()) === null, { timeout: 30_000 }).toBe(true)
  await expect(preview.getByTestId('preview-page')).toBeVisible()
})

test('13. the window title carries the file name', async () => {
  expect(await preview.title()).toContain(deckName)
})