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
  'xls'
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
  return 'ppt'
}
