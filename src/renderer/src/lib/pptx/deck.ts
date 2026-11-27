/**
 * Native deck loader.
 *
 * Turns the slide list the main process indexed into renderable slides. Parsing is
 * lazy: the first slide is parsed immediately so the preview has something to show,
 * and the rest are parsed on demand as the presenter reaches them.
 */

import type { NativeDeck, SlideModel } from './types'
import { loadTheme, parseSlide, type SlideLoadContext } from './parser'

interface DeckSource {
  pptxUrl(deckId: string, partPath: string): string
}

export interface LoadedNativeDeck extends NativeDeck {
  /** Cached slides, keyed by zero-based index. */
  slides: Array<SlideModel | null>
  theme: Awaited<ReturnType<typeof loadTheme>>
  /** Parse one slide, reusing the cache. */
  loadSlide(index: number): Promise<SlideModel | null>
}

/** Theme parts live under ppt/theme; the index does not carry them for slides. */
async function resolveThemePath(readText: (p: string) => Promise<string | null>): Promise<string[]> {
  const candidates: string[] = []
  // The presentation relationships name the real theme, but theme1 is the norm.
  for (let i = 1; i <= 4; i++) candidates.push('ppt/theme/theme' + i + '.xml')
  const found: string[] = []
  for (const path of candidates) {
    if (await readText(path)) found.push(path)
  }
  return found.length > 0 ? found : ['ppt/theme/theme1.xml']
}

/**
 * Load a deck: read the theme, then parse slide 1.
 *
 * `slidePaths` come from the main-process index, so the renderer never has to walk
 * the archive itself.
 */
export async function loadNativeDeck(
  deckId: string,
  slidePaths: string[],
  slideSize: { width: number; height: number },
  api: DeckSource
): Promise<LoadedNativeDeck> {
  const readText = async (partPath: string): Promise<string | null> => {
    try {
      const response = await fetch(api.pptxUrl(deckId, partPath))
      if (!response.ok) return null
      return await response.text()
    } catch {
      return null
    }
  }

  const themePaths = await resolveThemePath(readText)
  const theme = await loadTheme({ readText, themePaths })

  const slides: Array<SlideModel | null> = new Array(slidePaths.length).fill(null)
  let hasComplex = false

  const ctx: SlideLoadContext = { deckId, theme, readText, slideSize }

  const loadSlide = async (index: number): Promise<SlideModel | null> => {
    if (index < 0 || index >= slidePaths.length) return null
    const cached = slides[index]
    if (cached) return cached
    const model = await parseSlide(ctx, slidePaths[index], index)
    slides[index] = model
    if (model?.hasComplexObjects) hasComplex = true
    return model
  }

  // Parse the first slide now; everything else waits until it is needed.
  await loadSlide(0)

  return {
    deckId,
    size: slideSize,
    slideCount: slidePaths.length,
    slidePaths,
    hasComplexObjects: hasComplex || slides.some((s) => s?.hasComplexObjects === true),
    slides,
    theme,
    loadSlide
  }
}
