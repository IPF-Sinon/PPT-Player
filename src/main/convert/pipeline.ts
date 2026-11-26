import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { MAX_SOURCE_BYTES, extensionOf } from '../../shared/formats'
import { AppError, toPayload } from '../../shared/errors'
import type { ConvertProgress, DeckInfo, FormatInfo, OpenResult } from '../../shared/types'
import { consoleLogger as log } from './logging'
import { DeckCache, cacheKey } from './cache'
import { detectFormat } from './detect'
import { runLibreOffice } from './engine-lo'
import { bufferSource, fileSource } from './byte-source'
import type { EngineStatus } from '../../shared/types'

export interface ConvertContext {
  cacheRoot: string
  /** Directory holding reusable LibreOffice profiles. */
  profileRoot: string
  appVersion: string
  /** Resolved conversion engine, injected so the pipeline stays testable. */
  engine: () => EngineStatus | Promise<EngineStatus>
  /** Called after a deck is opened successfully, used to update the recent list. */
  onOpened?: (filePath: string) => void
}

export type ProgressSink = (progress: ConvertProgress) => void

interface DeckRecord {
  info: DeckInfo
  pdfPath: string
  cacheKey: string
  cacheDir: string
}

const decks = new Map<string, DeckRecord>()
let cache: DeckCache | null = null

/** Conversion budget. Long enough for a big deck, short enough to fail visibly. */
const CONVERT_TIMEOUT_MS = 60_000

export function getCache(ctx: ConvertContext): DeckCache {
  if (!cache) cache = new DeckCache(ctx.cacheRoot)
  return cache
}

export function resetPipelineForTests(): void {
  decks.clear()
  cache = null
}

export interface ProbeResult {
  format: FormatInfo
  bytes: number
  mtimeMs: number
}

/**
 * Classify a file without loading it.
 *
 * Only the header, the ZIP tail and the central directory are read, so the cost is
 * independent of file size and a deck larger than 64 MB is no longer truncated
 * into a false "corrupt-zip".
 */
export function probeFile(filePath: string): ProbeResult {
  let stat
  try {
    stat = statSync(filePath)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new AppError('ENOENT', '文件不存在：' + filePath)
    if (code === 'EACCES') throw new AppError('EACCES', '没有读取权限：' + filePath)
    throw new AppError('EINTERNAL', String(err))
  }

  if (!stat.isFile()) throw new AppError('EBADFORMAT', '不是一个文件：' + filePath)
  if (stat.size === 0) throw new AppError('EEMPTY', '文件是空的')
  if (stat.size > MAX_SOURCE_BYTES) throw new AppError('ETOOBIG', '文件超过 200 MB，无法打开')

  const source = fileSource(filePath)
  let format: FormatInfo
  try {
    format = detectFormat(source, extensionOf(filePath))
  } finally {
    source.close()
  }

  if (format.kind === 'unsupported') {
    const message = format.reason === 'not-presentation' ? '这不是演示文稿文件' : '无法识别的文件格式'
    throw new AppError('EUNSUPPORTED', message, format.reason)
  }

  return { format, bytes: stat.size, mtimeMs: stat.mtimeMs }
}

export interface OpenOptions {
  onProgress?: ProgressSink
  signal?: AbortSignal
}

