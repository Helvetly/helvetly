// Approvals before issuing (GET /approvals/settings, groups, policies, the inbox and one invoice's request), as the Go
// API answers. "Me" is the stories' signed-in person, Anna Muster (usr_story).
import { http, HttpResponse } from 'msw'

import type {
  Approval,
  ApprovalGroup,
  ApprovalPolicy,
  ApprovalRule,
  DocType,
  InboxItem,
} from '@/lib/approvals'

const ME = { id: 'usr_story', name: 'Anna Muster' }
const LUCA = { id: 'usr_2', name: 'Luca Rossi' }

export const accountants: ApprovalGroup = {
  id: 'apg_accountants',
  name: 'Accountants',
  member_ids: ['usr_2', 'usr_3'],
}
export const management: ApprovalGroup = {
  id: 'apg_management',
  name: 'Management',
  member_ids: ['usr_story'],
}

const policy = (doc_type: DocType, change: Partial<ApprovalPolicy> = {}): ApprovalPolicy => ({
  doc_type,
  enabled: false,
  min_total: null,
  rules: [],
  ...change,
})
const offPolicies = () =>
  (['invoice', 'credit_note', 'debit_note', 'corrected'] as const).map((type) => policy(type))

/** Two groups; invoices from 1'000 need 2 accountants and 1 manager, credit notes anyone. */
export const configuredApprovals = () => ({
  groups: [accountants, management],
  policies: [
    policy('invoice', {
      enabled: true,
      min_total: '1000.00',
      rules: [
        { group_id: accountants.id, min: 2 },
        { group_id: management.id, min: 1 },
      ],
    }),
    policy('credit_note', { enabled: true, rules: [{ group_id: null, min: 1 }] }),
    policy('debit_note'),
    policy('corrected'),
  ],
})

/** An invoice that needs approval under `rules`, in `state`, seen by someone who may do `may`. */
export const approvalOf = (
  state: Approval['state'],
  change: Partial<Approval> = {},
  rules: ApprovalRule[] = configuredApprovals().policies[0]?.rules ?? [],
): Approval => ({
  required: true,
  state,
  request_id: state === 'none' ? null : 'apr_1',
  rules: rules.map((rule) => ({
    ...rule,
    group_name:
      rule.group_id === null
        ? null
        : rule.group_id === accountants.id
          ? accountants.name
          : management.name,
    approved: state === 'approved' ? rule.min : 0,
  })),
  can_submit: state === 'none' || state === 'rejected',
  can_decide: false,
  can_withdraw: false,
  comment: null,
  trail:
    state === 'none'
      ? []
      : [{ kind: 'submitted', user: LUCA, at: '2026-11-18T09:12:00Z', comment: null }],
  ...change,
})

export const NOT_REQUIRED: Approval = {
  required: false,
  state: 'none',
  request_id: null,
  rules: [],
  can_submit: false,
  can_decide: false,
  can_withdraw: false,
  comment: null,
  trail: [],
}

export const inboxItem = (change: Partial<InboxItem> = {}): InboxItem => ({
  doc_type: 'invoice',
  doc_id: 'inv_draft',
  kind: 'invoice',
  client_name: 'Alpenglow Studio GmbH',
  total: '3134.90',
  currency: 'CHF',
  issue_date: '2026-11-05',
  submitted_by: LUCA,
  submitted_at: '2026-11-18T09:12:00Z',
  ...change,
})

let settings: { groups: ApprovalGroup[]; policies: ApprovalPolicy[] } = {
  groups: [],
  policies: offPolicies(),
}
let inbox: InboxItem[] = []
let approvals = new Map<string, Approval>()

/** Settings, my inbox and each invoice's approval (any other invoice needs none). */
export function resetApprovals({
  groups = [],
  policies = offPolicies(),
  items = [],
  byInvoice = {},
}: {
  groups?: ApprovalGroup[]
  policies?: ApprovalPolicy[]
  items?: InboxItem[]
  byInvoice?: Record<string, Approval>
} = {}) {
  settings = { groups, policies }
  inbox = items
  approvals = new Map(Object.entries(byInvoice))
}

const refuse = (status: number, code: string, message: string, details?: object) =>
  HttpResponse.json({ error: { code, message, details } }, { status })
const invalid = (fields: Record<string, string>) =>
  refuse(422, 'validation_failed', 'Check the fields.', { fields })
const now = () => new Date().toISOString()

function groupProblem(name: unknown, id?: string) {
  if (typeof name !== 'string' || name.trim() === '') return invalid({ name: 'Enter a name.' })
  const taken = settings.groups.some(
    (group) => group.id !== id && group.name.toLowerCase() === name.trim().toLowerCase(),
  )
  return taken ? invalid({ name: 'A group with this name already exists.' }) : null
}

function policyProblem(input: Omit<ApprovalPolicy, 'doc_type'>) {
  if (input.enabled && input.rules.length === 0) return invalid({ rules: 'Add at least one rule.' })
  for (const [i, rule] of input.rules.entries()) {
    if (rule.min < 1) return invalid({ [`rules.${i}.min`]: 'Ask for at least one approval.' })
    if (rule.group_id !== null && !settings.groups.some((group) => group.id === rule.group_id))
      return invalid({ [`rules.${i}.group_id`]: 'This group no longer exists.' })
  }
  return null
}

const approvalFor = (id: string) => approvals.get(id) ?? NOT_REQUIRED

/** The invoice's `approval_state` as the API derives it from its latest request. */
export function approvalStateOf(id: string) {
  const state = approvals.get(id)?.state
  return state === undefined || state === 'none' ? null : state
}
const answer = (id: string, approval: Approval) => {
  approvals.set(id, approval)
  return HttpResponse.json({ data: approval })
}
const entry = (kind: Approval['trail'][number]['kind'], comment: string | null = null) => ({
  kind,
  user: ME,
  at: now(),
  comment,
})

