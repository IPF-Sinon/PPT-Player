/**
 * Animation timeline parsing and step evaluation.
 *
 * This is what makes a teaching deck behave: the question shows, and each answer
 * appears only when the presenter advances.
 *
 * The real OOXML shape is deeper than it looks. A click group is a p:par whose
 * p:cTn carries nodeType="clickEffect" and presetClass="entr"; the target lives in
 * a p:cBhvr several levels below, and p:withEffect / p:afterEffect pars inside it
 * belong to the same click. Parsing by nesting depth therefore misses real decks,
 * so the walk below is by nodeType instead.
 *
 * Evaluation is absolute: given a step number, compute which elements are visible.
 * Nothing is stateful, so jumping backwards is as exact as stepping forwards.
 */

import type {
  AnimationEffect,
  AnimationStep,
  MotionPath,
  SlideElement,
  StepState,
  TriggerTrack
} from './types'
import { attr, attrNum, attrBool, child, descendants, first } from './xml'
import { linePathFrom, makeMotionPath, ooxmlPathToSvgD } from './motion-path'

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
  // A path animation moves the shape without changing visibility.
  if (presetClass === 'path') return 'motion'
  if (presetClass === 'verb') return 'emphasis'
  return null
}

/** Size used to denormalise path coordinates when the caller did not supply one. */
const DEFAULT_SLIDE = { width: 960, height: 540 }

/**
 * Read the motion path declared by a p:animMotion behaviour.
 *
 * Coordinates in OOXML are fractions of the slide, and some producers skip the
 * path attribute entirely and use from/to/by instead, so both forms are handled.
 */
function readMotion(par: Element, slide: { width: number; height: number }): MotionPath | null {
  const motionEl = first(par, 'animMotion')
  if (!motionEl) return null

  const pathAttr = attr(motionEl, 'path')
  let d = ooxmlPathToSvgD(pathAttr, slide.width, slide.height)

  if (!d) {
    const readPoint = (name: string): { x: number; y: number } | null => {
      const raw = attr(motionEl, name)
      if (!raw) return null
      const parts = raw.trim().split(/[ ,]+/).map(Number)
      if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null
      return { x: parts[0], y: parts[1] }
    }
    d = linePathFrom(
      readPoint('from'),
      readPoint('to'),
      readPoint('by'),
      slide.width,
      slide.height
    )
  }

  if (!d) return null

  const ctn = first(motionEl, 'cTn')
  const repeatRaw = attr(ctn, 'repeatCount')
  const repeatCount = repeatRaw ? Number(repeatRaw) : 1

  return makeMotionPath(d, {
    autoReverse: attrBool(motionEl, 'autoRev'),
    repeatCount: Number.isFinite(repeatCount) ? repeatCount : 1,
    accel: attrNum(ctn, 'accel', 0) / 100000,
    decel: attrNum(ctn, 'decel', 0) / 100000
  })
}

/**
 * Read one effect from the par that declares it.
 *
 * The preset, duration and delay sit on this par's own cTn; the target sits on the
 * first cBhvr anywhere below, because PowerPoint wraps it in a set/animEffect pair.
 */
