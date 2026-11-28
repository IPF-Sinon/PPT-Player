/**
 * The single seam between the UI and whatever shell hosts it.
 *
 * Every call the renderer makes to the host goes through here. Today the host is the
 * Tauri 2 shell in src-tauri; the point of this layer is that swapping in another
 * shell means implementing one interface rather than editing every component.
 *
 * Three things are deliberately not passthroughs:
 * - asset URLs are built here, because the URL shape belongs to the shell
 *   (Tauri serves the deck protocols over http://deck.localhost and
 *   http://pptx.localhost, matching src-tauri/src/commands.rs)
 * - subscriptions return an unsubscribe function, so components never touch the
 *   host's own event API. Tauri's listen() is async and resolves to an unlisten
 *   handle; the wrapper hides that behind a synchronous () => void.
 * - command results are normalised: Rust `Result<T, String>` rejects with a bare
 *   string, while the UI has always caught Error objects, and engine_download
 *   reports failure as a value rather than by rejecting.
 *
 * Argument keys: #[tauri::command] defaults to camelCase argument names (Tauri 2's
 * `ArgumentCase::Camel`), and no command in commands.rs sets rename_all, so a Rust
 * parameter `deck_id` is invoked as { deckId }. Struct *fields* are separately
 * renamed by serde (rename_all = "camelCase"), which is why payload values also use
 * camelCase keys.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import type {
  AppSettings,
  BootstrapInfo,
  ConvertProgress,
  EngineDownloadProgress,
  EngineStatus,
  FormatInfo,
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
  /**
   * Subscribe to files dropped on the window.
   *
   * Tauri intercepts the platform drag-drop and delivers real paths out of band, so
   * the browser's own drop event never fires and a File carries no path. This is the
   * replacement for the HTML5 drop handler.
   */
  onFileDrop(cb: (path: string) => void): () => void

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

/** Event names, identical to the channel names the host emits. */
const EVENTS = {
  playState: 'play:state',
  progress: 'deck:progress',
  externalOpen: 'app:open-external',
  engineDownload: 'engine:download-progress'
} as const

/**
 * Invoke a command and turn a rejected `Result<_, String>` into an Error.
 *
 * Rust rejects with the payload string itself; every caller in the UI treats a
 * failure as an Error (it reads `.message`, or passes it to String(err)), so the
 * rejection value is wrapped once here instead of at each call site.
 */
async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (err) {
    throw err instanceof Error ? err : new Error(typeof err === 'string' ? err : String(err))
  }
}

/**
 * Subscribe to a host event.
 *
 * Tauri's listen() is asynchronous, but PlatformApi's subscribe methods must return
 * their unsubscribe function synchronously: components hand it straight back to
 * React as an effect cleanup. The handle is therefore resolved in the background and
 * an unsubscribe that arrives first is honoured as soon as it exists.
 */
function subscribe<T>(event: string, cb: (payload: T) => void): () => void {
  let unlisten: UnlistenFn | null = null
  let stopped = false

  listen<T>(event, (payload) => cb(payload.payload))
    .then((off) => {
      if (stopped) off()
      else unlisten = off
    })
    .catch(() => {
      // No host attached (a browser, or a unit test): there is nothing to listen to.
      // Subscribing must still hand back a usable unsubscribe function.
    })

  return () => {
    stopped = true
    if (unlisten) {
      unlisten()
      unlisten = null
    }
  }
}

/** The shape commands.rs actually serialises for open_native. */
interface NativeDeckIndex {
  deckId: string
  slidePaths: string[]
  slideSize: { width: number; height: number }
  hasMacros: boolean
}

/** Extensions whose content an OOXML presentation is expected to declare. */
const OOXML_EXTENSIONS = new Set(['pptx', 'pptm', 'ppsx', 'ppsm', 'potx', 'potm'])

/**
 * Format metadata for a deck open_native already accepted.
 *
 * open_native only returns an index once it has detected an OOXML presentation and
 * opened it as a ZIP, so these values are facts the call established; only the
 * declared extension is read from the path.
 */
function ooxmlFormat(path: string): FormatInfo {
  const name = path.split(/[\\/]/).pop() ?? path
  const dot = name.lastIndexOf('.')
  const declaredExt = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
  return {
    kind: 'ooxml-presentation',
    container: 'zip',
    declaredExt,
    extMismatch: !OOXML_EXTENSIONS.has(declaredExt),
    encrypted: false,
    label: 'PPTX'
  }
}

