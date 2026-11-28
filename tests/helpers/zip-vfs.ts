/**
 * Read-only virtual filesystem over an on-disk ZIP, for the native PPTX engine.
 *
 * Opening a .pptx used to mean handing it to LibreOffice and waiting for a PDF.
 * This index makes the archive directly addressable instead: the central directory
 * is read once (a few hundred KB at most), then any single entry is fetched by
 * seeking to its byte range and inflating just that entry. Nothing is extracted to
 * disk and the whole archive is never held in memory.
 */

import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'

const EOCD_SIG = 0x06054b50
const ZIP64_EOCD_SIG = 0x06064b50
const ZIP64_LOCATOR_SIG = 0x07064b50
const CEN_SIG = 0x02014b50
const LOC_SIG = 0x04034b50
const MAX_COMMENT = 0xffff
/** A presentation's central directory is far below this; larger means "not ours". */
const MAX_CENTRAL_DIR = 16 * 1024 * 1024

export interface VfsEntry {
  /** Normalised name: forward slashes, lower case, no leading slash. */
  key: string
  /** Name exactly as stored, needed to match internal relationship targets. */
  name: string
  method: number
  compressedSize: number
  size: number
  localOffset: number
}

export interface ZipVfs {
  readonly size: number
  readonly entryCount: number
  /** Read and decompress one entry, or null when it is absent. */
  read(entryName: string): Buffer | null
  /** Read one entry as UTF-8 text, or null. */
  readText(entryName: string): string | null
  /** Every entry name, in archive order. */
  names(): string[]
  has(entryName: string): boolean
  close(): void
}

/** Normalise an internal path the way OOXML relationships are matched. */
export function normaliseEntry(name: string): string {
  const out = name.replace(/\\/g, '/').replace(/^\.?\/+/, '')
  // Resolve ../ segments, which relationship targets use freely.
  const parts: string[] = []
  for (const segment of out.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return parts.join('/').toLowerCase()
}

function readAt(fd: number, offset: number, length: number, fileSize: number): Buffer {
  if (offset < 0 || length <= 0 || offset >= fileSize) return Buffer.alloc(0)
  const want = Math.min(length, fileSize - offset)
  const buf = Buffer.allocUnsafe(want)
  let read = 0
  while (read < want) {
    const n = readSync(fd, buf, read, want - read, offset + read)
    if (n <= 0) break
    read += n
  }
  return read === want ? buf : buf.subarray(0, read)
}

interface Eocd {
  totalEntries: number
  cdOffset: number
  cdSize: number
}

function findEocd(fd: number, fileSize: number): Eocd | null {
  const tailLength = Math.min(fileSize, MAX_COMMENT + 22)
  if (tailLength < 22) return null
  const tailStart = fileSize - tailLength
  const tail = readAt(fd, tailStart, tailLength, fileSize)
  if (tail.length < 22) return null

  let at = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === EOCD_SIG) {
      at = i
      break
    }
  }
  if (at < 0) return null

  let totalEntries = tail.readUInt16LE(at + 10)
  let cdSize = tail.readUInt32LE(at + 12)
  let cdOffset = tail.readUInt32LE(at + 16)

  if (totalEntries === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    const locAt = at - 20
    if (locAt >= 0 && tail.readUInt32LE(locAt) === ZIP64_LOCATOR_SIG) {
      const eocd64At = Number(tail.readBigUInt64LE(locAt + 8))
      const rec = readAt(fd, eocd64At, 56, fileSize)
      if (rec.length >= 56 && rec.readUInt32LE(0) === ZIP64_EOCD_SIG) {
        totalEntries = Number(rec.readBigUInt64LE(32))
        cdSize = Number(rec.readBigUInt64LE(40))
        cdOffset = Number(rec.readBigUInt64LE(48))
      }
    }
  }

  if (cdOffset < 0 || cdOffset >= fileSize) return null
  if (cdSize <= 0 || cdSize > MAX_CENTRAL_DIR) return null
  return { totalEntries, cdOffset, cdSize }
}

/**
 * Open a ZIP as a virtual filesystem.
 *
 * Throws when the file is not a readable ZIP, so callers can fall back to the
 * conversion engine without a separate validation step.
 */
export function openZipVfs(path: string): ZipVfs {
  const fd = openSync(path, 'r')
  let closed = false
  const { size: fileSize } = statSync(path)

  const fail = (message: string): never => {
    closeSync(fd)
    closed = true
    throw new Error(message)
  }

  const eocd = findEocd(fd, fileSize)
  if (!eocd) fail('not a readable zip archive')

  const dir = readAt(fd, eocd!.cdOffset, eocd!.cdSize, fileSize)
  const entries = new Map<string, VfsEntry>()
  const order: string[] = []
  let p = 0

  while (p + 46 <= dir.length) {
    if (dir.readUInt32LE(p) !== CEN_SIG) break
    const flags = dir.readUInt16LE(p + 8)
    const method = dir.readUInt16LE(p + 10)
    const compressedSize = dir.readUInt32LE(p + 20)
    const uncompressedSize = dir.readUInt32LE(p + 24)
    const nameLen = dir.readUInt16LE(p + 28)
    const extraLen = dir.readUInt16LE(p + 30)
    const commentLen = dir.readUInt16LE(p + 32)
    const localOffset = dir.readUInt32LE(p + 42)
    if (p + 46 + nameLen > dir.length) break

    const name = dir.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1')
    const key = normaliseEntry(name)
    if (!entries.has(key)) {
      entries.set(key, {
        key,
        name,
        method,
        compressedSize,
        size: uncompressedSize === 0xffffffff ? compressedSize : uncompressedSize,
        localOffset
      })
      order.push(key)
    }

    p += 46 + nameLen + extraLen + commentLen
    if (eocd!.totalEntries > 0 && entries.size >= eocd!.totalEntries) break
  }

  const payload = (entry: VfsEntry): Buffer | null => {
    const header = readAt(fd, entry.localOffset, 30, fileSize)
    if (header.length < 30 || header.readUInt32LE(0) !== LOC_SIG) return null
    const nameLen = header.readUInt16LE(26)
    const extraLen = header.readUInt16LE(28)
    const start = entry.localOffset + 30 + nameLen + extraLen
    const length = entry.compressedSize > 0 ? entry.compressedSize : entry.size
    if (start < 0 || length < 0 || start + length > fileSize) return null
    return readAt(fd, start, length, fileSize)
  }

  const vfs: ZipVfs = {
    size: fileSize,
    entryCount: entries.size,

    read(entryName: string): Buffer | null {
      if (closed) return null
      const entry = entries.get(normaliseEntry(entryName))
      if (!entry) return null
      const raw = payload(entry)
      if (!raw) return null
      if (entry.method === 0) return raw
      if (entry.method !== 8) return null
      try {
        return inflateRawSync(raw)
      } catch {
        return null
      }
    },

    readText(entryName: string): string | null {
      const buf = vfs.read(entryName)
      return buf ? buf.toString('utf8') : null
    },

    names(): string[] {
      return order.map((key) => entries.get(key)!.name)
    },

    has(entryName: string): boolean {
      return entries.has(normaliseEntry(entryName))
    },

    close(): void {
      if (closed) return
      closed = true
      closeSync(fd)
    }
  }

  return vfs
}
