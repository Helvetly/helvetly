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

const made = new Map<string, Promise<File>>()
const cached = (width: number, height: number, clear: boolean) => {
  const key = `${width}x${height}${clear}`
  const hit = made.get(key) ?? picture(width, height, clear)
  made.set(key, hit)
  return hit
}

function Dialog({ file }: { file: File }) {
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
      onSave={fn()}
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
