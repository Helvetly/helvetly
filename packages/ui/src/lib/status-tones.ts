import type { Tone } from '@helvetly/ui/components/badge'

/**
 * Every record status's badge colour, in one place for the platform, the portal and Heidi, so the same state
 * reads the same everywhere. Green: done and good. Blue: under way, waiting on the other side. Amber: needs
 * someone's attention. Red: wrong or refused. Neutral: not started, or over (void, expired, ended).
 */
export const STATUS_TONES = {
  invoice: {
    draft: 'neutral',
    open: 'blue',
    overdue: 'red',
    paid: 'green',
    void: 'neutral',
    credited: 'neutral',
    replaced: 'neutral',
    credit_draft: 'neutral',
    credit_applied: 'amber',
    refund_due: 'amber',
  },
  instalment: {
    open: 'neutral',
    part_paid: 'amber',
    paid: 'green',
    overdue: 'red',
    credited: 'neutral',
  },
  approval: { pending: 'amber', approved: 'green', rejected: 'red' },
  // Answered "no" or run out: over, like a void invoice.
  quote: {
    draft: 'neutral',
    sent: 'blue',
    accepted: 'green',
    declined: 'neutral',
    expired: 'neutral',
  },
  expense: {
    void: 'neutral',
    ready: 'blue',
    incomplete: 'amber',
    unpaid: 'amber',
    overdue: 'red',
    paid: 'green',
  },
  signatureRequest: {
    pending: 'blue',
    completed: 'green',
    declined: 'red',
    revoked: 'neutral',
    expired: 'amber',
  },
  signer: { waiting: 'neutral', sent: 'blue', viewed: 'amber', signed: 'green', declined: 'red' },
  engagement: { scheduled: 'neutral', active: 'green', ended: 'neutral', cancelled: 'red' },
  attention: { to_invoice: 'blue', overage: 'red', under_pace: 'amber', ending_soon: 'neutral' },
  period: { open: 'green', upcoming: 'neutral', closed: 'neutral' },
  client: { draft: 'amber', active: 'green', inactive: 'neutral', changes_pending: 'blue' },
  invitation: { signed_in: 'green', sent: 'blue', not_sent: 'neutral' },
  member: { active: 'green', invited: 'blue' },
  employee: { active: 'green', upcoming: 'blue', ended: 'neutral', archived: 'neutral' },
  subscription: { active: 'green', trialing: 'blue', cancels: 'amber', past_due: 'red' },
  billingInvoice: {
    draft: 'neutral',
    open: 'blue',
    paid: 'green',
    void: 'neutral',
    uncollectible: 'red',
  },
  portalDomain: { dns: 'amber', certificate: 'blue', active: 'green', problem: 'red' },
  /** A status word in Heidi's answers (an inline code span), whatever record it belongs to. */
  word: {
    paid: 'green',
    approved: 'green',
    active: 'green',
    sent: 'blue',
    new: 'blue',
    pending: 'blue',
    invited: 'blue',
    open: 'blue',
    overdue: 'red',
    rejected: 'neutral',
    draft: 'neutral',
    inactive: 'neutral',
  },
} as const satisfies Record<string, Record<string, Tone>>
