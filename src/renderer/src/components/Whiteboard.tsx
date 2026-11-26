import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { InkStroke } from '@shared/types'
import { drawStroke, paintStrokes, sizeCanvasToBox } from '../lib/stroke-canvas'

interface WhiteboardProps {
  strokes: InkStroke[]
  tool: 'pen' | 'eraser'
  color: string
  widthPx: number
  onCommit: (stroke: InkStroke) => void
}

/**
 * Full-screen annotation board, sharing the stroke kernel with slide ink.
 *
 * Resize and repaint are deliberately separate effects. Binding the resize
 * listener to the stroke list made every finished stroke reallocate the canvas,
 * which is what caused the flash and the full double repaint on each stroke.
 */
export function Whiteboard({ strokes, tool, color, widthPx, onCommit }: WhiteboardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef<InkStroke | null>(null)
  const strokesRef = useRef<InkStroke[]>(strokes)
  const dprRef = useRef(1)

  strokesRef.current = strokes

  useEffect(() => {
    const resize = (): void => {
      const canvas = canvasRef.current
      if (!canvas) return
      dprRef.current = sizeCanvasToBox(canvas, window.innerWidth, window.innerHeight)
      paintStrokes(canvas, strokesRef.current, dprRef.current)
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    paintStrokes(canvas, strokes, dprRef.current)
  }, [strokes])

  const pointOf = (event: ReactPointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect()
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height]
  }

  const onDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const [x, y] = pointOf(event)
    const stroke: InkStroke = { tool, color, width: widthPx, points: [x, y] }
    drawingRef.current = stroke

    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) drawStroke(ctx, stroke, canvas.width, canvas.height, dprRef.current)
  }

  const onMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const current = drawingRef.current
    if (!current) return
    const [x, y] = pointOf(event)
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
    onCommit(current)
  }

  return (
    <canvas
      ref={canvasRef}
      className="whiteboard"
      data-testid="whiteboard"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    />
  )
}
