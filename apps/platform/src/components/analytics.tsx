'use client'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import type ReactGA from 'react-ga4'

import { translate } from '@/lib/i18n'
import { useAuthConfig, useLoadedSession } from '@/lib/queries'

/**
 * Google Analytics of the platform when the server sets GOOGLE_ANALYTICS_ID (GET /api/v1/auth/config); another
 * installation sends nothing. Page views only, with the path alone: query strings (sign-in codes, searches) and
 * fragments never reach Google, as GA's own first page view is off and page_location is set from the path. The same
 * as staqly.ai's dashboard. Signed in, events carry the user's and workspace's pseudonyms (keyed hashes from the API,
 * never our ids) and the role, so one person counts once across devices and workspaces can be told apart.
 */
export function Analytics() {
  const id = useAuthConfig().data?.google_analytics_id
  const pathname = usePathname()
  const session = useLoadedSession()
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

  const userID = session?.analytics?.user_id ?? null
  const workspaceID = session?.analytics?.workspace_id ?? null
  const role = session?.role ?? null

  // Before the page views below, so a page opened signed in already carries them; null again after signing out.
  useEffect(() => {
    ga?.set({ user_id: userID, workspace_id: workspaceID, workspace_role: role })
  }, [ga, userID, workspaceID, role])

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
