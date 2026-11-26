import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { InkPage, InkStroke } from '@shared/types'
import { zh } from '@shared/strings.zh'
import { useAppStore } from '../store'
import { RenderQueue, renderPageToCanvas } from '../lib/render'
import { PlayToolbar, type PlayTool } from '../components/PlayToolbar'
import { InkLayer } from '../components/InkLayer'
import { Whiteboard } from '../components/Whiteboard'
import '../styles/playback.css'

const IDLE_MS = 2500

export default function PlaybackPage() {
  const store = useAppStore()
  const [pageIndex, setPageIndex] = useState(0)
  const [chromeVisible, setChromeVisible] = useState(true)
  const [tool, setTool] = useState<PlayTool>('pointer')
  const [boardOpen, setBoardOpen] = useState(false)
  const [boardStrokes, setBoardStrokes] = useState<InkStroke[]>([])
  const [toast, setToast] = useState('')
  const [ink, setInk] = useState<InkPage[]>([])
  const [pendingDigits, setPendingDigits] = useState('')
  const [ratio, setRatio] = useState(16 / 9)
  const [painted, setPainted] = useState(false)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [penColor, setPenColor] = useState('#ef4444')
  const [penWidth, setPenWidth] = useState(5)

  const frameRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const idleTimer = useRef<number | null>(null)
  const toastTimer = useRef<number | null>(null)
  const queue = useMemo(() => new RenderQueue(), [])
  const pageCount = store.deck.info?.pageCount ?? 0
  const doc = store.deck.doc

  const showToast = useCallback((message: string): void => {
    // Clear the previous timer: without this a fast sequence of messages left
    // earlier timers running and cleared the toast too early.
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = window.setTimeout(() => setToast(''), 1600)
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
        showToast(zh.playback.startOfDeck)
        return
      }
      if (next > pageCount - 1) {
        showToast(zh.playback.endOfDeck)
        return
      }
      setPageIndex(next)
      pokeChrome()
    },
    [pageCount, pokeChrome, showToast]
  )

  const next = useCallback(() => goTo(pageIndex + 1), [goTo, pageIndex])
  const prev = useCallback(() => goTo(pageIndex - 1), [goTo, pageIndex])

  const exitShow = useCallback((): void => {
    void window.api.exitPlayback()
  }, [])

  // Ink and settings are already in the shared store, so entering playback needs no
  // IPC round trip and no PDF reload: the document is the one the preview mounted.
  useEffect(() => {
    setPageIndex(Math.min(store.currentPage, Math.max(0, (store.deck.info?.pageCount ?? 1) - 1)))
    setInk(store.ink)
    const size = store.deck.info?.pageSizes?.[0]
    if (size && size.height > 0) setRatio(size.width / size.height)
  }, [store.currentPage, store.deck.info, store.ink])

  useEffect(() => {
    pokeChrome()
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current)
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [pokeChrome])

  const stateRef = useRef({ pageIndex, pageCount, boardOpen, pendingDigits })
  stateRef.current = { pageIndex, pageCount, boardOpen, pendingDigits }

  // Keyboard: one stable listener reading the latest state, so it never rebinds
  // mid-show and never drops a key.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const state = stateRef.current
      const key = event.key

      if (/^[0-9]$/.test(key)) {
        setPendingDigits((d) => (d + key).slice(0, 4))
        return
      }

      switch (key) {
        case 'Enter': {
          if (state.pendingDigits) {
            const target = Number(state.pendingDigits)
            setPendingDigits('')
            if (target >= 1 && target <= state.pageCount) setPageIndex(target - 1)
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
          goTo(state.pageIndex + 1)
          return
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
        case 'p':
        case 'P':
          event.preventDefault()
          goTo(state.pageIndex - 1)
          return
        case 'Home':
          event.preventDefault()
          setPageIndex(0)
          return
        case 'End':
          event.preventDefault()
          setPageIndex(Math.max(0, state.pageCount - 1))
          return
        case 'Escape':
          if (state.boardOpen) {
            setBoardOpen(false)
            return
          }
          exitShow()
          return
        case 'd':
        case 'D':
          setBoardOpen((v) => !v)
          return
        case 'b':
        case 'B':
        case '.':
          setTool((t) => (t === 'pointer' ? 'pen' : 'pointer'))
          return
        case 'e':
        case 'E':
          setTool((t) => (t === 'eraser' ? 'pointer' : 'eraser'))
          return
        case 'u':
        case 'U':
          undoStroke()
          return
        default:
          setPendingDigits('')
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goTo, exitShow])

  // Leave playback when the window stops being fullscreen, whatever caused it.
  useEffect(() => {
    return window.api.onPlayState((state) => {
      if (!state.active) exitShow()
    })
  }, [exitShow])

  // Keep the slide box measured so the ink layer and canvas agree on coordinates.
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const measure = (): void => {
      setBox({ width: frame.clientWidth, height: frame.clientHeight })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  // Render the current slide into the box CSS has already sized.
  useEffect(() => {
    const frame = frameRef.current
    if (!doc || !frame) return
    const rect = frame.getBoundingClientRect()
    if (rect.width < 32 || rect.height < 32) return

    let cancelled = false
    const controller = new AbortController()

    void (async () => {
      try {
        const bitmap = await queue.run(() =>
          renderPageToCanvas({
            doc,
            pageNumber: pageIndex + 1,
            boxWidth: rect.width,
            boxHeight: rect.height,
            dpr: Math.min(2, window.devicePixelRatio || 1),
            signal: controller.signal
          })
        )
        if (cancelled) return
        const canvas = canvasRef.current
        if (!canvas) return
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const ctx = canvas.getContext('2d')
        ctx?.drawImage(bitmap.canvas, 0, 0)
        setPainted(true)
      } catch {
        // Cancelled by a page change.
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [doc, pageIndex, box.width, box.height, queue])

  const currentStrokes = ink.find((p) => p.pageIndex === pageIndex)?.strokes ?? []

  const persistInk = useCallback((pages: InkPage[]): void => {
    const deckId = useAppStore.getState().deck.info?.deckId
    if (deckId) void window.api.saveInk(deckId, pages)
  }, [])

  const commitStroke = useCallback(
    (stroke: InkStroke): void => {
      setInk((prev) => {
        const exists = prev.some((p) => p.pageIndex === pageIndex)
        const nextPages = exists
          ? prev.map((p) => (p.pageIndex === pageIndex ? { ...p, strokes: [...p.strokes, stroke] } : p))
          : [...prev, { pageIndex, strokes: [stroke] }]
        persistInk(nextPages)
        return nextPages
      })
    },
    [pageIndex, persistInk]
  )

  const undoStroke = useCallback((): void => {
    setInk((prev) => {
      const target = prev.find((p) => p.pageIndex === pageIndex)
      if (!target || target.strokes.length === 0) return prev
      const nextPages = prev.map((p) =>
        p.pageIndex === pageIndex ? { ...p, strokes: p.strokes.slice(0, -1) } : p
      )
      persistInk(nextPages)
      return nextPages
    })
  }, [pageIndex, persistInk])

  const clearInk = useCallback((): void => {
    setInk((prev) => {
      const nextPages = prev.map((p) => (p.pageIndex === pageIndex ? { ...p, strokes: [] } : p))
      persistInk(nextPages)
      return nextPages
    })
  }, [pageIndex, persistInk])

  const onStageClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (tool !== 'pointer') return
    const rect = event.currentTarget.getBoundingClientRect()
    const position = (event.clientX - rect.left) / rect.width
    if (position > 0.66) next()
    else if (position < 0.34) prev()
    else pokeChrome()
  }

  return (
    <div
      className="playback"
      data-testid="playback-page"
      data-board={boardOpen}
      onMouseMove={pokeChrome}
    >
      <div className="slide-wrap" onClick={onStageClick} role="presentation">
        <div
          className="slide-frame"
          ref={frameRef}
          data-painted={painted}
          style={{ ['--slide-ratio' as string]: String(ratio) }}
        >
          <canvas ref={canvasRef} data-testid="playback-canvas" />
          <InkLayer
            boxWidth={box.width}
            boxHeight={box.height}
            strokes={currentStrokes}
            drawing={tool === 'pen' || tool === 'eraser'}
            tool={tool === 'eraser' ? 'eraser' : 'pen'}
            color={penColor}
            widthPx={penWidth}
            onCommit={commitStroke}
          />
        </div>
      </div>

      {boardOpen ? (
        <Whiteboard
          strokes={boardStrokes}
          tool={tool === 'eraser' ? 'eraser' : 'pen'}
          color={penColor}
          widthPx={penWidth}
          onCommit={(stroke) => setBoardStrokes((prev) => [...prev, stroke])}
        />
      ) : null}

      <div className="page-indicator" data-visible={chromeVisible} data-testid="page-indicator">
        {pageIndex + 1} / {pageCount}
      </div>

      <PlayToolbar
        tool={tool}
        boardOpen={boardOpen}
        canUndo={currentStrokes.length > 0}
        penColor={penColor}
        penWidth={penWidth}
        visible={chromeVisible}
        onTool={(t) => {
          setTool(t)
          pokeChrome()
        }}
        onPrev={prev}
        onNext={next}
        onToggleBoard={() => {
          setBoardOpen((v) => !v)
          pokeChrome()
        }}
        onColor={(color) => {
          setPenColor(color)
          setTool('pen')
        }}
        onWidth={(width) => {
          setPenWidth(width)
          setTool('pen')
        }}
        onUndo={boardOpen ? () => setBoardStrokes((prev) => prev.slice(0, -1)) : undoStroke}
        onClear={boardOpen ? () => setBoardStrokes([]) : clearInk}
        onEnd={exitShow}
      />

      {toast ? (
        <div className="play-toast" data-testid="play-toast">
          {toast}
        </div>
      ) : null}
    </div>
  )
}
