import { ChevronDown, ChevronUp } from './icons'

interface SideNavProps {
  pageIndex: number
  pageCount: number
  side: 'left' | 'right'
  onPrev: () => void
  onNext: () => void
  visible: boolean
  /** True when the slide behind the chrome is light, so the chrome inverts. */
  dark: boolean
}

export function SideNav({ pageIndex, pageCount, side, onPrev, onNext, visible, dark }: SideNavProps) {
  return (
    <div
      className="side-nav"
      data-side={side}
      data-visible={visible}
      data-dark={dark}
      data-testid={`side-nav-${side}`}
    >
      <button
        type="button"
        className="side-nav-btn"
        onClick={onPrev}
        disabled={pageIndex <= 0}
        aria-label="上一页"
        data-testid={`side-prev-${side}`}
      >
        <ChevronUp size={20} />
      </button>
      <div className="side-nav-page" data-testid={`side-page-${side}`}>
        {pageIndex + 1}/{pageCount}
      </div>
      <button
        type="button"
        className="side-nav-btn"
        onClick={onNext}
        disabled={pageIndex >= pageCount - 1}
        aria-label="下一页"
        data-testid={`side-next-${side}`}
      >
        <ChevronDown size={20} />
      </button>
    </div>
  )
}
