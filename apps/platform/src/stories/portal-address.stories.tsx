import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { PortalAddressSection } from '@/components/settings/portal-address'
import { portalAddressHandlers, resetPortalAddress } from '@/mocks/portal-address'

const meta = {
  title: 'Settings/Portal address',
  component: PortalAddressSection,
  args: { canEdit: true },
  parameters: { msw: { handlers: portalAddressHandlers } },
  beforeEach: () => resetPortalAddress(),
  render: (args) => (
    <div className="@container/sections max-w-5xl p-6">
      <PortalAddressSection {...args} />
      <Toaster />
    </div>
  ),
} satisfies Meta<typeof PortalAddressSection>
export default meta
type Story = StoryObj<typeof meta>

const URL = 'https://portal.helvetly.com/w/mueller-treuhand/'
const page = () => within(document.body)

/** The address opens the portal and copies with one click. */
export const CopyAddress: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('link', { name: 'portal.helvetly.com/w/mueller-treuhand/' }),
    ).toHaveAttribute('href', URL)
    const write = fn(async (_text: string) => {})
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: write },
      configurable: true,
    })
    await userEvent.click(canvas.getByRole('button', { name: 'Copy portal address' }))
    await expect(write).toHaveBeenCalledWith(URL)
    await expect(await page().findByText('Portal address copied')).toBeInTheDocument()
  },
}

/** Typing a free slug says it is available; saving moves the address. */
export const ChangeSlug: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = await canvas.findByLabelText(/^Address/)
    await expect(canvas.getByText('portal.helvetly.com/w/')).toBeVisible()
    await userEvent.clear(input)
    await userEvent.type(input, 'mueller')
    await expect(await canvas.findByText('Available')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await expect(
      await canvas.findByRole('link', { name: 'portal.helvetly.com/w/mueller/' }),
    ).toBeVisible()
    await expect(await page().findAllByText('Portal address saved')).not.toHaveLength(0)
  },
}

/** A reserved word is refused while typing. */
export const ReservedSlug: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = await canvas.findByLabelText(/^Address/)
    await userEvent.clear(input)
    await userEvent.type(input, 'login')
    await expect(
      await canvas.findByText('This address is reserved. Choose another one.'),
    ).toBeVisible()
    await expect(input).toHaveAttribute('aria-invalid', 'true')
  },
}

/** Another workspace's address (current or earlier) is refused, also when saved anyway. */
export const TakenSlug: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = await canvas.findByLabelText(/^Address/)
    await userEvent.clear(input)
    await userEvent.type(input, 'acme')
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(
        canvas.getByText('Another workspace uses this address. Choose another one.'),
      ).toBeVisible(),
    )
    await expect(
      canvas.getByRole('link', { name: 'portal.helvetly.com/w/mueller-treuhand/' }),
    ).toBeVisible()
  },
}

/** A member without the right to change it sees and copies the address, no editor. */
export const ReadOnly: Story = {
  args: { canEdit: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByRole('button', { name: 'Copy portal address' })).toBeVisible()
    await expect(canvas.queryByLabelText(/^Address/)).toBeNull()
  },
}

export const Dark: Story = { ...ChangeSlug, parameters: { ...meta.parameters, dark: true } }
