/** Minimal ZIP reader: central-directory listing plus single-entry extraction. */

import { unzipSync } from 'fflate'

const EOCD_SIG = 0x06054b50
const ZIP64_EOCD_SIG = 0x06064b50
const ZIP64_LOCATOR_SIG = 0x07064b50
const CEN_SIG = 0x02014b50
const MAX_COMMENT = 0xffff

export interface ZipEntryName {
  name: string
  /** Uncompressed size as recorded in the central directory. */
  size: number
  /** Local header offset. */
  offset: number
}

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - MAX_COMMENT - 22)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i
  }
  return -1
}

interface EocdInfo {
  totalEntries: number
  cdOffset: number
  cdSize: number
}

function readEocd(buf: Buffer): EocdInfo | null {
  const at = findEocd(buf)
  if (at < 0) return null
  let totalEntries = buf.readUInt16LE(at + 10)
  let cdSize = buf.readUInt32LE(at + 12)
  let cdOffset = buf.readUInt32LE(at + 16)

  if (totalEntries === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    const locAt = at - 20
    if (locAt >= 0 && buf.readUInt32LE(locAt) === ZIP64_LOCATOR_SIG) {
      const eocd64At = Number(buf.readBigUInt64LE(locAt + 8))
      if (eocd64At >= 0 && eocd64At + 56 <= buf.length && buf.readUInt32LE(eocd64At) === ZIP64_EOCD_SIG) {
        totalEntries = Number(buf.readBigUInt64LE(eocd64At + 32))
        cdSize = Number(buf.readBigUInt64LE(eocd64At + 40))
        cdOffset = Number(buf.readBigUInt64LE(eocd64At + 48))
      }
    }
  }
  return { totalEntries, cdOffset, cdSize }
}

/**
 * List entry names from a ZIP buffer. Returns an empty array when the buffer is
 * not a readable ZIP container.
 */
export function listZipEntries(buf: Buffer): ZipEntryName[] {
  const eocd = readEocd(buf)
  if (!eocd) return []
  if (eocd.cdOffset < 0 || eocd.cdOffset >= buf.length) return []

  const entries: ZipEntryName[] = []
  let p = eocd.cdOffset
  const end = Math.min(buf.length, eocd.cdOffset + eocd.cdSize)
  while (p + 46 <= end) {
    if (buf.readUInt32LE(p) !== CEN_SIG) break
    const flags = buf.readUInt16LE(p + 8)
    const compSize = buf.readUInt32LE(p + 20)
    const uncompSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    if (p + 46 + nameLen > end) break
    const rawName = buf.subarray(p + 46, p + 46 + nameLen)
    const name = rawName.toString(flags & 0x800 ? 'utf8' : 'latin1')
    entries.push({
      name,
      size: uncompSize === 0xffffffff ? compSize : uncompSize,
      offset: localOffset
    })
    p += 46 + nameLen + extraLen + commentLen
    if (entries.length >= eocd.totalEntries && eocd.totalEntries > 0) break
  }
  return entries
}

/**
 * Read the payload of an entry that is stored uncompressed (method 0). Used for
 * the ODF \`mimetype\` entry, which the ODF spec requires to be first and stored.
 */
export function readStoredEntry(buf: Buffer, name: string): Buffer | null {
  const entry = listZipEntries(buf).find((e) => e.name === name)
  if (!entry) return null
  const lho = entry.offset
  if (lho < 0 || lho + 30 > buf.length) return null
  if (buf.readUInt32LE(lho) !== 0x04034b50) return null
  const method = buf.readUInt16LE(lho + 8)
  if (method !== 0) return null
  const nameLen = buf.readUInt16LE(lho + 26)
  const extraLen = buf.readUInt16LE(lho + 28)
  const start = lho + 30 + nameLen + extraLen
  const size = entry.size
  if (start + size > buf.length) return null
  return buf.subarray(start, start + size)
}

/**
 * Read a single entry payload, inflating it when necessary. Returns null when the
 * entry is missing or the container cannot be parsed.
 */
export function readZipEntry(buf: Buffer, name: string): Buffer | null {
  const stored = readStoredEntry(buf, name)
  if (stored) return stored
  try {
    const files = unzipSync(new Uint8Array(buf), {
      filter: (file) => file.name === name
    })
    const payload = files[name]
    if (!payload) return null
    return Buffer.from(payload)
  } catch {
    return null
  }
}

/** True when the buffer starts with a local file header or a bare central directory. */
export function looksLikeZip(buf: Buffer): boolean {
  if (buf.length < 4) return false
  const sig = buf.readUInt32LE(0)
  return sig === 0x04034b50 || sig === EOCD_SIG || sig === CEN_SIG
}
