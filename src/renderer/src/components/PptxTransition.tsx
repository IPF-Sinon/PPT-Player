import { useEffect, useRef, useState } from 'react'
import type { SlideModel, SlideTransition } from '../lib/pptx/types'
import { PptxSlideView } from './PptxSlideView'

interface PptxTransitionProps {
  slide: SlideModel
  step: number
  transition: SlideTransition | undefined
  /** Set to false by the settings toggle, which makes every change a hard cut. */
  enabled: boolean
  /** Key that changes when the slide changes, used to detect navigation. */
  slideKey: string
  /** How many steps of each trigger track have run. */
  triggerProgress?: Record<string, number>
  /** Called when the audience clicks a trigger button. */
  onTrigger?: (triggerId: string) => void
  /** True when an ink tool is active, so triggers must not swallow clicks. */
  inkActive?: boolean
}

/** CSS animation names for a transition, per role. */
function animationFor(transition: SlideTransition, role: 'in' | 'out'): string {
  const dir = transition.direction ?? 'left'
  switch (transition.type) {
    case 'fade':
      return role === 'in' ? 'pptx-tr-fade-in' : 'pptx-tr-fade-out'
    case 'push':
    case 'cover':
    case 'pull':
      return role === 'in' ? 'pptx-tr-push-' + dir + '-in' : 'pptx-tr-push-' + dir + '-out'
    case 'wipe':
      return role === 'in' ? 'pptx-tr-wipe-' + dir + '-in' : 'none'
    case 'zoom':
      return role === 'in' ? 'pptx-tr-zoom-in' : 'pptx-tr-fade-out'
    case 'split':
      return role === 'in' ? 'pptx-tr-split-in' : 'none'
    default:
      return 'none'
  }
}

/**
 * Wraps the slide in a transition when the presenter navigates.
 *
 * The outgoing slide is kept on screen for the duration so the audience sees a
 * movement rather than a flash. Rapid navigation is handled by keying the effect on
 * the slide index: a new navigation cancels the pending cleanup of the previous
 * one, so two quick presses never leave a stale layer behind.
 */
export function PptxTransition({
  slide,
  step,
  transition,
  enabled,
  slideKey,
  triggerProgress,
  onTrigger,
  inkActive
}: PptxTransitionProps) {
  const [outgoing, setOutgoing] = useState<SlideModel | null>(null)
  const [animKey, setAnimKey] = useState(0)
  const previousRef = useRef<SlideModel | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    const previous = previousRef.current
    previousRef.current = slide

    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setOutgoing(null)

    // No transition on first paint, when disabled, or when the slide did not change.
    if (!previous || !enabled || !transition || previous.index === slide.index) return

    setOutgoing(previous)
    setAnimKey((n) => n + 1)
    timerRef.current = window.setTimeout(() => {
      setOutgoing(null)
      timerRef.current = null
    }, transition.duration + 40)
  }, [slideKey, slide, transition, enabled])

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  const duration = transition && enabled ? transition.duration : 0

  return (
    <div className="pptx-stage" style={{ position: 'relative' }}>
      {outgoing && transition ? (
        <div
          key={'out-' + animKey}
          className="transition-layer transition-out"
          data-testid="transition-out"
          style={{
            animationName: animationFor(transition, 'out'),
            animationDuration: duration + 'ms',
            animationFillMode: 'forwards',
            animationTimingFunction: 'ease-out'
          }}
        >
          <PptxSlideView slide={outgoing} step={outgoing.steps.length} fit />
        </div>
      ) : null}

      <div
        key={'in-' + animKey}
        className={outgoing ? 'transition-layer transition-in' : undefined}
        data-testid="transition-in"
        style={
          outgoing && transition
            ? {
                animationName: animationFor(transition, 'in'),
                animationDuration: duration + 'ms',
                animationFillMode: 'forwards',
                animationTimingFunction: 'ease-out'
              }
            : undefined
        }
      >
        <PptxSlideView
          slide={slide}
          step={step}
          fit
          triggerProgress={triggerProgress}
          onTrigger={onTrigger}
          inkActive={inkActive}
        />
      </div>
    </div>
  )
}