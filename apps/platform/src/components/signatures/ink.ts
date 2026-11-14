// Turning a signature on a canvas into the PNG the API takes (≤ 2000 × 1000 px).

export const INK = '#1c2a4a'

/** The smallest box around pixels with any opacity (RGBA rows), or null when the canvas is blank. */
export function inkBounds(data: Uint8ClampedArray, width: number, height: number) {
  let top = height
  let left = width
  let right = -1
  let bottom = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) > 8) {
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
