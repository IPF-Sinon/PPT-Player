/**
 * Style, theme and colour resolution for a Word document.
 *
 * A .docx states very little formatting directly: a paragraph says "I am Heading 2"
 * and the answer to what that looks like lives in styles.xml, possibly through a
 * basedOn chain, with docDefaults underneath. Resolving that chain here is what
 * makes a plain document render as the author saw it rather than as flat text.
 */

import type { DocxAlign } from './types'
import { attr, attrNum, child, children, first, localName } from '../pptx/xml'

/** One level of a style chain: a named style, or the document defaults. */
export interface StyleLevel {
  /** Style display name, e.g. "heading 1"; empty for the document defaults. */
  name: string
  /** The level's w:pPr, or null when it declares none. */
  pPr: Element | null
  /** The level's w:rPr, or null when it declares none. */
  rPr: Element | null
}

/** Theme fonts and colours, as a Word document references them. */
export interface DocxTheme {
  majorLatin?: string
  minorLatin?: string
  majorEastAsian?: string
  minorEastAsian?: string
  colors: Record<string, string>
}

const EMPTY_THEME: DocxTheme = { colors: {} }

/** Word's themeColor names, mapped onto the DrawingML slots a theme declares. */
const THEME_SLOT: Record<string, string> = {
  dark1: 'dk1',
  light1: 'lt1',
  dark2: 'dk2',
  light2: 'lt2',
  text1: 'dk1',
  background1: 'lt1',
  text2: 'dk2',
  background2: 'lt2',
  accent1: 'accent1',
  accent2: 'accent2',
  accent3: 'accent3',
  accent4: 'accent4',
  accent5: 'accent5',
  accent6: 'accent6',
  hyperlink: 'hlink',
  followedhyperlink: 'folHlink'
}

function parseXmlOrNull(xml: string): Document | null {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) return null
  return doc
}

/**
 * Read the theme part.
 *
 * Only the fonts and the colour scheme are used: a Word document references them
 * for "+mn-lt" font names and for themeColor on a run, and both appear in every
 * document produced since 2007. A missing theme is normal for a minimal file, so
 * it degrades to no theme rather than failing the parse.
 */
export function parseDocxTheme(xml: string | null): DocxTheme {
  if (!xml) return EMPTY_THEME
  const doc = parseXmlOrNull(xml)
  if (!doc) return EMPTY_THEME
  const root = doc.documentElement

  const theme: DocxTheme = { colors: {} }
  const major = first(root, 'majorFont')
  const minor = first(root, 'minorFont')
  if (major) {
    theme.majorLatin = attr(first(major, 'latin'), 'typeface') ?? undefined
    theme.majorEastAsian = attr(first(major, 'ea'), 'typeface') ?? undefined
  }
  if (minor) {
    theme.minorLatin = attr(first(minor, 'latin'), 'typeface') ?? undefined
    theme.minorEastAsian = attr(first(minor, 'ea'), 'typeface') ?? undefined
  }

  // a:clrScheme declares the twelve slots by name; each holds one colour child.
  const scheme = first(root, 'clrScheme')
  if (scheme) {
    for (const node of Array.from(scheme.childNodes)) {
      const el = node as Element
      if (el.nodeType !== 1) continue
      const colorEl = first(el, 'srgbClr') ?? first(el, 'sysClr')
      if (!colorEl) continue
      const value = attr(colorEl, 'val') ?? attr(colorEl, 'lastClr')
      if (value) theme.colors[localName(el)] = '#' + value.toLowerCase()
    }
  }
  return theme
}

interface StyleRecord {
  name: string
  basedOn: string | null
  pPr: Element | null
  rPr: Element | null
}

/**
 * The resolved style sheet: the document defaults plus every named style.
 *
 * Lookups walk from the paragraph's own style up its basedOn chain, so a style
 * that only sets a colour still inherits its font, size and indent from its base.
 */
export class StyleSheet {
  private readonly byId = new Map<string, StyleRecord>()
  private readonly defaults: StyleLevel

  constructor(stylesXml: string | null) {
    let defaultPPr: Element | null = null
    let defaultRPr: Element | null = null

    if (stylesXml) {
      const root = parseXmlOrNull(stylesXml)?.documentElement ?? null
      if (root) {
        const defaults = child(root, 'docDefaults')
        if (defaults) {
          defaultPPr = child(child(defaults, 'pPrDefault'), 'pPr')
          defaultRPr = child(child(defaults, 'rPrDefault'), 'rPr')
        }
        for (const style of children(root, 'style')) {
          const id = attr(style, 'styleId')
          if (!id) continue
          this.byId.set(id, {
            name: attr(child(style, 'name'), 'val') ?? id,
            basedOn: attr(child(style, 'basedOn'), 'val'),
            pPr: child(style, 'pPr'),
            rPr: child(style, 'rPr')
          })
        }
      }
    }

    this.defaults = { name: '', pPr: defaultPPr, rPr: defaultRPr }
  }

