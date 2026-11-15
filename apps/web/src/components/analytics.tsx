'use client'

import { useEffect } from 'react'
import ReactGA from 'react-ga4'

// Google Analytics (GA4) of www.helvetly.com. Page views of client-side navigation come from its enhanced measurement
// (history changes).
const GA_ID = 'G-HLW69B5PV2'

// Off everywhere but helvetly.com (local dev, previews, forks), and loaded after hydration so it stays out of the
// first bundle. The same as staqly.ai's.
export function Analytics() {
  useEffect(() => {
    const { hostname } = window.location

    if (hostname !== 'helvetly.com' && !hostname.endsWith('.helvetly.com')) {
      return
    }

    if (!ReactGA.isInitialized) {
      ReactGA.initialize(GA_ID)
    }
  }, [])

  return null
}
