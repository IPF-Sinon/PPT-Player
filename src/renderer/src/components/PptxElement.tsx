import type {
  AnimationEffect,
  Paint,
  PictureElement,
  ShapeElement,
  SlideElement,
  TableElement,
  TextBody,
  TextParagraph
} from '../lib/pptx/types'

interface PptxElementProps {
  element: SlideElement
  visible: boolean
  animation?: AnimationEffect
  /** Translation from a motion path, in slide pixels. */
  offset?: { x: number; y: number }
  hiddenParagraphs?: Array<{ start: number; end: number }>
  showAll: boolean
  /** True when this shape starts a trigger track. */
  isTrigger?: boolean
  onTrigger?: (id: string) => void
}

/** CSS value for a paint, including gradients. */
export function paintToCss(paint: Paint | undefined): string {
  if (!paint) return 'transparent'
  if (paint.kind === 'none') return 'transparent'
  if (paint.kind === 'solid') return paint.color ?? 'transparent'
  if (paint.kind === 'gradient' && paint.stops && paint.stops.length >= 2) {
    const angle = paint.angle ?? 90
    const stops = paint.stops
      .map((s) => `${s.color} ${Math.round(s.offset * 100)}%`)
      .join(', ')
    return `linear-gradient(${angle}deg, ${stops})`
  }
  if (paint.kind === 'image' && paint.imageRef) {
    return `url("${paint.imageRef}") center/${paint.imageMode === 'tile' ? 'auto' : 'cover'}`
  }
  return 'transparent'
}

/** CSS animation name and transform origin for an effect. */
function animationStyle(effect: AnimationEffect | undefined): React.CSSProperties {
  if (!effect) return {}
  const duration = effect.duration > 0 ? effect.duration : 400
  const delay = effect.delay > 0 ? effect.delay : 0

  // Motion is driven by requestAnimationFrame rather than CSS, so it has no entry.
  const presets: Record<AnimationEffect['preset'], string> = {
    appear: 'pptx-appear',
    fade: 'pptx-fade',
    fly: 'pptx-fly-' + (effect.direction ?? 'left'),
    wipe: 'pptx-wipe-' + (effect.direction ?? 'left'),
    zoom: 'pptx-zoom',
    spin: 'pptx-spin',
    pulse: 'pptx-pulse',
    path: 'none'
  }

  if (effect.preset === 'path') return {}

  return {
    animationName: presets[effect.preset],
    animationDuration: duration + 'ms',
    animationDelay: delay + 'ms',
    animationFillMode: 'both',
    animationTimingFunction: 'ease-out'
  }
}

function baseStyle(
  element: SlideElement,
  visible: boolean,
  offset?: { x: number; y: number }
): React.CSSProperties {
  const style: React.CSSProperties = {
    position: 'absolute',
    left: element.rect.x,
    top: element.rect.y,
    width: element.rect.width,
    height: element.rect.height,
    // Hidden elements keep their box so layout never shifts as steps advance.
    visibility: visible ? 'visible' : 'hidden'
  }
  // A motion path translates the shape away from its authored position.
  if (offset && (offset.x !== 0 || offset.y !== 0)) {
    style.left = element.rect.x + offset.x
    style.top = element.rect.y + offset.y
  }
  if (element.rotation) {
    style.transform = `rotate(${element.rotation}deg)`
    style.transformOrigin = 'center center'
  }
  if (element.type !== 'group') {
    if (element.flipH || element.flipV) {
      const parts: string[] = []
      if (element.rotation) parts.push(`rotate(${element.rotation}deg)`)
      parts.push(`scaleX(${element.flipH ? -1 : 1})`, `scaleY(${element.flipV ? -1 : 1})`)
      style.transform = parts.join(' ')
    }
  }
  return style
}

