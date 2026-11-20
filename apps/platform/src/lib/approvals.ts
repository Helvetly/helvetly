'use client'
// Approvals before issuing: approver groups, a policy per document type, the person's inbox and one invoice's request.
// Typed by hand from the approvals design; served by Go, the handlers in src/mocks/approvals.ts are a test-only fake.
import { languageTag } from '@helvetly/i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError, request } from '@/lib/api'
import { translate } from '@/lib/i18n'
import { invoiceKeys, type Decimal, type InvoiceKind } from '@/lib/invoices'

export type DocType = 'invoice' | 'credit_note' | 'debit_note' | 'corrected'
export const DOC_TYPES: DocType[] = ['invoice', 'credit_note', 'debit_note', 'corrected']

export type ApprovalGroup = { id: string; name: string; member_ids: string[] }
/** At least `min` approvals from the group; `group_id` null: from anyone who can see invoices. */
export type ApprovalRule = { group_id: string | null; min: number }
export type ApprovalPolicy = {
  doc_type: DocType
  enabled: boolean
  /** Applies only from this payable total on, in the document's own currency; null: always. */
  min_total: Decimal | null
  rules: ApprovalRule[]
}
export type ApprovalSettings = { groups: ApprovalGroup[]; policies: ApprovalPolicy[] }

export type ApprovalState = 'none' | 'pending' | 'approved' | 'rejected'
type Person = { id: string; name: string }

/** A document waiting for my decision ("Needs my approval"). */
export type InboxItem = {
  doc_type: DocType
  doc_id: string
  kind: InvoiceKind
  client_name: string
  total: Decimal
  currency: string
  issue_date: string
  submitted_by: Person
  submitted_at: string
}

export type TrailEntry = {
  kind: 'submitted' | 'approved' | 'rejected' | 'withdrawn' | 'reset'
  user: Person | null
  at: string
  comment: string | null
}

/** One invoice's approval: whether it needs one, its latest request and what I may do with it. */
export type Approval = {
  required: boolean
  state: ApprovalState
  request_id: string | null
  rules: (ApprovalRule & { group_name: string | null; approved: number })[]
  can_submit: boolean
  can_decide: boolean
  can_withdraw: boolean
  /** The rejection's reason while rejected. */
  comment: string | null
  trail: TrailEntry[]
}

export type ApprovalAction = 'submit' | 'withdraw' | 'approve' | 'reject'

type One<T> = { data: T }
const send = (method: 'POST' | 'PATCH' | 'PUT', json: unknown) => ({ method, json }) as const
const groupPath = (id: string) => `/approvals/groups/${encodeURIComponent(id)}`
const invoicePath = (id: string, action: ApprovalAction) =>
  `/invoices/${encodeURIComponent(id)}/approval${action === 'submit' ? '' : `/${action}`}`

export const approvalsApi = {
  settings: async () => (await request<One<ApprovalSettings>>('/approvals/settings')).data,
  createGroup: async (input: Omit<ApprovalGroup, 'id'>) =>
    (await request<One<ApprovalGroup>>('/approvals/groups', send('POST', input))).data,
  updateGroup: async ({ id, ...input }: ApprovalGroup) =>
    (await request<One<ApprovalGroup>>(groupPath(id), send('PATCH', input))).data,
  deleteGroup: (id: string) => request<void>(groupPath(id), { method: 'DELETE' }),
  savePolicy: async ({ doc_type, ...input }: ApprovalPolicy) =>
    (
      await request<One<ApprovalPolicy>>(
        `/approvals/policies/${encodeURIComponent(doc_type)}`,
        send('PUT', input),
      )
    ).data,
  inbox: async () => (await request<One<InboxItem[]>>('/approvals/inbox')).data,
  get: async (id: string) =>
    (await request<One<Approval>>(`/invoices/${encodeURIComponent(id)}/approval`)).data,
  act: async ({ id, action, comment }: { id: string; action: ApprovalAction; comment?: string }) =>
    (
      await request<One<Approval>>(
        invoicePath(id, action),
        send('POST', comment ? { comment } : {}),
      )
    ).data,
}

export const approvalKeys = {
  settings: ['approvals', 'settings'] as const,
  inbox: ['approvals', 'inbox'] as const,
  invoice: (id: string) => ['approvals', 'invoice', id] as const,
}

export function useApprovalSettings() {
  return useQuery({ queryKey: approvalKeys.settings, queryFn: approvalsApi.settings })
}

/** Creates a group (no id) or changes one. */
export function useSaveGroup() {
  const queryClient = useQueryClient()
  return useMutation<ApprovalGroup, ApiError, Omit<ApprovalGroup, 'id'> & { id?: string }>({
    mutationFn: ({ id, ...input }) =>
      id ? approvalsApi.updateGroup({ id, ...input }) : approvalsApi.createGroup(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: approvalKeys.settings }),
  })
}

export function useDeleteGroup() {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string>({
    mutationFn: approvalsApi.deleteGroup,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: approvalKeys.settings }),
  })
}

export function useSavePolicy() {
  const queryClient = useQueryClient()
  return useMutation<ApprovalPolicy, ApiError, ApprovalPolicy>({
    mutationFn: approvalsApi.savePolicy,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: approvalKeys.settings }),
  })
}

export function useApprovalInbox() {
  return useQuery({ queryKey: approvalKeys.inbox, queryFn: approvalsApi.inbox })
}

/** Fetched for drafts only: an issued document has nothing left to approve. */
export function useInvoiceApproval(id: string, enabled: boolean) {
  return useQuery({
    queryKey: approvalKeys.invoice(id),
    queryFn: () => approvalsApi.get(id),
    enabled,
  })
}

/** Submit, withdraw, approve or reject: the invoice's `approval_state`, the lists and my inbox change with it. */
export function useApprovalAction() {
  const queryClient = useQueryClient()
  return useMutation<Approval, ApiError, { id: string; action: ApprovalAction; comment?: string }>({
    mutationFn: approvalsApi.act,
    onSuccess: (approval, { id }) => {
      queryClient.setQueryData(approvalKeys.invoice(id), approval)
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(id), exact: true })
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.lists })
      void queryClient.invalidateQueries({ queryKey: approvalKeys.inbox })
    },
  })
}

/** The issue call's 409 while a required approval is missing. */
export const isApprovalRequired = (error: unknown) =>
  error instanceof ApiError && error.code === 'approval_required'

/** Who a rule asks for, as a word: the group's name or "anyone who can see invoices". */
export const ruleSource = (groupId: string | null, groupName: (id: string) => string | undefined) =>
  groupId === null
    ? translate('approvalAnyone')
    : (groupName(groupId) ?? translate('approvalDeletedGroup'))

/**
 * The rules in one sentence: "2 people from Accountants and 1 from Management must approve." Each later rule counts
 * other people (one person fills one slot), so an "anyone" rule after a group reads "1 more person".
 */
export function ruleSummary(
  rules: readonly ApprovalRule[],
  groupName: (id: string) => string | undefined,
): string {
  if (rules.length === 0) return ''
  const parts = rules.map(({ group_id, min }, i) => {
    if (group_id === null)
      return i === 0
        ? translate('approvalRuleFirstAnyone', { count: min })
        : translate('approvalRuleNextAnyone', { count: min })
    const group = ruleSource(group_id, groupName)
    return i === 0
      ? translate('approvalRuleFirstGroup', { count: min, group })
      : translate('approvalRuleNextGroup', { count: min, group })
  })
  const list = new Intl.ListFormat(languageTag, { type: 'conjunction' }).format(parts)
  return translate('approvalSummary', { rules: list })
}
