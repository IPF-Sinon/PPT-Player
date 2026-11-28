/**
 * The WordprocessingML body parser.
 *
 * A .docx is read the way Word reads it: every paragraph and table is walked in
 * document order, and each one's formatting is resolved through its style chain
 * before it reaches the renderer. Page breaks found on the way split the flow into
 * pages, so the renderer draws the same page boundaries the author put there.
 */

import { attr, attrNum, child, children, descendants, first, localName } from '../pptx/xml'
import { parseRelationships, relsPartFor, resolvePartTarget } from '../pptx/rels'
import { Numbering } from './numbering'
import {
  alignment,
  colorValue,
  fontName,
  fontSize,
  mergeChain,
  parseDocxTheme,
  shadingColor,
  StyleSheet,
  toggle,
  type DocxTheme,
  type StyleLevel
} from './styles'
import type {
  DocxBlock,
  DocxBorder,
  DocxCellBorders,
  DocxDocument,
  DocxImage,
  DocxMargin,
  DocxParagraph,
  DocxRun,
  DocxTable,
  DocxTableCell
} from './types'
import { emu, eighthPoints, halfPoints, linear, twips } from './units'

/** Word's A4 page at 96 DPI, used when a document declares no page size. */
const DEFAULT_PAGE = { width: 794, height: 1123 }
/** Word's default margins for that page, in px. */
const DEFAULT_MARGIN: DocxMargin = { top: 96, right: 96, bottom: 96, left: 96 }
/** Default body size when nothing in the document states one: 11pt. */
const DEFAULT_SIZE_PX = 14.6667
/** Heading sizes as multiples of the body size, used when a heading style is silent. */
const HEADING_SCALE = [2, 1.5, 1.17, 1, 0.83, 0.67]
/** Word's default indent for a list level: half an inch, in twips. */
const DEFAULT_LIST_INDENT_TWIPS = 720

/** Everything the parser needs from the archive. */
export interface DocxLoadContext {
  deckId: string
  /** Fetch an internal part as text. */
  readText(partPath: string): Promise<string | null>
  /** URL for an internal part such as an image. */
  pptxUrl(deckId: string, partPath: string): string
}

/** One piece of an authored paragraph, and whether a page break precedes it. */
interface FlowParagraph {
  paragraph: DocxParagraph
  breakBefore: boolean
}

type FlowItem =
  | { kind: 'paragraph'; value: FlowParagraph }
  | { kind: 'table'; value: DocxTable }

interface ParseState {
  deckId: string
  theme: DocxTheme
  styles: StyleSheet
  numbering: Numbering
  /** Resolve a relationship id to a host-served image URL. */
  imageUrl(relId: string): string | null
}

/**
 * Parse a whole document.
 *
 * Everything is resolved up front rather than lazily: a Word document is small
 * next to a deck, and the reading column needs the page count before it can lay
 * anything out.
 */
export async function parseDocument(ctx: DocxLoadContext): Promise<DocxDocument | null> {
  const documentXml = await ctx.readText('word/document.xml')
  if (!documentXml) return null
  const root = parseXmlOrNull(documentXml)?.documentElement
  if (!root) return null
  const body = child(root, 'body')
  if (!body) return null

  const relsXml = await ctx.readText(relsPartFor('word/document.xml'))
  const rels = relsXml ? parseRelationships(relsXml) : new Map()

  const state: ParseState = {
    deckId: ctx.deckId,
    theme: parseDocxTheme(await readThemePart(ctx, rels)),
    styles: new StyleSheet(await ctx.readText('word/styles.xml')),
    numbering: new Numbering(await ctx.readText('word/numbering.xml')),
    imageUrl: (relId) => {
      const rel = rels.get(relId)
      if (!rel) return null
      return ctx.pptxUrl(ctx.deckId, resolvePartTarget('word/document.xml', rel.target))
    }
  }

  const items: FlowItem[] = []
  collectBlocks(body, state, items)
  const { blocks, declaredPageCount } = toBlocks(items)

  return {
    deckId: ctx.deckId,
    pageSize: readPageSize(body),
    margin: readMargin(body),
    blocks,
    declaredPageCount,
    // Word documents hold no charts or SmartArt that the renderer would need to
    // apologise for, but they do hold pictures, and a TIFF or a vector metafile
    // cannot be decoded by the webview. Saying so is better than drawing an empty
    // box where a diagram should be.
    hasComplexObjects: blocks.some((block) => blockHasUndecodableImage(block))
  }
}

