/**
 * Presentation index for the native PPTX engine.
 *
 * Reads only `presentation.xml` and its relationships to learn the slide size and
 * the ordered list of slide parts. This is what lets a deck open in milliseconds:
 * nothing else in the archive is touched until a slide is actually shown.
 */

import type { ZipVfs } from './zip-vfs'

/** EMU per CSS pixel at 96 DPI. OOXML uses 914400 EMU per inch. */
const EMU_PER_PX = 914400 / 96

export interface SlideRef {
  /** 1 based index in presentation order. */
  index: number
  /** Internal part path, e.g. ppt/slides/slide1.xml */
  path: string
  /** Relationship id, useful for diagnostics. */
  relId: string
}

export interface PresentationIndex {
  slideSize: { width: number; height: number }
  slides: SlideRef[]
  /** Master part paths, in relationship order. */
  masters: string[]
  /** Theme part paths. */
  themes: string[]
  /** True when the deck declares macros. */
  hasMacros: boolean
}

function emuToPx(emu: number): number {
  return emu / EMU_PER_PX
}

/** Parse every Relationship element into a target map. */
export function parseRelationships(xml: string): Map<string, { type: string; target: string }> {
  const out = new Map<string, { type: string; target: string }>()
  const re = /<Relationship\b([^>]*)\/?>/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(xml)) !== null) {
    const attrs = match[1]
    const id = /\bId\s*=\s*"([^"]*)"/i.exec(attrs)?.[1]
    const type = /\bType\s*=\s*"([^"]*)"/i.exec(attrs)?.[1]
    const target = /\bTarget\s*=\s*"([^"]*)"/i.exec(attrs)?.[1]
    if (id && type && target) out.set(id, { type, target })
  }
  return out
}

/** Resolve a relationship target against the part that declared it. */
export function resolvePartTarget(basePart: string, target: string): string {
  if (target.startsWith('/')) return target.replace(/^\/+/, '')
  const baseDir = basePart.includes('/') ? basePart.slice(0, basePart.lastIndexOf('/')) : ''
  const segments = (baseDir ? baseDir + '/' : '') + target
  const parts: string[] = []
  for (const segment of segments.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return parts.join('/')
}

/** Relationship part name for a given part: ppt/slides/slide1.xml -> ppt/slides/_rels/slide1.xml.rels */
export function relsPartFor(part: string): string {
  const slash = part.lastIndexOf('/')
  const dir = slash >= 0 ? part.slice(0, slash) : ''
  const file = slash >= 0 ? part.slice(slash + 1) : part
  return (dir ? dir + '/' : '') + '_rels/' + file + '.rels'
}

/**
 * Build the index. Returns null when the archive does not look like a presentation,
 * which lets the caller fall back to the conversion engine.
 */
export function buildPresentationIndex(vfs: ZipVfs): PresentationIndex | null {
  const presentationXml = vfs.readText('ppt/presentation.xml')
  if (!presentationXml) return null
  const presentationRels = vfs.readText('ppt/_rels/presentation.xml.rels')
  if (!presentationRels) return null

  const rels = parseRelationships(presentationRels)

  // Slide size, with the 4:3 default PowerPoint uses when sldSz is absent.
  const sldSz = /<p:sldSz\b([^>]*)\/?>/i.exec(presentationXml)?.[1] ?? ''
  const cx = Number(/\bcx\s*=\s*"(\d+)"/i.exec(sldSz)?.[1] ?? 0)
  const cy = Number(/\bcy\s*=\s*"(\d+)"/i.exec(sldSz)?.[1] ?? 0)
  const slideSize =
    cx > 0 && cy > 0
      ? { width: emuToPx(cx), height: emuToPx(cy) }
      : { width: emuToPx(9144000), height: emuToPx(6858000) }

  // Presentation order comes from sldIdLst, not from the rels order or file names.
  const slides: SlideRef[] = []
  const idListRe = /<p:sldId\b([^>]*)\/?>/gi
  let idMatch: RegExpExecArray | null
  while ((idMatch = idListRe.exec(presentationXml)) !== null) {
    const attrs = idMatch[1]
    const relId = /\br:id\s*=\s*"([^"]*)"/i.exec(attrs)?.[1]
    if (!relId) continue
    const rel = rels.get(relId)
    if (!rel) continue
    const path = resolvePartTarget('ppt/presentation.xml', rel.target)
    slides.push({ index: slides.length + 1, path, relId })
  }

  if (slides.length === 0) return null

  const masters: string[] = []
  const themes: string[] = []
  for (const rel of rels.values()) {
    if (rel.type.endsWith('/slideMaster')) masters.push(resolvePartTarget('ppt/presentation.xml', rel.target))
    if (rel.type.endsWith('/theme')) themes.push(resolvePartTarget('ppt/presentation.xml', rel.target))
  }

  const hasMacros = vfs.has('ppt/vbaProject.bin')

  return { slideSize, slides, masters, themes, hasMacros }
}
