import type { CSSProperties, ReactNode } from 'react'

interface IconProps {
  size?: number
  style?: CSSProperties
}

function svg(path: ReactNode, viewBox = '0 0 24 24') {
  return function Icon({ size = 18, style }: IconProps) {
    return (
      <svg
        width={size}
        height={size}
        viewBox={viewBox}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={style}
        aria-hidden="true"
      >
        {path}
      </svg>
    )
  }
}

export const ChevronUp = svg(<path d="M6 15l6-6 6 6" />)
export const ChevronDown = svg(<path d="M6 9l6 6 6-6" />)
export const ChevronLeft = svg(<path d="M15 6l-6 6 6 6" />)
export const ChevronRight = svg(<path d="M9 6l6 6-6 6" />)
export const Pointer = svg(
  <>
    <path d="M5 3l14 8-6 1.6L10.6 19z" fill="currentColor" stroke="none" />
  </>
)
export const Pen = svg(
  <>
    <path d="M4 20l1.2-4.2L16 5a2 2 0 012.8 0l.9.9a2 2 0 010 2.8L8.2 19z" />
    <path d="M14.5 6.5l3 3" />
  </>
)
export const Eraser = svg(
  <>
    <path d="M8.5 20H20" />
    <path d="M15.5 4.5l4 4a1.5 1.5 0 010 2.1l-7 7H8l-3.5-3.5a1.5 1.5 0 010-2.1l9-9a1.5 1.5 0 012 0z" />
    <path d="M9.5 9.5l5 5" />
  </>
)
export const Magnifier = svg(
  <>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M15.5 15.5L21 21" />
  </>
)
export const Screen = svg(
  <>
    <rect x="3" y="4" width="18" height="12" rx="1.6" />
    <path d="M12 16v4M8.5 20h7" />
  </>
)
export const Board = svg(
  <>
    <rect x="3" y="4.5" width="18" height="12.5" rx="1.6" />
    <path d="M7 20l5-3 5 3" />
    <path d="M8.5 13l2.5-3 2 2.2 2.5-3.2" />
  </>
)
export const Grid = svg(
  <>
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.8" />
    <path d="M3.5 9.5h17M9 9.5v10M15 9.5v10" />
  </>
)
export const EndShow = svg(
  <>
    <rect x="3" y="4" width="18" height="12" rx="1.6" />
    <path d="M12 16v4M8.5 20h7" />
    <path d="M9 7.5l6 5M15 7.5l-6 5" />
  </>
)
export const Folder = svg(
  <path d="M3.5 7.5A1.5 1.5 0 015 6h4l1.8 2H19a1.5 1.5 0 011.5 1.5v8A1.5 1.5 0 0119 19H5a1.5 1.5 0 01-1.5-1.5z" />
)
export const Info = svg(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.8v.2" />
  </>
)
export const Settings = svg(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.5v2M12 18.5v2M4.6 7.8l1.7 1M17.7 15.2l1.7 1M4.6 16.2l1.7-1M17.7 8.8l1.7-1" />
  </>
)
export const Plus = svg(<path d="M12 5v14M5 12h14" />)
export const Minus = svg(<path d="M5 12h14" />)
export const Close = svg(<path d="M6 6l12 12M18 6L6 18" />)
export const Play = svg(<path d="M7 4.5l12 7.5-12 7.5z" fill="currentColor" stroke="none" />)
export const Help = svg(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9.8 9.4a2.3 2.3 0 114 1.7c-.8.6-1.4 1-1.4 2M12 16.4v.2" />
  </>
)
export const Trash = svg(
  <>
    <path d="M4.5 7h15M9 7V5h6v2M6.5 7l.8 12h9.4l.8-12" />
  </>
)
