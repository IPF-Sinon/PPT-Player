import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import CFB from 'cfb'
import { detectFormat, ODP_MIME } from '../../src/main/convert/detect'
import { MAX_SOURCE_BYTES, extensionOf, isSupportedExtension } from '../../src/shared/formats'

function zipOf(files: Record<string, string>): Buffer {
  const entries: Record<string, Uint8Array> = {}
  for (const [name, value] of Object.entries(files)) entries[name] = strToU8(value)
  return Buffer.from(zipSync(entries))
}

function pptxBuffer(): Buffer {
  return zipOf({
    '[Content_Types].xml': '<Types/>',
    'ppt/presentation.xml': '<p:presentation/>',
    '_rels/.rels': '<Relationships/>'
  })
}

function odpBuffer(mime = ODP_MIME): Buffer {
  return zipOf({ mimetype: mime, 'content.xml': '<office:document-content/>' })
}

function cfbBuffer(streams: Record<string, string>): Buffer {
  const container = CFB.utils.cfb_new()
  for (const [name, content] of Object.entries(streams)) {
    CFB.utils.cfb_add(container, name, strToU8(content))
  }
  return Buffer.from(CFB.write(container, { type: 'buffer' }))
}

describe('detectFormat', () => {
  it('detects an OOXML presentation by content, not extension', () => {
    const info = detectFormat(pptxBuffer(), 'pptx')
    expect(info.kind).toBe('ooxml-presentation')
    expect(info.container).toBe('zip')
    expect(info.encrypted).toBe(false)
    expect(info.extMismatch).toBe(false)
    expect(info.label).toBe('PPTX')
  })

  it('flags an extension mismatch when a pptx is named .ppt', () => {
    const info = detectFormat(pptxBuffer(), 'ppt')
    expect(info.kind).toBe('ooxml-presentation')
    expect(info.extMismatch).toBe(true)
  })

  it('detects an ODP file', () => {
    const info = detectFormat(odpBuffer(), 'odp')
    expect(info.kind).toBe('odp')
    expect(info.label).toBe('ODP')
  })

  it('does not treat a generic zip with a mimetype entry as ODP', () => {
    const buf = zipOf({ mimetype: 'text/plain', 'content.xml': '<x/>' })
    expect(detectFormat(buf, 'zip').kind).toBe('unsupported')
  })

  it('detects a legacy binary presentation', () => {
    const info = detectFormat(cfbBuffer({ 'PowerPoint Document': 'x' }), 'ppt')
    expect(info.kind).toBe('legacy-ppt')
    expect(info.container).toBe('cfb')
  })

  it('detects an encrypted OOXML container', () => {
    const info = detectFormat(cfbBuffer({ EncryptionInfo: 'x', EncryptedPackage: 'y' }), 'pptx')
    expect(info.kind).toBe('encrypted-ooxml')
    expect(info.encrypted).toBe(true)
  })

  it('rejects a Word document', () => {
    const info = detectFormat(cfbBuffer({ WordDocument: 'x' }), 'doc')
    expect(info.kind).toBe('unsupported')
    expect(info.reason).toBe('not-presentation')
  })

  it('rejects a workbook', () => {
    expect(detectFormat(cfbBuffer({ Workbook: 'x' }), 'xls').reason).toBe('not-presentation')
  })

  it('rejects an unknown CFB layout', () => {
    expect(detectFormat(cfbBuffer({ Something: 'x' }), 'bin').reason).toBe('unknown-cfb')
  })

  it('passes PDF through and reports mismatches', () => {
    const buf = Buffer.from('%PDF-1.7\n...', 'latin1')
    const info = detectFormat(buf, 'pdf')
    expect(info.kind).toBe('pdf')
    expect(info.container).toBe('pdf')
    expect(info.extMismatch).toBe(false)
    expect(detectFormat(buf, 'pptx').extMismatch).toBe(true)
  })

  it('rejects empty files', () => {
    expect(detectFormat(Buffer.alloc(0), 'pptx').reason).toBe('empty')
  })

  it('rejects files over the size cap', () => {
    const huge = Buffer.alloc(64)
    const info = detectFormat(huge, 'pptx')
    expect(info.kind).toBe('unsupported')
    expect(MAX_SOURCE_BYTES).toBeGreaterThan(huge.length)
  })

  it('rejects random bytes', () => {
    expect(detectFormat(Buffer.from('not a deck at all'), 'pptx').reason).toBe('unknown-signature')
  })

  it('rejects a zip that is not a presentation', () => {
    const buf = zipOf({ 'word/document.xml': '<w/>' })
    expect(detectFormat(buf, 'docx').reason).toBe('not-presentation')
  })
})

describe('format helpers', () => {
  it('extracts lower-case extensions', () => {
    expect(extensionOf('C:\\a b\\Deck.PPTX')).toBe('pptx')
    expect(extensionOf('/tmp/x.tar.gz')).toBe('gz')
    expect(extensionOf('noext')).toBe('')
    expect(extensionOf('.hidden')).toBe('')
  })

  it('knows the supported extension set', () => {
    expect(isSupportedExtension('pptx')).toBe(true)
    expect(isSupportedExtension('odp')).toBe(true)
    expect(isSupportedExtension('docx')).toBe(false)
  })
})
