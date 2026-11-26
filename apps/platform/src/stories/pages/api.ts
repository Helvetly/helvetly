// The fake API behind the "Pages/…" stories: a small, filled Swiss workspace in the shapes of the
// Go API (docs/*-contract.md), built on the mocks and the fixtures the unit tests use.
import { http, HttpResponse } from 'msw'

import { billingFixture } from '@/components/billing/billing-fixture'
import publicOffer from '@/components/billing/public-offer.fixture.json'
import type { Period as BooksPeriod } from '@/lib/books'
import type { DocFile, DocGroup, Folder } from '@/lib/documents'
import type { Engagement, Entry, Period } from '@/lib/engagements'
import type { Expense, ExpenseCategory, Summary as ExpenseSummary } from '@/lib/expenses'
import type { Line } from '@/lib/invoices'
import type { Invitation, Member } from '@/lib/members'
import type { Product } from '@/lib/products'
import type { Template } from '@/lib/templates'
import type { VATReturn } from '@/lib/vat-return'
import { dashboard, sampleActivity } from '@/mocks/data'
import { employeesHandlers } from '@/mocks/employees'
import { heidiHandlers } from '@/mocks/heidi'
import { notificationHandlers } from '@/mocks/notifications'
import {
  legalFormsHandler,
  nextNumbersHandler,
  listItem,
  sampleInvoice,
  sampleSettings,
  sampleSummary,
} from '@/test/invoice-api'
import { sampleClient } from '@/test/invoice-fixtures'

import { screenHandlers } from '../screen-fixtures'

export * as hr from '@/mocks/employees'

export const page = <T>(data: T[]) => ({
  data,
  meta: { page: 1, page_size: 50, total: data.length, total_pages: 1 },
})
const at = '2026-11-03T09:30:00Z'
const anna = { id: 'usr_story', name: 'Anna Muster' }

export const clients = [
  sampleClient({ tags: ['design'], files_count: 2, phone: '+41 44 123 45 67' }),
  sampleClient({
    id: 'cli_2',
    number: 2,
    name: 'Keller Holzbau AG',
    email: 'marco@keller-holzbau.ch',
    pending_change_request: true,
    street: 'Industriestrasse',
    street_number: '12',
    zip: '6005',
    city: 'Luzern',
  }),
  sampleClient({
    id: 'cli_3',
    number: 3,
    name: 'Sophie Meier',
    is_company: false,
    email: 'sophie@meier.ch',
    street: 'Rheingasse',
    street_number: '4',
    zip: '4058',
    city: 'Basel',
  }),
  sampleClient({
    id: 'cli_4',
    number: 4,
    name: 'Frei Logistik GmbH',
    email: 'jonas@frei-logistik.ch',
    street: null,
    street_number: null,
    city: 'Winterthur',
    zip: '8400',
    is_draft: true,
    missing_fields: ['street'],
  }),
]
const ref = (index: number) => {
  const { id, number, name } = clients[index] ?? sampleClient()
  return { id, number, name }
}

const line = (position: number, description: string, quantity: string, price: string): Line => ({
  id: `lin_${position}`,
  position,
  description,
  quantity,
  unit: 'hour',
  unit_price: price,
  discount_percent: '0',
  vat_category: 'S',
  vat_rate: '8.1',
  vat_exemption_code: null,
  vat_exemption_reason: null,
  amount: (Number(quantity) * Number(price)).toFixed(2),
})
export const draftInvoice = sampleInvoice({
  id: 'inv_draft',
  lines: [
    line(1, 'Brand workshop', '8', '180.00'),
    line(2, 'Logo design, three rounds', '6', '150.00'),
    line(3, 'Website copy', '4', '140.00'),
  ],
})
export const invoices = [
  draftInvoice,
  sampleInvoice({
    id: 'inv_2',
    number: '2026-044',
    status: 'open',
    client_id: 'cli_2',
    client: ref(1),
    issue_date: '2026-10-28',
    due_date: '2026-11-27',
    sent_at: '2026-10-28T10:00:00Z',
  }),
  sampleInvoice({
    id: 'inv_3',
    number: '2026-043',
    status: 'open',
    is_overdue: true,
    client_id: 'cli_3',
    client: ref(2),
    issue_date: '2026-09-20',
    due_date: '2026-10-20',
    sent_at: '2026-09-20T10:00:00Z',
  }),
  sampleInvoice({
    id: 'inv_4',
    number: '2026-042',
    status: 'paid',
    issue_date: '2026-09-02',
    due_date: '2026-10-02',
    amount_paid: '3134.90',
    amount_due: '0.00',
    sent_at: '2026-09-02T10:00:00Z',
  }),
]

