import { protocol } from 'electron'
import { createReadStream, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { log } from '../log'
import { pdfPathOf } from '../convert/pipeline'
import { isInside } from './protocol-path'

export const APP_SCHEME = 'app'
export const RENDERER_HOST = 'renderer'
export const DECK_HOST = 'deck'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream'
}

/** Must be called before app ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: false,
        corsEnabled: true
      }
    }
  ])
}

function notFound(): Response {
  return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } })
}

/**
 * Stream a file with optional HTTP range support, which pdf.js relies on for
 * large documents.
 */
function streamFile(filePath: string, request: Request): Response {
  let stat
  try {
    stat = statSync(filePath)
  } catch {
    return notFound()
  }
  if (!stat.isFile()) return notFound()

  const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
  const range = request.headers.get('range')
  const ifNoneMatch = request.headers.get('if-none-match')
  const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`

  if (ifNoneMatch && ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: { etag } })
  }

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (match) {
      const startRaw = match[1] ?? ''
      const endRaw = match[2] ?? ''
      let start = startRaw === '' ? stat.size - Number(endRaw) : Number(startRaw)
      let end = startRaw === '' ? stat.size - 1 : endRaw === '' ? stat.size - 1 : Number(endRaw)
      if (!Number.isFinite(start) || !Number.isFinite(end)) return notFound()
      start = Math.max(0, Math.min(start, stat.size - 1))
      end = Math.max(start, Math.min(end, stat.size - 1))
      const body = Readable.toWeb(createReadStream(filePath, { start, end })) as unknown as ReadableStream
      return new Response(body, {
        status: 206,
        headers: {
          'content-type': type,
          'content-length': String(end - start + 1),
          'content-range': `bytes ${start}-${end}/${stat.size}`,
          'accept-ranges': 'bytes',
          etag,
          'cache-control': 'no-cache'
        }
      })
    }
  }

  const body = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': type,
      'content-length': String(stat.size),
      'accept-ranges': 'bytes',
      etag,
      'cache-control': 'no-cache'
    }
  })
}

export interface ProtocolRoots {
  /** Directory holding the built renderer bundle (index.html, assets, cmaps). */
  rendererRoot: string
}

/**
 * Serve the renderer bundle and converted decks. Only two roots are reachable:
 * the built renderer directory and the deck PDFs registered in the pipeline.
 */
export function registerAppProtocol(roots: ProtocolRoots): void {
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const host = url.hostname
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')

      if (host === DECK_HOST) {
        const segments = rel.split('/')
        const deckId = segments[0] ?? ''
        const target = segments.slice(1).join('/')
        if (!/^[0-9a-f]{12}$/.test(deckId) || target !== 'deck.pdf') return notFound()
        const pdfPath = pdfPathOf(deckId)
        if (!pdfPath) return notFound()
        return streamFile(pdfPath, request)
      }

      if (host === RENDERER_HOST) {
        const target = rel === '' ? 'index.html' : rel
        const resolved = join(roots.rendererRoot, target)
        if (!isInside(roots.rendererRoot, resolved)) {
          return new Response('forbidden', { status: 403 })
        }
        return streamFile(resolved, request)
      }

      return notFound()
    } catch (err) {
      log.warn('app:// request failed', request.url, err)
      return new Response('error', { status: 500 })
    }
  })
}
