// Generates src-tauri/src/gbk_table.bin, the two-byte GBK decoding table.
//
// GBK is not derivable arithmetically: it orders ideographs by pinyin, not by
// Unicode code point, so the only correct decoder is a table. This script derives
// that table from the platform ICU decoder (Node with full-icu) so the Rust side
// needs no crate and no network at build time.
//
// Run: node scripts/gen-gbk-table.mjs
import { writeFileSync } from 'node:fs'
// Imported from node:util rather than taken from the global scope so the script works
// the same under any lint configuration, and so the dependency is visible at the top.
// Node built with full-icu provides the GBK decoder, which is what makes deriving the
// table possible instead of hand-writing 24 000 mappings.

import { TextDecoder } from 'node:util'

const decoder = new TextDecoder('gbk', { fatal: true })

// GBK is two bytes: lead 0x81..=0xFE, trail 0x40..=0xFE with 0x7F excluded.
const LEADS = []
for (let lead = 0x81; lead <= 0xfe; lead++) LEADS.push(lead)
const TRAILS = []
for (let trail = 0x40; trail <= 0xfe; trail++) if (trail !== 0x7f) TRAILS.push(trail)

const out = Buffer.alloc(LEADS.length * TRAILS.length * 2)
let at = 0
let mapped = 0
for (const lead of LEADS) {
  for (const trail of TRAILS) {
    let code = 0
    try {
      const text = decoder.decode(Buffer.from([lead, trail]))
      // Only single-code-point results are real mappings; an unmapped pair throws
      // or yields a replacement character.
      if (text.length === 1 && text !== '\uFFFD') code = text.codePointAt(0)
    } catch {
      code = 0
    }
    // The table stores one u16 per entry; anything above the BMP is left unmapped
    // and decoded as a replacement character by the Rust reader.
    if (code > 0xffff) code = 0
    if (code !== 0) mapped++
    out.writeUInt16LE(code, at)
    at += 2
  }
}

writeFileSync(new URL('../src-tauri/src/gbk_table.bin', import.meta.url), out)
console.log(
  '[gen-gbk-table] wrote ' +
    out.length +
    ' bytes, ' +
    mapped +
    ' of ' +
    LEADS.length * TRAILS.length +
    ' pairs mapped'
)