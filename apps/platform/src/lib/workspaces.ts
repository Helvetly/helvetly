'use client'

// The session's workspace settings, typed by hand from docs/workspaces-contract.md.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

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

/** The one-time AI suggestion of a workspace name: made from the company name only, after the person agreed. */
export type NameSuggestion = { name: string; company_name: string }

export function useSuggestWorkspaceName() {
  return useMutation<
    { data: NameSuggestion },
    ApiError,
    { company_name: string; signal: AbortSignal }
  >({
    // The page only calls this from the person's own click on Suggest, which is their consent; the server refuses a request without it.
    mutationFn: ({ company_name, signal }) =>
      request('/workspace/name-suggestion', {
        method: 'POST',
        json: { company_name, consent: true },
        signal,
      }),
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
