/**
 * Data model for the native PPTX renderer.
 *
 * Everything is expressed in slide-local pixels. OOXML stores geometry in EMU
 * (914400 per inch); the parser converts once so the renderer never has to think
 * about units.
 */

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Rect extends Point, Size {}

/** A colour plus the alpha it was authored with. */
export interface Paint {
  kind: 'solid' | 'gradient' | 'image' | 'none'
  color?: string
  alpha?: number
  /** Gradient stops, already ordered. */
  stops?: Array<{ offset: number; color: string; alpha?: number }>
  /** Gradient angle in degrees, 0 = left to right. */
  angle?: number
  /** Image reference for a blip fill. */
  imageRef?: string
  /** How an image fill is scaled into the shape. */
  imageMode?: 'stretch' | 'tile'
}

export interface Border {
  width: number
  paint: Paint
  dash?: 'solid' | 'dash' | 'dot' | 'dashDot'
}

export interface TextRun {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  /** Font size in px. */
  size: number
  fontFamily?: string
  color?: string
  /** Baseline shift in px, positive raises the run. */
  baseline?: number
  /** Character spacing in px. */
  letterSpacing?: number
  highlight?: string
}

export interface TextParagraph {
  runs: TextRun[]
  align: 'left' | 'center' | 'right' | 'justify'
  /** Line height in px. */
  lineHeight?: number
  /** Space before and after the paragraph, in px. */
  spaceBefore?: number
  spaceAfter?: number
  /** Indent level, 0 based. */
  level: number
  /** Bullet glyph, when the paragraph is a list item. */
  bullet?: { char: string; indent: number }
  /** Numbering, rendered as a literal prefix by the parser. */
  numberPrefix?: string
}

export interface TextBody {
  paragraphs: TextParagraph[]
  /** Inner padding of the text frame, in px. */
  inset: { left: number; right: number; top: number; bottom: number }
  /** Vertical anchoring of the whole block. */
  anchor: 'top' | 'middle' | 'bottom'
  /** True when the text should wrap inside the frame. */
  wrap: boolean
  /** Rotation of the text body itself, degrees. */
  rotation?: number
}

export type ShapeGeometry =
  | { kind: 'rect'; radius?: number }
  | { kind: 'ellipse' }
  | { kind: 'triangle' }
  | { kind: 'diamond' }
  | { kind: 'line'; from: Point; to: Point }
  | { kind: 'arrow' }
  | { kind: 'roundRect'; radius: number }
  | { kind: 'chevron' }
  | { kind: 'star' }
  | { kind: 'polygon'; points: Point[] }
  /** Anything we do not model precisely falls back to a rectangle. */
  | { kind: 'unknown' }

export interface ShapeBase {
  /** Shape id from the XML, used by the animation engine to target elements. */
  id: string
  name?: string
  rect: Rect
  /** Rotation in degrees around the centre. */
  rotation?: number
  flipH?: boolean
  flipV?: boolean
}

export interface ShapeElement extends ShapeBase {
  type: 'shape'
  geometry: ShapeGeometry
  fill: Paint
  border?: Border
  text?: TextBody
  /** Shadow preset, rendered as a CSS box-shadow when present. */
  shadow?: boolean
}

export interface PictureElement extends ShapeBase {
  type: 'picture'
  /** app://pptx/<deckId>/ppt/media/... */
  src: string
  /** Source cropping as fractions of the image, 0..1. */
  crop?: { left: number; top: number; right: number; bottom: number }
  border?: Border
}

export interface TableCell {
  text?: TextBody
  fill?: Paint
  border?: Border
  gridSpan: number
  rowSpan: number
  /** True when this cell is covered by a merge from an earlier cell. */
  merged: boolean
}

export interface TableElement extends ShapeBase {
  type: 'table'
  columnWidths: number[]
  rowHeights: number[]
  rows: TableCell[][]
}

export interface GroupElement extends ShapeBase {
  type: 'group'
  children: SlideElement[]
}

export type SlideElement = ShapeElement | PictureElement | TableElement | GroupElement

/** One click-advanced step of a slide's animation timeline. */
export interface AnimationStep {
  /** 1 based, matching the order the presenter advances through. */
  index: number
  effects: AnimationEffect[]
}

export interface AnimationEffect {
  /** Shape id the effect applies to. */
  targetId: string
  /** Paragraph range inside the target, when the effect is text-level. */
  paragraphRange?: { start: number; end: number }
  kind: 'enter' | 'exit' | 'emphasis'
  /** Visual preset, mapped to a CSS animation. */
  preset: 'appear' | 'fade' | 'fly' | 'wipe' | 'zoom' | 'spin' | 'pulse'
  /** Direction for fly and wipe. */
  direction?: 'left' | 'right' | 'up' | 'down'
  /** Delay in ms from the start of its step. */
  delay: number
  /** Duration in ms. */
  duration: number
}

export interface SlideModel {
  index: number
  size: Size
  background?: Paint
  elements: SlideElement[]
  steps: AnimationStep[]
  /** True when charts, SmartArt, equations or OLE were met on this slide. */
  hasComplexObjects: boolean
  /** Layout and master names, kept for diagnostics. */
  layoutName?: string
}

export interface NativeDeck {
  deckId: string
  /** Slide size in px. */
  size: Size
  slideCount: number
  /** Internal paths of each slide part, in presentation order. */
  slidePaths: string[]
  /** True when at least one slide has complex objects. */
  hasComplexObjects: boolean
}

/** Which elements are visible, and how they animate, for a given step. */
export interface StepState {
  visible: Set<string>
  /** Element id to the animation it should play when it appears. */
  entering: Map<string, AnimationEffect>
  /** Element id to the animation it should play when it leaves. */
  leaving: Map<string, AnimationEffect>
  /** Paragraph ranges that are still hidden on a partially revealed text box. */
  hiddenParagraphs: Map<string, Array<{ start: number; end: number }>>
}
