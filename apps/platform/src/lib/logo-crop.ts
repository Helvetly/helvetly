import type { CropArea } from '@helvetly/ui/lib/photo'

// The two logos a workspace has. The workspace's own mark is a fixed square PNG that keeps its transparency; the
// document logo is a PNG in the PDF's own 2.5 : 1 field (45 × 18 mm), the whole picture contained in it unless the
// person zooms in, so the preview is the file is the printed logo. PNG, JPEG, WebP, GIF (its first frame) and SVG can be
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

/** The PDF's logo field is 45 × 18 mm (apps/api/internal/invoicepdf), and the saved file has exactly that shape. */
export const DOCUMENT_LOGO_RATIO = 45 / 18
export const DOCUMENT_MIN_ZOOM = 1
export const DOCUMENT_MAX_ZOOM = 4
// A newly rendered document logo is at most 1600 × 640 px (about 900 dpi in the field), and at least the 150 dpi
// the field needs (45 mm → 266 px) in even pixels. Older and untouched PNGs may be bigger (up to LOGO_MAX_SIDE).
const DOCUMENT_MAX_HEIGHT = 640
const DOCUMENT_MIN_HEIGHT = 108
const DOCUMENT_FIELD_MM = 45

type Size = { width: number; height: number }
/** How the picture sits in the field: `zoom` times the contained size, `x` and `y` the shift in field widths and heights. */
export type DocumentView = { zoom: number; x: number; y: number }
export const WHOLE_PICTURE: DocumentView = { zoom: 1, x: 0, y: 0 }

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
// An even height keeps the width an exact 2.5 × it.
const evenHeight = (height: number) => 2 * Math.round(height / 2)

/** The field the picture is saved in: just big enough for it at its own resolution, within 270 × 108 – 1600 × 640 px. */
export function documentCanvas({ width, height }: Size): Size {
  const h = evenHeight(
    clamp(Math.max(height, width / DOCUMENT_LOGO_RATIO), DOCUMENT_MIN_HEIGHT, DOCUMENT_MAX_HEIGHT),
  )
  return { width: h * DOCUMENT_LOGO_RATIO, height: h }
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
  const field = { width: DOCUMENT_LOGO_RATIO, height: 1 }
  const placed = placeOnCanvas(natural, view, field)
  return {
    zoom: clamp(view.zoom, DOCUMENT_MIN_ZOOM, DOCUMENT_MAX_ZOOM),
    x: (placed.x + placed.width / 2 - field.width / 2) / field.width,
    y: (placed.y + placed.height / 2 - field.height / 2) / field.height,
  }
}

/** Whether the picture is already the field's shape (within 1%) and shown whole, so it is sent as picked. */
export const isWholePicture = (natural: Size, view: DocumentView) =>
  Math.abs(natural.width / natural.height / DOCUMENT_LOGO_RATIO - 1) <= 0.01 &&
  view.zoom <= DOCUMENT_MIN_ZOOM &&
  view.x === 0 &&
  view.y === 0

/** The dots per inch the picture's own pixels print at, placed as `view` says in the 45 mm wide field. */
export function documentDpi(natural: Size, view: DocumentView) {
  const at = placeOnCanvas(natural, view, { width: DOCUMENT_LOGO_RATIO, height: 1 })
  return (natural.width * 25.4) / ((at.width * DOCUMENT_FIELD_MM) / DOCUMENT_LOGO_RATIO)
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
 * The document logo: the picture placed in its 2.5 : 1 field exactly as the dialog shows it, as a PNG whose
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
  const height = evenHeight(documentCanvas(natural).height * share)
  if (height < DOCUMENT_MIN_HEIGHT) return null
  const field = { width: height * DOCUMENT_LOGO_RATIO, height }
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

async function pngOf(source: CanvasImageSource, width: number, height: number, name: string) {
  const { canvas, context } = canvasOf(width, height)
  context.drawImage(source, 0, 0, width, height)
  return new File([await encode(canvas, 'image/png')], name.replace(/\.[^./\\]*$/, '') + '.png', {
    type: 'image/png',
  })
}

/**
 * A WebP, GIF or SVG as a static PNG (transparency kept); PNG and JPEG are returned as they are. A GIF or an animated
 * WebP gives its first frame, as createImageBitmap does for a Blob; an SVG is drawn once as an image (a context in
 * which scripts and external loads are off) at VECTOR_SIDE on its longest side. `vector` says the picture has no pixels
 * of its own, so no resolution is lacking. The caller has checked the header size against LOGO_MAX_PIXELS.
 */
export async function normalizeLogo(
  file: File,
  format: LogoFormat,
  size: Size,
): Promise<{ file: File; vector: boolean }> {
  if (format === 'png' || format === 'jpeg') return { file, vector: false }
  if (format !== 'svg') {
    const bitmap = await createImageBitmap(file)
    try {
      // The header size was trusted to admit the pick; the decoder must agree before a second canvas is allocated.
      const { width, height } = bitmap
      if (sizeProblem(width, height) || width !== size.width || height !== size.height)
        throw new Error('The logo is not the size its header says.')
      return { file: await pngOf(bitmap, width, height, file.name), vector: false }
    } finally {
      bitmap.close()
    }
  }
  const scale = VECTOR_SIDE / Math.max(size.width, size.height)
  const width = Math.max(1, Math.round(size.width * scale))
  const height = Math.max(1, Math.round(size.height * scale))
  const url = URL.createObjectURL(new Blob([file], { type: 'image/svg+xml' }))
  try {
    const image = new Image(width, height)
    image.src = url
    await image.decode()
    return { file: await pngOf(image, width, height, file.name), vector: true }
  } finally {
    URL.revokeObjectURL(url)
  }
}
