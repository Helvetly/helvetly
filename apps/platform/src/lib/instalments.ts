// Instalment plans, typed by hand from "Instalment plans" in docs/invoices-contract.md. A plan is made
// from a draft through invoicesApi.createPlan; this file reads and steers it.
import { request } from '@/lib/api'
import { translate } from '@/lib/i18n'
import type { Interval } from '@/lib/invoices'

export type PlanStatus = 'active' | 'paused' | 'cancelled' | 'done'
export type PlanItem = {
  seq: number
  due_date: string
  /** due_date − lead_days: the day the hourly job issues this partial */
  issue_on: string
  invoice_id: string | null
  number: string | null
  status: 'scheduled' | 'issued' | 'cancelled'
}
export type Plan = {
  id: string
  source_invoice_id: string
  client_id: string
  count: number
  interval: Interval
  first_due_date: string
  lead_days: number
  auto_send: boolean
  reminders_enabled: boolean
  status: PlanStatus
  items: PlanItem[]
}

type One<T> = { data: T }
const path = (id: string) => `/instalment-plans/${encodeURIComponent(id)}`
const action = (id: string, name: 'pause' | 'resume' | 'cancel') =>
  request<One<Plan>>(`${path(id)}/${name}`, { method: 'POST', json: {} })

export const instalmentsApi = {
  list: (clientId?: string) =>
    request<One<Plan[]>>(
      `/instalment-plans${clientId ? `?${new URLSearchParams({ client_id: clientId })}` : ''}`,
    ),
  get: (id: string) => request<One<Plan>>(path(id)),
  pause: (id: string) => action(id, 'pause'),
  resume: (id: string) => action(id, 'resume'),
  cancel: (id: string) => action(id, 'cancel'),
}

export const PLAN_STATUS_LABELS: Record<PlanStatus, string> = {
  active: translate('active'),
  paused: translate('paused'),
  cancelled: translate('cancelled'),
  done: translate('done'),
}

/** How many of the plan's partials are issued, for "2 of 6". */
export const issuedCount = (plan: Pick<Plan, 'items'>) =>
  plan.items.filter((item) => item.status === 'issued').length
