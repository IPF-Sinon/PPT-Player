import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { InkStroke } from '@shared/types'
import { InkLayer } from './InkLayer'
import { loadSheet, cachedSheet } from '../lib/sheet/registry'
import type { MergedRegion, SheetSource, SpreadsheetModel } from '../lib/sheet/types'

/** Default row height and column width, in CSS pixels. */
const ROW_HEIGHT = 28
const COL_WIDTH = 96
/** Width of the row-number gutter and height of the header row. */
const GUTTER = 48
const HEADER_HEIGHT = 30

/**
 * Rows fetched at once.
 *
 * A window rather than the whole sheet: the Rust side caps a single call, and asking
 * for everything would send megabytes across IPC to draw a screenful.
 */
const WINDOW_ROWS = 500

/**
 * A spreadsheet, drawn as a real grid.
 *
 * The grid is HTML rather than a canvas so the text stays sharp and selectable at any
 * zoom, which is the same reason DocxView draws pages as HTML. Two things are
 * deliberately unlike a plain table:
 *
 * - The header row and the row-number gutter are frozen by position: they are separate
 *   elements pinned to the scroller's edges rather than cells with position:sticky,
 *   because a merged cell spanning the frozen columns cannot be expressed as a sticky
 *   cell without fighting the merge.
 * - The ink layer is a sibling of the scroller, not a child of it. That is what keeps a
 *   stroke locked to the table while it scrolls or zooms: the canvas is positioned in
 *   the same coordinate space as the content, so a stroke drawn on a cell stays on that
 *   cell when the grid moves.
 */
export interface SheetViewProps {
  deckId: string
  /** The file to open. */
  path: string
  api: SheetSource
  /** Page the reader is on, which selects the sheet tab. */
  pageIndex: number
  /** A sheet tab was chosen. */
  onSelectSheet: (sheetIndex: number) => void
  /** Fit the sheet to the window rather than scrolling it. */
  fit?: boolean
  strokes: InkStroke[]
  drawing: boolean
  tool: 'pen' | 'eraser'
  color: string
  widthPx: number
  onCommitStroke: (stroke: InkStroke) => void
  onStrokeStart?: () => void
  onDoubleClick?: () => void
}

/** Column letters: A, B, ... Z, AA, AB, ... */
export function columnName(index: number): string {
  let name = ''
  let value = index
  while (value >= 0) {
    name = String.fromCharCode(65 + (value % 26)) + name
    value = Math.floor(value / 26) - 1
  }
  return name
}

/**
 * Which columns a row draws, given the merges that start on it.
 *
 * A merged cell is drawn once, at its top-left, and the columns it covers are skipped.
 * Doing this per row rather than by hiding cells keeps the DOM small and means a merge
 * cannot leave a stray border inside itself.
 */
export function coveredBy(merges: MergedRegion[], row: number, col: number): MergedRegion | null {
  for (const region of merges) {
    if (
      row >= region.firstRow &&
      row <= region.lastRow &&
      col >= region.firstCol &&
      col <= region.lastCol
    ) {
      return region
    }
  }
  return null
}

