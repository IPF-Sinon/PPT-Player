/**
 * On-demand download of the compatibility engine.
 *
 * The lite build ships without LibreOffice, so a user who opens a legacy .ppt or
 * asks for compatible mode needs the engine fetched once. Everything here uses
 * platform facilities only: Node's built-in fetch for the transfer, node:crypto for
 * the checksum, and Windows' own tar.exe for extraction. That keeps the main process
 * free of new third-party dependencies.
 */

import { createHash } from 'node:crypto'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { consoleLogger as log } from './logging'

export interface EngineDownloadProgress {
  stage: 'downloading' | 'verifying' | 'extracting' | 'done' | 'error'
  receivedBytes: number
  totalBytes: number
  /** 0..1, or -1 when the server did not report a length. */
  ratio: number
  message: string
}

export interface EngineDownloadOptions {
  /** Release asset URL for the engine zip. */
  url: string
  /** Expected SHA256 of the zip, lowercase hex. */
  sha256: string
  /** Expected byte length, used as an early sanity check. */
  bytes: number
  /** Directory the engine is unpacked into, e.g. userData/engine/lo. */
  targetDir: string
  /** Scratch directory for the download, e.g. userData/engine. */
  workDir: string
  onProgress?: (progress: EngineDownloadProgress) => void
  signal?: AbortSignal
}

/** Progress is throttled so a fast link cannot flood the renderer with events. */
const REPORT_INTERVAL_MS = 120

/**
 * Stream a URL to disk while hashing it.
 *
 * Hashing as the bytes arrive means the file never has to be read a second time,
 * and a corrupt transfer is detected before extraction starts.
 */
async function downloadAndHash(
  url: string,
  filePath: string,
  options: EngineDownloadOptions
): Promise<string> {
  const response = await fetch(url, { signal: options.signal, redirect: 'follow' })
  if (!response.ok) throw new Error('下载失败：HTTP ' + response.status)
  if (!response.body) throw new Error('下载失败：响应为空')

  const totalHeader = response.headers.get('content-length')
  const totalBytes = totalHeader ? Number(totalHeader) : options.bytes

  const hash = createHash('sha256')
  let received = 0
  let lastReport = 0

  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  source.on('data', (chunk: Buffer) => {
    hash.update(chunk)
    received += chunk.length
    const now = Date.now()
    if (now - lastReport < REPORT_INTERVAL_MS) return
    lastReport = now
    options.onProgress?.({
      stage: 'downloading',
      receivedBytes: received,
      totalBytes,
      ratio: totalBytes > 0 ? Math.min(1, received / totalBytes) : -1,
      message: '正在下载兼容引擎'
    })
  })

  mkdirSync(join(filePath, '..'), { recursive: true })
  await pipeline(source, createWriteStream(filePath))

  options.onProgress?.({
    stage: 'verifying',
    receivedBytes: received,
    totalBytes,
    ratio: 1,
    message: '正在校验文件完整性'
  })

  return hash.digest('hex')
}

/** Extract a zip with the tar.exe that ships with Windows 10 and 11. */
async function extractZip(zipPath: string, destDir: string, signal?: AbortSignal): Promise<void> {
  mkdirSync(destDir, { recursive: true })
  await new Promise<void>((resolve, reject) => {
    // bsdtar reads zip archives and is far faster than Expand-Archive.
    const child = spawn('tar.exe', ['-xf', zipPath, '-C', destDir], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })

    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    const onAbort = (): void => {
      child.kill()
      reject(new Error('已取消'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    child.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.on('exit', (code) => {
      signal?.removeEventListener('abort', onAbort)
      if (code === 0) resolve()
      else reject(new Error('解压失败：' + (stderr.trim() || 'tar 退出码 ' + code)))
    })
  })
}

/**
 * Find the directory that actually holds soffice.
 *
 * Release archives differ in whether they wrap the engine in a top folder, so the
 * extracted tree is inspected instead of assumed.
 */
function findEngineRoot(dir: string, depth = 0): string | null {
  if (depth > 3) return null
  for (const name of ['soffice.com', 'soffice.exe']) {
    if (existsSync(join(dir, name))) return dir
  }
  if (!existsSync(dir)) return null
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const found = findEngineRoot(join(dir, entry.name), depth + 1)
    if (found) return found
  }
  return null
}

/**
 * Download, verify and install the engine.
 *
 * The engine is unpacked into a staging directory and only moved into place once
 * extraction succeeded, so a failed download can never leave a half-installed
 * engine that later looks valid.
 */
export async function downloadEngine(options: EngineDownloadOptions): Promise<void> {
  const zipPath = join(options.workDir, 'engine-download.zip')
  const stagingDir = join(options.workDir, 'staging')

  try {
    mkdirSync(options.workDir, { recursive: true })
    rmSync(zipPath, { force: true })
    rmSync(stagingDir, { recursive: true, force: true })

    const digest = await downloadAndHash(options.url, zipPath, options)
    if (options.sha256 && digest.toLowerCase() !== options.sha256.toLowerCase()) {
      rmSync(zipPath, { force: true })
      throw new Error('引擎文件校验失败，已删除下载内容')
    }

    const size = statSync(zipPath).size
    if (options.bytes > 0 && Math.abs(size - options.bytes) > 1024) {
      rmSync(zipPath, { force: true })
      throw new Error('引擎文件大小不符，已删除下载内容')
    }

    options.onProgress?.({
      stage: 'extracting',
      receivedBytes: size,
      totalBytes: size,
      ratio: 1,
      message: '正在解压兼容引擎'
    })

    await extractZip(zipPath, stagingDir, options.signal)

    const root = findEngineRoot(stagingDir)
    if (!root) throw new Error('解压后未找到 soffice')

    rmSync(options.targetDir, { recursive: true, force: true })
    mkdirSync(join(options.targetDir, '..'), { recursive: true })
    renameSync(root, options.targetDir)

    rmSync(zipPath, { force: true })
    rmSync(stagingDir, { recursive: true, force: true })

    options.onProgress?.({
      stage: 'done',
      receivedBytes: size,
      totalBytes: size,
      ratio: 1,
      message: '兼容引擎已就绪'
    })
    log.info('engine downloaded', { targetDir: options.targetDir, bytes: size })
  } catch (err) {
    rmSync(zipPath, { force: true })
    rmSync(stagingDir, { recursive: true, force: true })
    const message = err instanceof Error ? err.message : String(err)
    options.onProgress?.({
      stage: 'error',
      receivedBytes: 0,
      totalBytes: options.bytes,
      ratio: 0,
      message
    })
    log.warn('engine download failed', message)
    throw err
  }
}

/** True when a usable engine already sits in the download directory. */
export function hasDownloadedEngine(dir: string): boolean {
  return findEngineRoot(dir) !== null
}
