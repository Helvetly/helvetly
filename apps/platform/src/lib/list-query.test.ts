import { describe, expect, it } from 'vitest'

import {
  changeFor,
  formatTerm,
  inQuote,
  parseQuery,
  termLabel,
  termsOf,
  tokenize,
  type QueryField,
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
})
