import { setCsrfToken } from '@helvetly/ui/lib/http'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { ProfilePhoto } from '@/components/account/profile-photo'
import type { Session } from '@/lib/api'
import { useSession } from '@/lib/queries'
import { accountHandlers, resetAccountMock } from '@/mocks/account'

import { storySession } from './screen-fixtures'

// A small grey square: the stand-in for a Google picture or an own photo.
const picture =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAA5UlEQVR42u3PhUECAAAAQea0u7u727d7BJDuThHGcgQX+NvgAj10e+n20emnM8DvIL9DtIdpj/Azys8YrXFaEzQnaU7RmKYxQ32W+hy1eWoLVBepLlFZprJCeZXyGqV1ShsUNyluUdimsEN+l/weuX1yB2QPyR6ROSZzQvqU9Bmpc1IXJC9JXpG4JnFD/JY4xO6I3RN9IPpI5InIM+EXwq98v/H9TuiD0CfBL4IBAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwMB/gT+jseGWU2gTOAAAAABJRU5ErkJggg=='

const sessionWith = (avatar_url: string | null) =>
  http.get('/api/v1/session', () =>
    HttpResponse.json({
      ...storySession,
      user: { ...storySession.user, avatar_url },
    } satisfies Session),
  )

/** A real 300 × 200 picture, drawn in the browser, so the cropper and the encoding run as for a person's file. */
async function photoFile(name = 'me.png', type = 'image/png') {
  const canvas = document.createElement('canvas')
  canvas.width = 300
  canvas.height = 200
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no 2d context')
  context.fillStyle = 'gray'
  context.fillRect(0, 0, 300, 200)
  context.fillStyle = 'teal'
  context.fillRect(100, 50, 100, 100)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type))
  if (!blob) throw new Error('no blob')
  return new File([blob], name, { type })
}
const image = (root: HTMLElement) =>
  root.querySelector<HTMLImageElement>('[data-slot="avatar-image"]')
const input = (root: HTMLElement) =>
  within(root).getByTestId<HTMLInputElement>('profile-photo-input')

/** Picks the file and waits for the crop dialog, ready to save once the cropper has measured the photo. */
async function pickAndCrop(root: HTMLElement, file: File) {
  await userEvent.upload(input(root), file)
  const dialog = within(
    await within(document.body).findByRole('dialog', { name: 'Crop your photo' }),
  )
  await waitFor(() => expect(dialog.getByRole('button', { name: 'Save photo' })).toBeEnabled())
  return dialog
}

function FromSession() {
  const user = useSession().data?.user
  return user ? <ProfilePhoto user={user} name={user.name} /> : null
}

const meta = {
  title: 'Account/Profile photo',
  parameters: { msw: { handlers: [sessionWith(null), ...accountHandlers] } },
  beforeEach: () => {
    resetAccountMock()
    setCsrfToken(storySession.csrf_token)
  },
  render: () => (
    <div className="max-w-2xl p-4">
      <FromSession />
    </div>
  ),
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** No picture: the initials, "Upload photo", nothing to remove. */
export const Initials: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('AM')).toBeVisible()
    await expect(canvas.getAllByRole('button', { name: 'Upload photo' })).toHaveLength(2)
    await expect(canvas.queryByRole('button', { name: 'Remove' })).toBeNull()
  },
}

/** Google's picture shows, and the person can still upload their own; the photo itself opens the picker. */
export const GooglePicture: Story = {
  parameters: { msw: { handlers: [sessionWith(picture), ...accountHandlers] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText(/Your Google picture/)).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Remove' })).toBeNull()
    const [trigger] = canvas.getAllByRole('button', { name: 'Upload photo' })
    if (!trigger) throw new Error('no photo button')
    await userEvent.hover(trigger)
    await expect(await within(document.body).findByRole('tooltip')).toHaveTextContent(
      'Upload photo',
    )
  },
}

/** Pick → crop (nothing sent yet) → save: the own photo shows; then it can be changed or removed. */
export const UploadAndRemove: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('AM')
    const dialog = await pickAndCrop(canvasElement, await photoFile())
    await expect(image(canvasElement)).toBeNull()
    await userEvent.click(dialog.getByRole('button', { name: 'Save photo' }))
    await expect(await canvas.findByText(/Your own photo/)).toBeVisible()
    await waitFor(() =>
      expect(image(canvasElement)?.src).toContain('/api/v1/users/usr_mock/avatar?v='),
    )
    await expect(within(document.body).queryByRole('dialog')).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Remove' }))
    const confirm = within(document.body).getByRole('dialog', { name: 'Remove your photo?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove photo' }))
    await expect(await canvas.findByText(/Upload a photo to show instead/)).toBeVisible()
    await waitFor(() => expect(image(canvasElement)).toBeNull())
  },
}