/** Whether a block holds an image the webview cannot decode. */
function blockHasUndecodableImage(block: DocxBlock): boolean {
  if (block.type === 'paragraph') {
    return block.paragraph.runs.some(
      (run) => run.image !== undefined && /\.(tiff?|emf|wmf)(\?|$)/i.test(run.image.src)
    )
  }
  return block.table.rows
    .flat()
    .some((cell) => cell.blocks.some((inner) => blockHasUndecodableImage(inner)))
}

function parseXmlOrNull(xml: string): Document | null {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) return null
  return doc
}

/**
 * The theme part, which the document relationships name.
 *
 * A "+mn-lt" font alias and a themeColor both resolve through it, so a document
 * whose theme is missing loses its font names rather than failing to parse.
 */
async function readThemePart(
  ctx: DocxLoadContext,
  rels: Map<string, { type: string; target: string }>
): Promise<string | null> {
  for (const rel of rels.values()) {
    if (!rel.type.endsWith('/theme')) continue
    const xml = await ctx.readText(resolvePartTarget('word/document.xml', rel.target))
    if (xml) return xml
  }
  return null
}

/** Page size from the final section properties, or A4. */
function readPageSize(body: Element): { width: number; height: number } {
  const pgSz = child(lastSection(body), 'pgSz')
  const width = attrNum(pgSz, 'w', 0)
  const height = attrNum(pgSz, 'h', 0)
  // A landscape section states its size the other way round, so both numbers are
  // all that is needed; w:orient only repeats what they already say.
  return width > 0 && height > 0 ? { width: twips(width), height: twips(height) } : { ...DEFAULT_PAGE }
}

function readMargin(body: Element): DocxMargin {
  const pgMar = child(lastSection(body), 'pgMar')
  if (!pgMar) return { ...DEFAULT_MARGIN }
  return {
    top: twips(attrNum(pgMar, 'top', 1440)),
    right: twips(attrNum(pgMar, 'right', 1440)),
    bottom: twips(attrNum(pgMar, 'bottom', 1440)),
    left: twips(attrNum(pgMar, 'left', 1440))
  }
}

/**
 * The section properties that describe the body.
 *
 * Word puts the last section directly in the body and every earlier one in the
 * last paragraph of the section it ends, so the body-level element is the geometry
 * of the final page and the one a reader sees for the document as a whole.
 */
function lastSection(body: Element): Element | null {
  const direct = children(body, 'sectPr')
  if (direct.length > 0) return direct[direct.length - 1]
  const nested = descendants(body, 'sectPr')
  return nested.length > 0 ? nested[nested.length - 1] : null
}

/**
 * Walk a container, appending its paragraphs and tables in document order.
 *
 * Content controls (w:sdt) wrap ordinary paragraphs, so their content is walked
 * rather than skipped: a table inside a control is still a table the reader sees.
 */
function collectBlocks(container: Element, state: ParseState, out: FlowItem[]): void {
  for (const node of Array.from(container.childNodes)) {
    const el = node as Element
    if (el.nodeType !== 1) continue
    switch (localName(el)) {
      case 'p':
        for (const piece of parseParagraph(el, state)) {
          out.push({ kind: 'paragraph', value: piece })
        }
        break
      case 'tbl':
        out.push({ kind: 'table', value: parseTable(el, state) })
        break
      case 'sdt': {
        const content = child(el, 'sdtContent')
        if (content) collectBlocks(content, state, out)
        break
      }
      default:
        break
    }
  }
}

