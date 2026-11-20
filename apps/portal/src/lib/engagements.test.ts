import { expect, test } from 'vitest'

import { isActive, mostRelevant, usedShare } from './engagements'
import type { PortalEngagement } from './portal'

const engagement = (
  id: string,
  used: string,
  endsOn: string,
  status: PortalEngagement['status'] = 'active',
): PortalEngagement => ({
  id,
  name: id,
  unit: 'hour',
  quantity: '10',
  recurrence: 'monthly',
  status,
  current_period: { starts_on: '2026-11-01', ends_on: endsOn, used, remaining: '0', overage: '0' },
})

test('usedShare is used over quantity, 0 without a period', () => {
  expect(usedShare(engagement('a', '4', '2026-11-30'))).toBe(0.4)
  expect(usedShare({ ...engagement('a', '4', '2026-11-30'), current_period: null })).toBe(0)
})

test('isActive is the active status', () => {
  expect(isActive(engagement('a', '1', '2026-11-30'))).toBe(true)
  expect(isActive(engagement('a', '1', '2026-11-30', 'ended'))).toBe(false)
})

test('mostRelevant takes the one closest to its limit, then the one ending soonest', () => {
  expect(
    mostRelevant([engagement('low', '2', '2026-11-25'), engagement('high', '8', '2026-12-30')])?.id,
  ).toBe('high')
  expect(
    mostRelevant([engagement('later', '5', '2026-12-30'), engagement('sooner', '5', '2026-11-25')])
      ?.id,
  ).toBe('sooner')
  expect(mostRelevant([engagement('past', '9', '2026-11-25', 'used_up')])).toBeUndefined()
  expect(mostRelevant([{ ...engagement('idle', '0', ''), current_period: null }])).toBeUndefined()
})
