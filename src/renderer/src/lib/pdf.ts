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

/** Read the intrinsic size of every page, used for the info drawer and layout. */
export async function readPageSizes(
  doc: PdfDocumentProxyLike
): Promise<Array<{ width: number; height: number }>> {
  const sizes: Array<{ width: number; height: number }> = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale: 1 })
    sizes.push({ width: viewport.width, height: viewport.height })
  }
  return sizes
}
