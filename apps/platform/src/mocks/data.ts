import type { CashFlowPoint, Dashboard, Expense } from '@/lib/api'
import type { FinancialEvent, MonthActivity, Period, SelfBillingAgreement } from '@/lib/books'
import type { Plan, PlanItem } from '@/lib/instalments'
import type { Invoice as ApiInvoice, InstalmentSettings } from '@/lib/invoices'

/** Heidi's scripted answers and the dashboard figures still read these (not the invoices API). */
type Invoice = {
  id: string
  number: string
  client: string
  company: string
  due_date: string
  amount: number
  status: 'paid' | 'sent' | 'overdue' | 'draft'
}

// Plausible Swiss sample data in the shapes the Go API will return.

export const invoices: Invoice[] = [
  {
    id: 'inv_01',
    number: 'INV-2026-044',
    client: 'Lena Brunner',
    company: 'Alpenglow Studio GmbH',
    due_date: '2026-11-12',
    amount: 4850,
    status: 'sent',
  },
  {
    id: 'inv_02',
    number: 'INV-2026-043',
    client: 'Marco Keller',
    company: 'Keller Holzbau AG',
    due_date: '2026-11-03',
    amount: 12400,
    status: 'overdue',
  },
  {
    id: 'inv_03',
    number: 'INV-2026-042',
    client: 'Sophie Meier',
    company: 'Meier & Partner',
    due_date: '2026-10-28',
    amount: 2150,
    status: 'paid',
  },
  {
    id: 'inv_04',
    number: 'INV-2026-041',
    client: 'Jonas Frei',
    company: 'Frei Logistik GmbH',
    due_date: '2026-11-20',
    amount: 7320.5,
    status: 'sent',
  },
  {
    id: 'inv_05',
    number: 'INV-2026-040',
    client: 'Anna Schmid',
    company: 'Schmid Treuhand',
    due_date: '2026-10-21',
    amount: 960,
    status: 'paid',
  },
  {
    id: 'inv_06',
    number: 'INV-2026-039',
    client: 'David Huber',
    company: 'Huber Elektro AG',
    due_date: '2026-10-30',
    amount: 3480,
    status: 'overdue',
  },
  {
    id: 'inv_07',
    number: 'INV-2026-038',
    client: 'Laura Weber',
    company: 'Weber Design',
    due_date: '2026-12-01',
    amount: 1890,
    status: 'draft',
  },
  {
    id: 'inv_08',
    number: 'INV-2026-037',
    client: 'Nico Baumann',
    company: 'Baumann Consulting',
    due_date: '2026-10-15',
    amount: 5600,
    status: 'paid',
  },
  {
    id: 'inv_09',
    number: 'INV-2026-036',
    client: 'Mia Fischer',
    company: 'Fischer Gastro GmbH',
    due_date: '2026-11-25',
    amount: 2740,
    status: 'sent',
  },
  {
    id: 'inv_10',
    number: 'INV-2026-035',
    client: 'Luca Gerber',
    company: 'Gerber Immobilien',
    due_date: '2026-10-09',
    amount: 18200,
    status: 'paid',
  },
  {
    id: 'inv_11',
    number: 'INV-2026-034',
    client: 'Elena Moser',
    company: 'Moser Medtech AG',
    due_date: '2026-10-27',
    amount: 6150,
    status: 'overdue',
  },
  {
    id: 'inv_12',
    number: 'INV-2026-033',
    client: 'Tim Zimmermann',
    company: 'Zimmermann Bau',
    due_date: '2026-12-05',
    amount: 4300,
    status: 'draft',
  },
  {
    id: 'inv_13',
    number: 'INV-2026-032',
    client: 'Nina Steiner',
    company: 'Steiner Optik',
    due_date: '2026-10-02',
    amount: 1275,
    status: 'paid',
  },
  {
    id: 'inv_14',
    number: 'INV-2026-031',
    client: 'Reto Wyss',
    company: 'Wyss Velos',
    due_date: '2026-11-18',
    amount: 890,
    status: 'sent',
  },
  {
    id: 'inv_15',
    number: 'INV-2026-030',
    client: 'Carla Rossi',
    company: 'Rossi Architetti SA',
    due_date: '2026-09-30',
    amount: 9400,
    status: 'paid',
  },
]

