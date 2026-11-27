import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type PlayState, type RendererApi } from '../shared/ipc-contract'
import type {
  AppSettings,
  BootstrapInfo,
  ConvertProgress,
  DeckInfo,
  EngineDownloadProgress,
  EngineStatus,
  InkPage,
  NativeOpenResult,
  OpenResult,
  ProbeResult
} from '../shared/types'

const api: RendererApi = {
  probe: (path: string): Promise<ProbeResult> => ipcRenderer.invoke(IPC.deckProbe, path),
  open: (path: string): Promise<OpenResult> => ipcRenderer.invoke(IPC.deckOpen, path),
  openNative: (path: string): Promise<NativeOpenResult | null> =>
    ipcRenderer.invoke(IPC.deckOpenNative, path),
  cancelOpen: (): Promise<void> => ipcRenderer.invoke(IPC.deckCancel),
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
  engineDownload: (): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke(IPC.engineDownload),
  engineDownloadCancel: (): Promise<void> => ipcRenderer.invoke(IPC.engineDownloadCancel),
  engineVariant: (): Promise<{ variant: 'full' | 'lite'; engineBytes: number }> =>
    ipcRenderer.invoke(IPC.engineVariant),
  onEngineDownload: (cb: (progress: EngineDownloadProgress) => void) => {
    const listener = (_e: unknown, progress: EngineDownloadProgress): void => cb(progress)
    ipcRenderer.on(IPC.engineDownloadProgress, listener)
    return () => {
      ipcRenderer.removeListener(IPC.engineDownloadProgress, listener)
    }
  },
  recheckEngine: (): Promise<EngineStatus> => ipcRenderer.invoke(IPC.engineRecheck),
  setLoPath: (path: string): Promise<EngineStatus> => ipcRenderer.invoke(IPC.engineSetLoPath, { path }),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke(IPC.settingsSet, patch),
  enterPlayback: (deckId: string, pageIndex: number): Promise<void> =>
    ipcRenderer.invoke(IPC.playEnter, { deckId, pageIndex }),
  exitPlayback: (): Promise<void> => ipcRenderer.invoke(IPC.playExit),
  onPlayState: (cb: (state: PlayState) => void) => {
    const listener = (_e: unknown, state: PlayState): void => cb(state)
    ipcRenderer.on(IPC.playState, listener)
    return () => ipcRenderer.removeListener(IPC.playState, listener)
  },
  bootstrap: (): Promise<BootstrapInfo> => ipcRenderer.invoke(IPC.appBootstrap),
  openLog: (): Promise<void> => ipcRenderer.invoke(IPC.appOpenLog),
  revealCache: (): Promise<void> => ipcRenderer.invoke(IPC.appRevealCache),
  pickFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.appPickFile),
  pickLoPath: (): Promise<string | null> => ipcRenderer.invoke(IPC.appPickLoPath),
  clearCache: (): Promise<void> => ipcRenderer.invoke(IPC.appCacheClear),
  saveInk: (deckId: string, pages: InkPage[]): Promise<void> => ipcRenderer.invoke(IPC.inkSave, { deckId, pages }),
  loadInk: (deckId: string): Promise<InkPage[]> => ipcRenderer.invoke(IPC.inkLoad, deckId),
  // Electron 32 removed File.path, so a dropped file's path must come from here.
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  onExternalOpen: (cb: (path: string) => void) => {
    const listener = (_e: unknown, path: string): void => cb(path)
    ipcRenderer.on(IPC.appOpenExternal, listener)
    return () => ipcRenderer.removeListener(IPC.appOpenExternal, listener)
  },
  deckUrl: (deckId: string): string => 'app://deck/' + deckId + '/deck.pdf',
  pptxUrl: (deckId: string, partPath: string): string =>
    'app://pptx/' + deckId + '/' + partPath.replace(/^\/+/, '')
}

contextBridge.exposeInMainWorld('api', api)