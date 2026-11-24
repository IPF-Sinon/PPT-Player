import { BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import { log } from './log'
import { APP_SCHEME, RENDERER_HOST } from './ipc/protocol'

const devUrl = process.env.ELECTRON_RENDERER_URL

function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

/** Production loads through app:// so the renderer keeps a normal origin. */
export function rendererIndexUrl(): string {
  return `${APP_SCHEME}://${RENDERER_HOST}/index.html`
}

function loadRenderer(win: BrowserWindow, hash: string): void {
  const url = devUrl ? `${devUrl}#${hash}` : `${rendererIndexUrl()}#${hash}`
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

let previewWindow: BrowserWindow | null = null
let playbackWindow: BrowserWindow | null = null

export function getPreviewWindow(): BrowserWindow | null {
  return previewWindow && !previewWindow.isDestroyed() ? previewWindow : null
}

export function getPlaybackWindow(): BrowserWindow | null {
  return playbackWindow && !playbackWindow.isDestroyed() ? playbackWindow : null
}

export function createPreviewWindow(): BrowserWindow {
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
    show: false,
    backgroundColor: '#f3f4f6',
    title: 'PPT 放映器',
    autoHideMenuBar: true,
    webPreferences: baseWebPreferences
  })

  hardenWebContents(win)
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    previewWindow = null
  })

  loadRenderer(win, 'preview')
  previewWindow = win
  return win
}

export function createPlaybackWindow(displayPoint?: { x: number; y: number }): BrowserWindow {
  const existing = getPlaybackWindow()
  if (existing) {
    existing.focus()
    return existing
  }

  const display = displayPoint ? screen.getDisplayNearestPoint(displayPoint) : screen.getPrimaryDisplay()

  const win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    fullscreen: true,
    frame: false,
    show: false,
    backgroundColor: '#000000',
    autoHideMenuBar: true,
    webPreferences: baseWebPreferences
  })

  hardenWebContents(win)
  win.setMenuBarVisibility(false)
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    playbackWindow = null
  })

  loadRenderer(win, 'playback')
  playbackWindow = win
  return win
}

export function closePlaybackWindow(): void {
  const win = getPlaybackWindow()
  if (win) win.close()
}
