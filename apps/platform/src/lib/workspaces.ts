'use client'

// The session's workspace settings, typed by hand from docs/workspaces-contract.md.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { ApiError, errorFromBody, getCsrfToken, request } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { queryKeys } from '@/lib/queries'

/** Only the fields sent change: the name (owner only) and the IANA time zone (owner or admin). */
export type WorkspaceUpdate = { name?: string; timezone?: string }
export type Workspace = { id: string; name: string; timezone: string; logo_url?: string | null }

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

/** Uploads the workspace's mark with progress (0–1); resolves with its URL, rejects with the server's error. */
function uploadWorkspaceLogo(file: Blob, onProgress: (share: number) => void): Promise<string> {
  const form = new FormData()
  form.append('file', file, 'logo.png')
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', '/api/v1/workspace/logo')
    xhr.setRequestHeader('Accept', 'application/json')
    const token = getCsrfToken()
    if (token) xhr.setRequestHeader('X-CSRF-Token', token)
    xhr.responseType = 'json'
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    })
    xhr.addEventListener('load', () => {
      const body: unknown = xhr.response
      const url = (body as { data?: { logo_url?: unknown } } | null)?.data?.logo_url
      if (xhr.status >= 200 && xhr.status < 300 && typeof url === 'string') resolve(url)
      else {
        // A refused file says why in details.fields.file (type, size, shape).
        const error = errorFromBody(xhr.status, body)
        const fields = error.details.fields
        const reason =
          typeof fields === 'object' && fields !== null && 'file' in fields ? fields.file : null
        reject(typeof reason === 'string' ? new ApiError(error.status, error.code, reason) : error)
      }
    })
    xhr.addEventListener('error', () =>
      reject(new ApiError(0, 'network_error', translate('cannotReachHelvetlyCheckYourConnection'))),
    )
    xhr.send(form)
  })
}

/** Uploading and removing the workspace's own mark; both refresh the session and the switcher's list. */
export function useWorkspaceLogo() {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<number | null>(null)
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.session })
    void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
  }
  const upload = useMutation<string, ApiError, Blob>({
    mutationFn: (file) => {
      setProgress(0)
      return uploadWorkspaceLogo(file, setProgress)
    },
    onSuccess: refresh,
    onSettled: () => setProgress(null),
  })
  const remove = useMutation<void, ApiError, void>({
    mutationFn: () => request<void>('/workspace/logo', { method: 'DELETE' }),
    onSuccess: refresh,
  })
  return { upload, remove, progress }
}

/** Where the workspace's clients sign in: its own slug and the whole portal address. */
export type PortalAddress = { slug: string; url: string }
export type SlugProblem = 'invalid' | 'reserved' | 'taken'

const portalKey = ['workspace', 'portal'] as const

export function usePortalAddress(enabled = true) {
  return useQuery({
    queryKey: portalKey,
    queryFn: async () => (await request<{ data: PortalAddress }>('/workspace/portal')).data,
    enabled,
  })
}

/** Whether the workspace can take `slug`; off while it is the current one or empty. */
export function useSlugAvailability(slug: string, current: string | undefined) {
  const wanted = useDebounced(slug.trim().toLowerCase())
  return useQuery({
    queryKey: [...portalKey, 'availability', wanted],
    queryFn: async () =>
      (
        await request<{ data: { available: boolean; problem: SlugProblem | null } }>(
          `/workspace/portal/availability?slug=${encodeURIComponent(wanted)}`,
        )
      ).data,
    enabled: wanted !== '' && wanted !== current,
    staleTime: 10_000,
  })
}

export function useSetPortalSlug() {
  const queryClient = useQueryClient()
  return useMutation<{ data: PortalAddress }, ApiError, string>({
    mutationFn: (slug) => request('/workspace/portal', { method: 'PUT', json: { slug } }),
    onSuccess: (result) => queryClient.setQueryData(portalKey, result.data),
  })
}

function useDebounced(value: string, ms = 300) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}
