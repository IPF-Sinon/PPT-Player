import { BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron'
import { join } from 'node:path'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { IPC } from '../../shared/ipc-contract'
import { AppError, toPayload } from '../../shared/errors'
import type {
  AppSettings,
  DeckInfo,
  EngineStatus,
  InkPage,
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
import { closePlaybackWindow, createPlaybackWindow, getPreviewWindow } from '../windows'

export interface HandlerDeps {
  ctx: ConvertContext
  inkDir: string
}

let playbackContext: { deckId: string; pageIndex: number } | null = null
let pendingOpenPath: string | null = null

export function getPlaybackContext(): { deckId: string; pageIndex: number } | null {
  return playbackContext
}

/** Remember a file requested by the shell or a second instance. */
export function setPendingOpenPath(path: string | null): void {
  pendingOpenPath = path
}

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
    wrap(async (): Promise<ProbeResult> => {
      const filePath = pathSchema.parse(rawPath)
      try {
        const probe = await probeFile(filePath)
        return { ok: true, format: probe.format, bytes: probe.bytes, mtimeMs: probe.mtimeMs }
      } catch (err) {
        if (err instanceof AppError) return { ok: false, error: err.toPayload() }
        return { ok: false, error: toPayload(err) }
      }
    })
  )

  ipcMain.handle(IPC.deckOpen, (event, rawPath: unknown) =>
    wrap(async (): Promise<OpenResult> => {
      const filePath = pathSchema.parse(rawPath)
      const sender = event.sender
      const result = await openDeck(ctx, filePath, {
        onProgress: (progress) => {
          if (!sender.isDestroyed()) sender.send(IPC.deckProgress, progress)
        }
      })
      if (result.ok) {
        getCache(ctx).prune(loadSettings().cacheBudgetMb * 1024 * 1024)
      }
      return result
    })
  )

  ipcMain.handle(IPC.deckInfo, (_e, rawDeckId: unknown) =>
    wrap((): DeckInfo | null => {
      const deckId = deckIdSchema.parse(rawDeckId)
      return getDeck(deckId)?.info ?? null
    })
  )

  ipcMain.handle(IPC.deckReportMetrics, (_e, raw: unknown) =>
    wrap((): DeckInfo | null => {
      const parsed = reportMetricsSchema.parse(raw)
      return reportDeckMetrics(ctx, parsed.deckId, parsed.pageCount, parsed.pageSizes)
    })
  )

  ipcMain.handle(IPC.deckClose, (_e, rawDeckId: unknown) =>
    wrap((): void => {
      closeDeck(deckIdSchema.parse(rawDeckId))
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
      const { path } = setLoPathSchema.parse(raw)
      saveSettings({ loPathOverride: path })
      resetEngineCache()
      return engineStatus(true)
    })
  )

  ipcMain.handle(IPC.settingsGet, () => wrap((): AppSettings => loadSettings()))
  ipcMain.handle(IPC.settingsSet, (_e, raw: unknown) =>
    wrap((): AppSettings => {
      const patch = settingsPatchSchema.parse(raw)
      return saveSettings(patch)
    })
  )

  ipcMain.handle(IPC.playEnter, (event, raw: unknown) =>
    wrap((): void => {
      const parsed = playEnterSchema.parse(raw)
      playbackContext = { deckId: parsed.deckId, pageIndex: parsed.pageIndex }
      const bounds = BrowserWindow.fromWebContents(event.sender)?.getBounds()
      const point = bounds ? { x: bounds.x + 20, y: bounds.y + 20 } : undefined
      createPlaybackWindow(point)
    })
  )

  ipcMain.handle(IPC.playExit, () =>
    wrap((): void => {
      playbackContext = null
      closePlaybackWindow()
      const preview = getPreviewWindow()
      if (preview && !preview.isDestroyed()) preview.focus()
    })
  )

  ipcMain.handle(IPC.appOpenLog, () => wrap(async (): Promise<void> => {
    await shell.openPath(logPath())
  }))

  ipcMain.handle(IPC.appRevealCache, () => wrap(async (): Promise<void> => {
    const dir = ensureCacheDir(ctx)
    await shell.openPath(dir)
  }))

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

  ipcMain.handle(IPC.appPlaybackContext, () =>
    wrap((): { deckId: string; pageIndex: number } | null => playbackContext)
  )

  ipcMain.handle(IPC.appPendingOpen, () =>
    wrap((): string | null => {
      const path = pendingOpenPath
      pendingOpenPath = null
      return path
    })
  )

  ipcMain.handle(IPC.inkSave, (_e, raw: unknown) =>
    wrap((): void => {
      const parsed = inkPagesSchema.parse(raw)
      const dir = deps.inkDir
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, parsed.deckId + '.json'), JSON.stringify(parsed.pages), 'utf8')
    })
  )

  ipcMain.handle(IPC.inkLoad, (_e, rawDeckId: unknown) =>
    wrap((): InkPage[] => {
      const deckId = deckIdSchema.parse(rawDeckId)
      try {
        const text = readFileSync(join(deps.inkDir, deckId + '.json'), 'utf8')
        return JSON.parse(text) as InkPage[]
      } catch {
        return []
      }
    })
  )
}