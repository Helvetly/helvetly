'use client'
import { languageTag } from '@helvetly/i18n'
import { formatAmount } from '@helvetly/ui/lib/format'
// Invoices, typed by hand from docs/invoices-contract.md. Money travels as decimal strings and is
// never turned into a float for arithmetic: totals come from the server (or POST /preview); the
// few sums the UI shows itself are done in integer cents.
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { useState } from 'react'

import { ApiError, errorFromBody, getCsrfToken, request, respond } from '@/lib/api'
import type { ApprovalState } from '@/lib/approvals'
import type { ElectronicAddress, Page } from '@/lib/clients'
import { translate } from '@/lib/i18n'
import type { Plan } from '@/lib/instalments'
import { amountParam } from '@/lib/list-query'
import { queryKeys } from '@/lib/queries'
import { todayIn } from '@/lib/timezone'

export type Decimal = string
export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'replaced'
export type InvoiceKind =
  | 'invoice'
  | 'partial'
  | 'prepayment'
  | 'debit_note'
  | 'corrected'
  | 'credit_note'
  | 'proforma'
  | 'self_billed'

/** In tab order; `code` is the UNTDID 1001 code the API returns as `type_code`. */
export const INVOICE_KINDS: {
  kind: InvoiceKind
  label: string
  plural: string
  code: string
  receivable: boolean
}[] = [
  {
    kind: 'invoice',
    label: translate('invoice2'),
    plural: translate('invoices'),
    code: '380',
    receivable: true,
  },
  {
    kind: 'partial',
    label: translate('partialInvoice'),
    plural: translate('partialInvoices'),
    code: '326',
    receivable: true,
  },
  {
    kind: 'prepayment',
    label: translate('prepaymentInvoice'),
    plural: translate('prepayments'),
    code: '386',
    receivable: true,
  },
  {
    kind: 'debit_note',
    label: translate('debitNote2'),
    plural: translate('debitNotes'),
    code: '383',
    receivable: true,
  },
  {
    kind: 'corrected',
    label: translate('correctedInvoice'),
    plural: translate('corrections'),
    code: '384',
    receivable: true,
  },
  {
    kind: 'credit_note',
    label: translate('creditNote2'),
    plural: translate('creditNotes'),
    code: '381',
    receivable: false,
  },
  {
    kind: 'proforma',
    label: translate('proformaInvoice'),
    plural: translate('proforma'),
    code: '325',
    receivable: false,
  },
  {
    kind: 'self_billed',
    label: translate('selfBilledInvoice2'),
    plural: translate('selfBilled'),
    code: '389',
    receivable: false,
  },
]

export function kindInfo(kind: InvoiceKind) {
  const info = INVOICE_KINDS.find((entry) => entry.kind === kind)
  if (!info) throw new Error(translate('unknownInvoiceKind', { kind: kind }))
  return info
}
export const isReceivable = (kind: InvoiceKind) => kindInfo(kind).receivable
export const isNegativeKind = (kind: InvoiceKind) => kind === 'credit_note'
const isInvoiceKind = (value: string | null): value is InvoiceKind =>
  INVOICE_KINDS.some((info) => info.kind === value)
export type VatMode = 'exclusive' | 'inclusive' | 'none'
export type VatCategory = 'S' | 'Z' | 'E' | 'AE' | 'K' | 'G' | 'O'
export type Unit = 'hour' | 'day' | 'piece' | 'month' | 'km' | 'flat'
export const DOC_LANGUAGES = ['de', 'fr', 'it', 'en'] as const
export type DocLanguage = (typeof DOC_LANGUAGES)[number]
export type PaymentMethod = 'bank_transfer' | 'cash' | 'card' | 'twint' | 'other'
/** Literal text with {YYYY} {YY} {MM} {DD} {TYPE} and one {N}…{NNNNNN} placeholder; the API checks it too. */
export type NumberFormat = string

export type Party = {
  name: string
  street: string
  street_number: string
  apt: string | null
  zip: string
  city: string
  country: string
  vat_number: string | null
  email: string | null
  phone?: string | null
  electronic_address?: ElectronicAddress | null
  registration_number?: string | null
  /** The seller's legal form as written locally: GmbH, Einzelunternehmen, LLC. */
  legal_form?: string | null
  /** ISO 3166-2 subdivision, e.g. RO-CJ (RO e-Factura needs it for Romanian addresses). */
  region?: string | null
}

export type CataloguePriceFields = {
  catalogue_price_basis?: 'gross' | 'net'
  catalogue_unit_price?: Decimal
  catalogue_currency?: string
}
export type Line = CataloguePriceFields & {
  id: string
  position: number
  description: string
  quantity: Decimal
  unit: Unit | null
  unit_price: Decimal
  discount_percent: Decimal
  vat_category: VatCategory
  vat_rate: Decimal
  /** Official VATEX code (BT-121); needed to issue E, AE, K, G; O defaults to VATEX-EU-O. */
  vat_exemption_code: string | null
  /** Free text (BT-120), ≤ 300, e.g. a Swiss legal basis. */
  vat_exemption_reason: string | null
  amount: Decimal
}

export type VatGroup = {
  category: VatCategory
  rate: Decimal
  taxable_amount: Decimal
  vat_amount: Decimal
}

export type Totals = {
  subtotal: Decimal
  discount_amount: Decimal
  net_total: Decimal
  vat_breakdown: VatGroup[]
  vat_total: Decimal
  total: Decimal
  rounding_amount: Decimal
  /** total + rounding_amount: what the buyer owes in all, the amount. */
  payable_total: Decimal
}

export type Invoice = Totals & {
  id: string
  kind: InvoiceKind
  /** UNTDID 1001 code, derived by the API. */
  type_code: string
  prepaid_total: Decimal
  prepayments: { id: string; number: string | null; payable_total: Decimal }[]
  deducted_on: { id: string; number: string } | null
  number: string | null
  status: InvoiceStatus
  /** A draft's latest approval request; null when it never had one. */
  approval_state: Exclude<ApprovalState, 'none'> | null
  is_overdue: boolean
  client_id: string
  client: { id: string; number: number; name: string }
  credited_invoice: { id: string; number: string } | null
  /** The quote this invoice was made from (docs/quotes-contract.md). */
  quote: { id: string; number: string } | null
  issue_date: string
  due_date: string
  service_date: string | null
  service_date_end: string | null
  currency: string
  language: DocLanguage
  vat_mode: VatMode
  reference: string | null
  /** The client number the PDF prints: null prints `client.number`, "" prints none, other text prints instead. */
  client_number_display: string | null
  /** The contract number (BT-12), printed as "Contract no." and sent in e-invoices. */
  contract_reference: string | null
  /** The workspace document the contract is in; never printed. Null when none is linked or it is gone. */
  contract_document: { id: string; name: string } | null
  /** Where this PDF sits in Documents: an imported invoice's original, else the issued PDF filed there. */
  pdf_document: { id: string; name: string } | null
  /** RON per unit of `currency` on the issue date, entered by the user; states the VAT in RON (RO e-Factura). */
  tax_currency_rate: string | null
  intro: string | null
  footer: string | null
  note: string | null
  lines: Line[]
  discount_percent: Decimal
  amount_paid: Decimal
  amount_credited: Decimal
  amount_due: Decimal
  amount_refunded: Decimal
  /** What the buyer is owed back after credits beyond what they paid; "0.00" when nothing. */
  refund_due: Decimal
  payments: Payment[]
  refunds: Refund[]
  /** What the seller offers on this invoice; bank details are always printed. */
  payment_methods: PaymentMethods
  payment: {
    iban: string | null
    reference_type: 'QRR' | 'SCOR' | 'NON'
    reference: string | null
    /** A Swiss QR bill page is attached. */
    qr_bill: boolean
    /** "Pay with Revolut" is printed with this revolut.me link, null when not. */
    revolut_url: string | null
  }
  seller: Party | null
  buyer: Party | null
  send_uncertain_at?: string
  unconfirmed_reminders?: { seq: number; at: string; kind: string; offset_days: number }[]
  issued_at: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
  /** Receivable kinds only; allocation is derived by the server on read. */
  instalments: InstalmentSchedule | null
  /** A partial issued by a plan (seq 1…count), or the plan's source draft (seq 0). */
  plan: PlanRef | null
  reminders_enabled: boolean
}

