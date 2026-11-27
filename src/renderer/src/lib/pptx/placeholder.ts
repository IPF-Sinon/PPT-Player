/**
 * Placeholder inheritance.
 *
 * A slide's own XML often omits the geometry of a placeholder: the title and
 * subtitle on a cover slide simply say "this is the title placeholder" and inherit
 * position, size and text defaults from the layout, and the layout inherits from the
 * master. Reading only the slide therefore produced a blank cover, which is exactly
 * the failure seen on real teaching decks.
 *
 * The chain is slide -> layout -> master, matched by placeholder type and index.
 */

import { attr, attrNum, child, children, descendants, first, localName } from './xml'
import { emu, resolveTransform } from './fill'
import type { Theme } from './theme'
import { parseTextBody } from './text'
import type { TextBody } from './types'

export interface PlaceholderKey {
  /** Placeholder type, e.g. title, ctrTitle, subTitle, body, pic. */
  type: string
  /** Index, used to tell apart several body placeholders. */
  idx: string
}

export interface PlaceholderShape {
  key: PlaceholderKey
  /** Geometry in slide pixels, or null when this level does not define it. */
  rect: { x: number; y: number; width: number; height: number } | null
  rotation?: number
  text: TextBody | null
}

/** Read the placeholder key of a shape element, or null when it is not one. */
export function placeholderKeyOf(sp: Element): PlaceholderKey | null {
  const nvSpPr = first(sp, 'nvSpPr')
  const nvPr = nvSpPr ? child(nvSpPr, 'nvPr') : null
  const ph = nvPr ? child(nvPr, 'ph') : null
  if (!ph) return null
  return {
    // A placeholder with no type attribute is a body placeholder by definition.
    type: attr(ph, 'type') ?? 'body',
    idx: attr(ph, 'idx') ?? '0'
  }
}

/** Two placeholders match when their type and index agree, the way PowerPoint pairs them. */
export function samePlaceholder(a: PlaceholderKey, b: PlaceholderKey): boolean {
  if (a.idx !== b.idx) return false
  // ctrTitle on a layout pairs with title on a slide, so treat the title family as one.
  const titleFamily = new Set(['title', 'ctrTitle'])
  if (titleFamily.has(a.type) && titleFamily.has(b.type)) return true
  return a.type === b.type
}

/** Collect every placeholder a part defines, keyed by its placeholder identity. */
export function collectPlaceholders(
  spTree: Element | null,
  theme: Theme
): PlaceholderShape[] {
  if (!spTree) return []
  const out: PlaceholderShape[] = []

  for (const sp of descendants(spTree, 'sp')) {
    const key = placeholderKeyOf(sp)
    if (!key) continue
    const spPr = first(sp, 'spPr')
    const transform = resolveTransform(first(spPr, 'xfrm'))
    const txBody = first(sp, 'txBody')
    out.push({
      key,
      rect: transform
        ? { x: transform.x, y: transform.y, width: transform.width, height: transform.height }
        : null,
      rotation: transform?.rotation,
      text: txBody ? parseTextBody(txBody, theme) : null
    })
  }

  return out
}

/**
 * Resolve the geometry a placeholder should use.
 *
 * Walks the layout chain in order and takes the first level that defines a box,
 * because a layout may override only some placeholders and leave the rest to the
 * master.
 */
export function inheritPlaceholder(
  key: PlaceholderKey,
  chain: PlaceholderShape[][]
): { rect: { x: number; y: number; width: number; height: number }; rotation?: number } | null {
  for (const level of chain) {
    const match = level.find((entry) => samePlaceholder(entry.key, key))
    if (match?.rect) return { rect: match.rect, rotation: match.rotation }
  }
  return null
}

/** Text defaults a placeholder inherits when the slide itself has no text. */
export function inheritPlaceholderText(
  key: PlaceholderKey,
  chain: PlaceholderShape[][]
): TextBody | null {
  for (const level of chain) {
    const match = level.find((entry) => samePlaceholder(entry.key, key))
    if (match?.text) return match.text
  }
  return null
}

export { emu, attrNum, children, localName }
