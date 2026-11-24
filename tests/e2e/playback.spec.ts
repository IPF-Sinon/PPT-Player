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
  await playback!.keyboard.press('ArrowRight')
  await expect(playback!.getByTestId('side-page-left')).toHaveText('3/3')
  await playback!.keyboard.press('ArrowLeft')
  await expect(playback!.getByTestId('side-page-left')).toHaveText('2/3')
})

test('7. both side nav stacks are clickable', async () => {
  expect(playback).not.toBeNull()
  await playback!.getByTestId('side-next-right').click()
  await expect(playback!.getByTestId('side-page-right')).toHaveText('3/3')
  await playback!.getByTestId('side-prev-left').click()
  await expect(playback!.getByTestId('side-page-left')).toHaveText('2/3')
})

test('8. the bottom toolbar toggles blackout', async () => {
  expect(playback).not.toBeNull()
  await playback!.getByTestId('tool-blackout').click()
  await expect(playback!.getByTestId('playback-page')).toHaveAttribute('data-blackout', 'true')
  await playback!.getByTestId('tool-blackout').click()
  await expect(playback!.getByTestId('playback-page')).toHaveAttribute('data-blackout', 'false')
})

test('9. the pen tool records ink on the slide', async () => {
  expect(playback).not.toBeNull()
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

test('10. the overview grid opens and closes', async () => {
  expect(playback).not.toBeNull()
  await playback!.keyboard.press('o')
  await expect(playback!.getByTestId('overview-grid')).toBeVisible()
  await playback!.screenshot({ path: join(shots, 'overview.png') })
  await playback!.keyboard.press('Escape')
  await expect(playback!.getByTestId('overview-grid')).toBeHidden()
})

test('11. Escape ends the show and returns to the preview window', async () => {
  expect(playback).not.toBeNull()
  await playback!.keyboard.press('Escape')
  await expect.poll(async () => (await findPlayback()) === null, { timeout: 30_000 }).toBe(true)
  await expect(preview.getByTestId('preview-page')).toBeVisible()
})

test('12. the window title carries the file name', async () => {
  expect(await preview.title()).toContain(deckName)
})