import type {
  AppSettings,
  BootstrapInfo,
  ConvertProgress,
  DeckInfo,
  EngineStatus,
  InkPage,
  NativeOpenResult,
  OpenResult,
  ProbeResult
} from './types'

/** Channel names shared by main and preload. */
export const IPC = {
  deckProbe: 'deck:probe',
  deckOpen: 'deck:open',
  deckOpenNative: 'deck:open-native',
  deckCancel: 'deck:cancel',
  deckInfo: 'deck:info',
  deckClose: 'deck:close',
  deckReportMetrics: 'deck:report-metrics',
  deckProgress: 'deck:progress',
  engineStatus: 'engine:status',
  engineRecheck: 'engine:recheck',
  engineSetLoPath: 'engine:set-lo-path',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  playEnter: 'play:enter',
  playExit: 'play:exit',
  playState: 'play:state',
  appBootstrap: 'app:bootstrap',
  appOpenLog: 'app:open-log',
  appRevealCache: 'app:reveal-cache',
  appPickFile: 'app:pick-file',
  appPickLoPath: 'app:pick-lo-path',
  appCacheClear: 'app:cache-clear',
  inkSave: 'ink:save',
  inkLoad: 'ink:load',
  appOpenExternal: 'app:open-external'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** Playback state pushed from main, so leaving fullscreen cannot desync the UI. */
export interface PlayState {
  active: boolean
}

/** The surface exposed to the renderer through contextBridge. */
export interface RendererApi {
  probe(path: string): Promise<ProbeResult>
  open(path: string): Promise<OpenResult>
  /** Index a PPTX for the native renderer. Returns null when it needs conversion. */
  openNative(path: string): Promise<NativeOpenResult | null>
  /** Abort the conversion currently in flight, if any. */
  cancelOpen(): Promise<void>
  deckInfo(deckId: string): Promise<DeckInfo | null>
  closeDeck(deckId: string): Promise<void>
  reportMetrics(
    deckId: string,
    pageCount: number,
    pageSizes: Array<{ width: number; height: number }>
  ): Promise<DeckInfo | null>
  onProgress(cb: (progress: ConvertProgress) => void): () => void
  engineStatus(): Promise<EngineStatus>
  recheckEngine(): Promise<EngineStatus>
  setLoPath(path: string): Promise<EngineStatus>
  getSettings(): Promise<AppSettings>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  /** Enter fullscreen playback in the current window. */
  enterPlayback(deckId: string, pageIndex: number): Promise<void>
  exitPlayback(): Promise<void>
  /** Fired when main changes fullscreen state, including OS-driven exits. */
  onPlayState(cb: (state: PlayState) => void): () => void
  bootstrap(): Promise<BootstrapInfo>
  openLog(): Promise<void>
  revealCache(): Promise<void>
  pickFile(): Promise<string | null>
  pickLoPath(): Promise<string | null>
  clearCache(): Promise<void>
  saveInk(deckId: string, pages: InkPage[]): Promise<void>
  loadInk(deckId: string): Promise<InkPage[]>
  /** Absolute path for a dropped File. Electron 32+ removed File.path. */
  getPathForFile(file: File): string
  /** Fired when a second instance or the shell asks to open a file. */
  onExternalOpen(cb: (path: string) => void): () => void
  /** Deck PDF URL for an already-registered deck. */
  deckUrl(deckId: string): string
  /** Internal PPTX part URL, for the native renderer. */
  pptxUrl(deckId: string, partPath: string): string
}