/** The Tauri-backed implementation, which is what ships today. */
const tauriApi: PlatformApi = {
  probe: (path) => call<ProbeResult>('probe', { path }),
  open: (path) => call<OpenResult>('open', { path }),

  async openNative(path) {
    const index = await call<NativeDeckIndex | null>('open_native', { path })
    if (!index) return null
    // commands.rs returns the index alone. NativeOpenResult also carries the source
    // metadata the Electron build reported, and nothing in the UI reads it from a
    // native open, so it is taken from probe on the same path rather than invented.
    const probe = await call<ProbeResult>('probe', { path })
    return {
      ok: true,
      deckId: index.deckId,
      engineMode: 'native-pptx',
      slideCount: index.slidePaths.length,
      slideSize: index.slideSize,
      slidePaths: index.slidePaths,
      sourcePath: path,
      sourceBytes: probe.ok ? probe.bytes : 0,
      format: probe.ok ? probe.format : ooxmlFormat(path)
    }
  },

  cancelOpen: () => call<void>('cancel_open'),
  closeDeck: (deckId) => call<unknown>('close_deck', { deckId }),
  reportMetrics: (deckId, pageCount, pageSizes) =>
    call<unknown>('report_metrics', { deckId, pageCount, pageSizes }),
  pickFile: () => call<string | null>('pick_file'),

  // Reads a non-standard `path` property when the webview put one on the File, and
  // returns '' otherwise. A File from an <input type="file"> never carries a path:
  // the page is not allowed to see one. Note that Tauri's own drag-drop does not put
  // a path on the File either — it delivers paths out of band on the webview's
  // onDragDropEvent ({ type: 'drop', paths }) — so the HTML5 drop handler in
  // Preview.tsx needs that event, not this method, to open a dropped deck.
  getPathForFile: (file) => (file as File & { path?: string }).path ?? '',

  /**
   * Files dropped on the window.
   *
   * Tauri takes over the platform drop handler, so the DOM drop event never fires and
   * the path arrives here instead. Without this, dropping a deck does nothing.
   */
  onFileDrop: (cb) => {
    let dispose: (() => void) | undefined
    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'drop') {
          const first = event.payload.paths[0]
          if (first) cb(first)
        }
      })
      .then((unlisten) => {
        dispose = unlisten
      })
      .catch(() => {
        // Not running under Tauri; dropping is simply unavailable.
      })
    return () => dispose?.()
  },

  deckUrl: (deckId) => 'http://deck.localhost/' + deckId + '/deck.pdf',
  pptxUrl: (deckId, partPath) => 'http://pptx.localhost/' + deckId + '/' + partPath,

  enterPlayback: (deckId, pageIndex) =>
    call<void>('enter_playback', { deckId, pageIndex }),
  exitPlayback: () => call<void>('exit_playback'),
  onPlayState: (cb) => subscribe<{ active: boolean }>(EVENTS.playState, cb),
  onProgress: (cb) => subscribe<ConvertProgress>(EVENTS.progress, cb),
  onExternalOpen: (cb) => subscribe<string>(EVENTS.externalOpen, cb),

  loadInk: (deckId) => call<InkPage[]>('load_ink', { deckId }),
  saveInk: (deckId, pages) => call<void>('save_ink', { deckId, pages }),

  getSettings: () => call<AppSettings>('get_settings'),
  setSettings: (patch) => call<AppSettings>('set_settings', { patch }),
  bootstrap: () => call<BootstrapInfo>('bootstrap'),
  engineStatus: () => call<EngineStatus>('engine_status'),

  async engineVariant() {
    const variant = await call<{ variant: string; engineBytes: number }>('engine_variant')
    // The variant is baked in at build time and comes back as a plain string.
    return {
      variant: variant.variant === 'full' ? 'full' : 'lite',
      engineBytes: variant.engineBytes
    }
  },

  setLoPath: (path) => call<EngineStatus>('set_lo_path', { path }),
  pickLoPath: () => call<string | null>('pick_lo_path'),

  // The command rejects on failure, but the modal shows the reason inline and keeps
  // running, so a failure is reported as a value rather than thrown at it.
  async engineDownload() {
    try {
      const message = await call<string>('engine_download')
      return { ok: true, message }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  },

  engineDownloadCancel: () => call<void>('engine_download_cancel'),
  onEngineDownload: (cb) => subscribe<EngineDownloadProgress>(EVENTS.engineDownload, cb),
  recheckEngine: () => call<EngineStatus>('recheck_engine'),

  openLog: () => call<void>('open_log'),
  revealCache: () => call<void>('reveal_cache'),
  clearCache: () => call<void>('clear_cache')
}

let active: PlatformApi = tauriApi

/** The platform the UI talks to. */
export function platform(): PlatformApi {
  return active
}

/** Swap the host. Used by tests and by a future shell implementation. */
export function setPlatform(next: PlatformApi): void {
  active = next
}
