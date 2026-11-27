/**
 * Undo history for annotations.
 *
 * The old model kept one stroke array per page, so clearing the page threw the
 * strokes away for good. A clear is now just another entry on a history stack, which
 * means one undo after clearing brings everything back.
 */

export interface HistoryEntry {
  /** Snapshots before the current state, oldest first. */
  past: string[][]
  /** The current snapshot. */
  present: string[]
}

/** Steps kept per page. Enough for a lesson, bounded so memory cannot grow forever. */
export const MAX_HISTORY = 50

/** Snapshot a page's strokes into the serialisable form the stack stores. */
export function toSnapshot<T>(strokes: T[]): string[] {
  return strokes.map((stroke) => JSON.stringify(stroke))
}

/** Rebuild strokes from a snapshot. */
export function fromSnapshot<T>(snapshot: string[]): T[] {
  const out: T[] = []
  for (const entry of snapshot) {
    try {
      out.push(JSON.parse(entry) as T)
    } catch {
      // A corrupt entry is dropped rather than breaking the whole page.
    }
  }
  return out
}

/** Start a history for a page. */
export function initHistory<T>(strokes: T[] = []): HistoryEntry {
  return { past: [], present: toSnapshot(strokes) }
}

/**
 * Record a change, pushing the previous state onto the stack.
 *
 * Clearing passes an empty array and is therefore undoable exactly like a stroke.
 */
export function commitHistory<T>(entry: HistoryEntry, strokes: T[]): HistoryEntry {
  const past = [...entry.past, entry.present]
  // Drop the oldest entries once the cap is reached.
  const trimmed = past.length > MAX_HISTORY ? past.slice(past.length - MAX_HISTORY) : past
  return { past: trimmed, present: toSnapshot(strokes) }
}

/** Step back one entry, returning the same entry when there is nothing to undo. */
export function undoHistory(entry: HistoryEntry): HistoryEntry {
  if (entry.past.length === 0) return entry
  const past = entry.past.slice(0, -1)
  const present = entry.past[entry.past.length - 1]
  return { past, present }
}

/** True when there is something to undo. */
export function canUndo(entry: HistoryEntry): boolean {
  return entry.past.length > 0
}