export type Interval = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'
/** credited: credit notes took the whole instalment (they take from the last one backwards). */
export type InstalmentStatus = 'paid' | 'part_paid' | 'open' | 'overdue' | 'credited'
export type InstalmentItem = {
  seq: number
  due_date: string
  amount: Decimal
  /** amount after credits, taken from the last instalment backwards */
  effective: Decimal
  paid: Decimal
  open: Decimal
  status: InstalmentStatus
  /** Its own QRR/SCOR, assigned on issue; null on drafts. */
  reference: string | null
}
export type InstalmentSchedule = { interval: Interval; items: InstalmentItem[] }
/** Items empty or left out: the server generates them from the amount due. */
export type InstalmentInput = {
  count: number
  interval: Interval
  first_due_date: string
  items?: { due_date: string; amount: Decimal }[]
}
export type PlanRef = { id: string; seq: number; count: number }
export type InstalmentSettings = {
  count: number
  interval: Interval
  mode: 'schedule' | 'plan'
  plan_lead_days: number
  plan_auto_send: boolean
  reminders_enabled: boolean
  remind_before_days: number
  remind_after_days: number[]
}
/** settings.dunning (docs/invoices-contract.md "Dunning"). */
export type DunningTiming = 'before_due' | 'after_due' | 'after_previous'
export type DunningStep = {
  /** Replaces the standard title; null for it. */
  name: string | null
  timing: DunningTiming
  /** 1–30 before the due date, else 1–90. */
  days: number
  /** "0.00" before the due date. */
  fee: Decimal
  qr_bill: boolean
}
export type DunningSettings = {
  enabled: boolean
  /** 1–10, in the order they go out. */
  steps: DunningStep[]
  interest_enabled: boolean
  /** Percent a year, "5" by default (OR 104). */
  interest_rate: Decimal
  /** 'reminder': default starts with the first notice; 'due_date': the due date was agreed. */
  interest_from: 'reminder' | 'due_date'
}
/** A dunning level as an API from before steps sends it (settings.dunning.levels). */
type DunningLevel = { name?: string | null; days: number; fee: Decimal }
/** settings.dunning from an API of any version: older ones send `levels`, not `steps`. */
type DunningResponse = Omit<DunningSettings, 'steps'> & {
  steps?: DunningStep[]
  levels?: DunningLevel[]
}
export type InvoiceSettingsResponse = Omit<InvoiceSettings, 'dunning' | 'payment_confirmation'> & {
  dunning: DunningResponse
  /** Absent from an API before payment confirmations: on. */
  payment_confirmation?: boolean
}

/** Levels read as the server reads them: the first after the due date, the rest after the previous notice. */
export const stepsFromLevels = (levels: DunningLevel[]): DunningStep[] =>
  levels.map((level, i) => ({
    name: level.name ?? null,
    timing: i === 0 ? 'after_due' : 'after_previous',
    days: level.days,
    fee: level.fee,
    qr_bill: true,
  }))

/** The invoice settings as the client uses them, whichever API version answered. */
export function settingsFrom(raw: InvoiceSettingsResponse): InvoiceSettings {
  // `?? {}`: partial responses (test fixtures) leave dunning out.
  const { steps, levels = [], ...dunning } = raw.dunning ?? {}
  return {
    ...raw,
    payment_confirmation: raw.payment_confirmation ?? true,
    dunning: { ...dunning, steps: steps ?? stepsFromLevels(levels) },
  }
}
export type PlanInput = {
  count: number
  interval: Interval
  first_due_date: string
  lead_days?: number
  auto_send?: boolean
}
export type EinvoiceFormat =
  | 'xrechnung-ubl'
  | 'xrechnung-cii'
  | 'peppol'
  | 'factur-x'
  | 'ro-cius'
  | 'ksef-fa3'

export type PaymentMethods = { qr_bill: boolean; revolut: boolean }

export type LineInput = CataloguePriceFields &
  Pick<
    Line,
    | 'description'
    | 'quantity'
    | 'unit'
    | 'unit_price'
    | 'discount_percent'
    | 'vat_category'
    | 'vat_rate'
    | 'vat_exemption_code'
    | 'vat_exemption_reason'
  >

export type InvoiceInput = Pick<
  Invoice,
  | 'client_id'
  | 'issue_date'
  | 'due_date'
  | 'service_date'
  | 'service_date_end'
  | 'currency'
  | 'language'
  | 'vat_mode'
  | 'reference'
  | 'intro'
  | 'footer'
  | 'note'
  | 'discount_percent'
  | 'payment_methods'
> & {
  tax_currency_rate?: string | null
  /** At most 40 characters; null prints the client's own number, "" none. */
  client_number_display?: string | null
  /** At most 100 characters. */
  contract_reference?: string | null
  /** A document of the workspace (not in the trash, not an HR file); null removes the link. */
  contract_document_id?: string | null
  lines: LineInput[]
  kind?: InvoiceKind
  prepayment_ids?: string[]
  /** null clears the schedule; left out keeps it. */
  instalments?: InstalmentInput | null
  reminders_enabled?: boolean
}

export type InvoicePreview = Totals & {
  lines: Pick<Line, 'position' | 'amount'>[]
  payment: Pick<Invoice['payment'], 'qr_bill' | 'revolut_url'>
  /** The rows the server would store for the input's schedule; null without one. */
  instalments: InstalmentSchedule | null
}

export type InvoiceListItem = Pick<
  Invoice,
  | 'id'
  | 'kind'
  | 'type_code'
  | 'number'
  | 'status'
  | 'approval_state'
  | 'is_overdue'
  | 'client'
  | 'issue_date'
  | 'due_date'
  | 'currency'
  | 'total'
  | 'rounding_amount'
  | 'payable_total'
  | 'amount_due'
  | 'amount_paid'
  | 'refund_due'
  | 'payment_methods'
  | 'sent_at'
  | 'created_at'
> & {
  deducted_on: { id: string; number: string | null } | null
  open_instalments?: (Pick<InstalmentItem, 'seq' | 'due_date' | 'open'> & {
    is_overdue: boolean
  })[]
}

export type Payment = {
  id: string
  amount: Decimal
  paid_on: string
  method: PaymentMethod
  note: string | null
  created_at: string
  created_by: { id: string; name: string; avatar_url?: string | null }
  /** Linked bank statements, payment confirmations or credit advices, oldest first. */
  documents: PaymentDocument[]
}

/** A file linked to a payment or refund. */
export type PaymentDocument = { id: string; name: string; size: number; content_type: string }

export type MoneyMovementKind = 'payment' | 'refund'

export type Refund = {
  id: string
  amount: Decimal
  refunded_on: string
  method: PaymentMethod
  note: string | null
  created_at: string
  created_by: { id: string; name: string; avatar_url?: string | null } | null
  documents: PaymentDocument[]
}

export type Delivery = {
  id: string
  /** `payment_confirmation`: the client was told a payment arrived; `invoice`: the document went out. */
  kind?: 'invoice' | 'payment_confirmation'
  to: string[]
  sent_at: string
  sent_by: { id: string; name: string; avatar_url?: string | null } | null
}

type CurrencyBalance = {
  currency: string
  outstanding: { amount: Decimal; count: number }
  overdue: { amount: Decimal; count: number }
}
export type Summary = {
  open_balances?: CurrencyBalance[]
  currency: string
  outstanding: { amount: Decimal; count: number }
  overdue: { amount: Decimal; count: number }
  paid_this_month: { amount: Decimal; count: number }
  paid_last_month: { amount: Decimal }
  drafts: { amount: Decimal; count: number }
  refund_due: { amount: Decimal; count: number }
  avg_days_to_pay: number | null
  collection_rate: number | null
  monthly: { month: string; invoiced: Decimal; paid: Decimal }[]
  /** Only when asked for with `period`. */
  period?: {
    name: SummaryPeriod
    from: string
    to: string
    paid: { amount: Decimal; count: number }
    paid_previous: { amount: Decimal }
    avg_days_to_pay: number | null
    collection_rate: number | null
  }
}

/** The named periods GET /invoices/summary resolves on the workspace's civil date. */
export const SUMMARY_PERIODS = [
  { value: 'this_month', label: translate('thisMonth2'), phrase: translate('thisMonth') },
  { value: 'last_month', label: translate('lastMonth'), phrase: translate('lastMonth2') },
  { value: 'this_quarter', label: translate('thisQuarter'), phrase: translate('thisQuarter2') },
  { value: 'this_year', label: translate('thisYear'), phrase: translate('thisYear2') },
  {
    value: 'last_12_months',
    label: translate('last12Months'),
    phrase: translate('inTheLast12Months'),
  },
] as const

export type SummaryPeriod = (typeof SUMMARY_PERIODS)[number]['value']

export type InvoiceSettings = {
  /** `legal_form`: a code of the country's list (lib/legal-forms). */
  seller: Party & { phone: string | null; website?: string | null; legal_form?: string | null }
  vat_registered: boolean
  default_vat_mode: VatMode
  default_vat_rate: Decimal
  iban: string | null
  bank_name: string | null
  bic: string | null
  currency: string
  language: DocLanguage
  default_terms_days: number
  number_format: NumberFormat
  footer: string | null
  /** Offered on invoices; new ones start with the enabled methods. */
  qr_bill_enabled: boolean
  revolut_enabled: boolean
  /** The revolut.me username, without the link prefix. */
  revolut_username: string | null
  instalments: InstalmentSettings
  dunning: DunningSettings
  /** A recorded payment emails the client a confirmation, unless turned off for that payment. */
  payment_confirmation: boolean
  logo_file_id: string | null
  /** Where the logo is shown from (GET /invoice-settings/logo), null without one. */
  logo_url: string | null
  is_complete: boolean
  missing_fields: string[]
}

