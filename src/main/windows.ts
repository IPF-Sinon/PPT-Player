import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { log } from './log'
import { APP_SCHEME } from './ipc/protocol'

const devUrl = process.env.ELECTRON_RENDERER_URL

function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

/** Production loads through app:// so the renderer keeps a normal origin. */
export function rendererIndexUrl(): string {
  return `${APP_SCHEME}://renderer/index.html`
}

function loadRenderer(win: BrowserWindow): void {
  const url = devUrl ? devUrl : rendererIndexUrl()
  void win.loadURL(url).catch((err) => log.error('failed to load renderer', err))
}

function hardenWebContents(win: BrowserWindow): void {
  const wc = win.webContents
  wc.setWindowOpenHandler(({ url }) => {
    log.warn('blocked window.open', url)
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  wc.on('will-navigate', (event, url) => {
    const current = wc.getURL().split('#')[0]
    const target = url.split('#')[0]
    if (target !== current) {
      event.preventDefault()
      log.warn('blocked navigation', url)
    }
  })
  wc.on('will-attach-webview', (event) => {
    event.preventDefault()
    log.warn('blocked webview attach')
  })
}

const baseWebPreferences = {
  preload: preloadPath(),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  spellcheck: false,
  webSecurity: true
} as const

let mainWindow: BrowserWindow | null = null

export function getPreviewWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null
}

/**
 * One window for the whole app.
 *
 * Preview and playback are two views in the same renderer, so entering a show is
 * a fullscreen switch rather than launching a second BrowserWindow with its own
 * process, React parse and PDF fetch.
 */
export function createMainWindow(): BrowserWindow {
  const existing = getPreviewWindow()
  if (existing) {
    existing.focus()
    return existing
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    // Shown immediately, with the paint deferred. Waiting for ready-to-show made the
    // app feel slow to start: double-clicking produced no window at all until the
    // renderer had parsed and painted, which on a cold start is a visible pause.
    show: true,
    paintWhenInitiallyHidden: false,
    // Matches --bg-app, so there is no dark flash before the UI paints. This used to
    // be #0f1115 while the app is light.
    backgroundColor: '#f3f4f6',
    title: 'PPT 放映器',
    autoHideMenuBar: true,
    webPreferences: baseWebPreferences
  })

  hardenWebContents(win)

  // Leaving fullscreen by any route (Escape, F11, OS gesture) must put the UI back
  // into preview, otherwise the chrome stays hidden over a normal window.
  const notifyPlayState = (): void => {
    if (win.isDestroyed()) return
    win.webContents.send('play:state', { active: win.isFullScreen() })
  }
  win.on('enter-full-screen', notifyPlayState)
  win.on('leave-full-screen', notifyPlayState)

  win.on('closed', () => {
    mainWindow = null
  })

  loadRenderer(win)
  mainWindow = win
  return win
}

export function exitFullScreen(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isFullScreen()) win.setFullScreen(false)
  win.setMenuBarVisibility(false)
  win.webContents.send('play:state', { active: false })
}

export function isFullScreen(): boolean {
  const win = getPreviewWindow()
  return win ? win.isFullScreen() : false
}
