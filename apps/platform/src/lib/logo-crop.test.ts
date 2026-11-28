import {
  clampView,
  documentCanvas,
  documentDpi,
  documentPrintSize,
  DOCUMENT_LOGO_BOX_MM,
  documentRatio,
  imageSize,
  isWholePicture,
  normalizeLogo,
  placeOnCanvas,
  workspaceCropTooSmall,
  renderDocumentLogo,
  trimBox,
  sizeProblem,
  sniffFormat,
  svgSize,
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

test("the field has the picture's own shape between 1 : 1 and 5 : 1", () => {
  expect(documentRatio({ width: 1000, height: 400 })).toBe(2.5)
  expect(documentRatio({ width: 697, height: 143 })).toBeCloseTo(4.874, 3)
  expect(documentRatio({ width: 300, height: 400 })).toBe(1)
  expect(documentRatio({ width: 2000, height: 100 })).toBe(5)
})

test("the field holds the picture at its resolution, 108 – 640 px high, within the API's 64 – 4000 px", () => {
  expect(documentCanvas({ width: 1000, height: 400 })).toEqual({ width: 1000, height: 400 })
  // A wide wordmark keeps its shape: no strips above and below.
  expect(documentCanvas({ width: 1394, height: 286 })).toEqual({ width: 1394, height: 286 })
  // A portrait picture gets a square field, as tall as it is.
  expect(documentCanvas({ width: 300, height: 400 })).toEqual({ width: 400, height: 400 })
  // Wider than 5 : 1: the field is 5 : 1, as wide as the picture.
  expect(documentCanvas({ width: 1500, height: 100 })).toEqual({ width: 1500, height: 300 })
  // Never beyond 640 px high, and never below the 150 dpi of 18 mm.
  expect(documentCanvas({ width: 8000, height: 6000 })).toEqual({ width: 853, height: 640 })
  expect(documentCanvas({ width: 20, height: 10 })).toEqual({ width: 216, height: 108 })
  for (const [width, height] of [
    [333, 217],
    [1, 1],
    [3999, 17],
    [641, 1599],
    [4000, 800],
    [20, 4],
  ] as const) {
    const field = documentCanvas({ width, height })
    expect(field.width / field.height).toBeCloseTo(documentRatio({ width, height }), 2)
    expect(Math.min(field.width, field.height)).toBeGreaterThanOrEqual(108)
    expect(Math.max(field.width, field.height)).toBeLessThanOrEqual(3200)
    expect(field.height).toBeLessThanOrEqual(640)
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
  // In its square field, 3 × 4 field sides at zoom 4: it moves one side either way, one and a half up or down.
  expect(clamped.x).toBeCloseTo(1, 10)
  expect(clamped.y).toBeCloseTo(1.5, 10)
})

test('only a picture of the field shape, shown whole, is sent as it was picked', () => {
  expect(isWholePicture({ width: 1000, height: 400 }, WHOLE_PICTURE)).toBe(true)
  expect(isWholePicture({ width: 1100, height: 400 }, WHOLE_PICTURE)).toBe(true)
  expect(isWholePicture({ width: 500, height: 500 }, WHOLE_PICTURE)).toBe(true)
  expect(isWholePicture({ width: 1000, height: 200 }, WHOLE_PICTURE)).toBe(true)
  expect(isWholePicture({ width: 1100, height: 200 }, WHOLE_PICTURE)).toBe(false)
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

  test('draws the whole picture, uniformly, on an unfilled canvas of the nearest shape and encodes PNG', async () => {
    const blob = await renderDocumentLogo(
      {} as CanvasImageSource,
      { width: 300, height: 400 },
      WHOLE_PICTURE,
    )
    expect(blob?.type).toBe('image/png')
    // 400 × 400, the 300 × 400 picture centred at its own size; no white fill, so transparency stays.
    expect(draws).toEqual([[400, 400, 50, 0, 300, 400]])
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

const bytes = (values: number[], length = 64) => {
  const data = new Uint8Array(length)
  data.set(values)
  return new Blob([data])
}
const ascii = (text: string) => [...text].map((letter) => letter.charCodeAt(0))

const gif = (width: number, height: number) =>
  bytes([...ascii('GIF89a'), width & 255, width >> 8, height & 255, height >> 8])

/** RIFF, size, WEBP, then the chunk named `chunk` with its payload from byte 20. */
const webp = (chunk: string, payload: number[]) =>
  bytes([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), ...ascii(chunk), 0, 0, 0, 0, ...payload])

describe('what the bytes are', () => {
  test.each([
    ['png', png(10, 10)],
    ['jpeg', jpeg(10, 10)],
    ['gif', gif(10, 10)],
    ['webp', webp('VP8X', [])],
    ['svg', new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'])],
    [
      'svg',
      new Blob(['\uFEFF<?xml version="1.0"?>\n<!-- c -->\n<!DOCTYPE svg>\n<svg width="1"/>']),
    ],
    [null, new Blob(['<html><svg/></html>'])],
    [null, new Blob(['<!DOCTYPE svg [<!ENTITY a "b">]><svg/>'])],
    [null, new Blob(['RIFF....AVI '])],
    [null, new Blob([])],
  ] as const)('%s', async (format, blob) => expect(await sniffFormat(blob)).toBe(format))

  test('a name or type cannot make a picture of something else', async () => {
    expect(await sniffFormat(new File(['hello'], 'logo.png', { type: 'image/png' }))).toBeNull()
    expect(await sniffFormat(new File([png(5, 5)], 'logo.svg', { type: 'image/svg+xml' }))).toBe(
      'png',
    )
  })
})

test('reads the size of a GIF screen and of each kind of WebP from the header', async () => {
  expect(await imageSize(gif(300, 120))).toEqual({ width: 300, height: 120 })
  // VP8X: 24-bit canvas width − 1 and height − 1 from byte 24.
  const x = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  const vp8x = [...x.slice(0, 4), 0x2b, 0x01, 0, 0x63, 0, 0]
  expect(await imageSize(webp('VP8X', vp8x))).toEqual({ width: 300, height: 100 })
  // VP8 lossy: 14-bit sizes from byte 26, after the start code.
  const vp8 = [0, 0, 0, 0x9d, 0x01, 0x2a, 0x2c, 0x01, 0x64, 0]
  expect(await imageSize(webp('VP8 ', vp8))).toEqual({ width: 300, height: 100 })
  // VP8L lossless: signature, then 14 + 14 bits (each minus one).
  const bits = (299 | (99 << 14)) >>> 0
  const vp8l = [0x2f, bits & 255, (bits >> 8) & 255, (bits >> 16) & 255, (bits >> 24) & 255]
  expect(await imageSize(webp('VP8L', vp8l))).toEqual({ width: 300, height: 100 })
  expect(await imageSize(webp('ALPH', []))).toBeNull()
})

describe('svgSize', () => {
  test.each([
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"/>',
      { width: 120, height: 40 },
    ],
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="12.5px" height="5"/>',
      { width: 12.5, height: 5 },
    ],
    [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100"/>',
      { width: 300, height: 100 },
    ],
    // Relative lengths say nothing: the viewBox does.
    [
      '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0,0 20 10"/>',
      { width: 20, height: 10 },
    ],
    ['<svg xmlns="http://www.w3.org/2000/svg" width="0" height="10"/>', null],
    ['<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"/>', null],
    ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 -4 10"/>', null],
    ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1e999 10"/>', null],
    ['<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><g></svg>', null],
    ['<svg width="10" height="10" onload="alert(1)"', null],
    ['<html xmlns="http://www.w3.org/1999/xhtml"/>', null],
  ] as const)('%s', (text, size) => expect(svgSize(text)).toEqual(size))

  test('parsing it runs nothing and fetches nothing', () => {
    const fetched = vi.spyOn(globalThis, 'fetch')
    Object.assign(globalThis, { svgRan: false })
    const text =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10" onload="globalThis.svgRan = true"><script>globalThis.svgRan = true</script><image xlink:href="https://example.com/x.png"/><foreignObject><iframe src="https://example.com"/></foreignObject></svg>'
    expect(svgSize(text)).toEqual({ width: 10, height: 10 })
    expect(Reflect.get(globalThis, 'svgRan')).toBe(false)
    expect(fetched).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
})

test('a document logo needs 150 dpi at the size it occupies on the paper', () => {
  // 2.5 : 1 prints 45 × 18 mm: 1000 px across is 564 dpi; up to about 4 : 1 the 18 mm need 107 px.
  expect(documentDpi({ width: 1000, height: 400 }, WHOLE_PICTURE)).toBeCloseTo(564.4, 1)
  expect(documentDpi({ width: 266, height: 107 }, WHOLE_PICTURE)).toBeGreaterThanOrEqual(150)
  expect(documentDpi({ width: 260, height: 104 }, WHOLE_PICTURE)).toBeLessThan(150)
  expect(documentDpi({ width: 107, height: 107 }, WHOLE_PICTURE)).toBeGreaterThanOrEqual(150)
  // A 5 : 1 wordmark prints 75 mm wide, so it needs 443 px across.
  expect(documentDpi({ width: 443, height: 89 }, WHOLE_PICTURE)).toBeGreaterThanOrEqual(150)
  expect(documentDpi({ width: 440, height: 88 }, WHOLE_PICTURE)).toBeLessThan(150)
  // Wider still, it keeps its width in a thin strip of the 5 : 1 field: 270 × 27 is 91 dpi.
  expect(documentDpi({ width: 270, height: 27 }, WHOLE_PICTURE)).toBeCloseTo(91.4, 1)
  // Zooming in spreads the same pixels over more paper.
  expect(documentDpi({ width: 1000, height: 400 }, { zoom: 4, x: 0, y: 0 })).toBeCloseTo(141.1, 1)
})

describe('normalizeLogo', () => {
  test('hands a PNG or JPEG back as it is', async () => {
    const file = new File([png(10, 10)], 'a.png', { type: 'image/png' })
    expect(await normalizeLogo(file, 'png', { width: 10, height: 10 })).toEqual({
      file,
      vector: false,
    })
  })

  test.each([
    ['oversized', { width: 8000, height: 6000 }, { width: 8000, height: 6000 }],
    ['empty', { width: 0, height: 0 }, { width: 0, height: 0 }],
    ['not the size the header said', { width: 31, height: 12 }, { width: 30, height: 12 }],
  ])(
    'a decoded GIF that is %s is refused before any canvas, and its bitmap is closed',
    async (_, got, said) => {
      const close = vi.fn<() => void>()
      vi.stubGlobal(
        'createImageBitmap',
        vi.fn<() => Promise<unknown>>().mockResolvedValue({ ...got, close }),
      )
      const canvases = vi.spyOn(document, 'createElement')
      try {
        await expect(
          normalizeLogo(new File([gif(said.width, said.height)], 'a.gif'), 'gif', said),
        ).rejects.toThrow(/size its header says/)
        expect(close).toHaveBeenCalledOnce()
        expect(canvases).not.toHaveBeenCalledWith('canvas')
      } finally {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
      }
    },
  )

  test('a GIF or WebP becomes a PNG of the first frame the browser decodes, at its own size', async () => {
    const close = vi.fn<() => void>()
    const decode = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValue({ width: 30, height: 12, close })
    vi.stubGlobal('createImageBitmap', decode)
    const draws: number[][] = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      return {
        drawImage: (_: unknown, ...at: number[]) => draws.push([this.width, this.height, ...at]),
      } as unknown as CanvasRenderingContext2D
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done, type) =>
      done(new Blob(['png'], { type })),
    )
    try {
      const file = new File([gif(30, 12)], 'logo.final.gif', { type: 'image/gif' })
      const made = await normalizeLogo(file, 'gif', { width: 30, height: 12 })
      expect(made.vector).toBe(false)
      expect(made.file.name).toBe('logo.final.png')
      expect(made.file.type).toBe('image/png')
      expect(decode).toHaveBeenCalledWith(file)
      expect(draws).toEqual([[30, 12, 0, 0, 30, 12]])
      expect(close).toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      vi.restoreAllMocks()
    }
  })
})

const area = (width: number, height: number) => ({ x: 0, y: 0, width, height })

describe('workspaceCropTooSmall', () => {
  it.each([
    [400, 400],
    [512, 512],
    [128, 128],
    [1200, 200],
    [64, 64],
  ])('accepts a %i × %i crop', (width, height) => {
    expect(workspaceCropTooSmall(area(width, height))).toBe(false)
  })
  it.each([
    [63, 63],
    [2048, 51],
    [40, 400],
  ])('refuses a %i × %i crop', (width, height) => {
    expect(workspaceCropTooSmall(area(width, height))).toBe(true)
  })
})

/** A width × height picture of `fill`, with `paint` drawn over the pixels it covers. */
const pixels = (
  width: number,
  height: number,
  fill: number[],
  paint: { x: number; y: number; width: number; height: number; color: number[] }[] = [],
) => {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const spot = paint.findLast(
        (p) => x >= p.x && x < p.x + p.width && y >= p.y && y < p.y + p.height,
      )
      data.set(spot?.color ?? fill, (y * width + x) * 4)
    }
  return { data, width, height }
}
const white = [255, 255, 255, 255]
const clear = [0, 0, 0, 0]
const ink = [20, 40, 160, 255]

describe('trimBox', () => {
  test("cuts an even white margin, as an SVG's background rectangle leaves", () => {
    const picture = pixels(50, 20, white, [{ x: 6, y: 4, width: 30, height: 9, color: ink }])
    expect(trimBox(picture)).toEqual({ x: 6, y: 4, width: 30, height: 9 })
  })

  test('cuts a transparent margin whatever colour its clear pixels carry', () => {
    const picture = pixels(40, 30, clear, [
      { x: 0, y: 0, width: 40, height: 3, color: [255, 0, 0, 5] },
      { x: 10, y: 12, width: 5, height: 5, color: ink },
    ])
    expect(trimBox(picture)).toEqual({ x: 10, y: 12, width: 5, height: 5 })
  })

  test('a slightly uneven margin is still margin; a faint mark is not', () => {
    const off = [245, 250, 255, 255]
    const picture = pixels(30, 30, white, [
      { x: 0, y: 0, width: 30, height: 5, color: off },
      { x: 12, y: 10, width: 4, height: 4, color: [200, 200, 200, 255] },
    ])
    expect(trimBox(picture)).toEqual({ x: 12, y: 10, width: 4, height: 4 })
  })

  test.each([
    [
      'corners that differ',
      pixels(20, 20, white, [{ x: 19, y: 19, width: 1, height: 1, color: ink }]),
    ],
    ['nothing but margin', pixels(20, 20, white)],
    ['no margin at all', pixels(20, 20, ink)],
  ])('keeps the whole picture with %s', (_, picture) =>
    expect(trimBox(picture)).toEqual({ x: 0, y: 0, width: 20, height: 20 }),
  )
})

describe('normalizeLogo with trim', () => {
  let picture: ReturnType<typeof pixels>
  const draws: number[][] = []
  beforeEach(() => {
    draws.length = 0
    vi.stubGlobal(
      'createImageBitmap',
      vi
        .fn<() => Promise<unknown>>()
        .mockImplementation(() =>
          Promise.resolve({ width: picture.width, height: picture.height, close: () => undefined }),
        ),
    )
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      return {
        drawImage: (_: unknown, ...at: number[]) => draws.push([this.width, this.height, ...at]),
        getImageData: () => picture,
      } as unknown as CanvasRenderingContext2D
    })
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done, type) =>
      done(new Blob(['png'], { type })),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  test('a PNG without an even margin is handed back as it is', async () => {
    picture = pixels(40, 10, ink)
    const file = new File([png(40, 10)], 'a.png', { type: 'image/png' })
    expect(await normalizeLogo(file, 'png', { width: 40, height: 10 }, true)).toEqual({
      file,
      vector: false,
    })
  })

  test('a JPEG with a white margin becomes a PNG of the mark alone', async () => {
    picture = pixels(60, 20, white, [{ x: 5, y: 3, width: 50, height: 10, color: ink }])
    const file = new File([jpeg(60, 20)], 'logo.jpg', { type: 'image/jpeg' })
    const made = await normalizeLogo(file, 'jpeg', { width: 60, height: 20 }, true)
    expect(made.file).not.toBe(file)
    expect(made.file.name).toBe('logo.png')
    expect(draws.at(-1)).toEqual([50, 10, -5, -3, 60, 20])
  })

  test('a JPEG its EXIF turns is read with its sides swapped', async () => {
    picture = pixels(20, 60, ink)
    const file = new File([jpeg(60, 20)], 'logo.jpg', { type: 'image/jpeg' })
    expect((await normalizeLogo(file, 'jpeg', { width: 60, height: 20 }, true)).file).toBe(file)
  })
})

test('a field prints in the PDF box as large as it fits, never stretched', () => {
  // 75 × 18 mm at most: wide is held by the width, square and tall by the height.
  expect(documentPrintSize(5)).toEqual({ width: 75, height: 15 })
  expect(documentPrintSize(75 / 18)).toEqual({ width: 75, height: 18 })
  expect(documentPrintSize(2.5)).toEqual({ width: 45, height: 18 })
  expect(documentPrintSize(1)).toEqual({ width: 18, height: 18 })
  expect(DOCUMENT_LOGO_BOX_MM.width / DOCUMENT_LOGO_BOX_MM.height).toBeCloseTo(4.17, 2)
})
