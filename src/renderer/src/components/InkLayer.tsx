import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { InkStroke } from '@shared/types'
import { drawStroke, paintStrokes, sizeCanvasToBox } from '../lib/stroke-canvas'

interface InkLayerProps {
  /** Bumped whenever the slide box is remeasured. */
  boxWidth: number
  boxHeight: number
  strokes: InkStroke[]
  /** Drawing is only captured in pen or eraser mode. */
  drawing: boolean
  tool: 'pen' | 'eraser'
  color: string
  widthPx: number
  onCommit: (stroke: InkStroke) => void
}

/**
 * Annotation layer over the slide.
 *
 * It stays mounted when the pointer tool is active: unmounting the canvas used to
 * erase every stroke the moment the presenter switched back to pointer.
 */
export function InkLayer(props: InkLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef<InkStroke | null>(null)
  const strokesRef = useRef<InkStroke[]>(props.strokes)
  const dprRef = useRef(1)

  strokesRef.current = props.strokes

  // Resize and repaint are separate concerns: resizing must not depend on strokes,
  // or every finished stroke would rebind the observer and reallocate the canvas.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (props.boxWidth < 1 || props.boxHeight < 1) return
    dprRef.current = sizeCanvasToBox(canvas, props.boxWidth, props.boxHeight)
    paintStrokes(canvas, strokesRef.current, dprRef.current)
  }, [props.boxWidth, props.boxHeight])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    paintStrokes(canvas, props.strokes, dprRef.current)
  }, [props.strokes])

  const pointOf = (event: ReactPointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect()
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height]
  }

  const onDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!props.drawing) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const [x, y] = pointOf(event)
    const stroke: InkStroke = {
      tool: props.tool,
      color: props.color,
      width: props.widthPx,
      points: [x, y]
    }
    drawingRef.current = stroke

    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) drawStroke(ctx, stroke, canvas.width, canvas.height, dprRef.current)
  }

  const onMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const current = drawingRef.current
    if (!current) return
    const [x, y] = pointOf(event)
    // Push in place: rebuilding the array on every pointermove is quadratic in
    // stroke length and shows up as GC stutter on long annotations.
    const before = current.points.length
    current.points.push(x, y)

    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const segment: InkStroke = {
      ...current,
      points: [current.points[before - 2], current.points[before - 1], x, y]
    }
    drawStroke(ctx, segment, canvas.width, canvas.height, dprRef.current)
  }

  const onUp = (): void => {
    const current = drawingRef.current
    drawingRef.current = null
    if (!current) return
    props.onCommit(current)
  }

  return (
    <canvas
      ref={canvasRef}
      className="ink-layer"
      data-testid="ink-layer"
      data-drawing={props.drawing}
      style={{ pointerEvents: props.drawing ? 'auto' : 'none' }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    />
  )
}
