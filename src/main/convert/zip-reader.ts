/**
 * Minimal ZIP reader over a random-access byte source.
 *
 * Only the ranges that matter are read: the tail for the end-of-central-directory
 * record, the central directory itself, and the single entry payload a caller
 * asks for. Nothing here depends on the whole file being in memory, which is what
 * lets a 150 MB deck be classified in under a millisecond.
 */

import { inflateRawSync } from 'node:zlib'
import { bufferSource, type ByteSource } from './byte-source'

/** Accept raw bytes or a byte source, so callers stay simple. */
type ByteSourceInput = ByteSource | Buffer

function asSource(input: ByteSourceInput): ByteSource {
  return Buffer.isBuffer(input) ? bufferSource(input) : input
}

const EOCD_SIG = 0x06054b50
const ZIP64_EOCD_SIG = 0x06064b50
const ZIP64_LOCATOR_SIG = 0x07064b50
const CEN_SIG = 0x02014b50
const LOC_SIG = 0x04034b50
const MAX_COMMENT = 0xffff
/** A central directory larger than this is not a presentation we support. */
const MAX_CENTRAL_DIR = 8 * 1024 * 1024

export interface ZipEntryName {
  name: string
  /** Uncompressed size as recorded in the central directory. */
  size: number
  /** Compressed size, needed to read the payload back. */
  compressedSize: number
  /** Compression method: 0 stored, 8 deflate. */
  method: number
  /** Local header offset. */
  offset: number
}

interface EocdInfo {
  totalEntries: number
  cdOffset: number
  cdSize: number
}

function readEocd(source: ByteSource): EocdInfo | null {
  const tailLength = Math.min(source.size, MAX_COMMENT + 22)
  if (tailLength < 22) return null
  const tailStart = source.size - tailLength
  const tail = source.read(tailStart, tailLength)
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

  // ZIP64 keeps the real values in a separate record pointed at by a locator that
  // sits immediately before the classic EOCD.
  if (totalEntries === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    const locAt = at - 20
    if (locAt >= 0 && tail.readUInt32LE(locAt) === ZIP64_LOCATOR_SIG) {
      const eocd64At = Number(tail.readBigUInt64LE(locAt + 8))
      if (eocd64At >= 0 && eocd64At + 56 <= source.size) {
        const rec = source.read(eocd64At, 56)
        if (rec.length >= 56 && rec.readUInt32LE(0) === ZIP64_EOCD_SIG) {
          totalEntries = Number(rec.readBigUInt64LE(32))
          cdSize = Number(rec.readBigUInt64LE(40))
          cdOffset = Number(rec.readBigUInt64LE(48))
        }
      }
    }
  }

  if (cdOffset < 0 || cdOffset >= source.size) return null
  if (cdSize <= 0 || cdSize > MAX_CENTRAL_DIR) return null
  return { totalEntries, cdOffset, cdSize }
}

/**
 * List entry names from a ZIP container. Returns an empty array when the source
 * is not a readable ZIP.
 */
export function listZipEntries(input: ByteSourceInput): ZipEntryName[] {
  const source = asSource(input)
  const eocd = readEocd(source)
  if (!eocd) return []

  const dir = source.read(eocd.cdOffset, eocd.cdSize)
  const entries: ZipEntryName[] = []
  let p = 0

  while (p + 46 <= dir.length) {
    if (dir.readUInt32LE(p) !== CEN_SIG) break
    const flags = dir.readUInt16LE(p + 8)
    const method = dir.readUInt16LE(p + 10)
    const compSize = dir.readUInt32LE(p + 20)
    const uncompSize = dir.readUInt32LE(p + 24)
    const nameLen = dir.readUInt16LE(p + 28)
    const extraLen = dir.readUInt16LE(p + 30)
    const commentLen = dir.readUInt16LE(p + 32)
    const localOffset = dir.readUInt32LE(p + 42)
    if (p + 46 + nameLen > dir.length) break

    const rawName = dir.subarray(p + 46, p + 46 + nameLen)
    const name = rawName.toString(flags & 0x800 ? 'utf8' : 'latin1')
    entries.push({
      name,
      size: uncompSize === 0xffffffff ? compSize : uncompSize,
      compressedSize: compSize,
      method,
      offset: localOffset
    })

    p += 46 + nameLen + extraLen + commentLen
    if (eocd.totalEntries > 0 && entries.length >= eocd.totalEntries) break
  }

  return entries
}

/** Locate the byte range of an entry's payload using its local file header. */
function payloadRange(
  source: ByteSource,
  entry: ZipEntryName
): { start: number; length: number } | null {
  const header = source.read(entry.offset, 30)
  if (header.length < 30 || header.readUInt32LE(0) !== LOC_SIG) return null
  const nameLen = header.readUInt16LE(26)
  const extraLen = header.readUInt16LE(28)
  const start = entry.offset + 30 + nameLen + extraLen
  const length = entry.compressedSize > 0 ? entry.compressedSize : entry.size
  if (start < 0 || length < 0 || start + length > source.size) return null
  return { start, length }
}

/**
 * Read the payload of an entry that is stored uncompressed (method 0). Used for
 * the ODF `mimetype` entry, which the ODF spec requires to be first and stored.
 */
export function readStoredEntry(input: ByteSourceInput, name: string): Buffer | null {
  const source = asSource(input)
  const entry = listZipEntries(source).find((e) => e.name === name)
  if (!entry || entry.method !== 0) return null
  const range = payloadRange(source, entry)
  if (!range) return null
  return source.read(range.start, range.length)
}

/**
 * Read a single entry payload, inflating it when necessary. Returns null when the
 * entry is missing or cannot be decoded.
 */
export function readZipEntry(input: ByteSourceInput, name: string): Buffer | null {
  const source = asSource(input)
  const entry = listZipEntries(source).find((e) => e.name === name)
  if (!entry) return null
  if (entry.method === 0) return readStoredEntry(source, name)
  if (entry.method !== 8) return null

  const range = payloadRange(source, entry)
  if (!range) return null
  const compressed = source.read(range.start, range.length)
  if (compressed.length === 0) return null
  try {
    return inflateRawSync(compressed)
  } catch {
    return null
  }
}

/** True when the source starts with a local file header, or a bare central directory. */
export function looksLikeZip(input: ByteSourceInput): boolean {
  const source = asSource(input)
  if (source.size < 4) return false
  const head = source.read(0, 4)
  if (head.length < 4) return false
  const sig = head.readUInt32LE(0)
  return sig === LOC_SIG || sig === EOCD_SIG || sig === CEN_SIG
}