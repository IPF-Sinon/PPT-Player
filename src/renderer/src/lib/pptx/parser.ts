/**
 * Slide parser for the native PPTX renderer.
 *
 * Parsing is per-slide and lazy: opening a deck reads only the theme and the first
 * slide, and the rest are parsed when the presenter reaches them or a thumbnail
 * scrolls into view. A page costs one part fetch plus a handful of relationship
 * lookups, which keeps a hundred-slide deck responsive.
 */

import type {
  Paint,
  PictureElement,
  ShapeElement,
  SlideElement,
  SlideModel,
  TableCell,
  TableElement,
  TextBody
} from './types'
import { parseTheme, type Theme } from './theme'
import {
  attr,
  attrNum,
  child,
  children,
  descendants,
  first,
  localName,
  parseXml
} from './xml'
import {
  elementId,
  elementName,
  emu,
  resolveBorder,
  resolveFill,
  resolveGeometry,
  resolveTransform,
  shapeChildren
} from './fill'
import { parseTextBody } from './text'
import { parseAnimations } from './animations'
import { parseRelationships, relsPartFor, resolvePartTarget } from './rels'

export interface SlideLoadContext {
  deckId: string
  theme: Theme
  /** Fetch an internal part as text. */
  readText(partPath: string): Promise<string | null>
  /** Slide canvas size in px. */
  slideSize: { width: number; height: number }
}

/** Relationship map for one part, keyed by rId. */
type RelMap = Map<string, { type: string; target: string }>

async function loadRels(ctx: SlideLoadContext, partPath: string): Promise<RelMap> {
  const relsPath = relsPartFor(partPath)
  const xml = await ctx.readText(relsPath)
  if (!xml) return new Map()
  return parseRelationships(xml)
}

function imageUrl(ctx: SlideLoadContext, partPath: string, relId: string, rels: RelMap): string | null {
  const rel = rels.get(relId)
  if (!rel) return null
  const target = resolvePartTarget(partPath, rel.target)
  return 'app://pptx/' + ctx.deckId + '/' + target
}

/** Read the blipFill of a background or shape into a Paint. */
function blipFill(
  container: Element | null,
  ctx: SlideLoadContext,
  partPath: string,
  rels: RelMap
): Paint | undefined {
  return resolveFill(container, ctx.theme, undefined, (relId) =>
    imageUrl(ctx, partPath, relId, rels)
  )
}

function parsePicture(
  pic: Element,
  ctx: SlideLoadContext,
  partPath: string,
  rels: RelMap
): PictureElement | null {
  const spPr = first(pic, 'spPr')
  const transform = resolveTransform(first(spPr, 'xfrm'))
  if (!transform) return null

  const blipFillEl = first(pic, 'blipFill')
  const blip = first(blipFillEl, 'blip')
  const embed = attr(blip, 'embed') ?? attr(blip, 'link')
  const src = embed ? imageUrl(ctx, partPath, embed, rels) : null
  if (!src) return null

  const srcRect = first(blipFillEl, 'srcRect')
  const crop = srcRect
    ? {
        left: attrNum(srcRect, 'l', 0) / 100000,
        top: attrNum(srcRect, 't', 0) / 100000,
        right: attrNum(srcRect, 'r', 0) / 100000,
        bottom: attrNum(srcRect, 'b', 0) / 100000
      }
    : undefined

  return {
    type: 'picture',
    id: elementId(pic),
    name: elementName(pic),
    rect: { x: transform.x, y: transform.y, width: transform.width, height: transform.height },
    rotation: transform.rotation,
    flipH: transform.flipH,
    flipV: transform.flipV,
    src,
    crop,
    border: resolveBorder(spPr, ctx.theme)
  }
}

