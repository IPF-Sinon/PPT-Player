/**
 * Text body parsing.
 *
 * A teaching deck lives or dies on its text: bullet levels, per-run emphasis and
 * paragraph alignment all have to survive. Sizes are converted to px once, and
 * bullet glyphs are resolved to a literal character so the renderer never needs to
 * know about numbering schemes.
 */

import type { TextBody, TextParagraph, TextRun } from './types'
import { emu, resolveColor } from './fill'
import type { Theme } from './theme'
import { attr, attrBool, attrNum, child, children, first, localName } from './xml'

/** Default size when neither the run, the paragraph nor the list style says. */
const DEFAULT_SIZE_PX = 18

function resolveFont(rPr: Element | null, theme: Theme, isHeading: boolean): string | undefined {
  if (!rPr) return undefined
  const latin = child(rPr, 'latin')
  const ea = child(rPr, 'ea')
  const direct = attr(latin, 'typeface') ?? attr(ea, 'typeface')
  if (direct && !direct.startsWith('+')) return direct
  if (direct === '+mj-lt') return theme.fonts.majorLatin
  if (direct === '+mn-lt') return theme.fonts.minorLatin
  if (direct === '+mj-ea') return theme.fonts.majorEastAsian
  if (direct === '+mn-ea') return theme.fonts.minorEastAsian
  return isHeading ? theme.fonts.majorLatin : theme.fonts.minorLatin
}

/** Bullet glyph for a paragraph, from the explicit buChar or the auto numbering. */
function bulletFor(pPr: Element | null, level: number): { char: string; indent: number } | undefined {
  if (!pPr) return undefined
  if (child(pPr, 'buNone')) return undefined

  const buChar = child(pPr, 'buChar')
  if (buChar) {
    const char = attr(buChar, 'char') ?? '•'
    return { char, indent: 18 + level * 18 }
  }

  const buAutoNum = child(pPr, 'buAutoNum')
  if (buAutoNum) {
    const type = attr(buAutoNum, 'type') ?? 'arabicPeriod'
    const marker = type.startsWith('arabic') ? '1.' : type.startsWith('alphaLc') ? 'a.' : '•'
    return { char: marker, indent: 18 + level * 18 }
  }

  // Paragraphs at level 0 without an explicit bullet are usually body text, but
  // PowerPoint still shows a bullet when the list style asks for one, so default
  // to a bullet for indented levels only.
  if (level > 0) return { char: '•', indent: 18 + level * 18 }
  return undefined
}

function parseRun(r: Element, theme: Theme, defaultSize: number): TextRun | null {
  const t = child(r, 't')
  if (!t) return null
  const content = t.textContent ?? ''
  if (content === '') return { text: '', size: defaultSize }

  const rPr = child(r, 'rPr')
  const sizeRaw = attrNum(rPr, 'sz', 0)
  const size = sizeRaw > 0 ? (sizeRaw / 100) * (96 / 72) : defaultSize
  const baseline = attrNum(rPr, 'baseline', 0)

  const solidFill = child(rPr, 'solidFill')
  const colorEl = solidFill
    ? first(solidFill, 'srgbClr') ?? first(solidFill, 'schemeClr') ?? first(solidFill, 'prstClr')
    : null
  const color = resolveColor(colorEl, theme) ?? undefined

  const highlightEl = first(rPr, 'highlight')
  const highlightColor = highlightEl
    ? resolveColor(first(highlightEl, 'srgbClr') ?? first(highlightEl, 'schemeClr'), theme) ?? undefined
    : undefined

  const spc = attrNum(rPr, 'spc', 0)

  return {
    text: content,
    bold: attrBool(rPr, 'b'),
    italic: attrBool(rPr, 'i'),
    underline: attr(rPr, 'u') !== null && attr(rPr, 'u') !== 'none',
    strike: attr(rPr, 'strike') !== null && attr(rPr, 'strike') !== 'noStrike',
    size,
    fontFamily: resolveFont(rPr, theme, size >= DEFAULT_SIZE_PX * 1.6),
    color,
    baseline: baseline !== 0 ? (baseline / 100000) * size : undefined,
    letterSpacing: spc !== 0 ? (spc / 100) * (96 / 72) : undefined,
    highlight: highlightColor
  }
}

