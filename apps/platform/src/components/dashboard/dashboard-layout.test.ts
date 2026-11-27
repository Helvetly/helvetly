// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  dashboardLayoutKey,
  loadDashboardLayout,
  mergeDashboardLayout,
  moveDashboardCard,
  saveDashboardLayout,
} from './dashboard-layout'

const cards = ['cash-flow', 'year-over-year', 'attention', 'spending']
const key = dashboardLayoutKey('workspace', 'user')

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('dashboard layout', () => {
  it('keeps the saved order and visibility, ignoring removed and repeated cards', () => {
    expect(
      mergeDashboardLayout(cards, {
        order: ['attention', 'removed', 'cash-flow', 'attention', 'spending'],
        hidden: ['removed', 'spending', 'spending', false],
      }),
    ).toEqual({
      order: ['attention', 'year-over-year', 'cash-flow', 'spending'],
      hidden: ['spending'],
    })
  })

  it('uses defaults for missing or malformed data', () => {
    for (const stored of [null, 2, { order: 'attention', hidden: 'spending' }]) {
      expect(mergeDashboardLayout(cards, stored)).toEqual({ order: cards, hidden: [] })
    }
    localStorage.setItem(key, '{')
    expect(loadDashboardLayout(key, cards)).toEqual({ order: cards, hidden: [] })
  })

  it('persists and resets one workspace and user independently', () => {
    const saved = { order: cards.toReversed(), hidden: ['attention'] }
    saveDashboardLayout(key, saved)
    expect(loadDashboardLayout(key, cards)).toEqual(saved)
    expect(loadDashboardLayout(dashboardLayoutKey('other', 'user'), cards).hidden).toEqual([])
    expect(loadDashboardLayout(dashboardLayoutKey('workspace', 'other'), cards).hidden).toEqual([])
    saveDashboardLayout(key, null)
    expect(loadDashboardLayout(key, cards)).toEqual({ order: cards, hidden: [] })
  })

  it('handles unavailable local storage', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('Storage blocked')
    })
    expect(loadDashboardLayout(key, cards)).toEqual({ order: cards, hidden: [] })
    expect(() => saveDashboardLayout(key, { order: cards, hidden: [] })).not.toThrow()
    expect(() => saveDashboardLayout(key, null)).not.toThrow()
  })

  it('moves cards in either direction and keeps the other cards in order', () => {
    expect(moveDashboardCard(cards, 'cash-flow', 'attention')).toEqual([
      'year-over-year',
      'attention',
      'cash-flow',
      'spending',
    ])
    expect(moveDashboardCard(cards, 'spending', 'year-over-year')).toEqual([
      'cash-flow',
      'spending',
      'year-over-year',
      'attention',
    ])
    expect(moveDashboardCard(cards, 'cash-flow', 'removed')).toBe(cards)
  })
})