/** Render a text body, hiding paragraphs a step has not revealed yet. */
function TextBlock({
  body,
  hidden
}: {
  body: TextBody
  hidden?: Array<{ start: number; end: number }>
}): React.JSX.Element {
  const isHidden = (index: number): boolean => {
    if (!hidden) return false
    return hidden.some((range) => index >= range.start && index <= range.end)
  }

  return (
    <div
      className="pptx-text"
      style={{
        padding: `${body.inset.top}px ${body.inset.right}px ${body.inset.bottom}px ${body.inset.left}px`,
        justifyContent: body.anchor === 'middle' ? 'center' : body.anchor === 'bottom' ? 'flex-end' : 'flex-start',
        whiteSpace: body.wrap ? 'pre-wrap' : 'pre'
      }}
    >
      {body.paragraphs.map((paragraph, index) => (
        <Paragraph key={index} paragraph={paragraph} hidden={isHidden(index)} />
      ))}
    </div>
  )
}

function Paragraph({
  paragraph,
  hidden
}: {
  paragraph: TextParagraph
  hidden: boolean
}): React.JSX.Element {
  const style: React.CSSProperties = {
    textAlign: paragraph.align,
    lineHeight: paragraph.lineHeight,
    marginTop: paragraph.spaceBefore,
    marginBottom: paragraph.spaceAfter,
    marginLeft: paragraph.level * 18,
    display: hidden ? 'none' : undefined
  }

  return (
    <p className="pptx-para" style={style}>
      {paragraph.bullet ? (
        <span className="pptx-bullet" style={{ marginLeft: -paragraph.bullet.indent }}>
          {paragraph.bullet.char}
        </span>
      ) : null}
      {paragraph.runs.map((run, index) => (
        <span
          key={index}
          style={{
            fontWeight: run.bold ? 700 : undefined,
            fontStyle: run.italic ? 'italic' : undefined,
            textDecoration:
              [run.underline ? 'underline' : '', run.strike ? 'line-through' : '']
                .filter(Boolean)
                .join(' ') || undefined,
            fontSize: run.size,
            fontFamily: run.fontFamily,
            color: run.color,
            verticalAlign: run.baseline ? 'super' : undefined,
            letterSpacing: run.letterSpacing,
            background: run.highlight,
            whiteSpace: 'pre-wrap'
          }}
        >
          {run.text}
        </span>
      ))}
    </p>
  )
}

function shapeClip(shape: ShapeElement): React.CSSProperties {
  switch (shape.geometry.kind) {
    case 'ellipse':
      return { borderRadius: '50%' }
    case 'roundRect':
      return { borderRadius: shape.geometry.radius }
    case 'triangle':
      return { clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)' }
    case 'diamond':
      return { clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' }
    case 'chevron':
      return { clipPath: 'polygon(0% 0%, 75% 0%, 100% 50%, 75% 100%, 0% 100%, 25% 50%)' }
    case 'arrow':
      return { clipPath: 'polygon(0% 25%, 60% 25%, 60% 0%, 100% 50%, 60% 100%, 60% 75%, 0% 75%)' }
    case 'star':
      return {
        clipPath:
          'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)'
      }
    case 'polygon':
      return {
        clipPath:
          'polygon(' +
          shape.geometry.points.map((p) => `${(p.x / shape.rect.width) * 100}% ${(p.y / shape.rect.height) * 100}%`).join(', ') +
          ')'
      }
    default:
      return {}
  }
}

function renderShape(shape: ShapeElement, hiddenParagraphs?: Array<{ start: number; end: number }>): React.JSX.Element {
  const fill = paintToCss(shape.fill)
  const border = shape.border
  const isLine = shape.geometry.kind === 'line'

  if (isLine) {
    return (
      <svg width="100%" height="100%" style={{ overflow: 'visible' }}>
        <line
          x1={0}
          y1={0}
          x2="100%"
          y2="100%"
          stroke={border ? paintToCss(border.paint) : '#000'}
          strokeWidth={border?.width ?? 1}
          strokeDasharray={
            border?.dash === 'dash' ? '6 4' : border?.dash === 'dot' ? '2 3' : border?.dash === 'dashDot' ? '6 3 2 3' : undefined
          }
        />
      </svg>
    )
  }

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: fill,
        border: border ? `${border.width}px solid ${paintToCss(border.paint)}` : undefined,
        borderStyle: border?.dash === 'dash' ? 'dashed' : border?.dash === 'dot' ? 'dotted' : undefined,
        boxShadow: shape.shadow ? '0 2px 8px rgba(0,0,0,0.18)' : undefined,
        ...shapeClip(shape)
      }}
    >
      {shape.text ? <TextBlock body={shape.text} hidden={hiddenParagraphs} /> : null}
    </div>
  )
}

