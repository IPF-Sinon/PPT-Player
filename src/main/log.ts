import log from 'electron-log/main'
import { app } from 'electron'

export function initLog(): string {
  log.initialize()
  log.transports.file.level = 'info'
  log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'info'
  log.transports.file.maxSize = 5 * 1024 * 1024
  log.errorHandler.startCatching({ showDialog: false })
  const path = log.transports.file.getFile().path
  log.info('app starting', { version: app.getVersion(), electron: process.versions.electron })
  return path
}

export function logPath(): string {
  return log.transports.file.getFile().path
}

export { log }
