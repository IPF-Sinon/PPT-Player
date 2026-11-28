// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { openZipVfs } from '../helpers/zip-vfs'
import { buildPresentationIndex } from '../helpers/index-parse'
import { loadTheme, parseSlide } from '../../src/renderer/src/lib/pptx/parser'
import { evaluateStep, initiallyHidden } from '../../src/renderer/src/lib/pptx/animations'

const fixture = join(process.cwd(), 'tests', 'fixtures', 'deck-triggers.pptx')

/** Load the fixture slide through the same path the app uses. */
async function loadFixture() {
  const vfs = openZipVfs(fixture)
  const index = buildPresentationIndex(vfs)!
  const readText = async (p: string): Promise<string | null> => vfs.readText(p)
  const theme = await loadTheme({ readText, themePaths: index.themes })
  const slide = await parseSlide(
    { deckId: 'bbbbbbbbbbbb', theme, readText, slideSize: index.slideSize },
    index.slides[0].path,
    0
  )
  vfs.close()
  return slide!
}

describe('trigger fixture', () => {
  it('parses two independent trigger tracks', async () => {
    const slide = await loadFixture()
    const ids = Object.keys(slide.triggers)
    expect(ids).toHaveLength(2)
    // Each track must target a different answer.
    const targets = ids.map((id) => slide.triggers[id].steps[0].effects[0].targetId)
    expect(new Set(targets).size).toBe(2)
  })

  it('targets shapes that actually exist on the slide', async () => {
    const slide = await loadFixture()
    const shapeIds = new Set(slide.elements.map((el) => el.id))
    for (const track of Object.values(slide.triggers)) {
      expect(shapeIds.has(track.triggerId)).toBe(true)
      for (const step of track.steps) {
        for (const effect of step.effects) {
          expect(shapeIds.has(effect.targetId)).toBe(true)
        }
      }
    }
  })

  it('hides both answers before any button is pressed', async () => {
    const slide = await loadFixture()
    const hidden = initiallyHidden(slide.steps, slide.triggers)
    expect(hidden.size).toBe(2)
  })

  it('reveals exactly one answer per button', async () => {
    const slide = await loadFixture()
    const [first, second] = Object.keys(slide.triggers)
    const firstTarget = slide.triggers[first].steps[0].effects[0].targetId
    const secondTarget = slide.triggers[second].steps[0].effects[0].targetId

    const afterFirst = evaluateStep(slide.steps, 0, {
      triggers: slide.triggers,
      triggerProgress: { [first]: 1 }
    })
    expect(afterFirst.visible).toEqual(new Set([firstTarget]))

    const afterBoth = evaluateStep(slide.steps, 0, {
      triggers: slide.triggers,
      triggerProgress: { [first]: 1, [second]: 1 }
    })
    expect(afterBoth.visible).toEqual(new Set([firstTarget, secondTarget]))
  })

  it('has an empty main sequence, so advancing alone reveals nothing', async () => {
    const slide = await loadFixture()
    expect(slide.steps).toHaveLength(0)
    const state = evaluateStep(slide.steps, 1, { triggers: slide.triggers })
    expect(state.visible.size).toBe(0)
  })
})
