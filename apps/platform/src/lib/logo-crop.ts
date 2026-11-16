import type { CropArea } from '@helvetly/ui/lib/photo'

// The two logos a workspace has. The workspace's own mark is a fixed square PNG that keeps its transparency; the
// document logo keeps its picture's proportions. The API checks the bytes again (PNG or JPEG, at most 2 MiB, the short
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

/**
 * The size a crop of `area` is saved at: scaled down (never up) so the long side is at most 4000 px, then padded
 * on the short axis when it would fall under 64 px, so a thin banner is kept whole instead of refused or clipped.
 */
export function documentOutput(area: Pick<CropArea, 'width' | 'height'>) {
  const scale = Math.min(1, LOGO_MAX_SIDE / Math.max(area.width, area.height))
  const width = Math.max(1, Math.round(area.width * scale))
  const height = Math.max(1, Math.round(area.height * scale))
  const canvasWidth = Math.max(width, LOGO_MIN_SIDE)
  const canvasHeight = Math.max(height, LOGO_MIN_SIDE)
  return {
    canvasWidth,
    canvasHeight,
    drawX: Math.round((canvasWidth - width) / 2),
    drawY: Math.round((canvasHeight - height) / 2),
    width,
    height,
  }
}

/** Whether the crop is the whole picture, which is then sent as it was picked (same bytes, so duplicates are found). */
export const isWholePicture = (area: CropArea, width: number, height: number) =>
  area.x <= 1 && area.y <= 1 && area.width >= width - 1 && area.height >= height - 1

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
 * The document logo's crop at its own proportions, as PNG when the pick was one (transparency stays) and JPEG on
 * white otherwise. A result over 2 MiB is retried smaller; null when even that does not fit.
 */
export async function cropDocumentLogo(source: CanvasImageSource, area: CropArea, type: string) {
  const out = documentOutput(area)
  const png = type === 'image/png'
  // One size after another, never several at once: each canvas can be large.
  const attempt = async (shares: readonly number[]): Promise<Blob | null> => {
    const [share, ...smaller] = shares
    if (share === undefined) return null
    const { canvas, context } = canvasOf(
      Math.max(1, Math.round(out.canvasWidth * share)),
      Math.max(1, Math.round(out.canvasHeight * share)),
    )
    if (!png) {
      context.fillStyle = 'white'
      context.fillRect(0, 0, canvas.width, canvas.height)
    }
    context.drawImage(
      source,
      area.x,
      area.y,
      area.width,
      area.height,
      Math.round(out.drawX * share),
      Math.round(out.drawY * share),
      Math.max(1, Math.round(out.width * share)),
      Math.max(1, Math.round(out.height * share)),
    )
    const blob = await encode(canvas, png ? 'image/png' : 'image/jpeg', 0.92)
    return blob.size <= LOGO_MAX_BYTES && Math.min(canvas.width, canvas.height) >= LOGO_MIN_SIDE
      ? blob
      : attempt(smaller)
  }
  return attempt([1, 0.75, 0.5])
}
