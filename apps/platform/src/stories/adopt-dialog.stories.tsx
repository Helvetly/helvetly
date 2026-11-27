import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { AdoptDialog } from '@/components/signatures/adopt-dialog'

const body = () => within(document.body)

/** A photo-like signature: a dark scribble on slightly grey paper, as a PNG file. */
async function signaturePhoto(type = 'image/png') {
  const canvas = document.createElement('canvas')
  canvas.width = 600
  canvas.height = 300
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no 2D canvas')
  context.fillStyle = '#ececec'
  context.fillRect(0, 0, 600, 300)
  context.strokeStyle = '#1c2a4a'
  context.lineWidth = 6
  context.beginPath()
  context.moveTo(80, 200)
  context.bezierCurveTo(160, 40, 220, 260, 300, 140)
  context.bezierCurveTo(360, 60, 420, 240, 520, 120)
  context.stroke()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type))
  if (!blob) throw new Error('no PNG')
  return new File([blob], 'signature.png', { type })
}

const savedSignature = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="100"><path d="M10 70 C 60 10, 90 90, 140 50 S 220 20, 300 60" stroke="#1c2a4a" stroke-width="4" fill="none"/></svg>',
)}`

const meta = {
  title: 'Signatures/Adopt signature',
  component: AdoptDialog,
  args: { name: 'Łukasz Müller-Gärtner', onAdopt: fn(), onClose: fn() },
} satisfies Meta<typeof AdoptDialog>
export default meta
type Story = StoryObj<typeof meta>

/** Type: the name in the chosen style, picked from a list that previews it in each one. */
export const Type: Story = {
  play: async ({ args }) => {
    const style = await body().findByRole('button', { name: /^Style/ })
    await expect(style).toHaveTextContent('Dancing Script')
    await userEvent.click(style)
    await expect(await body().findAllByRole('option')).toHaveLength(12)
    await userEvent.click(body().getByRole('option', { name: /Great Vibes/ }))
    await expect(style).toHaveTextContent('Great Vibes')
    await userEvent.click(body().getByRole('button', { name: 'Adopt and sign' }))
    await waitFor(() =>
      expect(args.onAdopt).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'typed',
          image: expect.stringMatching(/^data:image\/png/),
        }),
      ),
    )
  },
}

/** The list open: every style previews the name. */
export const StyleList: Story = {
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: /^Style/ }))
    await expect(await body().findByRole('option', { name: /Parisienne/ })).toBeVisible()
  },
}

/** Draw: a pad for a mouse, pen or finger; nothing to adopt until something is drawn. */
export const Draw: Story = {
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Draw' }))
    await expect(body().getByLabelText('Draw your signature')).toBeVisible()
    await expect(body().getByRole('button', { name: 'Adopt and sign' })).toBeDisabled()
  },
}

/** Upload: a picked image is shown cropped on white, its paper made transparent unless unticked. */
export const Upload: Story = {
  play: async ({ args }) => {
    await userEvent.click(await body().findByRole('button', { name: 'Upload' }))
    await expect(body().getByText(/PNG, JPG or WebP, up to 5 MB/)).toBeVisible()
    await userEvent.upload(body().getByTestId('signature-upload-input'), await signaturePhoto())
    await expect(await body().findByRole('img', { name: 'Your signature' })).toBeVisible()
    const transparent = body().getByRole('checkbox', { name: 'Remove the white background' })
    await expect(transparent).toBeChecked()
    await userEvent.click(body().getByRole('button', { name: 'Adopt and sign' }))
    await waitFor(() =>
      expect(args.onAdopt).toHaveBeenCalledWith(expect.objectContaining({ method: 'uploaded' })),
    )
  },
}

/** A file of another type is refused before it is read. */
export const UploadWrongType: Story = {
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Upload' }))
    const input = body().getByTestId('signature-upload-input')
    await userEvent.upload(
      input,
      new File(['%PDF'], 'signature.pdf', { type: 'application/pdf' }),
      {
        applyAccept: false,
      },
    )
    await expect(
      await body().findByText('Upload your signature as a PNG, JPG or WebP image.'),
    ).toBeVisible()
    await expect(body().getByRole('button', { name: 'Adopt and sign' })).toBeDisabled()
  },
}

/** A signer with a saved signature gets it offered first. */
export const Saved: Story = {
  args: { saved: savedSignature },
  play: async ({ args }) => {
    await expect(await body().findByRole('button', { name: 'Saved' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(body().getByRole('button', { name: 'Adopt and sign' }))
    await expect(args.onAdopt).toHaveBeenCalledWith({ method: 'saved', image: savedSignature })
  },
}

/** Settings: the same dialog stores the signature instead of signing. */
export const SaveInSettings: Story = {
  args: { purpose: 'save' },
  play: async () => {
    await expect(await body().findByRole('button', { name: 'Save signature' })).toBeVisible()
    await expect(body().queryByText(/electronic signature/)).toBeNull()
  },
}

const phone = {
  viewport: { options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } } },
}
const onPhone = { viewport: { value: 'phone' } }

/** Phones: icon-only tabs when there are four, the buttons side by side, the pad full width. */
export const Phone: Story = {
  args: { saved: savedSignature },
  parameters: phone,
  globals: onPhone,
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Draw' }))
    const pad = body().getByLabelText('Draw your signature')
    await expect(pad.getBoundingClientRect().width).toBeGreaterThan(300)
  },
}

export const Dark: Story = { ...Type, parameters: { dark: true } }
