/**
 * List numbering, from numbering.xml.
 *
 * Word splits a list in two: an abstract definition says what the levels look like,
 * and a num instance says which document list uses it and where each level's
 * counter starts. A renderer that reads only the abstract part restarts every list
 * at 1, which is why a second numbered list continues the first one's count.
 */

import { attr, attrNum, child, children, first } from '../pptx/xml'
import { twips } from './units'

/** One level of an abstract numbering definition. */
interface AbstractLevel {
  /** Numbering format: decimal, lowerLetter, bullet, ... */
  format: string
  /** Literal text template such as "%1." or a bullet glyph. */
  text: string
  start: number
  /** Left indent of the paragraph text, in twips. */
  indentLeft: number
  /** Hanging indent, in twips (positive values move the marker left). */
  hanging: number
  font?: string
  /** Suffix after the number: tab, space, nothing. */
  suffix: string
}

interface AbstractNum {
  levels: Map<number, AbstractLevel>
}

interface NumInstance {
  abstractId: string
  /** Per-level start overrides, keyed by ilvl. */
  starts: Map<number, number>
}

/** A resolved marker for one paragraph. */
export interface NumberingResult {
  text: string
  /** Left edge of the marker column, in px. */
  left: number
  /** Width of the marker column in px. */
  width: number
}

/**
 * The numbering state of one document.
 *
 * Counters are per num instance and per level, and they are advanced when a
 * paragraph is numbered. Levels below the one being incremented are reset, which
 * is what makes "1. a. i." restart at "a." when item 2 begins.
 */
export class Numbering {
  private readonly abstracts = new Map<string, AbstractNum>()
  private readonly nums = new Map<string, NumInstance>()
  private readonly counters = new Map<string, number[]>()

  constructor(xml: string | null) {
    if (!xml) return
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    if (doc.getElementsByTagName('parsererror').length > 0) return
    const root = doc.documentElement

    for (const abstract of children(root, 'abstractNum')) {
      const id = attr(abstract, 'abstractNumId')
      if (!id) continue
      const levels = new Map<number, AbstractLevel>()
      for (const lvl of children(abstract, 'lvl')) {
        const ilvl = attrNum(lvl, 'ilvl', 0)
        levels.set(ilvl, readLevel(lvl))
      }
      this.abstracts.set(id, { levels })
    }

    for (const num of children(root, 'num')) {
      const id = attr(num, 'numId')
      const abstractId = attr(child(num, 'abstractNumId'), 'val')
      if (!id || !abstractId) continue
      const starts = new Map<number, number>()
      for (const override of children(num, 'lvlOverride')) {
        const ilvl = attrNum(override, 'ilvl', 0)
        const start = attrNum(first(override, 'startOverride'), 'val', NaN)
        if (!Number.isNaN(start)) starts.set(ilvl, start)
      }
      this.nums.set(id, { abstractId, starts })
    }
  }

  /**
   * The marker for a numbered paragraph, and advance its counter.
   *
   * Returns null when the numId is not in numbering.xml, which is what a document
   * converted from HTML often does; the caller then draws no marker rather than
   * inventing one.
   */
  next(numId: string, level: number, fallbackIndentTwips: number): NumberingResult | null {
    const num = this.nums.get(numId)
    if (!num) return null
    const abstract = this.abstracts.get(num.abstractId)
    if (!abstract) return null

    const lvl = abstract.levels.get(level) ?? abstract.levels.get(0)
    if (!lvl) return null

    const counters = this.counters.get(numId) ?? []
    // Seed every level with its start value, so "%1.%2" prints "1.1" on the first
    // item rather than "1.0".
    for (const [ilvl, definition] of abstract.levels) {
      if (counters[ilvl] === undefined) {
        counters[ilvl] = num.starts.get(ilvl) ?? definition.start
      }
    }
    // The seeded value is what this item shows; the advance happens afterwards so
    // the marker and the counter cannot disagree.
    const current = counters[level] ?? num.starts.get(level) ?? lvl.start
    const text = formatMarker(lvl, abstract.levels, counters)

    counters[level] = current + 1
    // Deeper levels restart when a shallower one advances, so a new "1." is
    // followed by "a." rather than by the previous list's "c.".
    for (let deeper = level + 1; deeper < counters.length; deeper++) {
      const definition = abstract.levels.get(deeper)
      if (definition) counters[deeper] = num.starts.get(deeper) ?? definition.start
    }
    this.counters.set(numId, counters)
    const indentLeft = lvl.indentLeft || fallbackIndentTwips
    const hanging = Math.abs(lvl.hanging)
    // The marker column ends where the paragraph text begins.
    const left = twips(indentLeft - hanging)
    const width = Math.max(twips(hanging), twips(indentLeft) - left)

    return { text, left: Math.max(0, left), width: Math.max(0, width) }
  }

