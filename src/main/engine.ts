import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { EngineStatus } from '../shared/types'
import { log } from './log'
import { loadSettings } from './settings'
import { resolveLibreOffice } from './convert/engine-resolve'

/** Candidate roots for the bundled engine, in priority order. */
export function bundledEngineRoots(): string[] {
  const roots: string[] = []
  const fromEnv = process.env.PPT_PLAYER_LO_DIR
  if (fromEnv) roots.push(fromEnv)
  if (process.resourcesPath) roots.push(join(process.resourcesPath, 'lo'))
  roots.push(join(app.getAppPath(), 'resources', 'lo'))
  return roots
}

function runCommand(file: string, args: string[]): string | null {
  try {
    return execFileSync(file, args, { encoding: 'utf8', windowsHide: true })
  } catch {
    return null
  }
}

let cachedStatus: EngineStatus | null = null

/** Resolve the engine once per process, honouring the current settings. */
export function engineStatus(force = false): EngineStatus {
  if (!force && cachedStatus) return cachedStatus
  const status = resolveLibreOffice({
    loPathOverride: loadSettings().loPathOverride,
    bundledRoots: bundledEngineRoots(),
    runCommand
  })
  cachedStatus = status
  log.info('engine resolved', status)
  return status
}

export function resetEngineCache(): void {
  cachedStatus = null
}
