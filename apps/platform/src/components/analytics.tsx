'use client'
import { useQuery } from '@tanstack/react-query'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import type ReactGA from 'react-ga4'

import { billingKeys, fetchBilling, type Billing } from '@/lib/billing'
import { translate } from '@/lib/i18n'
import { useAuthConfig, useLoadedSession } from '@/lib/queries'

/**
 * Google Analytics of the platform when the server sets GOOGLE_ANALYTICS_ID (GET /api/v1/auth/config); another
 * installation sends nothing. Page views only, with the path alone: query strings (sign-in codes, searches) and
 * fragments never reach Google, as GA's own first page view is off and page_location is set from the path. The same
 * as staqly.ai's dashboard. Signed in, events carry the user's and workspace's pseudonyms (keyed hashes from the API,
 * never our ids), the role and the plan (`trial` during a trial, `none` without one), so one person counts once across
 * devices and reports split by workspace and plan.
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
  const plan = subscriptionPlan(useLoadedBilling())

  // Before the page views below, so a page opened signed in already carries them; null again after signing out.
  useEffect(() => {
    ga?.set({ user_id: userID, workspace_id: workspaceID, workspace_role: role, plan })
  }, [ga, userID, workspaceID, role, plan])

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

/** The billing PlanGate has loaded; never fetches it. */
function useLoadedBilling() {
  // The same queryFn as useBilling: an invalidation of ['billing'] may run it, and a query without one logs an error.
  return useQuery({ queryKey: billingKeys.overview, queryFn: fetchBilling, enabled: false }).data
}

/** The plan for analytics; null when unknown or billing is off (a self-hosted installation). */
export function subscriptionPlan(billing: Billing | undefined) {
  if (!billing?.enabled) {
    return null
  }
  if (billing.status === 'trialing') {
    return 'trial'
  }
  return billing.plan || 'none'
}
