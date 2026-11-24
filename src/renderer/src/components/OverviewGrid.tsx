import { useEffect, useRef } from 'react'
import type { PdfDocumentProxyLike } from '../lib/pdf'
import { renderPageToCanvas, type RenderQueue } from '../lib/render'

interface OverviewGridProps {
  doc: PdfDocumentProxyLike
  pageCount: number
  currentPage: number
  queue: RenderQueue
  onSelect: (pageIndex: number) => void
  onClose: () => void
}

function OverviewCell({
  doc,
  pageNumber,
  active,
  queue,
  onSelect
}: {
  doc: PdfDocumentProxyLike
  pageNumber: number
  active: boolean
  queue: RenderQueue
  onSelect: (pageIndex: number) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    let cancelled = false
    const draw = async (): Promise<void> => {
      const bitmap = await queue.run(() =>
        renderPageToCanvas({
          doc,
          pageNumber,
          boxWidth: 320,
          boxHeight: 200,
          dpr: Math.min(1.5, window.devicePixelRatio || 1)
        })
      )
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const ctx = canvas.getContext('2d')
      ctx?.drawImage(bitmap.canvas, 0, 0)
    }
    void draw()
    return () => {
      cancelled = true
    }
  }, [doc, pageNumber, queue])

  return (
    <button
      type="button"
      className="overview-cell"
      data-active={active}
      onClick={() => onSelect(pageNumber - 1)}
      data-testid={`overview-${pageNumber}`}
    >
      <canvas ref={canvasRef} />
      <span>{pageNumber}</span>
    </button>
  )
}

export function OverviewGrid({ doc, pageCount, currentPage, queue, onSelect, onClose }: OverviewGridProps) {
  return (
    <div className="overview" data-testid="overview-grid" onClick={onClose} role="presentation">
      <div className="overview-inner" onClick={(e) => e.stopPropagation()} role="presentation">
        {Array.from({ length: pageCount }, (_, i) => (
          <OverviewCell
            key={i}
            doc={doc}
            pageNumber={i + 1}
            active={i === currentPage}
            queue={queue}
            onSelect={(page) => {
              onSelect(page)
              onClose()
            }}
          />
        ))}
      </div>
    </div>
  )
}
