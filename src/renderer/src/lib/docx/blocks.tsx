/**
 * Rendering for one Word document block.
 *
 * The blocks are drawn as ordinary HTML rather than as positioned shapes: Word's
 * content flows, and CSS already knows how to flow text, wrap it and lay a table
 * out. What this module supplies is the formatting Word resolved — sizes, colours,
 * indents, borders, merges — as inline styles.
 *
 * It is used twice: to measure the blocks at the page's content width, and to draw
 * the pages the reader sees. Both go through the same component so the measurement
 * cannot disagree with the drawing.
 */

import type {
  DocxBorder,
  DocxBlock,
  DocxCellBorders,
  DocxListMarker,
  DocxParagraph,
  DocxRun,
  DocxTable,
  DocxTableCell
} from './types'

/** A CSS border from a Word border, or none. */
function borderCss(border: DocxBorder | undefined): string | undefined {
  if (!border) return undefined
  return border.width + 'px ' + border.style + ' ' + border.color
}

/** The four sides of a cell, drawn separately so a partial border is possible. */
function cellBorderStyle(borders: DocxCellBorders): Record<string, string | undefined> {
  return {
    borderTop: borderCss(borders.top) ?? 'none',
    borderRight: borderCss(borders.right) ?? 'none',
    borderBottom: borderCss(borders.bottom) ?? 'none',
    borderLeft: borderCss(borders.left) ?? 'none'
  }
}

/** One run, as a span carrying its formatting. */
function Run({ run }: { run: DocxRun }) {
  if (run.image) {
    return (
      <img
        className="docx-image"
        src={run.image.src}
        alt={run.image.name ?? ''}
        style={{ width: run.image.width, height: run.image.height }}
        draggable={false}
      />
    )
  }

  const style: Record<string, string | number | undefined> = {
    fontSize: run.size + 'px',
    fontFamily: run.fontFamily,
    color: run.color,
    fontWeight: run.bold ? 700 : undefined,
    fontStyle: run.italic ? 'italic' : undefined,
    background: run.highlight,
    // The parser already reduced the size of a super/subscript; the vertical align
    // is what lifts it, which is how Word draws one.
    verticalAlign: run.baseline === undefined ? undefined : run.baseline > 0 ? 'super' : 'sub'
  }

  const decoration = [run.underline ? 'underline' : '', run.strike ? 'line-through' : '']
    .filter(Boolean)
    .join(' ')
  if (decoration) style.textDecoration = decoration

  return <span style={style}>{run.text}</span>
}

/** The marker column of a list item. */
function ListMarker({ marker }: { marker: DocxListMarker }) {
  return (
    <span className="docx-marker" style={{ width: marker.width, left: marker.left }} aria-hidden="true">
      {marker.text}
    </span>
  )
}

function Paragraph({ paragraph }: { paragraph: DocxParagraph }) {
  const style: Record<string, string | number | undefined> = {
    textAlign: paragraph.align,
    lineHeight: paragraph.lineHeightPx ? paragraph.lineHeightPx + 'px' : paragraph.lineHeightScale,
    marginTop: paragraph.spaceBefore,
    marginBottom: paragraph.spaceAfter,
    marginLeft: paragraph.indentLeft,
    marginRight: paragraph.indentRight,
    // A negative first-line indent is Word's hanging indent; text-indent takes it
    // as it is, which pulls the first line out to the marker column.
    textIndent: paragraph.firstLine,
    background: paragraph.shading
  }

  return (
    <p className="docx-p" style={style} data-heading={paragraph.heading}>
      {paragraph.list ? <ListMarker marker={paragraph.list} /> : null}
      <span className="docx-p-text">
        {paragraph.runs.map((run, index) => (
          <Run key={index} run={run} />
        ))}
      </span>
    </p>
  )
}

function Cell({ cell }: { cell: DocxTableCell }) {
  // A cell covered by a vertical merge above draws nothing: the cell that started
  // the merge already covers these rows, and drawing an empty one would add a
  // column of blank space.
  if (cell.covered || cell.rowSpan === 0) return null

  return (
    <td
      colSpan={cell.colSpan > 1 ? cell.colSpan : undefined}
      rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
      style={{
        ...cellBorderStyle(cell.borders),
        background: cell.fill,
        verticalAlign: cell.vAlign === 'middle' ? 'middle' : cell.vAlign === 'bottom' ? 'bottom' : 'top',
        width: cell.width
      }}
    >
      <DocxBlocks blocks={cell.blocks} inCell />
    </td>
  )
}

function Table({ table }: { table: DocxTable }) {
  return (
    <div className="docx-table-wrap" style={{ textAlign: table.align }}>
      <table
        className="docx-table"
        style={{ width: table.width > 0 ? table.width : '100%', tableLayout: 'fixed' }}
      >
        <colgroup>
          {table.columnWidths.map((width, index) => (
            <col key={index} style={{ width }} />
          ))}
        </colgroup>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <Cell key={cellIndex} cell={cell} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A run of blocks, in reading order. */
export function DocxBlocks({ blocks, inCell = false }: { blocks: DocxBlock[]; inCell?: boolean }) {
  return (
    <div className="docx-blocks" data-in-cell={inCell}>
      {blocks.map((block, index) =>
        block.type === 'paragraph' ? (
          <Paragraph key={index} paragraph={block.paragraph} />
        ) : (
          <Table key={index} table={block.table} />
        )
      )}
    </div>
  )
}
