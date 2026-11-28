/** Shared types used by main, preload and renderer. */

export type DeckKind =
  | 'ooxml-presentation'
  | 'odp'
  | 'legacy-ppt'
  | 'encrypted-ooxml'
  | 'ooxml-document'
  | 'legacy-doc'
  | 'ooxml-sheet'
  | 'legacy-sheet'
  | 'pdf'
  | 'unsupported'

export type ContainerKind = 'zip' | 'cfb' | 'pdf' | 'unknown'

export type EngineId = 'com' | 'libreoffice' | 'none'

export interface FormatInfo {
  /** Detected kind, based on file content only. */
  kind: DeckKind
  container: ContainerKind
  /** Lower-case extension without the dot, as found on disk. */
  declaredExt: string
  /** True when the content disagrees with the declared extension. */
  extMismatch: boolean
  /** True when the payload is password protected. */
  encrypted: boolean
  /** Short human readable format label, e.g. "PPTX" or "PPT". */
  label: string
  /** Reason the file was rejected, present only when kind is unsupported. */
  reason?: string
}

export interface DeckInfo {
  deckId: string
  sourcePath: string
  sourceBytes: number
  sourceMtimeMs: number
  format: FormatInfo
  pageCount: number
  /** Page sizes in PDF points, in document order. */
  pageSizes: Array<{ width: number; height: number }>
  engine: EngineId
  /** Engine binary actually used, for the info drawer. */
  enginePath: string
  convertMs: number
  cached: boolean
  /** True when the deck contains at least one slide whose aspect ratio differs from the first page. */
  mixedAspect: boolean
  warnings: string[]
}

export type ConvertStage = 'probe' | 'convert' | 'parse' | 'done' | 'failed'

export interface ConvertProgress {
  deckId: string
  stage: ConvertStage
  /** 0..1, best effort. */
  ratio: number
  message: string
}

export type EngineStatus = {
  available: boolean
  id: EngineId
  path: string
  version: string
  /** Where the engine came from: bundled, registry, path, custom, com. */
  origin: 'bundled' | 'installed' | 'path' | 'custom' | 'com' | 'none'
  detail: string
}

/** Progress of an on-demand engine download. */
export interface EngineDownloadProgress {
  stage: 'downloading' | 'verifying' | 'extracting' | 'done' | 'error'
  receivedBytes: number
  totalBytes: number
  /** 0..1, or -1 when the server did not report a length. */
  ratio: number
  message: string
}

export interface AppSettings {
  /** Explicit soffice path override, empty means auto. */
  loPathOverride: string
  /** Slide cache budget in megabytes. */
  cacheBudgetMb: number
  /** Recent files, newest first. */
  recentFiles: string[]
  /** Play slide transitions during fullscreen playback. */
  enableTransitions: boolean
  /** Where the previous/next buttons live during a show. */
  navButtonPosition: 'bottom' | 'side'
  /** Keep the toolbar visible while an ink tool is active. */
  keepToolbarInInkMode: boolean
  /** What to do with this session's annotations when the show ends. */
  inkOnExit: 'ask' | 'keep' | 'discard'
}

/** Everything the first screen needs, returned in one IPC round trip. */
export interface BootstrapInfo {
  settings: AppSettings
  /** File requested at launch, consumed once. */
  pendingOpenPath: string | null
  /** True when the window is already fullscreen. */
  fullscreen: boolean
}

export interface InkStroke {
  tool: 'pen' | 'highlighter' | 'eraser'
  color: string
  width: number
  /** Flat [x0, y0, x1, y1, ...] in slide-normalised coordinates. */
  points: number[]
}

export type InkPage = { pageIndex: number; strokes: InkStroke[] }

/** Lightweight format probe result, used before committing to a conversion. */
export type ProbeResult =
  | {
      ok: true
      format: FormatInfo
      bytes: number
      mtimeMs: number
    }
  | {
      ok: false
      error: AppErrorPayload
    }

export type OpenResult =
  | {
      ok: true
      info: DeckInfo
    }
  | {
      ok: false
      error: AppErrorPayload
    }

/** Result of opening a deck with the native PPTX engine. */
export type NativeOpenResult =
  | {
      ok: true
      deckId: string
      engineMode: 'native-pptx'
      slideCount: number
      /** Slide canvas size in CSS pixels. */
      slideSize: { width: number; height: number }
      /** Internal part path per slide, in presentation order. */
      slidePaths: string[]
      sourcePath: string
      sourceBytes: number
      format: FormatInfo
    }
  | {
      ok: false
      error: AppErrorPayload
    }

export interface AppErrorPayload {
  code: AppErrorCode
  message: string
  detail?: string
}

export type AppErrorCode =
  | 'ENOENT'
  | 'EACCES'
  | 'EEMPTY'
  | 'ETOOBIG'
  | 'EBADFORMAT'
  | 'EUNSUPPORTED'
  | 'EENCRYPTED'
  | 'ENOENGINE'
  | 'ECONVERT'
  | 'ETIMEOUT'
  | 'ECANCELLED'
  | 'EINTERNAL'