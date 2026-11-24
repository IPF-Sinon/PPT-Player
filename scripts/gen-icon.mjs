import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const outDir = join(process.cwd(), 'resources')
mkdirSync(outDir, { recursive: true })

/** Build a PNG buffer from raw RGBA pixels. */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const idat = deflateSync(raw, { level: 9 })

  const chunks = []
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  chunks.push(sig)

  const crcTable = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crcTable[n] = c
  }
  const crc32 = (buf) => {
    let c = 0xffffffff
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }

  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const typeBuf = Buffer.from(type, 'latin1')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0)
    return Buffer.concat([len, typeBuf, data, crc])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  chunks.push(chunk('IHDR', ihdr))
  chunks.push(chunk('IDAT', idat))
  chunks.push(chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(chunks)
}

/** Draw the app icon: rounded blue tile with a slide card. */
function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4)
  const radius = size * 0.22
  const put = (x, y, r, g, b, a) => {
    const i = (y * size + x) * 4
    const src = a / 255
    const dst = rgba[i + 3] / 255
    const outA = src + dst * (1 - src)
    if (outA === 0) return
    rgba[i] = Math.round((r * src + rgba[i] * dst * (1 - src)) / outA)
    rgba[i + 1] = Math.round((g * src + rgba[i + 1] * dst * (1 - src)) / outA)
    rgba[i + 2] = Math.round((b * src + rgba[i + 2] * dst * (1 - src)) / outA)
    rgba[i + 3] = Math.round(outA * 255)
  }

  const inRoundedRect = (x, y, x0, y0, x1, y1, r) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false
    const cx = Math.min(Math.max(x, x0 + r), x1 - r)
    const cy = Math.min(Math.max(y, y0 + r), y1 - r)
    const dx = x - cx
    const dy = y - cy
    return dx * dx + dy * dy <= r * r
  }

  const cardX0 = size * 0.18
  const cardY0 = size * 0.25
  const cardX1 = size * 0.82
  const cardY1 = size * 0.67

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inRoundedRect(x, y, 0, 0, size - 1, size - 1, radius)) {
        const t = (x + y) / (2 * size)
        put(x, y, Math.round(59 + (30 - 59) * t), Math.round(130 + (58 - 130) * t), Math.round(246 + (138 - 246) * t), 255)
      }
      if (inRoundedRect(x, y, cardX0, cardY0, cardX1, cardY1, size * 0.05)) {
        put(x, y, 255, 255, 255, 250)
      }
      const bar = (y0, y1, x0, x1, r, g, b) => {
        if (y >= y0 && y <= y1 && x >= x0 && x <= x1) put(x, y, r, g, b, 255)
      }
      bar(size * 0.26, size * 0.33, size * 0.24, size * 0.55, 30, 58, 138)
      bar(size * 0.38, size * 0.42, size * 0.24, size * 0.74, 147, 197, 253)
      bar(size * 0.46, size * 0.5, size * 0.24, size * 0.68, 191, 219, 254)
      bar(size * 0.7, size * 0.74, size * 0.32, size * 0.68, 255, 255, 255)
    }
  }
  return rgba
}

const png512 = encodePng(512, 512, drawIcon(512))
writeFileSync(join(outDir, 'icon.png'), png512)

// ICO container with a single 256x256 PNG payload (Vista+ layout).
const png256 = encodePng(256, 256, drawIcon(256))
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(1, 4)
const entry = Buffer.alloc(16)
entry[0] = 0
entry[1] = 0
entry[2] = 0
entry[3] = 0
entry.writeUInt16LE(1, 4)
entry.writeUInt16LE(32, 6)
entry.writeUInt32LE(png256.length, 8)
entry.writeUInt32LE(22, 12)
writeFileSync(join(outDir, 'icon.ico'), Buffer.concat([header, entry, png256]))

console.log('[gen-icon] wrote resources/icon.png and resources/icon.ico')
