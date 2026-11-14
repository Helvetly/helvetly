import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { InvoicesPage } from '@/components/invoices/invoices-page'

import { closeHeidi, dark, desktop, Frame, pageParameters, phone, shows } from './frame'

const meta = {
  title: 'Pages/Invoices',
  beforeEach: closeHeidi,
  parameters: pageParameters('/invoices'),
  render: () => (
    <Frame>
      <InvoicesPage />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const List: Story = { play: shows('Sophie Meier', 'Overdue') }
export const ListDark = dark(List)
export const ListPhone = phone(List)
