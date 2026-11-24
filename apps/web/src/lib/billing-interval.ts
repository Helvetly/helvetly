'use client'
// The visitor's monthly or yearly choice on the pricing cards and table: yearly by default, kept for the session and
// put in the address (?billing=monthly|yearly) so a shared link shows the same prices. Client-side only: the static
// export renders yearly.
import type { BillingInterval } from '@helvetly/ui/components/billing-interval-toggle'
import { useSyncExternalStore } from 'react'

const KEY = 'helvetly.billing'
const PARAM = 'billing'
const IN_URL: Record<BillingInterval, string> = { month: 'monthly', year: 'yearly' }

const fromWord = (word: string | null): BillingInterval | null =>
  word === 'monthly' || word === 'month'
    ? 'month'
    : word === 'yearly' || word === 'year'
      ? 'year'
      : null

function stored(): string | null {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null // storage refused (private mode, blocked cookies): the address and the default stay
  }
}

/** The address's choice, then the session's, then yearly. */
export function currentInterval(): BillingInterval {
  return (
    fromWord(new URLSearchParams(window.location.search).get(PARAM)) ?? fromWord(stored()) ?? 'year'
  )
}

const listeners = new Set<() => void>()

export function chooseInterval(interval: BillingInterval) {
  try {
    sessionStorage.setItem(KEY, IN_URL[interval])
  } catch {
    // not kept for the session; the address still says it
  }
  const url = new URL(window.location.href)
  url.searchParams.set(PARAM, IN_URL[interval])
  window.history.replaceState(window.history.state, '', url)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener('popstate', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('popstate', listener)
  }
}

/** The chosen interval and the way to change it; every caller on the page shares it. */
export function useBillingInterval(): [BillingInterval, (interval: BillingInterval) => void] {
  return [useSyncExternalStore(subscribe, currentInterval, () => 'year'), chooseInterval]
}
