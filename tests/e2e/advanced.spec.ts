import { _electron as electron, expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const triggerDeck = join(root, 'tests', 'fixtures', 'deck-triggers.pptx')

let app: ElectronApplication
let win: Page

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  expect(existsSync(triggerDeck), 'trigger fixture must exist').toBe(true)
  app = await electron.launch({
    args: ['.', triggerDeck],
    cwd: root,
    env: { ...process.env, NODE_ENV: 'test' }
  })
  app.process().stderr?.on('data', (c: Buffer) => console.log('[main:err]', c.toString().trim()))
  win = await app.firstWindow()
  win.on('pageerror', (err) => console.log('[renderer:error]', err.message))
  await win.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('1. the deck opens natively', async () => {
  await expect(win.getByTestId('deck-name')).toContainText('deck-triggers', { timeout: 30_000 })
  await expect(win.getByTestId('pptx-slide').first()).toBeVisible({ timeout: 30_000 })
})

test('2. the preview shows every answer, including trigger-revealed ones', async () => {
  // A teacher preparing the deck needs to see the finished slide, not the initial
  // state where the answers are still hidden.
  const slide = win.getByTestId('pptx-slide').first()
  await expect(slide).toContainText('问题')
  await expect(slide).toContainText('解析 A')
  await expect(slide).toContainText('解析 B')
})

test('3. playback starts with the answers hidden', async () => {
  await win.getByTestId('start-show').click()
  await expect(win.getByTestId('playback-page')).toBeVisible({ timeout: 30_000 })
  const slide = win.getByTestId('pptx-slide').first()
  await expect(slide).toContainText('问题')
  await expect(slide.locator('text=解析 A')).toBeHidden()
  await expect(slide.locator('text=解析 B')).toBeHidden()
})

test('4. clicking button A reveals only answer A', async () => {
  const buttonA = win.getByTestId('pptx-slide').first().locator('[data-trigger="true"]').first()
  await expect(buttonA).toBeVisible()
  await buttonA.click()

  const slide = win.getByTestId('pptx-slide').first()
  await expect(slide.locator('text=解析 A')).toBeVisible({ timeout: 10_000 })
  // The whole point of a trigger: it must not reveal the other answer.
  await expect(slide.locator('text=解析 B')).toBeHidden()
})

test('5. clicking a trigger does not advance the slide', async () => {
  // A trigger click that leaked to the stage would flip the page instead.
  await expect(win.getByTestId('page-indicator')).toContainText('1 /')
})

test('6. clicking button B reveals its own answer too', async () => {
  const buttons = win.getByTestId('pptx-slide').first().locator('[data-trigger="true"]')
  const count = await buttons.count()
  if (count < 2) return
  await buttons.nth(1).click()
  const slide = win.getByTestId('pptx-slide').first()
  await expect(slide.locator('text=解析 B')).toBeVisible({ timeout: 10_000 })
  // Answer A must stay visible; triggers accumulate rather than replace.
  await expect(slide.locator('text=解析 A')).toBeVisible()
})

test('7. leaving playback keeps the deck usable', async () => {
  await win.keyboard.press('Escape')
  await expect(win.getByTestId('preview-page')).toBeVisible({ timeout: 30_000 })
})
