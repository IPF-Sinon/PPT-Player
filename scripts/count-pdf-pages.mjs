// Counts pages in a PDF using the same parser the app renders with, so the
// engine smoke gate cannot be fooled by a structurally valid but empty export.
import { readFileSync } from 'node:fs'

async function main() {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: node scripts/count-pdf-pages.mjs <file.pdf>')
    process.exit(2)
  }

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(readFileSync(file))
  const task = pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false })
  const doc = await task.promise
  const pages = doc.numPages

  // Verify the first page actually has drawable content, so an empty export
  // cannot pass the gate on page count alone.
  let firstPageOps = 0
  if (pages > 0) {
    const page = await doc.getPage(1)
    const list = await page.getOperatorList()
    firstPageOps = list.fnArray.length
  }

  await task.destroy()
  console.log(JSON.stringify({ pages, firstPageOps }))
}

main().catch((err) => {
  console.error('count-pdf-pages failed:', err?.message ?? err)
  process.exit(1)
})
