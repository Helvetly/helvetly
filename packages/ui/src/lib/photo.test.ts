import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CROPPED_SIDE,
  type Painter,
  cropPhoto,
  fitWithin,
  paintCrop,
  photoProblem,
  shrinkPhoto,
} from './photo'

describe('fitWithin', () => {
  it.each([
    [2048, 1024, { width: 512, height: 256 }],
    [600, 1200, { width: 256, height: 512 }],
    [512, 512, { width: 512, height: 512 }],
    [80, 40, { width: 80, height: 40 }],
    [5000, 3, { width: 512, height: 1 }],
  ])('%i × %i', (width, height, want) => {
    expect(fitWithin(width, height)).toEqual(want)
  })
})

describe('photoProblem', () => {
  it('takes PNG, JPEG and WebP only', () => {
    expect(photoProblem(new File([''], 'a.png', { type: 'image/png' }))).toBeNull()
    expect(photoProblem(new File([''], 'a.jpg', { type: 'image/jpeg' }))).toBeNull()
    expect(photoProblem(new File([''], 'a.webp', { type: 'image/webp' }))).toBeNull()
    expect(photoProblem(new File([''], 'a.gif', { type: 'image/gif' }))).toMatch(
      /PNG, JPEG or WebP/,
    )
  })
})

describe('shrinkPhoto', () => {
  it('sends a file the browser cannot decode as it is', async () => {
    const file = new File(['not an image'], 'a.png', { type: 'image/png' })
    expect(await shrinkPhoto(file)).toBe(file)
  })
})

describe('paintCrop', () => {
  it('fills the 512 × 512 canvas with the cropped square, on white', () => {
    const fillRect = vi.fn<CanvasRenderingContext2D['fillRect']>()
    const drawImage = vi.fn<Painter['drawImage']>()
    const context: Painter = {
      fillStyle: '',
      imageSmoothingQuality: 'low',
      fillRect,
      drawImage,
    }
    const source = document.createElement('img')
    paintCrop(context, source, { x: 40, y: 10, width: 200, height: 200 })
    expect(context.fillStyle).toBe('white')
    expect(fillRect).toHaveBeenCalledWith(0, 0, CROPPED_SIDE, CROPPED_SIDE)
    expect(drawImage).toHaveBeenCalledWith(source, 40, 10, 200, 200, 0, 0, 512, 512)
    expect(context.imageSmoothingQuality).toBe('high')
  })
})

describe('cropPhoto', () => {
  afterEach(() => vi.restoreAllMocks())

  it('fails with a reason when the browser cannot draw', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    await expect(
      cropPhoto(document.createElement('img'), { x: 0, y: 0, width: 1, height: 1 }),
    ).rejects.toThrow('cannot crop')
  })
})
