import { describe, expect, it } from 'vitest'

import type { MonthActivity } from '@/lib/books'
import type { LegalForms } from '@/lib/legal-forms'

import { legalFormMissing, monthsToClose } from './attention'

const source = (recorded: number, drafts = 0) => ({ recorded, drafts, totals: [] })
const month = (m: string, invoices = 0, drafts = 0): MonthActivity => ({
  month: m,
  invoices: source(invoices, drafts),
  expenses: null,
})

describe('monthsToClose', () => {
  const ended = ['2026-10', '2026-09', '2026-08']
  it.each([
    ['all open with records, oldest first', new Set<string>(), ['2026-08', '2026-09', '2026-10']],
    ['closed months are left out', new Set(['2026-10']), ['2026-08', '2026-09']],
    ['everything closed', new Set(ended), []],
  ])('%s', (_, closed, expected) => {
    const activity = ended.map((m) => month(m, 2))
    expect(monthsToClose(ended, closed, activity)).toEqual(expected)
  })

  it('skips months without records and counts drafts as activity', () => {
    const activity = [month('2026-10', 0, 1), month('2026-09'), month('2026-08', 0)]
    expect(monthsToClose(ended, new Set(), activity)).toEqual(['2026-10'])
    expect(monthsToClose(ended, new Set(), [])).toEqual([])
  })
})

const settings = (country: string, legal_form: string | null) => ({
  seller: { country, legal_form },
})

describe('legalFormMissing', () => {
  const forms: LegalForms = { CH: [{ code: 'gmbh', group: 'company', name: 'GmbH' }] }
  it.each([
    ['a Swiss company without a form', settings('CH', null), forms, true],
    ['a Swiss company with its form', settings('CH', 'gmbh'), forms, false],
    ['a country without a list', settings('US', null), forms, false],
    ['the list not loaded yet', settings('CH', null), undefined, false],
    ['the settings not loaded yet', undefined, forms, false],
  ])('%s', (_, value, list, expected) => {
    expect(legalFormMissing(value, list)).toBe(expected)
  })
})
