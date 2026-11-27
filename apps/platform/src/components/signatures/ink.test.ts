import { describe, expect, it } from 'vitest'

import { clearBackground, inkBounds } from './ink'

/** An RGBA image of `width` × `height` in one colour, with `ink` pixels painted dark. */
function image(width: number, height: number, paper: number, ink: [number, number][] = []) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let at = 0; at < data.length; at += 4) data.set([paper, paper, paper, 255], at)
  for (const [x, y] of ink) data.set([28, 42, 74, 255], (y * width + x) * 4)
  return data
}

describe('inkBounds', () => {
  it('ignores opaque white paper and finds the ink on it', () => {
    expect(
      inkBounds(
        image(10, 10, 255, [
          [3, 4],
          [6, 7],
        ]),
        10,
        10,
      ),
    ).toEqual({ x: 3, y: 4, w: 4, h: 4 })
  })

  it('finds nothing on blank paper', () => {
    expect(inkBounds(image(10, 10, 255), 10, 10)).toBeNull()
  })
})

describe('clearBackground', () => {
  it('makes grey paper transparent and keeps the ink', () => {
    const data = image(10, 10, 200, [[5, 5]])
    clearBackground(data, 10, 10)
    expect(data[3]).toBe(0)
    expect(data[(5 * 10 + 5) * 4 + 3]).toBe(255)
  })

  it('leaves an image whose border is dark (already transparent or a dark photo) as it is', () => {
    const data = image(4, 4, 0)
    clearBackground(data, 4, 4)
    expect(data[3]).toBe(255)
  })
})