function readEffect(
  par: Element,
  slide: { width: number; height: number } = DEFAULT_SLIDE
): AnimationEffect | null {
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

  const delay = attrNum(ctn, 'delay', 0)
  // The visible duration is the largest dur in the group: the p:set uses dur="1"
  // to toggle visibility instantly, while the animEffect carries the real timing.
  let duration = 0
  for (const node of candidates) {
    const value = attrNum(node, 'dur', -1)
    if (value > duration) duration = value
  }

  if (kind === 'motion') {
    const motion = readMotion(par, slide)
    if (!motion) return null
    // Motion paths default to a long, visible duration when none is declared.
    return {
      targetId,
      kind,
      preset: 'path',
      delay,
      duration: duration > 0 ? duration : 2000,
      motion
    }
  }

  const preset = PRESET_MAP[presetId] ?? (presetClass === 'emph' ? 'pulse' : 'fade')

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
 * Add an effect once per target and kind.
 *
 * A single click writes a p:set plus a p:animEffect for the same shape, and both
 * parse into an effect. Keeping only the first is what makes one click equal one
 * visible change instead of a double-length animation.
 */
function addEffect(bucket: AnimationEffect[], effect: AnimationEffect): void {
  const exists = bucket.some((e) => e.targetId === effect.targetId && e.kind === effect.kind)
  if (!exists) bucket.push(effect)
}

/** Collect the click steps under one sequence element. */
function stepsFrom(
  seq: Element,
  slide: { width: number; height: number }
): AnimationStep[] {
  const steps: AnimationStep[] = []

  const openStep = (): AnimationEffect[] => {
    const effects: AnimationEffect[] = []
    steps.push({ index: steps.length + 1, effects })
    return effects
  }

  for (const par of descendants(seq, 'par')) {
    if (startsStep(par)) {
      const bucket = openStep()
      const effect = readEffect(par, slide)
      if (effect) addEffect(bucket, effect)
      // Nested with/after effects inside this click belong to the same step.
      for (const nested of descendants(par, 'par')) {
        if (nested === par || startsStep(nested)) continue
        if (!joinsStep(nested)) continue
        const inner = readEffect(nested, slide)
        if (inner) addEffect(bucket, inner)
      }
    } else if (joinsStep(par)) {
      const target = steps.length > 0 ? steps[steps.length - 1].effects : openStep()
      const effect = readEffect(par, slide)
      if (effect) addEffect(target, effect)
    }
  }

  const usable = steps.filter((step) => step.effects.length > 0)
  usable.forEach((step, index) => {
    step.index = index + 1
  })
  return usable
}

/** Find the sequence whose cTn carries the given nodeType. */
function findSequence(timing: Element, nodeType: string): Element | null {
  for (const seq of descendants(timing, 'seq')) {
    if (attr(child(seq, 'cTn'), 'nodeType') === nodeType) return seq
    if (attr(seq, 'nodeType') === nodeType) return seq
  }
  return null
}

/**
 * Collect the main click sequence.
 *
 * PowerPoint puts nodeType="mainSeq" on the cTn inside p:seq, not on p:seq, so
 * looking on the seq element itself yields no animations at all.
 */
export function parseAnimations(
  timing: Element | null,
  slide: { width: number; height: number } = DEFAULT_SLIDE
): AnimationStep[] {
  if (!timing) return []
  const mainSeq =
    findSequence(timing, 'mainSeq') ??
    descendants(timing, 'seq')[0] ??
    null
  if (!mainSeq) return []
  return stepsFrom(mainSeq, slide)
}

/**
 * Collect click-triggered tracks.
 *
 * An interactive sequence is bound to a shape: clicking that shape advances its own
 * timeline instead of the slide's. Decks use this for "click the button to reveal
 * the matching answer", so each button needs an independent track.
 */
export function parseTriggers(
  timing: Element | null,
  slide: { width: number; height: number } = DEFAULT_SLIDE
): Record<string, TriggerTrack> {
  const out: Record<string, TriggerTrack> = {}
  if (!timing) return out

  for (const seq of descendants(timing, 'seq')) {
    const isInteractive = attr(child(seq, 'cTn'), 'nodeType') === 'interactiveSeq'
    if (!isInteractive) continue

    // The trigger shape is named by the onClick condition on the sequence itself.
    let triggerId = ''
    const conds = descendants(seq, 'cond')
    for (const cond of conds) {
      if (attr(cond, 'evt') !== 'onClick') continue
      const spTgt = first(cond, 'spTgt')
      const spid = attr(spTgt, 'spid')
      if (spid) {
        triggerId = spid
        break
      }
    }
    if (!triggerId) continue

    const steps = stepsFrom(seq, slide)
    if (steps.length === 0) continue

    const ctn = child(seq, 'cTn')
    out[triggerId] = {
      triggerId,
      steps,
      restart: attrBool(ctn, 'restart')
    }
  }

  return out
}

/**
 * Compute the visible set and the animations to run for a given step.
 *
 * step === 0 is the state before any click: every enter target is hidden and every
 * exit target is shown. Trigger targets are hidden too, because they are revealed
 * by clicking their button rather than by advancing.
 */
export function evaluateStep(
  steps: AnimationStep[],
  step: number,
  options: {
    showAll?: boolean
    triggers?: Record<string, TriggerTrack>
    /** Per-trigger progress: how many of that track's steps have run. */
    triggerProgress?: Record<string, number>
  } = {}
): StepState {
  const visible = new Set<string>()
  const entering = new Map<string, AnimationEffect>()
  const leaving = new Map<string, AnimationEffect>()
  const moving = new Map<string, AnimationEffect>()
  const hiddenParagraphs = new Map<string, Array<{ start: number; end: number }>>()

  if (options.showAll) {
    return { visible, entering, leaving, moving, hiddenParagraphs }
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
      } else if (effect.kind === 'motion') {
        if (s.index === effectiveStep) moving.set(effect.targetId, effect)
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

  // Trigger tracks reveal their own targets, independent of the main sequence.
  const triggers = options.triggers ?? {}
  const progress = options.triggerProgress ?? {}
  for (const track of Object.values(triggers)) {
    const done = Math.max(0, Math.min(progress[track.triggerId] ?? 0, track.steps.length))
    for (const s of track.steps) {
      if (s.index > done) continue
      for (const effect of s.effects) {
        if (effect.kind === 'enter') {
          visible.add(effect.targetId)
          if (s.index === done) entering.set(effect.targetId, effect)
        } else if (effect.kind === 'exit') {
          visible.delete(effect.targetId)
          if (s.index === done) leaving.set(effect.targetId, effect)
        } else if (effect.kind === 'motion') {
          if (s.index === done) moving.set(effect.targetId, effect)
        }
      }
    }
  }

  return { visible, entering, leaving, moving, hiddenParagraphs }
}

/** Total click steps a slide declares. */
export function stepCountOf(steps: AnimationStep[]): number {
  return steps.length
}

/** Elements that must start hidden because an enter effect targets them. */
export function initiallyHidden(
  steps: AnimationStep[],
  triggers: Record<string, TriggerTrack> = {}
): Set<string> {
  const hidden = new Set<string>()
  const exits = new Set<string>()
  const collect = (list: AnimationStep[]): void => {
    for (const s of list) {
      for (const effect of s.effects) {
        if (effect.kind === 'enter') hidden.add(effect.targetId)
        if (effect.kind === 'exit') exits.add(effect.targetId)
      }
    }
  }
  collect(steps)
  // A target revealed by a trigger button must also start hidden, otherwise the
  // answer is already on screen before the button is ever pressed.
  for (const track of Object.values(triggers)) collect(track.steps)
  for (const id of exits) hidden.delete(id)
  return hidden
}

/** True when any effect targets a paragraph range rather than a whole shape. */
export function hasParagraphAnimation(steps: AnimationStep[]): boolean {
  return steps.some((s) => s.effects.some((e) => e.paragraphRange !== undefined))
}

/** Collect every shape id referenced by an animation. */
export function animatedTargets(
  steps: AnimationStep[],
  triggers: Record<string, TriggerTrack> = {}
): Set<string> {
  const ids = new Set<string>()
  for (const s of steps) for (const e of s.effects) ids.add(e.targetId)
  for (const track of Object.values(triggers)) {
    for (const s of track.steps) for (const e of s.effects) ids.add(e.targetId)
  }
  return ids
}

/** Collect the shape ids that act as trigger buttons. */
export function triggerTargets(triggers: Record<string, TriggerTrack>): Set<string> {
  return new Set(Object.keys(triggers))
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