export const expense = (change: Partial<Expense>): Expense => ({
  id: 'exp_1',
  number: 1,
  status: 'booked',
  source: 'manual',
  supplier_name: 'SBB CFF FFS',
  supplier_vat_number: 'CHE-102.909.703 MWST',
  supplier_country: 'CH',
  reference: null,
  duplicate_of: null,
  description: 'Zürich–Bern return',
  category: { id: 'cat_travel', name: 'Travel', account_code: '6640', preset: 'travel' },
  document_date: '2026-11-04',
  due_date: null,
  currency: 'CHF',
  amount_mode: 'gross',
  entry_mode: 'single',
  lines: [
    {
      id: 'eln_1',
      position: 1,
      description: null,
      amount: '184.60',
      vat_rate: '8.1',
      category: null,
      quantity: null,
      unit_price: null,
    },
  ],
  net_total: '170.77',
  vat_total: '13.83',
  total: '184.60',
  vat_breakdown: [
    { rate: '8.1', taxable_amount: '170.77', vat_amount: '13.83', deductible_amount: '13.83' },
  ],
  input_tax: 'full',
  deductible_percent: '100',
  deductible_vat: '13.83',
  exchange_rate: '1',
  exchange_rate_date: null,
  exchange_rate_source: null,
  base: {
    currency: 'CHF',
    net_total: '170.77',
    vat_total: '13.83',
    total: '184.60',
    deductible_vat: '13.83',
  },
  payment_status: 'paid',
  paid_on: '2026-11-04',
  payment_method: 'card',
  paid_by_member: null,
  reimbursed_on: null,
  is_overdue: false,
  note: null,
  receipt_missing_reason: null,
  receipts_count: 1,
  is_complete: true,
  missing_fields: [],
  created_by: anna,
  booked_at: at,
  booked_by: anna,
  voided_at: null,
  voided_by: null,
  void_reason: null,
  approval_state: null,
  created_at: at,
  updated_at: at,
  ...change,
})
export const expenses = [
  expense({}),
  expense({
    id: 'exp_2',
    number: 2,
    supplier_name: 'Swisscom (Schweiz) AG',
    description: 'Mobile and internet, November',
    category: { id: 'cat_tel', name: 'Telecom', account_code: '6510', preset: null },
    document_date: '2026-11-02',
    due_date: '2026-11-30',
    total: '129.00',
    payment_status: 'unpaid',
    paid_on: null,
    payment_method: null,
  }),
  expense({
    id: 'exp_3',
    number: 3,
    status: 'draft',
    supplier_name: 'Digitec Galaxus AG',
    description: 'Monitor',
    category: null,
    document_date: '2026-10-29',
    total: '449.00',
    receipts_count: 0,
    is_complete: false,
    missing_fields: ['category', 'receipt'],
    booked_at: null,
    booked_by: null,
  }),
]
const expenseSummary: ExpenseSummary = {
  currency: 'CHF',
  this_month: { amount: '762.60', count: 3 },
  last_month: { amount: '1210.40', count: 7 },
  unpaid: { amount: '129.00', count: 1 },
  overdue: { amount: '0.00', count: 0 },
  to_reimburse: { amount: '0.00', count: 0 },
  input_vat: { period: '2026-Q4', amount: '57.20' },
  incomplete: { count: 1 },
  by_category: [
    {
      category: { id: 'cat_travel', name: 'Travel', account_code: '6640', preset: 'travel' },
      amount: '184.60',
    },
    {
      category: { id: 'cat_tel', name: 'Telecom', account_code: '6510', preset: null },
      amount: '129.00',
    },
    { category: null, amount: '449.00' },
  ],
  monthly: [
    { month: '2026-10', amount: '1210.40' },
    { month: '2026-11', amount: '762.60' },
  ],
  views: { review: 1, unpaid: 1, reimburse: 0 },
}
const categories: ExpenseCategory[] = [
  {
    id: 'cat_travel',
    name: 'Travel',
    account_code: '6640',
    preset: 'travel',
    vat_treatment: 'standard',
    is_archived: false,
    expenses_count: 1,
  },
  {
    id: 'cat_tel',
    name: 'Telecom',
    account_code: '6510',
    preset: null,
    vat_treatment: null,
    is_archived: false,
    expenses_count: 1,
  },
]

