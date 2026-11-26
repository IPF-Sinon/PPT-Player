import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { bufferSource, fileSource } from '../../src/main/convert/byte-source'
import { detectFormat } from '../../src/main/convert/detect'
import { listZipEntries, readZipEntry, readStoredEntry } from '../../src/main/convert/zip-reader'
import { countPdfPages } from '../../src/main/convert/pipeline'

/**
 * Scratch space for the oversized fixtures.
 *
 * These files are ~70 MB each and the default temp directory is a small tmpfs, so
 * the scratch root lives beside the repository where there is real disk.
 */
const scratchRoot = join(process.cwd(), '.cache', 'test-scratch')
mkdirSync(scratchRoot, { recursive: true })

afterAll(() => {
  rmSync(scratchRoot, { recursive: true, force: true })
})

function tmpFile(name: string, bytes: Buffer): string {
  const dir = mkdtempSync(join(scratchRoot, 'big-'))
  const file = join(dir, name)
  writeFileSync(file, bytes)
  return file
}

function pptxBytes(paddingBytes = 0): Buffer {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<Types/>'),
    'ppt/presentation.xml': strToU8('<p:presentation/>'),
    '_rels/.rels': strToU8('<Relationships/>')
  }
  // A large stored entry pushes the central directory well past the first 8 MB.
  if (paddingBytes > 0) entries['ppt/media/big.bin'] = new Uint8Array(paddingBytes)
  return Buffer.from(zipSync(entries, { level: 0 }))
}

describe('byte-source', () => {
  it('reads exact ranges from a buffer', () => {
    const source = bufferSource(Buffer.from('abcdefghij'))
    expect(source.size).toBe(10)
    expect(source.read(2, 3).toString()).toBe('cde')
    expect(source.read(8, 10).toString()).toBe('ij')
    expect(source.read(20, 4).length).toBe(0)
  })

  it('reads exact ranges from a file', () => {
    const file = tmpFile('data.bin', Buffer.from('0123456789'))
    const source = fileSource(file)
    try {
      expect(source.size).toBe(10)
      expect(source.read(0, 4).toString()).toBe('0123')
      expect(source.read(6, 100).toString()).toBe('6789')
    } finally {
      source.close()
    }
  })
})

describe('large file detection', () => {
  // This is the regression that made every deck over 64 MB fail as corrupt-zip:
  // detection truncated the file to its first 8 MB, so the end-of-central-directory
  // record at the tail was never found.
  // Building a 70 MB fixture dominates the runtime, especially under coverage
  // instrumentation, so these two get their own budget.
  it('classifies a deck larger than 64 MB from its real tail', { timeout: 60_000 }, () => {
    const bytes = pptxBytes(70 * 1024 * 1024)
    expect(bytes.length).toBeGreaterThan(64 * 1024 * 1024)

    const source = bufferSource(bytes)
    const info = detectFormat(source, 'pptx')
    expect(info.kind).toBe('ooxml-presentation')
    expect(info.reason).toBeUndefined()
  })

  it('reads the central directory of a large file from disk', { timeout: 60_000 }, () => {
    const file = tmpFile('big.pptx', pptxBytes(70 * 1024 * 1024))
    const source = fileSource(file)
    try {
      const names = listZipEntries(source).map((e) => e.name)
      expect(names).toContain('ppt/presentation.xml')
      expect(names).toContain('ppt/media/big.bin')
    } finally {
      source.close()
    }
  })
})

describe('deflated entry reading', () => {
  it('inflates a compressed entry without fflate', () => {
    const bytes = Buffer.from(
      zipSync({ 'mimetype': strToU8('application/vnd.oasis.opendocument.presentation') }, { level: 9 })
    )
    const payload = readZipEntry(bufferSource(bytes), 'mimetype')
    expect(payload?.toString('utf8')).toBe('application/vnd.oasis.opendocument.presentation')
  })

  it('reads a stored entry', () => {
    const bytes = Buffer.from(zipSync({ mimetype: strToU8('text/plain') }, { level: 0 }))
    expect(readStoredEntry(bufferSource(bytes), 'mimetype')?.toString()).toBe('text/plain')
  })

  it('returns null for a missing entry', () => {
    const bytes = Buffer.from(zipSync({ 'a.txt': strToU8('x') }))
    expect(readZipEntry(bufferSource(bytes), 'nope')).toBeNull()
  })
})

describe('countPdfPages', () => {
  function pdf(pages: number): Buffer {
    const objs: string[] = []
    const kids: string[] = []
    for (let i = 0; i < pages; i++) {
      const pageObj = 3 + i * 2
      kids.push(`${pageObj} 0 R`)
      objs[pageObj] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>`
    }
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>'
    objs[2] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`
    let out = '%PDF-1.7\n'
    for (let i = 1; i < objs.length; i++) {
      if (objs[i]) out += `${i} 0 obj\n${objs[i]}\nendobj\n`
    }
    return Buffer.from(out + '%%EOF\n', 'latin1')
  }

  it('counts page objects', () => {
    expect(countPdfPages(tmpFile('one.pdf', pdf(1)))).toBe(1)
    expect(countPdfPages(tmpFile('three.pdf', pdf(3)))).toBe(3)
  })

  it('returns zero for an unreadable file', () => {
    expect(countPdfPages(join(tmpdir(), 'missing-xyz.pdf'))).toBe(0)
  })
})
