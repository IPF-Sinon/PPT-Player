import { consoleLogger as log } from './convert/logging'
import type { AppSettings } from '../shared/types'

export type Settings = AppSettings

export const DEFAULT_SETTINGS: Settings = {
  loPathOverride: '',
  cacheBudgetMb: 2048,
  recentFiles: []
}

function asString(value: unknown, fallback: string, max = 32767): string {
  return typeof value === 'string' && value.length <= max ? value : fallback
}

function asInt(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
    ? value
    : fallback
}

/**
 * Coerce arbitrary parsed JSON into valid settings.
 *
 * Unknown keys are dropped rather than rejected: a settings file written by a newer
 * build must not brick an older one, it just loses the fields it does not know.
 */
export function parseSettings(raw: unknown): Settings {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    log.warn('settings invalid, falling back to defaults')
    return { ...DEFAULT_SETTINGS }
  }
  const value = raw as Record<string, unknown>
  const recentRaw = value.recentFiles
  const recentFiles = Array.isArray(recentRaw)
    ? recentRaw.filter((p): p is string => typeof p === 'string' && p.length <= 32767).slice(0, 20)
    : []

  return {
    loPathOverride: asString(value.loPathOverride, DEFAULT_SETTINGS.loPathOverride),
    cacheBudgetMb: asInt(value.cacheBudgetMb, DEFAULT_SETTINGS.cacheBudgetMb, 128, 8192),
    recentFiles
  }
}

/** Insert a path at the head of the recent list, de-duplicated and capped. */
export function withRecentFile(current: Settings, filePath: string): Settings {
  const recentFiles = [filePath, ...current.recentFiles.filter((p) => p !== filePath)].slice(0, 10)
  return { ...current, recentFiles }
}