import type {
  AppSettings,
  ConvertProgress,
  DeckInfo,
  EngineStatus,
  InkPage,
  OpenResult,
  ProbeResult
} from './types'

/** Channel names shared by main and preload. */
export const IPC = {
  deckProbe: 'deck:probe',
  deckOpen: 'deck:open',
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
  appOpenLog: 'app:open-log',
  appRevealCache: 'app:reveal-cache',
  appPickFile: 'app:pick-file',
  appPickLoPath: 'app:pick-lo-path',
  appCacheClear: 'app:cache-clear',
  inkSave: 'ink:save',
  inkLoad: 'ink:load',
  appPlaybackContext: 'app:playback-context',
  appOpenExternal: 'app:open-external',
  appPendingOpen: 'app:pending-open'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/** The surface exposed to the renderer through contextBridge. */
export interface RendererApi {
  probe(path: string): Promise<ProbeResult>
  open(path: string): Promise<OpenResult>
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
  enterPlayback(deckId: string, pageIndex: number): Promise<void>
  exitPlayback(): Promise<void>
  openLog(): Promise<void>
  revealCache(): Promise<void>
  pickFile(): Promise<string | null>
  pickLoPath(): Promise<string | null>
  clearCache(): Promise<void>
  saveInk(deckId: string, pages: InkPage[]): Promise<void>
  loadInk(deckId: string): Promise<InkPage[]>
  /** Deck currently being played, resolved by the playback window at startup. */
  playbackContext(): Promise<{ deckId: string; pageIndex: number } | null>
  deckUrl(deckId: string): Promise<string | null>
  /** Fired when a second instance or the shell asks to open a file. */
  onExternalOpen(cb: (path: string) => void): () => void
  /** File requested at launch, consumed once. */
  takePendingOpen(): Promise<string | null>
}
