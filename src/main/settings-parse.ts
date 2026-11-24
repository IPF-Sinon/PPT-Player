import { z } from 'zod'
import { consoleLogger as log } from './convert/logging'

export const settingsSchema = z.object({
  preferCom: z.boolean().default(false),
  loPathOverride: z.string().default(''),
  cacheBudgetMb: z.number().int().min(128).max(8192).default(2048),
  loopPlayback: z.boolean().default(false),
  recentFiles: z.array(z.string()).max(20).default([])
})

export type Settings = z.infer<typeof settingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  preferCom: false,
  loPathOverride: '',
  cacheBudgetMb: 2048,
  loopPlayback: false,
  recentFiles: []
}

/** Coerce arbitrary parsed JSON into valid settings, dropping unknown keys. */
export function parseSettings(raw: unknown): Settings {
  const result = settingsSchema.safeParse(raw)
  if (result.success) return result.data
  log.warn('settings invalid, falling back to defaults')
  return { ...DEFAULT_SETTINGS }
}

/** Insert a path at the head of the recent list, de-duplicated and capped. */
export function withRecentFile(current: Settings, filePath: string): Settings {
  const recentFiles = [filePath, ...current.recentFiles.filter((p) => p !== filePath)].slice(0, 10)
  return { ...current, recentFiles }
}
