'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import type ReactGA from 'react-ga4'

import { translate } from '@/lib/i18n'
import { useAuthConfig } from '@/lib/queries'

/**
 * Google Analytics of the platform when the server sets GOOGLE_ANALYTICS_ID (GET /api/v1/auth/config); another
 * installation sends nothing. Page views only, with the path alone: query strings (sign-in codes, searches) and
 * fragments never reach Google, as GA's own first page view is off and page_location is set from the path. The same
 * as staqly.ai's dashboard.
 */
export function Analytics() {
  const id = useAuthConfig().data?.google_analytics_id
  const pathname = usePathname()
  const [ga, setGa] = useState<typeof ReactGA>()

  useEffect(() => {
    if (!id) {
      return
    }

    void import('react-ga4').then(({ default: g }) => {
      if (!g.isInitialized) {
        g.initialize(id, { gtagOptions: { send_page_view: false } })
      }

      setGa(g)
    })
  }, [id])

  useEffect(() => {
    if (!ga) {
      return
    }

    const location = window.location.origin + pathname
    ga.set({ page_location: location, page_title: 'Helvetly' })
    ga.send({ hitType: 'pageview', page: pathname, location, title: translate('helvetly') })
  }, [ga, pathname])

  return null
}
