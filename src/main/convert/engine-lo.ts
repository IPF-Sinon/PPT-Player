import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { consoleLogger as log } from './logging'

export interface LoRunOptions {
  /** Absolute path to the source deck. */
  sourcePath: string
  /** Directory that receives deck.pdf. */
  outDir: string
  /** Directory that holds reusable LibreOffice user profiles. */
  profileRoot: string
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
  /** True when the caller cancelled the run. */
  aborted: boolean
}

const STDERR_LIMIT = 8000
/** How long to wait for the stderr pipe to close after the process has exited. */
const EXIT_GRACE_MS = 1500
/** Number of reusable profile slots, enough for a couple of concurrent opens. */
const PROFILE_SLOTS = 2

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
 * Pick a reusable LibreOffice profile directory.
 *
 * Every conversion used to get a fresh random profile and delete it afterwards,
 * which forced LibreOffice to rebuild its configuration, font cache and extension
 * registry from scratch each time. That cold start is most of the delay before the
 * first slide appears. Profiles are now reused across runs, with a small number of
 * slots so two concurrent conversions cannot share one.
 */
export function pickProfileDir(profileRoot: string): string {
  mkdirSync(profileRoot, { recursive: true })
  for (let slot = 0; slot < PROFILE_SLOTS; slot++) {
    const dir = join(profileRoot, 'slot-' + slot)
    const lock = join(dir, '.lock')
    if (!existsSync(lock)) {
      mkdirSync(dir, { recursive: true })
      return dir
    }
  }
  // All slots are busy; fall back to an extra directory rather than failing.
  // The name must be unique: a timestamp alone collides when two conversions start
  // in the same millisecond, and they would then share one profile and corrupt it.
  for (let attempt = 0; ; attempt++) {
    const extra = join(profileRoot, 'slot-extra-' + Date.now().toString(36) + '-' + attempt)
    if (existsSync(extra)) continue
    mkdirSync(extra, { recursive: true })
    return extra
  }
}

/** Arguments for a headless Impress-to-PDF conversion. */
export function buildConvertArgs(opts: {
  profileDir: string
  outDir: string
  sourcePath: string
}): string[] {
  return [
    '--headless',
    '--norestore',
    '--invisible',
    '--nologo',
    '--nodefault',
    '--nofirststartwizard',
    '--nolockcheck',
    '-env:UserInstallation=' + toFileUrl(opts.profileDir),
    '--convert-to',
    'pdf:impress_pdf_Export',
    '--outdir',
    opts.outDir,
    opts.sourcePath
  ]
}

/**
 * Run a headless LibreOffice conversion to PDF.
 *
 * A zero exit code does not prove success, so the caller must validate the output.
 * The promise always settles: on Windows soffice.com launches soffice.bin and a
 * stray grandchild can keep the inherited stderr handle open, so 'close' may never
 * fire. 'exit' is therefore treated as the primary signal and a short grace timer
 * forces completion if the pipe stays open.
 */
export async function runLibreOffice(opts: LoRunOptions): Promise<LoRunResult> {
  const started = Date.now()
  const profileDir = pickProfileDir(opts.profileRoot)
  const lockPath = join(profileDir, '.lock')
  mkdirSync(opts.outDir, { recursive: true })

  const args = buildConvertArgs({
    profileDir,
    outDir: opts.outDir,
    sourcePath: opts.sourcePath
  })

  return await new Promise<LoRunResult>((resolve) => {
    let child: ChildProcess
    try {
      // stdout is dropped rather than piped: soffice writes progress there, and a
      // piped stream nobody drains fills its buffer and blocks the child forever.
      child = spawn(opts.sofficePath, args, {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      })
    } catch (err) {
      log.error('failed to spawn soffice', err)
      resolve({
        ok: false,
        pdfPath: '',
        exitCode: null,
        stderr: String(err),
        timedOut: false,
        durationMs: Date.now() - started,
        aborted: false
      })
      return
    }

    let stderr = ''
    let settled = false
    let timedOut = false
    let aborted = false
    let graceTimer: NodeJS.Timeout | null = null

    const releaseProfile = (): void => {
      rmSync(lockPath, { force: true })
    }

    const finish = (exitCode: number | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (graceTimer) clearTimeout(graceTimer)
      opts.signal?.removeEventListener('abort', onAbort)
      child.stderr?.destroy()
      releaseProfile()

      const pdfPath = collectPdf(opts.outDir)
      const produced = pdfPath !== ''
      resolve({
        ok: produced && !timedOut && !aborted,
        pdfPath,
        exitCode,
        stderr,
        timedOut,
        durationMs: Date.now() - started,
        aborted
      })
    }

    const timer = setTimeout(() => {
      timedOut = true
      if (child.pid) killTree(child.pid)
      // Give the tree a moment to die, then settle regardless.
      graceTimer = setTimeout(() => finish(null), EXIT_GRACE_MS)
    }, opts.timeoutMs)

    const onAbort = (): void => {
      aborted = true
      if (child.pid) killTree(child.pid)
      graceTimer = setTimeout(() => finish(null), EXIT_GRACE_MS)
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    if (opts.signal?.aborted) onAbort()

    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < STDERR_LIMIT) stderr += chunk.toString('utf8')
    })

    // 'exit' fires when the process is gone; 'close' waits for the pipes. Prefer
    // 'exit' and use a grace timer so a lingering handle cannot hang the caller.
    child.on('exit', (code) => {
      graceTimer = setTimeout(() => finish(code), EXIT_GRACE_MS)
    })
    child.on('close', (code) => finish(code))
    child.on('error', (err) => {
      stderr += '\nspawn error: ' + String(err)
      finish(null)
    })
  })
}

/**
 * Find the PDF soffice wrote into `outDir` and rename it to deck.pdf. Returns the
 * absolute path, or an empty string when no usable PDF was produced.
 */
export function collectPdf(outDir: string): string {
  const target = join(outDir, 'deck.pdf')
  if (existsSync(target) && statSync(target).size > 1024) return target

  let candidates: string[] = []
  try {
    candidates = readdirSync(outDir).filter((name) => name.toLowerCase().endsWith('.pdf'))
  } catch {
    return ''
  }

  for (const name of candidates) {
    const full = join(outDir, name)
    let size = 0
    try {
      size = statSync(full).size
    } catch {
      continue
    }
    if (size <= 1024) continue
    if (full !== target) {
      rmSync(target, { force: true })
      renameSync(full, target)
    }
    return target
  }
  return ''
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
