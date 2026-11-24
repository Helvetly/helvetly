'use client'

import { BrowserLanguage } from '@helvetly/ui/components/browser-language'
import { Toaster } from '@helvetly/ui/components/sonner'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { watchSessionChanges } from '@helvetly/ui/lib/http'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'

import { Analytics } from '@/components/analytics'
import { toastPlanRequired } from '@/components/billing/plan-required-toast'
import { UpgradePrompt, promptUpgrade } from '@/components/billing/upgrade-prompt'
import { ThemeShortcut } from '@/components/shortcuts/theme-shortcut'
import { ApiError, setUnauthorizedHandler } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { toastForbidden } from '@/lib/permissions'
import { loginHref } from '@/lib/safe'
import { toastUnreachable } from '@/lib/unreachable'

// A 4xx will answer the same on a retry; network errors and 5xx get two more tries.
const retry = (count: number, error: Error) =>
  !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2

export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry, staleTime: 30_000 } },
        // A refusal by the member's scopes is a toast, wherever it happens.
        // So is a server that does not answer, once the retries are spent.
        queryCache: new QueryCache({
          onError: (error) => void (toastForbidden(error) || toastUnreachable(error)),
        }),
        // Any create that hits the plan's limit opens the one upgrade prompt.
        mutationCache: new MutationCache({
          onError: (error) =>
            void (
              promptUpgrade(error) ||
              toastPlanRequired(error, () => router.push('/settings/billing/plans')) ||
              toastForbidden(error) ||
              toastUnreachable(error)
            ),
        }),
      }),
  )

  useEffect(() => watchSessionChanges('platform'), [])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      client.clear()
      router.replace(loginHref(window.location.pathname + window.location.search))
    })
  }, [client, router])

  return (
    <BrowserLanguage>
      <meta name="description" content={translate('helvetlyPlatform')} />
      <QueryClientProvider client={client}>
        <TooltipProvider>
          {children}
          {/* On phones, above the bottom tab bar. */}
          <Toaster position="bottom-right" mobileOffset={{ bottom: 88 }} />
          <UpgradePrompt />
          <ThemeShortcut />
          <Analytics />
        </TooltipProvider>
      </QueryClientProvider>
    </BrowserLanguage>
  )
}
