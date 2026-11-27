/**
 * Paint, colour and geometry resolution for OOXML shapes.
 *
 * These are the pieces every element type shares: reading a colour that may be a
 * literal, a theme slot or a preset, resolving a fill of any of the four kinds, and
 * turning preset geometry names into something the renderer can draw.
 */

import type { Border, Paint, ShapeGeometry } from './types'
import { applyLum, applyTint, type Theme } from './theme'
import { attr, attrBool, attrNum, child, children, descendants, first, localName } from './xml'

/** EMU per CSS pixel at 96 DPI. */
export const EMU_PER_PX = 914400 / 96

export function emu(value: number): number {
  return value / EMU_PER_PX
}

/** Theme slots a colour element may reference. */
const THEME_SLOTS = new Set([
  'dk1', 'lt1', 'dk2', 'lt2',
  'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6',
  'hlink', 'folHlink', 'bg1', 'tx1', 'bg2', 'tx2',
  'phClr'
])

/** Preset colour names OOXML allows, mapped to their values. */
const PRESET_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  gray: '#808080',
  grey: '#808080',
  darkGray: '#a9a9a9',
  lightGray: '#d3d3d3',
  orange: '#ffa500',
  purple: '#800080',
  brown: '#a52a2a',
  pink: '#ffc0cb'
}

/**
 * Resolve a colour element (srgbClr, schemeClr, prstClr, sysClr) to a hex string.
 * `placeholder` is the colour a phClr reference resolves to.
 */
export function resolveColor(
  node: Element | null,
  theme: Theme,
  placeholder?: string
): string | null {
  if (!node) return null
  const name = localName(node)

  if (name === 'srgbClr') return '#' + (attr(node, 'val') ?? '000000').toLowerCase()

  if (name === 'schemeClr') {
    const slot = attr(node, 'val') ?? ''
    if (slot === 'phClr') return placeholder ?? null
    const base =
      (theme.colors as unknown as Record<string, string>)[slot] ??
      (THEME_SLOTS.has(slot) ? theme.colors.accent1 : null)
    if (!base) return null
    const lumMod = attrNum(first(node, 'lumMod'), 'val', NaN)
    const lumOff = attrNum(first(node, 'lumOff'), 'val', NaN)
    const tint = attrNum(first(node, 'tint'), 'val', NaN)
    const shade = attrNum(first(node, 'shade'), 'val', NaN)
    let out = base
    if (!Number.isNaN(lumMod) || !Number.isNaN(lumOff)) {
      out = applyLum(
        out,
        Number.isNaN(lumMod) ? undefined : lumMod / 100000,
        Number.isNaN(lumOff) ? undefined : lumOff / 100000
      )
    }
    if (!Number.isNaN(tint)) out = applyTint(out, tint / 100000)
    if (!Number.isNaN(shade)) out = applyTint(out, undefined, shade / 100000)
    return out
  }

  if (name === 'prstClr') {
    const preset = attr(node, 'val') ?? ''
    return PRESET_COLORS[preset] ?? null
  }

  if (name === 'sysClr') {
    const last = attr(node, 'lastClr')
    if (last) return '#' + last.toLowerCase()
    return attr(node, 'val') === 'window' ? '#ffffff' : '#000000'
  }

  return null
}

/** Find the colour child of a container and resolve it. */
function colorIn(container: Element | null, theme: Theme, placeholder?: string): string | null {
  if (!container) return null
  const list = container.childNodes
  for (let i = 0; i < list.length; i++) {
    const el = list[i] as Element
    if (el.nodeType !== 1) continue
    const name = localName(el)
    if (name === 'srgbClr' || name === 'schemeClr' || name === 'prstClr' || name === 'sysClr') {
      return resolveColor(el, theme, placeholder)
    }
  }
  return null
}

/** Read the alpha of a colour element, as a 0..1 multiplier. */
function alphaIn(container: Element | null): number | undefined {
  if (!container) return undefined
  const alpha = first(container, 'alpha')
  if (!alpha) return undefined
  const value = attrNum(alpha, 'val', 100000)
  return value / 100000
}

