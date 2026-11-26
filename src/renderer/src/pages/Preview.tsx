import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import type { DeckInfo } from '@shared/types'
import { zh } from '@shared/strings.zh'
import { useAppStore } from '../store'
import { loadPdf, preloadPdfjs, readFirstPageSize, readPageSizes } from '../lib/pdf'
import { RenderQueue } from '../lib/render'
import { ThumbRail } from '../components/ThumbRail'
import { SlideStage } from '../components/SlideStage'
import { ChevronDown, ChevronUp, Close, Folder, Play, Settings } from '../components/icons'
import { SettingsSheet } from '../components/Sheets'
import '../styles/preview.css'

export default function PreviewPage() {
  const store = useAppStore()
  const [recent, setRecent] = useState<string[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const queue = useMemo(() => new RenderQueue(), [])
  const openToken = useRef(0)
  /** Deck currently mounted, so its PDF and main-process record can be released. */
  const mountedDeckId = useRef<string | null>(null)

  /** Drop the previous document and free its main-process entry. */
  const releaseCurrent = useCallback(async (): Promise<void> => {
    const previous = useAppStore.getState().deck
    const previousId = mountedDeckId.current
    mountedDeckId.current = null
    if (previous.doc) {
      try {
        await previous.doc.destroy()
      } catch {
        // A document that is already gone is fine.
      }
    }
    if (previousId) await window.api.closeDeck(previousId)
  }, [])

  const openFile = useCallback(
    async (filePath: string): Promise<void> => {
      const token = ++openToken.current
      store.setError(null)
      store.setLoading(true, zh.preview.stageProbe, 0.05)

      const unsubscribe = window.api.onProgress((progress) => {
        if (token !== openToken.current) return
        const message =
          progress.stage === 'convert'
            ? zh.preview.stageConvert
            : progress.stage === 'parse'
              ? zh.preview.stageParse
              : progress.stage === 'done'
                ? zh.preview.stageDone
                : zh.preview.stageProbe
        store.setLoading(true, message, progress.ratio)
      })

      try {
        await releaseCurrent()
        const result = await window.api.open(filePath)
        if (token !== openToken.current) return
        if (!result.ok) {
          store.setError({ message: result.error.message, detail: result.error.detail })
          store.setLoading(false)
          return
        }
        await mountDeck(result.info, token)
      } finally {
        unsubscribe()
        if (token === openToken.current) store.setLoading(false)
      }
    },
    [store, releaseCurrent]
  )

  const mountDeck = useCallback(
    async (info: DeckInfo, token: number): Promise<void> => {
      const url = window.api.deckUrl(info.deckId)
      try {
        const doc = await loadPdf(url)

        // Show the first slide as soon as it is measured. Waiting for every page
        // size before painting is what left large decks sitting on a spinner.
        const first = await readFirstPageSize(doc)
        store.setDeck({ info: { ...info, pageCount: doc.numPages, pageSizes: first ? [first] : [] }, doc, url })
        store.setPage(0)
        mountedDeckId.current = info.deckId
        document.title = zh.windowTitle(info.sourcePath.split(/[\\/]/).pop() ?? '')

        // Remaining page sizes arrive in batches for the thumbnail rail.
        void readPageSizes(doc, (sizes) => {
          if (openToken.current !== token) return
          const current = useAppStore.getState().deck.info
          if (!current || current.deckId !== info.deckId) return
          store.setDeck({ info: { ...current, pageSizes: sizes }, doc, url })
        }).then((sizes) => {
          if (openToken.current !== token) return
          void window.api.reportMetrics(info.deckId, doc.numPages, sizes)
        })

        const ink = await window.api.loadInk(info.deckId)
        store.setInk(ink)
      } catch (err) {
        store.setError({ message: '无法解析转换后的 PDF', detail: String(err) })
      }
    },
    [store]
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const state = useAppStore.getState()
      const total = state.deck.info?.pageCount ?? 0
      if (total === 0) return
      const current = state.currentPage
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault()
        state.setPage(Math.min(total - 1, current + 1))
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault()
        state.setPage(Math.max(0, current - 1))
      } else if (event.key === 'Home') {
        event.preventDefault()
        state.setPage(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        state.setPage(total - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    let cancelled = false

    // One round trip for everything the first screen needs. Engine status is not
    // part of it: probing for LibreOffice is only useful once a deck is opened.
    void (async () => {
      const boot = await window.api.bootstrap()
      if (cancelled) return
      setRecent(boot.settings.recentFiles)
      if (boot.pendingOpenPath) await openFile(boot.pendingOpenPath)
    })()

    const off = window.api.onExternalOpen((path) => {
      void openFile(path)
    })

    // Warm the parser in idle time so the first real open does not pay for it.
    preloadPdfjs()

    return () => {
      cancelled = true
      off()
    }
  }, [openFile])

  const pick = async (): Promise<void> => {
    const path = await window.api.pickFile()
    if (path) await openFile(path)
  }

  const onDrop = async (event: ReactDragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files.item(0)
    if (!file) return
    // Electron 32 removed File.path; the path must come from the preload bridge.
    const path = window.api.getPathForFile(file)
    if (path) await openFile(path)
  }

  const startShow = async (fromStart = false): Promise<void> => {
    const info = store.deck.info
    if (!info) return
    await window.api.enterPlayback(info.deckId, fromStart ? 0 : store.currentPage)
  }

  const pageCount = store.deck.info?.pageCount ?? 0
  const pageIndex = store.currentPage
  const info = store.deck.info

  return (
    <div
      className="preview"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      data-testid="preview-page"
    >
      <header className="topbar">
        <div className="topbar-title">
          <span className="topbar-name" data-testid="deck-name">
            {info ? info.sourcePath.split(/[\\/]/).pop() : zh.appName}
          </span>
          {info ? (
            <>
              <span className="badge" data-testid="deck-format">
                {info.format.label}
              </span>
              {info.format.extMismatch ? <span className="badge badge-warn">实际格式</span> : null}
              {info.mixedAspect ? <span className="badge badge-warn">{zh.preview.mixedAspect}</span> : null}
            </>
          ) : null}
        </div>
        <div className="topbar-spacer" />
        <button
          type="button"
          className="icon-btn"
          title={zh.common.settings}
          aria-label={zh.common.settings}
          data-testid="open-settings"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={17} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title={zh.common.close}
          aria-label={zh.common.close}
          onClick={() => window.close()}
        >
          <Close size={17} />
        </button>
      </header>

      <div className="preview-body">
        <ThumbRail
          doc={store.deck.doc}
          deckId={info?.deckId ?? ''}
          pageCount={pageCount}
          currentPage={pageIndex}
          queue={queue}
          onSelect={(page) => store.setPage(page)}
        />

        <div className="stage-wrap">
          {store.deck.doc ? (
            <SlideStage doc={store.deck.doc} pageIndex={pageIndex} onDoubleClick={() => void startShow()} />
          ) : (
            <div className="stage" data-testid="stage-empty">
              <div className="stage-empty" data-over={dragOver}>
                <Folder size={28} style={{ color: 'var(--text-faint)' }} />
                <h2>{zh.open.title}</h2>
                <p>{zh.open.dropHint}</p>
                <button type="button" className="btn btn-primary" onClick={() => void pick()} data-testid="pick-file">
                  {zh.open.chooseFile}
                </button>
                <div className="recent-list">
                  {recent.length === 0 ? (
                    <p style={{ color: 'var(--text-faint)' }}>{zh.open.noRecent}</p>
                  ) : (
                    recent.map((path) => (
                      <button
                        key={path}
                        type="button"
                        className="recent-item"
                        onClick={() => void openFile(path)}
                        title={path}
                      >
                        <span>{path.split(/[\\/]/).pop()}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {store.loading ? (
            <div className="progress-overlay" data-testid="progress-overlay">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: Math.round(store.loadingRatio * 100) + '%' }} />
              </div>
              <span className="progress-text">{store.loadingMessage || zh.preview.converting}</span>
              <button
                type="button"
                className="btn"
                data-testid="cancel-convert"
                onClick={() => {
                  void window.api.cancelOpen()
                  store.setLoading(false)
                }}
              >
                {zh.common.cancel}
              </button>
            </div>
          ) : null}

          {store.error ? (
            <div className="progress-overlay" data-testid="error-overlay">
              <div className="error-card">
                <h2>{zh.engine.errorTitle}</h2>
                <p>{store.error.message}</p>
                {store.error.detail ? <pre>{store.error.detail}</pre> : null}
                <div className="error-actions">
                  <button type="button" className="btn" onClick={() => void window.api.openLog()}>
                    {zh.engine.openLog}
                  </button>
                  <button type="button" className="btn" onClick={() => store.setError(null)}>
                    {zh.common.close}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <footer className="bottombar">
        <div className="bottombar-group">
          <button
            type="button"
            className="icon-btn"
            onClick={() => store.setPage(Math.max(0, pageIndex - 1))}
            disabled={pageIndex <= 0}
            aria-label={zh.playback.prev}
            data-testid="preview-prev"
          >
            <ChevronUp size={16} />
          </button>
          <span className="pager" data-testid="preview-pager">
            {zh.preview.page(pageCount === 0 ? 0 : pageIndex + 1, pageCount)}
          </span>
          <button
            type="button"
            className="icon-btn"
            onClick={() => store.setPage(Math.min(pageCount - 1, pageIndex + 1))}
            disabled={pageIndex >= pageCount - 1}
            aria-label={zh.playback.next}
            data-testid="preview-next"
          >
            <ChevronDown size={16} />
          </button>
        </div>

        <div className="topbar-spacer" />

        <div className="bottombar-group">
          <button
            type="button"
            className="btn"
            disabled={!info}
            onClick={() => void startShow(false)}
            data-testid="start-here"
          >
            {zh.preview.startFromHere}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!info}
            onClick={() => void startShow(true)}
            data-testid="start-show"
          >
            <Play size={14} />
            {zh.preview.startShow}
          </button>
        </div>
      </footer>

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => {
          void (async () => {
            const settings = await window.api.getSettings()
            setRecent(settings.recentFiles)
          })()
        }}
      />
    </div>
  )
}
