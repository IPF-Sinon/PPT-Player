import { useState } from 'react'

interface ExitInkDialogProps {
  open: boolean
  /** Called with the choice, and whether to remember it for future shows. */
  onDecide: (choice: 'keep' | 'discard', remember: boolean) => void
  /** Stay in the show, dismissing the dialog. */
  onCancel: () => void
}

/**
 * Asks what to do with the annotations drawn during this show.
 *
 * Presenters annotate constantly, so asking every single time would be noise; the
 * "remember" checkbox turns the answer into a setting after the first time.
 */
export function ExitInkDialog({ open, onDecide, onCancel }: ExitInkDialogProps) {
  const [remember, setRemember] = useState(false)

  if (!open) return null

  return (
    <div className="exit-dialog-backdrop" data-testid="exit-ink-dialog" role="presentation">
      <div className="exit-dialog" role="dialog" aria-modal="true">
        <h2>是否保留本次放映的批注笔迹？</h2>
        <p>保留后下次打开同一份文稿仍能看到这些笔迹。</p>

        <label className="exit-dialog-remember">
          <input
            type="checkbox"
            checked={remember}
            data-testid="exit-ink-remember"
            onChange={(event) => setRemember(event.target.checked)}
          />
          记住我的选择（始终按此操作）
        </label>

        <div className="exit-dialog-actions">
          <button type="button" className="btn" onClick={onCancel} data-testid="exit-ink-cancel">
            继续放映
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => onDecide('discard', remember)}
            data-testid="exit-ink-discard"
          >
            不保留
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onDecide('keep', remember)}
            data-testid="exit-ink-keep"
          >
            保留
          </button>
        </div>
      </div>
    </div>
  )
}