/**
 * The style chain in effect for a paragraph, most specific first.
 *
 * The paragraph's own properties lead the chain: they are what the author set
 * directly, and every inherited value must lose to them. Reading them separately
 * from the chain is what made a centred heading parse as left aligned.
 */
function paragraphChain(p: Element, state: ParseState): StyleLevel[] {
  const pPr = child(p, 'pPr')
  const own: StyleLevel = { name: '', pPr, rPr: child(pPr, 'rPr') }
  return [own, ...state.styles.chain(attr(child(pPr, 'pStyle'), 'val'))]
}

/**
 * One authored paragraph, split at every page break inside it.
 *
 * A page break is not always its own paragraph: Word puts it inside the run
 * sequence, so "text before" and "text after" belong to the same w:p and land on
 * different pages. Splitting here keeps the block model honest, and each piece
 * keeps the whole paragraph's formatting.
 */
function parseParagraph(p: Element, state: ParseState): FlowParagraph[] {
  const chain = paragraphChain(p, state)

  const heading = resolveHeading(chain)
  const align = mergeChain(chain, (level) => {
    const value = alignment(attr(child(level.pPr, 'jc'), 'val'))
    return value === undefined ? undefined : { align: value }
  })
  const spacing = mergeChain(chain, (level) => readSpacing(child(level.pPr, 'spacing')))
  const indent = mergeChain(chain, (level) => readIndent(child(level.pPr, 'ind')))
  const shading = mergeChain(chain, (level) => {
    const value = shadingColor(child(level.pPr, 'shd'))
    return value === undefined ? undefined : { shading: value }
  })
  const list = resolveList(chain)

  const bodySize = resolveRunSize(chain) ?? DEFAULT_SIZE_PX
  const baseSize = heading ? bodySize * (HEADING_SCALE[heading - 1] ?? 1) : bodySize

  // Runs are collected into segments, one per page: a break ends a segment. The
  // sink is passed by reference rather than as an array, because a page break has
  // to redirect the very next run into a new segment.
  const segments: DocxRun[][] = [[]]
  const sink: RunSink = {
    push: (run) => segments[segments.length - 1].push(run),
    break: (kind) => {
      if (kind === 'page' || kind === 'column') segments.push([])
    }
  }
  collectRuns(p, state, chain, baseSize, sink)

  // The marker belongs to the first piece only: the continuation of a list item
  // across a page break is not a new item, and numbering it again would both show
  // the wrong number and advance the counter.
  const marker = list ? state.numbering.next(list.numId, list.level, list.indent) : null
  const indentLeft = (indent.left ?? 0) + (marker ? marker.left + marker.width : 0)

  const pieces: FlowParagraph[] = []
  segments.forEach((runs, index) => {
    const paragraph: DocxParagraph = {
      runs,
      align: align.align ?? 'left',
      heading,
      lineHeightPx: spacing.lineHeightPx,
      lineHeightScale: spacing.lineHeightScale,
      spaceBefore: index === 0 ? spacing.before : undefined,
      spaceAfter: index === segments.length - 1 ? spacing.after : undefined,
      indentLeft: indentLeft > 0 ? indentLeft : undefined,
      firstLine: indent.firstLine,
      indentRight: indent.right,
      list:
        index === 0 && marker
          ? { text: marker.text, width: marker.width, left: marker.left + (indent.left ?? 0) }
          : undefined,
      shading: shading.shading
    }
    pieces.push({ paragraph, breakBefore: index > 0 })
  })

  return pieces
}

/**
 * The heading level a paragraph carries.
 *
 * Word records it twice: the built-in style is named "heading 1".."heading 9", and
 * a custom heading style declares w:outlineLvl instead. Both are read, because a
 * document from a school template almost always uses the second form.
 */
function resolveHeading(chain: StyleLevel[]): number | undefined {
  for (const level of chain) {
    const named = /^heading\s*([1-6])$/i.exec(level.name.trim())
    if (named) return Number(named[1])
    const value = attrNum(child(level.pPr, 'outlineLvl'), 'val', -1)
    if (value >= 0 && value < 6) return value + 1
  }
  return undefined
}

