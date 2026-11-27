/**
 * Relationship parsing, shared by the main process indexer and the renderer.
 *
 * Kept separate so the renderer does not depend on the main-process module.
 */

export function parseRelationships(xml: string): Map<string, { type: string; target: string }> {
  const out = new Map<string, { type: string; target: string }>()
  const re = /<Relationship\b([^>]*?)\/?>/gi
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

/** Relationship part name: ppt/slides/slide1.xml -> ppt/slides/_rels/slide1.xml.rels */
export function relsPartFor(part: string): string {
  const slash = part.lastIndexOf('/')
  const dir = slash >= 0 ? part.slice(0, slash) : ''
  const file = slash >= 0 ? part.slice(slash + 1) : part
  return (dir ? dir + '/' : '') + '_rels/' + file + '.rels'
}