function parseShape(sp: Element, ctx: SlideLoadContext): ShapeElement | null {
  const spPr = first(sp, 'spPr')
  const transform = resolveTransform(first(spPr, 'xfrm'))
  if (!transform) return null

  const prstGeom = first(spPr, 'prstGeom')
  const custGeom = first(spPr, 'custGeom')
  const preset = attr(prstGeom, 'prst')
  const geometry = custGeom
    ? resolveGeometry('rect', transform)
    : resolveGeometry(preset, transform)

  const fill = resolveFill(spPr, ctx.theme) ?? { kind: 'none' }
  const border = resolveBorder(spPr, ctx.theme)
  const txBody = first(sp, 'txBody')
  const text = parseTextBody(txBody, ctx.theme)

  return {
    type: 'shape',
    id: elementId(sp),
    name: elementName(sp),
    rect: { x: transform.x, y: transform.y, width: transform.width, height: transform.height },
    rotation: transform.rotation,
    flipH: transform.flipH,
    flipV: transform.flipV,
    geometry,
    fill,
    border,
    text: text ?? undefined,
    shadow: first(spPr, 'effectLst') !== null
  }
}

function parseTable(
  frame: Element,
  ctx: SlideLoadContext,
  partPath: string,
  rels: RelMap
): TableElement | null {
  const xfrm = first(frame, 'xfrm')
  const transform = resolveTransform(xfrm)
  if (!transform) return null

  const tbl = first(frame, 'tbl')
  if (!tbl) return null

  const gridCols = children(child(tbl, 'tblGrid') ?? tbl, 'gridCol')
  const columnWidths = gridCols.map((col) => emu(attrNum(col, 'w', 0)))

  const rows: TableCell[][] = []
  const rowHeights: number[] = []

  for (const tr of children(tbl, 'tr')) {
    rowHeights.push(emu(attrNum(tr, 'h', 0)))
    const row: TableCell[] = []
    for (const tc of children(tr, 'tc')) {
      const tcPr = child(tc, 'tcPr')
      const gridSpan = attrNum(tcPr, 'gridSpan', 1)
      const rowSpan = attrNum(tcPr, 'rowSpan', 1)
      const hMerge = attr(tcPr, 'hMerge') === '1'
      const vMerge = attr(tcPr, 'vMerge') === '1'

      let text: TextBody | null = null
      const txBody = child(tc, 'txBody')
      if (txBody) text = parseTextBody(txBody, ctx.theme)

      row.push({
        text: text ?? undefined,
        fill: blipFill(tcPr, ctx, partPath, rels),
        border: resolveBorder(tcPr, ctx.theme),
        gridSpan,
        rowSpan,
        merged: hMerge || vMerge
      })
    }
    rows.push(row)
  }

  if (rows.length === 0) return null

  return {
    type: 'table',
    id: elementId(frame),
    name: elementName(frame),
    rect: { x: transform.x, y: transform.y, width: transform.width, height: transform.height },
    rotation: transform.rotation,
    columnWidths,
    rowHeights,
    rows
  }
}

/** Detect content the native renderer cannot draw faithfully. */
function hasComplexContent(el: Element): boolean {
  const name = localName(el)
  if (name === 'chart' || name === 'dgm' || name === 'oMath' || name === 'oleObj') return true
  const relIds = first(el, 'relIds')
  if (relIds) return true
  // Vector metafiles are not decodable in the renderer.
  const blip = first(el, 'blip')
  const embed = attr(blip, 'embed')
  if (embed && (attr(blip, 'type') ?? '').toLowerCase().includes('emf')) return true
  return false
}

async function parseGroup(
  grp: Element,
  ctx: SlideLoadContext,
  partPath: string,
  rels: RelMap
): Promise<SlideElement | null> {
  const grpSpPr = first(grp, 'grpSpPr')
  const transform = resolveTransform(first(grpSpPr, 'xfrm'))
  if (!transform) return null

  // Child shapes live in their own coordinate space; scale them into the group box.
  const chOff = first(first(grpSpPr, 'xfrm'), 'chOff')
  const chExt = first(first(grpSpPr, 'xfrm'), 'chExt')
  const childX = emu(attrNum(chOff, 'x', 0))
  const childY = emu(attrNum(chOff, 'y', 0))
  const childW = emu(attrNum(chExt, 'cx', transform.width))
  const childH = emu(attrNum(chExt, 'cy', transform.height))
  const scaleX = childW > 0 ? transform.width / childW : 1
  const scaleY = childH > 0 ? transform.height / childH : 1

  const kids = await parseElementList(grp, ctx, partPath, rels)
  const childrenOut: SlideElement[] = kids.map((el) => {
    const copy = { ...el }
    copy.rect = {
      x: (el.rect.x - childX) * scaleX,
      y: (el.rect.y - childY) * scaleY,
      width: el.rect.width * scaleX,
      height: el.rect.height * scaleY
    }
    return copy
  })

  return {
    type: 'group',
    id: elementId(grp),
    name: elementName(grp),
    rect: { x: transform.x, y: transform.y, width: transform.width, height: transform.height },
    rotation: transform.rotation,
    children: childrenOut
  }
}

