import type { DeckKind, DocumentCategory } from './types'

/** Declared extensions the app is willing to open. */
export const SUPPORTED_EXTENSIONS = [
  'ppt',
  'pptx',
  'pptm',
  'pps',
  'ppsx',
  'ppsm',
  'potx',
  'odp',
  'pdf',
  'docx',
  'docm',
  'doc',
  'xlsx',
  'xlsm',
  'xls',
  // A CSV has no container and no signature, but it is a table and the lite build
  // opens it natively, so it belongs in the list of formats the app accepts.
  'csv'
] as const

export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number]

/** Human readable label per detected kind. */
export const KIND_LABEL: Record<DeckKind, string> = {
  'ooxml-presentation': 'PPTX',
  odp: 'ODP',
  'legacy-ppt': 'PPT',
  'ooxml-document': 'DOCX',
  'legacy-doc': 'DOC',
  'ooxml-sheet': 'XLSX',
  'legacy-sheet': 'XLS',
  'encrypted-ooxml': '已加密',
  pdf: 'PDF',
  unsupported: '不支持'
}

/** Upper bound for a single source file, 200 MiB. */
export const MAX_SOURCE_BYTES = 200 * 1024 * 1024

export const PDFJS_CMAPS_DIR = 'cmaps'
export const PDFJS_FONTS_DIR = 'standard_fonts'

export function extensionOf(filePath: string): string {
  const base = filePath.replace(/\\/g, '/').split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

export function isSupportedExtension(ext: string): ext is SupportedExtension {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)
}

/**
 * Which reading behaviour a file gets.
 *
 * The extension is enough: the tab has already been opened by the time a view runs,
 * so the format was accepted, and the four categories are the four ways a file is
 * meant to be read rather than four ways of decoding it.
 *
 * It lives here rather than in one page because both the preview stage and the
 * playback column need it, and two copies of this mapping would eventually classify
 * a .docm two different ways in two places.
 */
export function categoryOf(filePath: string): DocumentCategory {
  const ext = extensionOf(filePath)
  if (ext === 'pdf') return 'pdf'
  if (ext === 'doc' || ext === 'docx' || ext === 'docm' || ext === 'dot' || ext === 'dotx') return 'docx'
  if (ext === 'xls' || ext === 'xlsx' || ext === 'xlsm' || ext === 'xlt' || ext === 'xltx') return 'xls'
  // A CSV is read as a sheet, so it gets the sheet's binding: the single-column view
  // and the floating toolbar, which is what a table is read with.
  if (ext === 'csv' || ext === 'tsv') return 'xls'
  return 'ppt'
}

/**
 * The short badge label for a file, naming what it actually is.
 *
 * Derived from the extension, not from the engine. The badge used to be written as
 * "native means PPTX", which labelled a .docx and a .csv as a deck: both are native, and
 * neither is a presentation. Telling a reader their spreadsheet is a PPTX is a small lie
 * with a real cost, because it is the one piece of text that says what they opened.
 *
 * An extension this build does not know falls back to the engine's own wording, so the
 * badge is never blank.
 */
export function formatLabel(filePath: string, native: boolean, engineMode: string): string {
  const ext = extensionOf(filePath)
  if (ext === 'pdf') return 'PDF'
  if (ext === 'csv') return 'CSV'
  if (ext === 'tsv') return 'TSV'
  if (ext === 'docx' || ext === 'docm' || ext === 'dotx') return 'DOCX'
  if (ext === 'doc' || ext === 'dot') return 'DOC'
  if (ext === 'xlsx' || ext === 'xlsm' || ext === 'xltx') return 'XLSX'
  if (ext === 'xls' || ext === 'xlt') return 'XLS'
  if (ext === 'pptx' || ext === 'pptm' || ext === 'ppsx' || ext === 'ppsm' || ext === 'potx') {
    return 'PPTX'
  }
  if (ext === 'ppt' || ext === 'pps' || ext === 'pot') return 'PPT'
  if (ext === 'odp') return 'ODP'
  if (native) return 'PPTX'
  return engineMode === 'pdf' ? 'PDF' : '已转换'
}
