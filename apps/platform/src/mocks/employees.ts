// Employees and payroll in the shapes of the Go API (apps/api/internal/employees): fixtures for Vitest and the
// "Pages/…" stories. Test fixtures only; Go serves every route.
import { http, HttpResponse } from 'msw'

import type {
  Country,
  Employee,
  EmployeeDocument,
  EmploymentSettings,
  HistoryEvent,
  PayTerms,
  Resolution,
  RetentionItem,
} from '@/lib/employees'
import type { BookingPreview, PayrollBooking, PayrollEntry, PayrollTotals } from '@/lib/payroll'

const at = '2026-11-03T09:30:00Z'

export const employee = (change: Partial<Employee> = {}): Employee => ({
  id: 'emp_1',
  member_user_id: null,
  member_name: null,
  member_active: false,
  employee_number: 'E-001',
  first_name: 'Lara',
  last_name: 'Brunner',
  email: 'lara.brunner@example.com',
  phone: '+41445550101',
  street: 'Seefeldstrasse',
  street_number: '12',
  apt: null,
  postal_code: '8008',
  city: 'Zürich',
  address_country: 'CH',
  position: 'Senior designer',
  department: 'Studio',
  employment_type: 'permanent',
  working_time: '100',
  employment_start: '2024-03-01',
  employment_end: null,
  employing_entity: 'Muster AG',
  employer_country: 'CH',
  social_security_country: 'CH',
  work_country: 'CH',
  work_region: 'ZH',
  work_locality: null,
  place_of_work: 'Zürich office',
  residence_country: 'CH',
  cross_border: false,
  cross_border_note: null,
  bank_account_hint: '3012',
  tax_id_hint: null,
  social_security_number_hint: '0097',
  weekly_hours: '42',
  notice_period: '3 months to the end of a month',
  thirteenth_salary: true,
  withholding_tax: false,
  withholding_tax_canton: null,
  pension_insurer: 'Pensionskasse Muster',
  accident_insurer: 'Suva',
  sickness_insurer: null,
  free_transport: false,
  canteen_meals: true,
  legal_hold: false,
  legal_hold_reason: null,
  restricted: false,
  status: 'active',
  erased_at: null,
  archived_at: null,
  created_at: at,
  updated_at: at,
  ...change,
})

export const employees: Employee[] = [
  employee({ member_user_id: 'usr_2', member_name: 'Luca Rossi', member_active: true }),
  employee({
    id: 'emp_2',
    employee_number: 'E-002',
    first_name: 'Noah',
    last_name: 'Weber',
    email: 'noah.weber@example.com',
    position: 'Project manager',
    department: 'Operations',
    work_country: 'DE',
    work_region: null,
    residence_country: 'DE',
    cross_border: true,
    cross_border_note: 'Lives in Konstanz, works two days a week in Zürich.',
    bank_account_hint: null,
  }),
  employee({
    id: 'emp_3',
    employee_number: 'E-003',
    first_name: 'Elena',
    last_name: 'Rossi',
    email: null,
    position: 'Studio assistant',
    employment_type: 'fixed_term',
    working_time: '60',
    employment_start: '2026-02-01',
    employment_end: '2027-01-31',
    bank_account_hint: null,
  }),
]

export const departments = ['Operations', 'Studio']

export const resolution: Resolution = {
  jurisdiction: 'CH-ZH',
  country_name: 'Switzerland',
  group: 'ch',
  status: 'register_only',
  mode: 'register',
  reasons: [
    'Switzerland, canton Zurich: retention guidance is available.',
    'No calculation rule is verified, so pay is recorded as you enter it.',
  ],
  blocked: [
    { feature: 'payroll_calculation', reason: 'Gross-to-net calculation is not offered.' },
    { feature: 'tax_filing', reason: 'Withholding tax filings are made outside Helvetly.' },
  ],
  applicable: ['CH', 'CH-ZH'],
}