const period = (change: Partial<Period> = {}): Period => ({
  id: 'epr_1',
  index: 11,
  starts_on: '2026-11-01',
  ends_on: '2026-11-30',
  quantity: '10',
  full_quantity: '10',
  unearned: '0',
  carried_in: '0',
  available: '10',
  natural_ends_on: '2026-11-30',
  unit_price: '120.00',
  overage_unit_price: '120.00',
  used: '6.5',
  remaining: '3.5',
  overage: '0',
  expected: '3',
  state: 'open',
  advance_invoice: null,
  invoiced_quantity: '0',
  uninvoiced_quantity: '6.5',
  invoices: [],
  ...change,
})
const engagement = (change: Partial<Engagement> = {}): Engagement => ({
  id: 'eng_1',
  number: 1,
  client: ref(0),
  title: 'Design retainer',
  description: 'Ongoing brand and web design, ten hours a month.',
  product_id: null,
  unit: 'hour',
  quantity: '10',
  rollover: false,
  auto_invoice: true,
  invoice_detail: 'summary',
  billing: 'arrears',
  price_basis: 'net',
  unit_price: '120.00',
  unit_price_net: '120.00',
  unit_price_gross: '129.72',
  overage_unit_price: null,
  currency: 'CHF',
  vat_category: 'S',
  vat_rate: '8.1',
  start_date: '2026-01-01',
  recurrence: 'monthly',
  interval: 1,
  end_date: null,
  reference: null,
  document_id: null,
  status: 'active',
  cancelled_on: null,
  current_period: period(),
  attention: [],
  created_at: '2026-01-01T09:00:00Z',
  updated_at: at,
  ...change,
})
export const engagements = [
  engagement(),
  engagement({
    id: 'eng_2',
    number: 2,
    client: ref(1),
    title: 'Bookkeeping support',
    description: null,
    quantity: '4',
    current_period: period({
      id: 'epr_2',
      quantity: '4',
      available: '4',
      used: '5',
      remaining: '0',
      overage: '1',
    }),
    attention: ['overage'],
  }),
  engagement({
    id: 'eng_3',
    number: 3,
    client: ref(2),
    title: 'German lessons',
    description: null,
    invoice_detail: 'per_entry',
    recurrence: 'none',
    quantity: '20',
    current_period: period({
      id: 'epr_3',
      starts_on: '2026-09-01',
      ends_on: '2026-12-31',
      quantity: '20',
      available: '20',
      used: '4',
      remaining: '16',
      expected: '12',
    }),
    attention: ['under_pace'],
  }),
]
const entries: Entry[] = [
  ['ent_1', '2026-11-03', '2.5', 'Homepage layout, second round'],
  ['ent_2', '2026-11-05', '3', 'Brand guidelines'],
  ['ent_3', '2026-11-07', '1', 'Call with Lena about the launch'],
].map(([id = '', date = '', quantity = '', note = '']) => ({
  id,
  period_id: 'epr_1',
  date,
  quantity,
  note,
  client_performance: null,
  client_performance_on_invoice: false,
  performed_by: anna,
  invoice: null,
  created_at: `${date}T16:00:00Z`,
  created_by: anna,
}))

