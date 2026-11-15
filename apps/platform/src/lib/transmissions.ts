// An invoice's e-invoice transmissions, typed by hand from docs/delivery-contract.md.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { request } from '@/lib/api'
import { translate } from '@/lib/i18n'

export type TransmissionStatus = 'queued' | 'sent' | 'accepted' | 'rejected' | 'failed'

export type Transmission = {
  id: string
  invoice_id: string
  channel: string
  format: string
  status: TransmissionStatus
  /** The channel's id: a KSeF number, an SdI file name, a Peppol message id, an exported file name. */
  external_id: string | null
  attempts: number
  last_error: string | null
  created_at: string
  updated_at: string
  next_attempt_at: string | null
}

type Many<T> = { data: T[] }
type One<T> = { data: T }

const path = (id: string) => `/invoices/${encodeURIComponent(id)}/transmissions`

export const transmissionsApi = {
  list: (id: string) => request<Many<Transmission>>(path(id)),
  retry: (id: string, transmission: string) =>
    request<One<Transmission>>(`${path(id)}/${encodeURIComponent(transmission)}/retry`, {
      method: 'POST',
      json: {},
    }),
}

export const transmissionsKey = (id: string) => ['invoices', 'detail', id, 'transmissions'] as const

export function useTransmissions(id: string) {
  return useQuery({
    queryKey: transmissionsKey(id),
    queryFn: async () => (await transmissionsApi.list(id)).data,
  })
}

export function useRetryTransmission(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (transmission: string) =>
      (await transmissionsApi.retry(id, transmission)).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: transmissionsKey(id) }),
  })
}

export const STATUS_LABELS: Record<TransmissionStatus, string> = {
  queued: translate('queued'),
  sent: translate('sent3'),
  accepted: translate('accepted'),
  rejected: translate('rejected'),
  failed: translate('failed'),
}

/** A failed or rejected transmission can be sent again. */
export const retryable = (t: Transmission) => t.status === 'failed' || t.status === 'rejected'
