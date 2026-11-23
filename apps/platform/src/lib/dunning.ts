import { formatDate } from '@helvetly/ui/lib/format'
// An invoice's dunning, typed by hand from "Dunning" in docs/invoices-contract.md.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { request } from '@/lib/api'
import { translate } from '@/lib/i18n'
import type { Decimal } from '@/lib/invoices'

export type DunningNotice = {
  level: number
  levels: number
  /** In the invoice's language: "Zahlungserinnerung", "2. Mahnung", "Letzte Mahnung". */
  title: string
  sent_at: string
  sent_on: string
  open_amount: Decimal
  fee: Decimal
  interest: Decimal
  total: Decimal
  interest_rate: Decimal
  interest_from: string | null
  email: string
  /** The person's name when sent by hand; null for the hourly job. */
  sent_by: string | null
  /** The mail server took it; false while it goes out, or when it may have gone (never sent again by itself). */
  confirmed: boolean
}

export type Dunning = {
  /** Issued, open, receivable, without instalments. */
  applies: boolean
  enabled: boolean
  client_enabled: boolean
  paused: boolean
  next: { level: number; levels: number; title: string; due_on: string } | null
  notices: DunningNotice[]
}

type One<T> = { data: T }
export type DunningAction = 'send' | 'pause' | 'resume'

const path = (id: string) => `/invoices/${encodeURIComponent(id)}/dunning`

export const dunningApi = {
  get: (id: string) => request<One<Dunning>>(path(id)),
  run: (id: string, action: DunningAction) =>
    request<One<Dunning>>(`${path(id)}/${action}`, { method: 'POST', json: {} }),
}

/** The letter of a sent notice, opened in the browser (the session cookie goes along). */
export const noticePdfUrl = (id: string, level: number) => `/api/v1${path(id)}/${level}/pdf`

export const dunningKey = (id: string) => ['invoices', 'detail', id, 'dunning'] as const

export function useDunning(id: string, enabled = true) {
  return useQuery({
    queryKey: dunningKey(id),
    queryFn: async () => (await dunningApi.get(id)).data,
    enabled,
  })
}

export function useDunningAction(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (action: DunningAction) => (await dunningApi.run(id, action)).data,
    onSuccess: (dunning) => queryClient.setQueryData(dunningKey(id), dunning),
  })
}

/** What happens next, in a few words, for the invoice's dunning card. */
export function dunningSummary(dunning: Dunning): string {
  if (!dunning.applies) return translate('remindersFollowTheInstalmentsOfThisInvoice')
  if (!dunning.next)
    return dunning.notices.length > 0
      ? translate('allRemindersWereSent')
      : translate('nothingIsDue')
  if (!dunning.enabled) return translate('dunningIsOffInTheInvoiceSettingsYouCan')
  if (!dunning.client_enabled) return translate('thisClientGetsNoRemindersYouCanSendBy')
  if (dunning.paused) return translate('pausedNoReminderGoesOutUntilYouResume')
  return translate('goesOutOn', {
    title: dunning.next.title,
    value2: formatDate(dunning.next.due_on),
  })
}
