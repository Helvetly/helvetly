'use client'

import { defaultLocale, localizedHref } from '@helvetly/i18n'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'

import { CHOOSE_PLAN_PATH } from '@/components/shell/plan-gate'
import type { Session } from '@/lib/api'
import { useBilling } from '@/lib/billing'
import { safeNextPath } from '@/lib/safe'

export const WELCOME_PATH = '/welcome'

/** Whether `pathname` is the welcome (the static export serves it as /welcome/). */
export const isWelcome = (pathname: string) =>
  localizedHref(pathname, defaultLocale).replace(/\/$/, '') === WELCOME_PATH

/** The welcome, coming back to `next` once it is finished. */
export function welcomeHref(next: string) {
  const safe = safeNextPath(next)
  return safe === '/' || isWelcome(new URL(safe, 'http://x').pathname)
    ? WELCOME_PATH
    : `${WELCOME_PATH}?next=${encodeURIComponent(safe)}`
}

/**
 * Sends someone who hasn't seen the welcome yet to /welcome, from whichever page they opened; the
 * page doesn't render meanwhile, so it never flashes. The welcome sends them back when it ends.
 * A plan comes first: the welcome saves the company, which a workspace without a plan may not, so
 * until it has one the welcome waits and the plan picker (PlanGate) is where they go.
 */
export function OnboardingRedirect({
  session,
  children,
}: {
  session: Session
  children: ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const billing = useBilling()
  const fresh = session.onboarded === false
  // As in PlanGate, only the first answer is waited for.
  const waiting =
    fresh && billing.isPending && billing.failureCount === 0 && billing.errorUpdateCount === 0
  const locked = Boolean(billing.data?.enabled && billing.data.locked)
  const welcome = isWelcome(pathname)
  const away = fresh && !waiting && (locked ? welcome : !welcome)

  useEffect(() => {
    if (!away) return
    router.replace(
      locked ? CHOOSE_PLAN_PATH : welcomeHref(window.location.pathname + window.location.search),
    )
  }, [away, locked, router])

  return away || waiting ? null : children
}
