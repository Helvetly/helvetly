import type { CropArea } from '@helvetly/ui/lib/photo'

// The two logos a workspace has. The workspace's own mark is a fixed square PNG that keeps its transparency; the
// document logo is a PNG whose field has the picture's own shape (between 1 : 1 and 5 : 1, at most 75 × 18 mm in the
// PDF), with any even margin around the picture trimmed first, the whole picture contained in it unless the person
// zooms in, so the preview is the file is the printed logo. PNG, JPEG, WebP, GIF (its first frame) and SVG can be
// picked; the last three are first turned into a static PNG here (normalizeLogo), so the editor, the preview and the
// saved file share one frozen picture. The API checks the bytes again (PNG or JPEG, at most 2 MiB, the short
// side at least 64 px and the long side at most 4000 px), so this only makes a pick fit and says why when it cannot.

export const WORKSPACE_LOGO_SIDE = 512
export const LOGO_MIN_SIDE = 64
export const LOGO_MAX_SIDE = 4000
export const LOGO_MAX_BYTES = 2 * 1024 * 1024
/** The most pixels a pick may have before the browser decodes it: a small file can still be a huge picture. */
export const LOGO_MAX_PIXELS = 40_000_000

export type LogoProblem = 'unreadable' | 'too-large' | 'too-small'

/**
 * The smallest crop of the picked picture a workspace mark is made from: the API's own floor. A mark is saved at
 * 512 px, so a smaller source is only upscaled; that is soft, not wrong, and only a tiny crop is refused.
 */
export const WORKSPACE_MIN_CROP = LOGO_MIN_SIDE
/** The least detail the printed document logo may have, at the size it occupies on the paper. */
export const DOCUMENT_MIN_DPI = 150
/** The longest side a picture without a size of its own (SVG) is drawn at. */
export const VECTOR_SIDE = 2048

export type LogoFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'svg'

// An XML declaration, comments and a DOCTYPE without an internal subset (so no entities) may precede the root.
const SVG_START =
  /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>[]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>/]/i

/** What the bytes are (never the name or the claimed type), or null when it is none of the pictures a logo can be. */
export async function sniffFormat(file: Blob): Promise<LogoFormat | null> {
  const bytes = new Uint8Array(await file.slice(0, 65_536).arrayBuffer())
  const view = new DataView(bytes.buffer)
  if (bytes.length >= 4 && view.getUint32(0) === 0x89504e47) return 'png'
  if (bytes.length >= 3 && view.getUint16(0) === 0xffd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes.length >= 6 && view.getUint32(0) === 0x47494638 && view.getUint8(5) === 0x61)
    return 'gif'
  if (bytes.length >= 12 && view.getUint32(0) === 0x52494646 && view.getUint32(8) === 0x57454250)
    return 'webp'
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '')
  return SVG_START.test(text) ? 'svg' : null
}

/**
 * The pixel size of a PNG, JPEG, GIF or WebP from its header alone (null for anything else, SVG included), so an
 * enormous picture is refused before it is decoded.
 */
export async function imageSize(file: Blob): Promise<{ width: number; height: number } | null> {
  const head = new DataView(await file.slice(0, 65_536).arrayBuffer())
  if (head.byteLength >= 24 && head.getUint32(0) === 0x89504e47)
    return { width: head.getUint32(16), height: head.getUint32(20) }
  // GIF: the logical screen, which every frame sits in.
  if (head.byteLength >= 10 && head.getUint32(0) === 0x47494638)
    return { width: head.getUint16(6, true), height: head.getUint16(8, true) }
  if (
    head.byteLength >= 30 &&
    head.getUint32(0) === 0x52494646 &&
    head.getUint32(8) === 0x57454250
  ) {
    const chunk = head.getUint32(12)
    const u24 = (at: number) => head.getUint16(at, true) + head.getUint8(at + 2) * 65_536
    if (chunk === 0x56503858) return { width: 1 + u24(24), height: 1 + u24(27) } // VP8X
    if (chunk === 0x56503820)
      return { width: head.getUint16(26, true) & 0x3fff, height: head.getUint16(28, true) & 0x3fff } // VP8
    if (chunk === 0x5650384c) {
      const bits = head.getUint32(21, true) // VP8L
      return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) }
    }
    return null
  }
  if (head.byteLength < 4 || head.getUint16(0) !== 0xffd8) return null
  for (let at = 2; at + 9 <= head.byteLength;) {
    if (head.getUint8(at) !== 0xff) return null
    const marker = head.getUint8(at + 1)
    // Start of frame (not the DHT, JPG or DAC markers that sit between them).
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
      return { height: head.getUint16(at + 5), width: head.getUint16(at + 7) }
    at += 2 + head.getUint16(at + 2)
  }
  return null
}

