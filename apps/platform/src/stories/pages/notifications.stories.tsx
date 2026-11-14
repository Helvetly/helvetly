import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { NotificationsPage } from '@/components/notifications/notifications-page'
import { resetNotificationsMock } from '@/mocks/notifications'

import { closeHeidi, dark, desktop, Frame, pageParameters, phone, shows } from './frame'

const meta = {
  title: 'Pages/Notifications',
  beforeEach: () => {
    closeHeidi()
    resetNotificationsMock()
  },
  parameters: pageParameters('/notifications'),
  render: () => (
    <Frame>
      <NotificationsPage />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const Page: Story = { play: shows(/Invoice RE-2026-0042 was paid/) }
export const PageDark = dark(Page)
export const PagePhone = phone(Page)
