import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { MembersPage } from '@/components/members/members-page'

import { closeHeidi, dark, desktop, Frame, pageParameters, phone, shows } from './frame'

const meta = {
  title: 'Pages/Members',
  beforeEach: closeHeidi,
  parameters: pageParameters('/members'),
  render: () => (
    <Frame>
      <MembersPage />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const List: Story = { play: shows('Luca Rossi', 'jonas@muster.ch') }
export const ListDark = dark(List)
export const ListPhone = phone(List)
