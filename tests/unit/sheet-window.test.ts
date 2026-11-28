import { describe, expect, it, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { unzipSync, strFromU8 } from 'fflate'
import { loadSheet, cachedSheet, forgetSheet } from '../../src/renderer/src/lib/sheet/registry'
import type { SheetSource, SpreadsheetModel } from '../../src/renderer/src/lib/sheet/types'

/**
 * The sheet window cache, and the fixture it is proved against.
 *
 * The fixture is a real .xlsx produced by scripts/make-fixtures.mjs and read here with
 * fflate, so the test asserts against bytes a writer produced rather than against a
 * shape this test imagined. That is the same rule the docx work was held to, and it is
 * the reason its two parser bugs were caught before shipping.
 */
const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'deck-sheet.xlsx')

function fixturePart(name: string): string {
  const files = unzipSync(new Uint8Array(readFileSync(FIXTURE)))
  const part = files[name]
  if (!part) throw new Error('the fixture has no part ' + name)
  return strFromU8(part)
}

function model(overrides: Partial<SpreadsheetModel> = {}): SpreadsheetModel {
  return {
    deckId: 'deck-a',
    sheets: ['成绩', '备注'],
    active: '成绩',
    activeIndex: 0,
    sheet: {
      name: '成绩',
      rowCount: 6,
      colCount: 3,
      firstRow: 0,
      firstCol: 0,
      rows: [],
      merges: [],
      colWidths: []
    },
    encoding: 'binary',
    truncated: false,
    ...overrides
  }
}

/** A source that counts its calls, so the cache can be proved to be a cache. */
function countingSource(result: SpreadsheetModel): SheetSource & { calls: number } {
  const source = {
    calls: 0,
    async openSpreadsheet(): Promise<SpreadsheetModel> {
      source.calls += 1
      return result
    }
  }
  return source
}

beforeEach(() => {
  forgetSheet('deck-a')
  forgetSheet('deck-b')
})

describe('the fixture', () => {
  it('is a real zip holding a real workbook', () => {
    // The magic number, not the extension: a file renamed .xlsx that is not a zip
    // would make every test below meaningless.
    const bytes = readFileSync(FIXTURE)
    expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304')
  })

  it('declares two worksheets in workbook order', () => {
    const workbook = fixturePart('xl/workbook.xml')
    expect(workbook).toContain('name="成绩"')
    expect(workbook).toContain('name="备注"')
    // The sheet must be reachable through a relationship, not by guessing a path.
    expect(workbook).toContain('r:id="rId1"')
    const rels = fixturePart('xl/_rels/workbook.xml.rels')
    expect(rels).toContain('Target="worksheets/sheet1.xml"')
  })

  it('holds a merged title and a stated column width', () => {
    const sheet = fixturePart('xl/worksheets/sheet1.xml')
    expect(sheet).toContain('<mergeCell ref="A1:C1"/>')
    expect(sheet).toContain('<col min="1" max="1" width="14.5"')
  })

  it('stores its strings in sharedStrings, which is how a writer stores them', () => {
    // A fixture using inline strings would take a different path through calamine and
    // would not prove the shared-string path works at all.
    const sheet = fixturePart('xl/worksheets/sheet1.xml')
    expect(sheet).toContain('t="s"')
    const strings = fixturePart('xl/sharedStrings.xml')
    expect(strings).toContain('<si><t>期中成绩</t></si>')
  })
})

describe('the window cache', () => {
  it('opens the workbook once for repeated readers of the same window', async () => {
    const source = countingSource(model())
    const first = await loadSheet('deck-a', source, '/a.xlsx', {})
    const second = await loadSheet('deck-a', source, '/a.xlsx', {})
    // Three components read one window; the file must be opened once.
    expect(source.calls).toBe(1)
    expect(second).toBe(first)
  })

  it('shares one fetch between callers that ask at the same moment', async () => {
    const source = countingSource(model())
    const [a, b] = await Promise.all([
      loadSheet('deck-a', source, '/a.xlsx', {}),
      loadSheet('deck-a', source, '/a.xlsx', {})
    ])
    expect(source.calls).toBe(1)
    expect(a).toBe(b)
  })

  it('keys a different sheet separately', async () => {
    const source = countingSource(model())
    await loadSheet('deck-a', source, '/a.xlsx', { sheet: '成绩' })
    await loadSheet('deck-a', source, '/a.xlsx', { sheet: '备注' })
    // Two tabs are two reads, not one.
    expect(source.calls).toBe(2)
  })

  it('does not cache a failure, so a retry is possible', async () => {
    let attempts = 0
    const source: SheetSource = {
      async openSpreadsheet() {
        attempts += 1
        if (attempts === 1) throw new Error('locked')
        return model()
      }
    }
    await expect(loadSheet('deck-b', source, '/b.xlsx', {})).rejects.toThrow('locked')
    // The second attempt must actually reach the host; a cached rejection would leave
    // the sheet blank for the life of the tab.
    const recovered = await loadSheet('deck-b', source, '/b.xlsx', {})
    expect(attempts).toBe(2)
    expect(recovered.deckId).toBe('deck-a')
  })

  it('reports a settled window synchronously and an unsettled one as null', async () => {
    const source = countingSource(model())
    expect(cachedSheet('deck-a', {})).toBeNull()
    await loadSheet('deck-a', source, '/a.xlsx', {})
    expect(cachedSheet('deck-a', {})).not.toBeNull()
  })

  it('forgets one workbook without touching another', async () => {
    const source = countingSource(model())
    await loadSheet('deck-a', source, '/a.xlsx', {})
    await loadSheet('deck-b', source, '/b.xlsx', {})
    forgetSheet('deck-a')
    expect(cachedSheet('deck-a', {})).toBeNull()
    expect(cachedSheet('deck-b', {})).not.toBeNull()
  })
})
