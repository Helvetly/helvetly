import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { billingFixture } from '@/components/billing/billing-fixture'
import { AccessEditor } from '@/components/members/access-editor'
import type { PlanId } from '@/lib/billing'
import { ADMIN_HR, EVERYTHING } from '@/lib/permissions'

const billing = (plan: PlanId) =>
  http.get('/api/v1/billing', () =>
    HttpResponse.json({ data: billingFixture({ plan, locked: false, status: 'active' }) }),
  )

const meta = {
  title: 'Members/Access permissions',
  parameters: { msw: { handlers: [billing('business')] } },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

function Editor({
  initial = EVERYTHING,
  owner = false,
  admin = false,
}: {
  initial?: string[]
  owner?: boolean
  admin?: boolean
}) {
  const [scopes, setScopes] = useState(initial)
  return (
    <div className="max-w-xl">
      <AccessEditor value={scopes} onChange={setScopes} canChangeHR={owner} admin={admin} />
      <output aria-label="Scopes">{scopes.join(', ') || 'None'}</output>
    </div>
  )
}

const OWNER_ONLY = 'Only the workspace owner can change access to employees and payroll.'

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
    const areas = within(canvas.getByRole('table', { name: 'Area' }))
    const firstRow = areas.getAllByRole('row')[1]
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

/** An owner sets the two HR rows; Full access brings Payroll View, Read only no HR access. */
export const HRRowsForOwner: Story = {
  render: () => <Editor owner initial={['read:*']} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const scopes = canvas.getByRole('status', { name: 'Scopes' })
    const hr = within(canvas.getByRole('table', { name: 'Employees and payroll' }))
    await expect(hr.getByRole('radio', { name: 'Payroll: No access' })).toBeChecked()
    await userEvent.click(canvas.getByRole('radio', { name: 'Full access' }))
    await expect(hr.getByRole('radio', { name: 'Payroll: View' })).toBeChecked()
    await expect(hr.getByRole('radio', { name: 'Employees: No access' })).toBeChecked()
    await expect(scopes).toHaveTextContent('*:*, read:payroll')
    await userEvent.click(hr.getByRole('radio', { name: 'Employees: Edit' }))
    await expect(canvas.getByText(/HR: edit employees and view payroll/)).toBeVisible()
    await userEvent.click(canvas.getByRole('radio', { name: 'Read only' }))
    await expect(scopes).toHaveTextContent(/^read:\*$/)
    // The sealed fields are explained behind the help icon, not in a paragraph.
    await userEvent.hover(
      canvas.getByRole('button', { name: 'About access to employees and payroll' }),
    )
    await expect(
      await within(document.body).findByRole('tooltip', { name: /only Payroll Edit can reveal/ }),
    ).toBeVisible()
  },
}

/** Anyone but the owner sees the HR rows without being able to change them, and why. */
export const HRRowsLockedForAdmin: Story = {
  render: () => <Editor initial={['*:*', 'read:payroll']} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const table = canvas.getByRole('table', { name: 'Employees and payroll' })
    const hr = within(table)
    for (const radio of hr.getAllByRole('radio')) await expect(radio).toBeDisabled()
    await expect(hr.getByRole('radio', { name: 'Payroll: View' })).toBeChecked()
    // A preset leaves the HR rows as they are.
    await userEvent.click(canvas.getByRole('radio', { name: 'Read only' }))
    await expect(canvas.getByRole('status', { name: 'Scopes' })).toHaveTextContent(
      'read:*, read:payroll',
    )
    await userEvent.hover(hr.getByRole('rowheader', { name: /Payroll/ }))
    await expect(
      await within(document.body).findByRole('tooltip', { name: OWNER_ONLY }),
    ).toBeVisible()
    await userEvent.unhover(hr.getByRole('rowheader', { name: /Payroll/ }))
    await waitFor(() => expect(within(document.body).queryByRole('tooltip')).toBeNull())
    // The same reason by keyboard, on the lock beside the heading.
    const lock = hr.getByRole('button', { name: OWNER_ONLY })
    lock.focus()
    await expect(
      await within(document.body).findByRole('tooltip', { name: OWNER_ONLY }),
    ).toBeVisible()
  },
}

/** An admin's access: every general area at full, only the HR rows to set, by the owner. */
export const AdminHROnly: Story = {
  render: () => <Editor owner admin initial={ADMIN_HR} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('group', { name: 'Access' })).toBeNull()
    await expect(canvas.queryByRole('table', { name: 'Area' })).toBeNull()
    await expect(canvas.getByText('Full access as admin; HR: view payroll')).toBeVisible()
    await userEvent.click(canvas.getByRole('radio', { name: 'Payroll: Edit' }))
    await userEvent.click(canvas.getByRole('radio', { name: 'Employees: View' }))
    await expect(canvas.getByRole('status', { name: 'Scopes' })).toHaveTextContent(
      'read:employees, write:payroll',
    )
    await userEvent.click(canvas.getByRole('radio', { name: 'Employees: No access' }))
    await userEvent.click(canvas.getByRole('radio', { name: 'Payroll: No access' }))
    // No HR access is a valid choice for an admin: no "give access" problem.
    await expect(canvas.getByRole('status', { name: 'Scopes' })).toHaveTextContent('None')
    await expect(canvas.queryByRole('alert')).toBeNull()
  },
}

/** On a plan without Employees the HR rows are locked, with the plan tag used for every locked feature. */
export const WithoutEmployeesModule: Story = {
  parameters: { msw: { handlers: [billing('pro')] } },
  render: () => <Editor owner />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const hr = within(canvas.getByRole('table', { name: 'Employees and payroll' }))
    await expect(await hr.findByText('Business')).toBeVisible()
    for (const radio of hr.getAllByRole('radio')) await expect(radio).toBeDisabled()
    await userEvent.hover(hr.getByRole('rowheader', { name: /Employees/ }))
    await expect(
      await within(document.body).findByRole('tooltip', {
        name: 'Your plan doesn’t include employees and payroll; Business does.',
      }),
    ).toBeVisible()
    // Picking a preset then leaves the HR rows alone, even for the owner.
    await userEvent.click(canvas.getByRole('radio', { name: 'Read only' }))
    await expect(canvas.getByRole('status', { name: 'Scopes' })).toHaveTextContent(/^read:\*$/)
  },
}

const phone = {
  viewport: { options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } } },
}

export const HRRowsForOwnerPhone: Story = {
  ...HRRowsForOwner,
  parameters: { ...meta.parameters, ...phone },
  globals: { viewport: { value: 'phone' } },
}

export const HRRowsForOwnerDark: Story = {
  ...HRRowsForOwner,
  parameters: { ...meta.parameters, dark: true },
}

export const HRRowsLockedForAdminDark: Story = {
  ...HRRowsLockedForAdmin,
  parameters: { ...meta.parameters, dark: true },
}

export const AdminHROnlyPhone: Story = {
  ...AdminHROnly,
  parameters: { ...meta.parameters, ...phone },
  globals: { viewport: { value: 'phone' } },
}