/** Why a picture of this size cannot be a logo as it is, or null. */
export function sizeProblem(width: number, height: number): LogoProblem | null {
  if (!width || !height) return 'unreadable'
  if (width * height > LOGO_MAX_PIXELS) return 'too-large'
  return null
}

export const DOCUMENT_MIN_ZOOM = 1
export const DOCUMENT_MAX_ZOOM = 4
// The narrowest and the widest field: a picture between them keeps its own shape, any other gets the nearest one.
const DOCUMENT_MIN_RATIO = 1
const DOCUMENT_MAX_RATIO = 5
/** The PDFs' logo box in mm (invoicepdf and engagementpdf logoMaxW, logoMaxH): the cropper and previews draw it. */
export const DOCUMENT_LOGO_BOX_MM = { width: 75, height: 18 }
// A newly rendered document logo is at most 640 px high (3200 px wide at 5 : 1, about 900 dpi in the field), and at
// least the 150 dpi its at most 18 mm need (107 px), so its short side is always above the API's 64 px. Older and
// untouched PNGs may be bigger (up to LOGO_MAX_SIDE).
const DOCUMENT_MAX_HEIGHT = 640
const DOCUMENT_MIN_HEIGHT = 108
// How far (per channel, of 255) a margin's pixel may be from the corner's colour and still be trimmed.
const TRIM_TOLERANCE = 16

type Size = { width: number; height: number }
/** How the picture sits in the field: `zoom` times the contained size, `x` and `y` the shift in field widths and heights. */
export type DocumentView = { zoom: number; x: number; y: number }
export const WHOLE_PICTURE: DocumentView = { zoom: 1, x: 0, y: 0 }

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))

/** The field's width : height for a picture: its own, kept between 1 : 1 and 5 : 1. */
export const documentRatio = ({ width, height }: Size) =>
  clamp(width / height, DOCUMENT_MIN_RATIO, DOCUMENT_MAX_RATIO)

/** The field the picture is saved in: just big enough for it at its own resolution, 108 – 640 px high. */
export function documentCanvas(natural: Size): Size {
  const ratio = documentRatio(natural)
  const height = Math.round(
    clamp(
      Math.max(natural.height, natural.width / ratio),
      DOCUMENT_MIN_HEIGHT,
      DOCUMENT_MAX_HEIGHT,
    ),
  )
  return { width: Math.round(height * ratio), height }
}

/** Where the picture sits in a field of `canvas`, in its pixels: uniform scale, and never panned out of reach. */
export function placeOnCanvas(natural: Size, view: DocumentView, canvas: Size) {
  const zoom = clamp(view.zoom, DOCUMENT_MIN_ZOOM, DOCUMENT_MAX_ZOOM)
  const scale = Math.min(canvas.width / natural.width, canvas.height / natural.height) * zoom
  const width = natural.width * scale
  const height = natural.height * scale
  // A picture smaller than the field stays inside it, a bigger one keeps covering it: no empty strip appears by panning.
  const reachX = Math.abs(canvas.width - width) / 2
  const reachY = Math.abs(canvas.height - height) / 2
  return {
    x: (canvas.width - width) / 2 + clamp(view.x * canvas.width, -reachX, reachX),
    y: (canvas.height - height) / 2 + clamp(view.y * canvas.height, -reachY, reachY),
    width,
    height,
  }
}

/** The view with its zoom and shift brought into range (the shift is the placement's, in field widths and heights). */
export function clampView(natural: Size, view: DocumentView): DocumentView {
  const field = { width: documentRatio(natural), height: 1 }
  const placed = placeOnCanvas(natural, view, field)
  return {
    zoom: clamp(view.zoom, DOCUMENT_MIN_ZOOM, DOCUMENT_MAX_ZOOM),
    x: (placed.x + placed.width / 2 - field.width / 2) / field.width,
    y: (placed.y + placed.height / 2 - field.height / 2) / field.height,
  }
}

