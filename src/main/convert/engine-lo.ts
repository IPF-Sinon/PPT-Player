import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { consoleLogger as log } from './logging'

export interface LoCandidate {
  /** Absolute path to soffice.com (console build on Windows). */
  sofficePath: string
  origin: 'bundled' | 'installed' | 'path' | 'custom'
}

export interface LoRunOptions {
  /** Absolute path to the source deck. */
  sourcePath: string
  /** Directory that receives deck.pdf. */
  outDir: string
  /** Hard timeout in milliseconds. */
  timeoutMs: number
  /** Absolute path to the soffice binary. */
  sofficePath: string
  signal?: AbortSignal
}

export interface LoRunResult {
  ok: boolean
  pdfPath: string
  exitCode: number | null
  stderr: string
  timedOut: boolean
  durationMs: number
}

const STDERR_LIMIT = 8000

/** Convert a Windows path into a file:// URL usable by soffice. */
export function toFileUrl(winPath: string): string {
  const normalised = winPath.replace(/\\/g, '/')
  const withSlash = normalised.startsWith('/') ? normalised : '/' + normalised
  return 'file://' + encodeURI(withSlash).replace(/#/g, '%23')
}

/** Kill a process tree on Windows, best effort. */
function killTree(pid: number): void {
  try {
    spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } catch (err) {
    log.warn('taskkill failed', err)
  }
}

/**
 * Run a headless LibreOffice conversion to PDF. A zero exit code does not prove
 * success, so the caller must validate the produced file.
 */
export async function runLibreOffice(opts: LoRunOptions): Promise<LoRunResult> {
  const started = Date.now()
  const profileDir = join(tmpdir(), 'ppt-player', 'lo-' + randomUUID())
  mkdirSync(profileDir, { recursive: true })
  mkdirSync(opts.outDir, { recursive: true })

  const args = [
    '--headless',
    '--norestore',
    '--invisible',
    '--nologo',
    '--nolockcheck',
    '-env:UserInstallation=' + toFileUrl(profileDir),
    '--convert-to',
    'pdf:impress_pdf_Export',
    '--outdir',
    opts.outDir,
    opts.sourcePath
  ]

  return await new Promise<LoRunResult>((resolve) => {
    let child: ChildProcess
    try {
      child = spawn(opts.sofficePath, args, { windowsHide: true })
    } catch (err) {
      log.error('failed to spawn soffice', err)
      rmSync(profileDir, { recursive: true, force: true })
      resolve({
        ok: false,
        pdfPath: '',
        exitCode: null,
        stderr: String(err),
        timedOut: false,
        durationMs: Date.now() - started
      })
      return
    }

    let stderr = ''
    let settled = false
    let timedOut = false

    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid) killTree(child.pid)
    }, opts.timeoutMs)

    const onAbort = (): void => {
      if (child.pid) killTree(child.pid)
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < STDERR_LIMIT) stderr += chunk.toString('utf8')
    })

    const finish = (exitCode: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      rmSync(profileDir, { recursive: true, force: true })
      const pdfPath = join(opts.outDir, 'deck.pdf')
      const produced = existsSync(pdfPath) && statSync(pdfPath).size > 1024
      resolve({
        ok: produced && !timedOut,
        pdfPath: produced ? pdfPath : '',
        exitCode,
        stderr,
        timedOut,
        durationMs: Date.now() - started
      })
    }

    child.on('error', (err) => {
      stderr += '\nspawn error: ' + String(err)
      finish(null)
    })
    child.on('close', (code) => finish(code))
  })
}

/** Locate soffice.com inside a LibreOffice program directory. */
export function sofficeInProgramDir(programDir: string): string | null {
  for (const name of ['soffice.com', 'soffice.exe']) {
    const candidate = join(programDir, name)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** List immediate sub-directories, used to pick a versioned engine folder. */
export function listSubdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(dir, d.name))
  } catch {
    return []
  }
}
