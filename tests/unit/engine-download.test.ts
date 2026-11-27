import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { downloadEngine, hasDownloadedEngine } from '../../src/main/convert/engine-download'

// /tmp is a small tmpfs in this environment, so scratch lives in the workspace.
const scratchRoot = join(process.cwd(), '.cache', 'test-scratch', 'engine-dl')

let root = ''
let workDir = ''
let targetDir = ''
let server: Server | null = null
let baseUrl = ''
/** Bytes the server serves for /engine.zip. */
let payload: Buffer = Buffer.alloc(0)
/** Status the server answers with, so failure paths can be exercised. */
let status = 200

beforeEach(async () => {
  mkdirSync(scratchRoot, { recursive: true })
  root = mkdtempSync(join(scratchRoot, 'run-'))
  workDir = join(root, 'engine')
  targetDir = join(workDir, 'lo')
  status = 200

  // Node's fetch does not handle file://, so the fixture is served over HTTP.
  server = createServer((_req, res) => {
    res.writeHead(status, {
      'content-type': 'application/zip',
      'content-length': String(payload.length)
    })
    res.end(payload)
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  baseUrl = 'http://127.0.0.1:' + port + '/engine.zip'
})

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = null
  }
  rmSync(root, { recursive: true, force: true })
})

/** Build a zip whose only entry is a fake soffice. */
function makeEngineZip(nested = false): { sha256: string; bytes: number } {
  const entry = nested ? 'LibreOffice/program/soffice.com' : 'program/soffice.com'
  const zip = zipSync({ [entry]: strToU8('fake engine') }, { level: 0 })
  payload = Buffer.from(zip)
  return {
    sha256: createHash('sha256').update(payload).digest('hex'),
    bytes: payload.length
  }
}

describe('hasDownloadedEngine', () => {
  it('is false for a missing directory', () => {
    expect(hasDownloadedEngine(join(root, 'nope'))).toBe(false)
  })

  it('is true once soffice sits in the tree', () => {
    mkdirSync(join(targetDir, 'program'), { recursive: true })
    writeFileSync(join(targetDir, 'program', 'soffice.com'), '')
    expect(hasDownloadedEngine(targetDir)).toBe(true)
  })

  it('finds the engine when an archive wraps it in a folder', () => {
    // Release archives differ in whether they nest the engine one level down.
    const nested = join(targetDir, 'LibreOffice', 'program')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'soffice.exe'), '')
    expect(hasDownloadedEngine(targetDir)).toBe(true)
  })

  it('is false when only unrelated files exist', () => {
    mkdirSync(join(targetDir, 'program'), { recursive: true })
    writeFileSync(join(targetDir, 'program', 'other.txt'), '')
    expect(hasDownloadedEngine(targetDir)).toBe(false)
  })
})

describe('downloadEngine', () => {
  it('rejects a checksum mismatch and leaves nothing behind', async () => {
    const { bytes } = makeEngineZip()

    await expect(
      downloadEngine({ url: baseUrl, sha256: 'ab'.repeat(32), bytes, targetDir, workDir })
    ).rejects.toThrow(/校验失败/)

    // A failed install must not leave a half-extracted engine that later looks valid.
    expect(existsSync(targetDir)).toBe(false)
    expect(existsSync(join(workDir, 'engine-download.zip'))).toBe(false)
  })

  it('rejects a size mismatch even when the checksum matches', async () => {
    const { sha256 } = makeEngineZip()

    await expect(
      downloadEngine({
        url: baseUrl,
        sha256,
        // Wrong by far more than the tolerance.
        bytes: 999_999_999,
        targetDir,
        workDir
      })
    ).rejects.toThrow(/大小不符/)
    expect(existsSync(targetDir)).toBe(false)
  })

  it('reports verifying and then error on a bad checksum', async () => {
    const stages: string[] = []
    const { bytes } = makeEngineZip()

    await downloadEngine({
      url: baseUrl,
      sha256: 'cd'.repeat(32),
      bytes,
      targetDir,
      workDir,
      onProgress: (p) => stages.push(p.stage)
    }).catch(() => undefined)

    expect(stages).toContain('verifying')
    expect(stages).toContain('error')
  })

  // The extractor calls Windows' tar.exe, so a successful install can only be
  // exercised there. The failure paths above run on any platform.
  it.skipIf(process.platform !== 'win32')('installs the engine when the checksum matches', async () => {
    const stages: string[] = []
    const { sha256, bytes } = makeEngineZip()

    await downloadEngine({
      url: baseUrl,
      sha256,
      bytes,
      targetDir,
      workDir,
      onProgress: (p) => stages.push(p.stage)
    })

    expect(stages.indexOf('downloading')).toBeLessThan(stages.indexOf('verifying'))
    expect(stages).toContain('extracting')
    expect(stages).toContain('done')
    // The engine must land where the resolver looks for it.
    expect(hasDownloadedEngine(targetDir)).toBe(true)
    expect(existsSync(join(workDir, 'engine-download.zip'))).toBe(false)
  })

  it('fails with a clear message on a non-200 response', async () => {
    status = 404
    makeEngineZip()

    await expect(
      downloadEngine({
        url: baseUrl,
        sha256: 'ef'.repeat(32),
        bytes: 10,
        targetDir,
        workDir
      })
    ).rejects.toThrow(/HTTP 404/)
  })
})
