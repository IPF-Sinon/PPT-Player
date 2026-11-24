import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { EngineStatus } from '../../shared/types'
import { consoleLogger as log } from './logging'
import { listSubdirs, sofficeInProgramDir } from './engine-lo'

export interface ResolveOptions {
  /** Explicit soffice binary or program directory from settings. */
  loPathOverride?: string
  /** Candidate roots for the bundled engine, in priority order. */
  bundledRoots: string[]
  /** Registry keys to probe on Windows. */
  registryKeys?: string[]
  /** PATH value used for the last resort lookup. */
  pathVar?: string
  /** Platform string, injectable for tests. */
  platform?: NodeJS.Platform
  /** Command runner used to query the registry. May be async so it never blocks. */
  runCommand?: (file: string, args: string[]) => string | null | Promise<string | null>
}

export const WIN_REGISTRY_KEYS = [
  'HKLM\\SOFTWARE\\LibreOffice\\UNO\\InstallPath',
  'HKLM\\SOFTWARE\\WOW6432Node\\LibreOffice\\UNO\\InstallPath'
]

function findBundled(roots: string[]): string | null {
  for (const root of roots) {
    if (!root) continue
    const direct = sofficeInProgramDir(join(root, 'program'))
    if (direct) return direct
    for (const sub of listSubdirs(root)) {
      const inProgram = sofficeInProgramDir(join(sub, 'program'))
      if (inProgram) return inProgram
    }
  }
  return null
}

async function findInRegistry(
  keys: string[],
  runCommand: ResolveOptions['runCommand']
): Promise<string | null> {
  if (!runCommand) return null
  for (const key of keys) {
    const out = await runCommand('reg', ['query', key, '/ve'])
    if (!out) continue
    const match = /REG_[A-Z_]+\s+(.+)$/m.exec(out)
    const dir = match?.[1]?.trim().replace(/^"|"$/g, '')
    if (!dir) continue
    const found = sofficeInProgramDir(dir)
    if (found) return found
  }
  return null
}

function findOnPath(pathVar: string, platform: NodeJS.Platform): string | null {
  for (const dir of pathVar.split(platform === 'win32' ? ';' : ':')) {
    if (!dir) continue
    const found = sofficeInProgramDir(dir)
    if (found) return found
  }
  return null
}

/**
 * Resolve the LibreOffice binary: explicit override, bundled engine, registry
 * install, then PATH. Pure enough to unit test without Electron.
 */
export async function resolveLibreOffice(options: ResolveOptions): Promise<EngineStatus> {
  const platform = options.platform ?? process.platform

  const override = options.loPathOverride?.trim()
  if (override) {
    const found = sofficeInProgramDir(override) ?? (existsSync(override) ? override : null)
    if (found) {
      return {
        available: true,
        id: 'libreoffice',
        path: found,
        version: '',
        origin: 'custom',
        detail: found
      }
    }
    log.warn('configured LibreOffice path is unusable: ' + override)
  }

  const bundled = findBundled(options.bundledRoots)
  if (bundled) {
    return { available: true, id: 'libreoffice', path: bundled, version: '', origin: 'bundled', detail: bundled }
  }

  if (platform === 'win32') {
    const installed = await findInRegistry(options.registryKeys ?? WIN_REGISTRY_KEYS, options.runCommand)
    if (installed) {
      return {
        available: true,
        id: 'libreoffice',
        path: installed,
        version: '',
        origin: 'installed',
        detail: installed
      }
    }
  }

  const fromPath = findOnPath(options.pathVar ?? process.env.PATH ?? '', platform)
  if (fromPath) {
    return { available: true, id: 'libreoffice', path: fromPath, version: '', origin: 'path', detail: fromPath }
  }

  const expected = options.bundledRoots[0] ? join(options.bundledRoots[0], 'program', 'soffice.com') : ''
  return { available: false, id: 'none', path: '', version: '', origin: 'none', detail: expected }
}