/** What a save sends: a field left out keeps its value (Settings → Client emails saves its switches alone). */
export type SettingsInput = Partial<
  Omit<
    InvoiceSettings,
    | 'is_complete'
    | 'missing_fields'
    | 'logo_file_id'
    | 'logo_url'
    | 'seller'
    | 'instalments'
    | 'dunning'
  >
> & {
  seller?: Partial<InvoiceSettings['seller']>
  instalments?: Partial<InstalmentSettings>
  dunning?: Partial<DunningSettings>
}

export type SendInput = {
  expected_amount_due?: Decimal
  to?: string[]
  cc?: string[]
  /** Hidden copies: delivered, in no header the others see. */
  bcc?: string[]
  subject?: string
  message?: string
  /** false: only marks it sent (its PDF handed over another way), no email. */
  email?: boolean
  /** With email false, false takes a mark as sent back. */
  sent?: boolean
}
export type PaymentInput = {
  request_id?: string
  amount: Decimal
  paid_on: string
  method: PaymentMethod
  note?: string
  /** Email the client a confirmation; omitted: the workspace's setting. */
  notify_client?: boolean
}
export type RefundInput = {
  amount: Decimal
  refunded_on: string
  method: PaymentMethod
  note?: string
}

// Labels

export const UNITS: { value: Unit; label: string; short: string }[] = [
  { value: 'hour', label: translate('hours'), short: 'h' },
  { value: 'day', label: translate('days2'), short: 'd' },
  { value: 'piece', label: translate('pieces'), short: 'pcs' },
  { value: 'month', label: translate('months'), short: 'mo' },
  { value: 'km', label: translate('kilometres'), short: 'km' },
  { value: 'flat', label: translate('flatRate'), short: 'flat' },
]

export const VAT_CATEGORIES: { value: VatCategory; label: string; hint: string }[] = [
  { value: 'S', label: translate('standard'), hint: translate('standardOrReducedRate') },
  { value: 'Z', label: translate('zeroRated'), hint: '0% with the right to deduct input tax' },
  { value: 'E', label: translate('exempt'), hint: translate('printsTheExemptionNote') },
  {
    value: 'AE',
    label: translate('reverseCharge'),
    hint: translate('theClientPaysTheVATNeedsTheirVATNumber'),
  },
  { value: 'K', label: translate('intraEUSupply'), hint: translate('needsTheClientSVATNumber') },
  { value: 'G', label: translate('export'), hint: translate('outsideTheVATArea') },
  { value: 'O', label: translate('notSubject'), hint: translate('sellerNotVATRegistered') },
]

export const INTERVALS: { value: Interval; label: string }[] = [
  { value: 'weekly', label: translate('weekly') },
  { value: 'biweekly', label: translate('everyTwoWeeks') },
  { value: 'monthly', label: translate('monthly2') },
  { value: 'quarterly', label: translate('quarterly') },
  { value: 'yearly', label: translate('yearly3') },
]

export const INSTALMENT_STATUS_LABELS: Record<InstalmentStatus, string> = {
  paid: translate('paid'),
  part_paid: translate('partPaid'),
  open: translate('open'),
  overdue: translate('overdue3'),
  credited: translate('creditedStatus'),
}

/** The official VATEX-EU codes (CEF code list); the API accepts no others. */
export const VATEX_CODES: { value: string; label: string }[] = [
  {
    value: 'VATEX-EU-79-C',
    label: translate('exemptBasedOnArticle79PointCOfCouncil'),
  },
  { value: 'VATEX-EU-132', label: translate('exemptBasedOnArticle132OfCouncilDirective2006') },
  {
    value: 'VATEX-EU-132-1A',
    label: translate('exemptBasedOnArticle132Section1AOf'),
  },
  {
    value: 'VATEX-EU-132-1B',
    label: translate('exemptBasedOnArticle132Section1BOf'),
  },
  {
    value: 'VATEX-EU-132-1C',
    label: translate('exemptBasedOnArticle132Section1COf'),
  },
  {
    value: 'VATEX-EU-132-1D',
    label: translate('exemptBasedOnArticle132Section1DOf'),
  },
  {
    value: 'VATEX-EU-132-1E',
    label: translate('exemptBasedOnArticle132Section1EOf'),
  },
  {
    value: 'VATEX-EU-132-1F',
    label: translate('exemptBasedOnArticle132Section1FOf'),
  },
  {
    value: 'VATEX-EU-132-1G',
    label: translate('exemptBasedOnArticle132Section1GOf'),
  },
  {
    value: 'VATEX-EU-132-1H',
    label: translate('exemptBasedOnArticle132Section1HOf'),
  },
  {
    value: 'VATEX-EU-132-1I',
    label: translate('exemptBasedOnArticle132Section1IOf'),
  },
  {
    value: 'VATEX-EU-132-1J',
    label: translate('exemptBasedOnArticle132Section1JOf'),
  },
  {
    value: 'VATEX-EU-132-1K',
    label: translate('exemptBasedOnArticle132Section1KOf'),
  },
  {
    value: 'VATEX-EU-132-1L',
    label: translate('exemptBasedOnArticle132Section1LOf'),
  },
  {
    value: 'VATEX-EU-132-1M',
    label: translate('exemptBasedOnArticle132Section1MOf'),
  },
  {
    value: 'VATEX-EU-132-1N',
    label: translate('exemptBasedOnArticle132Section1NOf'),
  },
  {
    value: 'VATEX-EU-132-1O',
    label: translate('exemptBasedOnArticle132Section1OOf'),
  },
  {
    value: 'VATEX-EU-132-1P',
    label: translate('exemptBasedOnArticle132Section1POf'),
  },
  {
    value: 'VATEX-EU-132-1Q',
    label: translate('exemptBasedOnArticle132Section1QOf'),
  },
  { value: 'VATEX-EU-143', label: translate('exemptBasedOnArticle143OfCouncilDirective2006') },
  {
    value: 'VATEX-EU-143-1A',
    label: translate('exemptBasedOnArticle143Section1AOf'),
  },
  {
    value: 'VATEX-EU-143-1B',
    label: translate('exemptBasedOnArticle143Section1BOf'),
  },
  {
    value: 'VATEX-EU-143-1C',
    label: translate('exemptBasedOnArticle143Section1COf'),
  },
  {
    value: 'VATEX-EU-143-1D',
    label: translate('exemptBasedOnArticle143Section1DOf'),
  },
  {
    value: 'VATEX-EU-143-1E',
    label: translate('exemptBasedOnArticle143Section1EOf'),
  },
  {
    value: 'VATEX-EU-143-1F',
    label: translate('exemptBasedOnArticle143Section1FOf'),
  },
  {
    value: 'VATEX-EU-143-1FA',
    label: translate('exemptBasedOnArticle143Section1FaOf'),
  },
  {
    value: 'VATEX-EU-143-1G',
    label: translate('exemptBasedOnArticle143Section1GOf'),
  },
  {
    value: 'VATEX-EU-143-1H',
    label: translate('exemptBasedOnArticle143Section1HOf'),
  },
  {
    value: 'VATEX-EU-143-1I',
    label: translate('exemptBasedOnArticle143Section1IOf'),
  },
  {
    value: 'VATEX-EU-143-1J',
    label: translate('exemptBasedOnArticle143Section1JOf'),
  },
  {
    value: 'VATEX-EU-143-1K',
    label: translate('exemptBasedOnArticle143Section1KOf'),
  },
  {
    value: 'VATEX-EU-143-1L',
    label: translate('exemptBasedOnArticle143Section1LOf'),
  },
  { value: 'VATEX-EU-148', label: translate('exemptBasedOnArticle148OfCouncilDirective2006') },
  {
    value: 'VATEX-EU-148-A',
    label: translate('exemptBasedOnArticle148SectionAOfCouncil'),
  },
  {
    value: 'VATEX-EU-148-B',
    label: translate('exemptBasedOnArticle148SectionBOfCouncil'),
  },
  {
    value: 'VATEX-EU-148-C',
    label: translate('exemptBasedOnArticle148SectionCOfCouncil'),
  },
  {
    value: 'VATEX-EU-148-D',
    label: translate('exemptBasedOnArticle148SectionDOfCouncil'),
  },
  {
    value: 'VATEX-EU-148-E',
    label: translate('exemptBasedOnArticle148SectionEOfCouncil'),
  },
  {
    value: 'VATEX-EU-148-F',
    label: translate('exemptBasedOnArticle148SectionFOfCouncil'),
  },
  {
    value: 'VATEX-EU-148-G',
    label: translate('exemptBasedOnArticle148SectionGOfCouncil'),
  },
  { value: 'VATEX-EU-151', label: translate('exemptBasedOnArticle151OfCouncilDirective2006') },
  {
    value: 'VATEX-EU-151-1A',
    label: translate('exemptBasedOnArticle151Section1AOf'),
  },
  {
    value: 'VATEX-EU-151-1AA',
    label: translate('exemptBasedOnArticle151Section1AaOf'),
  },
  {
    value: 'VATEX-EU-151-1B',
    label: translate('exemptBasedOnArticle151Section1BOf'),
  },
  {
    value: 'VATEX-EU-151-1C',
    label: translate('exemptBasedOnArticle151Section1COf'),
  },
  {
    value: 'VATEX-EU-151-1D',
    label: translate('exemptBasedOnArticle151Section1DOf'),
  },
  {
    value: 'VATEX-EU-151-1E',
    label: translate('exemptBasedOnArticle151Section1EOf'),
  },
  { value: 'VATEX-EU-309', label: translate('exemptBasedOnArticle309OfCouncilDirective2006') },
  { value: 'VATEX-EU-AE', label: translate('reverseCharge') },
  {
    value: 'VATEX-EU-D',
    label: translate('intraCommunityAcquisitionFromSecondHandMeansOfTransport'),
  },
  { value: 'VATEX-EU-F', label: translate('intraCommunityAcquisitionOfSecondHandGoods') },
  { value: 'VATEX-EU-G', label: translate('exportOutsideTheEU') },
  { value: 'VATEX-EU-I', label: translate('intraCommunityAcquisitionOfWorksOfArt') },
  { value: 'VATEX-EU-IC', label: translate('intraCommunitySupply') },
  { value: 'VATEX-EU-O', label: translate('notSubjectToVAT') },
  {
    value: 'VATEX-EU-J',
    label: translate('intraCommunityAcquisitionOfCollectorsItemsAndAntiques'),
  },
]

