'use client'

import { Toaster } from '@helvetly/ui/components/sonner'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { ApiError } from '@helvetly/ui/lib/http'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

// A 4xx will answer the same on a retry; network errors and 5xx get two more tries.
const retry = (count: number, error: Error) =>
  !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry, staleTime: 30_000 } } }),
  )
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        {children}
        <Toaster position="bottom-right" />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
