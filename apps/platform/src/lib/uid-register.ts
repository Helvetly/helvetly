import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { ApiError, request } from '@/lib/api'

/** A company as the Swiss UID register lists it (the API's internal/uidregister). */
export type RegisterCompany = {
  /** CHE-123.456.789 */
  uid: string
  name: string
  street?: string
  house_number?: string
  zip?: string
  city?: string
  canton?: string
  /** Not deleted or cancelled in the register. */
  active: boolean
  /** Registered for Swiss VAT now. */
  vat: boolean
}

export const uidRegisterApi = {
  search: (query: string, signal?: AbortSignal) =>
    request<{ data: RegisterCompany[] }>(`/uid-register/search?q=${encodeURIComponent(query)}`, {
      signal,
    }),
  company: (uid: string, signal?: AbortSignal) =>
    request<{ data: RegisterCompany }>(`/uid-register/companies/${encodeURIComponent(uid)}`, {
      signal,
    }),
}

/** The register allows few calls a minute: wait for a pause in typing, and keep answers a while. */
const DEBOUNCE_MS = 400
const STALE_MS = 10 * 60_000

function useDebounced(value: string) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [value])
  return debounced
}

/** Companies whose name (or UID) matches what is typed; off below two characters. */
export function useRegisterSearch(term: string, enabled: boolean) {
  const query = useDebounced(term.trim())
  return useQuery({
    queryKey: ['uid-register', 'search', query.toLowerCase()],
    queryFn: async ({ signal }) => (await uidRegisterApi.search(query, signal)).data,
    enabled: enabled && query.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
    retry: false,
  })
}

/** The company of a UID: null when the register doesn't know it. */
export function useRegisterCompany(uid: string | null) {
  return useQuery({
    queryKey: ['uid-register', 'company', uid],
    queryFn: async ({ signal }) => {
      try {
        return (await uidRegisterApi.company(uid ?? '', signal)).data
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null
        throw error
      }
    },
    enabled: uid !== null,
    staleTime: STALE_MS,
    retry: false,
  })
}
