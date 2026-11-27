import type { ReactNode } from 'react'
import { Board, ChevronLeft, ChevronRight, EndShow, Eraser, Pen, Pointer, Trash, Undo } from './icons'
import { EraserPopover, PenPopover } from './InkPopover'

export type PlayTool = 'pointer' | 'pen' | 'eraser'

/** Which settings panel is open, if any. */
export type PopoverKind = 'pen' | 'eraser' | null

interface PlayToolbarProps {
  tool: PlayTool
  boardOpen: boolean
  canUndo: boolean
  penColor: string
  penWidth: number
  eraserSize: number
  visible: boolean
  popover: PopoverKind
  /** Hide the paging buttons when side navigation is in use. */
  hidePaging?: boolean
  onTool: (tool: PlayTool) => void
  onPopover: (kind: PopoverKind) => void
  onPrev: () => void
  onNext: () => void
  onToggleBoard: () => void
  onColor: (color: string) => void
  onWidth: (width: number) => void
  onEraserSize: (size: number) => void
  onUndo: () => void
  onClear: () => void
  onEnd: () => void
}

/**
 * Floating playback toolbar.
 *
 * The bar keeps a fixed height. Colour and width used to be inlined here, which made
 * the bar grow and shift the paging buttons whenever the pen was selected; those now
 * live in a panel that floats above the bar instead.
 */
export function PlayToolbar(props: PlayToolbarProps) {
  const { tool, boardOpen, canUndo, penColor, penWidth, eraserSize, visible, popover } = props

  const items: Array<{ id: PlayTool; label: string; icon: ReactNode; testId: string }> = [
    { id: 'pointer', label: '指针', icon: <Pointer size={19} />, testId: 'tool-pointer' },
    { id: 'pen', label: '画笔', icon: <Pen size={19} />, testId: 'tool-pen' },
    { id: 'eraser', label: '橡皮', icon: <Eraser size={19} />, testId: 'tool-eraser' }
  ]

  /**
   * Selecting a tool also opens its panel; selecting it again closes the panel but
   * keeps the tool, so the presenter can dismiss it without losing the pen.
   */
  const pickTool = (id: PlayTool): void => {
    const panel = id === 'pen' ? 'pen' : id === 'eraser' ? 'eraser' : null
    const sameTool = tool === id
    props.onTool(id)
    props.onPopover(panel !== null && sameTool && popover === panel ? null : panel)
  }

  return (
    <div className="play-chrome" data-visible={visible} data-testid="play-toolbar">
      <div className="tool-cluster" style={{ position: 'relative' }}>
        {props.hidePaging ? null : (
          <>
            <button
              type="button"
              className="tool-btn"
              title="上一页"
              aria-label="上一页"
              data-testid="tool-prev"
              onClick={props.onPrev}
            >
              <ChevronLeft size={19} />
            </button>
            <button
              type="button"
              className="tool-btn"
              title="下一页"
              aria-label="下一页"
              data-testid="tool-next"
              onClick={props.onNext}
            >
              <ChevronRight size={19} />
            </button>
            <span className="tool-sep" aria-hidden="true" />
          </>
        )}

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
            onClick={() => pickTool(item.id)}
          >
            {item.icon}
          </button>
        ))}

        <span className="tool-sep" aria-hidden="true" />

        <button
          type="button"
          className="tool-btn"
          title="撤销（Ctrl+Z）"
          aria-label="撤销"
          data-testid="tool-undo"
          disabled={!canUndo}
          onClick={props.onUndo}
        >
          <Undo size={19} />
        </button>
        <button
          type="button"
          className="tool-btn"
          title="清空（可撤销）"
          aria-label="清空"
          data-testid="tool-clear"
          onClick={props.onClear}
        >
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

        <PenPopover
          open={popover === 'pen'}
          color={penColor}
          width={penWidth}
          onColor={props.onColor}
          onWidth={props.onWidth}
          onClose={() => props.onPopover(null)}
        />
        <EraserPopover
          open={popover === 'eraser'}
          size={eraserSize}
          onSize={props.onEraserSize}
          onClose={() => props.onPopover(null)}
        />
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
