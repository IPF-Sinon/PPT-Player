import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { strToU8, zipSync } from 'fflate'
import { openDeck, probeFile, reportDeckMetrics, type ConvertContext } from '../../src/main/convert/pipeline'
import { AppError } from '../../src/shared/errors'
import type { EngineStatus } from '../../src/shared/types'

const scratchRoot = join(process.cwd(), '.cache', 'test-scratch')
// Git-ignored, so it does not exist on a fresh checkout.
mkdirSync(scratchRoot, { recursive: true })

const noEngine: EngineStatus = {
  available: false,
  id: 'none',
  path: '',
  version: '',
  origin: 'none',
  detail: 'missing'
}

function ctxWith(engine: EngineStatus): ConvertContext {
  return {
    cacheRoot: mkdtempSync(join(scratchRoot, 'ppt-cache-')),
    profileRoot: mkdtempSync(join(scratchRoot, 'ppt-lo-')),
    appVersion: '0.1.0',
    engine: () => engine
  }
}

function tmpDeck(name: string, content: Buffer): string {
  const dir = mkdtempSync(join(scratchRoot, 'ppt-player-test-'))
  const file = join(dir, name)
  writeFileSync(file, content)
  return file
}

function pptx(): Buffer {
  return Buffer.from(
    zipSync({
      '[Content_Types].xml': strToU8('<Types/>'),
      'ppt/presentation.xml': strToU8('<p:presentation/>')
    })
  )
}

describe('probeFile', () => {
  it('reports a valid pptx', () => {
    const probe = probeFile(tmpDeck('ok.pptx', pptx()))
    expect(probe.format.kind).toBe('ooxml-presentation')
    expect(probe.bytes).toBeGreaterThan(0)
  })

  // Probing is synchronous by design: it reads a few kilobytes of header and ZIP
  // tail, so there is nothing to await and no round trip to schedule.
  it('rejects an empty file', () => {
    const file = tmpDeck('empty.pptx', Buffer.alloc(0))
    expect(() => probeFile(file)).toThrow(AppError)
    expect(() => probeFile(file)).toThrow(expect.objectContaining({ code: 'EEMPTY' }) as never)
  })

  it('rejects a missing file', () => {
    expect(() => probeFile(join(scratchRoot, 'definitely-missing-xyz.pptx'))).toThrow(
      expect.objectContaining({ code: 'ENOENT' }) as never
    )
  })

  it('rejects a non-presentation file', () => {
    const file = tmpDeck('notes.pptx', Buffer.from('plain text, not a deck'))
    expect(() => probeFile(file)).toThrow(expect.objectContaining({ code: 'EUNSUPPORTED' }) as never)
  })

  it('rejects an encrypted container', () => {
    const file = tmpDeck('secret.pptx', pptx())
    const probe = probeFile(file)
    expect(probe.format.encrypted).toBe(false)
  })
})

describe('openDeck', () => {
  it('fails cleanly when no engine is available', async () => {
    const file = tmpDeck('deck.pptx', pptx())
    const result = await openDeck(ctxWith(noEngine), file)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('ENOENGINE')
  })

  it('passes a PDF through without an engine', async () => {
    const pdfBytes = Buffer.concat([
      Buffer.from('%PDF-1.7\n', 'latin1'),
      Buffer.alloc(2048, 0x20),
      Buffer.from('\n%%EOF', 'latin1')
    ])
    const file = tmpDeck('deck.pdf', pdfBytes)
    const ctx = ctxWith(noEngine)
    const result = await openDeck(ctx, file)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.info.format.kind).toBe('pdf')
      expect(result.info.engine).toBe('none')
      expect(result.info.cached).toBe(false)
    }
  })

  it('reuses the cache on a second open of the same PDF', async () => {
    const pdfBytes = Buffer.concat([
      Buffer.from('%PDF-1.7\n', 'latin1'),
      Buffer.alloc(2048, 0x20),
      Buffer.from('\n%%EOF', 'latin1')
    ])
    const file = tmpDeck('repeat.pdf', pdfBytes)
    const ctx = ctxWith(noEngine)
    const first = await openDeck(ctx, file)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    reportDeckMetrics(ctx, first.info.deckId, 4, [
      { width: 960, height: 540 },
      { width: 960, height: 540 }
    ])
    const second = await openDeck(ctx, file)
    expect(second.ok).toBe(true)
    if (second.ok) {
      expect(second.info.cached).toBe(true)
      expect(second.info.pageCount).toBe(4)
    }
  })

  it('notifies the caller about a successful open', async () => {
    const pdfBytes = Buffer.concat([
      Buffer.from('%PDF-1.7\n', 'latin1'),
      Buffer.alloc(2048, 0x20),
      Buffer.from('\n%%EOF', 'latin1')
    ])
    const file = tmpDeck('notify.pdf', pdfBytes)
    const seen: string[] = []
    const ctx: ConvertContext = {
      cacheRoot: mkdtempSync(join(scratchRoot, 'ppt-cache-')),
    profileRoot: mkdtempSync(join(scratchRoot, 'ppt-lo-')),
      appVersion: '0.1.0',
      engine: () => noEngine,
      onOpened: (path) => seen.push(path)
    }
    await openDeck(ctx, file)
    expect(seen).toEqual([file])
  })

  it('returns an error payload for a missing file', async () => {
    const result = await openDeck(ctxWith(noEngine), join(scratchRoot, 'nope-missing.pptx'))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('ENOENT')
  })
})

describe('reportDeckMetrics', () => {
  it('flags mixed aspect ratios', async () => {
    const pdfBytes = Buffer.concat([
      Buffer.from('%PDF-1.7\n', 'latin1'),
      Buffer.alloc(2048, 0x20),
      Buffer.from('\n%%EOF', 'latin1')
    ])
    const ctx = ctxWith(noEngine)
    const opened = await openDeck(ctx, tmpDeck('mixed.pdf', pdfBytes))
    expect(opened.ok).toBe(true)
    if (!opened.ok) return
    const info = reportDeckMetrics(ctx, opened.info.deckId, 2, [
      { width: 960, height: 540 },
      { width: 800, height: 600 }
    ])
    expect(info?.mixedAspect).toBe(true)
  })

  it('ignores unknown deck ids', () => {
    const ctx = ctxWith(noEngine)
    expect(reportDeckMetrics(ctx, 'ffffffffffff', 1, [{ width: 1, height: 1 }])).toBeNull()
  })
})
