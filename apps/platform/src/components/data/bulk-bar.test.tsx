import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { render, screen } from '@testing-library/react'

import { BulkBar, bulkEntries } from './table-page'

let writable = true
vi.mock('@/lib/permissions', () => ({ useCanWriteHere: () => writable }))

const actions = [
  { label: 'Export CSV', icon: null, onClick: () => {} },
  { label: 'Delete', icon: null, onClick: () => {}, destructive: true, write: true },
]

function renderBar() {
  render(
    <TooltipProvider>
      <BulkBar count={2} actions={actions} onClear={() => {}} />
    </TooltipProvider>,
  )
}

test('with write, every action is there', () => {
  writable = true
  renderBar()
  expect(screen.getByRole('button', { name: 'Export CSV' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Delete' })).toBeVisible()
})

test('without write, only the read-only actions stay', () => {
  writable = false
  renderBar()
  expect(screen.getByRole('button', { name: 'Export CSV' })).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
})

const action = (label: string, more = {}) => ({ label, icon: null, onClick: () => {}, ...more })

test('groups gather paired actions, a lone one stays a button, destructive goes last', () => {
  const group = { label: 'Status', icon: null }
  const entries = bulkEntries(
    [
      action('Delete', { destructive: true }),
      action('Activate', { group }),
      action('Export'),
      action('Deactivate', { group }),
      action('Enable portal', { group: { label: 'Portal', icon: null } }),
    ],
    true,
  )
  expect(
    entries.map((entry) => (entry.kind === 'group' ? entry.group.label : entry.action.label)),
  ).toEqual(['Status', 'Export', 'Enable portal', 'Delete'])
})
