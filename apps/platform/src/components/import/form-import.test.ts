import { describe, expect, it } from 'vitest'

import { valuesFromImport as clientValues } from '@/components/clients/client-form-model'
import {
  FALLBACK_DEFAULTS,
  valuesFromImport as engagementValues,
} from '@/components/engagements/engagement-form-model'
import { valuesFromImport as productValues } from '@/components/products/product-form-model'

import { choiceOf, UNIT_CHOICES } from './form-import'
import { inputChanges } from './record-form'

describe('choiceOf', () => {
  const choices = [{ value: 'advance', aliases: ['in advance', 'upfront'] }]
  it.each([
    ['advance', 'advance'],
    ['In Advance', 'advance'],
    ['up-front', 'advance'],
    ['h', 'hour'],
  ])('maps %s', (word, expected) => {
    expect(choiceOf(word, [...choices, ...UNIT_CHOICES])).toBe(expected)
  })
  it('tells an unknown word from none', () => {
    expect(choiceOf('weird', choices)).toBeNull()
    expect(choiceOf('  ', choices)).toBeUndefined()
    expect(choiceOf(undefined, choices)).toBeUndefined()
  })
})

describe('inputChanges', () => {
  it('keeps only the record fields and clears empty ones', () => {
    expect(
      inputChanges(
        { title: 'Lessons', description: ' ', interval: 2, rollover: true, product_id: 'p1' },
        ['title', 'description', 'interval'],
      ),
    ).toEqual({ title: 'Lessons', description: null, interval: 2 })
  })
})

const read = (data: Record<string, string | number>) => engagementValues(data, FALLBACK_DEFAULTS)

describe('engagement valuesFromImport', () => {
  it('maps the document onto the form', () => {
    const { values, errors } = read({
      client_id: 'cli_1',
      client_name: 'Muster AG',
      title: 'German lessons',
      unit: 'hours',
      quantity: '20',
      unit_price: '150.00',
      currency: 'eur',
      billing: 'arrears',
      recurrence: 'Monthly',
      interval: 1,
      start_date: '2026-01-01',
      vat_rate: '8.1 %',
    })
    expect(errors).toEqual({})
    expect(values).toMatchObject({
      client_id: 'cli_1',
      client_name: 'Muster AG',
      unit: 'hour',
      billing: 'arrears',
      recurrence: 'monthly',
      currency: 'EUR',
      vat_rate: '8.1',
      start_date: '2026-01-01',
      end_date: '',
    })
  })

  it.each([
    [{ unit_price: '100' }, 'advance'],
    [{}, 'paid'],
    [{ billing: 'advance', unit_price: '0' }, 'paid'],
    [{ billing: 'paid separately', unit_price: '100' }, 'paid'],
  ])('works out billing from %j', (data, billing) => {
    expect(read(data).values.billing).toBe(billing)
  })

  it('marks values the form has no choice for', () => {
    const { values, errors } = read({
      billing: 'whenever',
      recurrence: 'fortnightly',
      unit: 'parsec',
      start_date: 'next spring',
    })
    expect(Object.keys(errors).toSorted()).toEqual(['billing', 'recurrence', 'start_date', 'unit'])
    expect(errors.billing).toContain('whenever')
    expect(values.recurrence).toBe('none')
    expect(values.start_date).toBe('')
  })
})

describe('product valuesFromImport', () => {
  it('maps the type and flags an unknown category', () => {
    const { values, errors } = productValues(
      { type: 'goods', name: 'Cable', unit: 'pcs', vat_category: 'X' },
      FALLBACK_DEFAULTS,
    )
    expect(values).toMatchObject({ type: 'product', name: 'Cable', unit: 'piece' })
    expect(Object.keys(errors)).toEqual(['vat_category'])
  })
})

describe('client valuesFromImport', () => {
  it('maps the client and flags an unknown country', () => {
    const { values, errors } = clientValues({
      name: 'Muster AG',
      is_company: true,
      language: 'German',
      country: 'Narnia',
    })
    expect(values).toMatchObject({ name: 'Muster AG', is_company: true, language: 'de' })
    expect(Object.keys(errors)).toEqual(['country'])
  })
})
