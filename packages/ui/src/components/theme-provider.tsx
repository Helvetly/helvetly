'use client'

import { isTypingTarget } from '@helvetly/ui/lib/shortcuts'
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes'
import * as React from 'react'

function ThemeProvider({
  children,
  hotkey = true,
  ...props
}: React.ComponentProps<typeof NextThemesProvider> & {
  /** D switches light and dark; off where the app registers its own theme shortcut. */
  hotkey?: boolean
}) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      // The no-flash script runs only from the server's HTML; a script React creates in the browser never runs, so
      // there it is an inert block (React warns about an executable one). The differing type is deliberate.
      scriptProps={{
        type: typeof window === 'undefined' ? undefined : 'text/plain',
        suppressHydrationWarning: true,
      }}
      {...props}
    >
      {hotkey && <ThemeHotkey />}
      {children}
    </NextThemesProvider>
  )
}

function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme()

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat) {
        return
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      // Autofill (browser, password managers) fires keydown events without a key.
      if (event.key?.toLowerCase() !== 'd') {
        return
      }

      if (isTypingTarget(event.target)) {
        return
      }

      setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [resolvedTheme, setTheme])

  return null
}

export { ThemeProvider }
