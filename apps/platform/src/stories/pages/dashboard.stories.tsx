import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Dashboard } from '@/components/dashboard/dashboard'

import { closeHeidi, dark, desktop, Frame, pageParameters, phone, shows } from './frame'

const meta = {
  title: 'Pages/Dashboard',
  beforeEach: closeHeidi,
  parameters: pageParameters('/'),
  render: () => (
    <Frame>
      <Dashboard />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const WithData: Story = { play: shows(/Cash flow/i) }
export const WithDataDark = dark(WithData)
export const WithDataPhone = phone(WithData)
