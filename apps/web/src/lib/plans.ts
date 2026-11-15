import { type Price, YEARLY_DISCOUNT_PERCENT, yearOf } from '@helvetly/ui/lib/price'
// The plans as the API sells them: prices from apps/api/internal/billing/plans.go, limits from the
// limit migrations. plans.test.ts reads both files, so a price or limit change there fails here.

import { translate } from '@/lib/i18n'

export type PlanId = 'basic' | 'pro' | 'business'
export type Interval = 'month' | 'year'

/** A cap; null is unlimited. Storage in GB, AI in model tokens per month. */
export type Limits = {
  /** The member cap of the earlier flat prices (limits); per-person plans are not capped. */
  members: number | null
  clients: number | null
  invoicesPerMonth: number | null
  expensesPerMonth: number | null
  products: number | null
  engagements: number | null
  signaturesPerMonth: number | null
  storageGb: number
  aiTokensPerMonth: number
}

export type Plan = {
  id: PlanId
  name: string
  /** Per team member and month, VAT included; the same figure in CHF, EUR and USD (lib/currency.ts). */
  monthly: number
  pitch: string
  highlights: string[]
  limits: Limits
}

export { YEARLY_DISCOUNT_PERCENT }
export const TRIAL_DAYS = 7

export const PLANS: Plan[] = [
  {
    id: 'basic',
    name: translate('basic'),
    monthly: 19,
    pitch: translate('forOnePersonOrAPairInvoicesWithQR'),
    highlights: [
      translate('anyNumberOfPeople'),
      translate('message30InvoicesAnd60ExpensesAMonth'),
      translate('message5SignatureRequestsAMonth'),
      translate('message5GBForDocumentsAndReceipts'),
    ],
    limits: {
      members: 2,
      clients: 50,
      invoicesPerMonth: 30,
      expensesPerMonth: 60,
      products: 25,
      engagements: 3,
      signaturesPerMonth: 5,
      storageGb: 5,
      aiTokensPerMonth: 1_000_000,
    },
  },
  {
    id: 'pro',
    name: translate('pro'),
    monthly: 49,
    pitch: translate('forAGrowingTeamRoomForManyClientsEngagements'),
    highlights: [
      translate('anyNumberOfPeople'),
      translate('message300InvoicesAnd600ExpensesAMonth'),
      translate('message50SignatureRequestsAMonth'),
      translate('message100GBForDocumentsAndReceipts'),
    ],
    limits: {
      members: 10,
      clients: 1000,
      invoicesPerMonth: 300,
      expensesPerMonth: 600,
      products: 500,
      engagements: 50,
      signaturesPerMonth: 50,
      storageGb: 100,
      aiTokensPerMonth: 5_000_000,
    },
  },
  {
    id: 'business',
    name: translate('business'),
    monthly: 99,
    pitch: translate('forLargerTeamsNoCeilingsAndTheMostStorage'),
    highlights: [
      translate('anyNumberOfPeopleUnlimitedClients'),
      translate('unlimitedInvoicesExpensesAndSignatures'),
      translate('message1TBForDocumentsAndReceipts'),
      translate('message20MAITokensAMonthForHeidi'),
    ],
    limits: {
      members: null,
      clients: null,
      invoicesPerMonth: null,
      expensesPerMonth: null,
      products: null,
      engagements: null,
      signaturesPerMonth: null,
      storageGb: 1024,
      aiTokensPerMonth: 20_000_000,
    },
  },
]

/** What a plan costs in an interval, as the API charges it (shared with the app, so both round alike). */
export function priceOf(plan: Plan, interval: Interval, currency = 'chf'): Price {
  const month = { amount: plan.monthly * 100, currency }
  return interval === 'month' ? month : yearOf(month)
}