export const expenses: Expense[] = [
  {
    id: 'exp_01',
    vendor: 'SBB CFF FFS',
    category: 'Travel',
    date: '2026-11-04',
    amount: 184.6,
    vat: 14.95,
    status: 'pending',
  },
  {
    id: 'exp_02',
    vendor: 'Swisscom',
    category: 'Telecom',
    date: '2026-11-02',
    amount: 129,
    vat: 10.45,
    status: 'approved',
  },
  {
    id: 'exp_03',
    vendor: 'Digitec Galaxus',
    category: 'Equipment',
    date: '2026-10-31',
    amount: 1649,
    vat: 133.57,
    status: 'approved',
  },
  {
    id: 'exp_04',
    vendor: 'Migros',
    category: 'Office supplies',
    date: '2026-10-30',
    amount: 86.35,
    vat: 6.99,
    status: 'approved',
  },
  {
    id: 'exp_05',
    vendor: 'Hotel Schweizerhof Bern',
    category: 'Travel',
    date: '2026-10-28',
    amount: 412,
    vat: 33.37,
    status: 'pending',
  },
  {
    id: 'exp_06',
    vendor: 'Restaurant Kronenhalle',
    category: 'Meals',
    date: '2026-10-27',
    amount: 268.5,
    vat: 21.75,
    status: 'rejected',
  },
  {
    id: 'exp_07',
    vendor: 'Adobe Systems',
    category: 'Software',
    date: '2026-10-25',
    amount: 79.9,
    vat: 6.47,
    status: 'approved',
  },
  {
    id: 'exp_08',
    vendor: 'Post CH AG',
    category: 'Postage',
    date: '2026-10-24',
    amount: 42.4,
    vat: 3.43,
    status: 'approved',
  },
  {
    id: 'exp_09',
    vendor: 'Coop Pronto',
    category: 'Meals',
    date: '2026-10-22',
    amount: 23.8,
    vat: 1.93,
    status: 'pending',
  },
  {
    id: 'exp_10',
    vendor: 'Mobility Genossenschaft',
    category: 'Travel',
    date: '2026-10-20',
    amount: 96,
    vat: 7.78,
    status: 'approved',
  },
  {
    id: 'exp_11',
    vendor: 'Google Workspace',
    category: 'Software',
    date: '2026-10-18',
    amount: 138,
    vat: 11.18,
    status: 'approved',
  },
  {
    id: 'exp_12',
    vendor: 'Brack.ch',
    category: 'Equipment',
    date: '2026-10-15',
    amount: 329,
    vat: 26.65,
    status: 'pending',
  },
  {
    id: 'exp_13',
    vendor: 'Swiss International Air Lines',
    category: 'Travel',
    date: '2026-10-12',
    amount: 586,
    vat: 47.47,
    status: 'approved',
  },
  {
    id: 'exp_14',
    vendor: 'Ikea Spreitenbach',
    category: 'Office supplies',
    date: '2026-10-09',
    amount: 214.9,
    vat: 17.41,
    status: 'rejected',
  },
]

/** Heidi's mock answers talk about these; the real clients come from the API. */
type MockClient = {
  id: string
  company: string
  contact: string
  city: string
  open_balance: number
  status: 'active' | 'new' | 'inactive'
}

