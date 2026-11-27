/**
 * The single seam between the UI and whatever shell hosts it.
 *
 * Every call the renderer makes to the host goes through here. Today the host is the
 * Electron main process; the point of this layer is that swapping in another shell
 * means implementing one interface rather than editing every component.
 *
 * Two things are deliberately not passthroughs:
 * - asset URLs are built here, because the URL shape belongs to the shell
 *   (Electron serves app://, another shell may serve http://host.localhost)
 * - subscriptions return an unsubscribe function, so components never touch the
 *   host's own event API
 */

import type {
  AppSettings,
  BootstrapInfo,
  ConvertProgress,
  EngineDownloadProgress,
  EngineStatus,
  InkPage,
  NativeOpenResult,
  OpenResult,
  ProbeResult
} from '@shared/types'

/** Everything the renderer needs from its host. */
export interface PlatformApi {
  // ---- files and decks
  probe(path: string): Promise<ProbeResult>
  open(path: string): Promise<OpenResult>
  openNative(path: string): Promise<NativeOpenResult | null>
  cancelOpen(): Promise<void>
  closeDeck(deckId: string): Promise<unknown>
  reportMetrics(
    deckId: string,
    pageCount: number,
    pageSizes: Array<{ width: number; height: number }>
  ): Promise<unknown>
  pickFile(): Promise<string | null>
  /** Resolve the real path of a dropped File. */
  getPathForFile(file: File): string

  // ---- asset URLs
  /** URL of a converted deck's PDF. */
  deckUrl(deckId: string): string
  /** URL of one part inside a natively opened PPTX. */
  pptxUrl(deckId: string, partPath: string): string

  // ---- playback
  enterPlayback(deckId: string, pageIndex: number): Promise<void>
  exitPlayback(): Promise<void>
  onPlayState(cb: (state: { active: boolean }) => void): () => void
  onProgress(cb: (progress: ConvertProgress) => void): () => void
  onExternalOpen(cb: (path: string) => void): () => void

  // ---- annotations
  loadInk(deckId: string): Promise<InkPage[]>
  saveInk(deckId: string, pages: InkPage[]): Promise<void>

  // ---- settings and engine
  getSettings(): Promise<AppSettings>
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>
  bootstrap(): Promise<BootstrapInfo>
  engineStatus(): Promise<EngineStatus>
  engineVariant(): Promise<{ variant: 'full' | 'lite'; engineBytes: number }>
  setLoPath(path: string): Promise<EngineStatus>
  pickLoPath(): Promise<string | null>
  engineDownload(): Promise<{ ok: boolean; message: string }>
  engineDownloadCancel(): Promise<void>
  onEngineDownload(cb: (progress: EngineDownloadProgress) => void): () => void
  recheckEngine(): Promise<EngineStatus>

  // ---- shell utilities
  openLog(): Promise<void>
  revealCache(): Promise<void>
  clearCache(): Promise<void>
}

/** The Electron-backed implementation, which is what ships today. */
const electronApi: PlatformApi = {
  probe: (path) => window.api.probe(path),
  open: (path) => window.api.open(path),
  openNative: (path) => window.api.openNative(path),
  cancelOpen: () => window.api.cancelOpen(),
  closeDeck: (deckId) => window.api.closeDeck(deckId),
  reportMetrics: (deckId, pageCount, pageSizes) =>
    window.api.reportMetrics(deckId, pageCount, pageSizes),
  pickFile: () => window.api.pickFile(),
  getPathForFile: (file) => window.api.getPathForFile(file),

  deckUrl: (deckId) => window.api.deckUrl(deckId),
  pptxUrl: (deckId, partPath) => window.api.pptxUrl(deckId, partPath),

  enterPlayback: (deckId, pageIndex) => window.api.enterPlayback(deckId, pageIndex),
  exitPlayback: () => window.api.exitPlayback(),
  onPlayState: (cb) => window.api.onPlayState(cb),
  onProgress: (cb) => window.api.onProgress(cb),
  onExternalOpen: (cb) => window.api.onExternalOpen(cb),

  loadInk: (deckId) => window.api.loadInk(deckId),
  saveInk: (deckId, pages) => window.api.saveInk(deckId, pages),

  getSettings: () => window.api.getSettings(),
  setSettings: (patch) => window.api.setSettings(patch),
  bootstrap: () => window.api.bootstrap(),
  engineStatus: () => window.api.engineStatus(),
  engineVariant: () => window.api.engineVariant(),
  setLoPath: (path) => window.api.setLoPath(path),
  pickLoPath: () => window.api.pickLoPath(),
  engineDownload: () => window.api.engineDownload(),
  engineDownloadCancel: () => window.api.engineDownloadCancel(),
  onEngineDownload: (cb) => window.api.onEngineDownload(cb),
  recheckEngine: () => window.api.recheckEngine(),

  openLog: () => window.api.openLog(),
  revealCache: () => window.api.revealCache(),
  clearCache: () => window.api.clearCache()
}

let active: PlatformApi = electronApi

/** The platform the UI talks to. */
export function platform(): PlatformApi {
  return active
}

/** Swap the host. Used by tests and by a future shell implementation. */
export function setPlatform(next: PlatformApi): void {
  active = next
}