/** Whether the picture is already the field's shape (within 1%) and shown whole, so it is sent as picked. */
export const isWholePicture = (natural: Size, view: DocumentView) =>
  Math.abs(natural.width / natural.height / documentRatio(natural) - 1) <= 0.01 &&
  view.zoom <= DOCUMENT_MIN_ZOOM &&
  view.x === 0 &&
  view.y === 0

/** The dots per inch the picture's own pixels print at, placed as `view` says in the field at its largest printed size. */
export function documentDpi(natural: Size, view: DocumentView) {
  const ratio = documentRatio(natural)
  const at = placeOnCanvas(natural, view, { width: ratio, height: 1 })
  return (natural.width * 25.4) / (at.width * documentPrintSize(ratio).height)
}

/** The size in mm a field of this width : height prints at where the text beside it leaves the widest box. */
export function documentPrintSize(ratio: number) {
  const { width, height } = DOCUMENT_LOGO_BOX_MM
  return { width: Math.min(width, height * ratio), height: Math.min(height, width / ratio) }
}

/** Whether the part chosen (in the picture's own pixels) is too small for a workspace mark. */
export const workspaceCropTooSmall = (area: CropArea) =>
  Math.min(area.width, area.height) < WORKSPACE_MIN_CROP

const encode = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The logo could not be encoded.'))),
      type,
      quality,
    ),
  )

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot crop the logo.')
  context.imageSmoothingQuality = 'high'
  return { canvas, context }
}

/** The workspace's mark: the cropped square as a 512 × 512 PNG, transparent where the picture is. */
export async function cropWorkspaceLogo(source: CanvasImageSource, area: CropArea) {
  const { canvas, context } = canvasOf(WORKSPACE_LOGO_SIDE, WORKSPACE_LOGO_SIDE)
  context.drawImage(
    source,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    WORKSPACE_LOGO_SIDE,
    WORKSPACE_LOGO_SIDE,
  )
  return encode(canvas, 'image/png')
}

/**
 * The document logo: the picture placed in its field exactly as the dialog shows it, as a PNG whose
 * transparency stays. The same view gives the same bytes in one browser. A result over 2 MiB is retried at a smaller
 * field; null when even that does not fit.
 */
export async function renderDocumentLogo(
  source: CanvasImageSource,
  natural: Size,
  view: DocumentView,
  shares: readonly number[] = [1, 0.75, 0.5],
): Promise<Blob | null> {
  const [share, ...smaller] = shares
  if (share === undefined) return null
  const height = Math.round(documentCanvas(natural).height * share)
  if (height < DOCUMENT_MIN_HEIGHT) return null
  const field = { width: Math.round(height * documentRatio(natural)), height }
  const { canvas, context } = canvasOf(field.width, field.height)
  const at = placeOnCanvas(natural, view, field)
  context.drawImage(source, at.x, at.y, at.width, at.height)
  const blob = await encode(canvas, 'image/png')
  // One size after another, never several at once: each canvas can be large.
  return blob.size <= LOGO_MAX_BYTES ? blob : renderDocumentLogo(source, natural, view, smaller)
}

const finitePositive = (w: number, h: number) =>
  Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0

