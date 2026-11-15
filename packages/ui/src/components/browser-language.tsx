'use client'

import { currentBrowserLocale, locale } from '@helvetly/i18n'
import { useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useSyncExternalStore, type ReactNode } from 'react'

const subscribe = () => () => {}
const clientReady = () => true
const serverReady = () => false

function LanguageContent({ children }: { children: ReactNode }) {
  const search = useSearchParams().toString()
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady)

  useEffect(() => {
    if (currentBrowserLocale(search) !== locale) {
      // Reload also updates translated constants evaluated when modules were imported.
      window.location.reload()
      return
    }
    document.documentElement.lang = locale
  }, [search])

  // The static shell is English; render the interface only after the browser language is known.
  return ready ? children : null
}

export function BrowserLanguage({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <LanguageContent>{children}</LanguageContent>
    </Suspense>
  )
}
