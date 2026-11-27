// Turning a signature on a canvas into the PNG the API takes (≤ 2000 × 1000 px).

export const INK = '#1c2a4a'

/** Whether an RGBA pixel is ink: visible, and not (near) white paper. */
const isInk = (data: Uint8ClampedArray, at: number) =>
  (data[at + 3] ?? 0) > 8 && Math.min(data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0) < 235

/** The smallest box around ink (RGBA rows), or null when the canvas holds none. */
export function inkBounds(data: Uint8ClampedArray, width: number, height: number) {
  let top = height
  let left = width
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isInk(data, (y * width + x) * 4)) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
  }
  return right < 0 ? null : { x: left, y: top, w: right - left + 1, h: bottom - top + 1 }
}

/** The canvas cropped to its ink (with a little air), scaled down to fit the API's limits. */
export function trimmedPng(canvas: HTMLCanvasElement, maxW = 2000, maxH = 1000) {
  const context = canvas.getContext('2d')
  if (!context) return null
  const box = inkBounds(
    context.getImageData(0, 0, canvas.width, canvas.height).data,
    canvas.width,
    canvas.height,
  )
  if (!box) return null
  const pad = Math.round(Math.max(box.w, box.h) * 0.04) + 4
  const scale = Math.min(1, maxW / (box.w + pad * 2), maxH / (box.h + pad * 2))
  const out = document.createElement('canvas')
  out.width = Math.round((box.w + pad * 2) * scale)
  out.height = Math.round((box.h + pad * 2) * scale)
  out
    .getContext('2d')
    ?.drawImage(
      canvas,
      box.x - pad,
      box.y - pad,
      box.w + pad * 2,
      box.h + pad * 2,
      0,
      0,
      out.width,
      out.height,
    )
  return out.toDataURL('image/png')
}

/** A typed name in a script font, as a PNG data URL (after the font has loaded). */
export async function typedPng(name: string, fontFamily: string) {
  const size = 140
  await document.fonts.load(`${size}px ${fontFamily}`, name)
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return null
  context.font = `${size}px ${fontFamily}`
  canvas.width = Math.min(1900, Math.ceil(context.measureText(name).width + size))
  canvas.height = Math.round(size * 1.8)
  context.font = `${size}px ${fontFamily}`
  context.fillStyle = INK
  context.textBaseline = 'middle'
  context.fillText(name, size / 2, canvas.height / 2, canvas.width - size)
  return trimmedPng(canvas)
}

/** Upload limits: a picked file's types and size, and the PNG the API takes (≤ 300 KB, so a margin). */
export const UPLOAD_TYPES = ['image/png', 'image/jpeg', 'image/webp']
export const UPLOAD_MAX_BYTES = 5 << 20
const PNG_MAX_BYTES = 280 << 10

/**
 * Makes the paper behind the ink transparent (RGBA rows, in place). The paper's brightness is the median of the
 * border's pixels, so a grey photo of a page clears as well as a white scan; pixels a little darker fade out.
 */
export function clearBackground(data: Uint8ClampedArray, width: number, height: number) {
  const light = (at: number) => Math.min(data[at] ?? 0, data[at + 1] ?? 0, data[at + 2] ?? 0)
  const border: number[] = []
  for (let x = 0; x < width; x++) border.push(light(x * 4), light(((height - 1) * width + x) * 4))
  for (let y = 0; y < height; y++)
    border.push(light(y * width * 4), light((y * width + width - 1) * 4))
  border.sort((a, b) => a - b)
  const paper = border[Math.floor(border.length / 2)] ?? 255
  // Too dark to be paper (a dark photo or an image already on transparency): leave it as it is.
  if (paper < 120) return
  const clear = paper - 18
  const solid = paper - 80
  for (let at = 0; at < data.length; at += 4) {
    const value = light(at)
    if (value >= clear) data[at + 3] = 0
    else if (value > solid)
      data[at + 3] = Math.round(((data[at + 3] ?? 0) * (clear - value)) / (clear - solid))
  }
}

/**
 * An image of a signature (a picked file, the saved one) as the PNG the API takes: optionally on transparency,
 * cropped to its ink and small enough. Null when the browser cannot read it or it holds no ink.
 */
export async function uploadedPng(image: Blob, transparent: boolean) {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(image)
  } catch {
    return null
  }
  const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  if (transparent) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
    clearBackground(pixels.data, canvas.width, canvas.height)
    context.putImageData(pixels, 0, 0)
  }
  // A photo's PNG can be large: smaller until it fits the API's limit.
  for (const [maxW, maxH] of [
    [1600, 800],
    [1000, 500],
    [640, 320],
  ] as const) {
    const png = trimmedPng(canvas, maxW, maxH)
    if (!png || png.length * 0.75 <= PNG_MAX_BYTES) return png
  }
  return null
}
