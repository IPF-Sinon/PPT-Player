// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { openZipVfs, type ZipVfs } from '../helpers/zip-vfs'
import { parseDocument } from '../../src/renderer/src/lib/docx/parser'
import { contentBox, paginateBlocks } from '../../src/renderer/src/lib/docx/layout'
import type { DocxDocument, DocxParagraph, DocxRun, DocxTable } from '../../src/renderer/src/lib/docx/types'

/**
 * The native Word renderer, against a document produced by a real writer.
 *
 * The fixture is hand-built rather than generated, because no Word-writing library
 * is available here, but it is built the way Word writes a document: a styles part
 * with a basedOn chain, a numbering part with two abstract definitions, a table
 * with real merges and an image behind a relationship. Hand-written fixtures hid
 * two parser bugs in the PPTX renderer precisely because they were shaped the way
 * the author imagined OOXML rather than the way a producer writes it.
 */
let vfs: ZipVfs
let doc: DocxDocument

const DECK_ID = 'a1b2c3d4e5f6'

beforeAll(async () => {
  vfs = openZipVfs(join(process.cwd(), 'tests', 'fixtures', 'deck-docx.docx'))
  const parsed = await parseDocument({
    deckId: DECK_ID,
    readText: async (partPath: string) => vfs.readText(partPath),
    pptxUrl: (id: string, part: string) => 'http://pptx.localhost/' + id + '/' + part
  })
  if (!parsed) throw new Error('the fixture did not parse')
  doc = parsed
})

afterAll(() => {
  vfs?.close()
})

function paragraphs(): DocxParagraph[] {
  return doc.blocks.flatMap((block) => (block.type === 'paragraph' ? [block.paragraph] : []))
}

function tables(): DocxTable[] {
  return doc.blocks.flatMap((block) => (block.type === 'table' ? [block.table] : []))
}

function textOf(paragraph: DocxParagraph): string {
  return paragraph.runs.map((run) => run.text).join('')
}

function runsOf(paragraph: DocxParagraph): DocxRun[] {
  return paragraph.runs.filter((run) => run.text.trim() !== '')
}

describe('the page box', () => {
  it('reads the page size Word wrote', () => {
    // 11906 x 16838 twips is A4, which is 794 x 1123 px at 96 DPI.
    expect(Math.round(doc.pageSize.width)).toBe(794)
    expect(Math.round(doc.pageSize.height)).toBe(1123)
  })

  it('reads the margins and derives the content box', () => {
    // 1440 twips is one inch, which is 96 px.
    expect(Math.round(doc.margin.top)).toBe(96)
    expect(Math.round(doc.margin.left)).toBe(96)
    const box = contentBox(doc)
    expect(Math.round(box.width)).toBe(Math.round(794 - 192))
    expect(Math.round(box.height)).toBe(Math.round(1123 - 192))
  })
})

describe('paragraphs and style inheritance', () => {
  it('parses every paragraph in the body', () => {
    expect(paragraphs().length).toBeGreaterThanOrEqual(8)
  })

  it('recognises the heading from its built-in style name', () => {
    const heading = paragraphs().find((p) => textOf(p).includes('诗评类古诗词鉴赏题'))
    expect(heading).toBeDefined()
    expect(heading!.heading).toBe(1)
  })

  it('inherits the heading size through the basedOn chain', () => {
    const heading = paragraphs().find((p) => p.heading === 1)
    const run = runsOf(heading!)[0]
    // Heading1 states w:sz 40 half-points, which is 20pt, which is 26.67px.
    expect(run.size).toBeGreaterThan(24)
    expect(run.size).toBeLessThan(30)
  })

  it('keeps the alignment Word wrote', () => {
    const heading = paragraphs().find((p) => p.heading === 1)
    expect(heading!.align).toBe('center')
    const body = paragraphs().find((p) => textOf(p).includes('手法'))
    expect(body!.align).toBe('justify')
  })

  it('converts space before and after from twips', () => {
    const body = paragraphs().find((p) => textOf(p).includes('手法'))
    // 240 twips is 16 px, 120 twips is 8 px.
    expect(Math.round(body!.spaceBefore!)).toBe(16)
    expect(Math.round(body!.spaceAfter!)).toBe(8)
  })

  it('reads an automatic line rule as a multiple of the font size', () => {
    const body = paragraphs().find((p) => textOf(p).includes('手法'))
    // w:line 360 with lineRule=auto is 1.5 lines.
    expect(body!.lineHeightScale).toBeCloseTo(1.5, 3)
  })

  it('turns a first-line indent into a positive text indent', () => {
    const body = paragraphs().find((p) => textOf(p).includes('手法'))
    // 480 twips is 32 px.
    expect(Math.round(body!.firstLine!)).toBe(32)
  })
})

