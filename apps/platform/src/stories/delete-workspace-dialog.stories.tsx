import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, within } from 'storybook/test'

import { billingFixture } from '@/components/billing/billing-fixture'
import { DeleteDialog } from '@/components/settings/workspace-settings'

const name = 'My workspace, with a rather long and unbroken-Name-0123456789-0123456789-0123456789'

const meta = {
  title: 'Settings/Delete workspace dialog',
  render: () => <DeleteDialog name={name} onClose={() => {}} />,
  parameters: {
    msw: {
      handlers: [http.get('/api/v1/billing', () => HttpResponse.json({ data: billingFixture() }))],
    },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

/** The name to type is set off as code; typing it exactly enables Delete. */
export const NameAsCode: Story = {
  play: async ({ canvasElement }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('dialog'))
    const chip = dialog.getByText(name, { selector: '[data-slot="inline-code"]' })
    await expect(chip).toBeVisible()
    await expect(chip.tagName).toBe('CODE')
    const button = dialog.getByRole('button', { name: 'Delete workspace' })
    await expect(button).toBeDisabled()
    await userEvent.type(dialog.getByRole('textbox'), name)
    await expect(button).toBeEnabled()
  },
}

export const NameAsCodeDark: Story = {
  ...NameAsCode,
  parameters: { ...meta.parameters, dark: true },
}
