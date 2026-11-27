interface BoardPagerProps {
  index: number
  total: number
  onPrev: () => void
  onNext: () => void
  onAdd: () => void
}

/**
 * Page control for the whiteboard, sitting inside its bottom-right corner.
 *
 * The board supports several pages because a lesson often needs more than one clean
 * sheet; the pill shows where the presenter is and lets them add another.
 */
export function BoardPager({ index, total, onPrev, onNext, onAdd }: BoardPagerProps) {
  return (
    <div className="board-pager" data-testid="board-pager">
      <button
        type="button"
        aria-label="上一块白板"
        data-testid="board-prev"
        disabled={index <= 0}
        onClick={onPrev}
      >
        ‹
      </button>
      <span data-testid="board-page-indicator">
        {index + 1} / {total}
      </span>
      <button
        type="button"
        aria-label="下一块白板"
        data-testid="board-next"
        disabled={index >= total - 1}
        onClick={onNext}
      >
        ›
      </button>
      <button type="button" aria-label="新增白板" data-testid="board-add" onClick={onAdd}>
        +
      </button>
    </div>
  )
}
