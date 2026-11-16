import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { normalizeLogo } from '@/lib/logo-crop'

import { LogoCropDialog, prepareLogo } from './logo-crop'

/** A real PNG of the given size: a wordmark-like bar, on a transparent background when `clear`. */
async function picture(width: number, height: number, clear = true) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no canvas')
  if (!clear) {
    context.fillStyle = 'white'
    context.fillRect(0, 0, width, height)
  }
  context.fillStyle = '#c0392b'
  context.fillRect(0, 0, Math.min(width, height) / 2, Math.min(width, height) / 2)
  context.fillStyle = '#1f2937'
  context.fillRect(width * 0.1, height * 0.6, width * 0.8, height * 0.15)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('no png')
  return new File([blob], 'logo.png', { type: 'image/png' })
}

/**
 * A 600 × 400 JPEG of a disc and a corner mark whose EXIF orientation is `turn` (6 or 8), so browsers show it
 * 400 × 600. The EXIF segment is spliced in after the JPEG's start marker.
 */
async function turnedJpeg(turn: 6 | 8, width = 600, height = 400) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no canvas')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#0000ff'
  context.fillRect(0, 0, 60, 60)
  context.fillStyle = '#ff00ff'
  context.beginPath()
  context.arc(width / 2, height / 2, 100, 0, Math.PI * 2)
  context.fill()
  const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 1))
  if (!jpeg) throw new Error('no jpeg')
  const exif = new Uint8Array([
    0xff,
    0xe1,
    0x00,
    0x22,
    0x45,
    0x78,
    0x69,
    0x66,
    0x00,
    0x00,
    0x4d,
    0x4d,
    0x00,
    0x2a,
    0x00,
    0x00,
    0x00,
    0x08,
    0x00,
    0x01,
    0x01,
    0x12,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00,
    turn,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ])
  const bytes = new Uint8Array(await jpeg.arrayBuffer())
  return new File([bytes.slice(0, 2), exif, bytes.slice(2)], 'turned.jpg', { type: 'image/jpeg' })
}

/** The width and height of the magenta pixels of a PNG: a disc must stay round. */
async function discSize(blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no canvas')
  context.drawImage(bitmap, 0, 0)
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)
  let [left, top, right, bottom] = [width, height, -1, -1]
  for (let y = 0; y < height; y += 1)
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4
      if (data[at]! > 200 && data[at + 1]! < 60 && data[at + 2]! > 200 && data[at + 3]! > 200) {
        left = Math.min(left, x)
        right = Math.max(right, x)
        top = Math.min(top, y)
        bottom = Math.max(bottom, y)
      }
    }
  return { width: right - left + 1, height: bottom - top + 1 }
}

/** Whether the pixel at the given fraction of a PNG is the blue corner mark. */
async function isBlueAt(blob: Blob, fx: number, fy: number) {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no canvas')
  context.drawImage(bitmap, 0, 0)
  const [r, g, b] = context.getImageData(
    Math.floor(fx * bitmap.width),
    Math.floor(fy * bitmap.height),
    1,
    1,
  ).data
  return b! > 200 && r! < 60 && g! < 60
}

function Dialog({
  file,
  onSave = fn(),
  kind = 'document',
  origin,
}: {
  file: File
  onSave?: (logo: Blob) => void
  kind?: 'document' | 'workspace'
  origin?: 'file' | 'raster' | 'vector'
}) {
  const [url] = useState(() => URL.createObjectURL(file))
  return (
    <LogoCropDialog
      kind={kind}
      file={file}
      origin={origin}
      url={url}
      saving={false}
      progress={null}
      error=""
      onCancel={fn()}
      onSave={onSave}
    />
  )
}

