import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type RendererApi } from '../shared/ipc-contract'
import type {
  AppSettings,
  ConvertProgress,
  DeckInfo,
  EngineStatus,
  InkPage,
  OpenResult,
  ProbeResult
} from '../shared/types'

const api: RendererApi = {
  probe: (path: string): Promise<ProbeResult> => ipcRenderer.invoke(IPC.deckProbe, path),
  open: (path: string): Promise<OpenResult> => ipcRenderer.invoke(IPC.deckOpen, path),
  deckInfo: (deckId: string): Promise<DeckInfo | null> => ipcRenderer.invoke(IPC.deckInfo, deckId),
  closeDeck: (deckId: string): Promise<void> => ipcRenderer.invoke(IPC.deckClose, deckId),
  reportMetrics: (deckId, pageCount, pageSizes) =>
    ipcRenderer.invoke(IPC.deckReportMetrics, { deckId, pageCount, pageSizes }),
  onProgress: (cb: (progress: ConvertProgress) => void) => {
    const listener = (_e: unknown, progress: ConvertProgress): void => cb(progress)
    ipcRenderer.on(IPC.deckProgress, listener)
    return () => ipcRenderer.removeListener(IPC.deckProgress, listener)
  },
  engineStatus: (): Promise<EngineStatus> => ipcRenderer.invoke(IPC.engineStatus),
  recheckEngine: (): Promise<EngineStatus> => ipcRenderer.invoke(IPC.engineRecheck),
  setLoPath: (path: string): Promise<EngineStatus> => ipcRenderer.invoke(IPC.engineSetLoPath, { path }),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsSet, patch),
  enterPlayback: (deckId: string, pageIndex: number): Promise<void> =>
    ipcRenderer.invoke(IPC.playEnter, { deckId, pageIndex }),
  exitPlayback: (): Promise<void> => ipcRenderer.invoke(IPC.playExit),
  openLog: (): Promise<void> => ipcRenderer.invoke(IPC.appOpenLog),
  revealCache: (): Promise<void> => ipcRenderer.invoke(IPC.appRevealCache),
  pickFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.appPickFile),
  pickLoPath: (): Promise<string | null> => ipcRenderer.invoke(IPC.appPickLoPath),
  clearCache: (): Promise<void> => ipcRenderer.invoke(IPC.appCacheClear),
  saveInk: (deckId: string, pages: InkPage[]): Promise<void> => ipcRenderer.invoke(IPC.inkSave, { deckId, pages }),
  loadInk: (deckId: string): Promise<InkPage[]> => ipcRenderer.invoke(IPC.inkLoad, deckId),
  playbackContext: () => ipcRenderer.invoke(IPC.appPlaybackContext),
  deckUrl: async (deckId: string) => 'app://deck/' + deckId + '/deck.pdf',
  onExternalOpen: (cb: (path: string) => void) => {
    const listener = (_e: unknown, path: string): void => cb(path)
    ipcRenderer.on(IPC.appOpenExternal, listener)
    return () => ipcRenderer.removeListener(IPC.appOpenExternal, listener)
  },
  takePendingOpen: (): Promise<string | null> => ipcRenderer.invoke(IPC.appPendingOpen)
}

contextBridge.exposeInMainWorld('api', api)
