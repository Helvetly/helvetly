import { describe, expect, it } from 'vitest'

import { learnValues, type Habits } from '@/lib/habits'
import type { Product } from '@/lib/products'

import {
  addMonths,
  applyProduct,
  emptyValues,
  ENGAGEMENT_HABIT_FIELDS,
  habitValues,
  newValues,
  presetEnd,
  serverFieldErrors,
  committedTotal,
  nextSteps,
  schedulePeriods,
  summarySentence,
  toInput,
  validate,
  type FormValues,
} from './engagement-form-model'

const filled = (over: Partial<FormValues> = {}): FormValues => ({
  ...emptyValues(undefined, 'cli_1', 'Muster AG'),
  title: 'German lessons',
  quantity: '30',
  unit_price: '90',
  start_date: '2026-11-01',
  end_date: '2027-01-31',
  ...over,
})

describe('presetEnd', () => {
  it.each([
    ['2026-11-01', 1, '2026-11-30'],
    ['2026-11-01', 3, '2027-01-31'],
    ['2026-11-01', 12, '2027-10-31'],
    ['2026-08-31', 6, '2027-02-27'],
    ['2028-01-31', 1, '2028-02-28'],
  ])('%s + %i months', (start, months, end) => expect(presetEnd(start, months)).toBe(end))
  it('clamps the day', () => expect(addMonths('2026-01-31', 1)).toBe('2026-02-28'))
})

describe('validate', () => {
  it('needs an end for one-off', () =>
    expect(validate(filled({ end_date: '' }))).toEqual({
      end_date: 'Choose when the engagement ends',
    }))
  it('accepts a valid form and recurring without end', () => {
    expect(validate(filled())).toEqual({})
    expect(validate(filled({ recurrence: 'monthly', end_date: '' }))).toEqual({})
  })
  it('checks numbers and dates', () => {
    const errors = validate(
      filled({ quantity: '0', unit_price: '1.234', end_date: '2026-10-01', client_id: '' }),
    )
    expect(Object.keys(errors).toSorted()).toEqual([
      'client_id',
      'end_date',
      'quantity',
      'unit_price',
    ])
  })
  it('limits the interval', () =>
    expect(validate(filled({ recurrence: 'weekly', interval: '13' })).interval).toBeDefined())
})

describe('toInput', () => {
  it('sends decimal strings and nulls', () => {
    expect(toInput(filled({ quantity: '7,5', unit_price: "1'234.5" }))).toMatchObject({
      quantity: '7.5',
      unit_price: '1234.50',
      overage_unit_price: null,
      description: null,
      interval: 1,
      recurrence: 'none',
    })
  })
  it('keeps overage and zeroes VAT outside standard', () =>
    expect(
      toInput(filled({ overage_unit_price: '120', vat_category: 'E', vat_rate: '8.1' })),
    ).toMatchObject({ overage_unit_price: '120.00', vat_rate: '0' }))
})

describe('toInput automation', () => {
  it('defaults: no rollover, no auto drafts, summary lines', () =>
    expect(toInput(filled())).toMatchObject({
      rollover: false,
      auto_invoice: false,
      invoice_detail: 'summary',
    }))
  it('keeps rollover for advance + recurring', () =>
    expect(
      toInput(filled({ rollover: true, billing: 'advance', recurrence: 'monthly' })).rollover,
    ).toBe(true))
  it.each([
    ['one-off', { billing: 'advance', recurrence: 'none' }],
    ['arrears', { billing: 'arrears', recurrence: 'monthly' }],
  ] as const)('clears rollover when %s', (_name, over) =>
    expect(toInput(filled({ rollover: true, ...over })).rollover).toBe(false),
  )
  it('sends auto_invoice and per_entry detail', () =>
    expect(toInput(filled({ auto_invoice: true, invoice_detail: 'per_entry' }))).toMatchObject({
      auto_invoice: true,
      invoice_detail: 'per_entry',
    }))
})

describe('applyProduct', () => {
  it('fills title, unit, price and VAT', () => {
    const product = {
      id: 'prd_1',
      name: 'Tutoring',
      description: 'One to one',
      unit: 'day',
      price_basis: 'gross',
      unit_price: '540.00',
      currency: 'EUR',
      vat_category: 'S',
      vat_rate: '2.6',
    } as Product
    expect(applyProduct(filled(), product)).toMatchObject({
      product_id: 'prd_1',
      title: 'Tutoring',
      unit: 'day',
      price_basis: 'gross',
      unit_price: '540.00',
      currency: 'EUR',
      vat_rate: '2.6',
    })
  })
})

