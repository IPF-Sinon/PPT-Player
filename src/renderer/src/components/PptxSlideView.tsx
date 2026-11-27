import { useEffect, useMemo, useState } from 'react'
import type { AnimationEffect, SlideElement, SlideModel, StepState } from '../lib/pptx/types'
import { evaluateStep, initiallyHidden } from '../lib/pptx/animations'
import { PptxElement } from './PptxElement'

interface PptxSlideViewProps {
  slide: SlideModel
  /** Current click step. 0 is the slide as authored. */
  step: number
  /** Preview mode shows the finished slide, ignoring steps. */
  showAll?: boolean
  /** Called with the rendered size so the caller can align the ink layer. */
  onSize?: (size: { width: number; height: number }) => void
  onDoubleClick?: () => void
}

/**
 * Renders one slide at its authored size and scales it into the available box.
 *
 * The inner canvas is always the slide's own logical size, and a single transform
 * scales the whole tree. That keeps every element's proportions locked, so text
 * never reflows differently between the thumbnail, the preview and a 4K projector.
 */
export function PptxSlideView({ slide, step, showAll = false, onSize, onDoubleClick }: PptxSlideViewProps) {
  const [animating, setAnimating] = useState<Map<string, AnimationEffect>>(new Map())

  const state: StepState = useMemo(() => {
    if (showAll) {
      return {
        visible: new Set<string>(),
        entering: new Map(),
        leaving: new Map(),
        hiddenParagraphs: new Map()
      }
    }
    return evaluateStep(slide.steps, step)
  }, [slide, step, showAll])

  const hiddenAtStart = useMemo(() => initiallyHidden(slide.steps), [slide])

  // Play the effects that belong to the step we just landed on. The map is cleared
  // afterwards so a re-render does not replay an animation the audience already saw.
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

  useEffect(() => {
    onSize?.({ width: slide.size.width, height: slide.size.height })
  }, [slide.size.width, slide.size.height, onSize])

  const isVisible = (id: string): boolean => {
    if (showAll) return true
    // Not animated: always visible.
    if (!hiddenAtStart.has(id) && !state.visible.has(id)) {
      const animated = slide.steps.some((s) => s.effects.some((e) => e.targetId === id))
      return !animated
    }
    return state.visible.has(id)
  }

  return (
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
  if (paint.kind === 'image' && paint.imageRef) return `url("${paint.imageRef}") center/cover`
  return '#ffffff'
}

export type { SlideElement }