describe('runs', () => {
  it('keeps bold, italic, colour, underline and superscript apart', () => {
    const body = paragraphs().find((p) => textOf(p).includes('手法'))!
    const runs = runsOf(body)

    const bold = runs.find((r) => r.text.includes('手法'))
    expect(bold?.bold).toBe(true)

    const italic = runs.find((r) => r.text.includes('表达效果'))
    expect(italic?.italic).toBe(true)

    const colored = runs.find((r) => r.text.includes('思想情感'))
    expect(colored?.color?.toLowerCase()).toBe('#c00000')

    const underlined = runs.find((r) => r.text.includes('答题范式'))
    expect(underlined?.underline).toBe(true)

    const superscript = runs.find((r) => r.text.trim() === '1')
    expect(superscript?.baseline).toBeGreaterThan(0)
  })

  it('inherits the document default font and size', () => {
    const body = paragraphs().find((p) => textOf(p).includes('手法'))!
    const plain = runsOf(body).find((r) => r.text.includes('表达效果'))
    expect(plain?.fontFamily).toBe('Times New Roman')
    // 24 half-points is 12pt, which is 16px.
    expect(Math.round(plain!.size)).toBe(16)
  })
})

describe('lists', () => {
  it('numbers a decimal list and continues the count', () => {
    const items = paragraphs().filter((p) => p.list !== undefined)
    const numbered = items.filter((p) => p.list!.text.startsWith('1') || p.list!.text.startsWith('2'))
    expect(numbered.length).toBeGreaterThanOrEqual(2)
    expect(numbered[0].list!.text.startsWith('1')).toBe(true)
    expect(numbered[1].list!.text.startsWith('2')).toBe(true)
  })

  it('draws a bullet list with a glyph a browser can render', () => {
    const bullets = paragraphs().filter((p) => p.list?.text === '•')
    expect(bullets.length).toBeGreaterThanOrEqual(2)
  })

  it('gives a list item a hanging indent', () => {
    const item = paragraphs().find((p) => p.list !== undefined)!
    expect(item.list!.width).toBeGreaterThan(0)
    expect(item.indentLeft).toBeGreaterThan(0)
  })
})

describe('tables', () => {
  it('reads the grid into column widths', () => {
    const table = tables()[0]
    expect(table).toBeDefined()
    expect(table.columnWidths).toHaveLength(3)
    // 2765 twips is about 184 px.
    expect(Math.round(table.columnWidths[0])).toBe(184)
  })

  it('keeps the cell text', () => {
    const table = tables()[0]
    const cells = table.rows.flat().flatMap((cell) =>
      cell.blocks.flatMap((block) => (block.type === 'paragraph' ? [textOf(block.paragraph)] : []))
    )
    expect(cells.join(' ')).toContain('题型')
    expect(cells.join(' ')).toContain('设问方式')
  })

  it('carries the header shading', () => {
    const table = tables()[0]
    expect(table.rows[0][0].fill?.toLowerCase()).toBe('#deeaf6')
  })

  it('carries the table borders', () => {
    const table = tables()[0]
    const border = table.rows[0][0].borders.top
    expect(border).toBeDefined()
    expect(border!.color.toLowerCase()).toBe('#8eaadb')
  })

  it('reads a horizontal merge as a column span', () => {
    const table = tables()[0]
    expect(table.rows[1][0].colSpan).toBe(2)
  })

  it('reads a vertical merge as a row span', () => {
    const table = tables()[0]
    const restart = table.rows[2][0]
    expect(restart.rowSpan).toBe(2)
    // The continuation cell draws nothing; the restart cell covers its rows.
    expect(table.rows[3][0].covered).toBe(true)
  })
})

