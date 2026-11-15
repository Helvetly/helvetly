'use client'
import { BrowserLanguage } from '@helvetly/ui/components/browser-language'
import { Button } from '@helvetly/ui/components/button'
import { ErrorState, type PageError } from '@helvetly/ui/components/error-state'
import { RootLayout } from '@helvetly/ui/components/root-layout'
import { LayoutDashboard } from 'lucide-react'

import '@helvetly/ui/globals.css'
import Link from 'next/link'

import { translate } from '@/lib/i18n'

/** The last resort, when even the app's frame crashed: it replaces the root layout. */
export default function GlobalError({ reset }: { error: PageError; reset: () => void }) {
  return (
    <RootLayout>
      <BrowserLanguage>
        <main className="min-h-svh bg-background text-foreground">
          <ErrorState
            reset={reset}
            home={
              <Button asChild variant="outline">
                <Link href="/">
                  <LayoutDashboard />
                  {translate('goToDashboard')}
                </Link>
              </Button>
            }
          />
        </main>
      </BrowserLanguage>
    </RootLayout>
  )
}
