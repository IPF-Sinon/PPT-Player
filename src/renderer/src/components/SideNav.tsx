import { ChevronLeft, ChevronRight } from './icons'

interface SideNavProps {
  visible: boolean
  onPrev: () => void
  onNext: () => void
}

/**
 * Optional side paging buttons.
 *
 * Some presenters prefer the pointer at the screen edge rather than at the bottom,
 * so this is a setting rather than a replacement.
 */
export function SideNav({ visible, onPrev, onNext }: SideNavProps) {
  return (
    <>
      <button
        type="button"
        className="side-nav"
        data-side="left"
        data-visible={visible}
        aria-label="上一页"
        data-testid="side-prev"
        onClick={onPrev}
      >
        <ChevronLeft size={22} />
      </button>
      <button
        type="button"
        className="side-nav"
        data-side="right"
        data-visible={visible}
        aria-label="下一页"
        data-testid="side-next"
        onClick={onNext}
      >
        <ChevronRight size={22} />
      </button>
    </>
  )
}