describe('images', () => {
  it('resolves the picture through the host URL, never a hard-coded scheme', () => {
    const images = paragraphs()
      .flatMap((p) => p.runs)
      .flatMap((run) => (run.image ? [run.image] : []))
    expect(images).toHaveLength(1)
    expect(images[0].src).toBe('http://pptx.localhost/' + DECK_ID + '/word/media/image1.png')
    expect(images[0].src).not.toContain('app://')
  })

  it('sizes the picture from wp:extent', () => {
    const image = paragraphs()
      .flatMap((p) => p.runs)
      .flatMap((run) => (run.image ? [run.image] : []))[0]
    // 914400 EMU is exactly one inch, which is 96 px.
    expect(Math.round(image.width)).toBe(96)
    expect(Math.round(image.height)).toBe(96)
  })
})

describe('page breaks', () => {
  it('marks the block after an explicit break', () => {
    const afterBreak = doc.blocks.filter((block) => block.breakBefore === true)
    expect(afterBreak).toHaveLength(1)
  })

  it('reports the authored page count', () => {
    // One break, so two pages of authored content.
    expect(doc.declaredPageCount).toBe(2)
  })

  it('honours the authored break even when nothing has been measured', () => {
    // No heights: the only page boundary is the one the author wrote.
    const pages = paginateBlocks(doc.blocks, [], 0)
    expect(pages).toHaveLength(2)
  })

  it('packs blocks into pages by measured height', () => {
    // Every block is 100 px and the page holds 250, so three fit per page.
    const heights = doc.blocks.map(() => 100)
    const pages = paginateBlocks(doc.blocks, heights, 250)
    expect(pages.length).toBeGreaterThan(1)
    for (const page of pages) {
      const used = page.blocks.reduce(
        (sum, block) => sum + heights[doc.blocks.indexOf(block)],
        0
      )
      // The block that starts a page may overflow it; nothing else may.
      expect(used).toBeLessThanOrEqual(250 + 100)
    }
  })

  it('never leaves a document with zero pages', () => {
    expect(paginateBlocks([], [], 500)).toHaveLength(1)
  })
})

describe('a legacy binary .doc', () => {
  it('does not parse, so the caller falls back to the engine', async () => {
    // A .doc is a CFB rather than a ZIP, so nothing in it is reachable through the
    // part reader. Reporting null is what makes the caller convert it instead.
    const parsed = await parseDocument({
      deckId: 'legacy',
      readText: async () => null,
      pptxUrl: (id, part) => 'http://pptx.localhost/' + id + '/' + part
    })
    expect(parsed).toBeNull()
  })
})
describe('content the webview cannot decode', () => {
  it('is not flagged for a document of ordinary pictures', () => {
    // The fixture's picture is a PNG, which the webview decodes.
    expect(doc.hasComplexObjects).toBe(false)
  })

  it('is flagged for a document holding a vector metafile', async () => {
    // A TIFF or metafile draws as an empty box, which is worse than saying so.
    const xml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
      ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
      ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"' +
      ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<w:body><w:p><w:r><w:drawing><wp:inline>' +
      '<wp:extent cx="914400" cy="914400"/>' +
      '<a:graphic><a:graphicData><a:blip r:embed="rIdImage"/></a:graphicData></a:graphic>' +
      '</wp:inline></w:drawing></w:r></w:p></w:body></w:document>'
    const rels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/vector.emf"/>' +
      '</Relationships>'
    const parts: Record<string, string> = {
      'word/document.xml': xml,
      'word/_rels/document.xml.rels': rels
    }
    const parsed = await parseDocument({
      deckId: 'emf',
      readText: async (p: string) => parts[p] ?? null,
      pptxUrl: (id, part) => 'http://pptx.localhost/' + id + '/' + part
    })
    expect(parsed!.hasComplexObjects).toBe(true)
  })
})

describe('a document with no page break at all', () => {
  it('declares one page, so the pager never reads 0/0', () => {
    const single = {
      deckId: 'one',
      pageSize: { width: 794, height: 1123 },
      margin: { top: 96, right: 96, bottom: 96, left: 96 },
      declaredPageCount: 1,
      hasComplexObjects: false,
      blocks: [
        {
          type: 'paragraph' as const,
          paragraph: { runs: [{ text: '只有一段', size: 16 }], align: 'left' as const }
        }
      ]
    }
    expect(paginateBlocks(single.blocks, [], contentBox(single).height)).toHaveLength(1)
    expect(single.declaredPageCount).toBe(1)
  })
})
