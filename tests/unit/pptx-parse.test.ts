// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { openZipVfs, normaliseEntry, type ZipVfs } from '../../src/main/pptx/zip-vfs'
import { buildPresentationIndex, relsPartFor, resolvePartTarget } from '../../src/main/pptx/index-parse'
import { loadTheme, parseSlide } from '../../src/renderer/src/lib/pptx/parser'

const scratchRoot = join(process.cwd(), '.cache', 'test-scratch')

/**
 * These run against a deck produced by a real writer, not against hand-written XML.
 * That matters: hand-written fixtures hid two parser bugs, because they were shaped
 * the way I imagined OOXML rather than the way a producer writes it.
 */
let dir = ''
let fixture = ''
let vfs: ZipVfs

beforeAll(async () => {
  // The scratch root may not exist yet on a clean checkout.
  mkdirSync(scratchRoot, { recursive: true })
  dir = mkdtempSync(join(scratchRoot, 'pptx-native-'))
  fixture = join(dir, 'deck.pptx')

  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'

  const slide = pptx.addSlide()
  slide.background = { color: 'F3F6FA' }
  slide.addText('课堂练习', {
    x: 0.6,
    y: 0.5,
    w: 8.8,
    h: 1.2,
    fontSize: 36,
    bold: true,
    color: '1F2937',
    align: 'center'
  })
  slide.addText('第一问：什么是勾股定理？', {
    x: 0.8,
    y: 2,
    w: 8.4,
    h: 0.8,
    fontSize: 20,
    color: '334155'
  })
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.8,
    y: 3.2,
    w: 4,
    h: 1.2,
    fill: { color: '4472C4' },
    line: { color: '2F528F', width: 2 }
  })
  // pptxgenjs types want cell objects; a bare string is accepted at runtime.
  const cell = (text: string): { text: string } => ({ text })
  slide.addTable(
    [[cell('项目'), cell('数值')], [cell('a'), cell('3')], [cell('b'), cell('4')]],
    { x: 5.4, y: 3.2, w: 4.2, h: 1.6, fontSize: 12, border: { type: 'solid', color: 'BFBFBF', pt: 1 } }
  )
  const imageData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  slide.addImage({ data: 'image/png;base64,' + imageData, x: 0.8, y: 5.1, w: 0.6, h: 0.6 })

  const second = pptx.addSlide()
  second.addText('第二页', { x: 1, y: 1, w: 6, h: 1, fontSize: 28 })

  const buffer = await pptx.write({ outputType: 'nodebuffer' })
  writeFileSync(fixture, buffer as Buffer)
  vfs = openZipVfs(fixture)
})

