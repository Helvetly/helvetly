import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { Suspense, use, useState } from 'react'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { LogoCropDialog } from './logo-crop'

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

const made = new Map<string, Promise<File>>()
const cached = (width: number, height: number, clear: boolean) => {
  const key = `${width}x${height}${clear}`
  const hit = made.get(key) ?? picture(width, height, clear)
  made.set(key, hit)
  return hit
}

function Dialog({ file, onSave = fn() }: { file: File; onSave?: (logo: Blob) => void }) {
  const [url] = useState(() => URL.createObjectURL(file))
  return (
    <LogoCropDialog
      kind="document"
      file={file}
      url={url}
      saving={false}
      progress={null}
      error=""
      onCancel={fn()}
      onSave={onSave}
    />
  )
}

function Opened({ width, height, clear }: { width: number; height: number; clear: boolean }) {
  return <Dialog file={use(cached(width, height, clear))} />
}

function Pick({ width, height, clear = true }: { width: number; height: number; clear?: boolean }) {
  return (
    <Suspense fallback={null}>
      <Opened width={width} height={height} clear={clear} />
    </Suspense>
  )
}

const meta = {
  title: 'Shared/Document logo framing',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const frame = (body: HTMLElement) => within(body).findByRole('button', { name: /arrow keys/ })

/** A portrait photo starts whole and centred in the wide field; arrows move it, Fit puts it back. */
export const Portrait: Story = {
  render: () => <Pick width={600} height={800} />,
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
export const Wordmark: Story = { render: () => <Pick width={1500} height={300} /> }

/** Already 2.5 : 1: saved as picked, nothing to fit. */
export const ExactRatio: Story = {
  render: () => <Pick width={1000} height={400} />,
  play: async ({ canvasElement }) => {
    const body = canvasElement.ownerDocument.body
    await frame(body)
    await expect(within(body).getByRole('button', { name: /whole picture/i })).toBeDisabled()
  },
}

/** The smallest allowed picture, on white instead of transparent. */
export const Tiny: Story = { render: () => <Pick width={64} height={64} clear={false} /> }

const saved = fn<(logo: Blob) => void>()
function TurnedDialog({ file }: { file: Promise<File> }) {
  return <Dialog file={use(file)} onSave={saved} />
}
function Turned({ turn, width, height }: { turn: 6 | 8; width?: number; height?: number }) {
  const [file] = useState(() => turnedJpeg(turn, width, height))
  return (
    <Suspense fallback={null}>
      <TurnedDialog file={file} />
    </Suspense>
  )
}

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
  render: () => <Turned turn={6} />,
  play: keepsTheDiscRound,
}

/** The same turned the other way (orientation 8). */
export const ExifTurnedAnticlockwise: Story = {
  render: () => <Turned turn={8} />,
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
  render: () => <Turned turn={6} width={400} height={1000} />,
  play: exactTurned([0.97, 0.075]),
}

/** The same turned the other way (orientation 8): the mark lands bottom left. */
export const ExactRatioExifAnticlockwise: Story = {
  render: () => <Turned turn={8} width={400} height={1000} />,
  play: exactTurned([0.03, 0.925]),
}
