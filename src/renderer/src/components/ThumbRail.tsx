import { useEffect, useRef } from 'react'
import type { PdfDocumentProxyLike } from '../lib/pdf'
import { renderPageToCanvas, type RenderQueue } from '../lib/render'

interface ThumbProps {
  doc: PdfDocumentProxyLike
  pageNumber: number
  active: boolean
  queue: RenderQueue
  onSelect: (pageIndex: number) => void
}

const THUMB_WIDTH = 200

export function Thumb({ doc, pageNumber, active, queue, onSelect }: ThumbProps) {
  const holderRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const renderedRef = useRef(false)

  useEffect(() => {
    const holder = holderRef.current
    if (!holder) return
    let cancelled = false

    const draw = async (): Promise<void> => {
      if (renderedRef.current) return
      const base = await doc.getPage(pageNumber)
      const viewport = base.getViewport({ scale: 1 })
      const height = Math.round((THUMB_WIDTH * viewport.height) / viewport.width)
      const bitmap = await queue.run(() =>
        renderPageToCanvas({
          doc,
          pageNumber,
          boxWidth: THUMB_WIDTH,
          boxHeight: height,
          dpr: Math.min(2, window.devicePixelRatio || 1)
        })
      )
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      canvas.style.width = '100%'
      canvas.style.height = 'auto'
      const ctx = canvas.getContext('2d')
      ctx?.drawImage(bitmap.canvas, 0, 0)
      renderedRef.current = true
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) void draw()
        }
      },
      { root: null, rootMargin: '240px', threshold: 0.01 }
    )
    observer.observe(holder)

    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [doc, pageNumber, queue])

  return (
    <button
      type="button"
      className="rail-item"
      data-active={active}
      data-testid={`thumb-${pageNumber}`}
      onClick={() => onSelect(pageNumber - 1)}
      aria-label={`第 ${pageNumber} 页`}
      aria-current={active ? 'true' : undefined}
    >
      <span className="rail-index">{pageNumber}</span>
      <div ref={holderRef}>
        <canvas ref={canvasRef} />
      </div>
    </button>
  )
}

interface ThumbRailProps {
  doc: PdfDocumentProxyLike | null
  pageCount: number
  currentPage: number
  queue: RenderQueue
  onSelect: (pageIndex: number) => void
}

export function ThumbRail({ doc, pageCount, currentPage, queue, onSelect }: ThumbRailProps) {
  if (!doc) {
    return (
      <aside className="rail" data-testid="thumb-rail">
        <p className="rail-empty">未打开演示文稿</p>
      </aside>
    )
  }

  return (
    <aside className="rail" data-testid="thumb-rail">
      {Array.from({ length: pageCount }, (_, i) => (
        <Thumb
          key={i}
          doc={doc}
          pageNumber={i + 1}
          active={i === currentPage}
          queue={queue}
          onSelect={onSelect}
        />
      ))}
    </aside>
  )
}