export const payTerms: PayTerms[] = [
  {
    id: 'pt_2',
    employee_id: 'emp_1',
    effective_from: '2026-01-01',
    basis: 'monthly',
    amount: '6000.00',
    currency: 'CHF',
    frequency: 'monthly',
    note: 'Annual review',
    current: true,
    created_by: 'Anna Muster',
    created_at: at,
  },
  {
    id: 'pt_1',
    employee_id: 'emp_1',
    effective_from: '2024-03-01',
    basis: 'monthly',
    amount: '5600.00',
    currency: 'CHF',
    frequency: 'monthly',
    note: null,
    current: false,
    created_by: 'Anna Muster',
    created_at: at,
  },
]

const rule = {
  id: 'ch-co-958f-payroll',
  jurisdiction: 'CH',
  topic: 'retention',
  summary: 'Keep payroll records for 10 years after the end of the financial year.',
  years: 10,
  source: 'Swiss Code of Obligations, art. 958f',
  source_url: 'https://www.fedlex.admin.ch/eli/cc/27/317_321_377/en#art_958_f',
  checked_at: '2026-10-01',
  status: 'verified',
}

export const documents: EmployeeDocument[] = [
  {
    id: 'doc_1',
    name: 'Employment contract.pdf',
    size: 182_000,
    content_type: 'application/pdf',
    type: 'employment_contract',
    document_date: '2024-02-15',
    retain_until: null,
    retention_rule: null,
    legal_hold: false,
    uploaded_by: 'Anna Muster',
    created_at: at,
    retention_guidance: [
      {
        ...rule,
        id: 'ch-or-contract',
        summary: 'Keep for 10 years after the employment ends.',
        guidance: 'The date is set once the employment has an end date.',
      },
    ],
    retention_due: false,
  },
  {
    id: 'doc_2',
    name: 'Payslip October 2026.pdf',
    size: 64_000,
    content_type: 'application/pdf',
    type: 'payslip',
    document_date: '2026-10-25',
    retain_until: '2036-12-31',
    retention_rule: 'ch-co-958f-payroll',
    legal_hold: true,
    uploaded_by: 'Anna Muster',
    created_at: at,
    retention_guidance: [rule],
    retention_due: false,
  },
]

export const history: HistoryEvent[] = [
  {
    kind: 'employee.created',
    subject_type: 'employee',
    subject_id: 'emp_1',
    actor: 'Anna Muster',
    at: '2024-02-20T08:00:00Z',
  },
  {
    kind: 'employee.pay_terms_added',
    subject_type: 'employee',
    subject_id: 'emp_1',
    actor: 'Anna Muster',
    at: '2025-12-15T08:00:00Z',
  },
  {
    kind: 'payroll.approved',
    subject_type: 'payroll_entry',
    subject_id: 'pay_0',
    actor: 'Anna Muster',
    at,
  },
]

export const countries: Country[] = [
  {
    code: 'CH',
    name: 'Switzerland',
    group: 'ch',
    region_label: 'Canton',
    regions: [
      { code: 'BE', name: 'Bern' },
      { code: 'GE', name: 'Geneva' },
      { code: 'LU', name: 'Lucerne' },
      { code: 'ZH', name: 'Zurich' },
    ],
    locality: false,
    research_status: 'researched',
  },
  {
    code: 'DE',
    name: 'Germany',
    group: 'eu',
    locality: false,
    research_status: 'partially_researched',
  },
  { code: 'AT', name: 'Austria', group: 'eu', locality: false, research_status: 'not_researched' },
  {
    code: 'US',
    name: 'United States',
    group: 'us',
    region_label: 'State',
    regions: [
      { code: 'CA', name: 'California' },
      { code: 'NY', name: 'New York' },
    ],
    locality: true,
    research_status: 'partially_researched',
  },
]

export const employmentSettings: EmploymentSettings = {
  employing_entity: 'Muster AG',
  country: 'CH',
  region: 'ZH',
  require_second_approver: false,
  payroll_approvers: 2,
  updated_at: at,
}

