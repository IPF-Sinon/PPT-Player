// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { openZipVfs } from '../helpers/zip-vfs'
import { buildPresentationIndex } from '../helpers/index-parse'
import { loadTheme, parseSlide } from '../../src/renderer/src/lib/pptx/parser'
import { evaluateStep } from '../../src/renderer/src/lib/pptx/animations'

const fixture = join(process.cwd(), 'tests', 'fixtures', 'deck-exit.pptx')

async function loadSlide() {
  const vfs = openZipVfs(fixture)
  const index = buildPresentationIndex(vfs)!
  const readText = async (p: string): Promise<string | null> => vfs.readText(p)
  const theme = await loadTheme({ readText, themePaths: index.themes })
  const slide = await parseSlide(
    { deckId: 'cccccccccccc', theme, readText, slideSize: index.slideSize },
    index.slides[0].path,
    0
  )
  vfs.close()
  return slide!
}

/**
 * A cover shape that exits on click is the classic teaching pattern: the block sits
 * over the answer and must disappear for good once the presenter advances.
 */
describe('exit animation', () => {
  it('parses one exit step targeting the cover', async () => {
    const slide = await loadSlide()
    expect(slide.steps).toHaveLength(1)
    const effect = slide.steps[0].effects[0]
    expect(effect.kind).toBe('exit')
    expect(slide.elements.some((el) => el.id === effect.targetId)).toBe(true)
  })

  it('shows the cover before the click', async () => {
    const slide = await loadSlide()
    const target = slide.steps[0].effects[0].targetId
    const state = evaluateStep(slide.steps, 0)
    // A shape that only exits must be visible at the start, or there is nothing to cover.
    expect(state.visible.has(target)).toBe(true)
  })

  it('hides the cover at the exit step', async () => {
    const slide = await loadSlide()
    const target = slide.steps[0].effects[0].targetId
    const state = evaluateStep(slide.steps, 1)
    expect(state.visible.has(target)).toBe(false)
    expect(state.leaving.has(target)).toBe(true)
  })

  it('keeps the cover hidden on later steps', async () => {
    const slide = await loadSlide()
    const target = slide.steps[0].effects[0].targetId
    // The bug this guards: the exit animation replayed as an entrance and the block
    // popped back over the answer.
    expect(evaluateStep(slide.steps, 1).visible.has(target)).toBe(false)
    expect(evaluateStep(slide.steps, 5).visible.has(target)).toBe(false)
  })

  it('restores the cover when stepping back', async () => {
    const slide = await loadSlide()
    const target = slide.steps[0].effects[0].targetId
    expect(evaluateStep(slide.steps, 0).visible.has(target)).toBe(true)
  })
})
