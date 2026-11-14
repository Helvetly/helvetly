// A person's photo (the portal login's and the staff account's) is shrunk in the browser before upload
// (docs/portal-contract.md "Photo (avatar)", docs/auth-contract.md "Photo"). The API stores PNG or JPEG; a WebP
// pick is re-encoded here.
const SENT_TYPES = ['image/png', 'image/jpeg']
export const PHOTO_TYPES = [...SENT_TYPES, 'image/webp']
const MAX_SIDE = 512
const MAX_BYTES = 1 << 20

/** What is wrong with a picked file before anything is sent, or null. */
export const photoProblem = (file: File) =>
  PHOTO_TYPES.includes(file.type) ? null : 'Upload the photo as a PNG, JPEG or WebP image.'

/** The size that fits `max` on each side at the same proportions; never larger than the original. */
export function fitWithin(width: number, height: number, max = MAX_SIDE) {
  const scale = Math.min(1, max / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

const encode = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The photo could not be encoded.'))),
      type,
      0.9,
    ),
  )

/**
 * The photo at most 512 px a side, as PNG or JPEG. A file the browser cannot decode, or a PNG or JPEG small enough
 * already, is sent as it is, so the API's check of the bytes answers for it.
 */
export async function shrinkPhoto(file: File): Promise<Blob> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return file
  }
  const size = fitWithin(bitmap.width, bitmap.height)
  const fits =
    size.width === bitmap.width && size.height === bitmap.height && file.size <= MAX_BYTES
  if (fits && SENT_TYPES.includes(file.type)) {
    bitmap.close()
    return file
  }
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot resize the photo.')
  context.drawImage(bitmap, 0, 0, size.width, size.height)
  bitmap.close()
  // PNG and WebP may carry transparency: keep it as PNG while that stays small.
  const png = file.type === 'image/jpeg' ? null : await encode(canvas, 'image/png')
  // A busy PNG can stay above 1 MB even at 512 px; JPEG keeps it small.
  return png && png.size <= MAX_BYTES ? png : encode(canvas, 'image/jpeg')
}

/** A crop of a picture in its own pixels, as the cropper reports it. */
export type CropArea = { x: number; y: number; width: number; height: number }

export const CROPPED_SIDE = 512

/**
 * The cropped square of a picture, scaled to 512 × 512 and encoded as JPEG: the API stores PNG or JPEG, and a
 * photo this size stays well under its 1 MB limit. Transparency is filled white rather than JPEG's black.
 */
export async function cropPhoto(source: CanvasImageSource, area: CropArea): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = CROPPED_SIDE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot crop the photo.')
  paintCrop(context, source, area)
  return encode(canvas, 'image/jpeg')
}

/** The part of a 2D context a crop paints with. */
export type Painter = Pick<
  CanvasRenderingContext2D,
  'fillStyle' | 'fillRect' | 'imageSmoothingQuality'
> & {
  drawImage(
    image: CanvasImageSource,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void
}

/** Paints the cropped square of `source` over the whole 512 × 512 canvas, on white. */
export function paintCrop(context: Painter, source: CanvasImageSource, area: CropArea) {
  context.fillStyle = 'white'
  context.fillRect(0, 0, CROPPED_SIDE, CROPPED_SIDE)
  context.imageSmoothingQuality = 'high'
  context.drawImage(
    source,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    CROPPED_SIDE,
    CROPPED_SIDE,
  )
}