/** Probe, convert (or reuse the cache) and register a deck. */
export async function openDeck(
  ctx: ConvertContext,
  filePath: string,
  options: OpenOptions = {}
): Promise<OpenResult> {
  const emit = (deckId: string, stage: ConvertProgress['stage'], ratio: number, message: string): void => {
    options.onProgress?.({ deckId, stage, ratio, message })
  }

  try {
    emit('', 'probe', 0.05, '正在识别格式')
    const probe = probeFile(filePath)

    if (probe.format.kind === 'encrypted-ooxml') {
      throw new AppError('EENCRYPTED', '加密的演示文稿需要本机安装 PowerPoint 才能打开')
    }

    const isPdf = probe.format.kind === 'pdf'
    const engine = await ctx.engine()
    if (!isPdf && !engine.available) {
      throw new AppError('ENOENGINE', '转换引擎不可用', engine.detail)
    }

    const engineId = isPdf ? 'passthrough' : engine.id + ':' + engine.origin
    const enginePath = isPdf ? 'pdf' : engine.path
    const key = cacheKey({
      sourcePath: filePath,
      sourceBytes: probe.bytes,
      sourceMtimeMs: probe.mtimeMs,
      engine: engineId,
      enginePath,
      appVersion: ctx.appVersion
    })
    const deckId = createHash('sha256').update(key + '|' + filePath).digest('hex').slice(0, 12)

    const deckCache = getCache(ctx)
    const cacheDir = deckCache.dirFor(key)

    const hit = deckCache.lookup(key)
    if (hit) {
      emit(deckId, 'done', 1, '已缓存')
      const info: DeckInfo = {
        deckId,
        sourcePath: filePath,
        sourceBytes: probe.bytes,
        sourceMtimeMs: probe.mtimeMs,
        format: probe.format,
        pageCount: hit.meta.pageCount,
        pageSizes: [],
        engine: isPdf ? 'none' : 'libreoffice',
        enginePath,
        convertMs: 0,
        cached: true,
        mixedAspect: false,
        warnings: []
      }
      decks.set(deckId, { info, pdfPath: hit.pdfPath, cacheKey: key, cacheDir })
      ctx.onOpened?.(filePath)
      return { ok: true, info }
    }

    mkdirSync(cacheDir, { recursive: true })
    const pdfPath = join(cacheDir, 'deck.pdf')
    let convertMs = 0

    if (!isPdf) {
      emit(deckId, 'convert', 0.25, '正在转换')
      log.info('converting with LibreOffice', { engine: engine.path, source: filePath, out: cacheDir })
      const result = await runLibreOffice({
        sourcePath: filePath,
        outDir: cacheDir,
        profileRoot: ctx.profileRoot,
        timeoutMs: CONVERT_TIMEOUT_MS,
        sofficePath: engine.path,
        signal: options.signal
      })
      convertMs = result.durationMs
      log.info('conversion finished', {
        ok: result.ok,
        ms: result.durationMs,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        aborted: result.aborted,
        stderr: result.stderr.slice(0, 400)
      })
      if (!result.ok) {
        rmSync(cacheDir, { recursive: true, force: true })
        if (result.aborted) throw new AppError('ECANCELLED', '已取消转换')
        if (result.timedOut) throw new AppError('ETIMEOUT', '转换超时，请重试', result.stderr.slice(0, 2000))
        throw new AppError('ECONVERT', '转换失败', result.stderr.slice(0, 2000))
      }
    } else {
      copyFileSync(filePath, pdfPath)
    }

    emit(deckId, 'parse', 0.85, '正在解析页面')

    // Count the pages here rather than waiting for the renderer. The cache is only
    // reusable once it knows the page count, and an open that was closed before the
    // renderer finished reporting used to leave pageCount 0 and throw the entry
    // away, forcing a full reconversion next time.
    const pageCount = countPdfPages(pdfPath)

    const info: DeckInfo = {
      deckId,
      sourcePath: filePath,
      sourceBytes: probe.bytes,
      sourceMtimeMs: probe.mtimeMs,
      format: probe.format,
      pageCount,
      pageSizes: [],
      engine: isPdf ? 'none' : 'libreoffice',
      enginePath,
      convertMs,
      cached: false,
      mixedAspect: false,
      warnings: []
    }
    decks.set(deckId, { info, pdfPath, cacheKey: key, cacheDir })
    deckCache.store(key, {
      sourcePath: filePath,
      sourceBytes: probe.bytes,
      sourceMtimeMs: probe.mtimeMs,
      engine: info.engine,
      enginePath,
      appVersion: ctx.appVersion,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      pageCount
    })
    emit(deckId, 'done', 1, '完成')
    ctx.onOpened?.(filePath)
    return { ok: true, info }
  } catch (err) {
    if (err instanceof AppError) return { ok: false, error: err.toPayload() }
    log.error('openDeck failed', err)
    return { ok: false, error: toPayload(err) }
  }
}

/**
 * Count pages in a PDF without a full parser.
 *
 * Walks the file for `/Type /Page` objects, which LibreOffice always writes as
 * plain objects. When that finds nothing it falls back to the /Count entry of the
 * page tree root, and finally to 0 so the renderer can report the real number.
 */
export function countPdfPages(pdfPath: string): number {
  let text = ''
  try {
    text = readFileSync(pdfPath, 'latin1')
  } catch {
    return 0
  }

  let pages = 0
  const pageRe = /\/Type\s*\/Page(?![s\w])/g
  while (pageRe.exec(text) !== null) pages++
  if (pages > 0) return pages

  const countMatch = /\/Type\s*\/Pages[\s\S]{0,200}?\/Count\s+(\d+)/.exec(text)
  if (countMatch) {
    const parsed = Number(countMatch[1])
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return 0
}

export function getDeck(deckId: string): DeckRecord | undefined {
  return decks.get(deckId)
}

export function pdfPathOf(deckId: string): string | null {
  return decks.get(deckId)?.pdfPath ?? null
}

/** Record page metrics reported by the renderer once it has parsed the PDF. */
export function reportDeckMetrics(
  ctx: ConvertContext,
  deckId: string,
  pageCount: number,
  pageSizes: Array<{ width: number; height: number }>
): DeckInfo | null {
  const record = decks.get(deckId)
  if (!record) return null
  record.info.pageCount = pageCount
  record.info.pageSizes = pageSizes
  const first = pageSizes[0]
  if (first && pageSizes.length > 1) {
    const ratio = first.width / first.height
    record.info.mixedAspect = pageSizes.some((s) => Math.abs(s.width / s.height - ratio) > 0.01)
  }
  getCache(ctx).store(record.cacheKey, {
    sourcePath: record.info.sourcePath,
    sourceBytes: record.info.sourceBytes,
    sourceMtimeMs: record.info.sourceMtimeMs,
    engine: record.info.engine,
    enginePath: record.info.enginePath,
    appVersion: ctx.appVersion,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    pageCount
  })
  return record.info
}

export function closeDeck(deckId: string): void {
  decks.delete(deckId)
}

export function ensureCacheDir(ctx: ConvertContext): string {
  mkdirSync(ctx.cacheRoot, { recursive: true })
  return ctx.cacheRoot
}

export { bufferSource }
