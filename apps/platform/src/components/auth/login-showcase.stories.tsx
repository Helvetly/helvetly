import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, within } from 'storybook/test'

import { translate } from '@/lib/i18n'

import { LoginShowcase } from './login-showcase'

const meta = {
  title: 'Auth/LoginShowcase',
  component: LoginShowcase,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="h-[44rem] w-[36rem]">
        <Story />
      </div>
    ),
  ],
  args: { className: 'h-full' },
} satisfies Meta<typeof LoginShowcase>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getAllByRole('listitem')).toHaveLength(8)
    await expect(canvas.getByText(translate('heidi'))).toBeVisible()
  },
}
