'use client'

import { Button } from '@helvetly/ui/components/button'
import { Loader } from '@helvetly/ui/components/loader'
import { Logo } from '@helvetly/ui/components/logo'
import type { ReactNode } from 'react'

import { ApiError, errorMessage, type Session } from '@/lib/api'
import { useSession } from '@/lib/queries'

/**
 * Renders the signed-in area once the session is confirmed. A 401 is turned into a redirect to
 * /login?next= by the API client's handler (see <Providers>), so it only waits here.
 */
export function AuthGate({ children }: { children: (session: Session) => ReactNode }) {
  const session = useSession()

  if (session.data) return children(session.data)

  const signedOut = session.error instanceof ApiError && session.error.status === 401
  if (session.error && !signedOut) {
    return (
      <div role="alert" className="flex min-h-svh flex-col items-center justify-center gap-4 p-6">
        <Logo className="size-10" />
        <div className="grid max-w-sm gap-1 text-center">
          <h1 className="text-base font-semibold">Helvetly can’t open right now</h1>
          <p className="text-sm text-muted-foreground">{errorMessage(session.error)}</p>
        </div>
        <Button variant="outline" onClick={() => void session.refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  return <ShellLoading />
}

/**
 * The whole screen while the app can't tell yet which page it opens: no sidebar frame, since the page may
 * be one without it (the welcome, the plan picker).
 */
export function ShellLoading() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <Loader size="page" />
    </div>
  )
}
