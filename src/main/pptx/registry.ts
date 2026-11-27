/**
 * Registry of decks opened through the native PPTX engine.
 *
 * Each entry holds an open ZIP handle and its presentation index. The handle stays
 * open so the renderer can fetch slide parts and media on demand through
 * app://pptx/<deckId>/..., and it is closed when the tab is closed so Windows does
 * not keep the file locked.
 */

import { log } from '../log'
import { openZipVfs, type ZipVfs } from './zip-vfs'
import { buildPresentationIndex, type PresentationIndex } from './index-parse'

export interface NativeDeckRecord {
  deckId: string
  sourcePath: string
  vfs: ZipVfs
  index: PresentationIndex
}

const decks = new Map<string, NativeDeckRecord>()

/** Open a deck and index it. Returns null when the file is not a usable PPTX. */
export function openNativeDeck(deckId: string, sourcePath: string): NativeDeckRecord | null {
  let vfs: ZipVfs
  try {
    vfs = openZipVfs(sourcePath)
  } catch (err) {
    log.warn('native deck open failed', sourcePath, err)
    return null
  }

  const index = buildPresentationIndex(vfs)
  if (!index) {
    vfs.close()
    return null
  }

  const record: NativeDeckRecord = { deckId, sourcePath, vfs, index }
  decks.set(deckId, record)
  log.info('native deck indexed', {
    deckId,
    slides: index.slides.length,
    entries: vfs.entryCount,
    size: vfs.size
  })
  return record
}

export function getNativeDeck(deckId: string): NativeDeckRecord | undefined {
  return decks.get(deckId)
}

/** Read an internal part, refusing traversal outside the archive. */
export function readNativePart(deckId: string, partPath: string): Buffer | null {
  const record = decks.get(deckId)
  if (!record) return null
  if (partPath.includes('..')) return null
  return record.vfs.read(partPath)
}

export function closeNativeDeck(deckId: string): void {
  const record = decks.get(deckId)
  if (!record) return
  record.vfs.close()
  decks.delete(deckId)
}

export function closeAllNativeDecks(): void {
  for (const record of decks.values()) record.vfs.close()
  decks.clear()
}
