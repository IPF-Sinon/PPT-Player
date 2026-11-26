import type { ReactNode } from 'react'
import { Board, ChevronLeft, ChevronRight, EndShow, Eraser, Pen, Pointer, Trash, Undo } from './icons'

export type PlayTool = 'pointer' | 'pen' | 'eraser'

const COLORS = [
  { value: '#ef4444', label: '红' },
  { value: '#3b82f6', label: '蓝' },
  { value: '#111827', label: '黑' },
  { value: '#f59e0b', label: '黄' }
]

const WIDTHS = [
  { value: 3, label: '细' },
  { value: 5, label: '中' },
  { value: 9, label: '粗' }
]

interface PlayToolbarProps {
  tool: PlayTool
  boardOpen: boolean
  canUndo: boolean
  penColor: string
  penWidth: number
  visible: boolean
  onTool: (tool: PlayTool) => void
  onPrev: () => void
  onNext: () => void
  onToggleBoard: () => void
  onColor: (color: string) => void
  onWidth: (width: number) => void
  onUndo: () => void
  onClear: () => void
  onEnd: () => void
}

/**
 * Floating playback toolbar.
 *
 * Hovering it pauses the auto-hide timer, so the toolbar cannot disappear while
 * the presenter is aiming at a button.
 */
export function PlayToolbar(props: PlayToolbarProps) {
  const { tool, boardOpen, canUndo, penColor, penWidth, visible } = props

  const items: Array<{ id: PlayTool; label: string; icon: ReactNode; testId: string }> = [
    { id: 'pointer', label: '指针', icon: <Pointer size={19} />, testId: 'tool-pointer' },
    { id: 'pen', label: '画笔', icon: <Pen size={19} />, testId: 'tool-pen' },
    { id: 'eraser', label: '橡皮', icon: <Eraser size={19} />, testId: 'tool-eraser' }
  ]

  return (
    <div
      className="play-chrome"
      data-visible={visible}
      data-testid="play-toolbar"
    >
      <div className="tool-cluster">
        <button type="button" className="tool-btn" title="上一页" aria-label="上一页" data-testid="tool-prev" onClick={props.onPrev}>
          <ChevronLeft size={19} />
        </button>
        <button type="button" className="tool-btn" title="下一页" aria-label="下一页" data-testid="tool-next" onClick={props.onNext}>
          <ChevronRight size={19} />
        </button>
        <span className="tool-sep" aria-hidden="true" />

        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="tool-btn"
            data-active={tool === item.id}
            title={item.label}
            aria-label={item.label}
            aria-pressed={tool === item.id}
            data-testid={item.testId}
            onClick={() => props.onTool(item.id)}
          >
            {item.icon}
          </button>
        ))}

        <span className="tool-sep" aria-hidden="true" />

        <div className="pen-swatches" data-testid="pen-swatches">
          {COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              className="swatch"
              data-active={penColor === color.value}
              style={{ background: color.value }}
              title={color.label}
              aria-label={'画笔颜色 ' + color.label}
              data-testid={'pen-color-' + color.label}
              onClick={() => props.onColor(color.value)}
            />
          ))}
          {WIDTHS.map((width) => (
            <button
              key={width.value}
              type="button"
              className="swatch swatch-width"
              data-active={penWidth === width.value}
              title={'粗细 ' + width.label}
              aria-label={'画笔粗细 ' + width.label}
              data-testid={'pen-width-' + width.label}
              onClick={() => props.onWidth(width.value)}
            >
              <i style={{ height: width.value }} />
            </button>
          ))}
        </div>

        <span className="tool-sep" aria-hidden="true" />

        <button
          type="button"
          className="tool-btn"
          title="撤销"
          aria-label="撤销"
          data-testid="tool-undo"
          disabled={!canUndo}
          onClick={props.onUndo}
        >
          <Undo size={19} />
        </button>
        <button type="button" className="tool-btn" title="清空" aria-label="清空" data-testid="tool-clear" onClick={props.onClear}>
          <Trash size={19} />
        </button>

        <span className="tool-sep" aria-hidden="true" />

        <button
          type="button"
          className="tool-btn"
          data-active={boardOpen}
          title="白板（D）"
          aria-label="白板"
          aria-pressed={boardOpen}
          data-testid="tool-board"
          onClick={props.onToggleBoard}
        >
          <Board size={19} />
        </button>
      </div>

      <button
        type="button"
        className="tool-end"
        title="结束放映"
        aria-label="结束放映"
        data-testid="tool-end"
        onClick={props.onEnd}
      >
        <EndShow size={19} />
      </button>
    </div>
  )
}
