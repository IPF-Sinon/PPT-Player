import { describe, expect, it } from 'vitest'
import { categoryOf, formatLabel, SUPPORTED_EXTENSIONS } from '../../src/shared/formats'

/**
 * The label the badge shows for each format.
 *
 * This is the one piece of text that tells a reader what they opened, and it used to be
 * derived from the engine instead of the file: everything opened natively was labelled
 * PPTX, so a .docx and a .csv both told the reader they had opened a presentation.
 */
describe('format labels', () => {
  it('names a csv as a csv rather than as a deck', () => {
    // The exact regression: native csv used to render the badge as PPTX.
    expect(formatLabel('/x/deck-sheet-gbk.csv', true, 'native-pptx')).toBe('CSV')
    expect(formatLabel('/x/table.tsv', true, 'native-pptx')).toBe('TSV')
  })

  it('names a native document as a document', () => {
    expect(formatLabel('/x/report.docx', true, 'native-pptx')).toBe('DOCX')
  })

  it('names each spreadsheet format by its own extension', () => {
    expect(formatLabel('/x/a.xlsx', true, 'native-pptx')).toBe('XLSX')
    expect(formatLabel('/x/a.xls', true, 'native-pptx')).toBe('XLS')
  })

  it('names a presentation as a presentation', () => {
    expect(formatLabel('/x/a.pptx', true, 'native-pptx')).toBe('PPTX')
    expect(formatLabel('/x/a.ppt', false, 'libreoffice')).toBe('PPT')
    expect(formatLabel('/x/a.odp', false, 'libreoffice')).toBe('ODP')
  })

  it('names a pdf as a pdf whichever engine drew it', () => {
    expect(formatLabel('/x/a.pdf', false, 'pdf')).toBe('PDF')
  })

  it('falls back rather than showing nothing for an unknown extension', () => {
    // A file renamed to something this build does not know still has to show a badge.
    expect(formatLabel('/x/mystery.bin', true, 'native-pptx')).toBe('PPTX')
    expect(formatLabel('/x/mystery.bin', false, 'libreoffice')).toBe('已转换')
  })
})

describe('csv is a first class format', () => {
  it('is an accepted extension', () => {
    expect(SUPPORTED_EXTENSIONS).toContain('csv')
  })

  it('reads as a sheet, so it gets the sheet binding', () => {
    // The binding decides the single-column view and the floating toolbar, which is
    // how a table is read; classifying a csv as a presentation would give it neither.
    expect(categoryOf('/x/a.csv')).toBe('xls')
  })

  it('keeps the other categories unchanged', () => {
    expect(categoryOf('/x/a.pptx')).toBe('ppt')
    expect(categoryOf('/x/a.docx')).toBe('docx')
    expect(categoryOf('/x/a.pdf')).toBe('pdf')
    expect(categoryOf('/x/a.xlsx')).toBe('xls')
  })
})