export function SheetView(props: SheetViewProps) {
  const [model, setModel] = useState<SpreadsheetModel | null>(
    () => cachedSheet(props.deckId, {}) ?? null
  )
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(1)
  const scrollerRef = useRef<HTMLDivElement | null>(null)

  // The sheet a page index selects. A workbook is one document with several sheets, so
  // the page the reader is on picks the tab rather than a page within one sheet.
  const sheetName = useMemo(() => {
    if (!model) return undefined
    return model.sheets[props.pageIndex] ?? model.sheets[0]
  }, [model, props.pageIndex])

  useEffect(() => {
    let cancelled = false
    const request = { sheet: sheetName, rowCount: WINDOW_ROWS }
    void loadSheet(props.deckId, props.api, props.path, request).then(
      (loaded) => {
        if (!cancelled) {
          setModel(loaded)
          setError('')
        }
      },
      (failure: unknown) => {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
      }
    )
    return () => {
      cancelled = true
    }
  }, [props.deckId, props.api, props.path, sheetName])

  // Narrowed together with the sheet: the tab bar and the status line both read the
  // model, and a null check on sheet alone leaves model possibly null below.
  const book = model
  const sheet = book?.sheet ?? null

  /** Column widths, from the file where it states one and the default otherwise. */
  const widths = useMemo(() => {
    const stated = new Map<number, number>()
    for (const width of sheet?.colWidths ?? []) stated.set(width.col, width.width)
    return stated
  }, [sheet])

  const widthOf = useCallback(
    (col: number): number => widths.get(col) ?? COL_WIDTH,
    [widths]
  )

  // Ctrl+wheel zooms, matching the pinch gesture the reading column offers. It is
  // attached natively rather than through React's onWheel because a passive listener
  // cannot preventDefault, and without that the browser zooms the whole window.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) return
      event.preventDefault()
      setZoom((current) => Math.min(3, Math.max(0.5, current - event.deltaY * 0.001)))
    }
    scroller.addEventListener('wheel', onWheel, { passive: false })
    return () => scroller.removeEventListener('wheel', onWheel)
  }, [])

  if (error) {
    return (
      <div className="sheet-error" data-testid="sheet-error">
        {error}
      </div>
    )
  }
  if (!book || !sheet) {
    return <div className="sheet-loading" data-testid="sheet-loading" />
  }

  const cols = sheet.colCount
  const merges = sheet.merges
  // Columns are absolute sheet indices, and a sheet's data need not start at A1, so
  // the drawn columns are the range the window actually covers.
  const firstCol = sheet.firstCol
  const drawnCols = Array.from({ length: cols }, (_, offset) => firstCol + offset)
  // The total drawn width, so the header and every row agree on it.
  const totalWidth = drawnCols.reduce((sum, col) => sum + widthOf(col), 0)

  const gridStyle: CSSProperties = {
    // Zoom scales the grid rather than the wrapper, so the scroll area keeps up with
    // the content and the reader can still reach the last column.
    width: totalWidth * zoom,
    transform: zoom === 1 ? undefined : 'scale(' + zoom + ')',
    transformOrigin: 'top left'
  }

  return (
    <div className="sheet-view" data-testid="sheet-view" onDoubleClick={props.onDoubleClick}>
      <div className="sheet-grid-wrap">
        {/* The frozen header: column letters, pinned above the scroller. */}
        <div className="sheet-header" style={{ height: HEADER_HEIGHT }}>
          <div className="sheet-header-corner" style={{ width: GUTTER, minWidth: GUTTER }} />
          <div className="sheet-header-cells" style={{ width: totalWidth * zoom }}>
            {drawnCols.map((col) => (
              <div
                key={col}
                className="sheet-header-cell"
                style={{ width: widthOf(col) * zoom, minWidth: widthOf(col) * zoom }}
              >
                {columnName(col)}
              </div>
            ))}
          </div>
        </div>

        <div className="sheet-body">
          {/* The frozen gutter: row numbers, pinned left of the scroller. */}
          <div className="sheet-gutter" style={{ width: GUTTER, minWidth: GUTTER }}>
            {sheet.rows.map((row) => (
              <div key={row.row} className="sheet-gutter-cell" style={{ height: ROW_HEIGHT }}>
                {row.row + 1}
              </div>
            ))}
          </div>

          <div className="sheet-scroller" ref={scrollerRef}>
            <div className="sheet-grid" style={gridStyle} data-testid="sheet-grid">
              {sheet.rows.map((row) => {
                // A merge whose top-left is above the window still covers cells that
                // are IN the window. Its content belongs to the row that is not being
                // drawn, so the covered cells are skipped and the span is not drawn:
                // rendering them as ordinary cells would draw the same value several
                // times, and skipping them without the span would delete the row.
                const openAbove = new Set<number>()
                for (const region of merges) {
                  if (region.firstRow < row.row && region.lastRow >= row.row) {
                    for (let col = region.firstCol; col <= region.lastCol; col++) openAbove.add(col)
                  }
                }
                return (
                  <div className="sheet-row" key={row.row} style={{ height: ROW_HEIGHT }}>
                    {row.cells.map((cell) => {
                      if (openAbove.has(cell.col)) return null
                      const region = coveredBy(merges, row.row, cell.col)
                      // A cell inside a merge that is not the merge's top-left is
                      // drawn by that top-left cell instead.
                      if (region && (region.firstRow !== row.row || region.firstCol !== cell.col)) {
                        return null
                      }
                      const span = region
                        ? drawnCols
                            .filter((col) => col >= region.firstCol && col <= region.lastCol)
                            .reduce((sum, col) => sum + widthOf(col), 0)
                        : widthOf(cell.col)
                      const rowSpan = region ? region.lastRow - region.firstRow + 1 : 1
                      return (
                        <div
                          key={cell.col}
                          className={'sheet-cell sheet-cell-' + cell.kind + (region ? ' sheet-merged' : '')}
                          style={{
                            width: span,
                            minWidth: span,
                            height: ROW_HEIGHT * rowSpan,
                            zIndex: region ? 1 : undefined
                          }}
                          title={cell.text}
                        >
                          {cell.text}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>

            {/* The annotation layer is sized to the CONTENT, not to the viewport, and
                sits inside the scroller. That is what locks a stroke to its cell: the
                canvas scrolls with the grid and is scaled with it, so the same
                normalised point keeps pointing at the same cell when the reader
                scrolls or zooms. A viewport-sized canvas would slide against the grid
                the moment either happened. */}
            <div
              className="sheet-ink"
              style={{ width: totalWidth * zoom, height: sheet.rows.length * ROW_HEIGHT }}
            >
              <InkLayer
                boxWidth={totalWidth * zoom}
                boxHeight={sheet.rows.length * ROW_HEIGHT}
                strokes={props.strokes}
                drawing={props.drawing}
                tool={props.tool}
                color={props.color}
                widthPx={props.widthPx}
                onCommit={props.onCommitStroke}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="sheet-tabs" data-testid="sheet-tabs">
        {book.sheets.map((name, index) => (
          <button
            key={name}
            type="button"
            className={'sheet-tab' + (index === props.pageIndex ? ' sheet-tab-active' : '')}
            onClick={() => props.onSelectSheet(index)}
          >
            {name}
          </button>
        ))}
        <span className="sheet-status">
          {sheet.rows.length} / {sheet.rowCount} 行
          {book.encoding === 'gbk' ? ' · GBK' : ''}
        </span>
      </div>
    </div>
  )
}
