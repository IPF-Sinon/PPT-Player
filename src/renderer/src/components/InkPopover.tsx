import { useEffect, useRef } from 'react'

/** Colours offered in the pen palette, chosen for projection contrast. */
export const PEN_COLORS = [
  { value: '#ef4444', label: '红' },
  { value: '#111827', label: '黑' },
  { value: '#3b82f6', label: '蓝' },
  { value: '#10b981', label: '绿' },
  { value: '#f59e0b', label: '橙' },
  { value: '#ffffff', label: '白' }
] as const

interface PenPopoverProps {
  open: boolean
  color: string
  width: number
  onColor: (color: string) => void
  onWidth: (width: number) => void
  onClose: () => void
}

/**
 * Pen settings, floating above the toolbar.
 *
 * Kept out of the toolbar itself on purpose: inlining a colour row and a slider
 * stretched the bar and pushed the paging controls around every time the pen was
 * selected. The bar stays one fixed height and the panel overlays the slide.
 */
export function PenPopover({ open, color, width, onColor, onWidth, onClose }: PenPopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      const node = ref.current
      if (node && !node.contains(event.target as Node)) onClose()
    }
    // A press outside closes the panel, so it never blocks the slide.
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="ink-popover" ref={ref} data-testid="pen-popover">
      <div className="ink-swatches">
        {PEN_COLORS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            className="ink-swatch"
            data-active={entry.value === color}
            style={{ background: entry.value }}
            title={entry.label}
            aria-label={entry.label}
            data-testid={'pen-color-' + entry.label}
            onClick={() => onColor(entry.value)}
          />
        ))}
      </div>

      <div className="ink-width">
        <input
          type="range"
          min={1}
          max={16}
          step={0.5}
          value={width}
          data-testid="pen-width"
          aria-label="笔触粗细"
          onChange={(event) => onWidth(Number(event.target.value))}
        />
        <span className="ink-width-value" data-testid="pen-width-value">
          {width.toFixed(1)} px
        </span>
        <span
          className="ink-width-preview"
          style={{
            width: Math.max(2, width * 2),
            height: Math.max(2, width * 2),
            background: color
          }}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}

interface EraserPopoverProps {
  open: boolean
  size: number
  onSize: (size: number) => void
  onClose: () => void
}

/** Eraser size, in the same floating panel as the pen. */
export function EraserPopover({ open, size, onSize, onClose }: EraserPopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      const node = ref.current
      if (node && !node.contains(event.target as Node)) onClose()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="ink-popover" ref={ref} data-testid="eraser-popover">
      <div className="ink-width">
        <input
          type="range"
          min={8}
          max={72}
          step={2}
          value={size}
          data-testid="eraser-size"
          aria-label="橡皮大小"
          onChange={(event) => onSize(Number(event.target.value))}
        />
        <span className="ink-width-value" data-testid="eraser-size-value">
          {size} px
        </span>
        <span
          className="ink-width-preview ink-eraser-preview"
          style={{ width: size / 2, height: size / 2 }}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}
