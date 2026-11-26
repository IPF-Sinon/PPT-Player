import type { PdfDocumentProxyLike, PdfPageProxyLike } from './pdf'

export interface RenderRequest {
  doc: PdfDocumentProxyLike
  pageNumber: number
  /** Target CSS pixel size of the destination box. */
  boxWidth: number
  boxHeight: number
  dpr: number
  /** Abort a render that is no longer wanted, e.g. while the window is resizing. */
  signal?: AbortSignal
}

export interface RenderedBitmap {
  canvas: HTMLCanvasElement
  width: number
  height: number
}

/** Render one PDF page into a fresh canvas sized to fit the destination box. */
export async function renderPageToCanvas(req: RenderRequest): Promise<RenderedBitmap> {
  const page: PdfPageProxyLike = await req.doc.getPage(req.pageNumber)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(req.boxWidth / base.width, req.boxHeight / base.height)
  const viewport = page.getViewport({ scale: scale * req.dpr })

  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.floor(viewport.width))
  canvas.height = Math.max(1, Math.floor(viewport.height))
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('无法创建画布上下文')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  const task = page.render({ canvasContext: context, viewport, canvas })
  const onAbort = (): void => task.cancel()
  req.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    await task.promise
  } finally {
    req.signal?.removeEventListener('abort', onAbort)
  }
  return { canvas, width: canvas.width, height: canvas.height }
}

/** A small LRU for rendered bitmaps, keyed by page and size bucket. */
export class BitmapCache {
  private readonly capacity: number
  private readonly order: string[] = []
  private readonly items = new Map<string, RenderedBitmap>()

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity)
  }

  key(pageNumber: number, bucket: number): string {
    return `${pageNumber}:${bucket}`
  }

  get(key: string): RenderedBitmap | undefined {
    const hit = this.items.get(key)
    if (!hit) return undefined
    const at = this.order.indexOf(key)
    if (at >= 0) {
      this.order.splice(at, 1)
      this.order.push(key)
    }
    return hit
  }

  set(key: string, value: RenderedBitmap): void {
    if (this.items.has(key)) {
      const at = this.order.indexOf(key)
      if (at >= 0) this.order.splice(at, 1)
    }
    this.items.set(key, value)
    this.order.push(key)
    while (this.order.length > this.capacity) {
      const oldest = this.order.shift()
      if (oldest) this.items.delete(oldest)
    }
  }

  clear(): void {
    this.items.clear()
    this.order.length = 0
  }

  get size(): number {
    return this.items.size
  }
}

/** Serialise render work so thumbnails never starve the visible slide. */
export class RenderQueue {
  private tail: Promise<unknown> = Promise.resolve()

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task)
    this.tail = next.catch(() => undefined)
    return next
  }
}