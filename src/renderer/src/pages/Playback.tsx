import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type { InkPage, InkStroke } from '@shared/types'
import { zh } from '@shared/strings.zh'
import { useAppStore } from '../store'
import { RenderQueue, renderPageToCanvas } from '../lib/render'
import type { SlideModel } from '../lib/pptx/types'
import { PlayToolbar, type PlayTool } from '../components/PlayToolbar'
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
  const [toast, setToast] = useState('')
  const [penColor, setPenColor] = useState('#ef4444')
  const [penWidth, setPenWidth] = useState(5)
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
    idleTimer.current = window.setTimeout(() => setChromeVisible(false), IDLE_MS)
  }, [])

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

  const exitShow = useCallback((): void => {
    void window.api.exitPlayback()
  }, [])

  // Transitions are a preference, read once when the show starts.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const settings = await window.api.getSettings()
      if (!cancelled) setTransitionsOn(settings.enableTransitions !== false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    pokeChrome()
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current)
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [pokeChrome])

  const stateRef = useRef({ next, prev, boardOpen, exitShow, tab })
  stateRef.current = { next, prev, boardOpen, exitShow, tab }

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
    return window.api.onPlayState((state) => {
      if (!state.active) exitShow()
    })
  }, [exitShow])

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
      persistInk(nextPages)
    },
    [activeTabId, pageIndex, persistInk]
  )

  function undoStroke(): void {
    const current = useAppStore.getState().tabs.find((t) => t.tabId === activeTabId)
    if (!current) return
    const target = current.ink.find((p) => p.pageIndex === pageIndex)
    if (!target || target.strokes.length === 0) return
    const nextPages = current.ink.map((p) =>
      p.pageIndex === pageIndex ? { ...p, strokes: p.strokes.slice(0, -1) } : p
    )
    persistInk(nextPages)
  }

  const clearInk = useCallback((): void => {
    const current = useAppStore.getState().tabs.find((t) => t.tabId === activeTabId)
    if (!current) return
    const nextPages = current.ink.map((p) => (p.pageIndex === pageIndex ? { ...p, strokes: [] } : p))
    persistInk(nextPages)
  }, [activeTabId, pageIndex, persistInk])

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

  const boardStrokes = tab?.boardStrokes ?? []

  return (
    <div className="playback" data-testid="playback-page" data-board={boardOpen} onMouseMove={pokeChrome}>
      <div className="slide-wrap" onClick={onStageClick} role="presentation">
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
        <Whiteboard
          strokes={boardStrokes}
          tool={tool === 'eraser' ? 'eraser' : 'pen'}
          color={penColor}
          widthPx={penWidth}
          onCommit={(stroke) => {
            if (activeTabId) {
              useAppStore.getState().updateTab(activeTabId, { boardStrokes: [...boardStrokes, stroke] })
            }
          }}
        />
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
        onUndo={
          boardOpen
            ? () => {
                if (activeTabId) {
                  useAppStore.getState().updateTab(activeTabId, { boardStrokes: boardStrokes.slice(0, -1) })
                }
              }
            : undoStroke
        }
        onClear={boardOpen ? () => activeTabId && useAppStore.getState().updateTab(activeTabId, { boardStrokes: [] }) : clearInk}
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