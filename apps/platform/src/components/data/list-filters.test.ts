import { oneValue, type QueryField } from '@/lib/list-query'

import { activeFilters, datePresets, filterFields } from './list-filters'

type Params = {
  name: string
  units: string[]
  from: string | null
  to: string | null
  view: number
}

const fields: QueryField<Params>[] = [
  // Text the search covers: no popover control.
  {
    id: 'name',
    label: 'Name',
    type: 'text',
    ...oneValue(
      (p) => p.name || null,
      (name) => ({ name: name ?? '' }),
    ),
  },
  {
    id: 'unit',
    label: 'Unit',
    type: 'enum',
    values: [{ value: 'hour', label: 'Hour' }],
    placeholder: 'Any unit…',
    get: (p) => p.units,
    set: (units) => ({ units }),
  },
  {
    id: 'from',
    label: 'From',
    type: 'date',
    placeholder: 'Any date…',
    until: 'to',
    ...oneValue(
      (p) => p.from,
      (from) => ({ from }),
    ),
  },
  {
    id: 'to',
    label: 'To',
    type: 'date',
    ...oneValue(
      (p) => p.to,
      (to) => ({ to }),
    ),
  },
]

const none: Params = { name: '', units: [], from: null, to: null, view: 0 }

test('the popover shows fields with a placeholder and clears their range ends too', () => {
  const { shown, all } = filterFields(fields)
  expect(shown.map((field) => field.id)).toEqual(['unit', 'from'])
  expect(all.map((field) => field.id)).toEqual(['unit', 'from', 'to'])
})

test('counts set controls, a date range once, and never the search text', () => {
  expect(activeFilters(fields, none)).toBe(0)
  expect(activeFilters(fields, { ...none, name: 'acme' })).toBe(0)
  expect(activeFilters(fields, { ...none, units: ['hour'], from: '2026-01-01' })).toBe(2)
  expect(activeFilters(fields, { ...none, from: '2026-01-01', to: '2026-01-31' })).toBe(1)
  expect(activeFilters(fields, { ...none, to: '2026-01-31' })).toBe(1)
})

test('date presets are whole calendar ranges up to today', () => {
  const presets = datePresets('2026-11-05')
  expect(presets.find((preset) => preset.label === 'Last month')).toEqual({
    label: 'Last month',
    from: '2026-10-01',
    to: '2026-10-31',
  })
  expect(presets.find((preset) => preset.label === 'This year')).toMatchObject({
    from: '2026-01-01',
    to: '2026-11-05',
  })
})