export const entry = (change: Partial<PayrollEntry> = {}): PayrollEntry => ({
  id: 'pay_1',
  employee_id: 'emp_1',
  employee_name: 'Lara Brunner',
  employee_number: 'E-001',
  employing_entity: 'Muster AG',
  period_start: '2026-11-01',
  period_end: '2026-11-30',
  pay_date: '2026-11-25',
  currency: 'CHF',
  gross: '6000.00',
  deductions: '900.00',
  net: '5100.00',
  employer_costs: '780.00',
  total_cost: '6780.00',
  complete: true,
  components: [
    { kind: 'earning', label: 'Salary', amount: '6000.00' },
    { kind: 'deduction', label: 'AHV/IV/EO', amount: '900.00' },
  ],
  source: 'manual',
  source_ref: null,
  status: 'draft',
  payment_status: 'unpaid',
  paid_on: null,
  approved_by: null,
  approved_at: null,
  supersedes_id: null,
  superseded_by: null,
  booked: [],
  version: 1,
  note: null,
  created_by: 'Anna Muster',
  created_by_id: 'usr_story',
  updated_by_id: null,
  approved_by_id: null,
  created_at: at,
  updated_at: at,
  ...change,
})

export const entries: PayrollEntry[] = [
  entry({ supersedes_id: 'pay_0' }),
  entry({
    id: 'pay_2',
    employee_id: 'emp_2',
    employee_name: 'Noah Weber',
    employee_number: 'E-002',
    currency: 'EUR',
    gross: '5200.00',
    deductions: null,
    net: null,
    employer_costs: null,
    total_cost: null,
    complete: false,
    components: [],
    source: 'import',
    source_ref: 'DATEV-2026-11',
    status: 'approved',
    approved_by: 'Anna Muster',
    approved_at: at,
    version: 2,
  }),
  entry({
    id: 'pay_3',
    employee_id: 'emp_3',
    employee_name: 'Elena Rossi',
    employee_number: 'E-003',
    gross: '3000.00',
    deductions: '450.00',
    net: '2550.00',
    employer_costs: '390.00',
    total_cost: '3390.00',
    components: [],
    status: 'approved',
    payment_status: 'paid',
    paid_on: '2026-11-25',
    approved_by: 'Anna Muster',
    approved_at: at,
    booked: ['accrual'],
    version: 3,
  }),
]

/** The approved entry pay_1 corrects: shown only with "Show corrected entries". */
export const supersededEntry = entry({
  id: 'pay_0',
  gross: '5800.00',
  deductions: '870.00',
  net: '4930.00',
  employer_costs: '754.00',
  total_cost: '6554.00',
  components: [],
  status: 'approved',
  approved_by: 'Anna Muster',
  approved_at: at,
  superseded_by: 'pay_1',
  version: 2,
})

export const totals: PayrollTotals[] = [
  {
    currency: 'CHF',
    entries: 2,
    drafts: 1,
    approved: 1,
    paid: 1,
    gross: '9000.00',
    deductions: '1350.00',
    net: '7650.00',
    employer_costs: '1170.00',
    total_cost: '10170.00',
    missing_gross: 0,
    missing_deductions: 0,
    missing_net: 0,
    missing_employer_costs: 0,
    net_paid: '2550.00',
  },
  {
    currency: 'EUR',
    entries: 1,
    drafts: 0,
    approved: 1,
    paid: 0,
    gross: '5200.00',
    deductions: '0.00',
    net: '0.00',
    employer_costs: '0.00',
    total_cost: '0.00',
    missing_gross: 0,
    missing_deductions: 1,
    missing_net: 1,
    missing_employer_costs: 1,
    net_paid: '0.00',
  },
]

export const bookingPreview: BookingPreview = {
  up_to: '2026-11-30',
  base_currency: 'CHF',
  items: [
    { entry: entries[2] ?? entry(), kind: 'payment', date: '2026-11-25', blocked: '' },
    {
      entry: entries[1] ?? entry(),
      kind: 'accrual',
      date: '2026-11-30',
      blocked:
        'Some figures are missing: gross, deductions, net pay and employer costs are all needed to book it.',
    },
  ],
}

export const bookings: PayrollBooking[] = [
  {
    id: 'pb_1',
    up_to: '2026-10-31',
    base_currency: 'CHF',
    items: 4,
    created_by: 'Anna Muster',
    created_at: '2026-11-02T10:00:00Z',
  },
]

