'use client'

import { useEffect } from 'react'

/** What starts Google Analytics: the visitor's first interaction, or this long on the page. */
const INTERACTIONS = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const
export const FALLBACK_MS = 10_000

declare global {
  interface Window {
    /** gtag's command queue: each entry is the `arguments` of one gtag() call. */
    dataLayer?: IArguments[]
  }
}

// gtag reads `arguments` objects from the queue, not arrays; the parameters only type the calls.
function gtag(_command: string, _value: unknown) {
  window.dataLayer?.push(arguments)
}

/** The standard gtag snippet: the queue, the config, and Google's script, loaded once. */
function startGtag(gaId: string) {
  if (window.dataLayer) return
  window.dataLayer = []
  gtag('js', new Date())
  gtag('config', gaId)
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`
  document.head.append(script)
}

// Google Analytics (GA4) of www.helvetly.com, the measurement id baked in at build time (NEXT_PUBLIC_GA_ID; empty =
// off, so another installation sends nothing). Off on any other host too (local dev, previews). Google's 175 KiB
// script waits for the first interaction or FALLBACK_MS, so it never competes with the first paint; page views of
// client-side navigation come from its enhanced measurement (history changes). The same as staqly.ai's.
export function Analytics() {
  useEffect(() => {
    const gaId = process.env.NEXT_PUBLIC_GA_ID
    const { hostname } = window.location

    if (!gaId || (hostname !== 'helvetly.com' && !hostname.endsWith('.helvetly.com'))) {
      return
    }

    const start = () => {
      stop()
      startGtag(gaId)
    }
    const timer = window.setTimeout(start, FALLBACK_MS)
    const stop = () => {
      window.clearTimeout(timer)
      for (const event of INTERACTIONS) window.removeEventListener(event, start)
    }
    for (const event of INTERACTIONS)
      window.addEventListener(event, start, { once: true, passive: true })
    return stop
  }, [])

  return null
}
