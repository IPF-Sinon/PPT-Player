import { useEffect, useRef, useState } from 'react'
import type { PdfDocumentProxyLike } from '../lib/pdf'
import { renderPageToCanvas, type RenderQueue } from '../lib/render'
import type { TabItem } from '../lib/tabs'
import type { SlideModel } from '../lib/pptx/types'
import { PptxSlideView } from './PptxSlideView'

interface ThumbProps {
  doc: PdfDocumentProxyLike
  deckId: string
  pageNumber: number
  active: boolean
  queue: RenderQueue
  onSelect: (pageIndex: number) => void
}

const THUMB_WIDTH = 200

function PdfThumb({ doc, deckId, pageNumber, active, queue, onSelect }: ThumbProps) {
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
        for (const entry of entries) if (entry.isIntersecting) void draw()
      },
      { root: null, rootMargin: '240px', threshold: 0.01 }
    )
    observer.observe(holder)

    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [doc, pageNumber, queue])

  // A new document must repaint from scratch, otherwise the thumbnails keep the
  // previous deck's pixels.
  useEffect(() => {
    renderedRef.current = false
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height)
  }, [deckId, doc])

  return (
    <button
      type="button"
      className="rail-item"
      data-active={active}
      data-testid={'thumb-' + pageNumber}
      onClick={() => onSelect(pageNumber - 1)}
      aria-label={'第 ' + pageNumber + ' 页'}
      aria-current={active ? 'true' : undefined}
    >
      <span className="rail-index">{pageNumber}</span>
      <div ref={holderRef}>
        <canvas ref={canvasRef} />
      </div>
    </button>
  )
}

interface NativeThumbProps {
  deckId: string
  slide: SlideModel | null
  pageNumber: number
  active: boolean
  onSelect: (pageIndex: number) => void
}

/**
 * Thumbnail for a native slide.
 *
 * The slide is rendered at its own logical size and scaled by CSS, which is far
 * cheaper than rasterising it: the DOM tree is small and the browser handles the
 * scaling on the compositor.
 */
function NativeThumb({ deckId, slide, pageNumber, active, onSelect }: NativeThumbProps) {
  return (
    <button
      type="button"
      className="rail-item"
      data-active={active}
      data-testid={'thumb-' + pageNumber}
      onClick={() => onSelect(pageNumber - 1)}
      aria-label={'第 ' + pageNumber + ' 页'}
      aria-current={active ? 'true' : undefined}
    >
      <span className="rail-index">{pageNumber}</span>
      <div className="rail-native" style={{ width: THUMB_WIDTH, height: slide ? (THUMB_WIDTH * slide.size.height) / slide.size.width : 112 }} data-deck={deckId}>
        {slide ? <PptxSlideView slide={slide} step={0} showAll fit /> : null}
      </div>
    </button>
  )
}

interface ThumbRailProps {
  tab: TabItem | null
  queue: RenderQueue
  onSelect: (pageIndex: number) => void
}

export function ThumbRail({ tab, queue, onSelect }: ThumbRailProps) {
  const isNative = tab?.engineMode === 'native-pptx'
  const deck = tab?.nativeDeck ?? null
  const [, forceRender] = useState(0)

  // Native slides parse lazily; ask for the ones the rail is about to show.
  useEffect(() => {
    if (!deck || !isNative) return
    let cancelled = false
    void (async () => {
      for (let i = 0; i < Math.min(deck.slideCount, 12); i++) {
        if (cancelled) return
        if (!deck.slides[i]) {
          await deck.loadSlide(i)
          if (!cancelled) forceRender((n) => n + 1)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [deck, isNative])

  if (!tab || tab.status !== 'ready') {
    return (
      <aside className="rail" data-testid="thumb-rail">
        <p className="rail-empty">未打开演示文稿</p>
      </aside>
    )
  }

  if (isNative && deck) {
    return (
      <aside className="rail" data-testid="thumb-rail">
        {Array.from({ length: tab.pageCount }, (_, i) => (
          <NativeThumb
            key={tab.tabId + '-' + i}
            deckId={tab.deckId}
            slide={deck.slides[i] ?? null}
            pageNumber={i + 1}
            active={i === tab.currentPage}
            onSelect={onSelect}
          />
        ))}
      </aside>
    )
  }

  if (!tab.pdfDoc) {
    return (
      <aside className="rail" data-testid="thumb-rail">
        <p className="rail-empty">未打开演示文稿</p>
      </aside>
    )
  }

  return (
    <aside className="rail" data-testid="thumb-rail">
      {Array.from({ length: tab.pageCount }, (_, i) => (
        <PdfThumb
          key={tab.tabId + '-' + i}
          doc={tab.pdfDoc!}
          deckId={tab.deckId}
          pageNumber={i + 1}
          active={i === tab.currentPage}
          queue={queue}
          onSelect={onSelect}
        />
      ))}
    </aside>
  )
}
