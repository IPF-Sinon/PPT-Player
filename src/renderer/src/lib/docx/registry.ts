/**
 * Parse, measure and paginate a document, once per deck.
 *
 * A Word document has to be paginated before anything can be drawn: the reading
 * column asks for a page count and a page box per page before it renders a single
 * one, and the pager shows that count. Word paginates by measuring laid-out text,
 * so the split happens here, after the blocks have been measured in the browser,
 * rather than in the parser, where no text has been laid out yet.
 *
 * The work is memoised per deck id because several components read the same
 * document at once - the preview stage, every mounted page of the reading column,
 * and the pager - and only the first caller should parse or measure.
 */

import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { DocxBlock, DocxDocument, DocxPage } from './types'
import { loadDocx, type DocxSource } from './load'
import { contentBox, pageHeight, paginateBlocks } from './layout'
import { DocxBlocks } from './blocks'

/** A document that has been parsed, measured and split into pages. */
export interface PreparedDocx {
  deckId: string
  document: DocxDocument
  pages: DocxPage[]
  /** Paper box per page, in px. A page is taller than the paper only when it must be. */
  pageSizes: Array<{ width: number; height: number }>
}

const parsedWork = new Map<string, Promise<DocxDocument | null>>()
const prepareWork = new Map<string, Promise<PreparedDocx | null>>()
const ready = new Map<string, PreparedDocx>()

/**
 * Parse the document, without measuring it.
 *
 * Resolves as soon as the XML is read, which is what lets the pager show the page
 * count the author declared before the laid-out count is known. Returns null when
 * the archive holds no readable word/document.xml, which is how a legacy binary
 * .doc looks from here: it is a CFB rather than a ZIP, so nothing in it is
 * reachable and the caller falls back to the engine.
 */
export function parseDocx(deckId: string, api: DocxSource): Promise<DocxDocument | null> {
  const cached = parsedWork.get(deckId)
  if (cached) return cached
  const work = loadDocx(deckId, api).catch(() => null)
  parsedWork.set(deckId, work)
  return work
}

/**
 * Parse, measure and paginate, reusing whatever has already been done.
 *
 * The page count this resolves with is the laid-out one, which is the number the
 * pager should end up showing.
 */
export function prepareDocx(deckId: string, api: DocxSource): Promise<PreparedDocx | null> {
  const cached = prepareWork.get(deckId)
  if (cached) return cached
  const work = build(deckId, api)
    .then((prepared) => {
      if (prepared) ready.set(deckId, prepared)
      return prepared
    })
    .catch(() => null)
  prepareWork.set(deckId, work)
  return work
}

/** The prepared document, if preparing has finished. */
export function preparedDocx(deckId: string): PreparedDocx | null {
  return ready.get(deckId) ?? null
}

/** Forget a document, so a reopened file is re-read rather than served stale. */
export function forgetDocx(deckId: string): void {
  parsedWork.delete(deckId)
  prepareWork.delete(deckId)
  ready.delete(deckId)
}

async function build(deckId: string, api: DocxSource): Promise<PreparedDocx | null> {
  const doc = await parseDocx(deckId, api)
  if (!doc) return null

  const box = contentBox(doc)
  const heights = await measureBlocks(doc.blocks, box.width)
  const pages = paginateBlocks(doc.blocks, heights, box.height)

  const byBlock = new Map<DocxBlock, number>()
  doc.blocks.forEach((block, index) => byBlock.set(block, heights[index] ?? 0))

  return {
    deckId,
    document: doc,
    pages,
    pageSizes: pages.map((page) => ({
      width: doc.pageSize.width,
      height: pageHeight(page, doc, byBlock)
    }))
  }
}

/**
 * Measure every block at the page's content width.
 *
 * The blocks are rendered once into a hidden host with the real content width and
 * the same class names the visible page uses, so the measurement sees exactly the
 * layout the reader will. Without a DOM there is nothing to measure, and the caller
 * then falls back to the page breaks the author wrote.
 */
async function measureBlocks(blocks: DocxBlock[], contentWidth: number): Promise<number[]> {
  const hostDocument = globalThis.document
  if (!hostDocument || blocks.length === 0) return []

  const host = hostDocument.createElement('div')
  host.className = 'docx-measure'
  host.style.width = contentWidth + 'px'
  hostDocument.body.appendChild(host)

  const root = createRoot(host)
  try {
    root.render(createElement(DocxBlocks, { blocks }))
    // One frame for the render to commit and one for layout to settle: a font that
    // arrives between the two would otherwise be measured at its fallback metrics.
    await nextFrame()
    await nextFrame()

    const container = host.querySelector('.docx-blocks')
    const children = container ? Array.from(container.children) : []
    return blocks.map((_, index) => {
      const el = children[index] as HTMLElement | undefined
      if (!el) return 0
      // Margins sit outside the border box, and Word's space before and after is
      // part of a block's footprint; a split that ignored them would overflow.
      const style = getComputedStyle(el)
      return (
        el.getBoundingClientRect().height +
        (parseFloat(style.marginTop) || 0) +
        (parseFloat(style.marginBottom) || 0)
      )
    })
  } catch {
    return []
  } finally {
    root.unmount()
    host.remove()
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
    else setTimeout(resolve, 0)
  })
}
