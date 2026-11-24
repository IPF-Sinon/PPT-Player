import { describe, expect, it } from 'vitest'
import { AppError, toPayload } from '../../src/shared/errors'
import { settingsPatchSchema, inkPagesSchema, playEnterSchema } from '../../src/main/ipc/schema'
import { parseSettings, DEFAULT_SETTINGS } from '../../src/main/settings-parse'

describe('AppError', () => {
  it('serialises to a payload', () => {
    const err = new AppError('ECONVERT', 'boom', 'detail')
    expect(err.toPayload()).toEqual({ code: 'ECONVERT', message: 'boom', detail: 'detail' })
  })

  it('omits an undefined detail', () => {
    expect(new AppError('ENOENT', 'missing').toPayload()).toEqual({ code: 'ENOENT', message: 'missing' })
  })

  it('wraps unknown errors', () => {
    expect(toPayload(new Error('x'))).toEqual({ code: 'EINTERNAL', message: 'x' })
    expect(toPayload('raw')).toEqual({ code: 'EINTERNAL', message: 'raw' })
  })
})

describe('ipc schemas', () => {
  it('rejects an invalid deck id', () => {
    expect(() => playEnterSchema.parse({ deckId: 'zzz', pageIndex: 0 })).toThrow()
  })

  it('accepts a valid play request', () => {
    const parsed = playEnterSchema.parse({ deckId: 'abcdef012345', pageIndex: 3 })
    expect(parsed.pageIndex).toBe(3)
  })

  it('rejects unknown settings keys', () => {
    expect(() => settingsPatchSchema.parse({ nope: 1 })).toThrow()
  })

  it('accepts a valid settings patch', () => {
    expect(settingsPatchSchema.parse({ cacheBudgetMb: 512 }).cacheBudgetMb).toBe(512)
  })

  it('validates ink pages', () => {
    const parsed = inkPagesSchema.parse({
      deckId: 'abcdef012345',
      pages: [{ pageIndex: 0, strokes: [{ tool: 'pen', color: '#f00', width: 3, points: [0, 0, 1, 1] }] }]
    })
    expect(parsed.pages).toHaveLength(1)
  })

  it('rejects an unknown ink tool', () => {
    expect(() =>
      inkPagesSchema.parse({
        deckId: 'abcdef012345',
        pages: [{ pageIndex: 0, strokes: [{ tool: 'spray', color: '#f00', width: 3, points: [] }] }]
      })
    ).toThrow()
  })
})

describe('parseSettings', () => {
  it('falls back to defaults for garbage', () => {
    expect(parseSettings('nope')).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings({ cacheBudgetMb: 'big' })).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid values', () => {
    const parsed = parseSettings({ ...DEFAULT_SETTINGS, cacheBudgetMb: 512, loopPlayback: true })
    expect(parsed.cacheBudgetMb).toBe(512)
    expect(parsed.loopPlayback).toBe(true)
  })

  it('fills in missing keys', () => {
    const parsed = parseSettings({ loopPlayback: true })
    expect(parsed.cacheBudgetMb).toBe(DEFAULT_SETTINGS.cacheBudgetMb)
    expect(parsed.recentFiles).toEqual([])
  })
})
