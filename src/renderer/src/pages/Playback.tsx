import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { InkPage, InkStroke } from '@shared/types'
import { zh } from '@shared/strings.zh'
import { useAppStore } from '../store'
import { RenderQueue, renderPageToCanvas } from '../lib/render'
import {
  canUndo,
  commitHistory,
  fromSnapshot,
  initHistory,
  undoHistory,
  type HistoryEntry
} from '../lib/ink-history'
import type { SlideModel } from '../lib/pptx/types'
import { PlayToolbar, type PlayTool, type PopoverKind } from '../components/PlayToolbar'
import { ExitInkDialog } from '../components/ExitInkDialog'
import { SideNav } from '../components/SideNav'
import { BoardPager } from '../components/BoardPager'
import { InkLayer } from '../components/InkLayer'
import { Whiteboard } from '../components/Whiteboard'
import { PptxTransition } from '../components/PptxTransition'
import '../styles/playback.css'
import '../styles/pptx.css'

const IDLE_MS = 2500

export default function PlaybackPage() {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const tab = useMemo(() => tabs.find((t) => t.tabId === activeTabId) ?? null, [tabs, activeTabId])

  const [chromeVisible, setChromeVisible] = useState(true)
  const [tool, setTool] = useState<PlayTool>('pointer')
  const [boardOpen, setBoardOpen] = useState(false)
  /** The whiteboard supports several sheets; each keeps its own strokes. */
  const [boardPages, setBoardPages] = useState<InkStroke[][]>([[]])
  const [boardPageIndex, setBoardPageIndex] = useState(0)
  const [toast, setToast] = useState('')
  const [penColor, setPenColor] = useState('#ef4444')
  // 2px reads as a pen on a projector; the old 5px default looked like a marker.
  const [penWidth, setPenWidth] = useState(2)
  const [eraserSize, setEraserSize] = useState(24)
  const [popover, setPopover] = useState<PopoverKind>(null)
  const [navPosition, setNavPosition] = useState<'bottom' | 'side'>('bottom')
  const [keepToolbar, setKeepToolbar] = useState(true)
  const [inkOnExit, setInkOnExit] = useState<'ask' | 'keep' | 'discard'>('ask')
  const [exitPrompt, setExitPrompt] = useState(false)
  /** True when this show changed the annotations, so exiting has something to ask about. */
  const [inkDirty, setInkDirty] = useState(false)
  /** Cursor position while erasing, for the footprint circle. */
  const [eraserAt, setEraserAt] = useState<{ x: number; y: number } | null>(null)
  const [painted, setPainted] = useState(false)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const [slide, setSlide] = useState<SlideModel | null>(null)
  /** Per-trigger progress, reset whenever the page changes. */
  const [triggerProgress, setTriggerProgress] = useState<Record<string, number>>({})
  const [transitionsOn, setTransitionsOn] = useState(true)

  const frameRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const idleTimer = useRef<number | null>(null)
  const toastTimer = useRef<number | null>(null)
  const queue = useMemo(() => new RenderQueue(), [])
  /** Undo stacks per slide, kept outside render so they survive repaints. */
  const historyRef = useRef<Record<number, HistoryEntry>>({})
  /** Ink as it was when the show started, so "discard" can roll back. */
  const inkAtEntry = useRef<InkPage[]>([])

  const isNative = tab?.engineMode === 'native-pptx'
  const pageIndex = tab?.currentPage ?? 0
  const step = tab?.currentStep ?? 0
  const pageCount = tab?.pageCount ?? 0
  const doc = tab?.pdfDoc ?? null

  const showToast = useCallback((message: string): void => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    setToast(message)
    toastTimer.current = window.setTimeout(() => setToast(''), 1600)
  }, [])

  const pokeChrome = useCallback((): void => {
    setChromeVisible(true)
    if (idleTimer.current) window.clearTimeout(idleTimer.current)
    // While a pen or eraser is active the bar stays put, so the presenter never
    // loses the undo button in the middle of writing.
    if (keepToolbar && tool !== 'pointer') return
    idleTimer.current = window.setTimeout(() => setChromeVisible(false), IDLE_MS)
  }, [keepToolbar, tool])

  /** Load the slide the presenter is on, parsing it if this is the first visit. */
  useEffect(() => {
    if (!isNative || !tab?.nativeDeck) {
      setSlide(null)
      return
    }
    let cancelled = false
    void (async () => {
      const model = await tab.nativeDeck!.loadSlide(pageIndex)
      if (!cancelled) {
        setSlide(model)
        // Each slide starts with none of its trigger tracks run.
        setTriggerProgress({})
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isNative, tab?.nativeDeck, pageIndex])

  const totalSteps = slide?.steps.length ?? 0

  /**
   * Advance one step.
   *
   * Step first, page second: this is what makes a teaching deck work, where the
   * question is on the slide and each answer appears on a further click.
   */
  const next = useCallback((): void => {
    if (!tab) return
    const store = useAppStore.getState()
    if (isNative && step < totalSteps) {
      store.setStep(tab.tabId, step + 1)
      pokeChrome()
      return
    }
    if (pageIndex < pageCount - 1) {
      store.setPage(tab.tabId, pageIndex + 1)
      pokeChrome()
      return
    }
    showToast(zh.playback.endOfDeck)
  }, [tab, isNative, step, totalSteps, pageIndex, pageCount, pokeChrome, showToast])

  /** Rewind one step, landing at the end of the previous page when at step 0. */
  const prev = useCallback((): void => {
    if (!tab) return
    const store = useAppStore.getState()
    if (isNative && step > 0) {
      store.setStep(tab.tabId, step - 1)
      pokeChrome()
      return
    }
    if (pageIndex > 0) {
      const target = pageIndex - 1
      store.setPage(tab.tabId, target)
      // Entering a previous page from behind should show it fully revealed.
      if (isNative && tab.nativeDeck) {
        void tab.nativeDeck.loadSlide(target).then((model) => {
          if (model) useAppStore.getState().setStep(tab.tabId, model.steps.length)
        })
      }
      pokeChrome()
      return
    }
    showToast(zh.playback.startOfDeck)
  }, [tab, isNative, step, pageIndex, pokeChrome, showToast])

  useEffect(() => {
    pokeChrome()
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current)
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [pokeChrome])

  // One stable key listener reading the latest handlers through a ref.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const state = stateRef.current
      const key = event.key
      switch (key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
        case ' ':
        case 'n':
        case 'N':
          event.preventDefault()
          state.next()
          return
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
        case 'p':
        case 'P':
          event.preventDefault()
          state.prev()
          return
        case 'Escape':
          if (state.boardOpen) {
            setBoardOpen(false)
            return
          }
          state.exitShow()
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
        case 'z':
        case 'Z':
          if (event.ctrlKey) {
            event.preventDefault()
            undoStroke()
          }
          return
        default:
          return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // undoStroke closes over pageIndex; rebinding on page change is cheap and keeps
    // the handler honest.
  }, [pageIndex])

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const measure = (): void => setBox({ width: frame.clientWidth, height: frame.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [isNative, tab?.status])

  // PDF path: render the page into the box CSS has already sized.
  useEffect(() => {
    if (isNative) return
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
        canvas.getContext('2d')?.drawImage(bitmap.canvas, 0, 0)
        setPainted(true)
      } catch {
        // Cancelled by a page change.
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [doc, pageIndex, box.width, box.height, queue, isNative])

  const currentStrokes = tab?.ink.find((p) => p.pageIndex === pageIndex)?.strokes ?? []

  // Snapshot the annotations once when the show opens; "discard" restores exactly this.
  const capturedEntry = useRef(false)
  useEffect(() => {
    if (capturedEntry.current) return
    const current = useAppStore.getState().tabs.find((x) => x.tabId === activeTabId)
    if (!current) return
    capturedEntry.current = true
    inkAtEntry.current = current.ink
  }, [activeTabId])

  const persistInk = useCallback(
    (pages: InkPage[]): void => {
      const deckId = useAppStore.getState().tabs.find((t) => t.tabId === activeTabId)?.deckId
      if (deckId) void window.api.saveInk(deckId, pages)
      if (activeTabId) useAppStore.getState().updateTab(activeTabId, { ink: pages })
    },
    [activeTabId]
  )

  const commitStroke = useCallback(
    (stroke: InkStroke): void => {
      const current = useAppStore.getState().tabs.find((t) => t.tabId === activeTabId)
      if (!current) return
      const exists = current.ink.some((p) => p.pageIndex === pageIndex)
      const nextPages = exists
        ? current.ink.map((p) => (p.pageIndex === pageIndex ? { ...p, strokes: [...p.strokes, stroke] } : p))
        : [...current.ink, { pageIndex, strokes: [stroke] }]
      // Remember the pre-stroke state so undo can step back through history.
      const entry = historyRef.current[pageIndex] ?? initHistory<InkStroke>(currentStrokes)
      historyRef.current[pageIndex] = commitHistory(entry, [...currentStrokes, stroke])
      persistInk(nextPages)
      setInkDirty(true)
    },
    [activeTabId, pageIndex, persistInk, currentStrokes]
  )

  /** Step back one history entry. Clearing is undoable exactly like a stroke. */
  const undoStroke = useCallback((): void => {
    const current = useAppStore.getState().tabs.find((t) => t.tabId === activeTabId)
    if (!current) return
    const entry = historyRef.current[pageIndex]
    if (!entry || !canUndo(entry)) return
    const stepped = undoHistory(entry)
    historyRef.current[pageIndex] = stepped
    const restored = fromSnapshot<InkStroke>(stepped.present)
    const exists = current.ink.some((p) => p.pageIndex === pageIndex)
    const nextPages = exists
      ? current.ink.map((p) => (p.pageIndex === pageIndex ? { ...p, strokes: restored } : p))
      : [...current.ink, { pageIndex, strokes: restored }]
    persistInk(nextPages)
    setInkDirty(true)
  }, [activeTabId, pageIndex, persistInk])

  const clearInk = useCallback((): void => {
    const current = useAppStore.getState().tabs.find((t) => t.tabId === activeTabId)
    if (!current) return
    // Clearing is recorded as a change, so one undo brings every stroke back.
    const entry = historyRef.current[pageIndex] ?? initHistory<InkStroke>(currentStrokes)
    historyRef.current[pageIndex] = commitHistory(entry, [])
    const nextPages = current.ink.map((p) => (p.pageIndex === pageIndex ? { ...p, strokes: [] } : p))
    persistInk(nextPages)
    setInkDirty(true)
  }, [activeTabId, pageIndex, persistInk, currentStrokes])

  /** Leave the show immediately, without touching the annotations. */
  const leaveNow = useCallback((): void => {
    void window.api.exitPlayback()
  }, [])

  /**
   * End the show, asking about annotations when the presenter has drawn something.
   *
   * The question only appears if this session actually changed the ink: asking every
   * time would be noise for a show where nothing was drawn.
   */
  const exitShow = useCallback((): void => {
    if (!inkDirty || inkOnExit === 'keep') {
      leaveNow()
      return
    }
    if (inkOnExit === 'discard') {
      // Roll back to the state the deck had when the show began.
      persistInk(inkAtEntry.current)
      setInkDirty(false)
      leaveNow()
      return
    }
    setExitPrompt(true)
  }, [inkDirty, inkOnExit, leaveNow, persistInk])

  const decideExit = useCallback(
    (choice: 'keep' | 'discard', remember: boolean): void => {
      setExitPrompt(false)
      if (remember) {
        setInkOnExit(choice)
        void window.api.setSettings({ inkOnExit: choice })
      }
      if (choice === 'discard') persistInk(inkAtEntry.current)
      setInkDirty(false)
      leaveNow()
    },
    [persistInk, leaveNow]
  )

  // Presentation preferences, read once when the show starts.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const settings = await window.api.getSettings()
      if (cancelled) return
      setTransitionsOn(settings.enableTransitions !== false)
      setNavPosition(settings.navButtonPosition === 'side' ? 'side' : 'bottom')
      setKeepToolbar(settings.keepToolbarInInkMode !== false)
      setInkOnExit(settings.inkOnExit ?? 'ask')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const stateRef = useRef({ next, prev, boardOpen, exitShow, tab })
  stateRef.current = { next, prev, boardOpen, exitShow, tab }

  useEffect(() => {
    return window.api.onPlayState((state) => {
      if (!state.active) exitShow()
    })
  }, [exitShow])

  const onStageClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (tool !== 'pointer' || boardOpen) return
    const rect = event.currentTarget.getBoundingClientRect()
    const position = (event.clientX - rect.left) / rect.width
    if (position > 0.66) next()
    else if (position < 0.34) prev()
    else pokeChrome()
  }

  const ratio =
    isNative && slide
      ? slide.size.width / slide.size.height
      : tab?.pageSizes[0] && tab.pageSizes[0].height > 0
        ? tab.pageSizes[0].width / tab.pageSizes[0].height
        : 16 / 9

  // The active sheet's strokes. The first sheet is seeded from the tab so a reopened
  // deck still shows the board it had.
  const boardStrokes = boardPages[boardPageIndex] ?? []

  const setBoardStrokes = useCallback((next: InkStroke[]): void => {
    setBoardPages((pages) => pages.map((page, i) => (i === boardPageIndex ? next : page)))
  }, [boardPageIndex])

  return (
    <div className="playback" data-testid="playback-page" data-board={boardOpen} onMouseMove={pokeChrome}>
      <div
        className="slide-wrap"
        onClick={onStageClick}
        onMouseMove={(event) => {
          if (tool === 'eraser') setEraserAt({ x: event.clientX, y: event.clientY })
          else if (eraserAt) setEraserAt(null)
          pokeChrome()
        }}
        onMouseLeave={() => setEraserAt(null)}
        role="presentation"
      >
        <div
          className="slide-frame"
          ref={frameRef}
          data-testid="slide-frame"
          data-engine={isNative ? 'native-pptx' : 'pdf'}
          data-painted={isNative ? slide !== null : painted}
          style={{ ['--slide-ratio' as string]: String(ratio) }}
        >
          {isNative && slide ? (
            <PptxTransition
              slide={slide}
              step={step}
              transition={slide.transition}
              enabled={transitionsOn}
              slideKey={tab.tabId + ':' + pageIndex}
              triggerProgress={triggerProgress}
              inkActive={tool !== 'pointer'}
              onTrigger={(triggerId) => {
                const track = slide.triggers[triggerId]
                if (!track) return
                const done = triggerProgress[triggerId] ?? 0
                // Clicking past the last step either restarts the track or holds it.
                const nextStep = done >= track.steps.length ? (track.restart ? 1 : done) : done + 1
                setTriggerProgress((prev) => ({ ...prev, [triggerId]: nextStep }))
                pokeChrome()
              }}
            />
          ) : (
            <canvas ref={canvasRef} data-testid="playback-canvas" />
          )}
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
        <>
          <Whiteboard
            strokes={boardStrokes}
            tool={tool === 'eraser' ? 'eraser' : 'pen'}
            color={penColor}
            widthPx={penWidth}
            onCommit={(stroke) => setBoardStrokes([...boardStrokes, stroke])}
          />
          <BoardPager
            index={boardPageIndex}
            total={boardPages.length}
            onPrev={() => setBoardPageIndex((i) => Math.max(0, i - 1))}
            onNext={() => setBoardPageIndex((i) => Math.min(boardPages.length - 1, i + 1))}
            onAdd={() => {
              setBoardPages((pages) => [...pages, []])
              setBoardPageIndex(boardPages.length)
            }}
          />
        </>
      ) : null}

      <div className="page-indicator" data-visible={chromeVisible} data-testid="page-indicator">
        {pageIndex + 1} / {pageCount}
        {isNative && totalSteps > 0 ? (
          <span className="step-indicator" data-testid="step-indicator">
            {' '}
            · {step}/{totalSteps}
          </span>
        ) : null}
      </div>

      {navPosition === 'side' && !boardOpen ? (
        <SideNav visible={chromeVisible} onPrev={prev} onNext={next} />
      ) : null}

      {tool === 'eraser' && eraserAt ? (
        <div
          className="eraser-cursor"
          data-testid="eraser-cursor"
          style={{ left: eraserAt.x, top: eraserAt.y, width: eraserSize, height: eraserSize }}
          aria-hidden="true"
        />
      ) : null}

      <PlayToolbar
        tool={tool}
        boardOpen={boardOpen}
        canUndo={boardOpen ? boardStrokes.length > 0 : canUndo(historyRef.current[pageIndex] ?? initHistory())}
        penColor={penColor}
        penWidth={penWidth}
        eraserSize={eraserSize}
        visible={chromeVisible}
        popover={popover}
        hidePaging={navPosition === 'side'}
        onTool={(nextTool) => {
          setTool(nextTool)
          pokeChrome()
        }}
        onPopover={setPopover}
        onPrev={prev}
        onNext={next}
        onToggleBoard={() => {
          setBoardOpen((v) => !v)
          setPopover(null)
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
        onEraserSize={setEraserSize}
        onUndo={
          boardOpen
            ? () => setBoardStrokes(boardStrokes.slice(0, -1))
            : undoStroke
        }
        onClear={boardOpen ? () => setBoardStrokes([]) : clearInk}
        onEnd={exitShow}
      />

      <ExitInkDialog
        open={exitPrompt}
        onDecide={decideExit}
        onCancel={() => setExitPrompt(false)}
      />

      {toast ? (
        <div className="play-toast" data-testid="play-toast">
          {toast}
        </div>
      ) : null}
    </div>
  )
}