  /** The display name of a style id, e.g. "heading 1". */
  nameOf(styleId: string | null): string {
    if (!styleId) return ''
    return this.byId.get(styleId)?.name ?? styleId
  }

  /**
   * The chain of style levels for a style id, most specific first.
   *
   * The walk is bounded: a styles.xml with a basedOn cycle is malformed, but a
   * malformed file must not hang the renderer.
   */
  chain(styleId: string | null): StyleLevel[] {
    const out: StyleLevel[] = []
    let current = styleId
    const seen = new Set<string>()
    while (current && !seen.has(current) && seen.size < 32) {
      seen.add(current)
      const style = this.byId.get(current)
      if (!style) break
      out.push({ name: style.name, pPr: style.pPr, rPr: style.rPr })
      current = style.basedOn
    }
    out.push(this.defaults)
    return out
  }
}

/**
 * Merge a property object across a style chain, one property at a time.
 *
 * Word's rule is "the nearest definition wins, per property": a paragraph can
 * inherit its alignment from a style while overriding only its indent, so taking a
 * whole level at once would lose half of what the author set.
 */
export function mergeChain<T extends object>(
  chain: StyleLevel[],
  read: (level: StyleLevel) => T | undefined
): T {
  const out = {} as T
  for (const level of chain) {
    const value = read(level)
    if (!value) continue
    for (const key of Object.keys(value) as Array<keyof T>) {
      if (out[key] === undefined) out[key] = value[key]
    }
  }
  return out
}

/** Read an on/off property, which Word writes as a val that defaults to true. */
export function toggle(node: Element | null): boolean | undefined {
  if (!node) return undefined
  const raw = attr(node, 'val')
  if (raw === null) return true
  const value = raw.toLowerCase()
  return !(value === '0' || value === 'false' || value === 'off' || value === 'none')
}

/** Read w:jc into the renderer's alignment vocabulary. */
export function alignment(value: string | null | undefined): DocxAlign | undefined {
  if (!value) return undefined
  switch (value.toLowerCase()) {
    case 'center':
      return 'center'
    case 'right':
    case 'end':
      return 'right'
    case 'both':
    case 'distribute':
    case 'thaiDistribute':
      return 'justify'
    case 'left':
    case 'start':
      return 'left'
    default:
      return undefined
  }
}

/**
 * Resolve a w:color element into a CSS colour.
 *
 * A colour is either a literal hex value or a theme slot; Word writes the literal
 * as well as the slot when it wants a document to survive a theme change, so the
 * literal is preferred and the slot is the fallback.
 */
export function colorValue(node: Element | null, theme: DocxTheme): string | undefined {
  if (!node) return undefined
  const direct = attr(node, 'val')
  if (direct && /^[0-9a-fA-F]{6}$/.test(direct)) return '#' + direct.toLowerCase()

  const slot = THEME_SLOT[(attr(node, 'themeColor') ?? '').toLowerCase()]
  const themed = slot ? theme.colors[slot] : undefined
  if (themed) return themed

  if (direct && direct.toLowerCase() !== 'auto') return '#' + direct.toLowerCase()
  return undefined
}

/**
 * Read w:shd into a CSS colour.
 *
 * A shading with fill="auto" and no pattern is no shading at all; treating it as
 * white would paint over whatever the cell or paragraph should show through.
 */
export function shadingColor(node: Element | null): string | undefined {
  if (!node) return undefined
  const fill = attr(node, 'fill')
  if (!fill || !/^[0-9a-fA-F]{6}$/.test(fill)) return undefined
  return '#' + fill.toLowerCase()
}

/**
 * w:sz is half-points; w:szCs is the same for complex script text.
 *
 * Both are child elements of w:rPr carrying w:val, not attributes on w:rPr itself.
 */
export function fontSize(rPr: Element | null): number | undefined {
  if (!rPr) return undefined
  const sz = attrNum(child(rPr, 'sz'), 'val', 0)
  if (sz > 0) return sz
  const szCs = attrNum(child(rPr, 'szCs'), 'val', 0)
  return szCs > 0 ? szCs : undefined
}

/** The font a run names, preferring the Latin face and resolving theme aliases. */
export function fontName(rPr: Element | null, theme: DocxTheme): string | undefined {
  if (!rPr) return undefined
  const fonts = child(rPr, 'rFonts')
  if (!fonts) return undefined
  const direct = attr(fonts, 'ascii') ?? attr(fonts, 'hAnsi') ?? attr(fonts, 'eastAsia')
  if (direct && !direct.startsWith('+')) return direct
  if (direct === '+mj-lt') return theme.majorLatin
  if (direct === '+mn-lt') return theme.minorLatin
  if (direct === '+mj-ea') return theme.majorEastAsian
  if (direct === '+mn-ea') return theme.minorEastAsian
  return undefined
}
