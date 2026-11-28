/**
 * Page layout for a Word document.
 *
 * Word decides where a page ends by measuring laid-out text, so the parser cannot
 * know the page count on its own. This module turns measured block heights into
 * pages, and is a pure function of its inputs so the rule can be tested without a
 * browser.
 */

import type { DocxBlock, DocxDocument, DocxPage } from './types'

/** The box a page's content occupies, in px, at the authored page size. */
export function contentBox(document: DocxDocument): { width: number; height: number } {
  const { pageSize, margin } = document
  return {
    width: Math.max(1, pageSize.width - margin.left - margin.right),
    height: Math.max(1, pageSize.height - margin.top - margin.bottom)
  }
}

/**
 * Split blocks into pages.
 *
 * Two rules, in order:
 *
 * 1. A block the author put a page break before always starts a page.
 * 2. Otherwise blocks are packed until the next one would not fit.
 *
 * A block is never split across pages. Word would continue a long paragraph onto
 * the next page, but splitting one here would mean measuring line boxes and
 * re-flowing text; a document that leaves a little space at the foot of a page
 * reads correctly, while a paragraph cut in half does not.
 *
 * When no heights are available (nothing has been measured, or an environment
 * without a DOM) only the authored breaks are honoured. That is the honest answer:
 * the document has as many pages as the author explicitly asked for.
 */
export function paginateBlocks(
  blocks: DocxBlock[],
  heights: number[],
  contentHeight: number
): DocxPage[] {
  const measurable = contentHeight > 0 && heights.some((height) => height > 0)

  const pages: DocxPage[] = []
  let current: DocxBlock[] = []
  let used = 0

  const flush = (): void => {
    if (current.length === 0) return
    pages.push({ index: pages.length, blocks: current })
    current = []
    used = 0
  }

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]
    const height = heights[index] ?? 0

    if (block.breakBefore) flush()
    if (measurable && current.length > 0 && used + height > contentHeight) flush()

    current.push(block)
    used += height
  }
  flush()

  // An empty document is still one page: a reader who opens a file with no content
  // should see a page, not a zero-page error.
  if (pages.length === 0) pages.push({ index: 0, blocks: [] })
  return pages
}

/**
 * The height each page needs.
 *
 * A page whose content is taller than the paper (a long table, a full-page image)
 * reports the height it actually needs. Clipping it would silently hide the end of
 * the table, and reporting the paper height would draw the next page on top of it.
 */
export function pageHeight(
  page: DocxPage,
  document: DocxDocument,
  heights: Map<DocxBlock, number>
): number {
  let used = 0
  for (const block of page.blocks) used += heights.get(block) ?? 0
  const box = contentBox(document)
  return document.margin.top + Math.max(box.height, used) + document.margin.bottom
}
