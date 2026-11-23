/**
 * How a filled template value is sized in its box, the same rule as the API's signpdf.drawLines so the preview
 * matches the PDF: its size in points; with auto-fit, shrunk to fitFontSize (the box height sets it, a line wider
 * than the box shrinks it, never below MIN_SIZE), never grown.
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

/** A4's width in points: the scale of a preview whose page size is not known (a test's bare overlay). */
const A4_POINTS = 595.28

/**
 * The size in pixels of a value printed at `points` in box, on the page it sits on (the closest
 * `[data-page-points]`, PdfView's overlay); with autoFit never larger than fitFontSize allows.
 */
export function printedSize(
  box: HTMLElement,
  points: number,
  autoFit: boolean,
  lines: number,
  widest: number,
) {
  const page = box.closest<HTMLElement>('[data-page-points]')
  const scale = page
    ? page.clientWidth / (Number(page.dataset.pagePoints) || A4_POINTS)
    : (box.parentElement?.parentElement?.clientWidth ?? A4_POINTS) / A4_POINTS
  const size = points * scale
  return autoFit
    ? Math.min(size, fitFontSize(box.clientWidth, box.clientHeight, lines, widest))
    : size
}
