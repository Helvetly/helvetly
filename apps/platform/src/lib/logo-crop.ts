import type { CropArea } from '@helvetly/ui/lib/photo'

// The two logos a workspace has. The workspace's own mark is a fixed square PNG that keeps its transparency; the
// document logo is a PNG in the PDF's own 2.5 : 1 field (45 × 18 mm), the whole picture contained in it unless the
// person zooms in, so the preview is the file is the printed logo. The API checks the bytes again (PNG or JPEG, at most 2 MiB, the short
// side at least 64 px and the long side at most 4000 px), so this only makes a pick fit and says why when it cannot.

export const WORKSPACE_LOGO_SIDE = 512
export const LOGO_MIN_SIDE = 64
export const LOGO_MAX_SIDE = 4000
export const LOGO_MAX_BYTES = 2 * 1024 * 1024
/** The most pixels a pick may have before the browser decodes it: a small file can still be a huge picture. */
export const LOGO_MAX_PIXELS = 40_000_000

export type LogoProblem = 'unreadable' | 'too-large' | 'too-small'

/**
 * The pixel size of a PNG or JPEG from its header alone (null for anything else), so an enormous picture is
 * refused before it is decoded.
 */
export async function imageSize(file: Blob): Promise<{ width: number; height: number } | null> {
  const head = new DataView(await file.slice(0, 65_536).arrayBuffer())
  if (head.byteLength >= 24 && head.getUint32(0) === 0x89504e47)
    return { width: head.getUint32(16), height: head.getUint32(20) }
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
const DOCUMENT_MAX_HEIGHT = LOGO_MAX_SIDE / DOCUMENT_LOGO_RATIO

type Size = { width: number; height: number }
/** How the picture sits in the field: `zoom` times the contained size, `x` and `y` the shift in field widths and heights. */
export type DocumentView = { zoom: number; x: number; y: number }
export const WHOLE_PICTURE: DocumentView = { zoom: 1, x: 0, y: 0 }

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
// An even height keeps the width an exact 2.5 × it.
const evenHeight = (height: number) => 2 * Math.round(height / 2)

/** The field the picture is saved in: just big enough for it at its own resolution, within 64–4000 px. */
export function documentCanvas({ width, height }: Size): Size {
  const h = evenHeight(
    clamp(Math.max(height, width / DOCUMENT_LOGO_RATIO), LOGO_MIN_SIDE, DOCUMENT_MAX_HEIGHT),
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
  if (height < LOGO_MIN_SIDE) return null
  const field = { width: height * DOCUMENT_LOGO_RATIO, height }
  const { canvas, context } = canvasOf(field.width, field.height)
  const at = placeOnCanvas(natural, view, field)
  context.drawImage(source, at.x, at.y, at.width, at.height)
  const blob = await encode(canvas, 'image/png')
  // One size after another, never several at once: each canvas can be large.
  return blob.size <= LOGO_MAX_BYTES ? blob : renderDocumentLogo(source, natural, view, smaller)
}
