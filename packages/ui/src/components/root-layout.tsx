import { locale } from '@helvetly/i18n'
import { ThemeProvider } from '@helvetly/ui/components/theme-provider'
import { fontClassName } from '@helvetly/ui/lib/fonts'
import type { ReactNode } from 'react'

// The <html> shell shared by every Next.js app, so fonts and theming stay identical.
export function RootLayout({
  children,
  themeHotkey = true,
}: Readonly<{ children: ReactNode; themeHotkey?: boolean }>) {
  return (
    <html lang={locale} suppressHydrationWarning className={fontClassName}>
      {/* Browser extensions (Grammarly, ColorZilla…) add attributes to <body> before hydration; not our markup. */}
      <body suppressHydrationWarning>
        <ThemeProvider hotkey={themeHotkey}>{children}</ThemeProvider>
      </body>
    </html>
  )
}
