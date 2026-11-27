import { describe, expect, it } from 'vitest'
import {
  MAX_HISTORY,
  canUndo,
  commitHistory,
  fromSnapshot,
  initHistory,
  toSnapshot,
  undoHistory
} from '../../src/renderer/src/lib/ink-history'

interface Stroke {
  points: Array<{ x: number; y: number }>
}

const stroke = (n: number): Stroke => ({ points: [{ x: n, y: n }] })

describe('snapshots', () => {
  it('round-trips strokes', () => {
    const strokes = [stroke(1), stroke(2)]
    expect(fromSnapshot<Stroke>(toSnapshot(strokes))).toEqual(strokes)
  })

  it('drops a corrupt entry instead of losing the whole page', () => {
    const restored = fromSnapshot<Stroke>(['{"points":[]}', 'not json'])
    expect(restored).toHaveLength(1)
  })
})

describe('history', () => {
  it('starts with nothing to undo', () => {
    const entry = initHistory<Stroke>([stroke(1)])
    expect(canUndo(entry)).toBe(false)
    expect(fromSnapshot<Stroke>(entry.present)).toHaveLength(1)
  })

  it('records a change so it can be undone', () => {
    let entry = initHistory<Stroke>([])
    entry = commitHistory(entry, [stroke(1)])
    expect(canUndo(entry)).toBe(true)
    expect(fromSnapshot<Stroke>(entry.present)).toHaveLength(1)
  })

  it('steps back one change at a time', () => {
    let entry = initHistory<Stroke>([])
    entry = commitHistory(entry, [stroke(1)])
    entry = commitHistory(entry, [stroke(1), stroke(2)])
    entry = undoHistory(entry)
    expect(fromSnapshot<Stroke>(entry.present)).toHaveLength(1)
  })

  it('does nothing when there is no history', () => {
    const entry = initHistory<Stroke>([stroke(1)])
    expect(undoHistory(entry)).toEqual(entry)
  })

  it('restores every stroke after a clear with a single undo', () => {
    // This is the behaviour that matters: clearing used to destroy the strokes for
    // good, so a stray click on the bin ended the lesson's annotations.
    let entry = initHistory<Stroke>([])
    entry = commitHistory(entry, [stroke(1)])
    entry = commitHistory(entry, [stroke(1), stroke(2)])
    entry = commitHistory(entry, [stroke(1), stroke(2), stroke(3)])

    // Clear.
    entry = commitHistory(entry, [])
    expect(fromSnapshot<Stroke>(entry.present)).toHaveLength(0)

    entry = undoHistory(entry)
    expect(fromSnapshot<Stroke>(entry.present)).toHaveLength(3)
  })

  it('undoes an eraser step', () => {
    let entry = initHistory<Stroke>([stroke(1), stroke(2)])
    entry = commitHistory(entry, [stroke(1)])
    expect(fromSnapshot<Stroke>(entry.present)).toHaveLength(1)
    entry = undoHistory(entry)
    expect(fromSnapshot<Stroke>(entry.present)).toHaveLength(2)
  })

  it('caps the stack so memory cannot grow without bound', () => {
    let entry = initHistory<Stroke>([])
    for (let i = 0; i < MAX_HISTORY + 20; i++) entry = commitHistory(entry, [stroke(i)])
    expect(entry.past.length).toBe(MAX_HISTORY)
    // The newest states survive the trim.
    expect(fromSnapshot<Stroke>(entry.present)).toHaveLength(1)
  })
})
