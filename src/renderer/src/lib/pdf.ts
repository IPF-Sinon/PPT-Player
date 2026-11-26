/**
 * pdf.js loading.
 *
 * The library is imported on demand. It used to be a static top-level import, so
 * the full parser was parsed before the app could paint anything, even when the
 * user had not opened a file yet.
 */

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
  getOperatorList(): Promise<{ fnArray: unknown[] }>
}

export interface PdfDocumentProxyLike {
  numPages: number
  getPage(pageNumber: number): Promise<PdfPageProxyLike>
  destroy(): Promise<void>
}

interface PdfjsModule {
  getDocument(params: Record<string, unknown>): { promise: Promise<unknown> }
  GlobalWorkerOptions: { workerSrc: string }
}

let pdfjsPromise: Promise<PdfjsModule> | null = null

/** Load pdf.js once, on first use. */
export async function getPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const mod = (await import('pdfjs-dist')) as unknown as PdfjsModule
      mod.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', document.baseURI).toString()
      return mod
    })()
  }
  return pdfjsPromise
}

/** Warm the parser up while the UI is idle, so the first open feels instant. */
export function preloadPdfjs(): void {
  const run = (): void => {
    void getPdfjs()
  }
  if ('requestIdleCallback' in window) {
    ;(window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(run)
  } else {
    setTimeout(run, 800)
  }
}

export async function loadPdf(url: string): Promise<PdfDocumentProxyLike> {
  const pdfjs = await getPdfjs()
  const cmapsBase = new URL('cmaps/', document.baseURI).toString()
  const fontsBase = new URL('standard_fonts/', document.baseURI).toString()
  const task = pdfjs.getDocument({
    url,
    cMapUrl: cmapsBase,
    cMapPacked: true,
    standardFontDataUrl: fontsBase
  })
  return (await task.promise) as unknown as PdfDocumentProxyLike
}

/** Size of the first page only, enough to lay out the stage before the rest. */
export async function readFirstPageSize(
  doc: PdfDocumentProxyLike
): Promise<{ width: number; height: number } | null> {
  if (doc.numPages < 1) return null
  const page = await doc.getPage(1)
  const viewport = page.getViewport({ scale: 1 })
  return { width: viewport.width, height: viewport.height }
}

/**
 * Read the intrinsic size of every page, in small concurrent batches.
 *
 * The optional callback fires after each batch so the caller can lay out the
 * thumbnail rail progressively instead of waiting for the whole deck.
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
