// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { openZipVfs, type ZipVfs } from '../helpers/zip-vfs'
import { forgetDocx, preparedDocx, prepareDocx } from '../../src/renderer/src/lib/docx/registry'

/**
 * The whole document pipeline, from the host part reader to laid-out pages.
 *
 * This is the path the app actually takes: fetch word/document.xml and its sibling
 * parts through the injected URL builder, parse them, measure the blocks and split
 * them into pages. jsdom has no layout engine, so every measured height is zero;
 * that is the case the paginator must survive without inventing pages, and it is
 * why the assertions here are about page count and page boxes rather than heights.
 */
const FIXTURE = join(process.cwd(), 'tests', 'fixtures', 'deck-docx.docx')

/** Serve the fixture's entries through a stubbed fetch, the way the shell does. */
function stubFetch(vfs: ZipVfs): () => void {
  const real = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    // The shell serves http://pptx.localhost/<deckId>/<part>, so the part is
    // everything after the deck id.
    const url = String(input)
    const afterHost = url.slice(url.indexOf('//') + 2)
    const segments = afterHost.split('/')
    const part = segments.slice(2).join('/')
    const text = vfs.readText(part)
    return {
      ok: text !== null,
      text: async () => text ?? ''
    } as Response
  }) as typeof fetch
  return () => {
    globalThis.fetch = real
  }
}

describe('preparing a document', () => {
  it('reads every part through the host URL and paginates the result', async () => {
    const vfs = openZipVfs(FIXTURE)
    const restore = stubFetch(vfs)
    try {
      forgetDocx('deck-a')
      const prepared = await prepareDocx('deck-a', {
        pptxUrl: (id, part) => 'http://pptx.localhost/' + id + '/' + part
      })

      expect(prepared).not.toBeNull()
      expect(prepared!.deckId).toBe('deck-a')
      // One authored page break, so two pages of content.
      expect(prepared!.pages).toHaveLength(2)
      expect(prepared!.pageSizes).toHaveLength(2)

      // The first page holds the heading, the body, the lists and the table; the
      // second holds only the text after the break.
      expect(prepared!.pages[0].blocks.length).toBeGreaterThan(4)
      expect(prepared!.pages[1].blocks).toHaveLength(1)
    } finally {
      restore()
      vfs.close()
    }
  })

  it('reports the page box the document was authored on', async () => {
    const vfs = openZipVfs(FIXTURE)
    const restore = stubFetch(vfs)
    try {
      forgetDocx('deck-b')
      const prepared = await prepareDocx('deck-b', {
        pptxUrl: (id, part) => 'http://pptx.localhost/' + id + '/' + part
      })
      // A4 in px, within the rounding of a twip conversion.
      expect(Math.round(prepared!.pageSizes[0].width)).toBe(794)
      expect(Math.round(prepared!.pageSizes[0].height)).toBe(1123)
    } finally {
      restore()
      vfs.close()
    }
  })

  it('parses once, however many components ask', async () => {
    const vfs = openZipVfs(FIXTURE)
    const restore = stubFetch(vfs)
    let fetches = 0
    const realFetch = globalThis.fetch
    globalThis.fetch = ((input: RequestInfo | URL) => {
      fetches++
      return realFetch(input)
    }) as typeof fetch
    try {
      forgetDocx('deck-c')
      const api = { pptxUrl: (id: string, part: string) => 'http://pptx.localhost/' + id + '/' + part }
      const [first, second] = await Promise.all([prepareDocx('deck-c', api), prepareDocx('deck-c', api)])
      expect(first).toBe(second)
      const afterFirst = fetches
      // A third caller gets the memoised result without touching the archive.
      await prepareDocx('deck-c', api)
      expect(fetches).toBe(afterFirst)
      expect(preparedDocx('deck-c')).not.toBeNull()
    } finally {
      globalThis.fetch = restore
      vfs.close()
    }
  })

  it('returns null for an archive that holds no document part', async () => {
    const real = globalThis.fetch
    globalThis.fetch = (async () => ({ ok: false, text: async () => '' }) as Response) as typeof fetch
    try {
      forgetDocx('deck-d')
      const prepared = await prepareDocx('deck-d', {
        pptxUrl: (id, part) => 'http://pptx.localhost/' + id + '/' + part
      })
      // Nothing to draw: the caller converts instead of showing a blank stage.
      expect(prepared).toBeNull()
    } finally {
      globalThis.fetch = real
    }
  })
})
