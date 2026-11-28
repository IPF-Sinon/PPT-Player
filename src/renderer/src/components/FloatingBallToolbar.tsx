import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import type { ToolbarStyle, ViewMode } from '@shared/types'
import { Board, EndShow, Eraser, Pen, Pointer, Trash, Undo } from './icons'
import { EraserPopover, PenPopover } from './InkPopover'
import type { PlayTool } from './PlayToolbar'

/** Where the ball sits once it has been dragged, in CSS pixels from the window corner. */
export interface FabPosition {
  x: number
  y: number
}

/** Diameter of the expanded ball. */
const BALL = 48
/** Gap kept between the ball and the window edge it snapped to. */
const EDGE_GAP = 20
/** Movement under this is a click, not a drag. */
const DRAG_THRESHOLD = 4
/** How long the click that ends a drag is swallowed for. */
const DRAG_CLICK_MS = 400

export interface FloatingBallToolbarProps {
  tool: PlayTool
  boardOpen: boolean
  canUndo: boolean
  penColor: string
  penWidth: number
  eraserSize: number
  /** Shares the bar toolbar's auto-hide, so the ball fades with the rest of the chrome. */
  visible: boolean
  /** False while a stroke is being drawn: the ball gets out of the way of the pen. */
  expanded: boolean
  popover: 'pen' | 'eraser' | null
  viewMode: ViewMode
  toolbarStyle: ToolbarStyle
  /** Saved position from the settings layer; null means the default corner. */
  position: FabPosition | null
  onPosition: (position: FabPosition) => void
  onToggle: () => void
  onTool: (tool: PlayTool) => void
  onPopover: (kind: 'pen' | 'eraser' | null) => void
  onColor: (color: string) => void
  onWidth: (width: number) => void
  onEraserSize: (size: number) => void
  onUndo: () => void
  onClear: () => void
  onToggleBoard: () => void
  onViewMode: (mode: ViewMode) => void
  onToolbarStyle: (style: ToolbarStyle) => void
  onEnd: () => void
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(low, value), Math.max(low, high))
}

/**
 * Default spot: bottom right, in the outer margin.
 *
 * Bottom right because that is the corner a right-handed presenter's thumb reaches
 * without crossing the page, and 96px up so it clears the page indicator and the
 * end-show button of the bar toolbar.
 */
function defaultPosition(): FabPosition {
  if (typeof window === 'undefined') return { x: EDGE_GAP, y: EDGE_GAP }
  return {
    x: Math.max(EDGE_GAP, window.innerWidth - BALL - EDGE_GAP),
    y: Math.max(EDGE_GAP, window.innerHeight - BALL - 96)
  }
}

/**
 * Keep the ball on screen and snap it to the nearer side edge.
 *
 * Only the horizontal axis snaps. The reader scrolls a column vertically, so a ball
 * that also jumped up and down would move out from under the pointer between
 * strokes; and it is kept out of the middle of the window, which is where the text
 * is, so at rest it never sits over a line of a document.
 */
function snapToEdge(position: FabPosition): FabPosition {
  if (typeof window === 'undefined') return position
  const maxY = window.innerHeight - BALL - EDGE_GAP
  const y = clamp(position.y, EDGE_GAP, maxY)
  const fromLeft = position.x
  const fromRight = window.innerWidth - position.x - BALL
  const x = fromLeft <= fromRight ? EDGE_GAP : window.innerWidth - BALL - EDGE_GAP
  return { x, y }
}

/**
 * Floating ball toolbar.
 *
 * A document read in a continuous column has text right up to both edges, so the
 * familiar bottom bar covers something the reader is trying to read. The ball is a
 * frosted circle that lives in a margin, expands into the same controls on demand,
 * and collapses the moment a stroke starts. At rest it draws small and translucent,
 * so even where it overlaps the page it does not hide a line of text; it only takes
 * its full 48px when the pointer is on it.
 */
