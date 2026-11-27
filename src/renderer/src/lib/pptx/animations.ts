/**
 * Animation timeline parsing and step evaluation.
 *
 * This is what makes a teaching deck behave: the question shows, and each answer
 * appears only when the presenter advances.
 *
 * The real OOXML shape is deeper than it looks. A click group is a `p:par` whose
 * `p:cTn` carries `nodeType="clickEffect"` and `presetClass="entr"`; the target lives
 * in a `p:cBhvr` several levels below, and `p:withEffect` / `p:afterEffect` pars
 * inside it belong to the same click. Parsing by nesting depth therefore misses
 * real decks, so the walk below is by nodeType instead.
 *
 * Evaluation is absolute: given a step number, compute which elements are visible.
 * Nothing is stateful, so jumping backwards is as exact as stepping forwards.
 */

import type { AnimationEffect, AnimationStep, SlideElement, StepState } from './types'
import { attr, attrNum, child, descendants, first } from './xml'

/** presetID values that map onto a visual animation we implement. */
const PRESET_MAP: Record<string, AnimationEffect['preset']> = {
  '1': 'appear',
  '2': 'fly',
  '4': 'fly',
  '6': 'zoom',
  '8': 'spin',
  '10': 'fade',
  '12': 'wipe',
  '16': 'wipe',
  '22': 'wipe',
  '23': 'wipe',
  '26': 'pulse',
  '53': 'zoom'
}

/** Direction from a preset subtype. */
function directionOf(subtype: string | null): AnimationEffect['direction'] | undefined {
  switch (subtype) {
    case '4':
    case 'fromLeft':
    case '8':
      return 'left'
    case '2':
    case 'fromRight':
      return 'right'
    case '1':
    case 'fromTop':
      return 'up'
    case '16':
    case 'fromBottom':
      return 'down'
    default:
      return undefined
  }
}

/** Classify a cTn by its presetClass. */
function kindOf(ctn: Element | null): AnimationEffect['kind'] | null {
  const presetClass = attr(ctn, 'presetClass') ?? ''
  if (presetClass === 'entr') return 'enter'
  if (presetClass === 'exit') return 'exit'
  if (presetClass === 'emph') return 'emphasis'
  // path and verb animations are not modelled; treating them as emphasis keeps the
  // element visible rather than silently dropping it from the slide.
  if (presetClass === 'path' || presetClass === 'verb') return 'emphasis'
  return null
}

/**
 * Read one effect from the par that declares it.
 *
 * The preset, duration and delay sit on this par's own cTn; the target sits on the
 * first cBhvr anywhere below, because PowerPoint wraps it in a set/animEffect pair.
 */
function readEffect(par: Element): AnimationEffect | null {
  const outerCtn = child(par, 'cTn')

  // The clickEffect par carries presetID="1" (a placeholder "appear"); the real
  // visual preset is on the nested behaviour. Preferring the deepest presetClass
  // cTn is what makes a fade read as a fade instead of as an appear.
  const candidates = [outerCtn, ...descendants(par, 'cTn')].filter(
    (node): node is Element => node !== null
  )
  const withClass = candidates.filter((node) => (attr(node, 'presetClass') ?? '') !== '')
  const ctn = withClass.length > 0 ? withClass[withClass.length - 1] : outerCtn

  const kind = kindOf(ctn) ?? kindOf(outerCtn)
  if (!kind) return null

  const spTgt = first(ctn, 'spTgt') ?? first(par, 'spTgt')
  const targetId = attr(spTgt, 'spid')
  if (!targetId) return null

  const txEl = spTgt ? child(spTgt, 'txEl') : null
  const pRg = txEl ? child(txEl, 'pRg') : null
  const paragraphRange = pRg
    ? { start: attrNum(pRg, 'st', 0), end: attrNum(pRg, 'end', 0) }
    : undefined

  const presetId = attr(ctn, 'presetID') ?? ''
  const presetClass = attr(ctn, 'presetClass') ?? ''
  const preset = PRESET_MAP[presetId] ?? (presetClass === 'emph' ? 'pulse' : 'fade')

  const delay = attrNum(ctn, 'delay', 0)
  // The visible duration is the largest dur in the group: the p:set uses dur="1"
  // to toggle visibility instantly, while the animEffect carries the real timing.
  let duration = 0
  for (const node of candidates) {
    const value = attrNum(node, 'dur', -1)
    if (value > duration) duration = value
  }

  return {
    targetId,
    paragraphRange,
    kind,
    preset,
    direction: directionOf(attr(ctn, 'presetSubtype')),
    delay,
    duration: duration > 0 ? duration : 500
  }
}

/** True when a par is a click group that should start a new step. */
function startsStep(par: Element): boolean {
  const nodeType = attr(child(par, 'cTn'), 'nodeType') ?? ''
  return nodeType === 'clickEffect' || nodeType === 'clickPar'
}

/** True when a par joins the step already in progress. */
function joinsStep(par: Element): boolean {
  const nodeType = attr(child(par, 'cTn'), 'nodeType') ?? ''
  return nodeType === 'withEffect' || nodeType === 'afterEffect'
}

/**
 * Collect steps from the timing tree.
 *
 * Walks in document order: a click group opens a new step, and any with/after
 * effect either inside it or following it joins that step. This matches how a
 * presenter experiences the deck, one click at a time.
 */
