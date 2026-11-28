// Generate the .ico tauri-build needs for the Windows resource file.
//
// Committed as a script rather than a binary asset so the file is reviewable and the
// build cannot fail because an opaque blob went missing.

import { mkdirSync, writeFileSync } from 'node:fs'

const W = 32
const H = 32

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(1, 4)

const entry = Buffer.alloc(16)
entry.writeUInt8(W, 0)
entry.writeUInt8(H, 1)
entry.writeUInt16LE(1, 4)
entry.writeUInt16LE(32, 6)

const dib = Buffer.alloc(40)
dib.writeUInt32LE(40, 0)
dib.writeInt32LE(W, 4)
dib.writeInt32LE(H * 2, 8)
dib.writeUInt16LE(1, 12)
dib.writeUInt16LE(32, 14)
dib.writeUInt32LE(W * H * 4, 20)

const pixels = Buffer.alloc(W * H * 4)
for (let i = 0; i < W * H; i++) {
  pixels[i * 4 + 0] = 0x99
  pixels[i * 4 + 1] = 0x7a
  pixels[i * 4 + 2] = 0x3b
  pixels[i * 4 + 3] = 0xff
}

const maskRow = Math.ceil(W / 32) * 4
const mask = Buffer.alloc(maskRow * H)
const image = Buffer.concat([dib, pixels, mask])

entry.writeUInt32LE(image.length, 8)
entry.writeUInt32LE(6 + 16, 12)

mkdirSync('src-tauri/icons', { recursive: true })
writeFileSync('src-tauri/icons/icon.ico', Buffer.concat([header, entry, image]))
console.log('[make-tauri-icon] wrote src-tauri/icons/icon.ico')
