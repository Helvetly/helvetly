'use client'

import { useSyncExternalStore } from 'react'

import { useAuthConfig } from '@/lib/queries'

const noSubscribe = () => () => {}

/**
 * The origin the API & MCP settings show for tokens and agents: the server's api_url (PUBLIC_API_URL, e.g.
 * https://api.helvetly.com), else this platform's own origin, which serves the API too.
 */
export function useApiOrigin(): string {
  const own = useSyncExternalStore(
    noSubscribe,
    () => window.location.origin,
    () => '',
  )
  return useAuthConfig().data?.api_url || own
}