async function parseElement(
  el: Element,
  ctx: SlideLoadContext,
  partPath: string,
  rels: RelMap
): Promise<SlideElement | null> {
  const name = localName(el)
  if (name === 'sp' || name === 'cxnSp') return parseShape(el, ctx)
  if (name === 'pic') return parsePicture(el, ctx, partPath, rels)
  if (name === 'graphicFrame') return parseTable(el, ctx, partPath, rels)
  if (name === 'grpSp') return parseGroup(el, ctx, partPath, rels)
  return null
}

async function parseElementList(
  container: Element,
  ctx: SlideLoadContext,
  partPath: string,
  rels: RelMap
): Promise<SlideElement[]> {
  const out: SlideElement[] = []
  for (const el of shapeChildren(container)) {
    const parsed = await parseElement(el, ctx, partPath, rels)
    if (parsed) out.push(parsed)
  }
  return out
}

/**
 * Parse one slide part into a renderable model.
 *
 * Layout and master inheritance is applied for the background only; placeholder
 * geometry is taken from the slide itself, which is what every deck produced by
 * PowerPoint, Keynote or LibreOffice writes.
 */
export async function parseSlide(
  ctx: SlideLoadContext,
  slidePath: string,
  slideIndex: number
): Promise<SlideModel | null> {
  const xml = await ctx.readText(slidePath)
  if (!xml) return null
  const doc = parseXml(xml)
  if (!doc) return null

  const rels = await loadRels(ctx, slidePath)
  const root = doc.documentElement

  const cSld = first(root, 'cSld')
  const spTree = cSld ? first(cSld, 'spTree') : null

  // Background: slide first, then layout, then master.
  let background: Paint | undefined
  const bgEl = cSld ? first(cSld, 'bg') : null
  if (bgEl) {
    const bgPr = first(bgEl, 'bgPr')
    background = bgPr ? blipFill(bgPr, ctx, slidePath, rels) : undefined
  }

  let layoutName: string | undefined
  if (!background) {
    const layoutRel = Array.from(rels.values()).find((rel) => rel.type.endsWith('/slideLayout'))
    if (layoutRel) {
      const layoutPath = resolvePartTarget(slidePath, layoutRel.target)
      const layoutXml = await ctx.readText(layoutPath)
      if (layoutXml) {
        const layoutDoc = parseXml(layoutXml)
        if (layoutDoc) {
          layoutName = attr(first(layoutDoc.documentElement, 'cSld'), 'name') ?? undefined
          const layoutCtx = first(first(layoutDoc.documentElement, 'cSld') ?? layoutDoc.documentElement, 'bg')
          const layoutBgPr = layoutCtx ? first(layoutCtx, 'bgPr') : null
          if (layoutBgPr) {
            const layoutRels = await loadRels(ctx, layoutPath)
            background = blipFill(layoutBgPr, ctx, layoutPath, layoutRels)
          }
        }
      }
    }
  }

  const elements = spTree ? await parseElementList(spTree, ctx, slidePath, rels) : []

  const complex =
    (spTree ? descendants(spTree, 'graphicFrame').some(hasComplexContent) : false) ||
    (spTree ? descendants(spTree, 'oleObj').length > 0 : false)

  const timing = first(root, 'timing')
  const steps = parseAnimations(timing)

  return {
    index: slideIndex,
    size: ctx.slideSize,
    background: background ?? { kind: 'solid', color: '#ffffff' },
    elements,
    steps,
    hasComplexObjects: complex,
    layoutName
  }
}

/** Load the theme part for a deck, falling back to PowerPoint defaults. */
export async function loadTheme(ctx: {
  readText(partPath: string): Promise<string | null>
  themePaths: string[]
}): Promise<Theme> {
  for (const path of ctx.themePaths) {
    const xml = await ctx.readText(path)
    if (xml) return parseTheme(xml)
  }
  return parseTheme('')
}

export { emu, first, child, children, attr, localName }
