/**
 * Write the build variant into resources/engine.json before packaging.
 *
 * The lite build must ship metadata that points at the matching engine zip, and the
 * full build must not offer a download at all. Doing this at package time keeps a
 * single source of truth for the version and checksums.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const variant = process.argv[2]
if (variant !== 'full' && variant !== 'lite') {
  console.error('[set-variant] usage: node scripts/set-variant.mjs <full|lite>')
  process.exit(1)
}

const path = join(process.cwd(), 'resources', 'engine.json')
const meta = JSON.parse(readFileSync(path, 'utf8'))

meta.variant = variant

if (variant === 'lite') {
  const version = process.env.GITHUB_REF_NAME ?? 'v0.0.0'
  const repo = process.env.GITHUB_REPOSITORY ?? 'IPF-Sinon/PPT-Player'
  // The engine asset is published alongside the app in the same release.
  meta.engineZipUrl =
    process.env.ENGINE_ZIP_URL ??
    'https://github.com/' + repo + '/releases/download/' + version +
    '/PPTPlayer-Engine-' + meta.version + '-win-x64.zip'
  meta.engineZipSha256 = process.env.ENGINE_ZIP_SHA256 ?? meta.engineZipSha256 ?? ''
  meta.engineZipBytes = Number(process.env.ENGINE_ZIP_BYTES ?? meta.engineZipBytes ?? 0)
} else {
  // A full build carries its own engine, so it must never offer a download.
  meta.engineZipUrl = ''
  meta.engineZipSha256 = ''
  meta.engineZipBytes = 0
}

writeFileSync(path, JSON.stringify(meta, null, 2) + '\n', 'utf8')
console.log('[set-variant] ' + variant + ' -> ' + path)
