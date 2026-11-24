import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectFormat } from '../../src/main/convert/detect'
import { extensionOf } from '../../src/shared/formats'

const fixtures = join(process.cwd(), 'tests', 'fixtures')

describe('generated fixtures', () => {
  it('detects the 16:9 deck as OOXML', () => {
    const buf = readFileSync(join(fixtures, 'deck-16x9.pptx'))
    const info = detectFormat(buf, extensionOf('deck-16x9.pptx'))
    expect(info.kind).toBe('ooxml-presentation')
    expect(info.extMismatch).toBe(false)
  })

  it('detects the 4:3 deck as OOXML', () => {
    const buf = readFileSync(join(fixtures, 'deck-4x3.pptx'))
    expect(detectFormat(buf, 'pptx').kind).toBe('ooxml-presentation')
  })

  it('detects the smoke ODP as ODP', () => {
    const buf = readFileSync(join(fixtures, 'smoke.odp'))
    const info = detectFormat(buf, 'odp')
    expect(info.kind).toBe('odp')
    expect(info.container).toBe('zip')
  })
})
