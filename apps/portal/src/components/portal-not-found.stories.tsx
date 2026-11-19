import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import { PortalNotFound } from './portal-not-found'

const meta = {
  title: 'Portal/Unknown address',
  component: PortalNotFound,
} satisfies Meta<typeof PortalNotFound>
export default meta
type Story = StoryObj<typeof meta>

/** An address no workspace has (/w/<unknown>/): what to do, and no sign-in form. */
export const UnknownWorkspace: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      canvas.getByRole('heading', { name: 'This portal address doesn’t exist' }),
    ).toBeVisible()
    await expect(canvas.getByText(/Check the link in your supplier’s email/)).toBeVisible()
    await expect(canvas.queryByLabelText('Email')).toBeNull()
  },
}

export const UnknownWorkspaceDark: Story = { ...UnknownWorkspace, parameters: { dark: true } }