const meta = {
  title: 'Shared/Document logo framing',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const saved = fn<(logo: Blob) => void>()
/** Fixtures are made by loaders, so they exist before the story renders and its play starts. */
const fileLoader = (make: () => Promise<File>) => async () => ({ file: await make() })
const turnedLoader = (turn: 6 | 8, width?: number, height?: number) =>
  fileLoader(() => turnedJpeg(turn, width, height))
const pictureLoader = (width: number, height: number, clear?: boolean) =>
  fileLoader(() => picture(width, height, clear))
const renderLoaded: Story['render'] = (_args, { loaded }) => {
  if (!(loaded.file instanceof File)) throw new Error('the loader did not provide the picture')
  return <Dialog file={loaded.file} onSave={saved} />
}

const frame = (body: HTMLElement) => within(body).findByRole('button', { name: /arrow keys/ })

/** A portrait photo starts whole and centred in the wide field; arrows move it, Fit puts it back. */
export const Portrait: Story = {
  loaders: [pictureLoader(600, 800)],
  render: renderLoaded,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const field = await frame(canvasElement.ownerDocument.body)
    const placed = field.querySelector('img')?.parentElement
    await waitFor(() => expect(placed?.style.height).toBe('100%'))
    const start = placed?.style.left
    field.focus()
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    await expect(placed?.style.left).not.toBe(start)
    await userEvent.click(body.getByRole('button', { name: /whole picture/i }))
    await expect(placed?.style.left).toBe(start)
    await expect(
      field.getBoundingClientRect().width / field.getBoundingClientRect().height,
    ).toBeCloseTo(2.5, 1)
  },
}

/** A wide, low wordmark fills the field's width. */
export const Wordmark: Story = { loaders: [pictureLoader(1500, 300)], render: renderLoaded }

/** Already 2.5 : 1: saved as picked, nothing to fit. */
export const ExactRatio: Story = {
  loaders: [pictureLoader(1000, 400)],
  render: renderLoaded,
  play: async ({ canvasElement }) => {
    const body = canvasElement.ownerDocument.body
    await frame(body)
    await expect(within(body).getByRole('button', { name: /whole picture/i })).toBeDisabled()
  },
}

/** The smallest allowed picture, on white instead of transparent. */
export const Tiny: Story = { loaders: [pictureLoader(64, 64, false)], render: renderLoaded }

const keepsTheDiscRound: Story['play'] = async ({ canvasElement }) => {
  const body = within(canvasElement.ownerDocument.body)
  await frame(canvasElement.ownerDocument.body)
  saved.mockClear()
  await userEvent.click(await body.findByRole('button', { name: 'Use this logo' }))
  await waitFor(() => expect(saved).toHaveBeenCalled())
  const logo = saved.mock.calls[0]?.[0]
  if (!logo) throw new Error('nothing saved')
  // Turned by the browser to 400 × 600 and fitted whole into the 2.5 : 1 field, the disc is still round.
  const size = await discSize(logo)
  await expect(size.width / size.height).toBeGreaterThan(0.95)
  await expect(size.width / size.height).toBeLessThan(1.05)
}

/** A JPEG turned by EXIF (orientation 6) keeps its proportions in the saved PNG. */
export const ExifTurnedClockwise: Story = {
  loaders: [turnedLoader(6)],
  render: renderLoaded,
  play: keepsTheDiscRound,
}

/** The same turned the other way (orientation 8). */
export const ExifTurnedAnticlockwise: Story = {
  loaders: [turnedLoader(8)],
  render: renderLoaded,
  play: keepsTheDiscRound,
}

/** Saved as a re-encoded PNG at 2.5 : 1 with the blue corner mark where the browser shows it, not as the picked JPEG. */
const exactTurned =
  (corner: readonly [number, number]): Story['play'] =>
  async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const field = await frame(canvasElement.ownerDocument.body)
    // Saving before the picture decodes would use the header's unturned size, not the shape the browser shows.
    await waitFor(() => expect(field.querySelector('img')?.naturalWidth).toBe(1000))
    saved.mockClear()
    await userEvent.click(await body.findByRole('button', { name: 'Use this logo' }))
    await waitFor(() => expect(saved).toHaveBeenCalled())
    const logo = saved.mock.calls[0]?.[0]
    if (!logo) throw new Error('nothing saved')
    await expect(logo.type).toBe('image/png')
    const bitmap = await createImageBitmap(logo)
    await expect(bitmap.width / bitmap.height).toBeCloseTo(2.5, 2)
    await expect(await isBlueAt(logo, corner[0], corner[1])).toBe(true)
  }