/** The width and height an SVG declares (plain or px numbers, else its viewBox), or null when it has none to trust. */
export function svgSize(text: string): Size | null {
  // Parsed as data only: never inserted into the page, so nothing in it runs or loads.
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml')
  const root = doc.documentElement
  if (root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) return null
  const length = (name: string) => {
    const match = /^\s*(\d*\.?\d+(?:e[+-]?\d+)?)\s*(?:px)?\s*$/i.exec(root.getAttribute(name) ?? '')
    return match?.[1] ? Number(match[1]) : 0
  }
  const [width, height] = [length('width'), length('height')]
  if (finitePositive(width, height)) return { width, height }
  const box = (root.getAttribute('viewBox') ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  const [, , w = 0, h = 0] = box
  return box.length === 4 && finitePositive(w, h) ? { width: w, height: h } : null
}

type Box = { x: number; y: number; width: number; height: number }

/**
 * The part of the pixels inside an even margin: the run of rows and columns at the edges that are all the corners'
 * colour (or all transparent, when the corners are), within TRIM_TOLERANCE. The whole picture when its four corners
 * differ or it is nothing but margin.
 */
export function trimBox({
  data,
  width,
  height,
}: Pick<ImageData, 'data' | 'width' | 'height'>): Box {
  const whole = { x: 0, y: 0, width, height }
  const value = (i: number) => data[i] ?? 0
  const [r, g, b, a] = [value(0), value(1), value(2), value(3)]
  const clear = a <= TRIM_TOLERANCE
  const margin = (i: number) =>
    clear
      ? value(i + 3) <= TRIM_TOLERANCE
      : Math.abs(value(i) - r) <= TRIM_TOLERANCE &&
        Math.abs(value(i + 1) - g) <= TRIM_TOLERANCE &&
        Math.abs(value(i + 2) - b) <= TRIM_TOLERANCE &&
        Math.abs(value(i + 3) - a) <= TRIM_TOLERANCE
  const at = (x: number, y: number) => (y * width + x) * 4
  if (![at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)].every(margin)) return whole
  let [top, bottom, left, right] = [height, -1, width, -1]
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (!margin(at(x, y))) {
        top = Math.min(top, y)
        bottom = y
        left = Math.min(left, x)
        right = Math.max(right, x)
      }
  return bottom < 0 ? whole : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

const pngFile = async (canvas: HTMLCanvasElement, name: string) =>
  new File([await encode(canvas, 'image/png')], name.replace(/\.[^./\\]*$/, '') + '.png', {
    type: 'image/png',
  })

/**
 * A WebP, GIF or SVG as a static PNG (transparency kept); PNG and JPEG are returned as they are unless `trim` takes
 * something off them. A GIF or an animated WebP gives its first frame, as createImageBitmap does for a Blob; an SVG is
 * drawn once as an image (a context in which scripts and external loads are off) at VECTOR_SIDE on its longest side.
 * `trim` (the document logo) cuts an even margin off (trimBox); an SVG's mark is drawn again at VECTOR_SIDE then.
 * `vector` says the picture has no pixels of its own, so no resolution is lacking. The caller has checked the header
 * size against LOGO_MAX_PIXELS.
 */
export async function normalizeLogo(
  file: File,
  format: LogoFormat,
  size: Size,
  trim = false,
): Promise<{ file: File; vector: boolean }> {
  const asPicked = format === 'png' || format === 'jpeg'
  if (asPicked && !trim) return { file, vector: false }
  const vector = format === 'svg'
  const { source, width, height, done } = vector
    ? await drawnSvg(file, size)
    : await decoded(file, format, size)
  try {
    const { canvas, context } = canvasOf(width, height)
    context.drawImage(source, 0, 0, width, height)
    const box = trim
      ? trimBox(context.getImageData(0, 0, width, height))
      : { x: 0, y: 0, width, height }
    if (box.width === width && box.height === height) {
      return { file: asPicked ? file : await pngFile(canvas, file.name), vector }
    }
    // shortcut: an SVG's mark is redrawn at most 4 × larger, enough unless its margin is over three quarters of it.
    const scale = vector ? Math.min(VECTOR_SIDE / Math.max(box.width, box.height), 4) : 1
    const cut = canvasOf(Math.round(box.width * scale), Math.round(box.height * scale))
    cut.context.drawImage(source, -box.x * scale, -box.y * scale, width * scale, height * scale)
    return { file: await pngFile(cut.canvas, file.name), vector }
  } finally {
    done()
  }
}

/** A raster pick decoded (its first frame), once the decoder agrees with the header size the pick was admitted by. */
async function decoded(file: File, format: LogoFormat, size: Size) {
  const bitmap = await createImageBitmap(file)
  const { width, height } = bitmap
  // A JPEG turned by its EXIF orientation decodes with its sides swapped.
  const turned = format === 'jpeg' && width === size.height && height === size.width
  if (sizeProblem(width, height) || (!turned && (width !== size.width || height !== size.height))) {
    bitmap.close()
    throw new Error('The logo is not the size its header says.')
  }
  return { source: bitmap, width, height, done: () => bitmap.close() }
}

/** An SVG as an image VECTOR_SIDE on its longest side. */
async function drawnSvg(file: File, size: Size) {
  const scale = VECTOR_SIDE / Math.max(size.width, size.height)
  const width = Math.max(1, Math.round(size.width * scale))
  const height = Math.max(1, Math.round(size.height * scale))
  const url = URL.createObjectURL(new Blob([file], { type: 'image/svg+xml' }))
  const done = () => URL.revokeObjectURL(url)
  const image = new Image(width, height)
  image.src = url
  try {
    await image.decode()
  } catch (failure) {
    done()
    throw failure
  }
  // The URL lives until the drawing is done: a trimmed mark is drawn again at another size.
  return { source: image, width, height, done }
}
