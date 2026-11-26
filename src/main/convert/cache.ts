import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { consoleLogger as log } from './logging'

export interface CacheEntryMeta {
  sourcePath: string
  sourceBytes: number
  sourceMtimeMs: number
  engine: string
  enginePath: string
  appVersion: string
  createdAt: number
  lastUsedAt: number
  pageCount: number
  /** 'ready' once deck.pdf is complete; absent on entries written by older builds. */
  status?: 'ready' | 'partial'
}

export interface CacheHit {
  dir: string
  pdfPath: string
  meta: CacheEntryMeta
}

/** Stable cache key from file identity plus engine identity. */
export function cacheKey(parts: {
  sourcePath: string
  sourceBytes: number
  sourceMtimeMs: number
  engine: string
  enginePath: string
  appVersion: string
}): string {
  const h = createHash('sha256')
  h.update(parts.sourcePath.toLowerCase())
  h.update('|' + parts.sourceBytes)
  h.update('|' + Math.round(parts.sourceMtimeMs))
  h.update('|' + parts.engine)
  h.update('|' + parts.enginePath.toLowerCase())
  h.update('|' + parts.appVersion)
  return h.digest('hex').slice(0, 16)
}

export class DeckCache {
  private readonly root: string

  constructor(root: string) {
    this.root = root
    mkdirSync(root, { recursive: true })
  }

  dirFor(key: string): string {
    return join(this.root, key)
  }

  lookup(key: string): CacheHit | null {
    const dir = this.dirFor(key)
    const pdfPath = join(dir, 'deck.pdf')
    const metaPath = join(dir, 'meta.json')
    if (!existsSync(pdfPath) || !existsSync(metaPath)) return null
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as CacheEntryMeta
      // A usable entry needs a real PDF, not a page count: the count is written by
      // the converter, and an open abandoned before the renderer reported metrics
      // used to leave 0 here and silently discard an otherwise valid conversion.
      if (statSync(pdfPath).size < 1024) return null
      if (meta.status && meta.status !== 'ready') return null
      meta.lastUsedAt = Date.now()
      writeFileSync(metaPath, JSON.stringify(meta), 'utf8')
      return { dir, pdfPath, meta }
    } catch (err) {
      log.warn('cache entry unreadable, discarding', key, err)
      rmSync(dir, { recursive: true, force: true })
      return null
    }
  }

  store(key: string, meta: CacheEntryMeta): string {
    const dir = this.dirFor(key)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta), 'utf8')
    return dir
  }

  /** Remove least recently used entries until the total size fits the budget. */
  prune(budgetBytes: number): number {
    const entries: Array<{ dir: string; size: number; lastUsedAt: number }> = []
    let total = 0
    for (const name of safeReaddir(this.root)) {
      const dir = join(this.root, name)
      const metaPath = join(dir, 'meta.json')
      let lastUsedAt = 0
      let size = 0
      try {
        size = dirSize(dir)
        if (existsSync(metaPath)) {
          const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as CacheEntryMeta
          lastUsedAt = meta.lastUsedAt ?? 0
        }
      } catch {
        lastUsedAt = 0
      }
      total += size
      entries.push({ dir, size, lastUsedAt })
    }

    if (total <= budgetBytes) return 0

    entries.sort((a, b) => a.lastUsedAt - b.lastUsedAt)
    let removed = 0
    for (const entry of entries) {
      if (total <= budgetBytes) break
      rmSync(entry.dir, { recursive: true, force: true })
      total -= entry.size
      removed++
    }
    log.info('cache pruned', { removed, remainingBytes: total })
    return removed
  }

  clearAll(): void {
    for (const name of safeReaddir(this.root)) {
      rmSync(join(this.root, name), { recursive: true, force: true })
    }
  }
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

function dirSize(dir: string): number {
  let total = 0
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    let items: Array<{ name: string; isDirectory: () => boolean }>
    try {
      items = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const item of items) {
      const full = join(current, item.name)
      if (item.isDirectory()) stack.push(full)
      else {
        try {
          total += statSync(full).size
        } catch {
          // ignore unreadable files
        }
      }
    }
  }
  return total
}