function renderPicture(pic: PictureElement): React.JSX.Element {
  const crop = pic.crop
  const style: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    display: 'block'
  }
  if (crop && (crop.left || crop.top || crop.right || crop.bottom)) {
    // Clip the image by its source rect, the way a:srcRect does.
    style.clipPath = `inset(${crop.top * 100}% ${crop.right * 100}% ${crop.bottom * 100}% ${crop.left * 100}%)`
    const scaleX = 1 / Math.max(0.01, 1 - crop.left - crop.right)
    const scaleY = 1 / Math.max(0.01, 1 - crop.top - crop.bottom)
    style.transform = `scale(${scaleX}, ${scaleY})`
    style.transformOrigin = 'center'
  }
  return <img src={pic.src} alt="" style={style} draggable={false} />
}

function renderTable(table: TableElement): React.JSX.Element {
  const totalWidth = table.columnWidths.reduce((a, b) => a + b, 0) || table.rect.width
  const totalHeight = table.rowHeights.reduce((a, b) => a + b, 0) || table.rect.height

  return (
    <table
      className="pptx-table"
      style={{
        width: '100%',
        height: '100%',
        tableLayout: 'fixed',
        borderCollapse: 'collapse'
      }}
    >
      <colgroup>
        {table.columnWidths.map((w, i) => (
          <col key={i} style={{ width: `${(w / totalWidth) * 100}%` }} />
        ))}
      </colgroup>
      <tbody>
        {table.rows.map((row, rowIndex) => (
          <tr key={rowIndex} style={{ height: `${(table.rowHeights[rowIndex] / totalHeight) * 100}%` }}>
            {row.map((cell, cellIndex) => {
              if (cell.merged) return null
              const border = cell.border
              return (
                <td
                  key={cellIndex}
                  colSpan={cell.gridSpan > 1 ? cell.gridSpan : undefined}
                  rowSpan={cell.rowSpan > 1 ? cell.rowSpan : undefined}
                  style={{
                    background: paintToCss(cell.fill),
                    border: border
                      ? `${border.width}px solid ${paintToCss(border.paint)}`
                      : '1px solid rgba(0,0,0,0.15)',
                    verticalAlign: 'middle',
                    padding: 0
                  }}
                >
                  {cell.text ? <TextBlock body={cell.text} /> : null}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * Render one slide element.
 *
 * Groups render their children in the group's own coordinate space, which the
 * parser has already normalised into slide pixels.
 */
export function PptxElement(props: PptxElementProps): React.JSX.Element | null {
  const { element, visible, animation, hiddenParagraphs, offset, isTrigger, onTrigger } = props
  const style = { ...baseStyle(element, visible, offset), ...animationStyle(animation) }

  if (element.type === 'group') {
    return (
      <div style={style}>
        {element.children.map((child, index) => (
          <PptxElement
            key={child.id || index}
            element={child}
            visible={visible}
            hiddenParagraphs={hiddenParagraphs}
            showAll={props.showAll}
            isTrigger={isTrigger}
            onTrigger={onTrigger}
          />
        ))}
      </div>
    )
  }

  // A trigger button must look clickable and must not let the click reach the
  // stage, where it would advance the slide instead of running its own track.
  if (isTrigger && onTrigger) {
    style.cursor = 'pointer'
  }

  return (
    <div
      style={style}
      data-shape-id={element.id}
      data-trigger={isTrigger ? 'true' : undefined}
      onClick={
        isTrigger && onTrigger
          ? (event) => {
              event.stopPropagation()
              onTrigger(element.id)
            }
          : undefined
      }
    >
      {element.type === 'shape' ? renderShape(element, hiddenParagraphs) : null}
      {element.type === 'picture' ? renderPicture(element) : null}
      {element.type === 'table' ? renderTable(element) : null}
    </div>
  )
}