/** A 400 × 1000 JPEG turned by EXIF 6 is shown 1000 × 400: already the field's shape, yet still re-encoded. */
export const ExactRatioExifClockwise: Story = {
  loaders: [turnedLoader(6, 400, 1000)],
  render: renderLoaded,
  play: exactTurned([0.97, 0.075]),
}

/** The same turned the other way (orientation 8): the mark lands bottom left. */
export const ExactRatioExifAnticlockwise: Story = {
  loaders: [turnedLoader(8, 400, 1000)],
  render: renderLoaded,
  play: exactTurned([0.03, 0.925]),
}

/** The pixel (r, g, b, a) at the middle of a picture. */
async function middlePixel(blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no canvas')
  context.drawImage(bitmap, 0, 0)
  const at = context.getImageData(bitmap.width >> 1, bitmap.height >> 1, 1, 1).data
  return { width: bitmap.width, height: bitmap.height, rgba: [...at] }
}

/** A 1 × 1 GIF of two frames, the first red and the second blue, 10 ms apart, looping for ever. */
const gifFrame = (pixel: number) => [
  0x21,
  0xf9,
  4,
  0,
  1,
  0,
  0,
  0,
  0x2c,
  0,
  0,
  0,
  0,
  1,
  0,
  1,
  0,
  0,
  2,
  2,
  pixel,
  1,
  0,
]

const twoFrameGif = () => {
  const header = [
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0, 0xff, 0, 0, 0, 0, 0xff,
  ]
  const loop = [0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30]
  const bytes = header.concat(loop, [3, 1, 0, 0, 0], gifFrame(0x44), gifFrame(0x4c), [0x3b])
  return new File([new Uint8Array(bytes)], 'logo.gif', { type: 'image/gif' })
}

const svg = (body: string, size = 'width="200" height="80"') =>
  new File([`<svg xmlns="http://www.w3.org/2000/svg" ${size}>${body}</svg>`], 'logo.svg', {
    type: 'image/svg+xml',
  })

const prepared = async (file: File) => {
  const result = await prepareLogo(file)
  if ('problem' in result) throw new Error(result.problem)
  return result
}

/** A GIF is frozen on its first frame (red), not the second (blue), whatever the time. */
export const GifFirstFrame: Story = {
  render: () => <div />,
  play: async () => {
    const { file, origin } = await prepared(twoFrameGif())
    await expect(origin).toBe('raster')
    await expect(file.type).toBe('image/png')
    await new Promise((resolve) => setTimeout(resolve, 300))
    const { rgba } = await middlePixel(file)
    await expect(rgba).toEqual([255, 0, 0, 255])
  },
}

/** A WebP keeps its transparency and its own size as a static PNG. */
export const WebpTransparent: Story = {
  render: () => <div />,
  play: async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 300
    canvas.height = 100
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no canvas')
    context.fillStyle = '#00ff00'
    context.fillRect(100, 0, 100, 100)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 1),
    )
    if (!blob) throw new Error('no webp')
    const { file, origin } = await prepared(new File([blob], 'logo.webp', { type: 'image/webp' }))
    await expect(origin).toBe('raster')
    const bitmap = await createImageBitmap(file)
    await expect([bitmap.width, bitmap.height]).toEqual([300, 100])
    const clear = await middlePixel(await canvasPart(file, 10))
    await expect(clear.rgba[3]).toBe(0)
    await expect((await middlePixel(file)).rgba).toEqual([0, 255, 0, 255])
  },
}

/** The picture's pixel column at `x`, as a 1 × 1 PNG (to read one pixel with middlePixel). */
async function canvasPart(blob: Blob, x: number) {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no canvas')
  context.drawImage(bitmap, x, 50, 1, 1, 0, 0, 1, 1)
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((part) => (part ? resolve(part) : reject(new Error('no png'))), 'image/png'),
  )
}