export const clients: MockClient[] = [
  {
    id: 'cli_01',
    company: 'Alpenglow Studio GmbH',
    contact: 'Lena Brunner',
    city: 'Zürich',
    open_balance: 4850,
    status: 'active',
  },
  {
    id: 'cli_02',
    company: 'Keller Holzbau AG',
    contact: 'Marco Keller',
    city: 'Luzern',
    open_balance: 12400,
    status: 'active',
  },
  {
    id: 'cli_03',
    company: 'Meier & Partner',
    contact: 'Sophie Meier',
    city: 'Basel',
    open_balance: 0,
    status: 'active',
  },
  {
    id: 'cli_04',
    company: 'Frei Logistik GmbH',
    contact: 'Jonas Frei',
    city: 'Winterthur',
    open_balance: 7320.5,
    status: 'new',
  },
  {
    id: 'cli_05',
    company: 'Schmid Treuhand',
    contact: 'Anna Schmid',
    city: 'Bern',
    open_balance: 0,
    status: 'active',
  },
  {
    id: 'cli_06',
    company: 'Huber Elektro AG',
    contact: 'David Huber',
    city: 'St. Gallen',
    open_balance: 3480,
    status: 'active',
  },
  {
    id: 'cli_07',
    company: 'Weber Design',
    contact: 'Laura Weber',
    city: 'Zug',
    open_balance: 0,
    status: 'new',
  },
  {
    id: 'cli_08',
    company: 'Baumann Consulting',
    contact: 'Nico Baumann',
    city: 'Aarau',
    open_balance: 0,
    status: 'inactive',
  },
  {
    id: 'cli_09',
    company: 'Fischer Gastro GmbH',
    contact: 'Mia Fischer',
    city: 'Lausanne',
    open_balance: 2740,
    status: 'active',
  },
  {
    id: 'cli_10',
    company: 'Gerber Immobilien',
    contact: 'Luca Gerber',
    city: 'Thun',
    open_balance: 0,
    status: 'active',
  },
  {
    id: 'cli_11',
    company: 'Moser Medtech AG',
    contact: 'Elena Moser',
    city: 'Genève',
    open_balance: 6150,
    status: 'active',
  },
  {
    id: 'cli_12',
    company: 'Zimmermann Bau',
    contact: 'Tim Zimmermann',
    city: 'Chur',
    open_balance: 0,
    status: 'new',
  },
  {
    id: 'cli_13',
    company: 'Steiner Optik',
    contact: 'Nina Steiner',
    city: 'Biel/Bienne',
    open_balance: 0,
    status: 'inactive',
  },
  {
    id: 'cli_14',
    company: 'Rossi Architetti SA',
    contact: 'Carla Rossi',
    city: 'Lugano',
    open_balance: 0,
    status: 'active',
  },
]
const total = (amounts: number[]) => Math.round(amounts.reduce((sum, n) => sum + n, 0) * 100) / 100
const amounts = (rows: { amount: number }[]) => total(rows.map((row) => row.amount))
const open = invoices.filter((invoice) => invoice.status === 'sent' || invoice.status === 'overdue')
const overdue = invoices.filter((invoice) => invoice.status === 'overdue')

// A smooth, deterministic wave: the same chart on every reload.
const wave = (i: number, base: number, swing: number, phase: number) =>
  Math.round(base + swing * Math.sin(i / 2.2 + phase) + base * 0.012 * i)

const series = (count: number, stepDays: number, scale: number): CashFlowPoint[] =>
  Array.from({ length: count }, (_, i) => {
    const day = new Date(Date.UTC(2026, 10, 5) - (count - 1 - i) * stepDays * 86_400_000)
    return {
      date: day.toISOString().slice(0, 10),
      income: wave(i, 38_000 * scale, 9_000 * scale, 0),
      expenses: wave(i, 24_000 * scale, 5_000 * scale, 1.4),
    }
  })

// January 2024 to November 2026, each year a little busier than the one before.
const yearsSeries: CashFlowPoint[] = Array.from({ length: 35 }, (_, i) => ({
  date: new Date(Date.UTC(2024, i, 1)).toISOString().slice(0, 10),
  income: wave(i, 30_000, 8_000, 0),
  expenses: wave(i, 21_000, 4_000, 1.4),
}))

