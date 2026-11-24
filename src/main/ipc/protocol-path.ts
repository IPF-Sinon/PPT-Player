/** Path containment helper, kept Electron-free so it can be unit tested. */
import { resolve, sep } from 'node:path'

/** True when `child` resolves to a path inside `parent`. */
export function isInside(parent: string, child: string): boolean {
  const base = resolve(parent)
  const target = resolve(child)
  if (target === base) return true
  return target.startsWith(base.endsWith(sep) ? base : base + sep)
}