/** An SVG with a script, a handler and external images is drawn as a plain picture: nothing runs, nothing is fetched. */
export const SvgIsInert: Story = {
  render: () => <div />,
  play: async () => {
    const outside = 'https://logo-fetch-probe.invalid/x.png'
    const file = svg(
      `<script>window.top.svgRan = true; window.svgRan = true</script>
       <rect x="50" y="20" width="100" height="40" fill="#ff0000" onload="window.top.svgRan = true"/>
       <image href="${outside}" width="10" height="10"/>
       <style>@import url("${outside}"); rect { background: url(${outside}) }</style>`,
    )
    const { file: png, origin } = await prepared(file)
    await expect(origin).toBe('vector')
    const { width, height, rgba } = await middlePixel(png)
    await expect([width, height]).toEqual([2048, 819])
    await expect(rgba).toEqual([255, 0, 0, 255])
    await expect(Reflect.get(window, 'svgRan')).toBeUndefined()
    await expect(Reflect.get(window.top ?? window, 'svgRan')).toBeUndefined()
    await expect(
      performance
        .getEntriesByType('resource')
        .filter((entry) => entry.name.includes('logo-fetch-probe')),
    ).toHaveLength(0)
  },
}

/** An SVG drawn from only a viewBox keeps its shape. */
export const SvgViewBoxOnly: Story = {
  render: () => <div />,
  play: async () => {
    const wide = await prepared(svg('<rect width="300" height="100"/>', 'viewBox="0 0 300 100"'))
    const bitmap = await createImageBitmap(wide.file)
    await expect([bitmap.width, bitmap.height]).toEqual([2048, 683])
  },
}

/** An SVG with a foreignObject taints Chromium's canvas: saving it fails in a controlled way instead of leaking pixels. */
export const SvgForeignObjectIsRefused: Story = {
  render: () => <div />,
  play: async () => {
    const file = svg(
      '<foreignObject width="10" height="10"><iframe xmlns="http://www.w3.org/1999/xhtml" src="https://logo-fetch-probe.invalid"/></foreignObject>',
    )
    await expect(normalizeLogo(file, 'svg', { width: 200, height: 80 })).rejects.toThrow()
  },
}

const savedVector = fn<(logo: Blob) => void>()
const vectorLoader = (size: string, body: string) => async () => {
  const result = await prepareLogo(svg(body, size))
  if ('problem' in result) throw new Error(result.problem)
  return result
}
const renderVector: Story['render'] = (_args, { loaded }) => {
  const { file, origin } = loaded
  if (!(file instanceof File) || (origin !== 'vector' && origin !== 'raster' && origin !== 'file'))
    throw new Error('the vectorLoader did not provide the logo')
  return <Dialog kind="workspace" file={file} origin={origin} onSave={savedVector} />
}

/** A 20 : 1 SVG becomes a 2048 × 102 raster: its square workspace crop is 102 px, held to the same 160 px floor as a PNG. */
export const SvgWideWorkspaceFloor: Story = {
  loaders: [vectorLoader('width="400" height="20"', '<rect width="400" height="20"/>')],
  render: renderVector,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    savedVector.mockClear()
    const confirm = await body.findByRole('button', { name: 'Use this logo' })
    await waitFor(() => expect(confirm).toBeEnabled())
    await userEvent.click(confirm)
    await expect((await body.findByRole('alert')).textContent).toMatch(/crop is too small/)
    await expect(savedVector).not.toHaveBeenCalled()
  },
}

/** A square SVG is still a usable workspace logo: its raster is large enough for the floor. */
export const SvgSquareWorkspaceSaves: Story = {
  loaders: [vectorLoader('width="100" height="100"', '<rect width="100" height="100"/>')],
  render: renderVector,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    savedVector.mockClear()
    const confirm = await body.findByRole('button', { name: 'Use this logo' })
    await waitFor(() => expect(confirm).toBeEnabled())
    await userEvent.click(confirm)
    await waitFor(() => expect(savedVector).toHaveBeenCalled())
  },
}
