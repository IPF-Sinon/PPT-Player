import { useEffect, useState } from 'react'
import type { EngineDownloadProgress } from '@shared/types'

interface EngineDownloadModalProps {
  open: boolean
  /** Total size in bytes, so the prompt can state it before downloading. */
  engineBytes: number
  onClose: () => void
  /** Called once the engine is installed, so the caller can retry its action. */
  onInstalled: () => void
}

/** Format a byte count as MB for display. */
function mb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(0)
}

/**
 * Prompt shown by the lite build when it meets a format that needs the engine.
 *
 * It states the size before the transfer starts, shows real progress while it runs,
 * and offers the "I already have LibreOffice" escape hatch, because a school machine
 * often does.
 */
export function EngineDownloadModal({
  open,
  engineBytes,
  onClose,
  onInstalled
}: EngineDownloadModalProps) {
  const [progress, setProgress] = useState<EngineDownloadProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const off = window.api.onEngineDownload((next) => {
      setProgress(next)
      if (next.stage === 'done') {
        setBusy(false)
        onInstalled()
      }
      if (next.stage === 'error') {
        setBusy(false)
        setError(next.message)
      }
    })
    return off
  }, [open, onInstalled])

  if (!open) return null

  const start = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    setProgress(null)
    const result = await window.api.engineDownload()
    if (!result.ok) {
      setBusy(false)
      setError(result.message)
    }
  }

  const cancel = async (): Promise<void> => {
    await window.api.engineDownloadCancel()
    setBusy(false)
    setProgress(null)
  }

  const ratio = progress?.ratio ?? 0
  const percent = ratio >= 0 ? Math.round(ratio * 100) : 0

  return (
    <div className="modal-backdrop" data-testid="engine-modal" role="presentation">
      <div className="modal-card" role="dialog" aria-modal="true">
        <h2 className="modal-title">需要安装兼容引擎</h2>
        <p className="modal-body">
          当前是轻量版。打开旧版 <code>.ppt</code> 或使用高保真兼容模式，需要安装兼容引擎
          （约 {mb(engineBytes || 130 * 1024 * 1024)} MB，只需下载一次，之后完全离线可用）。
        </p>
        <p className="modal-body modal-hint">
          常规 <code>.pptx</code> 与 <code>.pdf</code> 不需要它，可直接播放。
        </p>

        {progress && busy ? (
          <div className="modal-progress" data-testid="engine-progress">
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: (progress.ratio >= 0 ? percent : 50) + '%' }}
              />
            </div>
            <span className="progress-text" data-testid="engine-progress-text">
              {progress.message}
              {progress.totalBytes > 0 && progress.stage === 'downloading'
                ? ' ' + mb(progress.receivedBytes) + ' / ' + mb(progress.totalBytes) + ' MB'
                : ''}
            </span>
          </div>
        ) : null}

        {error ? (
          <p className="modal-error" data-testid="engine-error">
            {error}
          </p>
        ) : null}

        <div className="modal-actions">
          {busy ? (
            <button type="button" className="btn" onClick={() => void cancel()} data-testid="engine-cancel">
              取消下载
            </button>
          ) : (
            <>
              <button type="button" className="btn" onClick={onClose} data-testid="engine-later">
                稍后再说
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void (async () => {
                    const picked = await window.api.pickLoPath()
                    if (!picked) return
                    await window.api.setLoPath(picked)
                    onInstalled()
                  })()
                }}
                data-testid="engine-pick-local"
              >
                选择本机 LibreOffice
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void start()}
                data-testid="engine-download"
              >
                一键下载兼容引擎
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