/** Categories whose lines carry a VATEX code; O falls back to VATEX-EU-O on the server. */
export const EXEMPTION_CATEGORIES: readonly VatCategory[] = ['E', 'AE', 'K', 'G', 'O']

/** The code a line of `category` starts with in the editor (null where none applies or must be picked). */
export function defaultExemptionCode(category: VatCategory): string | null {
  if (category === 'O') return 'VATEX-EU-O'
  if (category === 'AE') return 'VATEX-EU-AE'
  if (category === 'K') return 'VATEX-EU-IC'
  if (category === 'G') return 'VATEX-EU-G'
  return null
}

export const EINVOICE_FORMATS: { value: EinvoiceFormat; label: string; hint?: string }[] = [
  { value: 'xrechnung-ubl', label: translate('xrechnungUBL') },
  { value: 'xrechnung-cii', label: translate('xrechnungCII') },
  { value: 'peppol', label: translate('peppolBIS30') },
  { value: 'factur-x', label: translate('facturX'), hint: translate('facturXHint') },
  {
    value: 'ro-cius',
    label: translate('eFacturaCIUSRO'),
    hint: translate('uploadItInSPVSpaIulPrivatVirtual'),
  },
]

/** A document for a Romanian buyer states its VAT in RON too; anything but RON needs the day's rate. */
export const needsRonRate = (buyerCountry: string | null | undefined, currency: string) =>
  buyerCountry === 'RO' && currency !== 'RON'

/** e-Factura only for a Romanian buyer; Polish sellers also get the KSeF structure, uploaded in KSeF's Aplikacja Podatnika. */
export const einvoiceFormatsFor = (
  sellerCountry: string | undefined,
  buyerCountry: string | undefined,
) => [
  ...EINVOICE_FORMATS.filter((format) => buyerCountry === 'RO' || format.value !== 'ro-cius'),
  ...(sellerCountry === 'PL'
    ? [{ value: 'ksef-fa3' as const, label: translate('ksefFA3UploadInAplikacjaPodatnika') }]
    : []),
]

/** Why no e-invoice XML can be made from this invoice, as the API would refuse it; null when it can. */
export function einvoiceBlock(invoice: {
  vat_breakdown: Pick<VatGroup, 'category'>[]
  seller: Pick<Party, 'registration_number'> | null
}) {
  const outside = invoice.vat_breakdown.some((group) => group.category === 'O')
  if (!outside) return null
  if (invoice.vat_breakdown.length > 1) return translate('einvoiceOutsideScopeMixed')
  return invoice.seller?.registration_number?.trim()
    ? null
    : translate('einvoiceOutsideScopeNoRegistration')
}

/** Swiss rates: standard, accommodation, reduced. */
export const VAT_RATES = ['8.1', '3.8', '2.6'] as const

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'bank_transfer', label: translate('bankTransfer') },
  { value: 'twint', label: 'TWINT' },
  { value: 'card', label: translate('card') },
  { value: 'cash', label: translate('cash') },
  { value: 'other', label: translate('other') },
]

const TYPED_FORMAT: NumberFormat = '{YYYY}/{TYPE}/{NNN}'

/** The preset formats usual in each seller country; formats without a year count on and never restart. */
const SWISS_FORMATS: NumberFormat[] = [
  '{YYYY}-{NNN}',
  'RE-{YYYY}-{NNN}',
  '{YY}{NNNN}',
  TYPED_FORMAT,
]
const GERMAN_FORMATS: NumberFormat[] = [
  'RE-{YYYY}-{NNN}',
  '{YYYY}-{NNNN}',
  'RE{YY}{MM}-{NNN}',
  TYPED_FORMAT,
]
const COUNTRY_NUMBER_FORMATS: Record<string, NumberFormat[]> = {
  CH: SWISS_FORMATS,
  LI: SWISS_FORMATS,
  DE: GERMAN_FORMATS,
  AT: GERMAN_FORMATS,
  FR: ['F{YYYY}-{NNNN}', 'FA-{YYYY}-{NNN}', '{YYYY}{MM}-{NNN}', TYPED_FORMAT],
  IT: ['{N}/{YYYY}', '{NNN}/{YYYY}', 'FT-{YYYY}-{NNN}', TYPED_FORMAT],
  ES: ['F{YYYY}-{NNNN}', '{YYYY}/{NNN}', 'FAC-{YYYY}-{NNN}', TYPED_FORMAT],
  PL: ['FV/{N}/{YYYY}', 'FV/{N}/{MM}/{YYYY}', 'FV/{YYYY}/{NNN}', TYPED_FORMAT],
  GB: ['INV-{NNNN}', 'INV-{YYYY}-{NNN}', '{YYYY}-{NNNN}', TYPED_FORMAT],
  US: ['INV-{NNNN}', '{NNNNN}', 'INV-{YYYY}-{NNNN}', '{YYYY}{MM}-{NNN}'],
}

/** The preset number formats for a seller in country; elsewhere a neutral set. */
export const numberFormatsFor = (country: string | undefined): NumberFormat[] =>
  COUNTRY_NUMBER_FORMATS[country ?? ''] ?? [
    '{YYYY}-{NNN}',
    '{YYYY}/{NNN}',
    'INV-{YYYY}-{NNN}',
    TYPED_FORMAT,
  ]

/** What {TYPE} prints, as the API does; without {TYPE} a credit note, proforma or self-billed invoice gets its prefix. */
const TYPE_LETTERS = {
  invoice: 'INV',
  partial: 'INV',
  prepayment: 'PP',
  debit_note: 'DN',
  corrected: 'COR',
  credit_note: 'CN',
  proforma: 'PF',
  self_billed: 'SB',
  quote: 'Q',
  contract: 'C',
} as const

export type NumberedKind = keyof typeof TYPE_LETTERS

const SERIES_PREFIX: Partial<Record<NumberedKind, string>> = {
  credit_note: 'CN-',
  proforma: 'PF-',
  self_billed: 'SB-',
}

/** The number a document of the kind issued on date (YYYY-MM-DD) gets with the sequence seq. */
export function exampleNumber(
  format: NumberFormat,
  date: string,
  seq: number,
  kind: NumberedKind = 'invoice',
) {
  const parts: Record<string, string> = {
    YYYY: date.slice(0, 4),
    YY: date.slice(2, 4),
    MM: date.slice(5, 7),
    DD: date.slice(8, 10),
    TYPE: TYPE_LETTERS[kind],
  }
  const number = format.replace(/\{([A-Z]+)\}/g, (token, name: string) =>
    /^N{1,6}$/.test(name) ? String(seq).padStart(name.length, '0') : (parts[name] ?? token),
  )
  return format.includes('{TYPE}') ? number : `${SERIES_PREFIX[kind] ?? ''}${number}`
}

/** GET /invoice-settings/next-numbers: what the next document of each series takes, this year or for ever. */
export type NextNumbers = {
  series: Record<
    'invoice' | 'credit_note' | 'proforma' | 'self_billed',
    { year: number; ever: number }
  >
  quote: number
  /** Contracts made from quotes (2026/C/001), counted per year like quotes. */
  contract: number
}

/** The kinds that share the invoice counter; the others count apart. */
const own = new Set<NumberedKind>(['credit_note', 'proforma', 'self_billed'])

