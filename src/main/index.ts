import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { initLog, log } from './log'
import { loadSettings, pushRecentFile } from './settings'
import { registerAppScheme, registerAppProtocol } from './ipc/protocol'
import { registerHandlers, setPendingOpenPath } from './ipc/handlers'
import { engineStatus } from './engine'
import { createMainWindow, getPreviewWindow } from './windows'
import { extensionOf, isSupportedExtension } from '../shared/formats'
import { setLogSink } from './convert/logging'
import type { ConvertContext } from './convert/pipeline'

registerAppScheme()

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  bootstrap()
}

/** First supported file path found on the command line. */
function pendingFileFromArgv(argv: string[]): string | null {
  for (const raw of argv.slice(1)) {
    if (!raw || raw.startsWith('-')) continue
    const candidate = raw.replace(/^"|"$/g, '')
    if (!isSupportedExtension(extensionOf(candidate))) continue
    if (existsSync(candidate)) return candidate
  }
  return null
}

function bootstrap(): void {
  app.on('second-instance', (_event, argv) => {
    const file = pendingFileFromArgv(argv)
    const win = getPreviewWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
      if (file) win.webContents.send('app:open-external', file)
      return
    }
    if (file) {
      setPendingOpenPath(file)
      createMainWindow()
    }
  })

  app.whenReady().then(() => {
    initLog()
    // Conversion modules stay Electron-free; point them at the file logger so
    // soffice arguments, timings and stderr reach disk.
    setLogSink(log)

    const userData = app.getPath('userData')
    const cacheRoot = join(userData, 'cache')
    const inkDir = join(userData, 'ink')
    const profileRoot = join(userData, 'lo-profile')
    mkdirSync(cacheRoot, { recursive: true })
    mkdirSync(inkDir, { recursive: true })
    mkdirSync(profileRoot, { recursive: true })

    const ctx: ConvertContext = {
      cacheRoot,
      profileRoot,
      appVersion: app.getVersion(),
      engine: () => engineStatus(),
      onOpened: (filePath) => {
        pushRecentFile(filePath)
      }
    }

    registerAppProtocol({ rendererRoot: join(__dirname, '../renderer') })
    registerHandlers({ ctx, inkDir })
    loadSettings()

    const startupFile = pendingFileFromArgv(process.argv)
    if (startupFile) setPendingOpenPath(startupFile)

    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  process.on('uncaughtException', (err) => {
    log.error('uncaught exception', err)
    dialog.showErrorBox('发生错误', String(err))
  })

  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection', reason)
  })
}