const paid = invoices.filter((invoice) => invoice.status === 'paid')
const approved = expenses.filter((expense) => expense.status === 'approved')

export const dashboard: Dashboard = {
  currency: 'CHF',
  currencies: ['CHF'],
  outstanding: amounts(open),
  open_count: open.length,
  paid_this_month: amounts(paid),
  paid_change: 0.12,
  overdue_count: overdue.length,
  invoice_count: invoices.length,
  avg_days_to_pay: 18,
  collection_rate: paid.length / (paid.length + overdue.length),
  spent_this_month: amounts(expenses),
  vat_to_reclaim: total(approved.map((expense) => expense.vat)),
  pending_count: expenses.filter((expense) => expense.status === 'pending').length,
  expense_count: expenses.length,
  receipts_matched: 0.92,
  trends: {
    outstanding: [31, 33, 32, 36, 35, 38, 37, 40, 39, 42, 44, 46],
    paid: [18, 17, 20, 19, 22, 21, 24, 23, 25, 27, 28, 32],
    spent: [6.1, 5.8, 6.4, 6, 6.9, 6.5, 7.2, 6.8, 7.4, 7.1, 7.9, 8.4],
    vat: [0.31, 0.28, 0.35, 0.33, 0.38, 0.36, 0.41, 0.39, 0.42, 0.44, 0.47, 0.5],
  },
  cash_flow: {
    '30d': series(30, 1, 1 / 30),
    '90d': series(13, 7, 7 / 30),
    '12m': series(12, 30, 1),
    years: yearsSeries,
  },
  unread: { notifications: 4, inbox: 1 },
}

// Instalments and books: the shapes of docs/invoices-contract.md and docs/books-contract.md.

export const instalmentSettings: InstalmentSettings = {
  count: 3,
  interval: 'monthly',
  mode: 'schedule',
  plan_lead_days: 10,
  plan_auto_send: true,
  reminders_enabled: true,
  remind_before_days: 5,
  remind_after_days: [3, 10],
}

const seller = {
  name: 'Muster Treuhand GmbH',
  street: 'Bahnhofstrasse',
  street_number: '21',
  apt: null,
  zip: '8001',
  city: 'Zürich',
  country: 'CH',
  vat_number: 'CHE-109.322.551 MWST',
  email: 'billing@muster-treuhand.ch',
}

