import { describe, expect, it } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import { listZipEntries, looksLikeZip, readStoredEntry } from '../../src/main/convert/zip-reader'

describe('zip-reader', () => {
  it('recognises zip signatures', () => {
    const buf = Buffer.from(zipSync({ 'a.txt': strToU8('hello') }))
    expect(looksLikeZip(buf)).toBe(true)
    expect(looksLikeZip(Buffer.from([0, 1, 2, 3]))).toBe(false)
    expect(looksLikeZip(Buffer.alloc(0))).toBe(false)
  })

  it('lists entry names and sizes', () => {
    const buf = Buffer.from(
      zipSync({
        'mimetype': strToU8('application/vnd.oasis.opendocument.presentation'),
        'content.xml': strToU8('<x/>'),
        'ppt/presentation.xml': strToU8('<p/>')
      })
    )
    const names = listZipEntries(buf).map((e) => e.name)
    expect(names).toContain('content.xml')
    expect(names).toContain('ppt/presentation.xml')
    expect(names.length).toBe(3)
  })

  it('returns an empty list for non-zip buffers', () => {
    expect(listZipEntries(Buffer.from('nope'))).toEqual([])
  })

  it('reads a stored entry payload', () => {
    const buf = Buffer.from(zipSync({ mimetype: strToU8('text/plain') }, { level: 0 }))
    const payload = readStoredEntry(buf, 'mimetype')
    expect(payload?.toString('utf8')).toBe('text/plain')
  })

  it('refuses deflated entries', () => {
    const buf = Buffer.from(zipSync({ mimetype: strToU8('text/plain') }, { level: 9 }))
    expect(readStoredEntry(buf, 'mimetype')).toBeNull()
  })

  it('returns null for a missing entry', () => {
    const buf = Buffer.from(zipSync({ 'a.txt': strToU8('x') }))
    expect(readStoredEntry(buf, 'missing')).toBeNull()
  })
})