interface SpacingProps {
  before?: number
  after?: number
  lineHeightPx?: number
  lineHeightScale?: number
}

/**
 * Paragraph spacing from a w:spacing element.
 *
 * Word states line spacing either as a multiple of the font size (w:line with
 * lineRule="auto", in 240ths of a line) or as an exact height in twips. Both forms
 * appear in real documents, and confusing them is what makes paragraphs either run
 * together or float apart.
 */
function readSpacing(el: Element | null): SpacingProps | undefined {
  if (!el) return undefined
  const out: SpacingProps = {}
  const before = attrNum(el, 'before', NaN)
  const after = attrNum(el, 'after', NaN)
  const line = attrNum(el, 'line', NaN)
  const rule = (attr(el, 'lineRule') ?? 'auto').toLowerCase()

  if (!Number.isNaN(before)) out.before = twips(before)
  if (!Number.isNaN(after)) out.after = twips(after)
  if (!Number.isNaN(line) && line > 0) {
    if (rule === 'auto') out.lineHeightScale = line / 240
    else out.lineHeightPx = twips(line)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

interface IndentProps {
  left?: number
  right?: number
  firstLine?: number
}

/**
 * Paragraph indents from a w:ind element.
 *
 * Word writes the first-line indent two ways: w:firstLine pushes the first line in
 * and w:hanging pulls it out. Only one can be present, and a hanging indent is
 * expressed here as a negative first-line indent, which is what CSS needs.
 */
function readIndent(el: Element | null): IndentProps | undefined {
  if (!el) return undefined
  const out: IndentProps = {}
  const left = attr(el, 'left') ?? attr(el, 'start')
  const right = attr(el, 'right') ?? attr(el, 'end')
  const firstLine = attr(el, 'firstLine')
  const hanging = attr(el, 'hanging')

  if (left !== null) out.left = twips(Number(left) || 0)
  if (right !== null) out.right = twips(Number(right) || 0)
  if (hanging !== null) out.firstLine = -twips(Number(hanging) || 0)
  else if (firstLine !== null) out.firstLine = twips(Number(firstLine) || 0)

  return Object.keys(out).length > 0 ? out : undefined
}

interface ListRef {
  numId: string
  level: number
  /** The paragraph's own indent, used when numbering.xml states none. */
  indent: number
}

/**
 * A paragraph's list membership.
 *
 * w:numPr can sit on the paragraph or be inherited from a list style, and
 * w:numId="0" is how Word turns numbering off inside a numbered style. Both cases
 * appear in documents produced by the built-in list buttons.
 */
function resolveList(chain: StyleLevel[]): ListRef | null {
  const read = (level: StyleLevel): { value: ListRef | null } | undefined => {
    const numPr = child(level.pPr, 'numPr')
    if (!numPr) return undefined
    const numId = attr(child(numPr, 'numId'), 'val')
    if (numId === null) return undefined
    // numId 0 explicitly disables numbering for this paragraph.
    if (numId === '0') return { value: null }
    const ilvl = attrNum(child(numPr, 'ilvl'), 'val', 0)
    const left = attr(child(level.pPr, 'ind'), 'left') ?? attr(child(level.pPr, 'ind'), 'start')
    return {
      value: {
        numId,
        level: ilvl,
        indent: left === null ? DEFAULT_LIST_INDENT_TWIPS * (ilvl + 1) : Number(left) || 0
      }
    }
  }

  for (const level of chain) {
    const found = read(level)
    if (found) return found.value
  }
  return null
}

/** The size in effect for a chain, in px. */
function resolveRunSize(chain: StyleLevel[]): number | undefined {
  const found = mergeChain(chain, (level) => {
    const value = fontSize(level.rPr)
    return value === undefined ? undefined : { size: value }
  })
  return found.size === undefined ? undefined : halfPoints(found.size)
}

/** What a break element means to the flow. */
type BreakKind = 'line' | 'page' | 'column'

/** Where a walk puts the runs it finds, and how it reports a page break. */
interface RunSink {
  push(run: DocxRun): void
  break(kind: BreakKind): void
}

/**
 * Walk a paragraph's children, producing runs.
 *
 * Runs are not only w:r: a hyperlink, a field, a tracked insertion and a content
 * control all wrap them, and each must contribute its text. Page breaks are
 * reported to the sink because they belong to the page flow rather than to a run.
 */
function collectRuns(
  container: Element,
  state: ParseState,
  chain: StyleLevel[],
  baseSize: number,
  sink: RunSink
): void {
  for (const node of Array.from(container.childNodes)) {
    const el = node as Element
    if (el.nodeType !== 1) continue
    const name = localName(el)

    if (name === 'r') {
      parseRun(el, state, chain, baseSize, sink)
      continue
    }
    if (name === 'hyperlink' || name === 'smartTag' || name === 'ins' || name === 'fldSimple' || name === 'sdt') {
      const target = name === 'sdt' ? child(el, 'sdtContent') : el
      if (target) collectRuns(target, state, chain, baseSize, sink)
      continue
    }
    // w:pPr is the paragraph's own properties, and w:del/w:moveFrom/proofErr
    // carry text the document says is not there.
  }
}

function parseRun(
  r: Element,
  state: ParseState,
  chain: StyleLevel[],
  baseSize: number,
  sink: RunSink
): void {
  const rPr = child(r, 'rPr')
  const runChain: StyleLevel[] = [{ name: '', pPr: null, rPr }, ...chain]

  const size = resolveRunSize(runChain) ?? baseSize
  const vertAlign = (attr(child(rPr, 'vertAlign'), 'val') ?? '').toLowerCase()
  const shift = vertAlign === 'superscript' ? 1 : vertAlign === 'subscript' ? -1 : 0

  const color = mergeChain(runChain, (level) => {
    const value = colorValue(child(level.rPr, 'color'), state.theme)
    return value === undefined ? undefined : { color: value }
  })
  const font = mergeChain(runChain, (level) => {
    const value = fontName(level.rPr, state.theme)
    return value === undefined ? undefined : { font: value }
  })
  const highlight = mergeChain(runChain, (level) => {
    const value = colorValue(child(level.rPr, 'highlight'), state.theme)
    return value === undefined ? undefined : { highlight: value }
  })
  const bold = mergeChain(runChain, (level) => {
    const value = toggle(child(level.rPr, 'b'))
    return value === undefined ? undefined : { on: value }
  })
  const italic = mergeChain(runChain, (level) => {
    const value = toggle(child(level.rPr, 'i'))
    return value === undefined ? undefined : { on: value }
  })
  const strike = mergeChain(runChain, (level) => {
    const value = toggle(child(level.rPr, 'strike')) ?? toggle(child(level.rPr, 'dstrike'))
    return value === undefined ? undefined : { on: value }
  })
  const underline = mergeChain(runChain, (level) => {
    const value = attr(child(level.rPr, 'u'), 'val')
    return value === null ? undefined : { on: value.toLowerCase() !== 'none' }
  })

  // Word draws a superscript smaller than the body text and lifts it; the same
  // proportions here keep a footnote marker from looking like a full-size glyph.
  const style: Omit<DocxRun, 'text'> = {
    size: shift !== 0 ? size * 0.65 : size,
    bold: bold.on || undefined,
    italic: italic.on || undefined,
    underline: underline.on || undefined,
    strike: strike.on || undefined,
    color: color.color,
    fontFamily: font.font,
    highlight: highlight.highlight,
    baseline: shift !== 0 ? shift * size * 0.33 : undefined
  }

  for (const node of Array.from(r.childNodes)) {
    const el = node as Element
    if (el.nodeType !== 1) continue
    switch (localName(el)) {
      case 't': {
        const text = el.textContent ?? ''
        if (text !== '') sink.push({ ...style, text })
        break
      }
      case 'tab':
        sink.push({ ...style, text: '\t' })
        break
      case 'br': {
        const type = (attr(el, 'type') ?? 'textWrapping').toLowerCase()
        if (type === 'page') sink.break('page')
        else if (type === 'column') sink.break('column')
        else sink.push({ ...style, text: '\n' })
        break
      }
      case 'cr':
        sink.push({ ...style, text: '\n' })
        break
      case 'noBreakHyphen':
        sink.push({ ...style, text: '\u2011' })
        break
      case 'sym': {
        // A symbol run is a font plus a code point; without the font the code
        // point is the closest a browser can get.
        const code = attr(el, 'char')
        const value = code ? parseInt(code, 16) : NaN
        if (Number.isFinite(value)) sink.push({ ...style, text: String.fromCharCode(value) })
        break
      }
      case 'drawing': {
        const image = parseDrawing(el, state)
        if (image) sink.push({ ...style, text: '', image })
        break
      }
      case 'pict': {
        const image = parseVmlPicture(el, state)
        if (image) sink.push({ ...style, text: '', image })
        break
      }
      case 'AlternateContent': {
        // Both a DrawingML and a VML branch are present; the first choice is the
        // one modern Word writes, and the fallback holds the same picture.
        const branch = first(el, 'Choice') ?? first(el, 'Fallback')
        const drawing = first(branch, 'drawing')
        const image = drawing ? parseDrawing(drawing, state) : null
        if (image) sink.push({ ...style, text: '', image })
        break
      }
      default:
        break
    }
  }
}

/**
 * An inline picture from a w:drawing.
 *
 * The blip names its image by relationship id and wp:extent gives the display size
 * in EMU. Both are needed: an image with no relationship cannot be served, and one
 * with no extent has no size to draw at.
 */
function parseDrawing(drawing: Element, state: ParseState): DocxImage | null {
  const blip = first(drawing, 'blip')
  const embed = attr(blip, 'embed') ?? attr(blip, 'link')
  if (!embed) return null
  const src = state.imageUrl(embed)
  if (!src) return null

  const extent = first(drawing, 'extent')
  const width = emu(attrNum(extent, 'cx', 0))
  const height = emu(attrNum(extent, 'cy', 0))
  return {
    src,
    // A picture with no extent is drawn at a readable default rather than at zero
    // size, which would make it invisible with no sign anything was there.
    width: width > 0 ? width : 240,
    height: height > 0 ? height : 180,
    name: attr(first(drawing, 'cNvPr'), 'name') ?? undefined
  }
}

/**
 * A picture written in the legacy VML form.
 *
 * Documents converted from older software and pictures pasted from it carry
 * w:pict instead of w:drawing; the shape's style attribute holds its size in points.
 */
function parseVmlPicture(pict: Element, state: ParseState): DocxImage | null {
  const imageData = first(pict, 'imagedata')
  const relId = attr(imageData, 'id') ?? attr(imageData, 'relid')
  if (!relId) return null
  const src = state.imageUrl(relId)
  if (!src) return null

  const shape = first(pict, 'shape')
  const style = attr(shape, 'style') ?? ''
  const width = /width\s*:\s*([\d.]+)pt/i.exec(style)?.[1]
  const height = /height\s*:\s*([\d.]+)pt/i.exec(style)?.[1]
  const ptToPx = 96 / 72
  return {
    src,
    width: width ? Number(width) * ptToPx : 240,
    height: height ? Number(height) * ptToPx : 180,
    name: attr(shape, 'alt') ?? undefined
  }
}

/** A table, with its grid, borders, shading and merges. */
function parseTable(tbl: Element, state: ParseState): DocxTable {
  const tblPr = child(tbl, 'tblPr')
  const columnWidths = readColumnWidths(tbl, tblPr)
  const tableBorders = readTableBorders(tblPr)
  const rows: DocxTableCell[][] = []

  for (const tr of children(tbl, 'tr')) {
    const row: DocxTableCell[] = []
    for (const tc of children(tr, 'tc')) {
      const tcPr = child(tc, 'tcPr')
      const vMergeEl = child(tcPr, 'vMerge')
      const vMergeVal = attr(vMergeEl, 'val')

      const blocks: DocxBlock[] = []
      const flow: FlowItem[] = []
      collectBlocks(tc, state, flow)
      for (const item of flow) {
        blocks.push(item.kind === 'paragraph' ? { type: 'paragraph', paragraph: item.value.paragraph } : { type: 'table', table: item.value })
      }

      const width = linear(attrNum(child(tcPr, 'tcW'), 'w', 0), attr(child(tcPr, 'tcW'), 'type'), 0)

      row.push({
        blocks,
        colSpan: Math.max(1, attrNum(child(tcPr, 'gridSpan'), 'val', 1)),
        rowSpan: 1,
        // A vMerge with no val, or val="continue", is a cell the merge above owns.
        covered: vMergeEl !== null && (vMergeVal === null || vMergeVal.toLowerCase() === 'continue'),
        fill: shadingColor(child(tcPr, 'shd')),
        vAlign: readVAlign(tcPr),
        borders: { ...tableBorders, ...readCellBorders(tcPr) },
        width: width > 0 ? width : undefined
      })
    }
    rows.push(row)
  }

  applyVerticalMerges(rows)
  applySpannedWidths(rows, columnWidths)

  return {
    columnWidths,
    rows,
    width: columnWidths.reduce((sum, width) => sum + width, 0),
    align: readTableAlign(tblPr)
  }
}

/**
 * The table grid.
 *
 * w:tblGrid is authoritative when it carries widths. A table pasted from HTML
 * often has an empty grid, in which case the columns are equal shares of the
 * declared table width, which is what Word draws for it.
 */
function readColumnWidths(tbl: Element, tblPr: Element | null): number[] {
  const grid = children(child(tbl, 'tblGrid') ?? tbl, 'gridCol')
  const widths = grid.map((col) => twips(attrNum(col, 'w', 0)))
  if (widths.length > 0 && widths.every((width) => width > 0)) return widths

  const declared = linear(attrNum(child(tblPr, 'tblW'), 'w', 0), attr(child(tblPr, 'tblW'), 'type'), 0)
  const firstRow = child(tbl, 'tr')
  const count = Math.max(1, widths.length || (firstRow ? children(firstRow, 'tc').length : 1))
  const share = declared > 0 ? declared / count : 120
  return Array.from({ length: count }, (_, index) => (widths[index] > 0 ? widths[index] : share))
}

function readVAlign(tcPr: Element | null): 'top' | 'middle' | 'bottom' {
  const value = (attr(child(tcPr, 'vAlign'), 'val') ?? 'top').toLowerCase()
  if (value === 'center') return 'middle'
  if (value === 'bottom') return 'bottom'
  return 'top'
}

function readTableAlign(tblPr: Element | null): 'left' | 'center' | 'right' {
  const value = (attr(child(tblPr, 'jc'), 'val') ?? 'left').toLowerCase()
  if (value === 'center') return 'center'
  if (value === 'right' || value === 'end') return 'right'
  return 'left'
}

/**
 * The table's own borders.
 *
 * A table states its borders once for the whole grid and a cell overrides the
 * sides it names. A table with no border element at all has no borders, which is
 * not the same as a table that inherits the default single line.
 */
function readTableBorders(tblPr: Element | null): DocxCellBorders {
  const el = child(tblPr, 'tblBorders')
  if (!el) return {}
  return {
    top: readBorder(child(el, 'top')),
    right: readBorder(child(el, 'right') ?? child(el, 'end')),
    bottom: readBorder(child(el, 'bottom')),
    left: readBorder(child(el, 'left') ?? child(el, 'start'))
  }
}

function readCellBorders(tcPr: Element | null): DocxCellBorders {
  const el = child(tcPr, 'tcBorders')
  if (!el) return {}
  const out: DocxCellBorders = {}
  // A cell can also remove a border the table set, which w:val="nil" expresses;
  // readBorder returns undefined for that, so the key is set explicitly.
  for (const [side, names] of [
    ['top', ['top']],
    ['right', ['right', 'end']],
    ['bottom', ['bottom']],
    ['left', ['left', 'start']]
  ] as const) {
    for (const name of names) {
      const node = child(el, name)
      if (!node) continue
      out[side] = readBorder(node)
      break
    }
  }
  return out
}

/** One border element, or undefined when the side draws no line. */
function readBorder(el: Element | null): DocxBorder | undefined {
  if (!el) return undefined
  const style = (attr(el, 'val') ?? 'single').toLowerCase()
  if (style === 'nil' || style === 'none') return undefined
  const color = attr(el, 'color')
  return {
    width: Math.max(0.5, eighthPoints(attrNum(el, 'sz', 4))),
    color: color && /^[0-9a-fA-F]{6}$/.test(color) ? '#' + color.toLowerCase() : '#000000',
    style: style.includes('dash')
      ? 'dashed'
      : style.includes('dot')
        ? 'dotted'
        : style === 'double'
          ? 'double'
          : 'solid'
  }
}

/**
 * Turn vMerge runs into row spans.
 *
 * Word marks the first cell of a vertical merge as the restart and each following
 * cell as a continuation, without saying how many rows the merge covers. Counting
 * the continuations is what makes the cell the height of its whole span.
 */
function applyVerticalMerges(rows: DocxTableCell[][]): void {
  const columns = rows.reduce((max, row) => Math.max(max, row.length), 0)
  for (let column = 0; column < columns; column++) {
    let row = 0
    while (row < rows.length) {
      const cell = rows[row][column]
      if (!cell || cell.covered) {
        row++
        continue
      }
      let span = 1
      while (row + span < rows.length && rows[row + span][column]?.covered) {
        // The continuation cells draw nothing; the restart cell covers their rows.
        rows[row + span][column].rowSpan = 0
        span++
      }
      cell.rowSpan = span
      row += span
    }
  }
}

/**
 * Give a horizontally merged cell the width of the columns it covers.
 *
 * The renderer lays the table out with a fixed grid, so a spanning cell needs the
 * sum of the grid columns it occupies rather than a single column's width.
 */
function applySpannedWidths(rows: DocxTableCell[][], columnWidths: number[]): void {
  for (const row of rows) {
    let column = 0
    for (const cell of row) {
      if (cell.colSpan > 1) {
        const spanned = columnWidths.slice(column, column + cell.colSpan)
        if (spanned.length > 0) cell.width = spanned.reduce((sum, width) => sum + width, 0)
      }
      column += cell.colSpan
    }
  }
}

/**
 * Turn the flow into blocks, marking where the author forced a page break.
 *
 * Word paginates by measurement, which the parser cannot reproduce: it does not
 * know how wide the page will be drawn or how the reader's fonts will measure. So
 * the explicit breaks become block flags and the final page split happens after
 * layout, in the browser. What this function guarantees is that no content is
 * lost and that a document always has at least one page.
 */
function toBlocks(items: FlowItem[]): { blocks: DocxBlock[]; declaredPageCount: number } {
  const blocks: DocxBlock[] = []
  let pendingBreak = false
  let pages = 1

  const push = (block: DocxBlock): void => {
    if (pendingBreak) {
      block.breakBefore = true
      pendingBreak = false
      pages++
    }
    blocks.push(block)
  }

  for (const item of items) {
    if (item.kind === 'table') {
      push({ type: 'table', table: item.value })
      continue
    }
    const { paragraph, breakBefore } = item.value
    // A paragraph that only carries a break contributes nothing to the page; it
    // exists to end it.
    if (!paragraph.runs.some((run) => run.text !== '' || run.image)) continue
    if (breakBefore) pendingBreak = true
    push({ type: 'paragraph', paragraph })
  }

  return { blocks, declaredPageCount: Math.max(1, pages) }
}