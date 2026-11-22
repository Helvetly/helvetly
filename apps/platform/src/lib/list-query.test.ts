import { describe, expect, it, vi } from 'vitest'

import { setWorkspaceTimezone } from '@/lib/timezone'

import {
  chipTone,
  chipValues,
  changeFor,
  formatTerm,
  inQuote,
  parseQuery,
  termLabel,
  termsOf,
  tokenize,
  type QueryField,
  amountParam,
  oneValue,
  sinceDate,
} from './list-query'

type Params = { status: string[]; type: string | null; name: string; from: string; total: string }

const fields: QueryField<Params>[] = [
  {
    id: 'status',
    label: 'Status',
    type: 'enum',
    values: [
      { value: 'active', label: 'Active' },
      { value: 'draft', label: 'Draft' },
    ],
    get: (params) => params.status,
    set: (status) => ({ status }),
  },
  {
    id: 'type',
    label: 'Type',
    type: 'enum',
    values: [{ value: 'person', label: 'Person' }],
    get: (params) => (params.type ? [params.type] : []),
    set: (values) => ({ type: values.at(-1) ?? null }),
  },
  {
    id: 'name',
    label: 'Name',
    type: 'text',
    get: (params) => (params.name ? [params.name] : []),
    set: (values) => ({ name: values.at(-1) ?? '' }),
  },
  {
    id: 'from',
    label: 'From',
    type: 'date',
    get: (params) => (params.from ? [params.from] : []),
    set: (values) => ({ from: values.at(-1) ?? '' }),
  },
  {
    id: 'total',
    label: 'Total',
    type: 'number',
    get: (params) => (params.total ? [params.total] : []),
    set: (values) => ({ total: values.at(-1) ?? '' }),
  },
]

describe('tokenize', () => {
  it.each([
    ['', []],
    ['  acme   ag ', ['acme', 'ag']],
    ['name:"Acme AG" zurich', ['name:"Acme AG"', 'zurich']],
    ['name:"open quote', ['name:"open quote']],
  ])('%j', (input, tokens) => expect(tokenize(input)).toEqual(tokens))

  it('knows an open quote', () => {
    expect(inQuote('name:"Acme ')).toBe(true)
    expect(inQuote('name:"Acme" ')).toBe(false)
  })
})

describe('parseQuery', () => {
  it.each([
    ['plain text stays text', 'acme ag', [], 'acme ag'],
    ['a term', 'status:active', [{ id: 'status', value: 'active' }], ''],
    ['terms and text', 'acme status:draft ag', [{ id: 'status', value: 'draft' }], 'acme ag'],
    ['enum by label, any case', 'STATUS:Active', [{ id: 'status', value: 'active' }], ''],
    ['field by label', 'Type:person', [{ id: 'type', value: 'person' }], ''],
    ['quoted value', 'name:"Acme AG" x', [{ id: 'name', value: 'Acme AG' }], 'x'],
    ['unknown field is text', 'city:zurich', [], 'city:zurich'],
    ['unknown enum value is text', 'status:bogus', [], 'status:bogus'],
    ['empty value is text', 'name:', [], 'name:'],
    ['negation is text', '-status:draft', [], '-status:draft'],
    ['url-like text', 'https://acme.ch', [], 'https://acme.ch'],
    ['valid date', 'from:2026-01-31', [{ id: 'from', value: '2026-01-31' }], ''],
    ['bad date is text', 'from:2026-13-45', [], 'from:2026-13-45'],
    ['number', 'total:12.5', [{ id: 'total', value: '12.5' }], ''],
    ['bad number is text', 'total:abc', [], 'total:abc'],
    ['negative amount is text', 'total:-5', [], 'total:-5'],
    ['three decimals are text', 'total:1.234', [], 'total:1.234'],
  ])('%s', (_, input, terms, text) => {
    expect(parseQuery(input, fields)).toEqual({ terms, text })
  })
})

