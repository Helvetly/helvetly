// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  dashboardLayoutKey,
  loadDashboardLayout,
  mergeDashboardLayout,
  moveDashboardCard,
  packDashboardRows,
  passesMiddle,
  saveDashboardLayout,
} from './dashboard-layout'

const cards = ['cash-flow', 'year-over-year', 'attention', 'spending']
const key = dashboardLayoutKey('workspace', 'user')

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

const chart = (id: string) => ({ id, min: 6, preferred: 8 })
const list = (id: string) => ({ id, min: 4, preferred: 4 })
const spans = (packed: Parameters<typeof packDashboardRows>[0]) =>
  packDashboardRows(packed).map((row) => row.map(({ id, span }) => `${id}:${span}`))

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
  it('takes a place only once the pointer is past its middle, the way the card moves', () => {
    const target = { left: 100, top: 0, width: 200, height: 100 }
    // Same row: across the middle at x = 200.
    expect(passesMiddle(target, { x: 150, y: 50 }, true, true)).toBe(false)
    expect(passesMiddle(target, { x: 250, y: 50 }, true, true)).toBe(true)
    expect(passesMiddle(target, { x: 250, y: 50 }, false, true)).toBe(false)
    expect(passesMiddle(target, { x: 150, y: 50 }, false, true)).toBe(true)
    // Another row: down or up across the middle at y = 50, wherever across.
    expect(passesMiddle(target, { x: 290, y: 20 }, true, false)).toBe(false)
    expect(passesMiddle(target, { x: 110, y: 80 }, true, false)).toBe(true)
    expect(passesMiddle(target, { x: 110, y: 20 }, false, false)).toBe(true)
    expect(passesMiddle(target, { x: 110, y: 80 }, false, false)).toBe(false)
  })
  describe('row packing', () => {
    it('fills every row exactly, in order', () => {
      expect(spans([chart('a'), list('b'), chart('c'), list('d')])).toEqual([
        ['a:8', 'b:4'],
        ['c:8', 'd:4'],
      ])
    })
    it('keeps two charts together at half and half, and moves a list on to the next row', () => {
      expect(spans([chart('cash'), chart('years'), list('attention')])).toEqual([
        ['cash:6', 'years:6'],
        ['attention:12'],
      ])
      // Needs attention moved to the bottom: the charts share their row.
      expect(spans([chart('cash'), chart('years'), list('spend'), list('attention')])).toEqual([
        ['cash:6', 'years:6'],
        ['spend:6', 'attention:6'],
      ])
    })
    it('shares leftover room evenly, so small cards never end narrow beside wide', () => {
      expect(spans([list('a'), list('b'), list('c')])).toEqual([['a:4', 'b:4', 'c:4']])
      expect(spans([list('a'), list('b')])).toEqual([['a:6', 'b:6']])
      expect(spans([chart('a')])).toEqual([['a:12']])
      expect(spans([list('a'), chart('b')])).toEqual([['a:4', 'b:8']])
      expect(spans([chart('a'), list('b'), list('c')])).toEqual([['a:8', 'b:4'], ['c:12']])
    })
  })
})
