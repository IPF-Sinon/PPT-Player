/**
 * Slide transition parsing.
 *
 * p:transition sits on the slide root. Modern PowerPoint also wraps it in
 * mc:AlternateContent with a p14 variant that carries a millisecond duration, so
 * both shapes have to be read or the timing falls back to a guess.
 */

import type { SlideTransition } from './types'
import { attr, attrNum, child, descendants, first } from './xml'

/** Speed names map to the durations PowerPoint's UI shows. */
const SPEED_MS: Record<string, number> = { slow: 700, med: 450, fast: 250 }

/** Direction attributes used by push, wipe, cover and pull. */
function directionOf(value: string | null): SlideTransition['direction'] | undefined {
  switch (value) {
    case 'l':
    case 'left':
      return 'left'
    case 'r':
    case 'right':
      return 'right'
    case 'u':
    case 'up':
      return 'up'
    case 'd':
    case 'down':
      return 'down'
    default:
      return undefined
  }
}

/** The element names that map onto a transition we can draw. */
const KNOWN = new Set(['fade', 'push', 'wipe', 'cover', 'pull', 'zoom', 'split', 'cut'])

/**
 * Parse the transition for a slide.
 *
 * Returns undefined when the slide declares none, which means an instant cut. An
 * unrecognised effect also degrades to a cut rather than to a wrong animation.
 */
export function parseTransition(root: Element | null): SlideTransition | undefined {
  if (!root) return undefined

  // Prefer the p14 variant, which carries the authoritative millisecond duration.
  let element: Element | null = child(root, 'transition')
  let duration = 0

  const altContent = descendants(root, 'AlternateContent')
  for (const alt of altContent) {
    const choice = descendants(alt, 'Choice').find((node) =>
      (attr(node, 'Requires') ?? '').includes('p14')
    )
    if (!choice) continue
    const inner = child(choice, 'transition')
    if (inner) {
      element = inner
      duration = attrNum(inner, 'dur', 0)
      break
    }
  }

  if (!element) return undefined

  // Locate the actual effect child.
  let type: SlideTransition['type'] = 'cut'
  let effectEl: Element | null = null
  for (const node of Array.from(element.children)) {
    const name = node.localName ?? node.nodeName.replace(/^.*:/, '')
    if (KNOWN.has(name)) {
      type = name as SlideTransition['type']
      effectEl = node
      break
    }
  }

  if (duration <= 0) {
    duration = attrNum(element, 'p14:dur', 0)
  }
  if (duration <= 0) {
    const speed = attr(element, 'spd') ?? 'med'
    duration = SPEED_MS[speed] ?? 450
  }

  const direction = effectEl
    ? directionOf(attr(effectEl, 'dir')) ?? directionOf(attr(effectEl, 'orient'))
    : undefined

  // split has its own orientation vocabulary.
  if (type === 'split' && !direction) {
    const orient = effectEl ? attr(effectEl, 'orient') ?? attr(effectEl, 'dir') : null
    if (orient === 'horz') return { type, direction: 'left', duration }
    if (orient === 'vert') return { type, direction: 'up', duration }
  }

  if (type === 'cut') return undefined
  return { type, direction, duration }
}

/** True when the transition should be skipped for a given setting. */
export function transitionEnabled(
  transition: SlideTransition | undefined,
  enabled: boolean
): transition is SlideTransition {
  return Boolean(enabled && transition && transition.duration > 0)
}

export { first }
