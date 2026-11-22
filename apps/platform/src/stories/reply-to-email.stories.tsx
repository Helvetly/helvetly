import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, userEvent, within } from 'storybook/test'

import { ReplyToSection } from '@/components/settings/reply-to-email'
import { replyToHandlers, resetReplyTo } from '@/mocks/reply-to'

const meta = {
  title: 'Settings/Reply-to email',
  component: ReplyToSection,
  args: { canEdit: true },
  parameters: { msw: { handlers: replyToHandlers } },
  beforeEach: () => resetReplyTo(),
  render: (args) => (
    <div className="@container/sections max-w-5xl p-6">
      <ReplyToSection {...args} />
      <Toaster />
    </div>
  ),
} satisfies Meta<typeof ReplyToSection>
export default meta
type Story = StoryObj<typeof meta>

const field = (canvasElement: HTMLElement) =>
  within(canvasElement).findByLabelText('Reply-to email for client emails')

/** Empty by default (the company email is used); a bad address is refused, a good one saved lower-cased. */
export const SetAddress: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const input = await field(canvasElement)
    await expect(input).toHaveValue('')
    await expect(input).toHaveAttribute('placeholder', 'The company email')
    await userEvent.type(input, 'not an address')
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await expect(await canvas.findByText('Check the email address.')).toBeVisible()
    await userEvent.clear(input)
    await userEvent.type(input, 'Office@Muster.ch')
    await userEvent.click(canvas.getByRole('button', { name: 'Save' }))
    await expect(
      await within(document.body).findAllByText('Reply-to email saved'),
    ).not.toHaveLength(0)
    await expect(await field(canvasElement)).toHaveValue('office@muster.ch')
  },
}

/** A member sees the address but cannot change it. */
export const ReadOnly: Story = {
  args: { canEdit: false },
  beforeEach: () => resetReplyTo('office@muster.ch'),
  play: async ({ canvasElement }) => {
    const input = await field(canvasElement)
    await expect(input).toHaveValue('office@muster.ch')
    await expect(input).toBeDisabled()
    await expect(
      within(canvasElement).getByText('Only an owner or admin can change the reply-to email.'),
    ).toBeVisible()
    await expect(within(canvasElement).queryByRole('button', { name: 'Save' })).toBeNull()
  },
}
