/** Minimal Compound File Binary (OLE2) directory reader. */

const CFB_SIG = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
const HEADER_BYTES = 512
const DIR_ENTRY_BYTES = 128
const END_OF_CHAIN = -2
const MAX_REG_SECT = 0xfffffffa

export interface CfbEntry {
  name: string
  /** 1 = storage, 2 = stream, 5 = root storage. */
  type: number
  size: number
}

export function looksLikeCfb(buf: Buffer): boolean {
  return buf.length >= HEADER_BYTES && buf.subarray(0, 8).equals(CFB_SIG)
}

function sectorOffset(sectorId: number, sectorSize: number): number {
  return (sectorId + 1) * sectorSize
}

function readFat(buf: Buffer, sectorSize: number, difatSectors: number[], fatSectorCount: number): Int32Array {
  const perSector = sectorSize / 4
  const out = new Int32Array(Math.max(1, fatSectorCount * perSector))
  let written = 0
  for (const sid of difatSectors) {
    const off = sectorOffset(sid, sectorSize)
    if (off + sectorSize > buf.length) break
    for (let i = 0; i < perSector; i++) {
      if (written >= out.length) break
      out[written++] = buf.readInt32LE(off + i * 4)
    }
    if (written >= out.length) break
  }
  return out.subarray(0, written)
}

function readChain(buf: Buffer, fat: Int32Array, start: number, sectorSize: number, maxSectors: number): Buffer {
  const parts: Buffer[] = []
  let cur = start
  let guard = 0
  while (cur >= 0 && cur <= MAX_REG_SECT && guard < maxSectors) {
    const off = sectorOffset(cur, sectorSize)
    if (off + sectorSize > buf.length) break
    parts.push(buf.subarray(off, off + sectorSize))
    cur = cur < fat.length ? fat[cur] : END_OF_CHAIN
    guard++
  }
  return Buffer.concat(parts)
}

/**
 * List the directory entries of a CFB container. Returns an empty array when the
 * buffer is not a parseable compound file.
 */
export function listCfbEntries(buf: Buffer): CfbEntry[] {
  if (!looksLikeCfb(buf)) return []
  const sectorShift = buf.readUInt16LE(30)
  const sectorSize = 1 << sectorShift
  if (sectorSize < 128 || sectorSize > 65536) return []

  const fatSectorCount = buf.readUInt32LE(44)
  const firstDirSector = buf.readInt32LE(48)
  const firstDifatSector = buf.readInt32LE(68)

  const difat: number[] = []
  for (let i = 0; i < 109; i++) {
    const sid = buf.readInt32LE(76 + i * 4)
    if (sid >= 0 && sid <= MAX_REG_SECT) difat.push(sid)
  }

  let difatSector = firstDifatSector
  const perSector = sectorSize / 4
  let difatGuard = 0
  while (difatSector >= 0 && difatSector <= MAX_REG_SECT && difatGuard < 512) {
    const off = sectorOffset(difatSector, sectorSize)
    if (off + sectorSize > buf.length) break
    for (let i = 0; i < perSector - 1; i++) {
      const sid = buf.readInt32LE(off + i * 4)
      if (sid >= 0 && sid <= MAX_REG_SECT) difat.push(sid)
    }
    difatSector = buf.readInt32LE(off + (perSector - 1) * 4)
    difatGuard++
  }

  const fat = readFat(buf, sectorSize, difat, fatSectorCount)
  if (fat.length === 0) return []

  const maxDirSectors = Math.ceil(buf.length / sectorSize) + 1
  const dirBuf = readChain(buf, fat, firstDirSector, sectorSize, maxDirSectors)
  if (dirBuf.length < DIR_ENTRY_BYTES) return []

  const entries: CfbEntry[] = []
  for (let off = 0; off + DIR_ENTRY_BYTES <= dirBuf.length; off += DIR_ENTRY_BYTES) {
    const nameBytes = dirBuf.readUInt16LE(off + 64)
    const type = dirBuf.readUInt8(off + 66)
    if (type === 0 || nameBytes < 2 || nameBytes > 64) continue
    const name = dirBuf.subarray(off, off + nameBytes - 2).toString('utf16le')
    const size = Number(dirBuf.readBigUInt64LE(off + 120) & 0xffffffffn)
    entries.push({ name, type, size })
    if (entries.length > 4096) break
  }
  return entries
}

export function hasStream(entries: CfbEntry[], name: string): boolean {
  const target = name.toLowerCase()
  return entries.some((e) => e.type === 2 && e.name.toLowerCase() === target)
}
