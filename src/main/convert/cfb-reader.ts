/**
 * Minimal Compound File Binary (OLE2) directory reader over a byte source.
 *
 * Only the header, the FAT sectors and the directory chain are read. The stream
 * payloads, which hold the bulk of a .ppt, are never touched.
 */

import { bufferSource, type ByteSource } from './byte-source'

/** Accept raw bytes or a byte source, so callers stay simple. */
type ByteSourceInput = ByteSource | Buffer

function asSource(input: ByteSourceInput): ByteSource {
  return Buffer.isBuffer(input) ? bufferSource(input) : input
}

const CFB_SIG = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
const HEADER_BYTES = 512
const DIR_ENTRY_BYTES = 128
const END_OF_CHAIN = -2
const MAX_REG_SECT = 0xfffffffa
/** Guards against pathological files claiming an enormous directory. */
const MAX_DIR_ENTRIES = 4096

export interface CfbEntry {
  name: string
  /** 1 = storage, 2 = stream, 5 = root storage. */
  type: number
  size: number
}

export function looksLikeCfb(input: ByteSourceInput): boolean {
  const source = asSource(input)
  if (source.size < HEADER_BYTES) return false
  const head = source.read(0, 8)
  return head.length === 8 && head.equals(CFB_SIG)
}

function sectorOffset(sectorId: number, sectorSize: number): number {
  return (sectorId + 1) * sectorSize
}

function readFat(
  source: ByteSource,
  sectorSize: number,
  difatSectors: number[],
  fatSectorCount: number
): Int32Array {
  const perSector = sectorSize / 4
  const out = new Int32Array(Math.max(1, fatSectorCount * perSector))
  let written = 0
  for (const sid of difatSectors) {
    if (written >= out.length) break
    const off = sectorOffset(sid, sectorSize)
    const sector = source.read(off, sectorSize)
    if (sector.length < sectorSize) break
    for (let i = 0; i < perSector; i++) {
      if (written >= out.length) break
      out[written++] = sector.readInt32LE(i * 4)
    }
  }
  return out.subarray(0, written)
}

function readChain(
  source: ByteSource,
  fat: Int32Array,
  start: number,
  sectorSize: number,
  maxSectors: number
): Buffer {
  const parts: Buffer[] = []
  let cur = start
  let guard = 0
  while (cur >= 0 && cur <= MAX_REG_SECT && guard < maxSectors) {
    const sector = source.read(sectorOffset(cur, sectorSize), sectorSize)
    if (sector.length < sectorSize) break
    parts.push(sector)
    cur = cur < fat.length ? fat[cur] : END_OF_CHAIN
    guard++
  }
  return Buffer.concat(parts)
}

/**
 * List the directory entries of a CFB container. Returns an empty array when the
 * source is not a parseable compound file.
 */
export function listCfbEntries(input: ByteSourceInput): CfbEntry[] {
  const source = asSource(input)
  if (!looksLikeCfb(source)) return []
  const header = source.read(0, HEADER_BYTES)
  if (header.length < HEADER_BYTES) return []

  const sectorShift = header.readUInt16LE(30)
  const sectorSize = 1 << sectorShift
  if (sectorSize < 128 || sectorSize > 65536) return []

  const fatSectorCount = header.readUInt32LE(44)
  const firstDirSector = header.readInt32LE(48)
  const firstDifatSector = header.readInt32LE(68)

  const difat: number[] = []
  for (let i = 0; i < 109; i++) {
    const sid = header.readInt32LE(76 + i * 4)
    if (sid >= 0 && sid <= MAX_REG_SECT) difat.push(sid)
  }

  const perSector = sectorSize / 4
  let difatSector = firstDifatSector
  let difatGuard = 0
  while (difatSector >= 0 && difatSector <= MAX_REG_SECT && difatGuard < 512) {
    const sector = source.read(sectorOffset(difatSector, sectorSize), sectorSize)
    if (sector.length < sectorSize) break
    for (let i = 0; i < perSector - 1; i++) {
      const sid = sector.readInt32LE(i * 4)
      if (sid >= 0 && sid <= MAX_REG_SECT) difat.push(sid)
    }
    difatSector = sector.readInt32LE((perSector - 1) * 4)
    difatGuard++
  }

  const fat = readFat(source, sectorSize, difat, fatSectorCount)
  if (fat.length === 0) return []

  // A directory never needs more sectors than the file has; cap the walk so a
  // corrupt FAT cannot make this loop forever.
  const maxDirSectors = Math.min(Math.ceil(source.size / sectorSize) + 1, MAX_DIR_ENTRIES)
  const dirBuf = readChain(source, fat, firstDirSector, sectorSize, maxDirSectors)
  if (dirBuf.length < DIR_ENTRY_BYTES) return []

  const entries: CfbEntry[] = []
  for (let off = 0; off + DIR_ENTRY_BYTES <= dirBuf.length; off += DIR_ENTRY_BYTES) {
    const nameBytes = dirBuf.readUInt16LE(off + 64)
    const type = dirBuf.readUInt8(off + 66)
    if (type === 0 || nameBytes < 2 || nameBytes > 64) continue
    const name = dirBuf.subarray(off, off + nameBytes - 2).toString('utf16le')
    const size = Number(dirBuf.readBigUInt64LE(off + 120) & 0xffffffffn)
    entries.push({ name, type, size })
    if (entries.length >= MAX_DIR_ENTRIES) break
  }
  return entries
}

export function hasStream(entries: CfbEntry[], name: string): boolean {
  const target = name.toLowerCase()
  return entries.some((e) => e.type === 2 && e.name.toLowerCase() === target)
}