'use client'

import { Button } from '@helvetly/ui/components/button'
import { ErrorState, type PageError } from '@helvetly/ui/components/error-state'
import { RootLayout } from '@helvetly/ui/components/root-layout'

import '@helvetly/ui/globals.css'
import { LayoutDashboard } from 'lucide-react'
import Link from 'next/link'

/** The last resort, when even the app's frame crashed: it replaces the root layout. */
export default function GlobalError({ reset }: { error: PageError; reset: () => void }) {
  return (
    <RootLayout>
      <main className="min-h-svh bg-background text-foreground">
        <ErrorState
          reset={reset}
          home={
            <Button asChild variant="outline">
              <Link href="/">
                <LayoutDashboard /> Go to dashboard
              </Link>
            </Button>
          }
        />
      </main>
    </RootLayout>
  )
}
