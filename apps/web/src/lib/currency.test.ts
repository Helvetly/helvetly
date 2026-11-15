import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CHF_ZONES, currencyOf, EUR_ZONES, taxNote } from './currency'

describe('currency', () => {
  it('lists the same time zones as the API', () => {
    const go = readFileSync(join(__dirname, '../../../api/internal/billing/currency.go'), 'utf8')
    const zones = (cur: string) =>
      [...go.matchAll(/"([A-Za-z_]+\/[A-Za-z_]+)": (\w+)/g)]
        .filter((m) => m[2] === cur)
        .map((m) => m[1])
        .toSorted()
    expect(zones('Currency')).toEqual(CHF_ZONES.toSorted())
    expect(zones('EUR')).toEqual(EUR_ZONES.toSorted())
  })

  it.each([
    ['Europe/Zurich', 'chf'],
    ['Europe/Vaduz', 'chf'],
    ['Europe/Berlin', 'eur'],
    ['Atlantic/Canary', 'eur'],
    ['Europe/London', 'usd'],
    ['America/New_York', 'usd'],
    ['UTC', 'usd'],
  ])('%s pays in %s', (zone, currency) => {
    expect(currencyOf(zone)).toBe(currency)
  })

  it('names VAT for francs and euros, tax for dollars', () => {
    expect([taxNote('chf'), taxNote('eur'), taxNote('usd')]).toEqual([
      'incl. VAT',
      'incl. VAT',
      'incl. tax',
    ])
  })
})
