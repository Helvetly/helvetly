/**
 * How a filled template value is sized in its box, the same rule as the API's signpdf.fitSize so the preview
 * matches the PDF: the box height sets the size, a line wider than the box shrinks it, never below MIN_SIZE.
 */
export const HEIGHT_RATIO = 0.75
export const LEADING = 1.15
export const MIN_SIZE = 4

/** Font size for `lines` lines in a `width` × `height` box, the widest line `widest` wide at size 1. */
export function fitFontSize(width: number, height: number, lines: number, widest: number) {
  let size = (height / Math.max(lines, 1)) * HEIGHT_RATIO
  if (widest > 0) size = Math.min(size, width / widest)
  return Math.max(size, MIN_SIZE)
}
