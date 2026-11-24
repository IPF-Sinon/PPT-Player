import * as pdfjs from 'pdfjs-dist'

pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', document.baseURI).toString()

export interface PdfViewport {
  width: number
  height: number
}

export interface PdfRenderTask {
  promise: Promise<void>
  cancel(): void
}

export interface PdfPageProxyLike {
  getViewport(params: { scale: number; rotation?: number }): PdfViewport
  render(params: {
    canvasContext: CanvasRenderingContext2D
    viewport: PdfViewport
    canvas?: HTMLCanvasElement
  }): PdfRenderTask
}

export interface PdfDocumentProxyLike {
  numPages: number
  getPage(pageNumber: number): Promise<PdfPageProxyLike>
  destroy(): Promise<void>
}

const cmapsBase = new URL('cmaps/', document.baseURI).toString()
const fontsBase = new URL('standard_fonts/', document.baseURI).toString()

export async function loadPdf(url: string): Promise<PdfDocumentProxyLike> {
  const task = pdfjs.getDocument({
    url,
    cMapUrl: cmapsBase,
    cMapPacked: true,
    standardFontDataUrl: fontsBase
  })
  return (await task.promise) as unknown as PdfDocumentProxyLike
}

/**
 * Read the intrinsic size of every page.
 *
 * Opening used to await all of these before the first slide could appear, which
 * is dead time on a 200-page deck. The caller now needs page 1 immediately and
 * the rest only for the overview grid, so sizes are resolved in small batches and
 * handed back as they arrive.
 */
export async function readPageSizes(
  doc: PdfDocumentProxyLike,
  onProgress?: (sizes: Array<{ width: number; height: number }>) => void
): Promise<Array<{ width: number; height: number }>> {
  const sizes: Array<{ width: number; height: number }> = []
  const batch = 8
  for (let start = 1; start <= doc.numPages; start += batch) {
    const end = Math.min(doc.numPages, start + batch - 1)
    const numbers: number[] = []
    for (let i = start; i <= end; i++) numbers.push(i)
    const pages = await Promise.all(numbers.map((n) => doc.getPage(n)))
    for (const page of pages) {
      const viewport = page.getViewport({ scale: 1 })
      sizes.push({ width: viewport.width, height: viewport.height })
    }
    onProgress?.([...sizes])
  }
  return sizes
}

/** Size of the first page only, enough to lay out the stage before parsing the rest. */
export async function readFirstPageSize(
  doc: PdfDocumentProxyLike
): Promise<{ width: number; height: number } | null> {
  if (doc.numPages < 1) return null
  const page = await doc.getPage(1)
  const viewport = page.getViewport({ scale: 1 })
  return { width: viewport.width, height: viewport.height }
}