/**
 * Copy the pdf.js runtime assets the renderer serves.
 *
 * cmaps are pruned to the encodings presentations actually use. pdf.js ships 169
 * mapping tables covering every legacy CJK vendor encoding; a deck exported by
 * PowerPoint or LibreOffice uses the Identity tables plus the Adobe GB1/CNS1/Japan
 * families. Keeping only those removes roughly two thirds of the directory.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'))
const target = join(process.cwd(), 'src', 'renderer', 'public')
mkdirSync(target, { recursive: true })

/** CMap name prefixes worth shipping. */
const KEEP_CMAP_PREFIXES = [
  'Identity-',
  'Adobe-GB1-',
  'Adobe-CNS1-',
  'Adobe-Japan1-',
  'Adobe-Korea1-',
  'UniGB-',
  'UniCNS-',
  'UniJIS',
  'UniKS-',
  'GBK-EUC-',
  'GB-EUC-',
  'GBpc-EUC-',
  'GBKp-EUC-',
  'B5pc-',
  'ETen-B5-',
  'HKscs-B5-',
  '90ms-RKSJ-',
  '90msp-RKSJ-',
  'EUC-',
  'KSC-EUC-',
  'KSCms-UHC-'
]

function copyCmaps() {
  const from = join(pdfjsRoot, 'cmaps')
  const to = join(target, 'cmaps')
  if (!existsSync(from)) {
    console.error('[copy-pdfjs-assets] missing', from)
    process.exit(1)
  }
  rmSync(to, { recursive: true, force: true })
  mkdirSync(to, { recursive: true })

  let copied = 0
  let skipped = 0
  for (const name of readdirSync(from)) {
    if (!KEEP_CMAP_PREFIXES.some((prefix) => name.startsWith(prefix))) {
      skipped++
      continue
    }
    cpSync(join(from, name), join(to, name))
    copied++
  }
  console.log('[copy-pdfjs-assets] cmaps: kept ' + copied + ', skipped ' + skipped)
}

function copyStandardFonts() {
  const from = join(pdfjsRoot, 'standard_fonts')
  const to = join(target, 'standard_fonts')
  if (!existsSync(from)) {
    console.error('[copy-pdfjs-assets] missing', from)
    process.exit(1)
  }
  rmSync(to, { recursive: true, force: true })
  mkdirSync(to, { recursive: true })
  cpSync(from, to, { recursive: true })
  console.log('[copy-pdfjs-assets] standard_fonts copied')
}

copyCmaps()
copyStandardFonts()

// The worker must be a real file served from the app origin so the CSP stays tight.
const workerFrom = join(pdfjsRoot, 'build', 'pdf.worker.min.mjs')
if (!existsSync(workerFrom)) {
  console.error('[copy-pdfjs-assets] missing worker', workerFrom)
  process.exit(1)
}
cpSync(workerFrom, join(target, 'pdf.worker.min.mjs'))
console.log('[copy-pdfjs-assets] worker copied')
