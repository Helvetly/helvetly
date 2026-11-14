'use client'

// The session's workspace settings, typed by hand from docs/workspaces-contract.md.
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { request, type ApiError } from '@/lib/api'
import { queryKeys } from '@/lib/queries'

/** Only the fields sent change: the name (owner only) and the IANA time zone (owner or admin). */
export type WorkspaceUpdate = { name?: string; timezone?: string }
export type Workspace = { id: string; name: string; timezone: string }

export function useUpdateWorkspace() {
  const queryClient = useQueryClient()
  return useMutation<{ data: Workspace }, ApiError, WorkspaceUpdate>({
    mutationFn: (body) => request('/workspace', { method: 'PATCH', json: body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.session })
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] }) // the switcher's list (lib/members.ts)
    },
  })
}
