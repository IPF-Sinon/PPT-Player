/** Shared tab and engine types used across the renderer. */

import type { InkPage, InkStroke } from '@shared/types'
import type { PdfDocumentProxyLike } from '../lib/pdf'
import type { LoadedNativeDeck } from './pptx/deck'

/**
 * Which renderer backs a tab.
 *
 * - native-pptx: parsed and drawn in the renderer, no conversion, animations work
 * - pdf:         a PDF opened directly, streamed with no copy
 * - libreoffice: converted to PDF by the bundled engine
 */
export type EngineMode = 'native-pptx' | 'pdf' | 'libreoffice'

export type TabStatus = 'loading' | 'head-ready' | 'ready' | 'error'

export interface TabItem {
  tabId: string
  filePath: string
  /** File name shown on the tab. */
  title: string
  deckId: string
  engineMode: EngineMode
  status: TabStatus
  progressRatio: number
  progressMessage: string
  pageCount: number
  /** Page sizes in PDF points or slide EMU converted to px, per engine. */
  pageSizes: Array<{ width: number; height: number }>
  currentPage: number
  /** Animation step within the current page. 0 means the page as authored. */
  currentStep: number
  /** True when the native parser met charts, SmartArt, equations or OLE. */
  hasComplexObjects: boolean
  pdfDoc: PdfDocumentProxyLike | null
  pdfUrl: string | null
  nativeDeck: LoadedNativeDeck | null
  ink: InkPage[]
  boardStrokes: InkStroke[]
  error: { message: string; detail?: string } | null
  convertMs: number
  cached: boolean
  /** True when only the first pages are available and a full pass is running. */
  headOnly: boolean
}

export function emptyTab(overrides: Partial<TabItem> & { tabId: string; filePath: string }): TabItem {
  const name = overrides.filePath.split(/[\\/]/).pop() ?? overrides.filePath
  return {
    title: name,
    deckId: '',
    engineMode: 'libreoffice',
    status: 'loading',
    progressRatio: 0,
    progressMessage: '',
    pageCount: 0,
    pageSizes: [],
    currentPage: 0,
    currentStep: 0,
    hasComplexObjects: false,
    pdfDoc: null,
    pdfUrl: null,
    nativeDeck: null,
    ink: [],
    boardStrokes: [],
    error: null,
    convertMs: 0,
    cached: false,
    headOnly: false,
    ...overrides
  }
}