/** The next number of each kind the format numbers, as the API will give it. */
export function nextNumberOf(
  format: NumberFormat,
  date: string,
  kind: NumberedKind,
  counters: NextNumbers,
) {
  const yearly = /\{YY(YY)?\}/.test(format)
  if (kind === 'quote' || kind === 'contract') {
    // quotes and contracts count per year, so a format without one (or without the type) keeps the default
    const useFormat =
      format.includes('{TYPE}') && yearly ? format : `${TYPE_LETTERS[kind]}-{YYYY}-{NNN}`
    return exampleNumber(useFormat, date, counters[kind], kind)
  }
  const series = counters.series[own.has(kind) ? (kind as keyof NextNumbers['series']) : 'invoice']
  return exampleNumber(format, date, yearly ? series.year : series.ever, kind)
}

/** Why the API would refuse the format, or null. */
export function numberFormatError(format: NumberFormat): string | null {
  const tokens = format.match(/\{[A-Z]+\}/g) ?? []
  const known = /^\{(YYYY|YY|MM|DD|TYPE|N{1,6})\}$/
  if (format.length > 40) return translate('numberFormatTooLong')
  if (
    tokens.some((token) => !known.test(token)) ||
    !/^[A-Za-z0-9 ./_#-]*$/.test(format.replace(/\{[A-Z]+\}/g, ''))
  )
    return translate('numberFormatCharacters')
  if (tokens.filter((token) => /^\{N+\}$/.test(token)).length !== 1)
    return translate('numberFormatOneRunningNumber')
  return null
}

/** What the imported invoices' numbers suggest for a workspace that has issued none of its own. */
export type NumberSuggestion = { format: NumberFormat; year: number; last: number; next: string }

/** What each missing_fields entry is called, as the settings form labels it. */
export const MISSING_LABELS: Record<string, string> = {
  'seller.name': translate('companyName'),
  'seller.street': translate('street'),
  'seller.street_number': translate('number'),
  'seller.zip': 'ZIP',
  'seller.city': translate('city'),
  'seller.country': translate('country'),
  'seller.vat_number': translate('vatNumber'),
  iban: 'IBAN',
}
/** The settings section each field is in, and the link's name; the rest is Company. */
const SETTINGS_SECTIONS: Record<string, [section: string, label: string]> = {
  'seller.vat_number': ['vat', translate('vatSettings')],
  iban: ['bank', translate('bankAccount')],
  'seller.registration_number': ['company', translate('companyDetails')],
  'seller.electronic_address': ['einvoice', translate('eInvoiceSettings')],
}
/** The sections on Settings → Invoices; the others (company, VAT, bank, logo) are on Settings → Company. */
const INVOICE_PAGE_SECTIONS = new Set([
  'einvoice',
  'payment',
  'numbering',
  'defaults',
  'instalments',
  'dunning',
  'footer',
])

/** The settings page opened on a field's section, the field in focus. */
export function settingsFix(field: string): { label: string; href: string } {
  const [section, label] = SETTINGS_SECTIONS[field] ?? ['company', translate('companyDetails')]
  const page = INVOICE_PAGE_SECTIONS.has(section) ? '/settings/invoices' : '/settings/company'
  return {
    label,
    href: `${page}${field ? `?focus=${encodeURIComponent(field)}` : ''}#${section}`,
  }
}

// Payment methods

/** The Swiss QR bill exists for CHF and EUR only. */
export const qrBillCurrency = (currency: string) => currency === 'CHF' || currency === 'EUR'

/** The plain revolut.me link: Revolut documents no amount or currency in it. */
export const revolutLink = (username: string) => `https://revolut.me/${username}`

/** The bare username of "name", "@name" or a pasted revolut.me link; null when it is not one (as the API). */
export function revolutUsername(text: string): string | null {
  const name = (text.trim().split('?')[0] ?? '')
    .replace(/\/$/, '')
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/^revolut\.me\//i, '')
    .replace(/^@/, '')
  return /^[A-Za-z0-9._-]{3,32}$/.test(name) ? name : null
}

const swissIban = (iban: string) => /^(CH|LI)/.test(iban)

/** Why the QR bill cannot be offered on an invoice in currency, or null when it can. */
export function qrBillBlocker(settings: InvoiceSettings, currency: string): string | null {
  if (!settings.qr_bill_enabled) return translate('turnedOffInTheInvoiceSettings')
  if (!settings.iban) return translate('addYourIBANInTheInvoiceSettingsFirst')
  if (!swissIban(settings.iban)) return translate('needsASwissOrLiechtensteinIBANInTheInvoice')
  if (!qrBillCurrency(currency)) return translate('onlyForCHFAndEURNot', { currency: currency })
  return null
}

/** Why Revolut cannot be offered, or null when it can. */
export const revolutBlocker = (settings: InvoiceSettings): string | null =>
  !settings.revolut_enabled
    ? translate('turnedOffInTheInvoiceSettings')
    : settings.revolut_username
      ? null
      : translate('addYourRevolutMeUsernameInTheInvoiceSettings')

/** The chosen methods that can apply: the editor sends only these, as the API keeps only these. */
export const usableMethods = (
  methods: PaymentMethods,
  settings: InvoiceSettings,
  currency: string,
): PaymentMethods => ({
  qr_bill: methods.qr_bill && qrBillBlocker(settings, currency) === null,
  revolut: methods.revolut && revolutBlocker(settings) === null,
})

/** What a new invoice offers: every method that can apply. */
export const defaultPaymentMethods = (settings: InvoiceSettings, currency: string) =>
  usableMethods({ qr_bill: true, revolut: true }, settings, currency)

// Decimals

/** Exact cents of a money string ("-1234.5" → -123450n); rejects anything else. */
export function toCents(value: Decimal): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim())
  if (!match) throw new Error(translate('notAMoneyAmount', { value: value }))
  const cents = BigInt(match[2] ?? '0') * 100n + BigInt((match[3] ?? '').padEnd(2, '0'))
  return match[1] ? -cents : cents
}

