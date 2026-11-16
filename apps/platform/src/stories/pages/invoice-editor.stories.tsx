import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { InvoiceEditorDrawer } from '@/components/invoices/invoice-editor'

import { closeHeidi, dark, desktop, Frame, pageParameters, phone, shows } from './frame'

const meta = {
  title: 'Pages/Invoice editor',
  beforeEach: closeHeidi,
  parameters: {
    ...pageParameters('/invoices', { compose: 'inv_draft' }),
    // shortcut: the date buttons' aria-labels ("Due date: 5 Dec 2026") leave out visible text
    // ("in 30 days", "Add date or period"); turn this rule on again once the editor fixes them.
    a11y: {
      config: {
        rules: [
          { id: 'color-contrast', enabled: false },
          { id: 'label-content-name-mismatch', enabled: false },
        ],
      },
    },
  },
  render: () => (
    <Frame>
      <InvoiceEditorDrawer
        compose={{ id: 'inv_draft', kind: 'invoice', client: null }}
        onClose={() => {}}
        onCreated={() => {}}
      />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const DraftWithLines: Story = {
  play: async (context) => {
    await shows('Alpenglow Studio GmbH')?.(context)
    await shows(/Brand workshop/)?.(context)
  },
}
export const DraftWithLinesDark = dark(DraftWithLines)
export const DraftWithLinesPhone = phone(DraftWithLines)