const folder = (
  id: string,
  name: string,
  files: number,
  system_kind: Folder['system_kind'] = null,
  parent_id: string | null = null,
): Folder => ({
  id,
  name,
  system_kind,
  parent_id,
  file_count: files,
  size: files * 240_000,
  total_files: files,
  total_size: files * 240_000,
  starred: id === 'fld_contracts',
  created_by: anna,
  created_at: at,
  updated_at: at,
})
export const folders = [
  folder('fld_contracts', 'Contracts', 3),
  folder('fld_receipts', 'Receipts 2026', 12),
  folder('fld_tax', 'Tax', 4),
  // The folders Helvetly manages: Clients / Acme AG / Invoices / 2025, Expenses / 2025 and Bank Statements.
  folder('fld_sys_clients', 'Clients', 2, 'clients'),
  folder('fld_sys_acme', 'Acme AG', 2, 'client', 'fld_sys_clients'),
  folder('fld_sys_acme_invoices', 'Invoices', 2, 'invoices', 'fld_sys_acme'),
  folder('fld_sys_acme_invoices_2025', '2025', 2, 'year', 'fld_sys_acme_invoices'),
  folder('fld_sys_expenses', 'Expenses', 5, 'expenses'),
  folder('fld_sys_expenses_2025', '2025', 5, 'year', 'fld_sys_expenses'),
  folder('fld_sys_bank', 'Bank Statements', 0, 'bank_statements'),
]
export const file = (id: string, name: string, kind: DocFile['kind'], type: string): DocFile => ({
  id,
  name,
  folder_id: null,
  folder: null,
  size: 184_320,
  content_type: type,
  kind,
  sha256: null,
  tags: [],
  ai_filing: null,
  previewable: false,
  links: [],
  retained_until: null,
  uploaded_by: anna,
  created_at: at,
  updated_at: at,
  deleted_at: null,
  deleted_by: null,
  purge_at: null,
})
/** The groups of the Documents' grouped views, by what they group by. */
export const documentGroups: Record<string, DocGroup[]> = {
  type: [
    { key: 'invoices', label: '', count: 12, size: 2_400_000 },
    { key: 'quotes', label: '', count: 4, size: 610_000 },
    { key: 'receipts', label: '', count: 6, size: 1_500_000 },
    { key: 'contracts', label: '', count: 2, size: 380_000 },
    { key: 'other', label: '', count: 3, size: 640_000 },
  ],
  year: [
    { key: '2026', label: '', count: 15, size: 3_100_000 },
    { key: '2025', label: '', count: 8, size: 2_420_000 },
  ],
  client: [
    { key: 'cli_acme', label: 'Acme AG', count: 9, size: 1_900_000 },
    { key: 'cli_bern', label: 'Bern Bau GmbH', count: 6, size: 1_200_000 },
    { key: 'none', label: '', count: 8, size: 2_420_000 },
  ],
}

export const files = [
  file('doc_1', 'Mandate agreement Alpenglow.pdf', 'pdf', 'application/pdf'),
  file('doc_2', 'Office lease 2026.pdf', 'pdf', 'application/pdf'),
  file('doc_3', 'Budget 2027.xlsx', 'spreadsheet', 'application/vnd.ms-excel'),
  file('doc_4', 'Team photo.jpg', 'image', 'image/jpeg'),
]
export const templates: Template[] = [
  {
    id: 'tpl_1',
    name: 'Mandate agreement',
    description: 'Our standard engagement letter, signed by the client.',
    document: { id: 'doc_1', name: 'Mandate agreement Alpenglow.pdf' },
    signers: [{ label: 'Client', fill: 'client' }],
    fields: [],
    used_count: 12,
    last_used_at: at,
    created_at: at,
    updated_at: at,
  },
  {
    id: 'tpl_2',
    name: 'Power of attorney',
    description: null,
    document: { id: 'doc_2', name: 'Power of attorney.pdf' },
    signers: [],
    fields: [],
    used_count: 0,
    last_used_at: null,
    created_at: at,
    updated_at: at,
  },
]

const member = (change: Partial<Member>): Member => ({
  user_id: 'usr_story',
  name: 'Anna Muster',
  email: 'anna@example.com',
  avatar_url: null,
  role: 'owner',
  scopes: ['*:*'],
  joined_at: '2026-01-01T00:00:00Z',
  last_active_at: at,
  is_you: true,
  ...change,
})
export const members = [
  member({}),
  member({
    user_id: 'usr_2',
    name: 'Luca Rossi',
    email: 'luca@muster.ch',
    role: 'admin',
    is_you: false,
  }),
  member({
    user_id: 'usr_3',
    name: 'Mia Keller',
    email: 'mia@muster.ch',
    role: 'member',
    scopes: ['read:*', 'write:expenses'],
    is_you: false,
    last_active_at: null,
  }),
]
const invitations: Invitation[] = [
  {
    id: 'inv_member',
    email: 'jonas@muster.ch',
    role: 'member',
    scopes: ['read:*'],
    invited_by: 'Anna Muster',
    created_at: at,
    expires_at: '2026-11-17T09:30:00Z',
  },
]

