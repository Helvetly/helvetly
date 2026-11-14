import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { render, screen } from '@testing-library/react'

import { BulkBar } from './table-page'

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
