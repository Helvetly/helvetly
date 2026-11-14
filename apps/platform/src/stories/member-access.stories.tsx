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

export const EmptyAccessIsExplained: Story = {
  render: () => <Editor initial={[]} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Give access to at least one area.')).toBeVisible()
  },
}
