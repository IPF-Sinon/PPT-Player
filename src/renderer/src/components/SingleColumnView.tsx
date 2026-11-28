import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { CategoryBinding, DocumentCategory, InkStroke } from '@shared/types'
import { InkLayer } from './InkLayer'
import { PptxSlideView } from './PptxSlideView'
import { renderPageToCanvas, type RenderQueue } from '../lib/render'
import type { PdfDocumentProxyLike } from '../lib/pdf'
import type { LoadedNativeDeck } from '../lib/pptx/deck'

/** Zoom range offered by the pinch and ctrl+wheel gestures. */
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 3

/** A page starts rendering this far outside the viewport. */
const MOUNT_MARGIN = '600px 0px'
/** The band across the middle of the viewport that decides the current page. */
const CURRENT_BAND = '-45% 0px -45% 0px'

/**
 * Aspect ratio used when a page's real size is unknown.
 *
 * A deck is wide, a Word document is a portrait page and a sheet is landscape; using
 * one default for all three would size the column wrongly until the sizes arrive.
 */
const FALLBACK_RATIO: Record<DocumentCategory, number> = {
  ppt: 16 / 9,
  pdf: 8.5 / 11,
  docx: 1 / Math.SQRT2,
  xls: Math.SQRT2
}

/** One page's content box, in CSS pixels, at the current zoom. */
export interface PageBox {
  width: number
  height: number
  zoom: number
}

/** Imperative handle so the host can drive the column from the keyboard. */
export interface SingleColumnController {
  /**
   * Bring the given page to the top of the viewport.
   *
   * A page the reader is already looking at is left alone: the host calls this
   * whenever its current page changes, and that includes the change the column
   * itself just reported, so scrolling then would fight the reader's own scroll.
   */
  scrollToPage(pageIndex: number): void
  getZoom(): number
}

export interface SingleColumnViewProps {
  category: DocumentCategory
  binding: CategoryBinding
  pageCount: number
  /** Page sizes in points, in document order; may lag behind pageCount. */
  pageSizes: Array<{ width: number; height: number }>
  /** Draw one page into the measured box. Only called for mounted pages. */
  renderPage: (pageIndex: number, box: PageBox) => ReactNode
  strokesOf: (pageIndex: number) => InkStroke[]
  drawing: boolean
  tool: 'pen' | 'eraser'
  color: string
  widthPx: number
  onCommitStroke: (pageIndex: number, stroke: InkStroke) => void
  /** The page the reader should land on when the column appears. */
  initialPage: number
  /** The page under the middle of the viewport changed. */
  onVisiblePage: (pageIndex: number) => void
  /** A press landed on a page, so the floating toolbar should get out of the way. */
  onStrokeStart: () => void
  controllerRef?: { current: SingleColumnController | null }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function touchDistance(touches: TouchList): number {
  const a = touches[0]
  const b = touches[1]
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

function touchMidpoint(touches: TouchList): { x: number; y: number } {
  const a = touches[0]
  const b = touches[1]
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }
}

/**
 * Continuous reading view.
 *
 * Pages are stacked in one column at the full width of the window, so a document
 * reads like a document instead of being paged through like a slide. Only the pages
 * near the viewport hold a canvas: a 200 page PDF would otherwise allocate 200
 * canvases at once and take the tab down with it.
 *
 * Zoom is applied by scaling the column's own width rather than by transforming a
 * wrapper, because a transform leaves the scroll area at its old size and the reader
 * cannot reach the parts of the page that moved off-screen. Content coordinates
 * therefore scale linearly with the zoom factor, which is what makes anchoring the
 * zoom on the pointer a two-line calculation.
 */
export function SingleColumnView(props: SingleColumnViewProps) {
  const {
    category,
    binding,
    pageCount,
    pageSizes,
    renderPage,
    strokesOf,
    drawing,
    tool,
    color,
    widthPx,
    onCommitStroke,
    initialPage,
    onVisiblePage,
    onStrokeStart,
    controllerRef
  } = props

  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const pageEls = useRef(new Map<number, HTMLDivElement>())
  /** Measured page boxes, kept so an unmounted page still holds its slot exactly. */
  const measured = useRef(new Map<number, { width: number; height: number }>())
  const [mounted, setMounted] = useState<Set<number>>(() => new Set(pageCount > 0 ? [0] : []))
  // Seeded from the window so the first paint already has real page heights; the
  // scroller measurement below then corrects it once layout has settled.
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window === 'undefined' ? 0 : window.innerWidth
  )
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  /** Scroll position to restore once the new width has been laid out. */
  const pendingScroll = useRef<{ left: number; top: number } | null>(null)
  const currentPage = useRef(-1)
  /**
   * Where the current page sat, in scroller coordinates.
   *
   * Page sizes arrive after the page count does, so the first frame lays the column
   * out from a guessed aspect ratio and the real one lands a moment later. Holding
   * this lets that correction keep the reader on the same line instead of scrolling
   * them somewhere else.
   */
  const anchor = useRef<{ index: number; top: number } | null>(null)
  /**
   * The host's callback, held in a ref.
   *
   * It is re-created on every store update, and using it as an effect dependency
   * would tear down and rebuild both observers several times a second while the
   * reader scrolls.
   */
  const visiblePageRef = useRef(onVisiblePage)
  visiblePageRef.current = onVisiblePage