/**
 * Resolve a fill container (spPr, bgPr, tcPr) into a Paint.
 * Returns undefined when the element declares no fill at all, which means inherit.
 */
export function resolveFill(
  container: Element | null,
  theme: Theme,
  placeholder?: string,
  imageResolver?: (relId: string) => string | null
): Paint | undefined {
  if (!container) return undefined

  const noFill = child(container, 'noFill')
  if (noFill) return { kind: 'none' }

  const solid = child(container, 'solidFill')
  if (solid) {
    const color = colorIn(solid, theme, placeholder)
    if (!color) return undefined
    const alpha = alphaIn(first(solid, 'srgbClr') ?? first(solid, 'schemeClr') ?? null)
    return { kind: 'solid', color, alpha }
  }

  const grad = child(container, 'gradFill')
  if (grad) {
    const stops: Array<{ offset: number; color: string; alpha?: number }> = []
    for (const gs of descendants(grad, 'gs')) {
      const pos = attrNum(gs, 'pos', 0) / 100000
      const color = colorIn(gs, theme, placeholder)
      if (!color) continue
      const alpha = alphaIn(gs)
      stops.push({ offset: pos, color, alpha })
    }
    const linear = first(grad, 'lin')
    const angle = linear ? attrNum(linear, 'ang', 0) / 60000 : 90
    if (stops.length === 0) return { kind: 'none' }
    if (stops.length === 1) return { kind: 'solid', color: stops[0].color, alpha: stops[0].alpha }
    return { kind: 'gradient', stops, angle }
  }

  const blip = child(container, 'blipFill')
  if (blip) {
    const blipEl = first(blip, 'blip')
    const embed = attr(blipEl, 'embed') ?? attr(blipEl, 'link')
    if (!embed) return { kind: 'none' }
    const src = imageResolver ? imageResolver(embed) : null
    if (!src) return { kind: 'none' }
    const tile = first(blip, 'tile')
    return { kind: 'image', imageRef: src, imageMode: tile ? 'tile' : 'stretch' }
  }

  const grpFill = child(container, 'grpFill')
  if (grpFill) return undefined

  return undefined
}

/** Resolve a border (ln) element. */
export function resolveBorder(
  container: Element | null,
  theme: Theme,
  placeholder?: string
): Border | undefined {
  if (!container) return undefined
  const ln = child(container, 'ln')
  if (!ln) return undefined
  if (child(ln, 'noFill')) return undefined

  const widthEmu = attrNum(ln, 'w', 0)
  const width = widthEmu > 0 ? Math.max(0.5, emu(widthEmu)) : 1
  const fill = resolveFill(ln, theme, placeholder)
  if (!fill || fill.kind === 'none') return undefined

  const dashEl = child(ln, 'prstDash')
  const dashVal = attr(dashEl, 'val') ?? 'solid'
  const dash =
    dashVal === 'dash' || dashVal === 'sysDash'
      ? 'dash'
      : dashVal === 'dot' || dashVal === 'sysDot'
        ? 'dot'
        : dashVal === 'dashDot' || dashVal === 'sysDashDot'
          ? 'dashDot'
          : 'solid'

  return { width, paint: fill, dash }
}

/** Resolve a rect from an xfrm element, in px. */
export function resolveTransform(
  xfrm: Element | null
): { x: number; y: number; width: number; height: number; rotation?: number; flipH?: boolean; flipV?: boolean } | null {
  if (!xfrm) return null
  const off = child(xfrm, 'off')
  const ext = child(xfrm, 'ext')
  if (!off || !ext) return null
  const rotation = attrNum(xfrm, 'rot', 0) / 60000
  return {
    x: emu(attrNum(off, 'x', 0)),
    y: emu(attrNum(off, 'y', 0)),
    width: emu(attrNum(ext, 'cx', 0)),
    height: emu(attrNum(ext, 'cy', 0)),
    rotation: rotation !== 0 ? rotation : undefined,
    flipH: attrBool(xfrm, 'flipH'),
    flipV: attrBool(xfrm, 'flipV')
  }
}

