import { useEffect, useRef } from 'react'
import type { PdfDocumentProxyLike } from '../lib/pdf'
import { renderPageToCanvas } from '../lib/render'

interface SlideStageProps {
  doc: PdfDocumentProxyLike | null
  pageIndex: number
  /** Page aspect ratio, used to size the card in CSS. */
  ratio: number
  onDoubleClick?: () => void
}

/**
 * Renders the current slide fitted into the available box.
 *
 * The canvas CSS size is owned by the stylesheet, not by this component. Setting
 * it here from the measured box created a feedback loop: a bigger canvas made the
 * observed container bigger, which produced a bigger canvas again, and the slide
 * grew until it covered the whole window. Only the backing-store resolution is set
 * from JS, so layout stays stable.
 */
export function SlideStage({ doc, pageIndex, ratio, onDoubleClick }: SlideStageProps) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!doc) return
    const card = cardRef.current
    if (!card) return

    let cancelled = false
    let raf = 0
    let controller: AbortController | null = null

    const draw = async (): Promise<void> => {
      const rect = card.getBoundingClientRect()
      if (rect.width < 32 || rect.height < 32) return

      controller?.abort()
      controller = new AbortController()

      const dpr = Math.min(2, window.devicePixelRatio || 1)
      try {
        const bitmap = await renderPageToCanvas({
          doc,
          pageNumber: pageIndex + 1,
          boxWidth: rect.width,
          boxHeight: rect.height,
          dpr,
          signal: controller.signal
        })
        if (cancelled) return
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(bitmap.canvas, 0, 0)
      } catch {
        // A render cancelled by a resize or page change is expected.
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
    observer.observe(card)

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
      <div className="stage-zoom-holder" onDoubleClick={onDoubleClick} role="presentation">
        <div className="slide-card" ref={cardRef} style={{ aspectRatio: String(ratio) }}>
          <canvas ref={canvasRef} data-testid="slide-canvas" />
        </div>
      </div>
    </div>
  )
}
