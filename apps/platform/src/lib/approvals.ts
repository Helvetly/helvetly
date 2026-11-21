'use client'
// Approvals before issuing: approver groups, a policy per document type, the person's inbox and one invoice's request.
// Typed by hand from the approvals design; served by Go, the handlers in src/mocks/approvals.ts are a test-only fake.
import { languageTag } from '@helvetly/i18n'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { ApiError, request } from '@/lib/api'
import { expenseKeys } from '@/lib/expenses'
import { translate } from '@/lib/i18n'
import { invoiceKeys, type Decimal, type InvoiceKind } from '@/lib/invoices'
import { quoteKeys } from '@/lib/quotes'

export type DocType = 'invoice' | 'credit_note' | 'debit_note' | 'corrected' | 'quote' | 'expense'
export const DOC_TYPES: DocType[] = [
  'invoice',
  'credit_note',
  'debit_note',
  'corrected',
  'quote',
  'expense',
]

/** The kind of record an approval belongs to: its API collection. */
export type ApprovalDoc = 'invoices' | 'quotes' | 'expenses'
/** One record whose approval is read or acted on. */
export type ApprovalTarget = { doc: ApprovalDoc; id: string }

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
  kind: InvoiceKind | 'quote' | 'expense'
  /** The client; for an expense its supplier, else its description, else "". */
  client_name: string
  total: Decimal
  currency: string
  /** "" for an expense without a date. */
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
const approvalPath = ({ doc, id }: ApprovalTarget) => `/${doc}/${encodeURIComponent(id)}/approval`
const actionPath = (target: ApprovalTarget, action: ApprovalAction) =>
  `${approvalPath(target)}${action === 'submit' ? '' : `/${action}`}`

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
  get: async (target: ApprovalTarget) => (await request<One<Approval>>(approvalPath(target))).data,
  /** `requestId` is the request the person saw: the API refuses a decision on one submitted again since. */
  act: async ({
    target,
    action,
    comment,
    requestId,
  }: {
    target: ApprovalTarget
    action: ApprovalAction
    comment?: string
    requestId?: string | null
  }) =>
    (
      await request<One<Approval>>(
        actionPath(target, action),
        send('POST', {
          ...(comment ? { comment } : {}),
          ...(requestId ? { request_id: requestId } : {}),
        }),
      )
    ).data,
}

export const approvalKeys = {
  settings: ['approvals', 'settings'] as const,
  inbox: ['approvals', 'inbox'] as const,
  of: ({ doc, id }: ApprovalTarget) => ['approvals', doc, id] as const,
}

/** The record's own queries, which carry its `approval_state`. */
function invalidateRecord(queryClient: QueryClient, { doc, id }: ApprovalTarget) {
  if (doc === 'invoices') {
    void queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(id), exact: true })
    void queryClient.invalidateQueries({ queryKey: invoiceKeys.lists })
  } else if (doc === 'quotes') {
    void queryClient.invalidateQueries({ queryKey: quoteKeys.all })
  } else {
    void queryClient.invalidateQueries({ queryKey: expenseKeys.detail(id), exact: true })
    void queryClient.invalidateQueries({ queryKey: ['expenses', 'list'] })
  }
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

/** Fetched for drafts only: an issued, sent or booked record has nothing left to approve. */
export function useApproval(target: ApprovalTarget, enabled: boolean) {
  return useQuery({
    queryKey: approvalKeys.of(target),
    queryFn: () => approvalsApi.get(target),
    enabled,
  })
}

export const useInvoiceApproval = (id: string, enabled: boolean) =>
  useApproval({ doc: 'invoices', id }, enabled)

/** Submit, withdraw, approve or reject: the record's `approval_state`, the lists and my inbox change with it. */
export function useApprovalAction() {
  const queryClient = useQueryClient()
  return useMutation<
    Approval,
    ApiError,
    { target: ApprovalTarget; action: ApprovalAction; comment?: string }
  >({
    // the decision names the request on screen, so a stale drawer never approves content submitted again
    mutationFn: (variables) =>
      approvalsApi.act({
        ...variables,
        requestId: queryClient.getQueryData<Approval>(approvalKeys.of(variables.target))
          ?.request_id,
      }),
    onError: (error, { target }) => {
      if (error.code === 'approval_changed')
        void queryClient.invalidateQueries({ queryKey: approvalKeys.of(target) })
    },
    onSuccess: (approval, { target }) => {
      queryClient.setQueryData(approvalKeys.of(target), approval)
      invalidateRecord(queryClient, target)
      void queryClient.invalidateQueries({ queryKey: approvalKeys.inbox })
    },
  })
}

/** The 409 of issuing (or splitting into instalments) while a required approval is missing. */
export const isApprovalRequired = (error: unknown) =>
  error instanceof ApiError && error.code === 'approval_required'

const REQUIRED_BODY: Record<ApprovalDoc, string> = {
  invoices: translate('approvalRequiredBody'),
  quotes: translate('approvalRequiredBodyQuote'),
  expenses: translate('approvalRequiredBodyExpense'),
}

/** Says the draft needs approval first, and refetches its approval so the drawer shows the step. */
export function toastApprovalRequired(
  queryClient: QueryClient,
  id: string,
  doc: ApprovalDoc = 'invoices',
) {
  toast.error(translate('approvalRequiredTitle'), { description: REQUIRED_BODY[doc] })
  void queryClient.invalidateQueries({ queryKey: approvalKeys.of({ doc, id }) })
}

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
