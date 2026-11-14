'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'

import type { Session } from '@/lib/api'
import { safeNextPath } from '@/lib/safe'

export const WELCOME_PATH = '/welcome'

/** Whether `pathname` is the welcome (the static export serves it as /welcome/). */
export const isWelcome = (pathname: string) => pathname.replace(/\/$/, '') === WELCOME_PATH

/** The welcome, coming back to `next` once it is finished or skipped. */
export function welcomeHref(next: string) {
  const safe = safeNextPath(next)
  return safe === '/' || isWelcome(new URL(safe, 'http://x').pathname)
    ? WELCOME_PATH
    : `${WELCOME_PATH}?next=${encodeURIComponent(safe)}`
}

/**
 * Sends someone who hasn't seen the welcome yet to /welcome, from whichever page they opened; the
 * page doesn't render meanwhile, so it never flashes. The welcome sends them back when it ends.
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
  const away = session.onboarded === false && !isWelcome(pathname)

  useEffect(() => {
    if (away) router.replace(welcomeHref(window.location.pathname + window.location.search))
  }, [away, router])

  return away ? null : children
}
