/**
 * Runtime validation for IPC payloads.
 *
 * Hand-written guards instead of a schema library: these seven payloads are the
 * entire attack surface of the IPC bridge, and zod's parser was loaded into the
 * main process on every cold start to check them.
 */

import type { AppSettings, InkPage, InkStroke } from '../../shared/types'

export class SchemaError extends TypeError {
  constructor(message: string) {
    super(message)
    this.name = 'SchemaError'
  }
}

function fail(field: string, expectation: string): never {
  throw new SchemaError(`${field} ${expectation}`)
}

export function pathSchema(raw: unknown): string {
  if (typeof raw !== 'string') fail('path', 'must be a string')
  const value = raw as string
  if (value.length === 0) fail('path', 'must not be empty')
  if (value.length > 32767) fail('path', 'is too long')
  return value
}

export function deckIdSchema(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[0-9a-f]{12}$/.test(raw)) {
    fail('deckId', 'must be a 12 character hex id')
  }
  return raw as string
}

export function pageIndexSchema(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || raw > 100000) {
    fail('pageIndex', 'must be an integer in 0..100000')
  }
  return raw as number
}

function pageSize(raw: unknown): { width: number; height: number } {
  if (typeof raw !== 'object' || raw === null) fail('pageSize', 'must be an object')
  const value = raw as { width?: unknown; height?: unknown }
  if (typeof value.width !== 'number' || !Number.isFinite(value.width) || value.width <= 0) {
    fail('pageSize.width', 'must be a positive number')
  }
  if (typeof value.height !== 'number' || !Number.isFinite(value.height) || value.height <= 0) {
    fail('pageSize.height', 'must be a positive number')
  }
  return { width: value.width as number, height: value.height as number }
}

export interface ReportMetricsInput {
  deckId: string
  pageCount: number
  pageSizes: Array<{ width: number; height: number }>
}

export function reportMetricsSchema(raw: unknown): ReportMetricsInput {
  if (typeof raw !== 'object' || raw === null) fail('reportMetrics', 'must be an object')
  const value = raw as { deckId?: unknown; pageCount?: unknown; pageSizes?: unknown }
  const deckId = deckIdSchema(value.deckId)
  if (
    typeof value.pageCount !== 'number' ||
    !Number.isInteger(value.pageCount) ||
    value.pageCount < 0 ||
    value.pageCount > 100000
  ) {
    fail('pageCount', 'must be an integer in 0..100000')
  }
  if (!Array.isArray(value.pageSizes)) fail('pageSizes', 'must be an array')
  const sizes = value.pageSizes as unknown[]
  if (sizes.length > 100000) fail('pageSizes', 'is too long')
  return {
    deckId,
    pageCount: value.pageCount as number,
    pageSizes: sizes.map(pageSize)
  }
}

const SETTINGS_KEYS = new Set([
  'loPathOverride',
  'cacheBudgetMb',
  'recentFiles',
  'enableTransitions',
  'navButtonPosition',
  'keepToolbarInInkMode',
  'inkOnExit'
])

export function settingsPatchSchema(raw: unknown): Partial<AppSettings> {
  if (typeof raw !== 'object' || raw === null) fail('settings', 'must be an object')
  const value = raw as Record<string, unknown>
  for (const key of Object.keys(value)) {
    if (!SETTINGS_KEYS.has(key)) fail('settings.' + key, 'is not a known setting')
  }

  const patch: Partial<AppSettings> = {}
  if (value.loPathOverride !== undefined) {
    if (typeof value.loPathOverride !== 'string' || value.loPathOverride.length > 32767) {
      fail('loPathOverride', 'must be a string of at most 32767 characters')
    }
    patch.loPathOverride = value.loPathOverride
  }
  if (value.cacheBudgetMb !== undefined) {
    const n = value.cacheBudgetMb
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 128 || n > 8192) {
      fail('cacheBudgetMb', 'must be an integer in 128..8192')
    }
    patch.cacheBudgetMb = n
  }
  if (value.recentFiles !== undefined) {
    if (!Array.isArray(value.recentFiles) || value.recentFiles.length > 20) {
      fail('recentFiles', 'must be an array of at most 20 paths')
    }
    patch.recentFiles = value.recentFiles.map((entry, index) => pathSchema(entry) || String(index))
  }
  if (value.enableTransitions !== undefined) {
    if (typeof value.enableTransitions !== 'boolean') {
      fail('enableTransitions', 'must be a boolean')
    }
    patch.enableTransitions = value.enableTransitions
  }
  if (value.navButtonPosition !== undefined) {
    if (value.navButtonPosition !== 'bottom' && value.navButtonPosition !== 'side') {
      fail('navButtonPosition', 'must be bottom or side')
    }
    patch.navButtonPosition = value.navButtonPosition
  }
  if (value.keepToolbarInInkMode !== undefined) {
    if (typeof value.keepToolbarInInkMode !== 'boolean') {
      fail('keepToolbarInInkMode', 'must be a boolean')
    }
    patch.keepToolbarInInkMode = value.keepToolbarInInkMode
  }
  if (value.inkOnExit !== undefined) {
    if (value.inkOnExit !== 'ask' && value.inkOnExit !== 'keep' && value.inkOnExit !== 'discard') {
      fail('inkOnExit', 'must be ask, keep or discard')
    }
    patch.inkOnExit = value.inkOnExit
  }
  return patch
}

