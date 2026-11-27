import { BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { IPC } from '../../shared/ipc-contract'
import { AppError, toPayload } from '../../shared/errors'
import type {
  AppSettings,
  BootstrapInfo,
  DeckInfo,
  EngineStatus,
  InkPage,
  NativeOpenResult,
  OpenResult,
  ProbeResult
} from '../../shared/types'
import { log, logPath } from '../log'
import { loadSettings, saveSettings } from '../settings'
import {
  closeDeck,
  ensureCacheDir,
  getCache,
  getDeck,
  openDeck,
  openDeckNative,
  probeFile,
  reportDeckMetrics,
  type ConvertContext
} from '../convert/pipeline'
import { engineStatus, resetEngineCache } from '../engine'
import {
  deckIdSchema,
  inkPagesSchema,
  pathSchema,
  playEnterSchema,
  reportMetricsSchema,
  setLoPathSchema,
  settingsPatchSchema
} from './schema'
import { exitFullScreen, getPreviewWindow, isFullScreen } from '../windows'

export interface HandlerDeps {
  ctx: ConvertContext
  inkDir: string
}

let pendingOpenPath: string | null = null

/** Remember a file requested by the shell or a second instance. */
export function setPendingOpenPath(path: string | null): void {
  pendingOpenPath = path
}

/**
 * Cancels the conversion currently in flight.
 *
 * Opening a second deck, or asking to cancel, used to leave the first soffice
 * process running for up to three minutes with no way to stop it. Each open now
 * owns a controller that the next open aborts.
 */
let activeConversion: AbortController | null = null

function wrap<T>(fn: () => Promise<T> | T): Promise<T> {
  return Promise.resolve()
    .then(fn)
    .catch((err) => {
      log.error('ipc handler failed', err)
      throw err
    })
}

export function registerHandlers(deps: HandlerDeps): void {
  const { ctx } = deps

  ipcMain.handle(IPC.deckProbe, (_e, rawPath: unknown) =>
    wrap((): ProbeResult => {
      const filePath = pathSchema(rawPath)
      try {
        const probe = probeFile(filePath)
        return { ok: true, format: probe.format, bytes: probe.bytes, mtimeMs: probe.mtimeMs }
      } catch (err) {
        if (err instanceof AppError) return { ok: false, error: err.toPayload() }
        return { ok: false, error: toPayload(err) }
      }
    })
  )

  ipcMain.handle(IPC.deckOpen, (event, rawPath: unknown) =>
    wrap(async (): Promise<OpenResult> => {
      const filePath = pathSchema(rawPath)
      const sender = event.sender

      // A new open supersedes whatever was converting.
      activeConversion?.abort()
      const controller = new AbortController()
      activeConversion = controller

      try {
        const result = await openDeck(ctx, filePath, {
          signal: controller.signal,
          onProgress: (progress) => {
            if (!sender.isDestroyed()) sender.send(IPC.deckProgress, progress)
          }
        })
        if (result.ok) {
          getCache(ctx).prune(loadSettings().cacheBudgetMb * 1024 * 1024)
        }
        return result
      } finally {
        if (activeConversion === controller) activeConversion = null
      }
    })
  )

  ipcMain.handle(IPC.deckOpenNative, (_e, rawPath: unknown) =>
    wrap((): NativeOpenResult | null => {
      const filePath = pathSchema(rawPath)
      return openDeckNative(ctx, filePath)
    })
  )

  ipcMain.handle(IPC.deckCancel, () =>
    wrap((): void => {
      activeConversion?.abort()
      activeConversion = null
      log.info('conversion cancelled by user')
    })
  )

  ipcMain.handle(IPC.deckInfo, (_e, rawDeckId: unknown) =>
    wrap((): DeckInfo | null => {
      const deckId = deckIdSchema(rawDeckId)
      return getDeck(deckId)?.info ?? null
    })
  )

  ipcMain.handle(IPC.deckReportMetrics, (_e, raw: unknown) =>
    wrap((): DeckInfo | null => {
      const parsed = reportMetricsSchema(raw)
      return reportDeckMetrics(ctx, parsed.deckId, parsed.pageCount, parsed.pageSizes)
    })
  )

  ipcMain.handle(IPC.deckClose, (_e, rawDeckId: unknown) =>
    wrap((): void => {
      closeDeck(deckIdSchema(rawDeckId))
    })
  )

  ipcMain.handle(IPC.engineStatus, () => wrap((): Promise<EngineStatus> => engineStatus()))
  ipcMain.handle(IPC.engineRecheck, () =>
    wrap((): Promise<EngineStatus> => {
      resetEngineCache()
      return engineStatus(true)
    })
  )

  ipcMain.handle(IPC.engineSetLoPath, (_e, raw: unknown) =>
    wrap((): Promise<EngineStatus> => {
      const { path } = setLoPathSchema(raw)
      saveSettings({ loPathOverride: path })
      resetEngineCache()
      return engineStatus(true)
    })
  )

  ipcMain.handle(IPC.settingsGet, () => wrap((): AppSettings => loadSettings()))
  ipcMain.handle(IPC.settingsSet, (_e, raw: unknown) =>
    wrap((): AppSettings => {
      const patch = settingsPatchSchema(raw)
      return saveSettings(patch)
    })
  )

  /**
   * Playback happens in the existing window.
   *
   * Spinning up a second BrowserWindow meant a fresh renderer process that had to
   * re-parse React and pdf.js and re-fetch the PDF before the first slide could
   * appear. The window now just goes fullscreen and the renderer switches view
   * using the document it already has.
   */
  ipcMain.handle(IPC.playEnter, (event, raw: unknown) =>
    wrap((): void => {
      playEnterSchema(raw)
      const win = BrowserWindow.fromWebContents(event.sender) ?? getPreviewWindow()
      if (!win || win.isDestroyed()) return
      win.setFullScreen(true)
      win.setMenuBarVisibility(false)
      win.webContents.send(IPC.playState, { active: true })
    })
  )

  ipcMain.handle(IPC.playExit, (event) =>
    wrap((): void => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? getPreviewWindow()
      if (win && !win.isDestroyed()) exitFullScreen(win)
    })
  )

  ipcMain.handle(IPC.appOpenLog, () =>
    wrap(async (): Promise<void> => {
      await shell.openPath(logPath())
    })
  )

  ipcMain.handle(IPC.appRevealCache, () =>
    wrap(async (): Promise<void> => {
      const dir = ensureCacheDir(ctx)
      await shell.openPath(dir)
    })
  )

  ipcMain.handle(IPC.appCacheClear, () =>
    wrap((): void => {
      getCache(ctx).clearAll()
      log.info('cache cleared')
    })
  )

  ipcMain.handle(IPC.appPickFile, () =>
    wrap(async (): Promise<string | null> => {
      const win = getPreviewWindow()
      const options: OpenDialogOptions = {
        title: '打开演示文稿',
        properties: ['openFile'],
        filters: [
          {
            name: '演示文稿',
            extensions: ['ppt', 'pptx', 'pptm', 'pps', 'ppsx', 'ppsm', 'potx', 'odp', 'pdf']
          },
          { name: '所有文件', extensions: ['*'] }
        ]
      }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0] ?? null
    })
  )

  ipcMain.handle(IPC.appPickLoPath, () =>
    wrap(async (): Promise<string | null> => {
      const win = getPreviewWindow()
      const options: OpenDialogOptions = {
        title: '选择 LibreOffice 安装目录',
        properties: ['openDirectory']
      }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0] ?? null
    })
  )

  /**
   * One round trip for everything the first screen needs.
   *
   * Startup used to fire several independent IPC calls (settings, pending file,
   * recent list, engine status) and the UI waited on the slowest. Bundling them
   * removes the round trips; engine status is deliberately not included because it
   * is only needed once a non-PDF file is opened.
   */
  ipcMain.handle(IPC.appBootstrap, () =>
    wrap((): BootstrapInfo => {
      const settings = loadSettings()
      const pending = pendingOpenPath
      pendingOpenPath = null
      return {
        settings,
        pendingOpenPath: pending,
        fullscreen: isFullScreen()
      }
    })
  )

  ipcMain.handle(IPC.inkSave, (_e, raw: unknown) =>
    wrap((): void => {
      const parsed = inkPagesSchema(raw)
      const dir = deps.inkDir
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, parsed.deckId + '.json'), JSON.stringify(parsed.pages), 'utf8')
    })
  )

  ipcMain.handle(IPC.inkLoad, (_e, rawDeckId: unknown) =>
    wrap((): InkPage[] => {
      const deckId = deckIdSchema(rawDeckId)
      try {
        const text = readFileSync(join(deps.inkDir, deckId + '.json'), 'utf8')
        return JSON.parse(text) as InkPage[]
      } catch {
        return []
      }
    })
  )
}