const product = (change: Partial<Product>): Product => ({
  id: 'prd_1',
  type: 'service',
  name: 'Design hour',
  description: 'Brand, web and print design',
  sku: 'DES-H',
  gtin: null,
  unit: 'hour',
  price_basis: 'net',
  unit_price: '150.00',
  unit_price_net: '150.00',
  unit_price_gross: '162.15',
  currency: 'CHF',
  vat_category: 'S',
  vat_rate: '8.1',
  is_archived: false,
  archived_at: null,
  created_at: at,
  updated_at: at,
  ...change,
})
export const products = [
  product({}),
  product({
    id: 'prd_2',
    name: 'Workshop day',
    description: 'On site, up to eight people',
    sku: 'WS-D',
    unit: 'day',
    unit_price: '1400.00',
    unit_price_net: '1400.00',
    unit_price_gross: '1513.40',
  }),
  product({
    id: 'prd_3',
    type: 'product',
    name: 'Printed brand book',
    description: null,
    sku: 'BB-01',
    unit: 'piece',
    unit_price: '85.00',
    unit_price_net: '85.00',
    unit_price_gross: '91.90',
  }),
]

const one =
  <T extends { id: string }>(list: T[]) =>
  ({ params }: { params: Record<string, string | readonly string[] | undefined> }) => {
    const found = list.find((entry) => entry.id === params.id)
    return found
      ? HttpResponse.json({ data: found })
      : HttpResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 })
  }

/** What every signed-in screen asks for, then each area's records; the first match wins. */
export const shellHandlers = [
  http.get('/api/v1/auth/config', () =>
    HttpResponse.json({
      google: true,
      email: true,
      passkey: true,
      dev_codes: false,
      ai_available: true,
    }),
  ),
  http.get('/api/v1/public/offers/current', () => HttpResponse.json({ data: publicOffer })),
  http.get('/api/v1/billing', () =>
    HttpResponse.json({
      data: billingFixture({
        plan: 'pro',
        status: 'active',
        interval: 'month',
        pricing: 'per_seat',
        locked: false,
        has_customer: true,
        current_period_end: '2026-12-01',
      }),
    }),
  ),
  http.get('/api/v1/session/workspaces', () =>
    HttpResponse.json({
      data: [{ id: 'wrk_story', name: 'Muster AG', role: 'owner', current: true }],
    }),
  ),
  http.get('/api/v1/clients/tags', () =>
    HttpResponse.json({ data: [{ name: 'design', count: 1 }] }),
  ),
  http.get('/api/v1/clients/:id/change-request', () => HttpResponse.json({ data: null })),
  http.get('/api/v1/clients/:id/self-billing-agreements', () => HttpResponse.json({ data: [] })),
  http.get('/api/v1/clients/:id', one(clients)),
  // Status as the Go API reads it: each value narrows the list (docs/clients-contract.md).
  http.get('/api/v1/clients', ({ request }) => {
    const query = new URL(request.url).searchParams
    const status = query.getAll('status')
    const type = query.get('type')
    const city = query.get('city')?.toLowerCase()
    const match = clients.filter(
      (client) =>
        (!status.includes('active') || client.is_active) &&
        (!status.includes('inactive') || !client.is_active) &&
        (!status.includes('draft') || client.is_draft) &&
        (!status.includes('complete') || !client.is_draft) &&
        (!type || client.is_company === (type === 'company')) &&
        (!city || Boolean(client.city?.toLowerCase().includes(city))),
    )
    return HttpResponse.json(page(match))
  }),
  http.get('/api/v1/invoice-settings', () => HttpResponse.json({ data: sampleSettings() })),
  legalFormsHandler,
  nextNumbersHandler,
  http.get('/api/v1/invoices/summary', ({ request }) => {
    const { currency, outstanding, overdue } = sampleSummary
    const open_balances = new URL(request.url).searchParams.has('client_id')
      ? [{ currency, outstanding, overdue }]
      : undefined
    return HttpResponse.json({ data: { ...sampleSummary, open_balances } })
  }),
  // The draft's lines add up to the canned 2'900.00 net, so the server's totals match them.
  http.post('/api/v1/invoices/preview', () => HttpResponse.json({ data: draftInvoice })),
  http.get('/api/v1/invoices/:id', one(invoices)),
  http.get('/api/v1/invoices', ({ request }) => {
    const rows = invoices.map(listItem)
    const attention = new URL(request.url).searchParams.get('sort') === 'next_due_date'
    return HttpResponse.json(page(attention ? rows.filter((row) => row.status === 'open') : rows))
  }),
  http.get('/api/v1/expenses/summary', () => HttpResponse.json({ data: expenseSummary })),
  http.get('/api/v1/expenses/:id/receipts', () => HttpResponse.json({ data: [] })),
  http.get('/api/v1/expenses/:id', one(expenses)),
  http.get('/api/v1/expenses', () => HttpResponse.json(page(expenses))),
  http.get('/api/v1/expense-categories', () => HttpResponse.json({ data: categories })),
  http.get('/api/v1/engagements/summary', () =>
    HttpResponse.json({
      data: { active: 3, ending_soon: 0, under_pace: 1, overage: 1, to_invoice: 1 },
    }),
  ),
  http.get('/api/v1/engagements/:id/periods', () =>
    HttpResponse.json({ data: [engagements[0]?.current_period] }),
  ),
  http.get('/api/v1/engagements/:id/entries', () => HttpResponse.json({ data: entries })),
  http.get('/api/v1/engagements/:id', one(engagements)),
  http.get('/api/v1/engagements', () => HttpResponse.json(page(engagements))),
  http.get('/api/v1/documents/folders', () => HttpResponse.json({ data: folders })),
  http.get('/api/v1/documents/usage', () =>
    HttpResponse.json({
      data: {
        files: 23,
        size: 5_520_000,
        by_kind: [
          { kind: 'pdf', files: 15, size: 3_600_000 },
          { kind: 'image', files: 6, size: 1_500_000 },
          { kind: 'spreadsheet', files: 2, size: 420_000 },
        ],
        trash: { files: 0, size: 0 },
      },
    }),
  ),
  http.get('/api/v1/documents/groups/zip', () => new HttpResponse(null, { status: 204 })),
  http.get('/api/v1/documents/exports', () => HttpResponse.json({ data: [] })),
  http.get('/api/v1/documents/groups', ({ request }) => {
    const query = new URL(request.url).searchParams
    const by = (query.get('group') ?? '').split(',').find((dim) => !query.get(dim))
    return by
      ? HttpResponse.json({ data: { by, groups: documentGroups[by] ?? [] } })
      : HttpResponse.json(page(files))
  }),
  http.get('/api/v1/documents/:id/content', () => new HttpResponse(null, { status: 204 })),
  http.get('/api/v1/documents', () => HttpResponse.json(page(files))),
  http.get('/api/v1/documents/:id', one(files)),
  http.get('/api/v1/templates', () => HttpResponse.json({ data: templates })),
  http.get('/api/v1/members/invitations', () => HttpResponse.json({ data: invitations })),
  http.get('/api/v1/members', () => HttpResponse.json({ data: members })),
  http.get('/api/v1/products/:id', one(products)),
  http.get('/api/v1/products', () => HttpResponse.json(page(products))),
  http.get('/api/v1/reports/key-figures', () => HttpResponse.json(dashboard)),
  ...employeesHandlers,
  ...notificationHandlers,
  ...heidiHandlers,
  ...screenHandlers,
]

