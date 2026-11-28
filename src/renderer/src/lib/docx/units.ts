/**
 * Unit conversion for WordprocessingML.
 *
 * Word measures almost nothing in the unit the renderer draws in. The whole point
 * of this module is that a number arriving from the XML is converted exactly once,
 * at the boundary, so no downstream code has to remember which scale it is on.
 */

/** Twips per CSS pixel: 1440 twips per inch, 96 pixels per inch. */
const TWIPS_PER_PX = 1440 / 96
/** EMU per CSS pixel: 914400 EMU per inch. */
export const EMU_PER_PX = 914400 / 96
/** Points per CSS pixel at 96 DPI. */
const PT_PER_PX = 72 / 96

/** A twip length (w:ind, w:spacing, w:pgSz, w:tblW dxa) to pixels. */
export function twips(value: number): number {
  return value / TWIPS_PER_PX
}

/** A half-point length (w:sz) to pixels. Word writes font sizes in half-points. */
export function halfPoints(value: number): number {
  return value / 2 / PT_PER_PX
}

/** An eighth-of-a-point length (w:sz on a border) to pixels. */
export function eighthPoints(value: number): number {
  return value / 8 / PT_PER_PX
}

/** An EMU length (wp:extent) to pixels. */
export function emu(value: number): number {
  return value / EMU_PER_PX
}

/**
 * A length attribute that may be written in any of Word's three linear units.
 *
 * w:tblW, w:tcW and w:ind accept dxa (twips), pct (fiftieths of a percent) and
 * auto in the same attribute position, so the reader has to look at the type
 * before it can scale the number.
 */
export function linear(value: number, type: string | null, percentOf: number): number {
  const kind = (type ?? 'dxa').toLowerCase()
  if (kind === 'pct') return (value / 5000) * percentOf
  if (kind === 'emu') return emu(value)
  if (kind === 'auto' || kind === 'nil') return 0
  return twips(value)
}

/** An alpha in OOXML is a 0..100000 fraction. */
export function fraction(value: number): number {
  return value / 100000
}
