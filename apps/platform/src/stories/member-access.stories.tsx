import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useState } from 'react'
import { expect, userEvent, within } from 'storybook/test'

import { AccessEditor } from '@/components/members/access-editor'
import { EVERYTHING } from '@/lib/permissions'

const meta = { title: 'Members/Access permissions' } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function Editor({ initial = EVERYTHING, owner = false }: { initial?: string[]; owner?: boolean }) {
  const [scopes, setScopes] = useState(initial)
  return (
    <div className="max-w-xl">
      <AccessEditor value={scopes} onChange={setScopes} canChangeHR={owner} />
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
    const areas = within(canvas.getByRole('table', { name: 'Areas' }))
    const firstRow = areas.getAllByRole('row')[1]
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

/** An owner grants employee and payroll access row by row; a preset keeps it. */
export const HRRowsForOwner: Story = {
  render: () => <Editor owner />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const scopes = canvas.getByRole('status', { name: 'Scopes' })
    const hr = within(canvas.getByRole('table', { name: 'Employees and payroll' }))
    await userEvent.click(hr.getByRole('radio', { name: 'Employees: View' }))
    await expect(scopes).toHaveTextContent('*:*, read:employees')
    await expect(hr.queryByRole('radio', { name: 'Payroll approval: View' })).toBeNull()
    await userEvent.click(canvas.getByRole('radio', { name: 'Read only' }))
    await userEvent.click(canvas.getByRole('radio', { name: 'Full access' }))
    await expect(scopes).toHaveTextContent('*:*, read:employees')
    await expect(canvas.getByText(/HR: view employees/)).toBeVisible()
  },
}

/** Anyone but an owner sees the HR rows without being able to change them. */
export const HRRowsLockedForAdmin: Story = {
  render: () => <Editor initial={['*:*', 'read:payroll']} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const hr = within(canvas.getByRole('table', { name: 'Employees and payroll' }))
    expect(hr.getAllByRole('radio').every((radio) => radio.hasAttribute('disabled'))).toBe(true)
    await expect(hr.getByRole('radio', { name: 'Payroll: View' })).toBeChecked()
    await expect(canvas.getByText(/Only owners can change access to employees/)).toBeVisible()
  },
}
