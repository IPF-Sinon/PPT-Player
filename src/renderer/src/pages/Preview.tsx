import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'
import { zh } from '@shared/strings.zh'
import { useAppStore } from '../store'
import { loadPdf, preloadPdfjs, readFirstPageSize, readPageSizes } from '../lib/pdf'
import { RenderQueue } from '../lib/render'
import { loadNativeDeck } from '../lib/pptx/deck'
import { ThumbRail } from '../components/ThumbRail'
import { SlideStage } from '../components/SlideStage'
import { PptxSlideView } from '../components/PptxSlideView'
import { TabBar } from '../components/TabBar'
import { ChevronDown, ChevronUp, Close, Folder, Play, Settings } from '../components/icons'
import { SettingsSheet } from '../components/Sheets'
import '../styles/preview.css'
import '../styles/pptx.css'

export default function PreviewPage() {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const tab = useMemo(() => tabs.find((t) => t.tabId === activeTabId) ?? null, [tabs, activeTabId])
  const [recent, setRecent] = useState<string[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const queue = useMemo(() => new RenderQueue(), [])
  const openToken = useRef(0)

  const store = useAppStore
  const update = store.getState().updateTab

  /** Release whatever the given tab holds, in renderer and main. */
  const releaseTab = useCallback(async (tabId: string): Promise<void> => {
    const target = useAppStore.getState().tabs.find((t) => t.tabId === tabId)
    if (!target) return
    if (target.pdfDoc) {
      try {
        await target.pdfDoc.destroy()
      } catch {
        // Already gone is fine.
      }
    }
    if (target.deckId) await window.api.closeDeck(target.deckId)
  }, [])

  const mountPdf = useCallback(
    async (
      tabId: string,
      deckId: string,
      url: string,
      token: number,
      extra: Partial<Parameters<typeof update>[1]> = {}
    ): Promise<void> => {
      const doc = await loadPdf(url)
      const first = await readFirstPageSize(doc)
      if (token !== openToken.current) {
        await doc.destroy()
        return
      }
      update(tabId, {
        pdfDoc: doc,
        pdfUrl: url,
        deckId,
        pageCount: doc.numPages,
        pageSizes: first ? [first] : [],
        status: 'ready',
        progressRatio: 1,
        ...extra
      })

      void readPageSizes(doc, (sizes) => {
        if (openToken.current !== token) return
        update(tabId, { pageSizes: sizes })
      }).then((sizes) => {
        if (openToken.current !== token) return
        void window.api.reportMetrics(deckId, doc.numPages, sizes)
      })
    },
    [update]
  )

  const openFile = useCallback(
    async (filePath: string): Promise<void> => {
      const token = ++openToken.current
      const tabId = useAppStore.getState().openTab(filePath)
      const existing = useAppStore.getState().tabs.find((t) => t.tabId === tabId)

      // Re-focusing an already loaded tab must not re-open anything.
      if (existing && existing.status === 'ready' && existing.filePath === filePath) {
        if (existing.tabId !== useAppStore.getState().activeTabId) return
      }

      await releaseTab(tabId)
      update(tabId, {
        status: 'loading',
        error: null,
        progressRatio: 0.05,
        progressMessage: zh.preview.stageProbe,
        pdfDoc: null,
        pdfUrl: null,
        nativeDeck: null,
        deckId: ''
      })

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
        update(tabId, { progressMessage: message, progressRatio: progress.ratio })
      })

      try {
        // Native first: a PPTX needs no conversion at all.
        update(tabId, { progressMessage: '正在建立索引', progressRatio: 0.2 })
        const native = await window.api.openNative(filePath)
        if (token !== openToken.current) return

        if (native && native.ok) {
          const deck = await loadNativeDeck(native.deckId, native.slidePaths, native.slideSize, window.api)
          if (token !== openToken.current) return
          update(tabId, {
            engineMode: 'native-pptx',
            deckId: native.deckId,
            nativeDeck: deck,
            pageCount: native.slideCount,
            pageSizes: [{ width: native.slideSize.width, height: native.slideSize.height }],
            hasComplexObjects: deck.hasComplexObjects,
            status: 'ready',
            progressRatio: 1,
            convertMs: 0
          })
          const ink = await window.api.loadInk(native.deckId)
          update(tabId, { ink })
          document.title = zh.windowTitle(existing?.title ?? '')
          return
        }

        // Fall back to conversion for legacy, ODP and encrypted-free decks.
        const result = await window.api.open(filePath)
        if (token !== openToken.current) return
        if (!result.ok) {
          update(tabId, { status: 'error', error: { message: result.error.message, detail: result.error.detail } })
          return
        }
        const info = result.info
        await mountPdf(tabId, info.deckId, window.api.deckUrl(info.deckId), token, {
          engineMode: 'libreoffice',
          convertMs: info.convertMs,
          cached: info.cached
        })
        const ink = await window.api.loadInk(info.deckId)
        update(tabId, { ink })
        document.title = zh.windowTitle(existing?.title ?? '')
      } catch (err) {
        update(tabId, { status: 'error', error: { message: '无法打开该文件', detail: String(err) } })
      } finally {
        unsubscribe()
      }
    },
    [mountPdf, releaseTab, update]
  )

  /** Switch the active tab between native rendering and conversion. */
  const switchEngine = useCallback(
    async (mode: 'native-pptx' | 'libreoffice'): Promise<void> => {
      if (!tab) return
      const token = ++openToken.current
      await releaseTab(tab.tabId)
      update(tab.tabId, { engineMode: mode, status: 'loading', error: null, pdfDoc: null, nativeDeck: null })
      if (mode === 'libreoffice') {
        const result = await window.api.open(tab.filePath)
        if (token !== openToken.current) return
        if (!result.ok) {
          update(tab.tabId, { status: 'error', error: { message: result.error.message } })
          return
        }
        await mountPdf(tab.tabId, result.info.deckId, window.api.deckUrl(result.info.deckId), token, {
          engineMode: 'libreoffice'
        })
        return
      }
      const native = await window.api.openNative(tab.filePath)
      if (token !== openToken.current) return
      if (!native || !native.ok) {
        update(tab.tabId, { status: 'error', error: { message: '该文件不支持极速动画模式' } })
        return
      }
      const deck = await loadNativeDeck(native.deckId, native.slidePaths, native.slideSize, window.api)
      update(tab.tabId, {
        engineMode: 'native-pptx',
        deckId: native.deckId,
        nativeDeck: deck,
        pageCount: native.slideCount,
        pageSizes: [{ width: native.slideSize.width, height: native.slideSize.height }],
        hasComplexObjects: deck.hasComplexObjects,
        status: 'ready',
        progressRatio: 1
      })
    },
    [tab, releaseTab, update, mountPdf]
  )

  const closeTab = useCallback(
    async (tabId: string): Promise<void> => {
      await releaseTab(tabId)
      useAppStore.getState().closeTab(tabId)
    },
    [releaseTab]
  )

  const pick = useCallback(async (): Promise<void> => {
    const path = await window.api.pickFile()
    if (path) await openFile(path)
  }, [openFile])

  const onDrop = async (event: ReactDragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files.item(0)
    if (!file) return
    // Electron 32 removed File.path; the path comes from the preload bridge.
    const path = window.api.getPathForFile(file)
    if (path) await openFile(path)
  }

  const startShow = useCallback(
    async (fromStart = false): Promise<void> => {
      if (!tab) return
      if (fromStart) useAppStore.getState().setPage(tab.tabId, 0)
      await window.api.enterPlayback(tab.deckId, fromStart ? 0 : tab.currentPage)
    },
    [tab]
  )

  // Startup: one round trip, then the tab bar and the deck.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const boot = await window.api.bootstrap()
      if (cancelled) return
      setRecent(boot.settings.recentFiles)
      if (boot.pendingOpenPath) await openFile(boot.pendingOpenPath)
    })()
    const off = window.api.onExternalOpen((path) => {
      void openFile(path)
    })
    preloadPdfjs()
    return () => {
      cancelled = true
      off()
    }
    // openFile is stable; re-running this would re-open the launch file.
  }, [openFile])

  // Keyboard: F5 starts the show, Ctrl+T opens, Ctrl+W closes, Ctrl+Tab cycles.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')

      if (event.key === 'F5') {
        event.preventDefault()
        void startShow(!event.shiftKey)
        return
      }
      if (event.ctrlKey && event.key.toLowerCase() === 't') {
        event.preventDefault()
        void pick()
        return
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'w') {
        event.preventDefault()
        const active = useAppStore.getState().activeTabId
        if (active) void closeTab(active)
        return
      }
      if (event.ctrlKey && event.key === 'Tab') {
        event.preventDefault()
        useAppStore.getState().cycleTab(event.shiftKey ? -1 : 1)
        return
      }
      if (typing) return

      const state = useAppStore.getState()
      const current = state.tabs.find((t) => t.tabId === state.activeTabId)
      if (!current || current.pageCount === 0) return
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault()
        state.setPage(current.tabId, current.currentPage + 1)
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault()
        state.setPage(current.tabId, current.currentPage - 1)
      } else if (event.key === 'Home') {
        event.preventDefault()
        state.setPage(current.tabId, 0)
      } else if (event.key === 'End') {
        event.preventDefault()
        state.setPage(current.tabId, current.pageCount - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [startShow, pick, closeTab])

  const pageCount = tab?.pageCount ?? 0
  const pageIndex = tab?.currentPage ?? 0
  const isNative = tab?.engineMode === 'native-pptx'
  const currentSlide = isNative ? tab?.nativeDeck?.slides[pageIndex] ?? null : null

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
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={(id) => useAppStore.getState().setActiveTab(id)}
        onClose={(id) => void closeTab(id)}
        onOpen={() => void pick()}
      />

      <header className="topbar">
        <div className="topbar-title">
          <span className="topbar-name" data-testid="deck-name">
            {tab ? tab.title : zh.appName}
          </span>
          {tab && tab.status === 'ready' ? (
            <>
              <span className="badge" data-testid="deck-format">
                {isNative ? 'PPTX' : tab.engineMode === 'pdf' ? 'PDF' : '已转换'}
              </span>
              {tab.hasComplexObjects ? (
                <span className="badge badge-warn" data-testid="complex-hint" title="含图表或公式，建议切到兼容模式">
                  复杂元素
                </span>
              ) : null}
              {isNative ? (
                <span className="badge badge-soft" data-testid="engine-badge">
                  极速动画
                </span>
              ) : null}
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
          tab={tab}
          queue={queue}
          onSelect={(page) => tab && useAppStore.getState().setPage(tab.tabId, page)}
        />

        <div className="stage-wrap">
          {tab && tab.status === 'ready' ? (
            isNative && currentSlide ? (
              <PptxSlideView
                slide={currentSlide}
                step={0}
                showAll
                fit
                onDoubleClick={() => void startShow()}
              />
            ) : tab.pdfDoc ? (
              <SlideStage
                doc={tab.pdfDoc}
                pageIndex={pageIndex}
                ratio={
                  tab.pageSizes[0] && tab.pageSizes[0].height > 0
                    ? tab.pageSizes[0].width / tab.pageSizes[0].height
                    : 16 / 9
                }
                onDoubleClick={() => void startShow()}
              />
            ) : null
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

          {tab && tab.status === 'loading' ? (
            <div className="progress-overlay" data-testid="progress-overlay">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: Math.round(tab.progressRatio * 100) + '%' }} />
              </div>
              <span className="progress-text">{tab.progressMessage || zh.preview.converting}</span>
              <button
                type="button"
                className="btn"
                data-testid="cancel-convert"
                onClick={() => void window.api.cancelOpen()}
              >
                {zh.common.cancel}
              </button>
            </div>
          ) : null}

          {tab && tab.status === 'error' && tab.error ? (
            <div className="progress-overlay" data-testid="error-overlay">
              <div className="error-card">
                <h2>{zh.engine.errorTitle}</h2>
                <p>{tab.error.message}</p>
                {tab.error.detail ? <pre>{tab.error.detail}</pre> : null}
                <div className="error-actions">
                  <button type="button" className="btn" onClick={() => void window.api.openLog()}>
                    {zh.engine.openLog}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => tab && update(tab.tabId, { status: 'ready', error: null })}
                  >
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
            onClick={() => tab && useAppStore.getState().setPage(tab.tabId, pageIndex - 1)}
            disabled={!tab || pageIndex <= 0}
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
            onClick={() => tab && useAppStore.getState().setPage(tab.tabId, pageIndex + 1)}
            disabled={!tab || pageIndex >= pageCount - 1}
            aria-label={zh.playback.next}
            data-testid="preview-next"
          >
            <ChevronDown size={16} />
          </button>
        </div>

        {isNative ? (
          <div className="bottombar-group">
            <button
              type="button"
              className="btn btn-ghost"
              data-testid="switch-engine"
              title="切到 LibreOffice 渲染，保真度更高但不支持动画"
              onClick={() => void switchEngine('libreoffice')}
            >
              兼容模式
            </button>
          </div>
        ) : tab && tab.status === 'ready' ? (
          <div className="bottombar-group">
            <button
              type="button"
              className="btn btn-ghost"
              data-testid="switch-engine"
              title="尝试原生渲染，支持点击动画"
              onClick={() => void switchEngine('native-pptx')}
            >
              极速模式
            </button>
          </div>
        ) : null}

        <div className="topbar-spacer" />

        <div className="bottombar-group">
          <button
            type="button"
            className="btn"
            disabled={!tab || tab.status !== 'ready'}
            onClick={() => void startShow(false)}
            data-testid="start-here"
          >
            {zh.preview.startFromHere}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-play"
            disabled={!tab || tab.status !== 'ready'}
            onClick={() => void startShow(true)}
            data-testid="start-show"
          >
            <Play size={15} />
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