const one = <T extends { id: string }>(list: T[], id: unknown) => {
  const found = list.find((item) => item.id === id)
  return found
    ? HttpResponse.json({ data: found })
    : HttpResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 })
}

/** Lara left; erasing her would delete one payslip past its date. Elena's record is under a legal hold. */
export const retention: RetentionItem[] = [
  {
    employee_id: 'emp_1',
    name: 'Lara Brunner',
    employment_end: '2015-06-30',
    blocked_by: null,
    documents_due: [
      {
        id: 'doc_old',
        name: 'Payslip June 2015.pdf',
        size: 61_000,
        content_type: 'application/pdf',
        type: 'payslip',
        document_date: '2015-06-25',
        retain_until: '2025-12-31',
        retention_rule: 'ch-co-958f-payroll',
        legal_hold: false,
        uploaded_by: 'Anna Muster',
        created_at: at,
      },
    ],
    documents_kept: 1,
    next_due: '2034-06-30',
  },
  {
    employee_id: 'emp_3',
    name: 'Elena Rossi',
    employment_end: '2025-01-31',
    blocked_by: 'legal_hold',
    documents_due: [],
    documents_kept: 2,
    next_due: null,
  },
]

/** Reads answer from the fixtures; writes echo what was sent on top of them. */
export const employeesHandlers = [
  http.get('/api/v1/employment/jurisdictions', () =>
    HttpResponse.json({ data: { countries, rules: [] } }),
  ),
  http.get('/api/v1/employment/settings', () => HttpResponse.json({ data: employmentSettings })),
  http.get('/api/v1/employment/retention', () => HttpResponse.json({ data: retention })),
  http.put<never, Partial<EmploymentSettings>>('/api/v1/employment/settings', async ({ request }) =>
    HttpResponse.json({ data: { ...employmentSettings, ...(await request.json()) } }),
  ),
  http.get('/api/v1/employees/:id/jurisdiction', () => HttpResponse.json({ data: resolution })),
  http.get('/api/v1/employees/:id/history', () => HttpResponse.json({ data: history })),
  http.get('/api/v1/employees/:id/pay-terms', () => HttpResponse.json({ data: payTerms })),
  http.get('/api/v1/employees/:id/documents', () => HttpResponse.json({ data: documents })),
  http.get('/api/v1/employees/:id/protected', () =>
    HttpResponse.json({
      data: {
        bank_account: 'CH9300762011623853012',
        tax_id: null,
        social_security_number: '756.1234.5678.97',
      },
    }),
  ),
  http.get('/api/v1/employees/:id', ({ params }) => one(employees, params.id)),
  http.get('/api/v1/employees', () =>
    HttpResponse.json({
      data: employees,
      departments,
      meta: { page: 1, page_size: 200, total: employees.length, total_pages: 1 },
    }),
  ),
  http.post<never, Partial<Employee>>('/api/v1/employees', async ({ request }) =>
    HttpResponse.json(
      { data: employee({ id: 'emp_new', ...(await request.json()) }) },
      { status: 201 },
    ),
  ),
  http.patch<{ id: string }, Partial<Employee>>(
    '/api/v1/employees/:id',
    async ({ params, request }) =>
      HttpResponse.json({
        data: {
          ...(employees.find((item) => item.id === params.id) ?? employee()),
          ...(await request.json()),
        },
      }),
  ),
  http.get('/api/v1/payroll/summary', () =>
    HttpResponse.json({ data: { month: '2026-11', currencies: totals } }),
  ),
  http.get('/api/v1/payroll/entries/:id', ({ params }) =>
    one([...entries, supersededEntry], params.id),
  ),
  http.get('/api/v1/payroll/entries', ({ request }) =>
    HttpResponse.json({
      data:
        new URL(request.url).searchParams.get('superseded') === 'true'
          ? [supersededEntry, ...entries]
          : entries,
    }),
  ),
  http.get('/api/v1/payroll/bookings/preview', () => HttpResponse.json({ data: bookingPreview })),
  http.get('/api/v1/payroll/bookings', () => HttpResponse.json({ data: bookings })),
]