/** A monthly VAT return ("2026-10"), so the filing window of the latest one is open whatever the date. */
const monthlyReturn = (name: string): VATReturn => {
  const [year = 0, month = 1] = name.split('-').map(Number)
  return {
    period: name,
    from: `${name}-01`,
    to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
    method: 'effective',
    basis: 'agreed',
    currency: 'CHF',
    months: 1,
    closed_months: 0,
    net_rates: [],
    lines: [],
    warnings: [],
  }
}

/** The books behind the dashboard's to-do list: a VAT return to file and the closed months given. */
export const attentionHandlers = (closed: BooksPeriod[] = []) => [
  http.get('/api/v1/vat-return/settings', () =>
    HttpResponse.json({
      data: { method: 'effective', period: 'monthly', basis: 'agreed', net_rates: [] },
    }),
  ),
  http.get('/api/v1/vat-return', ({ request }) =>
    HttpResponse.json({
      data: monthlyReturn(new URL(request.url).searchParams.get('period') ?? ''),
    }),
  ),
  http.get('/api/v1/periods', () => HttpResponse.json({ data: closed })),
  http.get('/api/v1/periods/activity', ({ request }) => {
    const query = new URL(request.url).searchParams
    return HttpResponse.json({
      data: sampleActivity(query.get('from') ?? '', query.get('to') ?? ''),
    })
  }),
]