export interface PlayEnterInput {
  deckId: string
  pageIndex: number
}

export function playEnterSchema(raw: unknown): PlayEnterInput {
  if (typeof raw !== 'object' || raw === null) fail('playEnter', 'must be an object')
  const value = raw as { deckId?: unknown; pageIndex?: unknown }
  return { deckId: deckIdSchema(value.deckId), pageIndex: pageIndexSchema(value.pageIndex) }
}

function stroke(raw: unknown): InkStroke {
  if (typeof raw !== 'object' || raw === null) fail('stroke', 'must be an object')
  const value = raw as Record<string, unknown>
  const tool = value.tool
  if (tool !== 'pen' && tool !== 'highlighter' && tool !== 'eraser') {
    fail('stroke.tool', 'must be pen, highlighter or eraser')
  }
  if (typeof value.color !== 'string' || value.color.length > 32) {
    fail('stroke.color', 'must be a short string')
  }
  if (typeof value.width !== 'number' || !Number.isFinite(value.width) || value.width <= 0 || value.width > 200) {
    fail('stroke.width', 'must be a number in 0..200')
  }
  if (!Array.isArray(value.points) || value.points.length > 200000) {
    fail('stroke.points', 'must be an array of at most 200000 numbers')
  }
  const points = value.points as unknown[]
  for (const point of points) {
    if (typeof point !== 'number' || !Number.isFinite(point)) fail('stroke.points', 'must be finite numbers')
  }
  return {
    tool,
    color: value.color as string,
    width: value.width as number,
    points: points as number[]
  }
}

export interface InkPagesInput {
  deckId: string
  pages: InkPage[]
}

export function inkPagesSchema(raw: unknown): InkPagesInput {
  if (typeof raw !== 'object' || raw === null) fail('ink', 'must be an object')
  const value = raw as { deckId?: unknown; pages?: unknown }
  const deckId = deckIdSchema(value.deckId)
  if (!Array.isArray(value.pages)) fail('ink.pages', 'must be an array')
  const pages = value.pages as unknown[]
  if (pages.length > 100000) fail('ink.pages', 'is too long')

  return {
    deckId,
    pages: pages.map((entry) => {
      if (typeof entry !== 'object' || entry === null) fail('ink.page', 'must be an object')
      const page = entry as { pageIndex?: unknown; strokes?: unknown }
      const pageIndex = pageIndexSchema(page.pageIndex)
      if (!Array.isArray(page.strokes) || page.strokes.length > 5000) {
        fail('ink.page.strokes', 'must be an array of at most 5000 strokes')
      }
      return { pageIndex, strokes: (page.strokes as unknown[]).map(stroke) }
    })
  }
}

export function setLoPathSchema(raw: unknown): { path: string } {
  if (typeof raw !== 'object' || raw === null) fail('setLoPath', 'must be an object')
  const value = raw as { path?: unknown }
  if (typeof value.path !== 'string' || value.path.length > 32767) {
    fail('path', 'must be a string of at most 32767 characters')
  }
  return { path: value.path as string }
}