/**
 * Map a preset geometry name to something drawable.
 *
 * Only the shapes that actually appear in teaching decks are modelled precisely;
 * everything else degrades to a rectangle rather than disappearing, so content is
 * never silently lost.
 */
export function resolveGeometry(preset: string | null, rect: { width: number; height: number }): ShapeGeometry {
  const name = (preset ?? 'rect').toLowerCase()

  if (name === 'line' || name === 'straightconnector1') {
    return { kind: 'line', from: { x: 0, y: 0 }, to: { x: rect.width, y: rect.height } }
  }
  if (name === 'ellipse' || name === 'circle' || name === 'oval') return { kind: 'ellipse' }
  if (name === 'triangle' || name === 'rtTriangle') return { kind: 'triangle' }
  if (name === 'diamond') return { kind: 'diamond' }
  if (name === 'roundRect' || name === 'round1Rect' || name === 'round2SameRect') {
    return { kind: 'roundRect', radius: Math.min(rect.width, rect.height) * 0.12 }
  }
  if (name === 'chevron' || name === 'homePlate') return { kind: 'chevron' }
  if (name === 'star5' || name === 'star4' || name === 'star6') return { kind: 'star' }
  if (name.includes('arrow')) return { kind: 'arrow' }
  if (name === 'rect' || name === 'rectangle' || name === 'textbox') return { kind: 'rect' }
  if (name === 'parallelogram' || name === 'trapezoid' || name === 'hexagon' || name === 'pentagon') {
    return { kind: 'polygon', points: polygonFor(name, rect) }
  }
  return { kind: 'unknown' }
}

function polygonFor(name: string, rect: { width: number; height: number }): Array<{ x: number; y: number }> {
  const w = rect.width
  const h = rect.height
  if (name === 'parallelogram') {
    const skew = w * 0.2
    return [
      { x: skew, y: 0 },
      { x: w, y: 0 },
      { x: w - skew, y: h },
      { x: 0, y: h }
    ]
  }
  if (name === 'trapezoid') {
    const inset = w * 0.2
    return [
      { x: inset, y: 0 },
      { x: w - inset, y: 0 },
      { x: w, y: h },
      { x: 0, y: h }
    ]
  }
  if (name === 'hexagon') {
    const inset = w * 0.25
    return [
      { x: inset, y: 0 },
      { x: w - inset, y: 0 },
      { x: w, y: h / 2 },
      { x: w - inset, y: h },
      { x: inset, y: h },
      { x: 0, y: h / 2 }
    ]
  }
  // pentagon
  return [
    { x: w / 2, y: 0 },
    { x: w, y: h * 0.38 },
    { x: w * 0.82, y: h },
    { x: w * 0.18, y: h },
    { x: 0, y: h * 0.38 }
  ]
}

/** Read an element's unique id, used by the animation engine. */
export function elementId(sp: Element): string {
  const nv = first(sp, 'cNvPr')
  return attr(nv, 'id') ?? ''
}

export function elementName(sp: Element): string | undefined {
  const nv = first(sp, 'cNvPr')
  const name = attr(nv, 'name')
  return name ?? undefined
}

/** Collect child elements of a container in document order. */
export function shapeChildren(spTree: Element | null): Element[] {
  if (!spTree) return []
  const out: Element[] = []
  const list = spTree.childNodes
  for (let i = 0; i < list.length; i++) {
    const el = list[i] as Element
    if (el.nodeType !== 1) continue
    const name = localName(el)
    if (name === 'sp' || name === 'pic' || name === 'graphicFrame' || name === 'grpSp' || name === 'cxnSp') {
      out.push(el)
    }
  }
  return out
}

export { children, child, attr, attrNum, attrBool, first, descendants, localName }
