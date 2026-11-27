import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildConvertArgs,
  collectPdf,
  pickProfileDir,
  sofficeInProgramDir,
  toFileUrl
} from '../../src/main/convert/engine-lo'

const scratchRoot = join(process.cwd(), '.cache', 'test-scratch')

function tempDir(): string {
  return mkdtempSync(join(scratchRoot, 'lo-out-'))
}

describe('collectPdf', () => {
  it('returns an existing deck.pdf untouched', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'deck.pdf'), Buffer.alloc(4096, 1))
    expect(collectPdf(dir)).toBe(join(dir, 'deck.pdf'))
  })

  it('renames a source-named PDF to deck.pdf', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'deck-16x9.pdf'), Buffer.alloc(4096, 1))
    expect(collectPdf(dir)).toBe(join(dir, 'deck.pdf'))
    expect(readdirSync(dir)).toContain('deck.pdf')
  })

  it('replaces a stale deck.pdf with the fresh output', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'deck.pdf'), Buffer.alloc(64, 1))
    writeFileSync(join(dir, 'fresh.pdf'), Buffer.alloc(8192, 2))
    expect(collectPdf(dir)).toBe(join(dir, 'deck.pdf'))
  })

  it('ignores tiny PDFs', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'broken.pdf'), Buffer.alloc(10, 1))
    expect(collectPdf(dir)).toBe('')
  })

  it('returns an empty string when there is no PDF', () => {
    expect(collectPdf(tempDir())).toBe('')
  })

  it('returns an empty string for a missing directory', () => {
    expect(collectPdf(join(scratchRoot, 'no-such-dir-xyz'))).toBe('')
  })
})

describe('sofficeInProgramDir', () => {
  it('finds soffice.com', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'soffice.com'), '')
    expect(sofficeInProgramDir(dir)).toBe(join(dir, 'soffice.com'))
  })

  it('falls back to soffice.exe', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'soffice.exe'), '')
    expect(sofficeInProgramDir(dir)).toBe(join(dir, 'soffice.exe'))
  })

  it('returns null when nothing is there', () => {
    expect(sofficeInProgramDir(tempDir())).toBeNull()
  })
})

describe('toFileUrl', () => {
  it('converts a Windows path', () => {
    expect(toFileUrl('C:\\tmp\\lo profile')).toBe('file:///C:/tmp/lo%20profile')
  })

  it('keeps forward slashes intact', () => {
    expect(toFileUrl('/tmp/lo')).toBe('file:///tmp/lo')
  })

  it('escapes hash characters', () => {
    expect(toFileUrl('C:\\a#b')).toBe('file:///C:/a%23b')
  })
})

describe('pickProfileDir', () => {
  // Reusing the profile is what removes the cold configuration rebuild that made
  // the first conversion of a session so slow.
  it('creates the root and returns a slot directory', () => {
    const root = join(tempDir(), 'lo-profile')
    const dir = pickProfileDir(root)
    expect(existsSync(dir)).toBe(true)
    expect(dir.startsWith(root)).toBe(true)
  })

  it('hands out distinct slots when one is locked', () => {
    const root = join(tempDir(), 'lo-profile')
    const first = pickProfileDir(root)
    // Simulate a conversion in progress holding the slot.
    writeFileSync(join(first, '.lock'), '')

    const second = pickProfileDir(root)
    expect(second).not.toBe(first)
    expect(existsSync(second)).toBe(true)
  })

  it('falls back to an extra slot when every slot is busy', () => {
    const root = join(tempDir(), 'lo-profile')
    const seen: string[] = []
    for (let i = 0; i < 5; i++) {
      const dir = pickProfileDir(root)
      writeFileSync(join(dir, '.lock'), '')
      seen.push(dir)
    }
    expect(new Set(seen).size).toBe(5)
  })
})

describe('buildConvertArgs', () => {
  it('pins the flags a headless conversion needs', () => {
    const args = buildConvertArgs({
      profileDir: 'C:\\tmp\\lo profile',
      outDir: 'C:\\out',
      sourcePath: 'C:\\deck.pptx'
    })
    expect(args).toContain('--headless')
    expect(args).toContain('--norestore')
    expect(args).toContain('--invisible')
    expect(args).toContain('--nologo')
    // Without these LibreOffice can open a first-start wizard and never return.
    expect(args).toContain('--nodefault')
    expect(args).toContain('--nofirststartwizard')
    expect(args).toContain('--nolockcheck')
    expect(args).toContain('pdf:impress_pdf_Export')
    expect(args.some((a) => a.startsWith('-env:UserInstallation=file:///'))).toBe(true)
  })

  it('puts the output directory and source last', () => {
    const args = buildConvertArgs({ profileDir: '/tmp/p', outDir: '/out', sourcePath: '/deck.pptx' })
    expect(args[args.length - 3]).toBe('--outdir')
    expect(args[args.length - 2]).toBe('/out')
    expect(args[args.length - 1]).toBe('/deck.pptx')
  })
})

describe('runLibreOffice', () => {
  it('reports a failure when the binary does not exist', async () => {
    const { runLibreOffice } = await import('../../src/main/convert/engine-lo')
    const result = await runLibreOffice({
      sourcePath: '/nope.pptx',
      outDir: tempDir(),
      profileRoot: join(tempDir(), 'profiles'),
      timeoutMs: 1000,
      sofficePath: join(tempDir(), 'definitely-not-soffice')
    })
    expect(result.ok).toBe(false)
    expect(result.pdfPath).toBe('')
    expect(result.aborted).toBe(false)
  })

  it('releases the profile slot after a failed run', async () => {
    const { runLibreOffice } = await import('../../src/main/convert/engine-lo')
    const profileRoot = join(tempDir(), 'profiles')
    await runLibreOffice({
      sourcePath: '/nope.pptx',
      outDir: tempDir(),
      profileRoot,
      timeoutMs: 1000,
      sofficePath: join(tempDir(), 'missing-binary')
    })
    // A slot left locked would make every later conversion allocate a new profile.
    const slots = readdirSync(profileRoot).filter((name) => name.startsWith('slot-'))
    for (const slot of slots) {
      expect(existsSync(join(profileRoot, slot, '.lock'))).toBe(false)
    }
  })

  it('honours an already-aborted signal', async () => {
    const { runLibreOffice } = await import('../../src/main/convert/engine-lo')
    const controller = new AbortController()
    controller.abort()
    const result = await runLibreOffice({
      sourcePath: '/nope.pptx',
      outDir: tempDir(),
      profileRoot: join(tempDir(), 'profiles'),
      timeoutMs: 5000,
      sofficePath: join(tempDir(), 'missing-binary'),
      signal: controller.signal
    })
    expect(result.ok).toBe(false)
  })
})
