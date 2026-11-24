import type { DeckKind } from './types'

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
  'pdf'
] as const

export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number]

/** Human readable label per detected kind. */
export const KIND_LABEL: Record<DeckKind, string> = {
  'ooxml-presentation': 'PPTX',
  odp: 'ODP',
  'legacy-ppt': 'PPT',
  'encrypted-ooxml': 'PPTX (加密)',
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
