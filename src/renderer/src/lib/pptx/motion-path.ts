/**
 * Motion path parsing.
 *
 * OOXML describes a motion path as a compact command string in a coordinate space
 * normalised to the slide: "M 0 0 L 0.5 0.25 E" means "start where the shape is,
 * move half a slide right and a quarter down". Coordinates are fractions of the
 * slide box, and the trailing E is an end marker, not a command.
 *
 * Paths are converted to SVG d strings in slide pixels here, so the renderer can
 * measure and sample them with the platform's own SVGPathElement.
 */

import type { MotionPath } from './types'

/** Tokenise a path string into command letters and numbers. */
function tokenise(path: string): Array<{ cmd: string; args: number[] }> {
  const out: Array<{ cmd: string; args: number[] }> = []
  // Commands are single letters; numbers may be signed, decimal or exponent form.
  const re = /([MLCQZmlcqzEe])|(-?[0-9]*[.]?[0-9]+(?:[eE][-+]?[0-9]+)?)/g
  let current: { cmd: string; args: number[] } | null = null
  let match: RegExpExecArray | null

  while ((match = re.exec(path)) !== null) {
    const command = match[1]
    const number = match[2]
    if (command) {
      // E is a terminator, not a drawing command.
      if (command === 'E' || command === 'e') {
        current = null
        continue
      }
      current = { cmd: command.toUpperCase(), args: [] }
      out.push(current)
    } else if (number !== undefined && current) {
      current.args.push(Number(number))
    }
  }
  return out
}

/** Number of coordinates each command consumes per segment. */
const ARITY: Record<string, number> = { M: 2, L: 2, C: 6, Q: 4, Z: 0 }

/**
 * Convert an OOXML path to an SVG path in slide pixels.
 *
 * Returns null when the path cannot be understood, so the caller can fall back to
 * an instant position change rather than drawing something wrong.
 */
export function ooxmlPathToSvgD(
  pathStr: string | null,
  slideWidth: number,
  slideHeight: number
): string | null {
  if (!pathStr) return null
  const trimmed = pathStr.trim()
  if (trimmed === '') return null

  const tokens = tokenise(trimmed)
  if (tokens.length === 0) return null

  const parts: string[] = []
  let started = false

  for (const token of tokens) {
    const arity = ARITY[token.cmd]
    if (arity === undefined) return null

    if (token.cmd === 'Z') {
      parts.push('Z')
      continue
    }

    if (arity === 0) continue
    if (token.args.length < arity) return null

    // A command may repeat its argument set, as in "L 1 2 3 4".
    for (let i = 0; i + arity <= token.args.length; i += arity) {
      const slice = token.args.slice(i, i + arity)
      const scaled = slice.map((value, index) =>
        index % 2 === 0 ? value * slideWidth : value * slideHeight
      )
      const round = scaled.map((value) => Math.round(value * 100) / 100)
      if (token.cmd === 'M' && i === 0) {
        parts.push('M ' + round.join(' '))
        started = true
      } else if (token.cmd === 'M') {
        // Additional pairs after a moveto are implicit linetos per the SVG spec.
        parts.push('L ' + round.join(' '))
      } else {
        parts.push(token.cmd + ' ' + round.join(' '))
      }
    }
  }

  if (!started || parts.length === 0) return null
  return parts.join(' ')
}

/**
 * Build a straight-line path from the from/to/by attributes.
 *
 * Some producers omit the path attribute entirely and express a simple translation
 * with these instead, which is common for simple "move across" motion.
 */
export function linePathFrom(
  from: { x: number; y: number } | null,
  to: { x: number; y: number } | null,
  by: { x: number; y: number } | null,
  slideWidth: number,
  slideHeight: number
): string | null {
  if (!from && !to && !by) return null

  const start = from ?? { x: 0, y: 0 }
  const end = to ?? (by ? { x: start.x + by.x, y: start.y + by.y } : null)
  if (!end) return null

  const x1 = Math.round(start.x * slideWidth * 100) / 100
  const y1 = Math.round(start.y * slideHeight * 100) / 100
  const x2 = Math.round(end.x * slideWidth * 100) / 100
  const y2 = Math.round(end.y * slideHeight * 100) / 100
  return 'M ' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y2
}

/** Assemble a MotionPath from its parsed pieces. */
export function makeMotionPath(
  d: string,
  options: { autoReverse?: boolean; repeatCount?: number; accel?: number; decel?: number } = {}
): MotionPath {
  return {
    d,
    autoReverse: options.autoReverse,
    repeatCount: options.repeatCount && options.repeatCount > 0 ? options.repeatCount : 1,
    accel: options.accel,
    decel: options.decel
  }
}

/** Sample a point along an SVG path, with progress expressed as a fraction. */
export function pointAt(path: SVGPathElement, progress: number): { x: number; y: number } {
  const length = path.getTotalLength()
  if (length === 0) return { x: 0, y: 0 }
  const clamped = Math.max(0, Math.min(1, progress))
  const point = path.getPointAtLength(clamped * length)
  return { x: point.x, y: point.y }
}

/**
 * Ease a progress value the way PowerPoint's accel/decel do.
 *
 * Both zero is linear, which is what PowerPoint uses when neither is declared.
 */
export function easeProgress(progress: number, accel = 0, decel = 0): number {
  const t = Math.max(0, Math.min(1, progress))
  if (accel <= 0 && decel <= 0) return t
  const a = Math.max(0, Math.min(0.5, accel))
  const d = Math.max(0, Math.min(0.5, decel))
  if (t < a && a > 0) {
    const local = t / a
    return a * local * local
  }
  if (t > 1 - d && d > 0) {
    const local = (1 - t) / d
    return 1 - d * local * local
  }
  return t
}

/** Create the offscreen SVG path element used for sampling. */
export function createSampler(d: string): SVGPathElement | null {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', d)
  svg.appendChild(path)
  // The element must be in the document for getTotalLength to work.
  svg.style.position = 'absolute'
  svg.style.width = '0'
  svg.style.height = '0'
  svg.style.overflow = 'hidden'
  svg.style.pointerEvents = 'none'
  document.body.appendChild(svg)
  return path
}

/** Release a sampler created by createSampler. */
export function releaseSampler(path: SVGPathElement | null): void {
  if (!path) return
  path.parentElement?.parentElement?.remove()
}
