import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { InkPage, InkStroke } from '@shared/types'
import { zh } from '@shared/strings.zh'
import { useAppStore } from '../store'
import { loadPdf, readPageSizes } from '../lib/pdf'
import { RenderQueue, renderPageToCanvas } from '../lib/render'
import { SideNav } from '../components/SideNav'
import { PlayToolbar, type PlayTool } from '../components/PlayToolbar'
import { InkLayer } from '../components/InkLayer'
import { OverviewGrid } from '../components/OverviewGrid'
import '../styles/playback.css'

const IDLE_MS = 2500
const LENS_SIZE = 240
const LENS_ZOOM = 2.4

interface FrameSize {
  width: number
  height: number
  dpr: number
}

export default function PlaybackPage() {
  const store = useAppStore()
  const [pageIndex, setPageIndex] = useState(0)
  const [chromeVisible, setChromeVisible] = useState(true)
  const [tool, setTool] = useState<PlayTool>('pointer')
  const [blackout, setBlackout] = useState(false)
  const [whiteout, setWhiteout] = useState(false)
  const [overviewOpen, setOverviewOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [ink, setInk] = useState<InkPage[]>([])
  const [dark, setDark] = useState(false)
  const [pendingDigits, setPendingDigits] = useState('')
  const [loop, setLoop] = useState(false)
  const [frame, setFrame] = useState<FrameSize>({ width: 0, height: 0, dpr: 1 })
  const [lens, setLens] = useState<{ x: number; y: number } | null>(null)

  const stageRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const idleTimer = useRef<number | null>(null)
  const queue = useMemo(() => new RenderQueue(), [])
  const pageCount = store.deck.info?.pageCount ?? 0

  const showToast = useCallback((message: string): void => {
    setToast(message)
    window.setTimeout(() => setToast(''), 1600)
  }, [])

  const pokeChrome = useCallback((): void => {
    setChromeVisible(true)
    if (idleTimer.current) window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => setChromeVisible(false), IDLE_MS)
  }, [])

  const goTo = useCallback(
    (next: number): void => {
      if (pageCount === 0) return
      if (next < 0) {
        if (loop) {
          setPageIndex(pageCount - 1)
          return
        }
        showToast(zh.playback.startOfDeck)
        return
      }
      if (next > pageCount - 1) {
        if (loop) {
          setPageIndex(0)
          return
        }
        showToast(zh.playback.endOfDeck)
        return
      }
      setPageIndex(next)
      setLens(null)
      pokeChrome()
    },
    [loop, pageCount, pokeChrome, showToast]
  )

  const next = useCallback(() => goTo(pageIndex + 1), [goTo, pageIndex])
  const prev = useCallback(() => goTo(pageIndex - 1), [goTo, pageIndex])

  const endShow = useCallback(async (): Promise<void> => {
    await window.api.exitPlayback()
  }, [])

  useEffect(() => {
    let cancelled = false
    const boot = async (): Promise<void> => {
      const ctx = await window.api.playbackContext()
      if (!ctx || cancelled) return
      const info = await window.api.deckInfo(ctx.deckId)
      if (!info) {
        await window.api.exitPlayback()
        return
      }
      const url = (await window.api.deckUrl(ctx.deckId)) ?? ''
      const doc = await loadPdf(url)
      const sizes = await readPageSizes(doc)
      if (cancelled) return
      store.setDeck({ info: { ...info, pageCount: doc.numPages, pageSizes: sizes }, doc, url })
      store.setPage(ctx.pageIndex)
      setPageIndex(Math.min(ctx.pageIndex, Math.max(0, doc.numPages - 1)))
      const saved = await window.api.loadInk(ctx.deckId)
      if (!cancelled) setInk(saved)
      const settings = await window.api.getSettings()
      if (!cancelled) setLoop(settings.loopPlayback)
      document.title = zh.windowTitle(info.sourcePath.split(/[\\/]/).pop() ?? '')
    }
    void boot()
    return () => {
      cancelled = true
    }
  }, [store])

  useEffect(() => {
    pokeChrome()
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current)
    }
  }, [pokeChrome])

  // Render the current slide and size the frame it occupies.
  useEffect(() => {
    const doc = store.deck.doc
    if (!doc) return
    let cancelled = false

    const draw = async (): Promise<void> => {
      const host = stageRef.current
      if (!host) return
      const rect = host.getBoundingClientRect()
      if (rect.width < 64 || rect.height < 64) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const bitmap = await renderPageToCanvas({
        doc,
        pageNumber: pageIndex + 1,
        boxWidth: Math.max(160, rect.width - 64),
        boxHeight: Math.max(90, rect.height - 64),
        dpr
      })
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const cssWidth = Math.round(bitmap.width / dpr)
      const cssHeight = Math.round(bitmap.height / dpr)
      canvas.style.width = cssWidth + 'px'
      canvas.style.height = cssHeight + 'px'
      const ctx = canvas.getContext('2d')
      ctx?.drawImage(bitmap.canvas, 0, 0)
      setFrame({ width: cssWidth, height: cssHeight, dpr })

      // Sample the slide corner so the chrome can invert over light decks.
      try {
        const sample = ctx?.getImageData(0, 0, Math.min(24, canvas.width), Math.min(24, canvas.height))
        if (sample) {
          const data = sample.data
          let sum = 0
          for (let i = 0; i < data.length; i += 4) {
            sum += (data[i] ?? 0) * 0.299 + (data[i + 1] ?? 0) * 0.587 + (data[i + 2] ?? 0) * 0.114
          }
          setDark(sum / (data.length / 4) > 150)
        }
      } catch {
        setDark(false)
      }
    }

    void draw()

    const onResize = (): void => {
      void draw()
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelled = true
      window.removeEventListener('resize', onResize)
    }
  }, [store.deck.doc, pageIndex, queue])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      pokeChrome()
      const key = event.key

      if (/^[0-9]$/.test(key)) {
        setPendingDigits((d) => (d + key).slice(0, 4))
        return
      }

      switch (key) {
        case 'Enter': {
          if (pendingDigits) {
            const target = Number(pendingDigits)
            setPendingDigits('')
            if (target >= 1 && target <= pageCount) goTo(target - 1)
          }
          event.preventDefault()
          return
        }
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
        case 'n':
        case 'N':
          event.preventDefault()
          next()
          return
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
        case 'p':
        case 'P':
          event.preventDefault()
          prev()
          return
        case 'Home':
          goTo(0)
          return
        case 'End':
          goTo(pageCount - 1)
          return
        case 'Escape':
          if (overviewOpen) {
            setOverviewOpen(false)
            return
          }
          if (helpOpen) {
            setHelpOpen(false)
            return
          }
          void endShow()
          return
        case 'b':
        case 'B':
        case '.':
          setWhiteout(false)
          setBlackout((v) => !v)
          return
        case 'w':
        case 'W':
          setBlackout(false)
          setWhiteout((v) => !v)
          return
        case 'o':
        case 'O':
          setOverviewOpen((v) => !v)
          return
        case 'l':
        case 'L':
          setTool('magnifier')
          return
        case 'e':
        case 'E':
          setTool('eraser')
          return
        case '?':
          setHelpOpen((v) => !v)
          return
        default:
          setPendingDigits('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [endShow, goTo, helpOpen, next, overviewOpen, pageCount, pendingDigits, pokeChrome, prev])

  const commitStroke = useCallback(
    (stroke: InkStroke): void => {
      setInk((prev) => {
        const exists = prev.some((p) => p.pageIndex === pageIndex)
        const nextPages = exists
          ? prev.map((p) => (p.pageIndex === pageIndex ? { ...p, strokes: [...p.strokes, stroke] } : p))
          : [...prev, { pageIndex, strokes: [stroke] }]
        const deckId = store.deck.info?.deckId
        if (deckId) void window.api.saveInk(deckId, nextPages)
        return nextPages
      })
    },
    [pageIndex, store.deck.info?.deckId]
  )

  const currentStrokes = ink.find((p) => p.pageIndex === pageIndex)?.strokes ?? []

  const onStageClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (tool !== 'pointer') return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = (event.clientX - rect.left) / rect.width
    if (ratio > 0.66) next()
    else if (ratio < 0.34) prev()
    else pokeChrome()
  }

  const onStageMove = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (tool !== 'magnifier') {
      if (lens) setLens(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    setLens({ x: event.clientX - rect.left, y: event.clientY - rect.top })
  }

  const lensLeft = lens ? Math.min(Math.max(0, lens.x - LENS_SIZE / 2), Math.max(0, frame.width - LENS_SIZE)) : 0
  const lensTop = lens ? Math.min(Math.max(0, lens.y - LENS_SIZE / 2), Math.max(0, frame.height - LENS_SIZE)) : 0

  return (
    <div
      className="playback"
      data-testid="playback-page"
      data-blackout={blackout}
      data-whiteout={whiteout}
      onMouseMove={pokeChrome}
    >
      <div className="slide-wrap" ref={stageRef}>
        <div
          className="slide-frame"
          style={{ width: frame.width || undefined, height: frame.height || undefined }}
          onClick={onStageClick}
          onMouseMove={onStageMove}
          onMouseLeave={() => setLens(null)}
          role="presentation"
        >
          <canvas ref={canvasRef} data-testid="playback-canvas" />
          <InkLayer
            width={frame.width}
            height={frame.height}
            strokes={currentStrokes}
            active={tool === 'pen' || tool === 'eraser'}
            tool={tool === 'eraser' ? 'eraser' : 'pen'}
            color="#e11d48"
            widthPx={4}
            onCommit={commitStroke}
          />
          {lens ? (
            <div
              className="magnifier"
              data-testid="magnifier-lens"
              style={{ left: lensLeft, top: lensTop }}
            >
              <canvas
                ref={(node) => {
                  if (!node || !canvasRef.current) return
                  const source = canvasRef.current
                  node.width = source.width
                  node.height = source.height
                  const ctx = node.getContext('2d')
                  if (ctx) {
                    ctx.clearRect(0, 0, node.width, node.height)
                    ctx.drawImage(source, 0, 0)
                  }
                }}
                style={{
                  width: frame.width * LENS_ZOOM + 'px',
                  height: frame.height * LENS_ZOOM + 'px',
                  left: -(lens.x * LENS_ZOOM - LENS_SIZE / 2) + 'px',
                  top: -(lens.y * LENS_ZOOM - LENS_SIZE / 2) + 'px'
                }}
              />
            </div>
          ) : null}
        </div>
      </div>

      <SideNav
        side="left"
        pageIndex={pageIndex}
        pageCount={pageCount}
        onPrev={prev}
        onNext={next}
        visible={chromeVisible}
      />
      <SideNav
        side="right"
        pageIndex={pageIndex}
        pageCount={pageCount}
        onPrev={prev}
        onNext={next}
        visible={chromeVisible}
      />

      <PlayToolbar
        tool={tool}
        blackout={blackout}
        overviewOpen={overviewOpen}
        onTool={(t) => {
          setTool(t)
          if (t !== 'magnifier') setLens(null)
          pokeChrome()
        }}
        onToggleBlackout={() => {
          setWhiteout(false)
          setBlackout((v) => !v)
        }}
        onToggleOverview={() => setOverviewOpen((v) => !v)}
        onEnd={() => void endShow()}
        visible={chromeVisible}
        dark={dark}
      />

      {overviewOpen && store.deck.doc ? (
        <OverviewGrid
          doc={store.deck.doc}
          pageCount={pageCount}
          currentPage={pageIndex}
          queue={queue}
          onSelect={(page) => setPageIndex(page)}
          onClose={() => setOverviewOpen(false)}
        />
      ) : null}

      {helpOpen ? (
        <div className="help-panel" data-testid="help-panel">
          <h2>{zh.playback.helpTitle}</h2>
          <dl>
            {zh.playback.helpRows.map(([keys, desc]) => (
              <div key={keys} style={{ display: 'contents' }}>
                <dt>{keys}</dt>
                <dd>{desc}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}