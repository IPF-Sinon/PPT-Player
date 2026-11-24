import { describe, expect, it } from 'vitest'
import CFB from 'cfb'
import { hasStream, listCfbEntries, looksLikeCfb } from '../../src/main/convert/cfb-reader'

function cfbWith(streams: Record<string, string>): Buffer {
  const container = CFB.utils.cfb_new()
  for (const [name, content] of Object.entries(streams)) {
    CFB.utils.cfb_add(container, name, Buffer.from(content, 'utf8'))
  }
  return Buffer.from(CFB.write(container, { type: 'buffer' }))
}

describe('cfb-reader', () => {
  it('recognises the compound file signature', () => {
    const buf = cfbWith({ 'PowerPoint Document': 'x' })
    expect(looksLikeCfb(buf)).toBe(true)
    expect(looksLikeCfb(Buffer.from('PK\x03\x04'))).toBe(false)
  })

  it('lists directory entries', () => {
    const entries = listCfbEntries(cfbWith({ 'PowerPoint Document': 'x', Second: 'y' }))
    const names = entries.map((e) => e.name)
    expect(names).toContain('PowerPoint Document')
    expect(names).toContain('Second')
  })

  it('finds streams case-insensitively', () => {
    const entries = listCfbEntries(cfbWith({ 'PowerPoint Document': 'x' }))
    expect(hasStream(entries, 'powerpoint document')).toBe(true)
    expect(hasStream(entries, 'WordDocument')).toBe(false)
  })

  it('returns an empty list for non-cfb buffers', () => {
    expect(listCfbEntries(Buffer.from('nope'))).toEqual([])
  })
})
