import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AnimationEffect, SlideElement, SlideModel, StepState } from '../lib/pptx/types'
import { evaluateStep } from '../lib/pptx/animations'
import { PptxElement } from './PptxElement'

interface PptxSlideViewProps {
  slide: SlideModel
  /** Current click step. 0 is the slide as authored. */
  step: number
  /** Preview mode shows the finished slide, ignoring steps. */
  showAll?: boolean
  /** Fit the slide into the parent box by scaling it. */
  fit?: boolean
  onDoubleClick?: () => void
}

/**
 * Renders one slide at its authored size and, when asked to fit, scales it into the
 * available box.
 *
 * The inner tree always uses the slide's own logical size and a single transform
 * scales the whole thing. That keeps every element's proportions locked, so text
 * never reflows differently between the thumbnail, the preview and a 4K projector.
 */
export function PptxSlideView({ slide, step, showAll = false, fit = false, onDoubleClick }: PptxSlideViewProps) {
  const holderRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)
  const [animating, setAnimating] = useState<Map<string, AnimationEffect>>(new Map())

  const state: StepState = useMemo(() => {
    if (showAll) {
      return { visible: new Set<string>(), entering: new Map(), leaving: new Map(), hiddenParagraphs: new Map() }
    }
    return evaluateStep(slide.steps, step)
  }, [slide, step, showAll])

  const animatedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const s of slide.steps) for (const e of s.effects) ids.add(e.targetId)
    return ids
  }, [slide])

  // Fit: measure the holder and scale the fixed-size slide into it. Measuring the
  // holder (not the slide) keeps this a one-way dependency, so it cannot feed back
  // into its own layout the way an earlier version did.
  useLayoutEffect(() => {
    if (!fit) {
      setScale(1)
      return
    }
    const holder = holderRef.current
    if (!holder) return
    const measure = (): void => {
      const rect = holder.getBoundingClientRect()
      if (rect.width < 8 || rect.height < 8) return
      const next = Math.min(rect.width / slide.size.width, rect.height / slide.size.height)
      setScale(next > 0 ? next : 1)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(holder)
    return () => observer.disconnect()
  }, [fit, slide.size.width, slide.size.height])

  // Play the effects belonging to the step just reached, then clear them so a
  // re-render does not replay an animation the audience already saw.
  useEffect(() => {
    if (showAll) {
      setAnimating(new Map())
      return
    }
    const next = new Map<string, AnimationEffect>()
    for (const [id, effect] of state.entering) next.set(id, effect)
    for (const [id, effect] of state.leaving) next.set(id, effect)
    setAnimating(next)
    if (next.size === 0) return
    const longest = Math.max(...Array.from(next.values()).map((e) => e.delay + e.duration))
    const timer = window.setTimeout(() => setAnimating(new Map()), longest + 60)
    return () => window.clearTimeout(timer)
  }, [state, showAll, step])

  const isVisible = (id: string): boolean => {
    if (showAll) return true
    if (!animatedIds.has(id)) return true
    return state.visible.has(id)
  }

  return (
    <div className="pptx-stage" ref={holderRef}>
      <div
        className="pptx-scale"
        style={{
          width: slide.size.width,
          height: slide.size.height,
          transform: 'scale(' + scale + ')'
        }}
      >
        <div
          className="pptx-slide"
          data-testid="pptx-slide"
          onDoubleClick={onDoubleClick}
          role="presentation"
          style={{
            width: slide.size.width,
            height: slide.size.height,
            background: paintToCss(slide.background)
          }}
        >
          {slide.elements.map((element) => (
            <PptxElement
              key={element.id || String(element.rect.x) + '-' + String(element.rect.y)}
              element={element}
              visible={isVisible(element.id)}
              animation={animating.get(element.id)}
              hiddenParagraphs={state.hiddenParagraphs.get(element.id)}
              showAll={showAll}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/** Turn a background paint into a CSS value. */
export function paintToCss(paint: SlideModel['background']): string {
  if (!paint) return '#ffffff'
  if (paint.kind === 'solid') return paint.color ?? '#ffffff'
  if (paint.kind === 'gradient' && paint.stops && paint.stops.length >= 2) {
    const angle = paint.angle ?? 90
    const stops = paint.stops.map((s) => s.color).join(', ')
    return `linear-gradient(${angle}deg, ${stops})`
  }
  if (paint.kind === 'image' && paint.imageRef) return `url("${paint.imageRef}")`
  return '#ffffff'
}

export type { SlideElement }
