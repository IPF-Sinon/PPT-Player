import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import type { DeckInfo, EngineStatus } from '@shared/types'
import { zh } from '@shared/strings.zh'
import { useAppStore } from '../store'
import { loadPdf, readPageSizes } from '../lib/pdf'
import { RenderQueue } from '../lib/render'
import { ThumbRail } from '../components/ThumbRail'
import { SlideStage } from '../components/SlideStage'
import { ChevronDown, ChevronUp, Close, Folder, Info, Minus, Play, Plus, Settings, Trash } from '../components/icons'
import { HelpSheet, SettingsSheet } from '../components/Sheets'
import '../styles/preview.css'

export default function PreviewPage() {
  const store = useAppStore()
  const [recent, setRecent] = useState<string[]>([])
  const [zoom, setZoom] = useState(1)
  const [dragOver, setDragOver] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const queue = useMemo(() => new RenderQueue(), [])
  const openToken = useRef(0)

  const refreshEngine = useCallback(async (): Promise<void> => {
    const status: EngineStatus = await window.api.engineStatus()
    store.setEngine(status)
  }, [store])

  const refreshRecent = useCallback(async (): Promise<void> => {
    const settings = await window.api.getSettings()
    setRecent(settings.recentFiles)
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
        const result = await window.api.open(filePath)
        if (token !== openToken.current) return
        if (!result.ok) {
          store.setError({ message: result.error.message, detail: result.error.detail })
          store.setLoading(false)
          return
        }
        await mountDeck(result.info)
      } finally {
        unsubscribe()
        if (token === openToken.current) store.setLoading(false)
        await refreshRecent()
      }
    },
    [store, refreshRecent]
  )

  const mountDeck = useCallback(
    async (info: DeckInfo): Promise<void> => {
      const url = (await window.api.deckUrl(info.deckId)) ?? ''
      const doc = await loadPdf(url)
      const sizes = await readPageSizes(doc)
      const updated = await window.api.reportMetrics(info.deckId, doc.numPages, sizes)
      const finalInfo = updated ?? { ...info, pageCount: doc.numPages, pageSizes: sizes }
      store.setDeck({ info: finalInfo, doc, url })
      store.setPage(0)
      const ink = await window.api.loadInk(info.deckId)
      store.setInk(ink)
      document.title = zh.windowTitle(info.sourcePath.split(/[\\/]/).pop() ?? '')
    },
    [store]
  )

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const total = useAppStore.getState().deck.info?.pageCount ?? 0
      if (total === 0) return
      const current = useAppStore.getState().currentPage
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault()
        useAppStore.getState().setPage(Math.min(total - 1, current + 1))
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault()
        useAppStore.getState().setPage(Math.max(0, current - 1))
      } else if (event.key === 'Home') {
        event.preventDefault()
        useAppStore.getState().setPage(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        useAppStore.getState().setPage(total - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    void refreshEngine()
    void refreshRecent()
    const off = window.api.onExternalOpen((path) => {
      void openFile(path)
    })
    void (async () => {
      const pending = await window.api.takePendingOpen()
      if (pending) await openFile(pending)
    })()
    return off
  }, [refreshEngine, refreshRecent, openFile])

  const pick = async (): Promise<void> => {
    const path = await window.api.pickFile()
    if (path) await openFile(path)
  }

  const onDrop = async (event: ReactDragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files.item(0)
    if (!file) return
    const path = (file as File & { path?: string }).path
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
        <span className="engine-dot" data-state={store.engine?.available ? 'ok' : 'none'} data-testid="engine-dot">
          <i />
          {store.engine?.available ? zh.engine.bundled : zh.engine.none}
        </span>
        <button
          type="button"
          className="icon-btn"
          title={zh.common.help}
          aria-label={zh.common.help}
          data-testid="open-help"
          onClick={() => setHelpOpen(true)}
        >
          <Info size={17} />
        </button>
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
          pageCount={pageCount}
          currentPage={pageIndex}
          queue={queue}
          onSelect={(page) => store.setPage(page)}
        />

        <div className="stage-wrap" style={{ position: 'relative', display: 'flex', minWidth: 0 }}>
          {store.deck.doc ? (
            <SlideStage
              doc={store.deck.doc}
              pageIndex={pageIndex}
              zoom={zoom}
              onDoubleClick={() => void startShow()}
            />
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
                  <button
                    type="button"
                    className="btn"
                    onClick={async () => {
                      const status = await window.api.recheckEngine()
                      store.setEngine(status)
                    }}
                  >
                    {zh.engine.recheck}
                  </button>
                  <button type="button" className="btn" onClick={() => store.setError(null)}>
                    {zh.common.close}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {store.drawerOpen && info ? (
          <aside className="drawer" data-testid="info-drawer">
            <h3>{zh.preview.info}</h3>
            <dl>
              <dt>{zh.preview.format}</dt>
              <dd>{info.format.label}</dd>
              <dt>{zh.preview.container}</dt>
              <dd>{info.format.container}</dd>
              <dt>{zh.preview.pages}</dt>
              <dd>{info.pageCount}</dd>
              <dt>{zh.preview.pageSize}</dt>
              <dd>
                {info.pageSizes[0]
                  ? Math.round(info.pageSizes[0].width) + ' × ' + Math.round(info.pageSizes[0].height) + ' pt'
                  : '—'}
              </dd>
              <dt>{zh.preview.encrypted}</dt>
              <dd>{info.format.encrypted ? '是' : '否'}</dd>
              <dt>{zh.preview.engine}</dt>
              <dd>{info.enginePath}</dd>
              <dt>{zh.preview.convertTime}</dt>
              <dd>{info.convertMs} ms</dd>
            </dl>
            <div className="drawer-actions">
              <button type="button" className="btn" onClick={() => void window.api.revealCache()}>
                {zh.common.revealCache}
              </button>
              <button type="button" className="btn" onClick={() => void window.api.openLog()}>
                {zh.common.openLog}
              </button>
              <button
                type="button"
                className="btn"
                onClick={async () => {
                  await window.api.clearCache()
                }}
              >
                <Trash size={14} />
                {zh.preview.clearCache}
              </button>
            </div>
          </aside>
        ) : null}
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

        <div className="bottombar-group">
          <button type="button" className="icon-btn" onClick={() => setZoom((z) => Math.max(0.4, z - 0.1))}>
            <Minus size={15} />
          </button>
          <span className="zoom-label">{Math.round(zoom * 100)}%</span>
          <button type="button" className="icon-btn" onClick={() => setZoom((z) => Math.min(3, z + 0.1))}>
            <Plus size={15} />
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setZoom(1)}>
            {zh.preview.fitWindow}
          </button>
        </div>

        <div className="topbar-spacer" />

        <div className="bottombar-group">
          <button
            type="button"
            className="icon-btn"
            onClick={() => store.toggleDrawer()}
            aria-label={zh.preview.info}
            data-testid="toggle-drawer"
          >
            <Info size={16} />
          </button>
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
          void refreshEngine()
        }}
      />
      <HelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}