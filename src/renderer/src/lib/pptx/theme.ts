/**
 * Colour and font resolution for the native PPTX renderer.
 *
 * OOXML rarely names a literal colour: shapes reference theme slots like
 * `accent1` or `tx1`, often with a lumMod/lumOff transform applied. Resolving
 * those against the deck's theme is what makes a deck look like itself instead of
 * a grey wireframe.
 */

import { attr, child, children, first, localName, parseXml } from './xml'

export interface ThemeColors {
  dk1: string
  lt1: string
  dk2: string
  lt2: string
  accent1: string
  accent2: string
  accent3: string
  accent4: string
  accent5: string
  accent6: string
  hlink: string
  folHlink: string
  /** Background and text colours from the theme's format scheme. */
  bg1: string
  tx1: string
  bg2: string
  tx2: string
}

export interface ThemeFonts {
  majorLatin: string
  minorLatin: string
  majorEastAsian: string
  minorEastAsian: string
}

export interface Theme {
  colors: ThemeColors
  fonts: ThemeFonts
}

/** PowerPoint's own defaults, used when a deck omits the theme part. */
export const DEFAULT_THEME: Theme = {
  colors: {
    dk1: '#000000',
    lt1: '#ffffff',
    dk2: '#44546a',
    lt2: '#e7e6e6',
    accent1: '#4472c4',
    accent2: '#ed7d31',
    accent3: '#a5a5a5',
    accent4: '#ffc000',
    accent5: '#5b9bd5',
    accent6: '#70ad47',
    hlink: '#0563c1',
    folHlink: '#954f72',
    bg1: '#ffffff',
    tx1: '#000000',
    bg2: '#e7e6e6',
    tx2: '#44546a'
  },
  fonts: {
    majorLatin: 'Calibri Light',
    minorLatin: 'Calibri',
    majorEastAsian: 'Microsoft YaHei',
    minorEastAsian: 'Microsoft YaHei'
  }
}

function hex(value: string | null, fallback: string): string {
  if (!value) return fallback
  const clean = value.replace(/^#/, '').trim()
  if (/^[0-9a-f]{6}$/i.test(clean)) return '#' + clean.toLowerCase()
  if (/^[0-9a-f]{3}$/i.test(clean)) {
    return '#' + clean.split('').map((c) => c + c).join('').toLowerCase()
  }
  return fallback
}

/** Read the first clrScheme entry whose local name matches. */
function schemeColor(scheme: Element | null, name: string, fallback: string): string {
  if (!scheme) return fallback
  const list = scheme.childNodes
  for (let i = 0; i < list.length; i++) {
    const el = list[i] as Element
    if (el.nodeType !== 1) continue
    if (localName(el) !== name) continue
    const srgb = first(el, 'srgbClr')
    const srgbVal = attr(srgb, 'val')
    if (srgbVal) return hex(srgbVal, fallback)
    const sys = first(el, 'sysClr')
    const sysVal = attr(sys, 'lastClr')
    if (sysVal) return hex(sysVal, fallback)
  }
  return fallback
}

function fontOf(collection: Element | null, tag: string, fallback: string): string {
  if (!collection) return fallback
  for (const item of children(collection, tag)) {
    const latin = child(item, 'latin')
    const ea = child(item, 'ea')
    const value = attr(latin, 'typeface') ?? attr(ea, 'typeface')
    if (value && !value.startsWith('+')) return value
  }
  return fallback
}

/** Parse theme1.xml into colours and fonts. */
export function parseTheme(xmlText: string): Theme {
  const doc = parseXml(xmlText)
  if (!doc) return DEFAULT_THEME

  const scheme = first(doc.documentElement, 'clrScheme')
  const colors: ThemeColors = {
    dk1: schemeColor(scheme, 'dk1', DEFAULT_THEME.colors.dk1),
    lt1: schemeColor(scheme, 'lt1', DEFAULT_THEME.colors.lt1),
    dk2: schemeColor(scheme, 'dk2', DEFAULT_THEME.colors.dk2),
    lt2: schemeColor(scheme, 'lt2', DEFAULT_THEME.colors.lt2),
    accent1: schemeColor(scheme, 'accent1', DEFAULT_THEME.colors.accent1),
    accent2: schemeColor(scheme, 'accent2', DEFAULT_THEME.colors.accent2),
    accent3: schemeColor(scheme, 'accent3', DEFAULT_THEME.colors.accent3),
    accent4: schemeColor(scheme, 'accent4', DEFAULT_THEME.colors.accent4),
    accent5: schemeColor(scheme, 'accent5', DEFAULT_THEME.colors.accent5),
    accent6: schemeColor(scheme, 'accent6', DEFAULT_THEME.colors.accent6),
    hlink: schemeColor(scheme, 'hlink', DEFAULT_THEME.colors.hlink),
    folHlink: schemeColor(scheme, 'folHlink', DEFAULT_THEME.colors.folHlink),
    bg1: DEFAULT_THEME.colors.bg1,
    tx1: DEFAULT_THEME.colors.tx1,
    bg2: DEFAULT_THEME.colors.bg2,
    tx2: DEFAULT_THEME.colors.tx2
  }
  // bg/tx slots alias the dark/light pairs, and which is which depends on the theme.
  colors.tx1 = colors.dk1
  colors.bg1 = colors.lt1
  colors.tx2 = colors.dk2
  colors.bg2 = colors.lt2

  const fontScheme = first(doc.documentElement, 'fontScheme')
  const fonts: ThemeFonts = {
    majorLatin: fontOf(child(fontScheme, 'majorFont'), 'latin', DEFAULT_THEME.fonts.majorLatin),
    minorLatin: fontOf(child(fontScheme, 'minorFont'), 'latin', DEFAULT_THEME.fonts.minorLatin),
    majorEastAsian: fontOf(child(fontScheme, 'majorFont'), 'ea', DEFAULT_THEME.fonts.majorEastAsian),
    minorEastAsian: fontOf(child(fontScheme, 'minorFont'), 'ea', DEFAULT_THEME.fonts.minorEastAsian)
  }

  return { colors, fonts }
}

/** Parse a colour string like #rrggbb into components. */
export function toRgb(color: string): { r: number; g: number; b: number } {
  const clean = color.replace('#', '')
  return {
    r: parseInt(clean.slice(0, 2), 16) || 0,
    g: parseInt(clean.slice(2, 4), 16) || 0,
    b: parseInt(clean.slice(4, 6), 16) || 0
  }
}

export function fromRgb(r: number, g: number, b: number): string {
  const clamp = (v: number): number => Math.max(0, Math.min(255, Math.round(v)))
  return '#' + [clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** Apply the luminance transforms OOXML uses to derive shades from theme slots. */
export function applyLum(color: string, lumMod?: number, lumOff?: number): string {
  if (lumMod === undefined && lumOff === undefined) return color
  const { r, g, b } = toRgb(color)
  const mod = lumMod ?? 1
  const off = (lumOff ?? 0) * 255
  return fromRgb(r * mod + off, g * mod + off, b * mod + off)
}

/** Blend a colour towards white or black by the given tint/shade factor. */
export function applyTint(color: string, tint?: number, shade?: number): string {
  const { r, g, b } = toRgb(color)
  if (tint !== undefined) {
    return fromRgb(r + (255 - r) * tint, g + (255 - g) * tint, b + (255 - b) * tint)
  }
  if (shade !== undefined) {
    return fromRgb(r * shade, g * shade, b * shade)
  }
  return color
}
