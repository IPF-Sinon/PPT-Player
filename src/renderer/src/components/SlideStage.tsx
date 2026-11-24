import { useEffect, useRef } from 'react'
import type { PdfDocumentProxyLike } from '../lib/pdf'
import { renderPageToCanvas } from '../lib/render'

interface SlideStageProps {
  doc: PdfDocumentProxyLike | null
  pageIndex: number
  zoom: number
  onDoubleClick?: () => void
}

/**
 * Renders the current slide fitted into the available box. The zoom factor
 * multiplies the fitted size, and the holder scrolls when it no longer fits.
 */
export function SlideStage({ doc, pageIndex, zoom, onDoubleClick }: SlideStageProps) {
  const holderRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!doc) return
    const holder = holderRef.current
    if (!holder) return
    let cancelled = false

    const draw = async (): Promise<void> => {
      const rect = holder.getBoundingClientRect()
      if (rect.width < 32 || rect.height < 32) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const bitmap = await renderPageToCanvas({
        doc,
        pageNumber: pageIndex + 1,
        boxWidth: (rect.width - 8) * zoom,
        boxHeight: (rect.height - 8) * zoom,
        dpr
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
    }

    void draw()

    const observer = new ResizeObserver(() => {
      void draw()
    })
    observer.observe(holder)

    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [doc, pageIndex, zoom])

  if (!doc) return null

  return (
    <div className="stage" data-testid="slide-stage">
      <div
        className="stage-zoom-holder"
        data-scroll={zoom > 1}
        ref={holderRef}
        onDoubleClick={onDoubleClick}
        role="presentation"
      >
        <div className="slide-card">
          <canvas ref={canvasRef} data-testid="slide-canvas" />
        </div>
      </div>
    </div>
  )
}
