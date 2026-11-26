import { useEffect, useRef } from 'react'
import type { PdfDocumentProxyLike } from '../lib/pdf'
import { renderPageToCanvas } from '../lib/render'

interface SlideStageProps {
  doc: PdfDocumentProxyLike | null
  pageIndex: number
  onDoubleClick?: () => void
}

/**
 * Renders the current slide fitted into the available box.
 *
 * Resize is debounced through requestAnimationFrame and the previous render is
 * aborted, so dragging the window edge cannot queue up a pile of PDF renders.
 */
export function SlideStage({ doc, pageIndex, onDoubleClick }: SlideStageProps) {
  const holderRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!doc) return
    const holder = holderRef.current
    if (!holder) return

    let cancelled = false
    let raf = 0
    let controller: AbortController | null = null

    const draw = async (): Promise<void> => {
      const rect = holder.getBoundingClientRect()
      if (rect.width < 32 || rect.height < 32) return

      controller?.abort()
      controller = new AbortController()

      const dpr = Math.min(2, window.devicePixelRatio || 1)
      try {
        const bitmap = await renderPageToCanvas({
          doc,
          pageNumber: pageIndex + 1,
          boxWidth: rect.width - 8,
          boxHeight: rect.height - 8,
          dpr,
          signal: controller.signal
        })
        if (cancelled) return
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        canvas.style.width = Math.round(bitmap.width / dpr) + 'px'
        canvas.style.height = Math.round(bitmap.height / dpr) + 'px'
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(bitmap.canvas, 0, 0)
      } catch {
        // A cancelled render is expected while resizing.
      }
    }

    void draw()

    const observer = new ResizeObserver(() => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = 0
        void draw()
      })
    })
    observer.observe(holder)

    return () => {
      cancelled = true
      if (raf) cancelAnimationFrame(raf)
      controller?.abort()
      observer.disconnect()
    }
  }, [doc, pageIndex])

  if (!doc) return null

  return (
    <div className="stage" data-testid="slide-stage">
      <div className="stage-zoom-holder" ref={holderRef} onDoubleClick={onDoubleClick} role="presentation">
        <div className="slide-card">
          <canvas ref={canvasRef} data-testid="slide-canvas" />
        </div>
      </div>
    </div>
  )
}
