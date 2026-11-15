'use client'

// The currency the app charges by region, as apps/api/internal/billing/currency.go picks it: CHF in Switzerland and
// Liechtenstein, EUR in the EU, USD elsewhere, by the visitor's country from Cloudflare, else by time zone. The
// figures are the same in each. currency.test.ts checks these lists against the Go ones.
import { useEffect, useState, useSyncExternalStore } from 'react'

export type Currency = 'chf' | 'eur' | 'usd'

export const CHF_COUNTRIES = ['CH', 'LI']

/** The EU-27, and the outermost regions Cloudflare names apart from their country. */
export const EUR_COUNTRIES = [
  'AT',
  'BE',
  'BG',
  'HR',
  'CY',
  'CZ',
  'DK',
  'EE',
  'FI',
  'FR',
  'DE',
  'GR',
  'HU',
  'IE',
  'IT',
  'LV',
  'LT',
  'LU',
  'MT',
  'NL',
  'PL',
  'PT',
  'RO',
  'SK',
  'SI',
  'ES',
  'SE',
  'AX',
  'GF',
  'GP',
  'MQ',
  'RE',
  'YT',
  'MF',
]

export const CHF_ZONES = ['Europe/Zurich', 'Europe/Vaduz']

/** The EU-27's time zones, their outermost regions included. */
export const EUR_ZONES = [
  'Europe/Vienna',
  'Europe/Brussels',
  'Europe/Sofia',
  'Europe/Zagreb',
  'Asia/Nicosia',
  'Asia/Famagusta',
  'Europe/Nicosia',
  'Europe/Prague',
  'Europe/Copenhagen',
  'Europe/Tallinn',
  'Europe/Helsinki',
  'Europe/Mariehamn',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Busingen',
  'Europe/Athens',
  'Europe/Budapest',
  'Europe/Dublin',
  'Europe/Rome',
  'Europe/Riga',
  'Europe/Vilnius',
  'Europe/Luxembourg',
  'Europe/Malta',
  'Europe/Amsterdam',
  'Europe/Warsaw',
  'Europe/Lisbon',
  'Atlantic/Madeira',
  'Atlantic/Azores',
  'Europe/Bucharest',
  'Europe/Bratislava',
  'Europe/Ljubljana',
  'Europe/Madrid',
  'Africa/Ceuta',
  'Atlantic/Canary',
  'Europe/Stockholm',
  'America/Cayenne',
  'America/Guadeloupe',
  'America/Martinique',
  'Indian/Reunion',
  'Indian/Mayotte',
]

/** The currency of a country (ISO 3166-1 alpha-2), else, without one, of an IANA time zone. */
export function currencyOf(country: string, timeZone: string): Currency {
  if (country) {
    if (CHF_COUNTRIES.includes(country)) return 'chf'
    return EUR_COUNTRIES.includes(country) ? 'eur' : 'usd'
  }
  if (CHF_ZONES.includes(timeZone)) return 'chf'
  return EUR_ZONES.includes(timeZone) ? 'eur' : 'usd'
}

/** The `loc=` of Cloudflare's /cdn-cgi/trace; '' when unknown (XX, Tor's T1) or not there. */
export function traceCountry(trace: string): string {
  const loc = /^loc=([A-Z]{2})$/m.exec(trace)?.[1] ?? ''
  return loc === 'XX' || loc === 'T1' ? '' : loc
}

/**
 * The visitor's currency: CHF in the static export, then by time zone once the page runs, then by the country
 * Cloudflare saw, from its same-origin /cdn-cgi/trace (the site is served by Cloudflare; elsewhere it is missing
 * and the time zone stays).
 */
export function useCurrency(): Currency {
  const zone = useSyncExternalStore(noChanges, browserZone, () => '')
  const [country, setCountry] = useState('')
  useEffect(() => {
    const ask = new AbortController()
    fetch('/cdn-cgi/trace', { signal: ask.signal })
      .then((res) => (res.ok ? res.text() : ''))
      .then((trace) => setCountry(traceCountry(trace)))
      .catch(() => {}) // no trace (local, blocked): the time zone stays
    return () => ask.abort()
  }, [])
  return zone || country ? currencyOf(country, zone) : 'chf'
}

const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
const noChanges = () => () => {}

/** What the prices include: VAT in francs and euros, sales tax (where due) in dollars. */
export function taxNote(currency: Currency): string {
  return currency === 'usd' ? 'incl. tax' : 'incl. VAT'
}
