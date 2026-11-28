import { describe, expect, it } from 'vitest'
import { columnName, coveredBy } from '../../src/renderer/src/components/SheetView'
import type { MergedRegion } from '../../src/renderer/src/lib/sheet/types'

/**
 * The grid geometry the sheet view draws with.
 *
 * These are the rules that decide which cell is drawn and how wide it is, and they are
 * the ones that go wrong quietly: a merge handled with relative coordinates looks
 * perfect on a sheet starting at A1 and is one column out on any other, which is why
 * the fixture's merge is checked here as an absolute reference rather than a shape.
 */
describe('column names', () => {
  it('names the first columns the way a spreadsheet does', () => {
    expect(columnName(0)).toBe('A')
    expect(columnName(25)).toBe('Z')
    // The step from Z to AA is the one a naive base-26 gets wrong.
    expect(columnName(26)).toBe('AA')
    expect(columnName(27)).toBe('AB')
    expect(columnName(51)).toBe('AZ')
    expect(columnName(52)).toBe('BA')
  })
})

describe('merge coverage', () => {
  const merges: MergedRegion[] = [
    { firstRow: 0, firstCol: 0, lastRow: 0, lastCol: 2 },
    { firstRow: 2, firstCol: 1, lastRow: 4, lastCol: 1 }
  ]

  it('finds the merge a cell belongs to', () => {
    expect(coveredBy(merges, 0, 1)).toEqual(merges[0])
    expect(coveredBy(merges, 3, 1)).toEqual(merges[1])
  })

  it('reports no merge for a cell outside every region', () => {
    expect(coveredBy(merges, 1, 0)).toBeNull()
    expect(coveredBy(merges, 0, 3)).toBeNull()
  })

  it('treats both ends of a region as inclusive', () => {
    // The last row and last column are inside the merge, not past it. An exclusive
    // end would leave the final cell of every merge drawn twice.
    expect(coveredBy(merges, 4, 1)).toEqual(merges[1])
    expect(coveredBy(merges, 5, 1)).toBeNull()
    expect(coveredBy(merges, 0, 2)).toEqual(merges[0])
  })
})
