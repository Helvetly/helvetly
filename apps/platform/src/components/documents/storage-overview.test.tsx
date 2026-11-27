import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'

import type { Usage } from '@/lib/documents'

import { StorageOverview } from './storage-overview'

const empty: Usage = { files: 0, size: 0, by_kind: [], trash: { files: 0, size: 0 } }

it.each([
  { used: 0, capacity: 100, free: '100 B' },
  { used: 140, capacity: 100, free: '0 B' },
  { used: 0, capacity: 0, free: '0 B' },
])('shows $free free at $used of $capacity bytes', ({ used, capacity, free }) => {
  render(
    <StorageOverview
      usage={{ ...empty, stored_bytes: used, capacity_bytes: capacity }}
      onTrash={() => {}}
    />,
  )
  expect(screen.getByText('Free space').closest('li')).toHaveTextContent(free)
})

it.each([
  { capacity: -1, unlimited: true },
  { capacity: undefined, unlimited: false },
])('only labels an explicitly uncapped workspace as unlimited', ({ capacity, unlimited }) => {
  render(<StorageOverview usage={{ ...empty, capacity_bytes: capacity }} onTrash={() => {}} />)
  expect(screen.queryByText('Free space')).toBeNull()
  expect(screen.getByRole('region').textContent?.includes('Unlimited')).toBe(unlimited)
})
