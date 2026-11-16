import { documentOutput, imageSize, isWholePicture, sizeProblem } from './logo-crop'

const png = (width: number, height: number) => {
  const bytes = new Uint8Array(24)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x89504e47)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return new Blob([bytes], { type: 'image/png' })
}

/** SOI, an APP0 segment, then a baseline start-of-frame. */
const jpeg = (width: number, height: number) => {
  const bytes = new Uint8Array(2 + 18 + 11)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 0xffd8)
  view.setUint16(2, 0xffe0)
  view.setUint16(4, 16)
  view.setUint16(20, 0xffc0)
  view.setUint16(22, 11)
  view.setUint16(25, height)
  view.setUint16(27, width)
  return new Blob([bytes], { type: 'image/jpeg' })
}

test('reads the size of a PNG or JPEG from its header, and nothing else', async () => {
  expect(await imageSize(png(4000, 1500))).toEqual({ width: 4000, height: 1500 })
  expect(await imageSize(jpeg(800, 300))).toEqual({ width: 800, height: 300 })
  expect(await imageSize(new Blob(['<svg/>']))).toBeNull()
  expect(await imageSize(new Blob([]))).toBeNull()
})

test.each([
  [0, 100, 'unreadable'],
  [100, 100, null],
  [7000, 5000, null],
  [9000, 9000, 'too-large'],
] as const)('a %i × %i picture: %s', (width, height, problem) =>
  expect(sizeProblem(width, height)).toBe(problem),
)

test('a document crop keeps its proportions, only shrinking to the long-side limit', () => {
  expect(documentOutput({ width: 600, height: 200 })).toMatchObject({
    width: 600,
    height: 200,
    canvasWidth: 600,
    canvasHeight: 200,
  })
  const big = documentOutput({ width: 8000, height: 2000 })
  expect(big).toMatchObject({ width: 4000, height: 1000 })
  expect(big.canvasWidth / big.canvasHeight).toBe(4)
})

test('a thin banner is padded to the 64 px minimum, centred, never clipped', () => {
  expect(documentOutput({ width: 1000, height: 20 })).toEqual({
    width: 1000,
    height: 20,
    canvasWidth: 1000,
    canvasHeight: 64,
    drawX: 0,
    drawY: 22,
  })
})

test('only a crop of the whole picture is sent as it was picked', () => {
  expect(isWholePicture({ x: 0, y: 0, width: 800, height: 300 }, 800, 300)).toBe(true)
  expect(isWholePicture({ x: 0.4, y: 0, width: 799.6, height: 300 }, 800, 300)).toBe(true)
  expect(isWholePicture({ x: 40, y: 0, width: 700, height: 300 }, 800, 300)).toBe(false)
})
