'use client'

// The currency the app charges by region, as apps/api/internal/billing/currency.go picks it from the workspace's
// time zone (which the browser gives at sign-up): CHF in Switzerland and Liechtenstein, EUR in the EU, USD
// elsewhere. The figures are the same in each. currency.test.ts checks this list against the Go one.
import { useSyncExternalStore } from 'react'

export type Currency = 'chf' | 'eur' | 'usd'

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

export function currencyOf(timeZone: string): Currency {
  if (CHF_ZONES.includes(timeZone)) return 'chf'
  return EUR_ZONES.includes(timeZone) ? 'eur' : 'usd'
}

const browserCurrency = () => currencyOf(Intl.DateTimeFormat().resolvedOptions().timeZone)
const noChanges = () => () => {}

/** The visitor's currency from their time zone; CHF in the static export, until the page hydrates. */
export function useCurrency(): Currency {
  return useSyncExternalStore(noChanges, browserCurrency, () => 'chf')
}

/** What the prices include: VAT in francs and euros, sales tax (where due) in dollars. */
export function taxNote(currency: Currency): string {
  return currency === 'usd' ? 'incl. tax' : 'incl. VAT'
}
