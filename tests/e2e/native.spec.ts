import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const animatedDeck = join(root, 'tests', 'fixtures', 'deck-animated.pptx')
const plainDeck = join(root, 'tests', 'fixtures', 'deck-16x9.pptx')

let app: ElectronApplication
let win: Page

async function isFullScreen(): Promise<boolean> {
  return await app.evaluate(({ BrowserWindow }) => {
    const all = BrowserWindow.getAllWindows()
    return all.length > 0 && all[0].isFullScreen()
  })
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  expect(existsSync(animatedDeck), 'animated fixture must exist').toBe(true)
  expect(existsSync(plainDeck), 'plain fixture must exist').toBe(true)

  app = await electron.launch({
    args: ['.', animatedDeck],
    cwd: root,
    env: { ...process.env, NODE_ENV: 'test' }
  })

  app.process().stderr?.on('data', (chunk: Buffer) => console.log('[main:err]', chunk.toString().trim()))
  win = await app.firstWindow()
  win.on('pageerror', (err) => console.log('[renderer:error]', err.message))
  await win.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('1. a PPTX opens natively, without converting', async () => {
  await expect(win.getByTestId('deck-name')).toContainText('deck-animated', { timeout: 30_000 })
  // The engine badge only appears for the native path; a converted deck shows 已转换.
  await expect(win.getByTestId('engine-badge')).toBeVisible({ timeout: 30_000 })
  await expect(win.getByTestId('pptx-slide').first()).toBeVisible({ timeout: 30_000 })
})

test('2. the preview shows the finished slide, answers included', async () => {
  // In preview every element is visible, which is what a teacher expects while
  // preparing. Hiding them here would look like the deck lost its content.
  const slide = win.getByTestId('pptx-slide').first()
  await expect(slide).toContainText('问题')
  await expect(slide).toContainText('答案一')
  await expect(slide).toContainText('答案三')
})

test('3. the start button is visible without hovering', async () => {
  await expect(win.getByTestId('start-show')).toBeVisible()
  await expect(win.getByTestId('start-here')).toBeVisible()
})

test('4. playback opens fullscreen in the same window', async () => {
  const before = app.windows().length
  await win.getByTestId('start-show').click()
  await expect.poll(isFullScreen, { timeout: 30_000 }).toBe(true)
  expect(app.windows().length).toBe(before)
})

test('5. the first step reveals only the question', async () => {
  await expect(win.getByTestId('playback-page')).toBeVisible({ timeout: 30_000 })
  const slide = win.getByTestId('pptx-slide').first()
  await expect(slide).toContainText('问题')
  // The answers start hidden; this is the whole point of click animation.
  await expect(slide.locator('text=答案一')).toBeHidden()
})

test('6. each click reveals one more answer', async () => {
  await win.keyboard.press('ArrowRight')
  await expect(win.getByTestId('step-indicator')).toContainText('1/3', { timeout: 10_000 })
  await expect(win.getByTestId('pptx-slide').first().locator('text=答案一')).toBeVisible()

  await win.keyboard.press('ArrowRight')
  await expect(win.getByTestId('step-indicator')).toContainText('2/3', { timeout: 10_000 })
  await expect(win.getByTestId('pptx-slide').first().locator('text=答案二')).toBeVisible()

  await win.keyboard.press('ArrowRight')
  await expect(win.getByTestId('step-indicator')).toContainText('3/3', { timeout: 10_000 })
  await expect(win.getByTestId('pptx-slide').first().locator('text=答案三')).toBeVisible()
})

test('7. stepping back hides the last answer again', async () => {
  await win.keyboard.press('ArrowLeft')
  await expect(win.getByTestId('step-indicator')).toContainText('2/3', { timeout: 10_000 })
  await expect(win.getByTestId('pptx-slide').first().locator('text=答案三')).toBeHidden()
  await win.keyboard.press('ArrowRight')
})

test('8. leaving playback returns to the preview in the same window', async () => {
  const before = app.windows().length
  await win.keyboard.press('Escape')
  await expect(win.getByTestId('preview-page')).toBeVisible({ timeout: 30_000 })
  await expect.poll(isFullScreen, { timeout: 30_000 }).toBe(false)
  expect(app.windows().length).toBe(before)
})

test('9. the tab bar shows the open deck and its engine', async () => {
  const tabs = win.getByTestId('tabbar').locator('.tab')
  await expect(tabs).toHaveCount(1, { timeout: 30_000 })
  await expect(tabs.first()).toContainText('deck-animated')
  // The 动画 badge marks the native path, so a regression to conversion shows here.
  await expect(tabs.first()).toContainText('动画')
})

test('10. switching to compatible mode reopens the deck as converted', async () => {
  await win.getByTestId('switch-engine').click()
  // The native badge must disappear once the deck is rendered from a PDF.
  await expect(win.getByTestId('engine-badge')).toBeHidden({ timeout: 60_000 })
  await expect(win.getByTestId('slide-canvas').first()).toBeVisible({ timeout: 60_000 })
})
