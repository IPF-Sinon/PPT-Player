import type { ReactNode } from 'react'
import { Board, EndShow, Eraser, Grid, Magnifier, Pen, Pointer, Screen } from './icons'

export type PlayTool = 'pointer' | 'pen' | 'eraser' | 'magnifier'

interface PlayToolbarProps {
  tool: PlayTool
  blackout: boolean
  boardOpen: boolean
  overviewOpen: boolean
  onTool: (tool: PlayTool) => void
  onToggleBlackout: () => void
  onToggleBoard: () => void
  onToggleOverview: () => void
  onEnd: () => void
  visible: boolean
  dark: boolean
}

export function PlayToolbar(props: PlayToolbarProps) {
  const {
    tool,
    blackout,
    boardOpen,
    overviewOpen,
    onTool,
    onToggleBlackout,
    onToggleBoard,
    onToggleOverview,
    onEnd,
    visible,
    dark
  } = props

  const items: Array<{ id: PlayTool; label: string; icon: ReactNode; testId: string }> = [
    { id: 'pointer', label: '指针', icon: <Pointer size={20} />, testId: 'tool-pointer' },
    { id: 'pen', label: '画笔', icon: <Pen size={20} />, testId: 'tool-pen' },
    { id: 'eraser', label: '橡皮', icon: <Eraser size={20} />, testId: 'tool-eraser' },
    { id: 'magnifier', label: '放大镜', icon: <Magnifier size={20} />, testId: 'tool-magnifier' }
  ]

  return (
    <div className="play-chrome" data-visible={visible} data-dark={dark} data-testid="play-toolbar">
      <div className="tool-cluster">
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
            onClick={() => onTool(item.id)}
          >
            {item.icon}
          </button>
        ))}
        <span className="tool-sep" aria-hidden="true" />
        <button
          type="button"
          className="tool-btn"
          data-active={blackout}
          title="黑屏"
          aria-label="黑屏"
          aria-pressed={blackout}
          data-testid="tool-blackout"
          onClick={onToggleBlackout}
        >
          <Screen size={20} />
        </button>
        <button
          type="button"
          className="tool-btn"
          data-active={boardOpen}
          title="白板（D）"
          aria-label="白板"
          aria-pressed={boardOpen}
          data-testid="tool-board"
          onClick={onToggleBoard}
        >
          <Board size={20} />
        </button>
        <button
          type="button"
          className="tool-btn"
          data-active={overviewOpen}
          title="幻灯片总览（O）"
          aria-label="幻灯片总览"
          aria-pressed={overviewOpen}
          data-testid="tool-overview"
          onClick={onToggleOverview}
        >
          <Grid size={20} />
        </button>
      </div>
      <button
        type="button"
        className="tool-end"
        title="结束放映"
        aria-label="结束放映"
        data-testid="tool-end"
        onClick={onEnd}
      >
        <EndShow size={20} />
      </button>
    </div>
  )
}