/**
 * The crop dialog: a square crop that starts centred, a round preview, zoom by keyboard on the slider and by the
 * wheel; saving sends a 512 × 512 JPEG.
 */
export const Crop: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('AM')
    const dialog = await pickAndCrop(canvasElement, await photoFile())
    const zoom = dialog.getByRole('slider', { name: 'Zoom' })
    await expect(zoom).toHaveAttribute('aria-valuenow', '1')
    const area = dialog.getByRole('group', { name: /Crop area/ })
    const frame = area.parentElement?.getBoundingClientRect()
    const box = area.getBoundingClientRect()
    if (!frame) throw new Error('no crop frame')
    // Square, and centred in its frame.
    await expect(Math.abs(box.width - box.height)).toBeLessThan(1)
    await expect(Math.abs(box.left + box.width / 2 - (frame.left + frame.width / 2))).toBeLessThan(
      1,
    )
    zoom.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    await expect(zoom).toHaveAttribute('aria-valuenow', '1.2')
    area.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))
    await waitFor(() => expect(Number(zoom.getAttribute('aria-valuenow'))).toBeGreaterThan(1.2))
    area.focus()
    await userEvent.keyboard('{ArrowLeft}')
    await userEvent.click(dialog.getByRole('button', { name: 'Save photo' }))
    await expect(await canvas.findByText(/Your own photo/)).toBeVisible()
    const src = await waitFor(() => {
      const saved = image(canvasElement)?.src
      if (!saved) throw new Error('no saved photo yet')
      return saved
    })
    const saved = await (await fetch(src)).blob()
    await expect(saved.type).toBe('image/jpeg')
    const bitmap = await createImageBitmap(saved)
    await expect([bitmap.width, bitmap.height]).toEqual([512, 512])
  },
}

/** Cancel closes the dialog and sends nothing. */
export const CropCancel: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('AM')
    const dialog = await pickAndCrop(canvasElement, await photoFile())
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
    await expect(canvas.getByText(/Upload a photo to show instead/)).toBeVisible()
    await expect(image(canvasElement)).toBeNull()
  },
}

/** A WebP pick is accepted and sent as JPEG, which the API stores. */
export const WebP: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('AM')
    const dialog = await pickAndCrop(canvasElement, await photoFile('me.webp', 'image/webp'))
    await userEvent.click(dialog.getByRole('button', { name: 'Save photo' }))
    await expect(await canvas.findByText(/Your own photo/)).toBeVisible()
  },
}

/** While saving, the buttons wait and say so. */
export const Saving: Story = {
  parameters: {
    msw: {
      handlers: [
        sessionWith(null),
        http.put('/api/v1/account/avatar', () => new Promise(() => {})),
        ...accountHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('AM')
    const dialog = await pickAndCrop(canvasElement, await photoFile())
    await userEvent.click(dialog.getByRole('button', { name: 'Save photo' }))
    await expect(await dialog.findByRole('button', { name: 'Saving…' })).toBeDisabled()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await userEvent.keyboard('{Escape}')
    await expect(
      within(document.body).getByRole('dialog', { name: 'Crop your photo' }),
    ).toBeVisible()
  },
}

/** The API's reason shows in the dialog, which stays to try again; a wrong type is refused at once. */
export const Rejected: Story = {
  parameters: {
    msw: {
      handlers: [
        sessionWith(null),
        http.put('/api/v1/account/avatar', () =>
          HttpResponse.json(
            {
              error: {
                code: 'validation_failed',
                message: 'Use an image of at least 32 px and at most 2048 px on each side.',
                details: { fields: { file: 'Use an image of at least 32 px.' } },
              },
            },
            { status: 422 },
          ),
        ),
        ...accountHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('AM')
    const dialog = await pickAndCrop(canvasElement, await photoFile())
    await userEvent.click(dialog.getByRole('button', { name: 'Save photo' }))
    await expect(await dialog.findByRole('alert')).toHaveTextContent('at least 32 px')
    await expect(dialog.getByRole('button', { name: 'Save photo' })).toBeEnabled()
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
    const gif = new File(['GIF89a'], 'me.gif', { type: 'image/gif' })
    await userEvent.upload(input(canvasElement), gif, { applyAccept: false })
    await expect(await canvas.findByRole('alert')).toHaveTextContent('PNG, JPEG or WebP')
  },
}

export const Dark: Story = {
  ...GooglePicture,
  parameters: { ...GooglePicture.parameters, dark: true },
}

export const CropDark: Story = {
  parameters: { dark: true },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText('AM')
    await pickAndCrop(canvasElement, await photoFile())
  },
}

export const Phone: Story = {
  ...UploadAndRemove,
  parameters: {
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
    },
  },
  globals: { viewport: { value: 'phone' } },
}
