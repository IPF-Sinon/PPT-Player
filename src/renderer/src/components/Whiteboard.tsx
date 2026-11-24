import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { InkStroke } from '@shared/types'

interface WhiteboardProps {
  strokes: InkStroke[]
  tool: 'pen' | 'eraser'
  onCommit: (stroke: InkStroke) => void
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: InkStroke, w: number, h: number): void {
  const pts = stroke.points
  if (pts.length < 4) return
  ctx.save()
  ctx.strokeStyle = stroke.color
  ctx.lineWidth = stroke.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (stroke.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.moveTo(pts[0] * w, pts[1] * h)
  for (let i = 2; i + 1 < pts.length; i += 2) {
    ctx.lineTo(pts[i] * w, pts[i + 1] * h)
  }
  ctx.stroke()
  ctx.restore()
}

/**
 * The annotation board. Unlike the ink layer this fills the whole screen, so a
 * presenter can draw while the slide is hidden instead of squeezing notes into
 * the slide box. Strokes are kept in the same shape as slide ink.
 */
export function Whiteboard({ strokes, tool, onCommit }: WhiteboardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef<InkStroke | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (const stroke of strokes) drawStroke(ctx, stroke, canvas.width, canvas.height)
  }, [strokes])

  // Match the backing store to the viewport so the pen stays crisp on any screen.
  useEffect(() => {
    const resize = (): void => {
      const canvas = canvasRef.current
      if (!canvas) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.floor(window.innerWidth * dpr)
      canvas.height = Math.floor(window.innerHeight * dpr)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const stroke of strokes) drawStroke(ctx, stroke, canvas.width, canvas.height)
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [strokes])

  const pointOf = (event: ReactPointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect()
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height]
  }

  const onDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const [x, y] = pointOf(event)
    const stroke: InkStroke = {
      tool: tool === 'eraser' ? 'eraser' : 'pen',
      color: '#e11d48',
      width: 5,
      points: [x, y]
    }
    drawingRef.current = stroke

    // Mark the first point immediately, so a single click leaves a dot instead of
    // nothing at all.
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (ctx && canvas) {
      ctx.save()
      ctx.fillStyle = stroke.color
      if (stroke.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out'
      ctx.beginPath()
      ctx.arc(x * canvas.width, y * canvas.height, stroke.width / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  const onMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const current = drawingRef.current
    if (!current) return
    const [x, y] = pointOf(event)
    const prev = current.points
    current.points = [...prev, x, y]
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!ctx || !canvas) return
    drawStroke(ctx, { ...current, points: prev.slice(-2).concat([x, y]) }, canvas.width, canvas.height)
  }

  const onUp = (): void => {
    const current = drawingRef.current
    drawingRef.current = null
    // Two coordinates are enough: a dot is a valid stroke on a whiteboard.
    if (!current || current.points.length < 2) return
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
