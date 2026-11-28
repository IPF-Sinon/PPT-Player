/**
 * The native Word document view.
 *
 * Two shapes share one implementation:
 *
 * - page: one page of the document, scaled to fit its box. This is what the
 *   preview stage draws, and it is the same page the reading column draws, so a
 *   reader who switches views sees the same text at the same place.
 * - column: the whole document as one continuous column of pages, which is how
 *   the reading mode wants a document to read.
 *
 * The pages are not rasterised. Word's content is text and tables, so it is drawn
 * as HTML at the authored page size and scaled with a single transform, exactly
 * the way the native slide view works: text stays sharp at any zoom and can be
 * selected, which a bitmap could not.
 */

import { useLayoutEffect, useRef, useState } from 'react'
import type { DocxPage } from '../lib/docx/types'
import { DocxBlocks } from '../lib/docx/blocks'
import { useDocx } from '../lib/docx/use-docx'

interface PageFrameProps {
  page: DocxPage
  /** Paper box in px. */
  width: number
  height: number
  /** Scale applied to the authored page. 1 draws it at 96 DPI. */
  scale: number
  /** Padding inside the paper, from the document's margins. */
  inset: { top: number; right: number; bottom: number; left: number }
}

/**
 * One page of paper with its content laid out at the authored size.
 *
 * The paper is sized in real pixels and the content is placed inside the margins,
 * so a page scaled down still has its text at the same relative position as a page
 * drawn at 100%.
 */
export function DocxPageFrame({ page, width, height, scale, inset }: PageFrameProps) {
  return (
    <div
      className="docx-page"
      data-testid="docx-page"
      style={{
        width: width * scale,
        height: height * scale,
        paddingTop: inset.top * scale,
        paddingRight: inset.right * scale,
        paddingBottom: inset.bottom * scale,
        paddingLeft: inset.left * scale
      }}
    >
      <div
        className="docx-page-body"
        style={{
          // The content is laid out at its authored width and scaled, so line
          // breaks land where Word put them rather than where the box happens to
          // be.
          width,
          transform: scale === 1 ? undefined : 'scale(' + scale + ')',
          transformOrigin: 'top left'
        }}
      >
        <DocxBlocks blocks={page.blocks} />
      </div>
    </div>
  )
}

export interface DocxViewProps {
  deckId: string
  /** Which page to draw. Zero based. */
  pageIndex: number
  /** Fit the page into the available box, which is what the stage does. */
  fit?: boolean
  /** Explicit scale, for a caller that already knows its own width. */
  fixedScale?: number
  onDoubleClick?: () => void
}

/**
 * One page of a Word document, fitted into the space it is given.
 *
 * The page is drawn at its authored size and scaled to fit, which keeps every
 * glyph's proportion fixed no matter how large the window is. The document is
 * parsed and paginated once per deck and shared, so paging through a long file
 * costs a re-render rather than a re-parse.
 */
export function DocxView({ deckId, pageIndex, fit = false, fixedScale, onDoubleClick }: DocxViewProps) {
  const holderRef = useRef<HTMLDivElement | null>(null)
  const [measured, setMeasured] = useState(1)
  const prepared = useDocx(deckId, true)

  useLayoutEffect(() => {
    if (fixedScale !== undefined) {
      setMeasured(fixedScale)
      return
    }
    if (!fit) {
      setMeasured(1)
      return
    }
    const holder = holderRef.current
    if (!holder || !prepared) return
    const measure = (): void => {
      const rect = holder.getBoundingClientRect()
      if (rect.width < 8 || rect.height < 8) return
      const page = prepared.pageSizes[pageIndex] ?? prepared.pageSizes[0]
      if (!page || page.width <= 0 || page.height <= 0) return
      setMeasured(Math.min(rect.width / page.width, rect.height / page.height))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(holder)
    return () => observer.disconnect()
  }, [fit, fixedScale, prepared, pageIndex])

  if (!prepared) {
    return (
      <div className="docx-stage" ref={holderRef} data-testid="docx-stage" data-ready="false">
        <p className="docx-loading">正在解析文档…</p>
      </div>
    )
  }

  const page = prepared.pages[Math.max(0, Math.min(pageIndex, prepared.pages.length - 1))]
  const box = prepared.pageSizes[page?.index ?? 0] ?? prepared.pageSizes[0]
  const scale = fixedScale ?? (fit ? measured : 1)

  return (
    <div className="docx-stage" ref={holderRef} data-testid="docx-stage" data-ready="true">
      <div className="docx-scale" onDoubleClick={onDoubleClick} role="presentation">
        {page ? (
          <DocxPageFrame
            page={page}
            width={box.width}
            height={box.height}
            scale={scale}
            inset={prepared.document.margin}
          />
        ) : null}
      </div>
    </div>
  )
}

export interface DocxColumnProps {
  deckId: string
  pageIndex: number
  /** Box the column draws into; the page is scaled to its width. */
  box: { width: number; height: number }
}

/**
 * One page of a Word document inside the reading column.
 *
 * The column already sizes each page's slot, so the page is scaled to the slot's
 * width rather than measured again; that is what keeps the slot height the column
 * reserved and the page it draws in agreement.
 */
export function DocxColumnPage({ deckId, pageIndex, box }: DocxColumnProps) {
  const prepared = useDocx(deckId, true)
  if (!prepared) return null

  const page = prepared.pages[pageIndex]
  const paper = prepared.pageSizes[pageIndex]
  if (!page || !paper || paper.width <= 0) return null

  const scale = box.width > 0 ? box.width / paper.width : 1
  return (
    <div className="docx-column-page" data-testid="docx-column-page">
      <DocxPageFrame
        page={page}
        width={paper.width}
        height={paper.height}
        scale={scale}
        inset={prepared.document.margin}
      />
    </div>
  )
}