describe('serverFieldErrors', () => {
  it('maps known fields only', () =>
    expect(serverFieldErrors({ fields: { title: 'Too long', bogus: 'x', quantity: 3 } })).toEqual({
      title: 'Too long',
    }))
  it('ignores a missing fields object', () => expect(serverFieldErrors({})).toEqual({}))
})

describe('summarySentence', () => {
  it('one-off, upfront', () =>
    expect(summarySentence(filled(), 'Müller AG')).toBe(
      '30 h German lessons for Müller AG · 1.11.2026 – 31.1.2027 · billed upfront',
    ))
  it('recurring, arrears, no client yet', () =>
    expect(
      summarySentence(
        filled({ recurrence: 'monthly', end_date: '', billing: 'arrears', quantity: '8' }),
        '',
      ),
    ).toBe('8 h German lessons · every month from 1.11.2026 · billed after delivery'))
  it('says only the start while a one-off has no end', () =>
    expect(summarySentence(filled({ end_date: '' }), 'Muster AG')).toContain('· from 1.11.2026 ·'))
  it('is null without a quantity', () =>
    expect(summarySentence(filled({ quantity: '' }), 'Muster AG')).toBeNull())
})

describe('schedulePeriods', () => {
  it('anchors every period on the start day', () =>
    expect(
      schedulePeriods(filled({ recurrence: 'monthly', start_date: '2026-01-31', end_date: '' }), 3),
    ).toEqual([
      { start: '2026-01-31', end: '2026-02-27' },
      { start: '2026-02-28', end: '2026-03-30' },
      { start: '2026-03-31', end: '2026-04-29' },
    ]))
  it('cuts at the end date and stops after it', () =>
    expect(
      schedulePeriods(
        filled({
          recurrence: 'weekly',
          interval: '2',
          start_date: '2026-11-02',
          end_date: '2026-11-20',
        }),
        10,
      ),
    ).toEqual([
      { start: '2026-11-02', end: '2026-11-15' },
      { start: '2026-11-16', end: '2026-11-20' },
    ]))
  it('has none for a one-off', () => expect(schedulePeriods(filled(), 3)).toEqual([]))
})

describe('committedTotal', () => {
  it('is the period total for a one-off', () => expect(committedTotal(filled())).toBe('2700.00'))
  it('multiplies by the periods of a recurring one, and is unknown without an end', () => {
    const monthly = { recurrence: 'monthly', end_date: '2027-01-31' } as const
    expect(committedTotal(filled(monthly))).toBe('8100.00')
    expect(committedTotal(filled({ ...monthly, end_date: '' }))).toBeNull()
  })
})

describe('nextSteps', () => {
  it('says an advance draft follows when auto invoicing is on', () =>
    expect(nextSteps(filled({ auto_invoice: true }))).toContain(
      'An advance invoice draft is created when the period starts.',
    ))
  it('says nothing is automatic otherwise, and that recurring periods renew', () => {
    const steps = nextSteps(filled({ recurrence: 'monthly' }))
    expect(steps[0]).toMatch(/^No invoice is created automatically/)
    expect(steps).toContain('A new period with the same quantity starts automatically.')
  })
})

const twice = (values: ReturnType<typeof emptyValues>, scope?: string) =>
  [1, 2].reduce<Habits>(
    (habits) =>
      learnValues(habits, 'engagement', habitValues(values), ENGAGEMENT_HABIT_FIELDS, scope),
    {},
  )

describe('habits', () => {
  const defaults = { currency: 'CHF', vat_registered: true, default_vat_rate: '8.1' }
  it('starts with the usual unit, VAT category and length; the rate follows the settings', () => {
    const usual = {
      ...emptyValues(defaults),
      unit: 'day' as const,
      vat_category: 'E' as const,
      vat_rate: '0',
    }
    const habits = twice({ ...usual, end_date: presetEnd(usual.start_date, 6) })
    const values = newValues(defaults, habits)
    expect(values).toMatchObject({ unit: 'day', vat_category: 'E', vat_rate: '0' })
    expect(values.end_date).toBe(presetEnd(values.start_date, 6))
  })

  it('a client’s own habits come first, and an unregistered workspace stays outside VAT', () => {
    const habits = twice(
      { ...emptyValues(defaults), billing: 'arrears', vat_category: 'AE' },
      'cli_1',
    )
    expect(newValues(defaults, habits, 'cli_1').billing).toBe('arrears')
    expect(newValues(defaults, habits, 'cli_2').billing).toBe('arrears')
    const unregistered = { ...defaults, vat_registered: false }
    expect(newValues(unregistered, habits, 'cli_1')).toMatchObject({
      vat_category: 'O',
      vat_rate: '0',
    })
  })
})