describe('terms and params', () => {
  const params: Params = { status: ['active'], type: 'person', name: '', from: '', total: '' }

  it('reads terms from params', () => {
    expect(termsOf(fields, params)).toEqual([
      { id: 'status', value: 'active' },
      { id: 'type', value: 'person' },
    ])
  })

  it('writes every field, clearing those without terms and dropping duplicates', () => {
    expect(
      changeFor(
        fields,
        [
          { id: 'status', value: 'draft' },
          { id: 'status', value: 'draft' },
          { id: 'name', value: 'Acme AG' },
        ],
        params,
      ),
    ).toEqual({ status: ['draft'], type: null, name: 'Acme AG', from: '', total: '' })
  })

  it('formats and labels a term', () => {
    expect(formatTerm({ id: 'name', value: 'Acme AG' })).toBe('name:"Acme AG"')
    expect(formatTerm({ id: 'status', value: 'draft' })).toBe('status:draft')
    expect(termLabel(fields, { id: 'status', value: 'draft' })).toBe('Status: Draft')
    expect(termLabel(fields, { id: 'name', value: 'acme' })).toBe('Name: acme')
  })

  it('negates a value only for a negatable field, and types it back', () => {
    const negatable = fields.map((field) =>
      field.id === 'status' ? { ...field, negatable: true } : field,
    )
    expect(parseQuery('-status:draft -name:x', negatable)).toEqual({
      terms: [{ id: 'status', value: '!draft' }],
      text: '-name:x',
    })
    expect(formatTerm({ id: 'status', value: '!draft' })).toBe('-status:draft')
    expect(termLabel(negatable, { id: 'status', value: '!draft' })).toBe('Status: not Draft')
  })

  it("groups a field's values into one chip text", () => {
    const [status] = fields
    expect(chipValues(status, ['active'])).toMatchObject({ text: 'Active', rest: 0 })
    expect(chipValues(status, ['active', '!draft'])).toMatchObject({
      text: 'Active or not Draft',
      rest: 0,
    })
    expect(chipValues(status, ['active', 'draft', 'x', 'y'])).toEqual({
      text: 'Active, Draft',
      rest: 2,
      labels: ['Active', 'Draft', 'x', 'y'],
    })
  })

  it("tints a chip by its values' shared status tone, else by its field's kind", () => {
    const [status, type] = fields
    if (!status || !type) throw new Error('fields missing')
    const toned = { ...status, tones: { active: 'green', draft: 'neutral' } as const }
    expect(chipTone(toned, ['active'])).toBe('green')
    expect(chipTone(toned, ['active', 'draft'])).toBe('violet')
    expect(chipTone({ ...type, kind: 'location' }, ['person'])).toBe('green')
    expect(chipTone(fields[2] ?? type, ['x'])).toBe('neutral')
  })
})

describe('filter values', () => {
  it('reads amounts from the URL as the API takes them', () => {
    expect(amountParam('99.50')).toBe('99.50')
    expect(amountParam('100')).toBe('100')
    expect(amountParam('-1')).toBeNull()
    expect(amountParam('1e3')).toBeNull()
    expect(amountParam(null)).toBeNull()
  })

  it('turns a since preset into its first day', () => {
    const today = '2026-11-05'
    expect(sinceDate('7d', today)).toBe('2026-10-30')
    expect(sinceDate('30d', today)).toBe('2026-10-07')
    expect(sinceDate('year', today)).toBe('2026-01-01')
    expect(sinceDate('7d', '2026-03-31')).toBe('2026-03-25')
  })

  it('counts a since preset from today in the workspace zone, not the browser', () => {
    vi.useFakeTimers({ now: new Date('2026-12-31T23:30:00Z'), toFake: ['Date'] })
    setWorkspaceTimezone('Pacific/Kiritimati') // already 1 January 2027 there
    try {
      expect(sinceDate('year')).toBe('2027-01-01')
    } finally {
      setWorkspaceTimezone('Europe/Zurich')
      vi.useRealTimers()
    }
  })

  it('marks a one-value field as single, and a new term replaces the old', () => {
    const field = oneValue<{ unit: string | null }>(
      (params) => params.unit,
      (unit) => ({ unit }),
    )
    expect(field.single).toBe(true)
    expect(field.set(['hour', 'day'])).toEqual({ unit: 'day' })
    expect(field.set([])).toEqual({ unit: null })
  })
})
