import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { DeckCache, cacheKey } from '../../src/main/convert/cache'

const scratchRoot = join(process.cwd(), '.cache', 'test-scratch')

function tempRoot(): string {
  return mkdtempSync(join(scratchRoot, 'ppt-cache-test-'))
}

const base = {
  sourcePath: 'C:/deck.pptx',
  sourceBytes: 1024,
  sourceMtimeMs: 1700000000000,
  engine: 'libreoffice:bundled',
  enginePath: 'C:/app/resources/lo/program/soffice.com',
  appVersion: '0.1.0'
}

describe('cacheKey', () => {
  it('is stable for identical inputs', () => {
    expect(cacheKey(base)).toBe(cacheKey({ ...base }))
  })

  it('changes when the source or engine changes', () => {
    expect(cacheKey({ ...base, sourceMtimeMs: base.sourceMtimeMs + 1 })).not.toBe(cacheKey(base))
    expect(cacheKey({ ...base, appVersion: '0.2.0' })).not.toBe(cacheKey(base))
    expect(cacheKey({ ...base, enginePath: 'D:/other/soffice.com' })).not.toBe(cacheKey(base))
  })

  it('produces a short hex identifier', () => {
    expect(cacheKey(base)).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('DeckCache', () => {
  it('misses on an empty cache', () => {
    const cache = new DeckCache(tempRoot())
    expect(cache.lookup('0000000000000000')).toBeNull()
  })

  it('hits after a store', () => {
    const cache = new DeckCache(tempRoot())
    const key = cacheKey(base)
    const dir = cache.dirFor(key)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'deck.pdf'), Buffer.alloc(4096, 1))
    cache.store(key, {
      sourcePath: base.sourcePath,
      sourceBytes: base.sourceBytes,
      sourceMtimeMs: base.sourceMtimeMs,
      engine: base.engine,
      enginePath: base.enginePath,
      appVersion: base.appVersion,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      pageCount: 3
    })
    const hit = cache.lookup(key)
    expect(hit).not.toBeNull()
    expect(hit?.meta.pageCount).toBe(3)
  })

  // A missing page count used to discard the entry, which threw away a perfectly
  // good conversion whenever the app closed before the renderer reported metrics.
  it('keeps a usable entry even when the page count is not known yet', () => {
    const cache = new DeckCache(tempRoot())
    const key = cacheKey(base)
    const dir = cache.dirFor(key)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'deck.pdf'), Buffer.alloc(4096, 1))
    cache.store(key, {
      sourcePath: base.sourcePath,
      sourceBytes: base.sourceBytes,
      sourceMtimeMs: base.sourceMtimeMs,
      engine: base.engine,
      enginePath: base.enginePath,
      appVersion: base.appVersion,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      pageCount: 0
    })
    expect(cache.lookup(key)).not.toBeNull()
  })

  it('ignores an entry explicitly marked incomplete', () => {
    const cache = new DeckCache(tempRoot())
    const key = cacheKey(base)
    const dir = cache.dirFor(key)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'deck.pdf'), Buffer.alloc(4096, 1))
    cache.store(key, {
      sourcePath: base.sourcePath,
      sourceBytes: base.sourceBytes,
      sourceMtimeMs: base.sourceMtimeMs,
      engine: base.engine,
      enginePath: base.enginePath,
      appVersion: base.appVersion,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      pageCount: 0,
      status: 'partial'
    })
    expect(cache.lookup(key)).toBeNull()
  })

  it('prunes least recently used entries', () => {
    const cache = new DeckCache(tempRoot())
    for (let i = 0; i < 3; i++) {
      const key = cacheKey({ ...base, sourcePath: 'C:/deck' + i + '.pptx' })
      const dir = cache.dirFor(key)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'deck.pdf'), Buffer.alloc(2048, 1))
      cache.store(key, {
        sourcePath: base.sourcePath,
        sourceBytes: base.sourceBytes,
        sourceMtimeMs: base.sourceMtimeMs,
        engine: base.engine,
        enginePath: base.enginePath,
        appVersion: base.appVersion,
        createdAt: Date.now(),
        lastUsedAt: i === 0 ? 1 : Date.now() + i,
        pageCount: 2
      })
    }
    const removed = cache.prune(4096)
    expect(removed).toBeGreaterThan(0)
  })

  it('clears everything', () => {
    const root = tempRoot()
    const cache = new DeckCache(root)
    const key = cacheKey(base)
    const dir = cache.dirFor(key)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'deck.pdf'), Buffer.alloc(2048, 1))
    cache.clearAll()
    expect(existsSync(dir)).toBe(false)
  })
})