afterAll(() => {
  vfs?.close()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('normaliseEntry', () => {
  it('lowercases and strips leading slashes', () => {
    expect(normaliseEntry('/PPT/Slides/Slide1.xml')).toBe('ppt/slides/slide1.xml')
  })

  it('resolves parent segments, which relationship targets use', () => {
    expect(normaliseEntry('ppt/slides/../media/image1.png')).toBe('ppt/media/image1.png')
  })

  it('collapses duplicate separators', () => {
    expect(normaliseEntry('ppt//slides///slide2.xml')).toBe('ppt/slides/slide2.xml')
  })
})

describe('zip-vfs on a real deck', () => {
  it('indexes the archive without extracting it', () => {
    expect(vfs.entryCount).toBeGreaterThan(8)
    expect(vfs.size).toBeGreaterThan(10_000)
  })

  it('reads the presentation part', () => {
    const xml = vfs.readText('ppt/presentation.xml')
    expect(xml).toContain('<p:presentation')
  })

  it('is case and prefix insensitive, the way OOXML paths are', () => {
    expect(vfs.has('/ppt/Presentation.XML')).toBe(true)
    expect(vfs.readText('ppt/presentation.xml')).toBe(vfs.readText('/ppt/presentation.xml'))
  })

  it('returns null for a missing entry instead of throwing', () => {
    expect(vfs.read('ppt/slides/nope.xml')).toBeNull()
    expect(vfs.readText('ppt/slides/nope.xml')).toBeNull()
  })

  it('refuses a traversal path', () => {
    expect(vfs.read('../../etc/passwd')).toBeNull()
  })

  it('survives being closed twice', () => {
    const temp = openZipVfs(fixture)
    temp.close()
    expect(() => temp.close()).not.toThrow()
    expect(temp.read('ppt/presentation.xml')).toBeNull()
  })
})

describe('buildPresentationIndex', () => {
  it('reads the slide size the deck declared', () => {
    const index = buildPresentationIndex(vfs)!
    // 16:9 at 960x540 CSS px, which is what a 12192000 EMU wide slide converts to.
    expect(Math.round(index.slideSize.width)).toBe(960)
    expect(Math.round(index.slideSize.height)).toBe(540)
  })

  it('lists slides in presentation order', () => {
    const index = buildPresentationIndex(vfs)!
    expect(index.slides).toHaveLength(2)
    expect(index.slides[0].path).toBe('ppt/slides/slide1.xml')
    expect(index.slides[1].path).toBe('ppt/slides/slide2.xml')
    expect(index.slides.map((s) => s.index)).toEqual([1, 2])
  })

  it('finds the master and theme parts', () => {
    const index = buildPresentationIndex(vfs)!
    expect(index.masters.length).toBeGreaterThan(0)
    expect(index.themes.length).toBeGreaterThan(0)
    expect(index.themes[0]).toMatch(/theme\d+\.xml$/)
  })

  it('reports no macros for a plain deck', () => {
    expect(buildPresentationIndex(vfs)!.hasMacros).toBe(false)
  })

  it('returns null when the archive is not a presentation', () => {
    const notADeck = openZipVfs(fixture)
    // A deck without presentation.xml must be rejected so the caller converts instead.
    expect(buildPresentationIndex({ ...notADeck, readText: () => null } as unknown as ZipVfs)).toBeNull()
    notADeck.close()
  })
})

describe('relationship helpers', () => {
  it('derives the rels part name', () => {
    expect(relsPartFor('ppt/slides/slide1.xml')).toBe('ppt/slides/_rels/slide1.xml.rels')
  })

  it('resolves a relative target against its part', () => {
    expect(resolvePartTarget('ppt/slides/slide1.xml', '../media/image1.png')).toBe('ppt/media/image1.png')
  })

  it('resolves an absolute target', () => {
    expect(resolvePartTarget('ppt/slides/slide1.xml', '/ppt/media/a.png')).toBe('ppt/media/a.png')
  })
})

describe('parseSlide on a real deck', () => {
  async function loadSlide(which = 0) {
    const index = buildPresentationIndex(vfs)!
    const readText = async (partPath: string): Promise<string | null> => vfs.readText(partPath)
    const theme = await loadTheme({ readText, themePaths: index.themes })
    const ctx = { deckId: 'a1b2c3d4e5f6', theme, readText, slideSize: index.slideSize }
    return parseSlide(ctx, index.slides[which].path, which)
  }

  it('parses the theme colours and fonts', async () => {
    const index = buildPresentationIndex(vfs)!
    const theme = await loadTheme({
      readText: async (p) => vfs.readText(p),
      themePaths: index.themes
    })
    expect(theme.colors.accent1).toMatch(/^#[0-9a-f]{6}$/)
    expect(theme.fonts.minorLatin.length).toBeGreaterThan(0)
  })

  it('parses the slide background', async () => {
    const slide = await loadSlide(0)
    expect(slide).not.toBeNull()
    expect(slide!.background?.kind).toBe('solid')
    expect(slide!.background?.color?.toLowerCase()).toBe('#f3f6fa')
  })

  it('produces the text boxes with their content', async () => {
    const slide = await loadSlide(0)
    const texts = slide!.elements
      .filter((el) => el.type === 'shape' && el.text)
      .flatMap((el) => (el.type === 'shape' && el.text ? el.text.paragraphs : []))
      .flatMap((p) => p.runs.map((r) => r.text))
      .join(' ')
    expect(texts).toContain('课堂练习')
    expect(texts).toContain('勾股定理')
  })

  it('keeps text sizes in pixels, not raw hundredths of a point', async () => {
    const slide = await loadSlide(0)
    const heading = slide!.elements.find(
      (el) => el.type === 'shape' && el.text?.paragraphs[0]?.runs[0]?.text === '课堂练习'
    )
    expect(heading).toBeDefined()
    if (heading?.type !== 'shape' || !heading.text) throw new Error('heading missing')
    const size = heading.text.paragraphs[0].runs[0].size
    // 36pt at 96dpi is 48px; anything near 3600 means the conversion was skipped.
    expect(size).toBeGreaterThan(20)
    expect(size).toBeLessThan(80)
  })

  it('parses the shape geometry and fill', async () => {
    const slide = await loadSlide(0)
    const rect = slide!.elements.find((el) => el.type === 'shape' && el.geometry.kind === 'rect' && el.fill.kind === 'solid')
    expect(rect).toBeDefined()
    if (rect?.type !== 'shape') throw new Error('rect missing')
    expect(rect.fill.color?.toLowerCase()).toBe('#4472c4')
    expect(rect.border?.width).toBeGreaterThan(0)
  })

  it('parses the table into rows and columns', async () => {
    const slide = await loadSlide(0)
    const table = slide!.elements.find((el) => el.type === 'table')
    expect(table).toBeDefined()
    if (table?.type !== 'table') throw new Error('table missing')
    expect(table.rows.length).toBe(3)
    expect(table.columnWidths.length).toBe(2)
    const cellText = table.rows.flat().flatMap((c) => c.text?.paragraphs ?? []).flatMap((p) => p.runs.map((r) => r.text))
    expect(cellText.join(' ')).toContain('项目')
  })

  it('resolves the picture to an app://pptx url', async () => {
    const slide = await loadSlide(0)
    const picture = slide!.elements.find((el) => el.type === 'picture')
    expect(picture).toBeDefined()
    if (picture?.type !== 'picture') throw new Error('picture missing')
    expect(picture.src).toMatch(/^app:\/\/pptx\/a1b2c3d4e5f6\/ppt\/media\//)
  })

  it('reports a plain deck as having no complex objects', async () => {
    const slide = await loadSlide(0)
    expect(slide!.hasComplexObjects).toBe(false)
  })

  it('gives every element a non-empty id so animations can target it', async () => {
    const slide = await loadSlide(0)
    for (const el of slide!.elements) {
      expect(el.id).not.toBe('')
    }
  })

  it('parses the second slide too', async () => {
    const slide = await loadSlide(1)
    expect(slide!.index).toBe(1)
    expect(slide!.elements.length).toBeGreaterThan(0)
  })
})
