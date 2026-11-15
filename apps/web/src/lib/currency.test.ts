import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  CHF_COUNTRIES,
  CHF_ZONES,
  currencyOf,
  EUR_COUNTRIES,
  EUR_ZONES,
  taxNote,
  traceCountry,
} from './currency'

describe('currency', () => {
  const go = readFileSync(join(__dirname, '../../../api/internal/billing/currency.go'), 'utf8')
  const keys = (pattern: RegExp, cur: string) =>
    [...go.matchAll(pattern)]
      .filter((m) => m[2] === cur)
      .map((m) => m[1])
      .toSorted()

  it('lists the same countries and time zones as the API', () => {
    const zone = /"([A-Za-z_]+\/[A-Za-z_]+)": (\w+)/g
    const country = /"([A-Z]{2})": (\w+)/g
    expect(keys(zone, 'Currency')).toEqual(CHF_ZONES.toSorted())
    expect(keys(zone, 'EUR')).toEqual(EUR_ZONES.toSorted())
    expect(keys(country, 'Currency')).toEqual(CHF_COUNTRIES.toSorted())
    expect(keys(country, 'EUR')).toEqual(EUR_COUNTRIES.toSorted())
  })

  it.each([
    ['CH', '', 'chf'],
    ['LI', 'America/New_York', 'chf'],
    ['DE', 'Europe/Zurich', 'eur'],
    ['GB', 'Europe/Berlin', 'usd'],
    ['US', '', 'usd'],
    ['', 'Europe/Zurich', 'chf'],
    ['', 'Europe/Vaduz', 'chf'],
    ['', 'Europe/Berlin', 'eur'],
    ['', 'Atlantic/Canary', 'eur'],
    ['', 'Europe/London', 'usd'],
    ['', 'UTC', 'usd'],
  ])('country %j, zone %j pays in %s', (country, zone, currency) => {
    expect(currencyOf(country, zone)).toBe(currency)
  })

  it('reads the country from Cloudflare’s trace', () => {
    expect(traceCountry('fl=1\nh=helvetly.com\nloc=DE\ntls=TLSv1.3\n')).toBe('DE')
    expect(traceCountry('loc=XX\n')).toBe('')
    expect(traceCountry('loc=T1\n')).toBe('')
    expect(traceCountry('<html>404</html>')).toBe('')
    expect(traceCountry('')).toBe('')
  })

  it('names VAT for francs and euros, tax for dollars', () => {
    expect([taxNote('chf'), taxNote('eur'), taxNote('usd')]).toEqual([
      'incl. VAT',
      'incl. VAT',
      'incl. tax',
    ])
  })
})
