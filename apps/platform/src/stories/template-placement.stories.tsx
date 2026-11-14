import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect, fn, userEvent, within } from 'storybook/test'

import { TemplateEditor } from '@/components/templates/template-editor'
import type { Template } from '@/lib/templates'

import { screenHandlers } from './screen-fixtures'

const meta = {
  title: 'Templates/Place fields',
  parameters: { msw: { handlers: screenHandlers } },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const box = { page: 1, x: 0.1, w: 0.3, h: 0.06 }
const template: Template = {
  id: 'tpl_ask',
  name: 'Offer letter',
  description: null,
  document: { id: 'doc_story', name: 'Offer letter.pdf' },
  signers: [],
  fields: [
    { id: 'fld_name', kind: 'client.name', signer: null, ...box, y: 0.1, label: null },
    { id: 'fld_today', kind: 'today', signer: null, ...box, y: 0.2, label: null },
    { id: 'fld_ask', kind: 'custom', signer: null, ...box, y: 0.3, label: null },
  ],
  used_count: 0,
  last_used_at: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
}

// Without signing, editing an "Ask when filling" field once re-added every custom field per keystroke.
export const RenameAskField: Story = {
  render: () => (
    <TemplateEditor
      template={template}
      initialDocument={null}
      folderId={null}
      onClose={fn()}
      onSaved={fn()}
    />
  ),
  play: async () => {
    const body = within(document.body)
    const placed = await body.findByRole('region', { name: 'In this document' })
    await expect(within(placed).getAllByRole('listitem')).toHaveLength(3)

    await userEvent.click(within(placed).getByRole('button', { name: /^Ask when filling/ }))
    await userEvent.type(body.getByRole('textbox', { name: 'What to ask for' }), 'Start date')

    const items = within(placed).getAllByRole('listitem')
    await expect(items.map((item) => item.textContent)).toEqual([
      'Client namep. 1',
      'Today’s datep. 1',
      'Start datep. 1',
    ])
  },
}
