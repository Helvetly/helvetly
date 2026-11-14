import { afterEach, expect, it } from 'vitest'

import { today } from '@/lib/invoices'
import { setWorkspaceTimezone, todayIn } from '@/lib/timezone'

afterEach(() => setWorkspaceTimezone('Europe/Zurich'))

it('reads the date in the given zone', () => {
  const now = new Date('2026-11-07T20:00:00Z')
  expect(todayIn('Europe/Zurich', now)).toBe('2026-11-07')
  expect(todayIn('Pacific/Auckland', now)).toBe('2026-11-08')
})

it('follows the workspace zone set from the session', () => {
  const now = new Date('2026-11-07T20:00:00Z')
  setWorkspaceTimezone('Pacific/Auckland')
  expect(today(now)).toBe('2026-11-08')
  setWorkspaceTimezone(undefined)
  expect(today(now)).toBe('2026-11-08')
})
