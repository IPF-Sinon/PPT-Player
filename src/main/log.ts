/**
 * File logger for the main process.
 *
 * Deliberately dependency free: it writes one line per event to
 * userData/logs/main.log and rotates to main.old.log past 5 MB. electron-log
 * pulled in IPC and renderer bridges that this app never used, and the conversion
 * modules were logging to a console-only stub, so soffice failures vanished in
 * production with nothing on disk to diagnose them.
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const MAX_BYTES = 5 * 1024 * 1024

let logFile: string | null = null

function filePath(): string {
  if (logFile) return logFile
  const dir = join(app.getPath('userData'), 'logs')
  mkdirSync(dir, { recursive: true })
  logFile = join(dir, 'main.log')
  return logFile
}

function rotateIfNeeded(target: string): void {
  try {
    if (!existsSync(target)) return
    if (statSync(target).size < MAX_BYTES) return
    renameSync(target, target.replace(/\.log$/, '.old.log'))
  } catch {
    // Rotation is best effort; losing it must never break logging.
  }
}

function format(level: string, message: string, rest: unknown[]): string {
  const stamp = new Date().toISOString()
  let tail = ''
  if (rest.length > 0) {
    tail =
      ' ' +
      rest
        .map((value) => {
          if (value instanceof Error) return value.stack ?? value.message
          if (typeof value === 'string') return value
          try {
            return JSON.stringify(value)
          } catch {
            return String(value)
          }
        })
        .join(' ')
  }
  return `${stamp} [${level}] ${message}${tail}\n`
}

function write(level: string, message: string, rest: unknown[]): void {
  const line = format(level, message, rest)
  if (level === 'error') console.error(line.trimEnd())
  else if (level === 'warn') console.warn(line.trimEnd())
  try {
    const target = filePath()
    rotateIfNeeded(target)
    appendFileSync(target, line, 'utf8')
  } catch {
    // A failed write must not take the app down.
  }
}

export const log = {
  info: (message: string, ...rest: unknown[]): void => write('info', message, rest),
  warn: (message: string, ...rest: unknown[]): void => write('warn', message, rest),
  error: (message: string, ...rest: unknown[]): void => write('error', message, rest),
  debug: (message: string, ...rest: unknown[]): void => {
    if (process.env.PPT_PLAYER_DEBUG) write('debug', message, rest)
  }
}

export function initLog(): string {
  const target = filePath()
  log.info('app starting', { version: app.getVersion(), electron: process.versions.electron })
  return target
}

export function logPath(): string {
  return filePath()
}

export { log as default }