export function parseAnimations(timing: Element | null): AnimationStep[] {
  if (!timing) return []

  // PowerPoint puts nodeType="mainSeq" on the cTn inside p:seq, not on p:seq.
  const sequences = descendants(timing, 'seq')
  const mainSeq =
    sequences.find((seq) => attr(child(seq, 'cTn'), 'nodeType') === 'mainSeq') ??
    sequences.find((seq) => attr(seq, 'nodeType') === 'mainSeq') ??
    sequences[0] ??
    null
  if (!mainSeq) return []

  const steps: AnimationStep[] = []

  const openStep = (): AnimationEffect[] => {
    const effects: AnimationEffect[] = []
    steps.push({ index: steps.length + 1, effects })
    return effects
  }

  /**
   * Add an effect once per target and kind.
   *
   * A single click writes a p:set plus a p:animEffect for the same shape, and both
   * parse into an effect. Keeping only the first is what makes one click equal one
   * visible change instead of a double-length animation.
   */
  const addEffect = (bucket: AnimationEffect[], effect: AnimationEffect): void => {
    const exists = bucket.some((e) => e.targetId === effect.targetId && e.kind === effect.kind)
    if (!exists) bucket.push(effect)
  }

  const visit = (node: Element): void => {
    // Every descendant par is a candidate; nesting depth is not a reliable signal.
    for (const par of descendants(node, 'par')) {
      if (startsStep(par)) {
        const bucket = openStep()
        const effect = readEffect(par)
        if (effect) addEffect(bucket, effect)
        // Nested with/after effects inside this click belong to the same step.
        for (const nested of descendants(par, 'par')) {
          if (nested === par || startsStep(nested)) continue
          if (!joinsStep(nested)) continue
          const inner = readEffect(nested)
          if (inner) addEffect(bucket, inner)
        }
      } else if (joinsStep(par)) {
        const target = steps.length > 0 ? steps[steps.length - 1].effects : openStep()
        const effect = readEffect(par)
        if (effect) addEffect(target, effect)
      }
    }
  }

  visit(mainSeq)

  // Drop steps that produced nothing, keeping indices contiguous.
  const usable = steps.filter((step) => step.effects.length > 0)
  usable.forEach((step, index) => {
    step.index = index + 1
  })
  return usable
}

/**
 * Compute the visible set and the animations to run for a given step.
 *
 * `step === 0` is the state before any click: every `enter` target is hidden and
 * every `exit` target is shown.
 */
export function evaluateStep(
  steps: AnimationStep[],
  step: number,
  options: { showAll?: boolean } = {}
): StepState {
  const visible = new Set<string>()
  const entering = new Map<string, AnimationEffect>()
  const leaving = new Map<string, AnimationEffect>()
  const hiddenParagraphs = new Map<string, Array<{ start: number; end: number }>>()

  if (options.showAll) {
    return { visible, entering, leaving, hiddenParagraphs }
  }

  const enterTargets = new Set<string>()
  const exitTargets = new Set<string>()
  for (const s of steps) {
    for (const effect of s.effects) {
      if (effect.kind === 'enter') enterTargets.add(effect.targetId)
      if (effect.kind === 'exit') exitTargets.add(effect.targetId)
    }
  }

  const effectiveStep = Math.max(0, Math.min(step, steps.length))

  for (const s of steps) {
    if (s.index > effectiveStep) continue
    for (const effect of s.effects) {
      if (effect.kind === 'enter') {
        visible.add(effect.targetId)
        if (s.index === effectiveStep) entering.set(effect.targetId, effect)
      } else if (effect.kind === 'exit') {
        visible.delete(effect.targetId)
        if (s.index === effectiveStep) leaving.set(effect.targetId, effect)
      }
      if (effect.paragraphRange) {
        const key = effect.targetId
        const list = hiddenParagraphs.get(key) ?? []
        if (effect.kind === 'enter') {
          hiddenParagraphs.set(
            key,
            list.filter(
              (r) => !(r.start === effect.paragraphRange!.start && r.end === effect.paragraphRange!.end)
            )
          )
        } else if (effect.kind === 'exit') {
          list.push(effect.paragraphRange)
          hiddenParagraphs.set(key, list)
        }
      }
    }
  }

  // Anything that only ever exits starts visible.
  for (const id of exitTargets) {
    if (!enterTargets.has(id)) visible.add(id)
  }

  return { visible, entering, leaving, hiddenParagraphs }
}

/** Total click steps a slide declares. */
export function stepCountOf(steps: AnimationStep[]): number {
  return steps.length
}

/** Elements that must start hidden because an enter effect targets them. */
export function initiallyHidden(steps: AnimationStep[]): Set<string> {
  const hidden = new Set<string>()
  const exits = new Set<string>()
  for (const s of steps) {
    for (const effect of s.effects) {
      if (effect.kind === 'enter') hidden.add(effect.targetId)
      if (effect.kind === 'exit') exits.add(effect.targetId)
    }
  }
  for (const id of exits) hidden.delete(id)
  return hidden
}

/** True when any effect targets a paragraph range rather than a whole shape. */
export function hasParagraphAnimation(steps: AnimationStep[]): boolean {
  return steps.some((s) => s.effects.some((e) => e.paragraphRange !== undefined))
}

/** Collect every shape id referenced by an animation. */
export function animatedTargets(steps: AnimationStep[]): Set<string> {
  const ids = new Set<string>()
  for (const s of steps) for (const e of s.effects) ids.add(e.targetId)
  return ids
}

/** Flatten a slide's element tree so ids can be looked up. */
export function indexElements(elements: SlideElement[]): Map<string, SlideElement> {
  const map = new Map<string, SlideElement>()
  const walk = (list: SlideElement[]): void => {
    for (const el of list) {
      map.set(el.id, el)
      if (el.type === 'group') walk(el.children)
    }
  }
  walk(elements)
  return map
}
