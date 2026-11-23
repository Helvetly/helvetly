import { locale } from '@helvetly/i18n'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { request } from '@/lib/api'

/** An address the API's internal/addresses suggests (Photon, OpenStreetMap data). */
export type Address = {
  /** The one line the location field is filled with. */
  label: string
  street?: string
  house_number?: string
  postcode?: string
  city?: string
  /** ISO 3166-1 alpha-2 */
  country?: string
  lat: number
  lon: number
}

export const addressesApi = {
  suggest: (query: string, country: string, signal?: AbortSignal) =>
    request<{ data: Address[] }>(
      `/addresses/suggest?${new URLSearchParams({ q: query, country, lang: locale })}`,
      { signal },
    ),
}

const DEBOUNCE_MS = 250
const STALE_MS = 10 * 60_000
export const MIN_ADDRESS_CHARS = 3

function useDebounced(value: string) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [value])
  return debounced
}

/** Addresses matching what is typed, biased to the workspace's country; off below three characters. */
export function useAddressSuggestions(term: string, country: string, enabled: boolean) {
  const query = useDebounced(term.trim())
  return useQuery({
    queryKey: ['addresses', 'suggest', country, query.toLowerCase()],
    queryFn: async ({ signal }) => (await addressesApi.suggest(query, country, signal)).data,
    enabled: enabled && query.length >= MIN_ADDRESS_CHARS,
    placeholderData: keepPreviousData,
    staleTime: STALE_MS,
    retry: false,
  })
}

/** The second line of a suggestion: where it is, as the muted part under the street. */
export function addressPlace(address: Address, workspaceCountry: string) {
  const city = [address.postcode, address.city].filter(Boolean).join(' ')
  const country = address.country && address.country !== workspaceCountry ? address.country : ''
  return [city, country].filter(Boolean).join(' · ')
}

/** The first line: the label up to the place (and country) the second line shows. */
export function addressHeadline(address: Address) {
  const parts = address.label.split(', ')
  const at = parts.indexOf([address.postcode, address.city].filter(Boolean).join(' '))
  return at > 0 ? parts.slice(0, at).join(', ') : address.label
}

/** An OpenStreetMap search for a location as typed: a plain link, no API. */
export function mapsHref(location: string) {
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(location.trim())}`
}
