import { setCsrfToken } from '@helvetly/ui/lib/http'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { portalAvatarUrl, portalHandlers, portalSession } from '@/mocks/portal'

import { PortalPhoto } from './portal-photo'
import { PortalProfile } from './portal-profile'
import { PortalShell } from './portal-shell'

const P = '/api/v1/public/portal'
const withPhoto = http.get(`${P}/session`, () =>
  HttpResponse.json({ ...portalSession, avatar_url: portalAvatarUrl }),
)
const photoFile = async (name = 'me.png') =>
  new File([await (await fetch(portalAvatarUrl)).blob()], name, { type: 'image/png' })
const photoImage = (root: HTMLElement) =>
  root.querySelector<HTMLImageElement>('[data-slot="avatar-image"]')
const input = (root: HTMLElement) =>
  within(root).getByTestId<HTMLInputElement>('portal-photo-input')

const meta = {
  title: 'Portal/Photo',
  parameters: { msw: { handlers: portalHandlers } },
  beforeEach: () => setCsrfToken(portalSession.csrf_token),
  render: () => <PortalPhoto />,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** No photo yet: the client's initials and "Upload photo"; nothing to remove. */
export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('button', { name: 'Upload photo' })).toBeEnabled()
    await expect(canvas.getByText('KA')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Remove' })).toBeNull()
  },
}

/** The photo instead of the initials; removing it asks first, then shows the initials again. */
export const WithPhoto: Story = {
  parameters: { msw: { handlers: [withPhoto, ...portalHandlers] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await waitFor(() => expect(photoImage(canvasElement)).not.toBeNull())
    await expect(canvas.getByRole('button', { name: 'Change photo' })).toBeEnabled()
    await userEvent.click(canvas.getByRole('button', { name: 'Remove' }))
    const dialog = within(document.body).getByRole('dialog', { name: 'Remove your photo?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }))
    await expect(photoImage(canvasElement)).not.toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Remove' }))
    await userEvent.click(within(document.body).getByRole('button', { name: 'Remove photo' }))
    await expect(await canvas.findByRole('button', { name: 'Upload photo' })).toBeVisible()
    await waitFor(() => expect(photoImage(canvasElement)).toBeNull())
  },
}

/** While the photo uploads, both buttons wait and the upload button says so. */
export const Uploading: Story = {
  parameters: {
    msw: { handlers: [http.put(`${P}/avatar`, () => new Promise(() => {})), ...portalHandlers] },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('button', { name: 'Upload photo' })
    await userEvent.upload(input(canvasElement), await photoFile())
    await expect(await canvas.findByRole('button', { name: 'Uploading…' })).toBeDisabled()
  },
}

/** The API's reason shows under the title; a wrong type is refused before anything is sent. */
export const ValidationError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.put(`${P}/avatar`, () =>
          HttpResponse.json(
            {
              error: {
                code: 'validation_failed',
                message: 'Use an image of at least 32 px and at most 2048 px on each side.',
                details: { fields: { file: 'too small' } },
              },
            },
            { status: 422 },
          ),
        ),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('button', { name: 'Upload photo' })
    await userEvent.upload(input(canvasElement), await photoFile())
    await expect(await canvas.findByRole('alert')).toHaveTextContent('at least 32 px')
    const gif = new File(['GIF89a'], 'me.gif', { type: 'image/gif' })
    await userEvent.upload(input(canvasElement), gif, { applyAccept: false })
    await expect(await canvas.findByRole('alert')).toHaveTextContent('PNG, JPEG or WebP')
  },
}

export const Dark: Story = {
  ...WithPhoto,
  parameters: { ...WithPhoto.parameters, dark: true },
  play: async ({ canvasElement }) => {
    await waitFor(() => expect(photoImage(canvasElement)).not.toBeNull())
  },
}

/** On a 390px phone the buttons wrap under the photo and nothing pushes the page sideways. */
export const Phone: Story = {
  parameters: {
    msw: { handlers: [withPhoto, ...portalHandlers] },
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
    },
  },
  globals: { viewport: { value: 'phone' } },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByRole('button', { name: 'Change photo' })
    await expect(window.innerWidth).toBe(390)
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
  },
}

/** An upload on the profile shows at once in the header's account menu. */
export const ShownInAccountMenu: Story = {
  parameters: { ownMain: true },
  render: () => (
    <PortalShell>
      <PortalProfile />
    </PortalShell>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('button', { name: 'Upload photo' })
    const header = canvasElement.querySelector('header')
    if (!header) throw new Error('The shell has no header')
    await expect(photoImage(header)).toBeNull()
    await userEvent.upload(input(canvasElement), await photoFile())
    await waitFor(() => expect(photoImage(header)).not.toBeNull())
    await expect(await canvas.findByRole('button', { name: 'Change photo' })).toBeVisible()
  },
}