  /** Whether a level is a bullet rather than a counted item. */
  isBullet(numId: string, level: number): boolean {
    const num = this.nums.get(numId)
    if (!num) return false
    const abstract = this.abstracts.get(num.abstractId)
    const lvl = abstract?.levels.get(level) ?? abstract?.levels.get(0)
    return lvl?.format === 'bullet'
  }
}

function readLevel(lvl: Element): AbstractLevel {
  const pPr = child(lvl, 'pPr')
  const indent = child(pPr, 'ind')
  const rPr = child(lvl, 'rPr')
  return {
    format: attr(child(lvl, 'numFmt'), 'val') ?? 'decimal',
    text: attr(child(lvl, 'lvlText'), 'val') ?? '',
    start: attrNum(child(lvl, 'start'), 'val', 1),
    indentLeft: attrNum(indent, 'left', attrNum(indent, 'start', 720)),
    hanging: attrNum(indent, 'hanging', 360),
    font: attr(child(rPr, 'rFonts'), 'ascii') ?? undefined,
    suffix: attr(child(lvl, 'suff'), 'val') ?? 'tab'
  }
}

/**
 * Substitute the counters into a level's template.
 *
 * The template is a format string: "%1." at level 1 means "this level's counter,
 * then a dot", and "%1.%2" at level 2 references two different levels, each
 * written in its own level's format. Anything the template cannot express falls
 * back to the plain decimal value, which is always better than showing a raw
 * placeholder to a reader.
 */
function formatMarker(
  lvl: AbstractLevel,
  levels: Map<number, AbstractLevel>,
  counters: number[]
): string {
  if (lvl.format === 'bullet') return bulletGlyph(lvl.text)
  if (lvl.format === 'none') return ''

  const rendered = lvl.text.replace(/%(\d)/g, (_whole, index: string) => {
    const target = Number(index) - 1
    const value = counters[target] ?? 1
    // A reference to another level is written in that level's format, which is
    // what makes "1.a.i." come out right instead of "1.1.1.".
    const referenced = levels.get(target) ?? lvl
    return formatNumber(value, referenced.format)
  })

  // The marker column already provides the gap a tab would fill, so only an
  // explicit space suffix adds anything on top of it.
  return lvl.suffix === 'space' ? rendered + ' ' : rendered
}

/**
 * The character a bullet level draws.
 *
 * Word writes Symbol-font bullets as private-use code points, which the browser
 * has no glyph for; every bullet list in practice wants one of three characters.
 */
function bulletGlyph(text: string): string {
  const glyph = text.trim()
  if (!glyph || glyph === '\uF0B7' || glyph === '\u2022') return '•'
  if (glyph === 'o' || glyph === '\u25CB') return '○'
  if (glyph === '\uF0A7' || glyph === '\u25AA' || glyph === '§') return '▪'
  if (glyph === '\uF0D8') return '◆'
  return glyph
}

function formatNumber(value: number, format: string): string {
  switch (format) {
    case 'lowerLetter':
      return letters(value).toLowerCase()
    case 'upperLetter':
      return letters(value).toUpperCase()
    case 'lowerRoman':
      return roman(value).toLowerCase()
    case 'upperRoman':
      return roman(value).toUpperCase()
    case 'chineseCounting':
    case 'chineseCountingThousand':
    case 'japaneseCounting':
      return chinese(value)
    case 'ideographDigital':
      return chinese(value)
    case 'decimalZero':
      return String(value).padStart(2, '0')
    case 'none':
      return ''
    default:
      return String(value)
  }
}

function letters(value: number): string {
  if (value <= 0) return String(value)
  let out = ''
  let rest = value
  while (rest > 0) {
    const index = (rest - 1) % 26
    out = String.fromCharCode(97 + index) + out
    rest = Math.floor((rest - 1) / 26)
  }
  return out
}

function roman(value: number): string {
  if (value <= 0 || value > 3999) return String(value)
  const table: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']
  ]
  let out = ''
  let rest = value
  for (const [amount, glyph] of table) {
    while (rest >= amount) {
      out += glyph
      rest -= amount
    }
  }
  return out
}

/** Chinese counting numbers, which a teaching document written in Word uses. */
function chinese(value: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (value <= 0 || value >= 100) return String(value)
  if (value < 10) return digits[value]
  const tens = Math.floor(value / 10)
  const ones = value % 10
  const head = tens === 1 ? '十' : digits[tens] + '十'
  return ones === 0 ? head : head + digits[ones]
}