  const ratios = useMemo(() => {
    const fallback = FALLBACK_RATIO[category]
    return Array.from({ length: pageCount }, (_, index) => {
      const size = pageSizes[index] ?? pageSizes[0]
      if (size && size.width > 0 && size.height > 0) return size.width / size.height
      return fallback
    })
  }, [pageCount, pageSizes, category])

  const trackWidth = viewportWidth * zoom

  const heightFor = useCallback(
    (index: number): number => {
      const computed = trackWidth / (ratios[index] ?? FALLBACK_RATIO[category])
      const stored = measured.current.get(index)
      if (!stored || stored.width < 1) return computed
      // Rescale the measurement taken at the old zoom, so the page keeps the exact
      // height it had and the scrollbar does not move when it remounts.
      return stored.height * (trackWidth / stored.width)
    },
    [trackWidth, ratios, category]
  )

  // Measure the scroller: the column width is derived from it, not from the pages.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const measure = (): void => setViewportWidth(scroller.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])

  // Record real page boxes after layout, for the unmounted-height cache.
  useEffect(() => {
    for (const index of mounted) {
      const element = pageEls.current.get(index)
      if (!element) continue
      const rect = element.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) measured.current.set(index, { width: rect.width, height: rect.height })
    }
  }, [mounted, trackWidth])

  /** Remember where the reader's page currently sits. */
  const recordAnchor = useCallback((): void => {
    const scroller = scrollerRef.current
    const index = currentPage.current
    const element = index >= 0 ? pageEls.current.get(index) : undefined
    if (!scroller || !element) return
    anchor.current = { index, top: element.getBoundingClientRect().top - scroller.getBoundingClientRect().top }
  }, [])

  /**
   * Land on the page the show was opened at.
   *
   * Entering a document on page 1 after the presenter pressed "start from here" on
   * page 40 would lose their place, so the column jumps once, without animation,
   * as soon as it has a real width to lay out against.
   */
  const landed = useRef(false)
  useLayoutEffect(() => {
    if (landed.current || viewportWidth < 1) return
    // Page one is already at the top, so there is nothing to wait for; anything
    // further down needs its page element to exist, which it does not on the frame
    // where the page count is still zero.
    if (initialPage <= 0) {
      landed.current = true
      return
    }
    const scroller = scrollerRef.current
    const element = pageEls.current.get(initialPage)
    if (!scroller || !element) return
    landed.current = true
    const delta = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    scroller.scrollTop = Math.max(0, scroller.scrollTop + delta - 8)
    currentPage.current = initialPage
    recordAnchor()
  }, [viewportWidth, initialPage, recordAnchor])

  // A late page-size measurement must not move the reader. Declared before the zoom
  // effect on purpose: a zoom already knows where it wants the scroll to land, and
  // this must not second-guess it.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const stored = anchor.current
    if (!scroller || !stored || pendingScroll.current) return
    const element = pageEls.current.get(stored.index)
    if (!element) return
    const top = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    const delta = top - stored.top
    if (Math.abs(delta) > 1) scroller.scrollTop += delta
  }, [trackWidth, ratios])

  // Keep the anchor current while the reader scrolls, so the correction above is
  // measured against where they actually are.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    let raf = 0
    const onScroll = (): void => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        recordAnchor()
      })
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      if (raf) cancelAnimationFrame(raf)
      scroller.removeEventListener('scroll', onScroll)
    }
  }, [recordAnchor])

  // One observer mounts pages inside the margin; a second tracks the page under the
  // middle of the viewport, which is the page the reader is actually on.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || pageCount === 0) return

    const mountObserver = new IntersectionObserver(
      (entries) => {
        setMounted((previous) => {
          let next: Set<number> | null = null
          for (const entry of entries) {
            const index = Number((entry.target as HTMLElement).dataset.page)
            if (!Number.isInteger(index)) continue
            if (entry.isIntersecting === previous.has(index)) continue
            next ??= new Set(previous)
            if (entry.isIntersecting) next.add(index)
            else next.delete(index)
          }
          return next ?? previous
        })
      },
      { root: scroller, rootMargin: MOUNT_MARGIN }
    )

    const currentObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const index = Number((entry.target as HTMLElement).dataset.page)
          if (!Number.isInteger(index) || index === currentPage.current) continue
          currentPage.current = index
          recordAnchor()
          visiblePageRef.current(index)
        }
      },
      { root: scroller, rootMargin: CURRENT_BAND }
    )

    for (const element of pageEls.current.values()) {
      mountObserver.observe(element)
      currentObserver.observe(element)
    }

    return () => {
      mountObserver.disconnect()
      currentObserver.disconnect()
    }
  }, [pageCount, recordAnchor])

  /**
   * Zoom about a point of the window.
   *
   * The point under the anchor has to stay under the anchor. In unzoomed content
   * coordinates it sits at (scroll + offset) / zoom, so after the zoom changes the
   * scroll that puts it back where it was is content * newZoom - offset.
   */
  const applyZoom = useCallback((next: number, clientX: number, clientY: number): void => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const clamped = clamp(next, MIN_ZOOM, MAX_ZOOM)
    const current = zoomRef.current
    if (Math.abs(clamped - current) < 0.002) return

    const rect = scroller.getBoundingClientRect()
    const offsetX = clientX - rect.left
    const offsetY = clientY - rect.top
    const contentX = (scroller.scrollLeft + offsetX) / current
    const contentY = (scroller.scrollTop + offsetY) / current

    pendingScroll.current = { left: contentX * clamped - offsetX, top: contentY * clamped - offsetY }
    zoomRef.current = clamped
    setZoom(clamped)
  }, [])

  // The new width is in the DOM by the time layout effects run, so the corrected
  // scroll can be applied without a visible jump.
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    const pending = pendingScroll.current
    if (!scroller || !pending) return
    pendingScroll.current = null
    scroller.scrollLeft = Math.max(0, pending.left)
    scroller.scrollTop = Math.max(0, pending.top)
    recordAnchor()
  }, [zoom, recordAnchor])

  // Desktop trackpads report a pinch as ctrl+wheel. Only that combination zooms:
  // a plain wheel must keep scrolling the column.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) return
      event.preventDefault()
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
      applyZoom(zoomRef.current * Math.exp(-delta * 0.0025), event.clientX, event.clientY)
    }
    scroller.addEventListener('wheel', onWheel, { passive: false })
    return () => scroller.removeEventListener('wheel', onWheel)
  }, [applyZoom])

  // Two-finger pinch on touch screens. touchmove must be non-passive to be able to
  // stop the browser from doing its own page zoom.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    let start: { distance: number; zoom: number } | null = null

    const onStart = (event: TouchEvent): void => {
      start =
        event.touches.length === 2
          ? { distance: Math.max(1, touchDistance(event.touches)), zoom: zoomRef.current }
          : null
    }
    const onMove = (event: TouchEvent): void => {
      if (!start || event.touches.length !== 2) return
      event.preventDefault()
      const midpoint = touchMidpoint(event.touches)
      const ratio = touchDistance(event.touches) / start.distance
      applyZoom(start.zoom * ratio, midpoint.x, midpoint.y)
    }
    const onEnd = (event: TouchEvent): void => {
      if (event.touches.length < 2) start = null
    }

    scroller.addEventListener('touchstart', onStart, { passive: true })
    scroller.addEventListener('touchmove', onMove, { passive: false })
    scroller.addEventListener('touchend', onEnd, { passive: true })
    scroller.addEventListener('touchcancel', onEnd, { passive: true })
    return () => {
      scroller.removeEventListener('touchstart', onStart)
      scroller.removeEventListener('touchmove', onMove)
      scroller.removeEventListener('touchend', onEnd)
      scroller.removeEventListener('touchcancel', onEnd)
    }
  }, [applyZoom])

  useEffect(() => {
    if (!controllerRef) return
    controllerRef.current = {
      scrollToPage: (index: number) => {
        const scroller = scrollerRef.current
        const element = pageEls.current.get(index)
        if (!scroller || !element || index === currentPage.current) return
        // Measured against the scroller rather than read from offsetTop, which would
        // depend on whichever ancestor happens to be the offset parent.
        const delta = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top
        scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + delta - 8), behavior: 'smooth' })
      },
      getZoom: () => zoomRef.current
    }
    return () => {
      controllerRef.current = null
    }
  }, [controllerRef])

  const registerPage = useCallback((index: number, element: HTMLDivElement | null): void => {
    if (element) pageEls.current.set(index, element)
    else pageEls.current.delete(index)
  }, [])

  const pages: ReactNode[] = []
  for (let index = 0; index < pageCount; index++) {
    const height = heightFor(index)
    const isMounted = mounted.has(index)
    pages.push(
      <div
        key={index}
        className="sc-page"
        data-page={index}
        data-mounted={isMounted}
        style={{ height }}
        ref={(element) => registerPage(index, element)}
        onPointerDownCapture={() => {
          // Only a real stroke collapses the ball; a press that begins a scroll must
          // leave the menu where the reader put it.
          if (drawing) onStrokeStart()
        }}
        role="presentation"
      >
        <div className="sc-page-inner">
          {isMounted ? renderPage(index, { width: trackWidth, height, zoom }) : null}
          {isMounted ? (
            <InkLayer
              boxWidth={trackWidth}
              boxHeight={height}
              strokes={strokesOf(index)}
              drawing={drawing}
              tool={tool}
              color={color}
              widthPx={widthPx}
              onCommit={(stroke) => onCommitStroke(index, stroke)}
            />
          ) : null}
        </div>
        <span className="sc-page-number" aria-hidden="true">
          {index + 1}
        </span>
      </div>
    )
  }

  return (
    <div
      className="single-column"
      data-testid="single-column-view"
      data-category={category}
      data-toolbar={binding.toolbarStyle}
      data-view-mode={binding.viewMode}
      data-zoom={zoom.toFixed(2)}
    >
      <div className="sc-scroller" ref={scrollerRef}>
        <div className="sc-track" style={{ width: trackWidth > 0 ? trackWidth : '100%' }}>
          {pages}
        </div>
      </div>
      {Math.abs(zoom - 1) > 0.001 ? (
        <button
          type="button"
          className="sc-zoom"
          data-testid="sc-zoom"
          title="恢复 100%"
          aria-label={'当前缩放 ' + Math.round(zoom * 100) + '%，点击恢复 100%'}
          onClick={() => {
            const scroller = scrollerRef.current
            if (!scroller) return
            const rect = scroller.getBoundingClientRect()
            applyZoom(1, rect.left + rect.width / 2, rect.top + rect.height / 2)
          }}
        >
          {Math.round(zoom * 100)}%
        </button>
      ) : null}
    </div>
  )
}

