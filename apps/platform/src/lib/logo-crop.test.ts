import {
  clampView,
  documentCanvas,
  documentDpi,
  imageSize,
  isWholePicture,
  normalizeLogo,
  placeOnCanvas,
  renderDocumentLogo,
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

test('the document field is exactly 2.5 : 1, holds the picture at its resolution and stays within 270 × 108 – 1600 × 640 px', () => {
  expect(documentCanvas({ width: 1000, height: 400 })).toEqual({ width: 1000, height: 400 })
  // A portrait picture needs the field as tall as it is.
  expect(documentCanvas({ width: 300, height: 400 })).toEqual({ width: 1000, height: 400 })
  // A wordmark wider than the field needs it wider.
  expect(documentCanvas({ width: 1500, height: 100 })).toEqual({ width: 1500, height: 600 })
  // Never beyond what a printed 45 × 18 mm needs, and never below its 150 dpi.
  expect(documentCanvas({ width: 8000, height: 6000 })).toEqual({ width: 1600, height: 640 })
  expect(documentCanvas({ width: 20, height: 10 })).toEqual({ width: 270, height: 108 })
  for (const [width, height] of [
    [333, 217],
    [1, 1],
    [3999, 17],
    [641, 1599],
  ] as const) {
    const field = documentCanvas({ width, height })
    expect(field.width / field.height).toBe(2.5)
    expect(field.height).toBeGreaterThanOrEqual(108)
    expect(field.width).toBeLessThanOrEqual(1600)
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
  // 45 mm across 1000 px is 564 dpi; 266 px is the least.
  expect(documentDpi({ width: 1000, height: 400 }, WHOLE_PICTURE)).toBeCloseTo(564.4, 1)
  expect(documentDpi({ width: 266, height: 106 }, WHOLE_PICTURE)).toBeGreaterThanOrEqual(150)
  expect(documentDpi({ width: 260, height: 104 }, WHOLE_PICTURE)).toBeLessThan(150)
  // A narrow wordmark occupies a thin strip of the field but keeps its own width: 270 × 27 is 152 dpi.
  expect(documentDpi({ width: 270, height: 27 }, WHOLE_PICTURE)).toBeCloseTo(152.4, 1)
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
