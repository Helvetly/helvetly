'use client'

import { useEffect } from 'react'
import ReactGA from 'react-ga4'

// Google Analytics (GA4) of www.helvetly.com, the measurement id baked in at build time (NEXT_PUBLIC_GA_ID; empty =
// off, so another installation sends nothing). Page views of client-side navigation come from its enhanced
// measurement (history changes). Off on any other host too (local dev, previews), and loaded after hydration so it
// stays out of the first bundle. The same as staqly.ai's.
export function Analytics() {
  useEffect(() => {
    const gaId = process.env.NEXT_PUBLIC_GA_ID
    const { hostname } = window.location

    if (!gaId || (hostname !== 'helvetly.com' && !hostname.endsWith('.helvetly.com'))) {
      return
    }

    if (!ReactGA.isInitialized) {
      ReactGA.initialize(gaId)
    }
  }, [])

  return null
}
