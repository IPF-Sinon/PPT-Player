import { useEffect, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { InkStroke } from '@shared/types'

interface InkLayerProps {
  width: number
  height: number
  strokes: InkStroke[]
  active: boolean
  tool: 'pen' | 'eraser'
  color: string
  widthPx: number
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
  if (stroke.tool === 'highlighter') ctx.globalAlpha = 0.35
  if (stroke.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.moveTo(pts[0] * w, pts[1] * h)
  for (let i = 2; i + 1 < pts.length; i += 2) {
    ctx.lineTo(pts[i] * w, pts[i + 1] * h)
  }
  ctx.stroke()
  ctx.restore()
}

export function InkLayer(props: InkLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef<InkStroke | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (const stroke of props.strokes) drawStroke(ctx, stroke, canvas.width, canvas.height)
  }, [props.strokes, props.width, props.height])

  if (!props.active) return null

  const pointOf = (event: ReactPointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect()
    return [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height]
  }

  const onDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const [x, y] = pointOf(event)
    drawingRef.current = {
      tool: props.tool === 'eraser' ? 'eraser' : 'pen',
      color: props.color,
      width: props.widthPx,
      points: [x, y]
    }
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (ctx && canvas) drawStroke(ctx, drawingRef.current, canvas.width, canvas.height)
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
    drawStroke(
      ctx,
      { ...current, points: prev.slice(-2).concat([x, y]) },
      canvas.width,
      canvas.height
    )
  }

  const onUp = (): void => {
    const current = drawingRef.current
    drawingRef.current = null
    if (!current || current.points.length < 4) return
    props.onCommit(current)
  }

  return (
    <canvas
      ref={canvasRef}
      className="ink-layer"
      width={props.width}
      height={props.height}
      data-testid="ink-layer"
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    />
  )
}
