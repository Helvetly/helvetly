'use client'

import { BrowserLanguage } from '@helvetly/ui/components/browser-language'
import { Toaster } from '@helvetly/ui/components/sonner'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { ApiError, watchSessionChanges } from '@helvetly/ui/lib/http'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'

import { translate } from '@/lib/i18n'
import { portalScopeQuery } from '@/lib/portal'
import { applyScope, scopePrefix } from '@/lib/scope'
import { initialsOf } from '@/lib/text'

// Before any call: under /w/<slug>/ every API call goes under the same prefix.
if (typeof window !== 'undefined') applyScope()

// A 4xx will answer the same on a retry; network errors and 5xx get two more tries.
const retry = (count: number, error: Error) =>
  !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2

function PortalFavicon() {
  const scope = useQuery({ ...portalScopeQuery, enabled: false })
  if (!scope.isSuccess || !scope.data) return null

  const initials = Array.from(
    initialsOf(scope.data.name),
    (char) => `&#${char.codePointAt(0)};`,
  ).join('')
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="ButtonFace"/><text x="16" y="21" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" font-weight="600" fill="ButtonText">${initials}</text></svg>`
  return (
    <>
      <link rel="icon" href={`data:image/svg+xml,${encodeURIComponent(icon)}`} />
      {scope.data.logo_url && <link rel="icon" href={scope.data.logo_url} />}
    </>
  )
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry, staleTime: 30_000 } } }),
  )
  useEffect(() => watchSessionChanges(`portal${scopePrefix()}`), [])
  return (
    <BrowserLanguage>
      <meta name="description" content={translate('yourInvoicesEngagementsAndDocuments')} />
      <QueryClientProvider client={client}>
        <PortalFavicon />
        <TooltipProvider>
          {children}
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </BrowserLanguage>
  )
}