/** The contract's example: CHF 1'081.00 in three monthly parts, 500.00 paid. */
export const scheduledInvoice: ApiInvoice = {
  id: 'inv_mock_schedule',
  kind: 'invoice',
  type_code: '380',
  number: '2026-042',
  status: 'open',
  approval_state: null,
  is_overdue: false,
  client_id: 'cli_mock_1',
  client: { id: 'cli_mock_1', number: 7, name: 'Alpenglow Studio GmbH' },
  credited_invoice: null,
  quote: null,
  issue_date: '2026-11-02',
  due_date: '2027-02-01',
  service_date: '2026-10-31',
  service_date_end: null,
  currency: 'CHF',
  language: 'de',
  vat_mode: 'exclusive',
  reference: 'Website relaunch',
  client_number_display: null,
  contract_reference: null,
  contract_document: null,
  tax_currency_rate: null,
  intro: null,
  footer: null,
  note: null,
  lines: [
    {
      id: 'lin_mock_1',
      position: 1,
      description: 'Website relaunch',
      quantity: '1',
      unit: 'flat',
      unit_price: '1000.00',
      discount_percent: '0',
      vat_category: 'S',
      vat_rate: '8.1',
      vat_exemption_code: null,
      vat_exemption_reason: null,
      amount: '1000.00',
    },
  ],
  discount_percent: '0',
  subtotal: '1000.00',
  discount_amount: '0.00',
  net_total: '1000.00',
  vat_breakdown: [{ category: 'S', rate: '8.1', taxable_amount: '1000.00', vat_amount: '81.00' }],
  vat_total: '81.00',
  total: '1081.00',
  rounding_amount: '0.00',
  payable_total: '1081.00',
  prepaid_total: '0.00',
  prepayments: [],
  deducted_on: null,
  amount_paid: '500.00',
  amount_credited: '0.00',
  amount_due: '581.00',
  amount_refunded: '0.00',
  refund_due: '0.00',
  payments: [
    {
      id: 'pay_mock_1',
      amount: '500.00',
      paid_on: '2026-11-04',
      method: 'bank_transfer',
      note: null,
      created_at: '2026-11-04T10:00:00Z',
      created_by: { id: 'usr_mock_1', name: 'Anna Muster' },
    },
  ],
  refunds: [],
  payment_methods: { qr_bill: true, revolut: false },
  payment: {
    iban: 'CH44 3199 9123 0008 8901 2',
    reference_type: 'QRR',
    reference: '00 00000 00000 20260 00042 00007',
    qr_bill: true,
    revolut_url: null,
  },
  seller,
  buyer: {
    ...seller,
    name: 'Alpenglow Studio GmbH',
    street: 'Seefeldstrasse',
    street_number: '88',
    zip: '8008',
    vat_number: null,
    email: 'hello@alpenglow.ch',
  },
  issued_at: '2026-11-02T08:30:00Z',
  sent_at: '2026-11-02T08:31:00Z',
  created_at: '2026-11-01T16:00:00Z',
  updated_at: '2026-11-04T10:00:00Z',
  instalments: {
    interval: 'monthly',
    items: [
      {
        seq: 1,
        due_date: '2026-12-01',
        amount: '360.35',
        effective: '360.35',
        paid: '360.35',
        open: '0.00',
        status: 'paid',
        reference: '00 00000 00002 02600 00420 10006',
      },
      {
        seq: 2,
        due_date: '2027-01-01',
        amount: '360.35',
        effective: '360.35',
        paid: '139.65',
        open: '220.70',
        status: 'part_paid',
        reference: '00 00000 00002 02600 00420 20003',
      },
      {
        seq: 3,
        due_date: '2027-02-01',
        amount: '360.30',
        effective: '360.30',
        paid: '0.00',
        open: '360.30',
        status: 'open',
        reference: '00 00000 00002 02600 00420 30000',
      },
    ],
  },
  plan: null,
  reminders_enabled: true,
}

