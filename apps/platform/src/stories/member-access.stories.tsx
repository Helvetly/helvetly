import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { AccessEditor } from '@/components/members/access-editor'
import { EVERYTHING } from '@/lib/permissions'

const meta = { title: 'Members/Access permissions' } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function Editor({ initial = EVERYTHING }: { initial?: string[] }) {
  const [scopes, setScopes] = useState(initial)
  return (
    <div className="max-w-xl">
      <AccessEditor value={scopes} onChange={setScopes} />
      <output aria-label="Scopes">{scopes.join(', ') || 'None'}</output>
    </div>
  )
}

export const ReadOnlyPreset: Story = {
  render: () => <Editor initial={['read:*']} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status', { name: 'Scopes' })).not.toHaveTextContent('write:')
    await expect(canvas.getByRole('group', { name: 'Access' })).toBeVisible()
  },
}

export const CustomPermissions: Story = {
  render: () => <Editor />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('radio', { name: 'Custom' }))
    await expect(canvas.getByRole('table')).toBeVisible()
    const firstRow = canvas.getAllByRole('row')[1]
    if (!firstRow) throw new Error('The permissions matrix must contain a resource row.')
    await userEvent.click(within(firstRow).getByRole('radio', { name: /No access/ }))
    await expect(canvas.getByRole('status', { name: 'Scopes' })).not.toHaveTextContent('*:*')
  },
}

export const PresetsSayWhatTheyAllow: Story = {
  render: () => <Editor />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const options = within(canvas.getByRole('group', { name: 'Access' })).getAllByRole('radio')
    await expect(options.map((option) => option.closest('label')?.textContent)).toEqual([
      'Read only',
      'Full access',
      'Custom',
    ])
    await expect(
      canvas.getByText(
        'Can view and edit everything. Members, the workspace and billing stay with owners and admins.',
      ),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('radio', { name: 'Read only' }))
    await expect(canvas.getByText('Can view everything and change nothing.')).toBeVisible()
    await expect(canvas.getByRole('status', { name: 'Scopes' })).toHaveTextContent('read:*')
    // Custom keeps the scopes it starts from but describes itself, not the preset it came from.
    await userEvent.click(canvas.getByRole('radio', { name: 'Custom' }))
    await expect(canvas.getByText('Choose what they can view and edit in each area.')).toBeVisible()
    await expect(canvas.queryByText('Can view everything and change nothing.')).toBeNull()
  },
}

export const CustomSettingsAreas: Story = {
  render: () => <Editor initial={['read:*']} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('radio', { name: 'Custom' }))
    const radio = (area: string, level: string) =>
      canvas.queryByRole('radio', { name: `${area}: ${level}` })
    const editable = ['Invoice settings', 'VAT return', 'Ledger', 'Period closing']
    await expect(editable.filter((area) => !radio(area, 'Edit'))).toEqual([])
    // These stop at View: read only leaves them checked there, with no Edit to pick.
    const viewOnly = ['Members', 'Audit log', 'Workspace', 'Billing', 'API & MCP']
    await expect(
      viewOnly.filter((area) => radio(area, 'Edit') || !radio(area, 'View')?.matches(':checked')),
    ).toEqual([])
    await userEvent.click(canvas.getByRole('radio', { name: 'Ledger: Edit' }))
    await userEvent.click(canvas.getByRole('radio', { name: 'API & MCP: No access' }))
    const scopes = canvas.getByRole('status', { name: 'Scopes' })
    await expect(scopes).toHaveTextContent('write:ledger')
    await expect(scopes).toHaveTextContent('read:vat-return')
    await expect(scopes).not.toHaveTextContent('read:api')
    await expect(
      canvas.getByText('Members, the workspace and billing stay with owners and admins.'),
    ).toBeVisible()
  },
}

export const EmptyAccessIsExplained: Story = {
  render: () => <Editor initial={[]} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Give access to at least one area.')).toBeVisible()
  },
}
