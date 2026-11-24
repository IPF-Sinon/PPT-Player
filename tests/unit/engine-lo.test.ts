import { describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { collectPdf, sofficeInProgramDir, toFileUrl } from '../../src/main/convert/engine-lo'

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'lo-out-'))
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
    const result = collectPdf(dir)
    expect(result).toBe(join(dir, 'deck.pdf'))
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
    expect(collectPdf(join(tmpdir(), 'no-such-dir-xyz'))).toBe('')
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
