import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AnimationEffect, SlideElement, SlideModel, StepState, TriggerTrack } from '../lib/pptx/types'
import { evaluateStep } from '../lib/pptx/animations'
import { createSampler, easeProgress, pointAt, releaseSampler } from '../lib/pptx/motion-path'
import { PptxElement } from './PptxElement'

interface PptxSlideViewProps {
  slide: SlideModel
  /** Current click step. 0 is the slide as authored. */
  step: number
  /** Preview mode shows the finished slide, ignoring steps. */
  showAll?: boolean
  /** Fit the slide into the parent box by scaling it. */
  fit?: boolean
  /**
   * Explicit scale, bypassing measurement.
   *
   * A thumbnail knows its own width, so measuring would only add a layout round
   * trip and risk a zero-size first pass that renders blank.
   */
  fixedScale?: number
  /** How many steps of each trigger track have run. */
  triggerProgress?: Record<string, number>
  /** Called when the audience clicks a trigger button. */
  onTrigger?: (triggerId: string) => void
  /** True when the ink tool is active, so triggers must not swallow the click. */
  inkActive?: boolean
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
export function PptxSlideView({
  slide,
  step,
  showAll = false,
  fit = false,
  fixedScale,
  triggerProgress,
  onTrigger,
  inkActive = false,
  onDoubleClick
}: PptxSlideViewProps) {
  const holderRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)
  const [animating, setAnimating] = useState<Map<string, AnimationEffect>>(new Map())
  /** Accumulated translation per shape, so successive paths chain from each other. */
  const [offsets, setOffsets] = useState<Map<string, { x: number; y: number }>>(new Map())
  const rafRef = useRef<number | null>(null)

  const state: StepState = useMemo(() => {
    if (showAll) {
      return {
        visible: new Set<string>(),
        entering: new Map(),
        leaving: new Map(),
        moving: new Map(),
        hiddenParagraphs: new Map()
      }
    }
    return evaluateStep(slide.steps, step, { triggers: slide.triggers, triggerProgress })
  }, [slide, step, showAll, triggerProgress])

  const animatedIds = useMemo(() => {
    const ids = new Set<string>()
    for (const s of slide.steps) for (const e of s.effects) ids.add(e.targetId)
    for (const track of Object.values(slide.triggers)) {
      for (const s of track.steps) for (const e of s.effects) ids.add(e.targetId)
    }
    return ids
  }, [slide])

  const triggerIds = useMemo(() => new Set(Object.keys(slide.triggers)), [slide])

  // Fit: measure the holder and scale the fixed-size slide into it. Measuring the
  // holder (not the slide) keeps this a one-way dependency, so it cannot feed back
  // into its own layout the way an earlier version did.
  useLayoutEffect(() => {
    if (fixedScale !== undefined) {
      setScale(fixedScale)
      return
    }
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
  }, [fit, fixedScale, slide.size.width, slide.size.height])

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

  /**
   * Drive motion paths with requestAnimationFrame.
   *
   * The path is sampled through an offscreen SVGPathElement, so curves follow their
   * real geometry rather than a polyline approximation. Progress is absolute per
   * step: landing on a step sets the final offset, which is what makes rewinding
   * land exactly where the shape started.
   */
  useEffect(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (showAll || state.moving.size === 0) return

    const targets = Array.from(state.moving.values()).filter((effect) => effect.motion)
    if (targets.length === 0) return

    const samplers = new Map<string, SVGPathElement>()
    for (const effect of targets) {
      const sampler = createSampler(effect.motion!.d)
      if (sampler) samplers.set(effect.targetId, sampler)
    }

    const started = performance.now()
    const total = Math.max(...targets.map((e) => e.delay + e.duration))

    const frame = (now: number): void => {
      const elapsed = now - started
      const next = new Map<string, { x: number; y: number }>()
      for (const effect of targets) {
        const sampler = samplers.get(effect.targetId)
        if (!sampler) continue
        const local = Math.max(0, elapsed - effect.delay)
        const raw = effect.duration > 0 ? Math.min(1, local / effect.duration) : 1
        const eased = easeProgress(raw, effect.motion!.accel ?? 0, effect.motion!.decel ?? 0)
        const point = pointAt(sampler, eased)
        next.set(effect.targetId, point)
      }
      setOffsets(next)
      if (elapsed < total) {
        rafRef.current = requestAnimationFrame(frame)
      } else {
        rafRef.current = null
      }
    }

    rafRef.current = requestAnimationFrame(frame)

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      for (const sampler of samplers.values()) releaseSampler(sampler)
    }
  }, [state.moving, showAll])

  // Leaving a step that had motion must reset the offsets, otherwise a shape stays
  // where the path left it after the presenter rewinds.
  useEffect(() => {
    if (state.moving.size === 0) setOffsets(new Map())
  }, [state.moving.size, step])

  const isVisible = (id: string): boolean => {
    if (showAll) return true
    if (!animatedIds.has(id)) return true
    return state.visible.has(id)
  }

  const handleTrigger = (id: string): void => {
    if (inkActive) return
    if (!triggerIds.has(id)) return
    onTrigger?.(id)
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
              offset={offsets.get(element.id)}
              hiddenParagraphs={state.hiddenParagraphs.get(element.id)}
              showAll={showAll}
              isTrigger={triggerIds.has(element.id)}
              onTrigger={handleTrigger}
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
    return 'linear-gradient(' + angle + 'deg, ' + stops + ')'
  }
  if (paint.kind === 'image' && paint.imageRef) return 'url("' + paint.imageRef + '")'
  return '#ffffff'
}

export type { SlideElement, TriggerTrack }