const planDue = ['2026-10-01', '2026-11-01', '2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01']
const minusDays = (date: string, days: number) => {
  const day = new Date(`${date}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate() - days)
  return day.toISOString().slice(0, 10)
}

/** An active plan of six monthly partials, the first two issued. */
export const instalmentPlans: Plan[] = [
  {
    id: 'pln_mock_1',
    source_invoice_id: 'inv_mock_plan_source',
    client_id: 'cli_mock_2',
    count: 6,
    interval: 'monthly',
    first_due_date: planDue[0] ?? '',
    lead_days: 10,
    auto_send: true,
    reminders_enabled: true,
    status: 'active',
    items: planDue.map((due_date, i): PlanItem => ({
      seq: i + 1,
      due_date,
      issue_on: minusDays(due_date, 10),
      invoice_id: i < 2 ? `inv_mock_plan_${i + 1}` : null,
      number: i < 2 ? `2026-0${31 + i * 7}` : null,
      status: i < 2 ? 'issued' : 'scheduled',
    })),
  },
]

const anna = { id: 'usr_mock_1', name: 'Anna Muster' }

/**
 * Every month from..to with invoices and expenses that vary by month; a few months still have drafts
 * dated in them, and one bills in EUR too.
 */
export function sampleActivity(from: string, to: string): MonthActivity[] {
  const months: MonthActivity[] = []
  for (let month = from; month <= to;) {
    const n = Number(month.slice(5, 7))
    const issued = ((n * 7) % 9) + 2
    const booked = ((n * 5) % 7) + 1
    months.push({
      month,
      invoices: {
        recorded: issued,
        drafts: n % 4 === 2 ? 2 : 0,
        totals: [
          { currency: 'CHF', amount: `${issued * 1240 + n * 35}.50` },
          ...(n % 3 === 0 ? [{ currency: 'EUR', amount: `${n * 180}.00` }] : []),
        ],
      },
      expenses: {
        recorded: booked,
        drafts: n % 5 === 1 ? 1 : 0,
        totals: [{ currency: 'CHF', amount: `${booked * 312 + n * 9}.40` }],
      },
    })
    const date = new Date(`${month}-01T00:00:00Z`)
    date.setUTCMonth(date.getUTCMonth() + 1)
    month = date.toISOString().slice(0, 7)
  }
  return months
}

export const closedPeriods: Period[] = [
  { month: '2026-10', closed_at: '2026-11-03T09:15:00Z', closed_by: anna },
  { month: '2026-09', closed_at: '2026-10-02T08:40:00Z', closed_by: anna },
]

const marco = { id: 'usr_mock_2', name: 'Marco Bernasconi' }
const hex = (n: number) => n.toString(16).padStart(64, '0')

type Sample = [
  days: number,
  clock: string,
  kind: string,
  category: FinancialEvent['category'],
  subject: [type: string, id: string, number?: string, party?: string, currency?: string],
  actor: typeof anna | null,
  payload: Record<string, unknown>,
]

// Oldest first, relative to today: a week of invoicing, a closed month, and a portal switched off and on.
const samples: Sample[] = [
  [
    6,
    '09:12',
    'invoice.issued',
    'invoices',
    ['invoice', 'inv_mock_1', '2026-031', 'Muster AG', 'CHF'],
    anna,
    {
      number: '2026-031',
      kind: 'invoice',
      issue_date: '2026-11-04',
      currency: 'CHF',
      payable_total: '1200.00',
    },
  ],
  [
    6,
    '09:40',
    'expense.booked',
    'expenses',
    ['expense', 'exp_mock_14', '14', 'Papeterie SA', 'CHF'],
    marco,
    {
      number: 14,
      document_date: '2026-11-03',
      currency: 'CHF',
      total: '86.40',
      base_currency: 'CHF',
      base_total: '86.40',
      deductible_vat: '6.47',
    },
  ],
  [
    5,
    '14:05',
    'payment.added',
    'payments',
    ['invoice', 'inv_mock_1', '2026-031', 'Muster AG', 'CHF'],
    anna,
    {
      number: '2026-031',
      payment_id: 'pay_mock_1',
      amount: '1200.00',
      paid_on: '2026-11-05',
      method: 'bank_transfer',
    },
  ],
  [4, '10:30', 'period.closed', 'books', ['period', '2026-10'], anna, { month: '2026-10' }],
  [
    3,
    '08:55',
    'approval.submitted',
    'approvals',
    ['invoice', 'inv_mock_2', '2026-035', 'Beispiel GmbH', 'EUR'],
    marco,
    { request_id: 'apr_mock_1', rules: [] },
  ],
  [
    3,
    '11:20',
    'approval.approved',
    'approvals',
    ['invoice', 'inv_mock_2', '2026-035', 'Beispiel GmbH', 'EUR'],
    anna,
    { request_id: 'apr_mock_1', comment: 'Looks right.' },
  ],
  [
    3,
    '11:24',
    'invoice.issued',
    'invoices',
    ['invoice', 'inv_mock_2', '2026-035', 'Beispiel GmbH', 'EUR'],
    anna,
    {
      number: '2026-035',
      kind: 'invoice',
      issue_date: '2026-11-07',
      currency: 'EUR',
      payable_total: '640.00',
    },
  ],
  [
    2,
    '16:02',
    'credit.issued',
    'invoices',
    ['invoice', 'inv_mock_2', '2026-035', 'Beispiel GmbH', 'EUR'],
    anna,
    {
      number: '2026-035',
      credit_note_id: 'inv_mock_3',
      credit_note_number: 'CN-2026-004',
      amount: '120.00',
    },
  ],
  [
    2,
    '16:40',
    'workspace.portal_address_changed',
    'portal',
    ['workspace', 'wsp_mock'],
    anna,
    { from: 'muster', to: 'muster-ag' },
  ],
  [1, '08:47', 'workspace.portal_turned_off', 'portal', ['workspace', 'wsp_mock'], marco, {}],
  [1, '08:52', 'workspace.portal_turned_on', 'portal', ['workspace', 'wsp_mock'], marco, {}],
  [1, '08:58', 'workspace.portal_turned_off', 'portal', ['workspace', 'wsp_mock'], marco, {}],
  [1, '09:03', 'workspace.portal_turned_on', 'portal', ['workspace', 'wsp_mock'], marco, {}],
  [1, '09:09', 'workspace.portal_turned_off', 'portal', ['workspace', 'wsp_mock'], marco, {}],
  [1, '09:14', 'workspace.portal_turned_on', 'portal', ['workspace', 'wsp_mock'], marco, {}],
  [
    1,
    '13:30',
    'approvals.group_saved',
    'settings',
    ['workspace', 'wsp_mock'],
    anna,
    { group_id: 'grp_mock_1', name: 'Finance', member_ids: [] },
  ],
  [
    0,
    '07:58',
    'plan.created',
    'invoices',
    ['plan', 'pln_mock_1'],
    null,
    { source_invoice_id: 'inv_mock_1', count: 6, interval: 'monthly' },
  ],
  [
    0,
    '08:15',
    'invoice.voided',
    'invoices',
    ['invoice', 'inv_mock_4', '2026-036', 'Muster AG', 'CHF'],
    anna,
    { number: '2026-036', reason: 'Wrong client' },
  ],
  [
    0,
    '08:41',
    'refund.added',
    'payments',
    ['invoice', 'inv_mock_1', '2026-031', 'Muster AG', 'CHF'],
    anna,
    { number: '2026-031', refund_id: 'ref_mock_1', amount: '50.00' },
  ],
]

const at = (days: number, clock: string) => {
  const [hours = 0, minutes = 0] = clock.split(':').map(Number)
  const date = new Date()
  date.setDate(date.getDate() - days)
  date.setHours(hours, minutes, 0, 0)
  return date.toISOString()
}

/** One chain, oldest first; the hashes are placeholders that verify in the mock. */
export const auditEvents: FinancialEvent[] = samples.map(
  (
    [
      days,
      clock,
      kind,
      category,
      [subject_type, subject_id, number, party, currency],
      actor,
      payload,
    ],
    i,
  ) => ({
    seq: i + 1,
    kind,
    category,
    subject_type,
    subject_id,
    subject: number ? { number, party: party ?? null, currency: currency ?? null } : null,
    actor,
    at: at(days, clock),
    payload,
    prev_hash: i === 0 ? '' : hex(i),
    hash: hex(i + 1),
  }),
)

/** Every client starts with this agreement in the mock (client_id filled in on first read). */
export const sampleAgreement: Omit<SelfBillingAgreement, 'client_id'> = {
  id: 'sba_mock_1',
  starts_on: '2026-01-01',
  ends_on: null,
  accepted_at: '2025-12-15T14:00:00Z',
  accepted_by: 'Marco Bernasconi, CFO',
  note: 'Signed framework agreement, self-billing for monthly commissions.',
  first_used_at: null,
  created_at: '2025-12-15T14:05:00Z',
}
