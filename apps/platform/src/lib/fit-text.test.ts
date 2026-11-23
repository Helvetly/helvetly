import { describe, expect, it } from 'vitest'

import { fitFontSize, printedSize } from './fit-text'

describe('fitFontSize', () => {
  it.each([
    ['the box height sets it', 200, 20, 1, 3, 15],
    ['a larger box, larger text', 200, 40, 1, 3, 30],
    ['a smaller box, smaller text', 200, 10, 1, 3, 7.5],
    ['two lines share the height', 200, 40, 2, 3, 15],
    ['a wide value shrinks to the width', 60, 20, 1, 6, 10],
    ['never below the minimum', 8, 20, 1, 6, 4],
    ['an empty value keeps the height size', 200, 20, 1, 0, 15],
  ])('%s', (_, width, height, lines, widest, want) => {
    expect(fitFontSize(width, height, lines, widest)).toBe(want)
  })
})

/** A box `w` × `h` px on a page shown `pagePx` wide whose width is 500 pt. */
const box = (w: number, h: number, pagePx = 1000) => {
  const page = document.createElement('div')
  page.dataset.pagePoints = '500'
  Object.defineProperty(page, 'clientWidth', { value: pagePx })
  const field = document.createElement('div')
  Object.defineProperties(field, { clientWidth: { value: w }, clientHeight: { value: h } })
  page.append(field)
  return field
}

describe('printedSize', () => {
  it('prints the points at the page scale, whatever the box', () => {
    expect(printedSize(box(400, 200), 10, false, 1, 3)).toBe(20)
    expect(printedSize(box(40, 10), 10, false, 1, 3)).toBe(20)
    expect(printedSize(box(400, 200, 500), 12, false, 1, 3)).toBe(12)
  })
  it('auto-fit shrinks to the box but never grows', () => {
    expect(printedSize(box(400, 200), 10, true, 1, 3)).toBe(20)
    expect(printedSize(box(400, 20), 10, true, 1, 3)).toBe(15)
  })
})