export function FloatingBallToolbar(props: FloatingBallToolbarProps) {
  const {
    tool,
    boardOpen,
    canUndo,
    penColor,
    penWidth,
    eraserSize,
    visible,
    expanded,
    popover,
    viewMode,
    toolbarStyle
  } = props

  const rootRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<FabPosition>(() => snapToEdge(props.position ?? defaultPosition()))
  const positionRef = useRef(position)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ dx: number; dy: number; moved: boolean } | null>(null)
  /** True right after a drag, so the click that ends it does not also expand the ball. */
  const suppressClick = useRef(false)
  const suppressTimer = useRef<number | null>(null)

  const moveTo = useCallback((next: FabPosition): void => {
    positionRef.current = next
    setPosition(next)
  }, [])

  // Follow the saved position whenever the settings layer hands a new one over.
  const saved = props.position
  useEffect(() => {
    moveTo(snapToEdge(saved ?? defaultPosition()))
  }, [saved, moveTo])

  // Keep the ball inside the window when the window is resized.
  useEffect(() => {
    const onResize = (): void => moveTo(snapToEdge(positionRef.current))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [moveTo])

  useEffect(() => {
    return () => {
      if (suppressTimer.current !== null) window.clearTimeout(suppressTimer.current)
    }
  }, [])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    const root = rootRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    dragRef.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    const x = clamp(event.clientX - drag.dx, -BALL / 2, window.innerWidth - BALL / 2)
    const y = clamp(event.clientY - drag.dy, -BALL / 2, window.innerHeight - BALL / 2)
    if (!drag.moved && Math.hypot(x - positionRef.current.x, y - positionRef.current.y) < DRAG_THRESHOLD) return
    drag.moved = true
    setDragging(true)
    moveTo({ x, y })
  }

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    setDragging(false)
    if (!drag.moved) return
    // The press that ended the drag must not also toggle the menu.
    suppressClick.current = true
    if (suppressTimer.current !== null) window.clearTimeout(suppressTimer.current)
    suppressTimer.current = window.setTimeout(() => {
      suppressClick.current = false
      suppressTimer.current = null
    }, DRAG_CLICK_MS)
    const snapped = snapToEdge(positionRef.current)
    moveTo(snapped)
    props.onPosition(snapped)
  }

  /**
   * Selecting a tool also opens its panel; selecting it again closes the panel but
   * keeps the tool, exactly as the bottom bar behaves.
   */
  const pickTool = (id: PlayTool): void => {
    const panel = id === 'pen' ? 'pen' : id === 'eraser' ? 'eraser' : null
    const sameTool = tool === id
    props.onTool(id)
    props.onPopover(panel !== null && sameTool && popover === panel ? null : panel)
  }

  const tools: Array<{ id: PlayTool; label: string; icon: ReactNode; testId: string }> = [
    { id: 'pointer', label: '指针', icon: <Pointer size={18} />, testId: 'fab-tool-pointer' },
    { id: 'pen', label: '画笔', icon: <Pen size={18} />, testId: 'fab-tool-pen' },
    { id: 'eraser', label: '橡皮', icon: <Eraser size={18} />, testId: 'fab-tool-eraser' }
  ]

  // Which side the menu grows towards. Derived from the saved position rather than
  // from the DOM, so the first render already agrees with the last snap.
  const side = position.x + BALL / 2 < (typeof window === 'undefined' ? 0 : window.innerWidth / 2) ? 'left' : 'right'

  return (
    <div
      className="fab-root"
      ref={rootRef}
      data-testid="fab-toolbar"
      data-visible={visible}
      data-expanded={expanded}
      data-side={side}
      data-dragging={dragging}
      style={{ left: position.x, top: position.y }}
    >
      {expanded ? (
        <div className="fab-menu" data-testid="fab-menu" role="menu">
          {tools.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="fab-item"
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

          <span className="fab-sep" aria-hidden="true" />

          <button
            type="button"
            role="menuitem"
            className="fab-item"
            title="撤销（Ctrl+Z）"
            aria-label="撤销"
            data-testid="fab-undo"
            disabled={!canUndo}
            onClick={props.onUndo}
          >
            <Undo size={18} />
          </button>
          <button
            type="button"
            role="menuitem"
            className="fab-item"
            title="清空（可撤销）"
            aria-label="清空"
            data-testid="fab-clear"
            onClick={props.onClear}
          >
            <Trash size={18} />
          </button>

          <span className="fab-sep" aria-hidden="true" />

          <button
            type="button"
            role="menuitem"
            className="fab-item"
            data-active={boardOpen}
            title="白板（D）"
            aria-label="白板"
            aria-pressed={boardOpen}
            data-testid="fab-board"
            onClick={props.onToggleBoard}
          >
            <Board size={18} />
          </button>

          <span className="fab-sep" aria-hidden="true" />

          <button
            type="button"
            role="menuitem"
            className="fab-item fab-item-text"
            title="切换阅读方式：单栏 / 单页"
            aria-label="切换阅读方式"
            data-testid="fab-view-mode"
            onClick={() => props.onViewMode(viewMode === 'single-column' ? 'slide' : 'single-column')}
          >
            {viewMode === 'single-column' ? '单栏' : '单页'}
          </button>
          <button
            type="button"
            role="menuitem"
            className="fab-item fab-item-text"
            title="切换工具条：浮球 / 工具条"
            aria-label="切换工具条样式"
            data-testid="fab-toolbar-style"
            onClick={() => props.onToolbarStyle(toolbarStyle === 'fab' ? 'bar' : 'fab')}
          >
            {toolbarStyle === 'fab' ? '浮球' : '工具条'}
          </button>

          <span className="fab-sep" aria-hidden="true" />

          <button
            type="button"
            role="menuitem"
            className="fab-item fab-item-end"
            title="结束放映"
            aria-label="结束放映"
            data-testid="fab-end"
            onClick={props.onEnd}
          >
            <EndShow size={18} />
          </button>
        </div>
      ) : null}

      <div
        className="fab-ball"
        role="button"
        tabIndex={0}
        aria-label={expanded ? '收起工具' : '展开工具'}
        aria-expanded={expanded}
        data-testid="fab-ball"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={() => {
          if (suppressClick.current) return
          props.onToggle()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            props.onToggle()
          }
        }}
      >
        <span className="fab-ball-dot" data-active={tool !== 'pointer'} aria-hidden="true" />
      </div>

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
  )
}
