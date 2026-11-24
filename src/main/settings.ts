import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AppSettings } from '../shared/types'
import { log } from './log'
import { DEFAULT_SETTINGS, parseSettings, withRecentFile, type Settings } from './settings-parse'

export { DEFAULT_SETTINGS, parseSettings }
export type { Settings }

let cached: Settings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export function loadSettings(): Settings {
  if (cached) return cached
  try {
    const text = readFileSync(settingsPath(), 'utf8')
    cached = parseSettings(JSON.parse(text))
  } catch {
    cached = { ...DEFAULT_SETTINGS }
  }
  return cached
}

export function saveSettings(patch: Partial<AppSettings>): Settings {
  const next = parseSettings({ ...loadSettings(), ...patch })
  const target = settingsPath()
  mkdirSync(dirname(target), { recursive: true })
  const tmp = target + '.tmp'
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8')
  renameSync(tmp, target)
  cached = next
  log.info('settings saved')
  return next
}

export function pushRecentFile(filePath: string): Settings {
  return saveSettings(withRecentFile(loadSettings(), filePath))
}
