// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import PptxGenJS from 'pptxgenjs'
import { openZipVfs } from '../helpers/zip-vfs'
import { buildPresentationIndex } from '../helpers/index-parse'

/**
 * Opening a PPTX must be size independent: the index reads the tail and the
 * central directory only, so a deck with a lot of media costs the same as a small
 * one. These assertions are loose enough not to flake on a loaded CI box but tight
 * enough to catch a regression to "read the whole file".
 */
describe('native open cost', () => {
  // /tmp is a small tmpfs here and this fixture is deliberately large.
  const scratch = join(process.cwd(), '.cache', 'test-scratch')
  mkdirSync(scratch, { recursive: true })
  const dir = mkdtempSync(join(scratch, 'pptx-bench-'))
  const smallPath = join(dir, 'small.pptx')
  const bigPath = join(dir, 'big.pptx')

  async function build(path: string, slides: number, imageBytes: number): Promise<void> {
    const pptx = new PptxGenJS()
    pptx.layout = 'LAYOUT_16x9'
    // A large image dominates the archive size, standing in for embedded media.
    const filler = Buffer.alloc(imageBytes, 7)
    const b64 = 'image/png;base64,' + filler.toString('base64')
    for (let i = 0; i < slides; i++) {
      const slide = pptx.addSlide()
      slide.addText('Slide ' + (i + 1), { x: 1, y: 1, w: 8, h: 1, fontSize: 28 })
      if (imageBytes > 0) slide.addImage({ data: b64, x: 0.5, y: 4, w: 1, h: 1 })
    }
    writeFileSync(path, (await pptx.write({ outputType: 'nodebuffer' })) as Buffer)
  }

  it('indexes a small deck and a media-heavy deck at comparable cost', async () => {
    await build(smallPath, 2, 0)
    await build(bigPath, 2, 3 * 1024 * 1024)

    // Warm both once so the measurement is not dominated by first-touch I/O.
    for (const path of [smallPath, bigPath]) {
      const warm = openZipVfs(path)
      buildPresentationIndex(warm)
      warm.close()
    }

    const time = (path: string): number => {
      const start = performance.now()
      const vfs = openZipVfs(path)
      const index = buildPresentationIndex(vfs)
      vfs.close()
      expect(index).not.toBeNull()
      return performance.now() - start
    }

    const smallMs = Math.min(...Array.from({ length: 5 }, () => time(smallPath)))
    const bigMs = Math.min(...Array.from({ length: 5 }, () => time(bigPath)))

    // The big deck is orders of magnitude larger, so reading it whole would show up
    // as a large ratio. Indexing must stay close to constant.
    expect(bigMs).toBeLessThan(Math.max(120, smallMs * 12))
  })

  it('reads only the tail of a large archive', async () => {
    const vfs = openZipVfs(bigPath)
    // The presentation part is tiny; fetching it must not depend on archive size.
    const start = performance.now()
    const xml = vfs.readText('ppt/presentation.xml')
    const elapsed = performance.now() - start
    vfs.close()

    expect(xml).toContain('<p:presentation')
    expect(elapsed).toBeLessThan(100)
  })

  it('cleanup', () => {
    rmSync(dir, { recursive: true, force: true })
    expect(true).toBe(true)
  })
})