export interface PageCanvasProps {
  doc: PdfDocumentProxyLike
  pageIndex: number
  width: number
  height: number
  zoom: number
  /** Shared with the rest of the app so renders never starve the visible page. */
  queue: RenderQueue
}

/**
 * One PDF page inside the column.
 *
 * The bitmap is rendered at a half-step quality bucket rather than at the exact
 * zoom: rendering on every wheel tick re-parses the page dozens of times a second,
 * and rendering only at 100% goes visibly soft once the reader zooms in.
 */
export function PageCanvas({ doc, pageIndex, width, height, zoom, queue }: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const quality = Math.min(2, Math.max(1, Math.round(zoom * 2) / 2))
  // Both the zoom and the box are quantised before they reach the renderer. A pinch
  // produces dozens of wheel events a second, and re-parsing a page for each of them
  // is what makes zooming a long document stutter; a 64px bucket and a half-step of
  // quality mean a whole pinch usually costs two or three renders.
  const bucketWidth = Math.max(8, Math.round((width * quality) / 64) * 64)
  const bucketHeight = Math.max(8, Math.round((height * quality) / 64) * 64)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || bucketWidth < 8 || bucketHeight < 8) return
    let cancelled = false
    const controller = new AbortController()

    void (async () => {
      try {
        const bitmap = await queue.run(() =>
          renderPageToCanvas({
            doc,
            pageNumber: pageIndex + 1,
            boxWidth: bucketWidth,
            boxHeight: bucketHeight,
            dpr: Math.min(2, window.devicePixelRatio || 1),
            signal: controller.signal
          })
        )
        if (cancelled) return
        const target = canvasRef.current
        if (!target) return
        target.width = bitmap.width
        target.height = bitmap.height
        target.getContext('2d')?.drawImage(bitmap.canvas, 0, 0)
      } catch {
        // Cancelled by a zoom, a scroll out of range, or a page change.
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [doc, pageIndex, bucketWidth, bucketHeight, queue])

  return <canvas ref={canvasRef} className="sc-canvas" data-testid="sc-canvas" />
}

export interface NativePageCanvasProps {
  /** The parsed deck; slides are parsed on demand and cached inside it. */
  deck: Pick<LoadedNativeDeck, 'slides' | 'loadSlide'>
  pageIndex: number
}

/**
 * One natively rendered slide inside the column.
 *
 * The deck parses slides lazily and caches them in place, so a page that has never
 * been visited is requested here and the component re-renders when it arrives. The
 * column virtualises as well, so only the slides near the viewport are ever parsed.
 */
export function NativePageCanvas({ deck, pageIndex }: NativePageCanvasProps) {
  const [, setTick] = useState(0)
  const slide = deck.slides[pageIndex]

  useEffect(() => {
    if (slide) return
    let cancelled = false
    void deck.loadSlide(pageIndex).then(() => {
      // The cache is mutated in place; nothing React watches changed, so ask for a
      // render explicitly, exactly as the preview stage does.
      if (!cancelled) setTick((n) => n + 1)
    })
    return () => {
      cancelled = true
    }
  }, [deck, pageIndex, slide])

  if (!slide) return null
  return (
    <div className="sc-pptx" data-testid="sc-pptx">
      <PptxSlideView slide={slide} step={0} showAll fit />
    </div>
  )
}
