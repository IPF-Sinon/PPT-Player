/**
 * Load a .docx through the host.
 *
 * The parts come from the same pptx:// scheme the native PPTX renderer uses: a
 * .docx is the same ZIP container, and the shell already serves any part of an
 * open archive, so a Word document needs no new protocol and no conversion.
 */

import type { DocxDocument } from './types'
import { parseDocument } from './parser'

/** The one thing this module needs from the shell. */
export interface DocxSource {
  pptxUrl(deckId: string, partPath: string): string
}

/**
 * Parse the document behind a deck id.
 *
 * Returns null when the archive has no readable word/document.xml, which is what a
 * legacy binary .doc looks like from here: it is a CFB, not a ZIP, so nothing in
 * it is reachable and the caller falls back to the engine.
 */
export async function loadDocx(deckId: string, api: DocxSource): Promise<DocxDocument | null> {
  const readText = async (partPath: string): Promise<string | null> => {
    try {
      const response = await fetch(api.pptxUrl(deckId, partPath))
      if (!response.ok) return null
      return await response.text()
    } catch {
      return null
    }
  }

  return parseDocument({
    deckId,
    readText,
    pptxUrl: (id, part) => api.pptxUrl(id, part)
  })
}