function parseParagraph(p: Element, theme: Theme, defaultSize: number): TextParagraph {
  const pPr = child(p, 'pPr')
  const level = attrNum(pPr, 'lvl', 0)
  const alignRaw = attr(pPr, 'algn') ?? 'left'
  const align =
    alignRaw === 'ctr' ? 'center' : alignRaw === 'r' ? 'right' : alignRaw === 'just' ? 'justify' : 'left'

  const runs: TextRun[] = []
  for (const node of Array.from(p.childNodes)) {
    const el = node as Element
    if (el.nodeType !== 1) continue
    const name = localName(el)
    if (name === 'r') {
      const run = parseRun(el, theme, defaultSize)
      if (run) runs.push(run)
    } else if (name === 'br') {
      runs.push({ text: '\n', size: defaultSize })
    } else if (name === 'fld') {
      const t = child(el, 't')
      if (t) runs.push({ text: t.textContent ?? '', size: defaultSize })
    }
  }

  const lnSpc = first(pPr, 'lnSpc')
  const lnSpcPct = lnSpc ? attrNum(first(lnSpc, 'spcPct'), 'val', 0) : 0
  const lnSpcPts = lnSpc ? attrNum(first(lnSpc, 'spcPts'), 'val', 0) : 0

  const spcBef = first(pPr, 'spcBef')
  const spcAft = first(pPr, 'spcAft')
  const beforePts = spcBef ? attrNum(first(spcBef, 'spcPts'), 'val', 0) : 0
  const afterPts = spcAft ? attrNum(first(spcAft, 'spcPts'), 'val', 0) : 0

  return {
    runs: runs.length > 0 ? runs : [{ text: '', size: defaultSize }],
    align,
    level,
    lineHeight:
      lnSpcPct > 0
        ? (lnSpcPct / 100000) * 1.2
        : lnSpcPts > 0
          ? (lnSpcPts / 100) * (96 / 72)
          : undefined,
    spaceBefore: beforePts > 0 ? (beforePts / 100) * (96 / 72) : undefined,
    spaceAfter: afterPts > 0 ? (afterPts / 100) * (96 / 72) : undefined,
    bullet: bulletFor(pPr, level)
  }
}

/** Parse a txBody element into a TextBody, or null when it holds no text. */
export function parseTextBody(txBody: Element | null, theme: Theme): TextBody | null {
  if (!txBody) return null

  const bodyPr = first(txBody, 'bodyPr')
  const paragraphs: TextParagraph[] = []
  const defaultSize = DEFAULT_SIZE_PX

  for (const p of children(txBody, 'p')) {
    const paragraph = parseParagraph(p, theme, defaultSize)
    // Keep genuinely empty paragraphs: they carry the blank line a presenter wrote.
    paragraphs.push(paragraph)
  }

  if (paragraphs.length === 0) return null

  const hasText = paragraphs.some((p) => p.runs.some((r) => r.text.trim() !== ''))
  if (!hasText) return null

  const anchorRaw = attr(bodyPr, 'anchor') ?? 't'
  const anchor = anchorRaw === 'ctr' ? 'middle' : anchorRaw === 'b' ? 'bottom' : 'top'
  const wrap = attr(bodyPr, 'wrap') !== 'none'

  return {
    paragraphs,
    inset: {
      left: emu(attrNum(bodyPr, 'lIns', 91440)),
      right: emu(attrNum(bodyPr, 'rIns', 91440)),
      top: emu(attrNum(bodyPr, 'tIns', 45720)),
      bottom: emu(attrNum(bodyPr, 'bIns', 45720))
    },
    anchor,
    wrap
  }
}

/** True when the text body carries no visible characters. */
export function isBlankText(body: TextBody | null): boolean {
  if (!body) return true
  return body.paragraphs.every((p) => p.runs.every((r) => r.text.trim() === ''))
}
