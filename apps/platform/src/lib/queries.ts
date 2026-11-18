'use client'

import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useCallback } from 'react'

import { api, setCsrfToken } from '@/lib/api'
import { setWorkspaceTimezone } from '@/lib/timezone'

export const queryKeys = {
  authConfig: ['auth-config'],
  session: ['session'],
  passkeys: ['passkeys'],
  dashboard: ['dashboard'],
  clients: ['clients'],
  documents: ['documents'],
  engagements: ['engagements'],
  // Prefix of lib/members.ts's keys, so Heidi's writes refetch the team.
  members: ['members'],
} as const

export function useAuthConfig() {
  return useQuery({ queryKey: queryKeys.authConfig, queryFn: api.authConfig, staleTime: Infinity })
}

export function useSession() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: async () => {
      const session = await api.session()
      setCsrfToken(session.csrf_token)
      setWorkspaceTimezone(session.workspace.timezone)
      return session
    },
  })
}

/** The session once something else has loaded it; never fetches it (pages before sign-in have none). */
export function useLoadedSession() {
  return useQuery({ queryKey: queryKeys.session, queryFn: api.session, enabled: false }).data
}

export function usePasskeys() {
  return useQuery({
    queryKey: queryKeys.passkeys,
    queryFn: async () => (await api.passkeys()).data,
  })
}

export function useDashboard(currency?: string) {
  return useQuery({
    queryKey: [...queryKeys.dashboard, currency ?? 'default'],
    queryFn: () => api.getKeyFigures(currency),
  })
}

/** Loads a record while the pointer rests on its row, so its drawer opens with the details. */
export function usePrefetch<T>(
  query: (id: string) => { queryKey: QueryKey; queryFn: () => Promise<T> },
) {
  const queryClient = useQueryClient()
  return useCallback(
    (id: string) => void queryClient.prefetchQuery(query(id)),
    [queryClient, query],
  )
}
