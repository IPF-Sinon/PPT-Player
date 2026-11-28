/**
 * Data model for the native DOCX renderer.
 *
 * Everything is in CSS pixels. Word stores lengths in three different units
 * (twips for layout, half-points for font sizes, eighth-points for border widths)
 * and OOXML drawing extents in EMU; the parser converts each of them once so the
 * renderer never has to know which unit a number came from.
 *
 * A document is modelled as a flat flow of blocks rather than as pages. Word
 * paginates by measuring laid-out text, and the renderer cannot know where a page
 * ends until the blocks are in the DOM at the page's content width, so the page
 * split happens in the browser rather than in the parser.
 */

export type DocxAlign = 'left' | 'center' | 'right' | 'justify'

/** A piece of text with the formatting Word resolved for it. */
export interface DocxRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  /** Font size in px. */
  size: number
  fontFamily?: string
  color?: string
  /** Highlight background, as a CSS colour. */
  highlight?: string
  /**
   * Baseline shift in px: positive raises the run, negative lowers it.
   *
   * Derived from w:vertAlign, and the run's own size is scaled down the way Word
   * draws a superscript rather than leaving it at full size.
   */
  baseline?: number
  /** An inline picture. The text of such a run is empty. */
  image?: DocxImage
}

export interface DocxImage {
  /** URL served by the host, e.g. http://pptx.localhost/<deckId>/word/media/image1.png */
  src: string
  /** Displayed size in px, from wp:extent. */
  width: number
  height: number
  name?: string
}

/** The marker and hanging indent of a list item. */
export interface DocxListMarker {
  /** Literal text the renderer draws, e.g. "3." or "•". */
  text: string
  /** Width of the marker column in px; the text starts after it. */
  width: number
  /** Left edge of the marker column, in px. */
  left: number
}

export interface DocxParagraph {
  runs: DocxRun[]
  align: DocxAlign
  /** Heading level 1..6, taken from the style name or the outline level. */
  heading?: number
  /** Absolute line height in px, from an exact or "at least" line rule. */
  lineHeightPx?: number
  /** Multiple of the font size, from an automatic line rule (1 = single). */
  lineHeightScale?: number
  spaceBefore?: number
  spaceAfter?: number
  /** Left indent in px. */
  indentLeft?: number
  /** First-line indent in px; negative is a hanging indent. */
  firstLine?: number
  /** Right indent in px. */
  indentRight?: number
  list?: DocxListMarker
  /** Paragraph shading, as a CSS colour. */
  shading?: string
}

export interface DocxBorder {
  width: number
  color: string
  style: 'solid' | 'dashed' | 'dotted' | 'double'
}

export interface DocxCellBorders {
  top?: DocxBorder
  right?: DocxBorder
  bottom?: DocxBorder
  left?: DocxBorder
}

export interface DocxTableCell {
  blocks: DocxBlock[]
  /** Columns this cell covers, from w:gridSpan. */
  colSpan: number
  /** Rows this cell covers, computed from w:vMerge. Zero marks a covered cell. */
  rowSpan: number
  /** True when a vertical merge above already covers this cell. */
  covered: boolean
  fill?: string
  vAlign: 'top' | 'middle' | 'bottom'
  borders: DocxCellBorders
  /** Declared width in px, when the cell states one. */
  width?: number
}

export interface DocxTable {
  /** Column widths in px, from w:tblGrid. */
  columnWidths: number[]
  rows: DocxTableCell[][]
  /** Total table width in px. */
  width: number
  align: 'left' | 'center' | 'right'
}

export interface DocxParagraphBlock {
  type: 'paragraph'
  paragraph: DocxParagraph
  /** True when the author put a page break immediately before this block. */
  breakBefore?: boolean
}

export interface DocxTableBlock {
  type: 'table'
  table: DocxTable
  /** True when the author put a page break immediately before this block. */
  breakBefore?: boolean
}

export type DocxBlock = DocxParagraphBlock | DocxTableBlock

export interface DocxMargin {
  top: number
  right: number
  bottom: number
  left: number
}

/** One page of laid-out content. */
export interface DocxPage {
  index: number
  blocks: DocxBlock[]
}

/** The box a page's content is laid out in, in px. */
export interface DocxLayout {
  contentWidth: number
  contentHeight: number
}

export interface DocxDocument {
  deckId: string
  /** Page box in px, from w:pgSz. */
  pageSize: { width: number; height: number }
  margin: DocxMargin
  /** The document's content in reading order. */
  blocks: DocxBlock[]
  /**
   * Pages the file itself declares, from its explicit page breaks.
   *
   * Always at least 1. This is what the pager shows until the laid-out page count
   * is known, so a document never reports zero pages.
   */
  declaredPageCount: number
  /** True when the document holds pictures the webview cannot decode. */
  hasComplexObjects: boolean
}