export function fromCents(cents: bigint): Decimal {
  const sign = cents < 0n ? '-' : ''
  const abs = cents < 0n ? -cents : cents
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`
}

export const isZero = (value: Decimal) => /^-?0*\.?0*$/.test(value.trim())

/** A line whose "1 × price" would only repeat its amount: one, no unit, no discount, no VAT to show. */
export const repeatsAmount = (
  line: { quantity: Decimal; unit?: string | null; discount_percent: Decimal },
  vatMode: string,
) =>
  Number(line.quantity) === 1 && !line.unit && isZero(line.discount_percent) && vatMode === 'none'
export const isPositive = (value: Decimal) => !isZero(value) && !value.trim().startsWith('-')

/**
 * A decimal string from what someone typed ("1'234,5", "12.") with at most `scale` decimals, or
 * null when it is not a number. Money is padded to its scale; quantities and rates are not.
 */
export function parseDecimalInput(typed: string, scale: number, pad = false): Decimal | null {
  let text = typed.trim().replace(/['’\s_]/g, '')
  if (!text) return null
  // A lone comma is a decimal comma (de/fr/it); with a dot present, commas group thousands.
  text = text.includes('.') ? text.replace(/,/g, '') : text.replace(',', '.')
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text)
  if (!match || (!match[2] && !match[3])) return null
  const fraction = match[3] ?? ''
  if (fraction.length > scale) return null
  const whole = (match[2] ?? '').replace(/^0+(?=\d)/, '') || '0'
  const digits = pad ? fraction.padEnd(scale, '0') : fraction.replace(/0+$/, '')
  return `${match[1]}${whole}${digits ? `.${digits}` : ''}`
}

export { formatAmount, formatMoney } from '@helvetly/ui/lib/format'

/** "1’235" for headline figures where the rappen are noise (rounded half up). */
export function formatWholeAmount(value: Decimal) {
  const cents = toCents(value)
  const whole = (cents < 0n ? cents - 50n : cents + 50n) / 100n
  return formatAmount(String(whole)).replace(/\.00$/, '')
}

/** For charts only (display, never arithmetic). */
export const chartNumber = (value: Decimal) => Number(value)

// Dates (civil dates, the workspace time zone)

export const today = (now = new Date(), tz?: string) => todayIn(tz, now)

export function addDays(date: string, days: number) {
  const day = new Date(`${date}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() + days)
  return day.toISOString().slice(0, 10)
}

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** "12 Nov 2026" for a civil date, without time zone drift. */
export const formatDay = (date: string) =>
  new Intl.DateTimeFormat(languageTag, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date.slice(0, 10)}T00:00:00Z`))

/** "1 Oct – 8 Nov 2026"; the first date keeps its year only when the range crosses one. */
export function formatRange(from: string, to: string) {
  const start = formatDay(from)
  return `${from.slice(0, 4) === to.slice(0, 4) ? start.replace(/ \d{4}$/, '') : start} – ${formatDay(to)}`
}

/** "Due in 5 days", "Due today", "12 days overdue". */
export function dueLabel(due: string, now = today()) {
  const days = daysBetween(now, due)
  if (days === 0) return translate('dueToday')
  if (days > 0)
    return days === 1 ? translate('dueTomorrow') : translate('dueInDays', { days: days })
  return -days === 1 ? translate('message1DayOverdue') : translate('daysOverdue', { value1: -days })
}

// Status

export type DisplayStatus =
  | 'draft'
  | 'open'
  | 'overdue'
  | 'paid'
  | 'void'
  | 'credited'
  | 'replaced'
  | 'credit_draft'
  | 'credit_applied'

export function displayStatus(
  item: Pick<Invoice, 'kind' | 'status' | 'is_overdue' | 'amount_paid'>,
): DisplayStatus {
  if (item.kind === 'credit_note')
    return item.status === 'draft' ? 'credit_draft' : 'credit_applied'
  if (item.status === 'open' && item.is_overdue) return 'overdue'
  // The server marks a fully credited invoice void; one that was paid first (then credited and refunded)
  // was never cancelled unpaid, so it reads "Credited".
  if (item.status === 'void' && isPositive(item.amount_paid)) return 'credited'
  return item.status
}

export const STATUS_LABELS: Record<DisplayStatus, string> = {
  draft: translate('draft'),
  open: translate('open'),
  overdue: translate('overdue3'),
  paid: translate('paid'),
  void: translate('void2'),
  credited: translate('creditedStatus'),
  replaced: translate('replaced'),
  credit_draft: translate('draft'),
  credit_applied: translate('applied'),
}

/** Owners and admins void and delete payments; members do everything else. */
export const canManageInvoices = (role: string | undefined) => role === 'owner' || role === 'admin'

/** "Invoice 2026-004", "Draft invoice", "Credit note CN-2026-001". */
export function documentName(invoice: Pick<Invoice, 'kind' | 'number'>) {
  const noun = kindInfo(invoice.kind).label
  return invoice.number
    ? `${noun} ${invoice.number}`
    : translate('draft3', { value1: noun.toLowerCase() })
}

/** Payment references read in groups of five ("RF18 5390 0754 7034"). */
export const groupReference = (reference: string) =>
  reference.length === 27
    ? `${reference.slice(0, 2)} ${reference.slice(2).replace(/(.{5})(?!$)/g, '$1 ')}`
    : reference.replace(/(.{4})(?!$)/g, '$1 ')

// IBAN

export type IbanInfo =
  | { valid: false }
  | { valid: true; formatted: string; country: string; qr: boolean; swiss: boolean }

/** Checks the IBAN's mod-97 digits and says what kind of payment reference it leads to. */
export function ibanInfo(input: string): IbanInfo {
  const iban = input.replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return { valid: false }
  const digits = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (letter) =>
    String(letter.charCodeAt(0) - 55),
  )
  let rest = 0
  for (const digit of digits) rest = (rest * 10 + Number(digit)) % 97
  if (rest !== 1) return { valid: false }
  const country = iban.slice(0, 2)
  const swiss = country === 'CH' || country === 'LI'
  const iid = Number(iban.slice(4, 9))
  return {
    valid: true,
    formatted: iban.replace(/(.{4})(?!$)/g, '$1 '),
    country,
    swiss,
    qr: swiss && iid >= 30000 && iid <= 31999,
  }
}

/** "CH93 0076 2011 6238 5295 7": an IBAN in groups of four (as stored, when it isn't one). */
export const formatIban = (iban: string) => {
  const info = ibanInfo(iban)
  return info.valid ? info.formatted : iban
}

/**
 * What the customer will be owed back once a credit note of `creditPayable` is issued against
 * `invoice` (the contract's refund_due rule, ahead of the server): shown before issuing.
 */
export function refundAfterCredit(
  invoice: Pick<Invoice, 'amount_paid' | 'amount_credited' | 'amount_refunded' | 'payable_total'>,
  creditPayable: Decimal,
): Decimal {
  const over =
    toCents(invoice.amount_paid) +
    toCents(invoice.amount_credited) +
    toCents(creditPayable) -
    toCents(invoice.payable_total)
  const owed = (over > 0n ? over : 0n) - toCents(invoice.amount_refunded)
  return fromCents(owed > 0n ? owed : 0n)
}

// The list

export const LIST_STATUSES = [
  'draft',
  'open',
  'overdue',
  'paid',
  'void',
  'replaced',
  'refund_due',
] as const
export type ListStatus = (typeof LIST_STATUSES)[number]
export const SORT_FIELDS = [
  'number',
  'issue_date',
  'due_date',
  'next_due_date',
  'total',
  'client',
  'created_at',
] as const
export type SortField = (typeof SORT_FIELDS)[number]

/** Everything that decides which invoices the list shows, as in the URL. */
export type ListParams = {
  page: number
  /** Rows per page, a choice kept in this browser (not in the URL). */
  pageSize?: number
  search: string
  status: ListStatus[]
  kind: InvoiceKind
  client: string | null
  /** Credit notes of one invoice. */
  credited: string | null
  from: string | null
  to: string | null
  totalMin: string | null
  totalMax: string | null
  sort: SortField
  desc: boolean
}

export const PAGE_SIZE = 50
export const DEFAULT_PARAMS: ListParams = {
  page: 1,
  search: '',
  status: [],
  kind: 'invoice',
  client: null,
  credited: null,
  from: null,
  to: null,
  totalMin: null,
  totalMax: null,
  sort: 'issue_date',
  desc: true,
}

const isSortField = (value: string): value is SortField =>
  (SORT_FIELDS as readonly string[]).includes(value)
const isListStatus = (value: string): value is ListStatus =>
  (LIST_STATUSES as readonly string[]).includes(value)
const isDate = (value: string | null): value is string =>
  value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))

/** The list's state from the page URL. Anything unknown or malformed falls back to the default. */
export function parseListParams(query: URLSearchParams): ListParams {
  const page = Number(query.get('page'))
  const sort = query.get('sort') ?? ''
  const field = sort.replace(/^-/, '')
  const kind = query.get('kind')
  const from = query.get('from')
  const to = query.get('to')
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    search: query.get('q') ?? '',
    status: [...new Set(query.getAll('status').filter(isListStatus))],
    kind: isInvoiceKind(kind) ? kind : 'invoice',
    client: query.get('client')?.trim() || null,
    credited: query.get('credited')?.trim() || null,
    from: isDate(from) ? from : null,
    to: isDate(to) ? to : null,
    totalMin: amountParam(query.get('min')),
    totalMax: amountParam(query.get('max')),
    sort: isSortField(field) ? field : DEFAULT_PARAMS.sort,
    desc: isSortField(field) ? sort.startsWith('-') : DEFAULT_PARAMS.desc,
  }
}

const LIST_KEYS = [
  'page',
  'q',
  'status',
  'kind',
  'client',
  'credited',
  'from',
  'to',
  'min',
  'max',
  'sort',
]

/** The list's state as URL query, leaving out defaults so links stay short. Keeps other keys. */
export function listParamsToQuery(params: ListParams, base = new URLSearchParams()) {
  const query = new URLSearchParams(base)
  for (const key of LIST_KEYS) query.delete(key)
  if (params.page > 1) query.set('page', String(params.page))
  if (params.search) query.set('q', params.search)
  for (const status of params.status) query.append('status', status)
  if (params.kind !== DEFAULT_PARAMS.kind) query.set('kind', params.kind)
  if (params.client) query.set('client', params.client)
  if (params.credited) query.set('credited', params.credited)
  if (params.from) query.set('from', params.from)
  if (params.to) query.set('to', params.to)
  if (params.totalMin) query.set('min', params.totalMin)
  if (params.totalMax) query.set('max', params.totalMax)
  if (params.sort !== DEFAULT_PARAMS.sort || params.desc !== DEFAULT_PARAMS.desc)
    query.set('sort', `${params.desc ? '-' : ''}${params.sort}`)
  return query
}

/** The API's list query for `params` (the API pages; export takes the same filters). */
export function apiQuery(params: ListParams, paging = true) {
  const query = new URLSearchParams()
  if (paging) {
    query.set('page', String(params.page))
    query.set('page_size', String(params.pageSize ?? PAGE_SIZE))
  }
  const search = params.search.trim()
  if (search) query.set('search', search)
  for (const status of params.status) query.append('status', status)
  query.set('kind', params.kind)
  if (params.client) query.set('client_id', params.client)
  if (params.credited) query.set('credited_invoice_id', params.credited)
  if (params.from) query.set('issued_from', params.from)
  if (params.to) query.set('issued_to', params.to)
  if (params.totalMin) query.set('total_min', params.totalMin)
  if (params.totalMax) query.set('total_max', params.totalMax)
  query.set('sort', `${params.desc ? '-' : ''}${params.sort}`)
  return query
}

// The API

const path = (id: string) => `/invoices/${encodeURIComponent(id)}`
export type BulkResult = { id: string; ok: boolean; error?: string; message?: string }

const post = (json: unknown = {}) => ({ method: 'POST' as const, json })
/** A payment's or refund's linked files (POST a document_id, or upload a file to the full URL). */
const movementFiles = (id: string, kind: MoneyMovementKind, targetId: string) =>
  `${path(id)}/${kind === 'refund' ? 'refunds' : 'payments'}/${encodeURIComponent(targetId)}/documents`
export const paymentFilesUrl = (id: string, kind: MoneyMovementKind, targetId: string) =>
  `/api/v1${movementFiles(id, kind, targetId)}`
type One<T> = { data: T }

export const invoicesApi = {
  list: (query: URLSearchParams) => request<Page<InvoiceListItem>>(`/invoices?${query}`),
  summary: (clientId?: string, period?: SummaryPeriod) => {
    const query = new URLSearchParams()
    if (clientId) query.set('client_id', clientId)
    if (period) query.set('period', period)
    return request<One<Summary>>(`/invoices/summary${query.size ? `?${query}` : ''}`)
  },
  preview: (input: Partial<InvoiceInput>, signal?: AbortSignal) =>
    request<One<InvoicePreview>>('/invoices/preview', { ...post(input), signal }),
  get: (id: string) => request<One<Invoice>>(path(id)),
  einvoice: (id: string, format: EinvoiceFormat) =>
    respond(`${path(id)}/einvoice?${new URLSearchParams({ format })}`),
  create: (input: Partial<InvoiceInput>) => request<One<Invoice>>('/invoices', post(input)),
  update: (id: string, input: Partial<InvoiceInput>) =>
    request<One<Invoice>>(path(id), { method: 'PATCH', json: input }),
  remove: (id: string) => request<void>(path(id), { method: 'DELETE' }),
  issue: (id: string) => request<One<Invoice>>(`${path(id)}/issue`, post()),
  /** Each id on its own: what one cannot do comes back with its error code, the rest still go ahead. */
  bulk: (action: 'mark_paid' | 'issue', ids: string[]) =>
    request<{ data: BulkResult[] }>('/invoices/bulk', post({ action, ids })),
  duplicate: (id: string) => request<One<Invoice>>(`${path(id)}/duplicate`, post()),
  creditNote: (id: string, body: { reason?: string } = {}) =>
    request<One<Invoice>>(`${path(id)}/credit-note`, post(body)),
  correct: (id: string) => request<One<Invoice>>(`${path(id)}/correct`, post()),
  debitNote: (id: string) => request<One<Invoice>>(`${path(id)}/debit-note`, post()),
  convert: (id: string, kind: 'invoice' | 'prepayment') =>
    request<One<Invoice>>(`${path(id)}/convert`, post({ kind })),
  void: (id: string, reason?: string) =>
    request<One<Invoice>>(`${path(id)}/void`, post(reason ? { reason } : {})),
  addPayment: (id: string, input: PaymentInput) =>
    request<One<Invoice>>(`${path(id)}/payments`, post(input)),
  payments: (id: string) => request<One<Payment[]>>(`${path(id)}/payments`),
  addRefund: (id: string, input: RefundInput) =>
    request<One<Invoice>>(`${path(id)}/refunds`, post(input)),
  deleteRefund: (id: string, refundId: string) =>
    request<void>(`${path(id)}/refunds/${encodeURIComponent(refundId)}`, { method: 'DELETE' }),
  deletePayment: (id: string, paymentId: string) =>
    request<void>(`${path(id)}/payments/${encodeURIComponent(paymentId)}`, { method: 'DELETE' }),
  attachPaymentDocument: (
    id: string,
    kind: MoneyMovementKind,
    targetId: string,
    documentId: string,
  ) => request<void>(movementFiles(id, kind, targetId), post({ document_id: documentId })),
  detachPaymentDocument: (
    id: string,
    kind: MoneyMovementKind,
    targetId: string,
    documentId: string,
  ) =>
    request<void>(`${movementFiles(id, kind, targetId)}/${encodeURIComponent(documentId)}`, {
      method: 'DELETE',
    }),
  send: (id: string, input: SendInput) => request<One<Invoice>>(`${path(id)}/send`, post(input)),
  deliveries: (id: string) => request<One<Delivery[]>>(`${path(id)}/deliveries`),
  settings: async () =>
    settingsFrom((await request<One<InvoiceSettingsResponse>>('/invoice-settings')).data),
  saveSettings: async (input: SettingsInput) =>
    settingsFrom(
      (
        await request<One<InvoiceSettingsResponse>>('/invoice-settings', {
          method: 'PUT',
          json: input,
        })
      ).data,
    ),
  createPlan: (id: string, body: PlanInput) => request<One<Plan>>(`${path(id)}/plan`, post(body)),
  nextNumbers: async () => (await request<One<NextNumbers>>('/invoice-settings/next-numbers')).data,
  numberSuggestion: async () =>
    (await request<One<NumberSuggestion | null>>('/invoice-settings/number-suggestion')).data,
  applyNumberSuggestion: async () =>
    settingsFrom(
      (
        await request<One<InvoiceSettingsResponse>>('/invoice-settings/number-suggestion', {
          method: 'POST',
        })
      ).data,
    ),
}

// Downloads go through plain links so the browser sends the session cookie and saves the file.
export const pdfUrl = (id: string, download = false) =>
  `/api/v1${path(id)}/pdf${download ? '?download=1' : ''}`
export const einvoiceUrl = (id: string, format: EinvoiceFormat) =>
  `/api/v1${path(id)}/einvoice?${new URLSearchParams({ format })}`
export const exportUrl = (params: ListParams) =>
  `/api/v1/invoices/export?${apiQuery(params, false)}`
export const exportIdsUrl = (ids: string[]) =>
  `/api/v1/invoices/export?${new URLSearchParams({ ids: ids.join(',') })}`

export const invoiceKeys = {
  all: ['invoices'] as const,
  lists: ['invoices', 'list'] as const,
  list: (query: string) => ['invoices', 'list', query] as const,
  summary: ['invoices', 'summary'] as const,
  detail: (id: string) => ['invoices', 'detail', id] as const,
  deliveries: (id: string) => ['invoices', 'detail', id, 'deliveries'] as const,
  preview: (input: string) => ['invoices', 'preview', input] as const,
  settings: ['invoice-settings'] as const,
}

/** The list for `params`; also the client's invoices (`client` set, everything else default). */
export function useInvoiceList(params: ListParams) {
  return useQuery({ ...invoiceListQuery(params), placeholderData: keepPreviousData })
}

export const invoiceListQuery = (params: ListParams) => {
  const query = apiQuery(params)
  return { queryKey: invoiceKeys.list(query.toString()), queryFn: () => invoicesApi.list(query) }
}

/** Issued documents of every kind (open or paid), newest first: what credit notes and corrections start from. */
export function useIssuedInvoices(search: string) {
  const query = apiQuery({ ...DEFAULT_PARAMS, search, status: ['open', 'paid'] })
  query.delete('kind')
  return useQuery({
    queryKey: invoiceKeys.list(query.toString()),
    queryFn: () => invoicesApi.list(query),
    placeholderData: keepPreviousData,
  })
}

/** Paid prepayments can span several pages; the picker must not hide older eligible documents. */
export function usePaidPrepayments(clientId: string) {
  return useInfiniteQuery({
    queryKey: [...invoiceKeys.lists, 'paid-prepayments', clientId],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      invoicesApi.list(
        apiQuery({
          ...DEFAULT_PARAMS,
          page: pageParam,
          kind: 'prepayment',
          status: ['paid'],
          client: clientId,
        }),
      ),
    getNextPageParam: (last) =>
      last.meta.page < last.meta.total_pages ? last.meta.page + 1 : undefined,
  })
}

/** The key figures; with a client, that client's only (its drawer). */
export function useInvoiceSummary(clientId?: string, period?: SummaryPeriod) {
  return useQuery({
    queryKey: [...invoiceKeys.summary, clientId ?? '', period ?? ''],
    queryFn: async () => (await invoicesApi.summary(clientId, period)).data,
    // Switching period keeps the figures on screen until the new ones arrive (never across clients).
    placeholderData: period ? keepPreviousData : undefined,
  })
}

export const invoiceQuery = (id: string) => ({
  queryKey: invoiceKeys.detail(id),
  queryFn: async () => (await invoicesApi.get(id)).data,
})

export function useInvoice(id: string | null) {
  return useQuery({ ...invoiceQuery(id ?? ''), enabled: id !== null })
}

export function useInvoiceDeliveries(id: string, enabled = true) {
  return useQuery({
    queryKey: invoiceKeys.deliveries(id),
    queryFn: async () => (await invoicesApi.deliveries(id)).data,
    enabled,
  })
}

export function useInvoiceSettings() {
  return useQuery({
    queryKey: invoiceKeys.settings,
    queryFn: invoicesApi.settings,
    staleTime: 60_000,
  })
}

/** Totals for what the editor shows, computed by the server; `input` null pauses it. */
export function useInvoicePreview(input: Partial<InvoiceInput> | null) {
  const key = JSON.stringify(input)
  return useQuery({
    queryKey: invoiceKeys.preview(key),
    queryFn: async ({ signal }) => (await invoicesApi.preview(input ?? {}, signal)).data,
    enabled: input !== null,
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  })
}

/** After a write that returns an invoice: its cache, and every list and the key figures. */
function refresh(queryClient: QueryClient, invoice?: Invoice) {
  if (invoice) queryClient.setQueryData(invoiceKeys.detail(invoice.id), invoice)
  void queryClient.invalidateQueries({ queryKey: invoiceKeys.lists })
  void queryClient.invalidateQueries({ queryKey: invoiceKeys.summary })
  void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard })
}

/** Creates (no id) or autosaves a draft. Lists refresh; the editor keeps its own state. */
export function useSaveInvoice() {
  const queryClient = useQueryClient()
  return useMutation<Invoice, ApiError, { id?: string; input: Partial<InvoiceInput> }>({
    mutationFn: async ({ id, input }) =>
      (id ? await invoicesApi.update(id, input) : await invoicesApi.create(input)).data,
    onSuccess: (invoice) => refresh(queryClient, invoice),
  })
}

export function useDeleteInvoice() {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string>({
    mutationFn: invoicesApi.remove,
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: invoiceKeys.detail(id) })
      refresh(queryClient)
    },
  })
}

/** Issue, duplicate, send, mark paid, record a payment: any write that answers with an invoice. */
export function useInvoiceAction<Variables>(
  run: (variables: Variables) => Promise<One<Invoice>>,
  also: (invoice: Invoice, queryClient: QueryClient) => void = () => {},
) {
  const queryClient = useQueryClient()
  return useMutation<Invoice, ApiError, Variables>({
    mutationFn: async (variables) => (await run(variables)).data,
    onSuccess: (invoice) => {
      refresh(queryClient, invoice)
      also(invoice, queryClient)
    },
  })
}

/** A credit note (or a void, which issues one) also changes the credited invoice. */
const creditedChanged = (invoice: Invoice, queryClient: QueryClient) => {
  if (invoice.credited_invoice)
    void queryClient.invalidateQueries({
      queryKey: invoiceKeys.detail(invoice.credited_invoice.id),
      exact: true,
    })
}

// Issuing a credit note applies it to its invoice (paid, void, a refund due).
export const useIssueInvoice = () =>
  useInvoiceAction((id: string) => invoicesApi.issue(id), creditedChanged)
export const useDuplicateInvoice = () => useInvoiceAction((id: string) => invoicesApi.duplicate(id))
export const useSendInvoice = () =>
  useInvoiceAction(
    ({ id, input }: { id: string; input: SendInput }) => invoicesApi.send(id, input),
    (invoice, queryClient) =>
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.deliveries(invoice.id) }),
  )

// The invoice in the answer carries its payments, so its cache is all that changes.
export const useAddPayment = () =>
  useInvoiceAction(({ id, input }: { id: string; input: PaymentInput }) =>
    invoicesApi.addPayment(id, input),
  )
export const useAddRefund = () =>
  useInvoiceAction(({ id, input }: { id: string; input: RefundInput }) =>
    invoicesApi.addRefund(id, input),
  )

export const useCreditNote = () =>
  useInvoiceAction((id: string) => invoicesApi.creditNote(id), creditedChanged)
export const useVoidInvoice = () =>
  useInvoiceAction(({ id, reason }: { id: string; reason?: string }) =>
    invoicesApi.void(id, reason),
  )

export function useDeletePayment(id: string) {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string>({
    mutationFn: (paymentId) => invoicesApi.deletePayment(id, paymentId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(id), exact: true })
      refresh(queryClient)
    },
  })
}

export function useDeleteRefund(id: string) {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, string>({
    mutationFn: (refundId) => invoicesApi.deleteRefund(id, refundId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: invoiceKeys.detail(id), exact: true })
      refresh(queryClient)
    },
  })
}

export function useSaveInvoiceSettings() {
  const queryClient = useQueryClient()
  return useMutation<InvoiceSettings, ApiError, SettingsInput>({
    mutationFn: invoicesApi.saveSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(invoiceKeys.settings, settings)
      // Drafts show the current IBAN; previews and PDFs of drafts use the current seller.
      void queryClient.invalidateQueries({ queryKey: ['invoices', 'preview'] })
    },
  })
}

/** Why issuing was refused: a stable code, the field it is about, a sentence for the person. */
export type IssueReason = { code: string; field?: string; message: string }

const isReason = (value: unknown): value is IssueReason =>
  typeof value === 'object' &&
  value !== null &&
  'code' in value &&
  typeof value.code === 'string' &&
  'message' in value &&
  typeof value.message === 'string'

/** The 422 cannot_issue reasons, or null for any other error. */
export function cannotIssueReasons(error: unknown): IssueReason[] | null {
  if (!(error instanceof ApiError) || error.code !== 'cannot_issue') return null
  const reasons = error.details.reasons
  return Array.isArray(reasons)
    ? reasons.filter(isReason)
    : [{ code: 'unknown', message: error.message }]
}

// The logo

/** The logo's URL, changing with each upload so the browser never shows an old one. */
export const logoSrc = (settings: Pick<InvoiceSettings, 'logo_url' | 'logo_file_id'>) =>
  settings.logo_url && `${settings.logo_url}?v=${encodeURIComponent(settings.logo_file_id ?? '')}`

/** What a logo picker offers; the bytes picked decide what a file is (lib/logo-crop.ts sniffFormat), not this list. */
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']
export const LOGO_MAX_BYTES = 2 * 1024 * 1024

/** Why `file` is too big to be a logo, before it is read; null when it is not. */
export function logoProblem(file: File) {
  return file.size > LOGO_MAX_BYTES ? translate('theLogoCanBeAtMost2MB') : null
}

/** Uploads the logo with progress (0–1); resolves with the settings, rejects with the server's error. */
export function uploadLogo(
  file: File,
  onProgress: (share: number) => void,
): Promise<InvoiceSettings> {
  const form = new FormData()
  form.append('file', file)
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', '/api/v1/invoice-settings/logo')
    xhr.setRequestHeader(translate('accept'), 'application/json')
    const token = getCsrfToken()
    if (token) xhr.setRequestHeader('X-CSRF-Token', token)
    xhr.responseType = 'json'
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    })
    xhr.addEventListener('load', () => {
      const body: unknown = xhr.response
      const data = (body as { data?: InvoiceSettingsResponse } | null)?.data
      if (xhr.status >= 200 && xhr.status < 300 && data) resolve(settingsFrom(data))
      else {
        // A refused file says why in details.fields.file (type, size).
        const error = errorFromBody(xhr.status, body)
        const fields = error.details.fields
        const reason =
          typeof fields === 'object' && fields !== null && 'file' in fields ? fields.file : null
        reject(typeof reason === 'string' ? new ApiError(error.status, error.code, reason) : error)
      }
    })
    xhr.addEventListener('error', () =>
      reject(new ApiError(0, 'network_error', translate('cannotReachHelvetlyCheckYourConnection'))),
    )
    xhr.send(form)
  })
}

/** Uploading and removing the logo; both refresh the settings (and so every draft's preview). */
export function useLogo() {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<number | null>(null)
  const done = (settings?: InvoiceSettings) => {
    if (settings) queryClient.setQueryData(invoiceKeys.settings, settings)
    else void queryClient.invalidateQueries({ queryKey: invoiceKeys.settings })
    void queryClient.invalidateQueries({ queryKey: ['invoices', 'preview'] })
  }
  const upload = useMutation<InvoiceSettings, ApiError, File>({
    mutationFn: (file) => {
      setProgress(0)
      return uploadLogo(file, setProgress)
    },
    onSuccess: (settings) => done(settings),
    onSettled: () => setProgress(null),
  })
  const remove = useMutation<void, ApiError, void>({
    mutationFn: () => request<void>('/invoice-settings/logo', { method: 'DELETE' }),
    onSuccess: () => done(),
  })
  return { upload, remove, progress }
}

const UNSUPPORTED_SELLER_SYSTEMS: Record<string, string> = {
  HU: translate('theNAVOnlineSzMlaRealTimeReporting'),
  PT: translate('certifiedInvoicingSoftwareATCUDQRCodeSAFT'),
  RO: translate('roEFactura'),
}

/** Why a seller in this country cannot invoice here yet (the server refuses it too); undefined when it can. */
export function unsupportedSellerCountry(country: string): string | undefined {
  const system = UNSUPPORTED_SELLER_SYSTEMS[country]
  return system
    ? translate('helvetlyCannotIssueInvoicesForASellerInYet', { country: country, system: system })
    : undefined
}
