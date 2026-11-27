/**
 * Small XML helpers over the browser's DOMParser.
 *
 * OOXML is namespaced, and the renderer only ever needs child lookups by local
 * name. Using local names keeps the parser readable and immune to the prefix a
 * producer happened to choose (p:, a:, or none at all).
 */

export function parseXml(text: string): Document | null {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) return null
  return doc
}

/** Local name of an element or attribute, without its namespace prefix. */
export function localName(node: { localName?: string | null; nodeName: string }): string {
  if (node.localName) return node.localName
  const name = node.nodeName
  const colon = name.indexOf(':')
  return colon >= 0 ? name.slice(colon + 1) : name
}

/** Direct children with the given local name. */
export function children(node: Element | Document | null, name: string): Element[] {
  if (!node) return []
  const out: Element[] = []
  const list = node.childNodes
  for (let i = 0; i < list.length; i++) {
    const child = list[i]
    if (child.nodeType === 1 && localName(child as Element) === name) out.push(child as Element)
  }
  return out
}

/** First direct child with the given local name. */
export function child(node: Element | Document | null, name: string): Element | null {
  return children(node, name)[0] ?? null
}

/** All descendants with the given local name. */
export function descendants(node: Element | Document | null, name: string): Element[] {
  if (!node) return []
  const out: Element[] = []
  const walk = (current: Element): void => {
    const list = current.childNodes
    for (let i = 0; i < list.length; i++) {
      const next = list[i]
      if (next.nodeType !== 1) continue
      const el = next as Element
      if (localName(el) === name) out.push(el)
      walk(el)
    }
  }
  if (node.nodeType === 9) {
    const root = (node as Document).documentElement
    if (root) {
      if (localName(root) === name) out.push(root)
      walk(root)
    }
  } else {
    walk(node as Element)
  }
  return out
}

/** Attribute by local name, ignoring the prefix. */
export function attr(node: Element | null, name: string): string | null {
  if (!node) return null
  const direct = node.getAttribute(name)
  if (direct !== null) return direct
  const attrs = node.attributes
  for (let i = 0; i < attrs.length; i++) {
    const item = attrs[i]
    if (localName(item) === name) return item.value
  }
  return null
}

export function attrNum(node: Element | null, name: string, fallback = 0): number {
  const raw = attr(node, name)
  if (raw === null) return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

export function attrBool(node: Element | null, name: string, fallback = false): boolean {
  const raw = attr(node, name)
  if (raw === null) return fallback
  return raw === '1' || raw.toLowerCase() === 'true'
}

/** First descendant with the given local name. */
export function first(node: Element | null, name: string): Element | null {
  if (!node) return null
  const list = node.getElementsByTagName('*')
  for (let i = 0; i < list.length; i++) {
    if (localName(list[i]) === name) return list[i]
  }
  return null
}

/** Text content of the first descendant with the given local name. */
export function text(node: Element | null, name: string): string | null {
  const el = first(node, name)
  return el ? el.textContent : null
}
