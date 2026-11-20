import { describe, expect, it } from 'vitest'

import { fitFontSize } from './fit-text'

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
