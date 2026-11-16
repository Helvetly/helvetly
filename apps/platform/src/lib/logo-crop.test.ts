import {
  clampView,
  documentCanvas,
  imageSize,
  isWholePicture,
  placeOnCanvas,
  renderDocumentLogo,
  sizeProblem,
  WHOLE_PICTURE,
} from './logo-crop'

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

test('the document field is exactly 2.5 : 1, holds the picture at its resolution and stays within 64–4000 px', () => {
  expect(documentCanvas({ width: 1000, height: 400 })).toEqual({ width: 1000, height: 400 })
  // A portrait picture needs the field as tall as it is.
  expect(documentCanvas({ width: 300, height: 400 })).toEqual({ width: 1000, height: 400 })
  // A wordmark wider than the field needs it wider.
  expect(documentCanvas({ width: 2000, height: 100 })).toEqual({ width: 2000, height: 800 })
  expect(documentCanvas({ width: 8000, height: 6000 })).toEqual({ width: 4000, height: 1600 })
  expect(documentCanvas({ width: 20, height: 10 })).toEqual({ width: 160, height: 64 })
  for (const [width, height] of [
    [333, 217],
    [1, 1],
    [3999, 17],
    [641, 1599],
  ] as const) {
    const field = documentCanvas({ width, height })
    expect(field.width / field.height).toBe(2.5)
    expect(Math.min(field.width, field.height)).toBeGreaterThanOrEqual(64)
    expect(Math.max(field.width, field.height)).toBeLessThanOrEqual(4000)
  }
})

test.each([
  ['portrait', { width: 300, height: 400 }],
  ['wide', { width: 2000, height: 100 }],
  ['square', { width: 500, height: 500 }],
  ['exact', { width: 1000, height: 400 }],
] as const)('a %s picture is placed uniformly, centred and whole at first', (_, natural) => {
  const field = { width: 1000, height: 400 }
  const at = placeOnCanvas(natural, WHOLE_PICTURE, field)
  expect(at.width / at.height).toBeCloseTo(natural.width / natural.height, 10)
  expect(at.width).toBeLessThanOrEqual(field.width + 1e-9)
  expect(at.height).toBeLessThanOrEqual(field.height + 1e-9)
  expect(at.x + at.width / 2).toBeCloseTo(field.width / 2, 10)
  expect(at.y + at.height / 2).toBeCloseTo(field.height / 2, 10)
})

test('placement is the same fraction of the field at any field size', () => {
  const natural = { width: 300, height: 400 }
  const view = { zoom: 2, x: 0.1, y: -0.05 }
  const small = placeOnCanvas(natural, view, { width: 250, height: 100 })
  const large = placeOnCanvas(natural, view, { width: 1000, height: 400 })
  for (const key of ['x', 'y', 'width', 'height'] as const)
    expect(large[key]).toBeCloseTo(small[key] * 4, 8)
})

test('zoom is limited to 1–4 and panning cannot lose the picture or open an empty strip', () => {
  const natural = { width: 300, height: 400 }
  const field = { width: 1000, height: 400 }
  expect(placeOnCanvas(natural, { zoom: 9, x: 0, y: 0 }, field).width).toBe(300 * 4)
  expect(placeOnCanvas(natural, { zoom: 0.2, x: 0, y: 0 }, field).width).toBe(300)
  // Smaller than the field: it can move to either edge, no further.
  const left = placeOnCanvas(natural, { zoom: 1, x: -5, y: 0 }, field)
  expect(left.x).toBe(0)
  expect(placeOnCanvas(natural, { zoom: 1, x: 5, y: 0 }, field).x + left.width).toBe(1000)
  // Zoomed past the field it keeps covering it (here 900 wide, so it still moves inside the 1000, but 1200 high).
  expect(placeOnCanvas(natural, { zoom: 3, x: 9, y: 9 }, field)).toMatchObject({ x: 100, y: 0 })
  expect(placeOnCanvas(natural, { zoom: 3, x: -9, y: -9 }, field)).toMatchObject({ x: 0, y: -800 })
  const clamped = clampView(natural, { zoom: 9, x: 9, y: 9 })
  expect(clamped.zoom).toBe(4)
  expect(clamped.x).toBeCloseTo(0.1, 10)
  expect(clamped.y).toBeCloseTo(1.5, 10)
})

test('only a picture of the field shape, shown whole, is sent as it was picked', () => {
  expect(isWholePicture({ width: 1000, height: 400 }, WHOLE_PICTURE)).toBe(true)
  expect(isWholePicture({ width: 1004, height: 400 }, WHOLE_PICTURE)).toBe(true)
  expect(isWholePicture({ width: 1100, height: 400 }, WHOLE_PICTURE)).toBe(false)
  expect(isWholePicture({ width: 300, height: 400 }, WHOLE_PICTURE)).toBe(false)
  expect(isWholePicture({ width: 1000, height: 400 }, { zoom: 1.1, x: 0, y: 0 })).toBe(false)
  expect(isWholePicture({ width: 1000, height: 400 }, { zoom: 1, x: 0.01, y: 0 })).toBe(false)
})

describe('renderDocumentLogo', () => {
  const draws: number[][] = []
  const fills = vi.fn<() => void>()
  let sizes: number[] = []

  beforeEach(() => {
    draws.length = 0
    sizes = []
    fills.mockClear()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      return {
        drawImage: (_: unknown, ...at: number[]) => draws.push([this.width, this.height, ...at]),
        fillRect: fills,
      } as unknown as CanvasRenderingContext2D
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      done,
      type,
    ) {
      done(new Blob([new Uint8Array(sizes.shift() ?? 10)], { type }))
    })
  })
  afterEach(() => vi.restoreAllMocks())

  test('draws the whole picture, uniformly, on an unfilled 2.5 : 1 canvas and encodes PNG', async () => {
    const blob = await renderDocumentLogo(
      {} as CanvasImageSource,
      { width: 300, height: 400 },
      WHOLE_PICTURE,
    )
    expect(blob?.type).toBe('image/png')
    // 1000 × 400, the 300 × 400 picture centred at its own size; no white fill, so transparency stays.
    expect(draws).toEqual([[1000, 400, 350, 0, 300, 400]])
    expect(fills).not.toHaveBeenCalled()
  })

  test('the same framing gives the same canvas and placement every time', async () => {
    const view = { zoom: 2, x: 0.05, y: 0 }
    await renderDocumentLogo({} as CanvasImageSource, { width: 640, height: 300 }, view)
    await renderDocumentLogo({} as CanvasImageSource, { width: 640, height: 300 }, view)
    expect(draws[0]).toEqual(draws[1])
  })

  test('an oversize result is retried on a smaller field, and gives up with null', async () => {
    const big = 3 * 1024 * 1024
    sizes = [big, 10]
    await renderDocumentLogo({} as CanvasImageSource, { width: 1000, height: 400 }, WHOLE_PICTURE)
    expect(draws.map(([width, height]) => [width, height])).toEqual([
      [1000, 400],
      [750, 300],
    ])
    draws.length = 0
    sizes = [big, big, big]
    expect(
      await renderDocumentLogo(
        {} as CanvasImageSource,
        { width: 1000, height: 400 },
        WHOLE_PICTURE,
      ),
    ).toBeNull()
    expect(draws).toHaveLength(3)
  })
})