export const approvalHandlers = [
  http.get('/api/v1/approvals/settings', () => HttpResponse.json({ data: settings })),
  http.post<never, Omit<ApprovalGroup, 'id'>>('/api/v1/approvals/groups', async ({ request }) => {
    const input = await request.json()
    const problem = groupProblem(input.name)
    if (problem) return problem
    const group = { id: `apg_${settings.groups.length + 1}`, ...input, name: input.name.trim() }
    settings = { ...settings, groups: [...settings.groups, group] }
    return HttpResponse.json({ data: group }, { status: 201 })
  }),
  http.patch<{ id: string }, Partial<ApprovalGroup>>(
    '/api/v1/approvals/groups/:id',
    async ({ params, request }) => {
      const input = await request.json()
      const current = settings.groups.find((group) => group.id === params.id)
      if (!current) return refuse(404, 'not_found', 'Not found.')
      const problem = input.name === undefined ? null : groupProblem(input.name, params.id)
      if (problem) return problem
      const group = { ...current, ...input }
      settings = {
        ...settings,
        groups: settings.groups.map((each) => (each.id === params.id ? group : each)),
      }
      return HttpResponse.json({ data: group })
    },
  ),
  http.delete<{ id: string }>('/api/v1/approvals/groups/:id', ({ params }) => {
    const used = settings.policies.some((each) =>
      each.rules.some((rule) => rule.group_id === params.id),
    )
    if (used)
      return refuse(409, 'group_in_use', 'A policy still uses this group. Remove it there first.')
    settings = { ...settings, groups: settings.groups.filter((group) => group.id !== params.id) }
    return new HttpResponse(null, { status: 204 })
  }),
  http.put<{ type: DocType }, Omit<ApprovalPolicy, 'doc_type'>>(
    '/api/v1/approvals/policies/:type',
    async ({ params, request }) => {
      const input = await request.json()
      const problem = policyProblem(input)
      if (problem) return problem
      const saved = { doc_type: params.type, ...input }
      settings = {
        ...settings,
        policies: settings.policies.map((each) => (each.doc_type === params.type ? saved : each)),
      }
      return HttpResponse.json({ data: saved })
    },
  ),
  http.get('/api/v1/approvals/inbox', () => HttpResponse.json({ data: inbox })),
  http.get<{ id: string }>('/api/v1/invoices/:id/approval', ({ params }) =>
    HttpResponse.json({ data: approvalFor(params.id) }),
  ),
  http.post<{ id: string }>('/api/v1/invoices/:id/approval', ({ params }) => {
    const current = approvalFor(params.id)
    if (!current.can_submit) return refuse(403, 'approval_not_allowed', 'You can’t submit this.')
    return answer(params.id, {
      ...current,
      state: 'pending',
      request_id: 'apr_2',
      comment: null,
      rules: current.rules.map((rule) => ({ ...rule, approved: 0 })),
      can_submit: false,
      can_withdraw: true,
      trail: [...current.trail, entry('submitted')],
    })
  }),
  http.post<{ id: string }>('/api/v1/invoices/:id/approval/withdraw', ({ params }) => {
    const current = approvalFor(params.id)
    if (current.state !== 'pending')
      return refuse(409, 'invalid_state', 'Only a pending request can be withdrawn.')
    return answer(params.id, {
      ...current,
      state: 'none',
      request_id: null,
      can_submit: true,
      can_withdraw: false,
      trail: [...current.trail, entry('withdrawn')],
    })
  }),
  http.post<{ id: string }>('/api/v1/invoices/:id/approval/approve', ({ params }) => {
    const current = approvalFor(params.id)
    if (!current.can_decide) return refuse(403, 'approval_not_allowed', 'You can’t decide this.')
    // My approval fills the first slot still open.
    const open = current.rules.findIndex((rule) => rule.approved < rule.min)
    const rules = current.rules.map((rule, i) =>
      i === open ? { ...rule, approved: rule.approved + 1 } : rule,
    )
    const done = rules.every((rule) => rule.approved >= rule.min)
    inbox = inbox.filter((item) => item.doc_id !== params.id)
    return answer(params.id, {
      ...current,
      rules,
      state: done ? 'approved' : 'pending',
      can_decide: false,
      can_withdraw: done ? false : current.can_withdraw,
      trail: [...current.trail, entry('approved')],
    })
  }),
  http.post<{ id: string }, { comment?: string }>(
    '/api/v1/invoices/:id/approval/reject',
    async ({ params, request }) => {
      const { comment } = await request.json()
      const current = approvalFor(params.id)
      if (!current.can_decide) return refuse(403, 'approval_not_allowed', 'You can’t decide this.')
      if (!comment?.trim()) return invalid({ comment: 'Say what needs to change.' })
      inbox = inbox.filter((item) => item.doc_id !== params.id)
      return answer(params.id, {
        ...current,
        state: 'rejected',
        comment,
        can_decide: false,
        can_withdraw: false,
        can_submit: true,
        trail: [...current.trail, entry('rejected', comment)],
      })
    },
  ),
]

const locked = () =>
  refuse(403, 'feature_not_in_plan', 'Your plan doesn’t include document approvals.', {
    feature: 'document_approvals',
    required_plan: 'business',
  })

/** A plan without approvals: every settings write is refused, reads still answer. */
export const approvalLockedHandlers = [
  http.post('/api/v1/approvals/groups', locked),
  http.patch('/api/v1/approvals/groups/:id', locked),
  http.delete('/api/v1/approvals/groups/:id', locked),
  http.put('/api/v1/approvals/policies/:type', locked),
  ...approvalHandlers,
]
