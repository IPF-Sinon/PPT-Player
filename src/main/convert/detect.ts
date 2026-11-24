import { KIND_LABEL, MAX_SOURCE_BYTES, extensionOf } from '../../shared/formats'
import type { FormatInfo } from '../../shared/types'
import { hasStream, listCfbEntries, looksLikeCfb } from './cfb-reader'
import { listZipEntries, looksLikeZip, readZipEntry } from './zip-reader'

export const ODP_MIME = 'application/vnd.oasis.opendocument.presentation'

const OOXML_EXTS = ['pptx', 'pptm', 'ppsx', 'ppsm', 'potx']
const LEGACY_EXTS = ['ppt', 'pps', 'pot']

function reject(declaredExt: string, reason: string): FormatInfo {
  return {
    kind: 'unsupported',
    container: 'unknown',
    declaredExt,
    extMismatch: false,
    encrypted: false,
    label: KIND_LABEL.unsupported,
    reason
  }
}

function isOdp(buf: Buffer, names: string[]): boolean {
  const mimeName = names.find((n) => n.toLowerCase() === 'mimetype')
  if (!mimeName) return false
  const payload = readZipEntry(buf, mimeName)
  if (!payload) return false
  return payload.toString('utf8').trim() === ODP_MIME
}

/**
 * Classify a presentation file from its bytes. The declared extension is used
 * only for labelling and mismatch reporting, never for the decision itself.
 */
export function detectFormat(buf: Buffer, declaredExt: string): FormatInfo {
  const ext = declaredExt.toLowerCase()

  if (buf.length === 0) return reject(ext, 'empty')
  if (buf.length > MAX_SOURCE_BYTES) return reject(ext, 'too-large')

  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') {
    return {
      kind: 'pdf',
      container: 'pdf',
      declaredExt: ext,
      extMismatch: ext !== 'pdf',
      encrypted: false,
      label: KIND_LABEL.pdf
    }
  }

  if (looksLikeZip(buf)) {
    const names = listZipEntries(buf).map((e) => e.name)
    if (names.length === 0) return reject(ext, 'corrupt-zip')
    const lower = names.map((n) => n.toLowerCase())

    if (isOdp(buf, names)) {
      return {
        kind: 'odp',
        container: 'zip',
        declaredExt: ext,
        extMismatch: ext !== 'odp',
        encrypted: false,
        label: KIND_LABEL.odp
      }
    }

    if (lower.includes('ppt/presentation.xml')) {
      return {
        kind: 'ooxml-presentation',
        container: 'zip',
        declaredExt: ext,
        extMismatch: !OOXML_EXTS.includes(ext),
        encrypted: false,
        label: KIND_LABEL['ooxml-presentation']
      }
    }

    if (lower.includes('encryptedpackage')) {
      return {
        kind: 'encrypted-ooxml',
        container: 'cfb',
        declaredExt: ext,
        extMismatch: false,
        encrypted: true,
        label: KIND_LABEL['encrypted-ooxml']
      }
    }

    return reject(ext, 'not-presentation')
  }

  if (looksLikeCfb(buf)) {
    const entries = listCfbEntries(buf)
    if (entries.length === 0) return reject(ext, 'corrupt-cfb')

    if (hasStream(entries, 'EncryptedPackage') && hasStream(entries, 'EncryptionInfo')) {
      return {
        kind: 'encrypted-ooxml',
        container: 'cfb',
        declaredExt: ext,
        extMismatch: false,
        encrypted: true,
        label: KIND_LABEL['encrypted-ooxml']
      }
    }

    if (hasStream(entries, 'PowerPoint Document')) {
      return {
        kind: 'legacy-ppt',
        container: 'cfb',
        declaredExt: ext,
        extMismatch: !LEGACY_EXTS.includes(ext),
        encrypted: false,
        label: KIND_LABEL['legacy-ppt']
      }
    }

    if (hasStream(entries, 'WordDocument') || hasStream(entries, 'Workbook')) {
      return reject(ext, 'not-presentation')
    }

    return reject(ext, 'unknown-cfb')
  }

  return reject(ext, 'unknown-signature')
}

export { extensionOf }
