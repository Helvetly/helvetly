import { describe, expect, it } from 'vitest'

import { DEFAULT_VIEW } from '@/lib/documents'

import { groupingLabel, inPreset, moveLevel, VIEW_PRESETS } from './group-controls'

describe('group by', () => {
  it('names any grouping by its levels in order', () => {
    expect(groupingLabel([])).toBe('Folders')
    expect(groupingLabel(['client', 'year'])).toBe('Client → Year')
    expect(groupingLabel(['year', 'type', 'client'])).toBe('Year → Type → Client')
  })

  it('moves a level up or down, never out of the list', () => {
    expect(moveLevel(['type', 'year', 'client'], 2, -1)).toEqual(['type', 'client', 'year'])
    expect(moveLevel(['type', 'year'], 0, 1)).toEqual(['year', 'type'])
    expect(moveLevel(['type', 'year'], 0, -1)).toEqual(['type', 'year'])
    expect(moveLevel(['type', 'year'], 1, 1)).toEqual(['type', 'year'])
  })

  it('knows the open preset', () => {
    const invoices = VIEW_PRESETS.find((preset) => preset.id === 'invoices')!
    const folders = VIEW_PRESETS.find((preset) => preset.id === 'folders')!
    expect(inPreset({ ...DEFAULT_VIEW, group: ['type', 'year'], type: 'invoices' }, invoices)).toBe(
      true,
    )
    expect(inPreset({ ...DEFAULT_VIEW, group: ['type', 'year'], type: 'quotes' }, invoices)).toBe(
      false,
    )
    expect(inPreset(DEFAULT_VIEW, folders)).toBe(true)
  })
})
