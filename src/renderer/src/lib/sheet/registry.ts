/**
 * Fetch a sheet window, once per file and sheet, and keep it.
 *
 * A workbook is read on the Rust side, so every call is a full open of the file. The
 * preview stage, the reading column and the tab bar all want the same window at the
 * same time, and without this each of them would open the workbook again: on a large
 * .xlsx that is the difference between one open and three.
 *
 * The key is the deck id plus the sheet name plus the window, because a caller may
 * legitimately ask for two different windows of one sheet and they must not collide.
 */

import type { SheetRequest, SheetSource, SpreadsheetModel } from './types'

const inFlight = new Map<string, Promise<SpreadsheetModel>>()
const settled = new Map<string, SpreadsheetModel>()

function keyOf(deckId: string, request: SheetRequest): string {
  return [deckId, request.sheet ?? '', request.firstRow ?? 0, request.rowCount ?? 0].join('\u0000')
}

/**
 * The model for one window, reusing a fetch already in flight or already finished.
 *
 * A rejected fetch is not cached: a transient failure must be retryable, and a cached
 * rejection would leave the sheet permanently blank until the tab was closed.
 */
export function loadSheet(
  deckId: string,
  api: SheetSource,
  path: string,
  request: SheetRequest = {}
): Promise<SpreadsheetModel> {
  const key = keyOf(deckId, request)
  const done = settled.get(key)
  if (done) return Promise.resolve(done)
  const pending = inFlight.get(key)
  if (pending) return pending

  const work = api.openSpreadsheet(path, request).then(
    (model) => {
      settled.set(key, model)
      inFlight.delete(key)
      return model
    },
    (error: unknown) => {
      inFlight.delete(key)
      throw error
    }
  )
  inFlight.set(key, work)
  return work
}

/**
 * The model for a window, if it has already arrived.
 *
 * Synchronous on purpose: a component that has the model draws it during render, and a
 * component that does not yet returns null and asks for it again. Returning the promise
 * here would mean a caller could not tell the two cases apart without awaiting.
 */
export function cachedSheet(deckId: string, request: SheetRequest = {}): SpreadsheetModel | null {
  return settled.get(keyOf(deckId, request)) ?? null
}

/** Forget a workbook, so a reopened file is re-read rather than served stale. */
export function forgetSheet(deckId: string): void {
  const prefix = deckId + '\u0000'
  for (const key of [...settled.keys()]) {
    if (key.startsWith(prefix)) settled.delete(key)
  }
  for (const key of [...inFlight.keys()]) {
    if (key.startsWith(prefix)) inFlight.delete(key)
  }
}
