import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'))
const target = join(process.cwd(), 'src', 'renderer', 'public')
mkdirSync(target, { recursive: true })

for (const dir of ['cmaps', 'standard_fonts']) {
  const from = join(pdfjsRoot, dir)
  const to = join(target, dir)
  if (!existsSync(from)) {
    console.error('[copy-pdfjs-assets] missing', from)
    process.exit(1)
  }
  rmSync(to, { recursive: true, force: true })
  mkdirSync(to, { recursive: true })
  cpSync(from, to, { recursive: true })
  console.log('[copy-pdfjs-assets]', dir, '->', to)
}

// The worker must be a real file served from the app origin so the CSP stays tight.
const workerFrom = join(pdfjsRoot, 'build', 'pdf.worker.min.mjs')
if (!existsSync(workerFrom)) {
  console.error('[copy-pdfjs-assets] missing worker', workerFrom)
  process.exit(1)
}
const workerTo = join(target, 'pdf.worker.min.mjs')
cpSync(workerFrom, workerTo)
console.log('[copy-pdfjs-assets] worker ->', workerTo)
