import { app } from 'electron'
import { execFile } from 'node:child_process'
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

/**
 * Query the registry without blocking the main process.
 *
 * This used to call execFileSync, which froze the IPC event loop for the length
 * of a `reg query` — the whole window, including the loading UI, stopped
 * responding. The async form keeps the app live while the engine is located.
 */
function runCommand(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: 'utf8', windowsHide: true, timeout: 5000 }, (err, stdout) => {
      resolve(err ? null : stdout)
    })
  })
}

let cachedStatus: EngineStatus | null = null

/** Resolve the engine once per process, honouring the current settings. */
export async function engineStatus(force = false): Promise<EngineStatus> {
  if (!force && cachedStatus) return cachedStatus
  const status = await resolveLibreOffice({
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