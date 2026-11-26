/**
 * Shared stroke drawing kernel.
 *
 * Slide annotations and the whiteboard use the same code so a pen behaves
 * identically on both surfaces, and a stroke that survives one survives the other.
 */

import type { InkStroke } from '@shared/types'

export type StrokeTool = 'pen' | 'eraser'

export interface StrokeStyle {
  color: string
  /** Width in CSS pixels; scaled by the canvas device ratio before drawing. */
  width: number
}

/** Draw a single stroke onto a canvas of the given physical size. */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: InkStroke,
  width: number,
  height: number,
  dpr: number
): void {
  const pts = stroke.points
  if (pts.length < 2) return

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = stroke.color
  ctx.fillStyle = stroke.color
  ctx.lineWidth = stroke.width * dpr
  if (stroke.tool === 'eraser') ctx.globalCompositeOperation = 'destination-out'

  // A single point is a dot, not a zero-length path: without this a click left
  // nothing behind and the stroke vanished on the next repaint.
  if (pts.length === 2) {
    ctx.beginPath()
    ctx.arc(pts[0] * width, pts[1] * height, (stroke.width * dpr) / 2, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
    return
  }

  ctx.beginPath()
  ctx.moveTo(pts[0] * width, pts[1] * height)
  for (let i = 2; i + 1 < pts.length; i += 2) {
    ctx.lineTo(pts[i] * width, pts[i + 1] * height)
  }
  ctx.stroke()
  ctx.restore()
}

/** Repaint every stroke onto a cleared canvas. */
export function paintStrokes(
  canvas: HTMLCanvasElement,
  strokes: InkStroke[],
  dpr: number
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  for (const stroke of strokes) drawStroke(ctx, stroke, canvas.width, canvas.height, dpr)
}

/**
 * Size a canvas to its container in physical pixels.
 *
 * Returns the device ratio actually used, so callers can scale line widths.
 */
export function sizeCanvasToBox(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): number {
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const width = Math.max(1, Math.floor(cssWidth * dpr))
  const height = Math.max(1, Math.floor(cssHeight * dpr))
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  return dpr
}
