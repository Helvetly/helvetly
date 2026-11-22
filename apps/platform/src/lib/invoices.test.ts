import { setupServer } from 'msw/node'

import { handlers } from '@/mocks/handlers'
import { sampleSettings } from '@/test/invoice-api'

import { ApiError } from './api'
import {
  defaultExemptionCode,
  einvoiceUrl,
  EINVOICE_FORMATS,
  needsRonRate,
  einvoiceFormatsFor,
  formatRange,
  INTERVALS,
  invoicesApi,
  VATEX_CODES,
  addDays,
  apiQuery,
  cannotIssueReasons,
  DEFAULT_PARAMS,
  displayStatus,
  dueLabel,
  exampleNumber,
  nextNumberOf,
  numberFormatError,
  numberFormatsFor,
  formatAmount,
  formatMoney,
  formatWholeAmount,
  fromCents,
  ibanInfo,
  isZero,
  listParamsToQuery,
  parseDecimalInput,
  parseListParams,
  INVOICE_KINDS,
  isNegativeKind,
  isReceivable,
  kindInfo,
  defaultPaymentMethods,
  qrBillBlocker,
  refundAfterCredit,
  revolutUsername,
  settingsFrom,
  toCents,
  usableMethods,
  repeatsAmount,
} from './invoices'

test('reads the list state from the URL and ignores what it does not know', () => {
  expect(
    parseListParams(
      new URLSearchParams(
        'page=2&q=keller&status=overdue&status=bogus&status=overdue&kind=invoice&client=cli_1&from=2026-10-01&to=nope&sort=-total&id=inv_9',
      ),
    ),
  ).toEqual({
    page: 2,
    search: 'keller',
    status: ['overdue'],
    kind: 'invoice',
    client: 'cli_1',
    credited: null,
    from: '2026-10-01',
    to: null,
    sort: 'total',
    desc: true,
  })
  expect(parseListParams(new URLSearchParams('page=0&sort=amount&kind=quote'))).toEqual(
    DEFAULT_PARAMS,
  )
  expect(parseListParams(new URLSearchParams('')).kind).toBe('invoice')
})

test('round trips every kind through the URL', () => {
  for (const { kind } of INVOICE_KINDS) {
    const params = { ...DEFAULT_PARAMS, kind }
    expect(parseListParams(listParamsToQuery(params))).toEqual(params)
    expect(apiQuery(params).get('kind')).toBe(kind)
  }
  expect(INVOICE_KINDS.map((k) => k.kind)).toHaveLength(8)
})

test('knows which kinds are receivable', () => {
  expect(INVOICE_KINDS.map((k) => [k.kind, isReceivable(k.kind)])).toEqual([
    ['invoice', true],
    ['partial', true],
    ['prepayment', true],
    ['debit_note', true],
    ['corrected', true],
    ['credit_note', false],
    ['proforma', false],
    ['self_billed', false],
  ])
  expect(kindInfo('prepayment').code).toBe('386')
  expect(isNegativeKind('credit_note')).toBe(true)
  expect(isNegativeKind('debit_note')).toBe(false)
})

test('writes only what differs from the defaults and keeps other keys', () => {
  const query = listParamsToQuery(
    { ...DEFAULT_PARAMS, status: ['open'], kind: 'proforma', sort: 'due_date', desc: false },
    new URLSearchParams('id=inv_3&page=4'),
  )
  expect(query.toString()).toBe('id=inv_3&status=open&kind=proforma&sort=due_date')
  expect(listParamsToQuery(DEFAULT_PARAMS).toString()).toBe('')
})

test('speaks the API’s query names', () => {
  const params = {
    ...DEFAULT_PARAMS,
    search: ' 2026 ',
    client: 'cli_1',
    from: '2026-01-01',
    to: '2026-03-31',
  }
  expect(apiQuery(params).toString()).toBe(
    'page=1&page_size=50&search=2026&kind=invoice&client_id=cli_1&issued_from=2026-01-01&issued_to=2026-03-31&sort=-issue_date',
  )
  expect(apiQuery(params, false).has('page')).toBe(false)
})

test.each([
  ['1450', 2, true, '1450.00'],
  ["3'200", 2, true, '3200.00'],
  ['1’234,5', 2, true, '1234.50'],
  ['1,234.56', 2, true, '1234.56'],
  ['12,5', 3, false, '12.5'],
  ['007', 3, false, '7'],
  ['.5', 3, false, '0.5'],
  ['2.500', 3, false, '2.5'],
  ['1.234', 2, true, null],
  ['abc', 2, true, null],
  ['', 2, true, null],
])('parses typed %j at scale %i', (typed, scale, pad, expected) => {
  expect(parseDecimalInput(typed, scale, pad)).toBe(expected)
})

test('formats decimal strings without turning them into floats', () => {
  expect(formatAmount('1234567.5')).toBe('1’234’567.50')
  expect(formatAmount('-0.05')).toBe('−0.05')
  expect(formatMoney('4850.00', 'CHF')).toBe('CHF 4’850.00')
  expect(formatMoney('-12.30', 'EUR')).toBe('−EUR 12.30')
  expect(formatWholeAmount('19604.50')).toBe('19’605')
  expect(fromCents(toCents('-1.5'))).toBe('-1.50')
  expect(isZero('0.00')).toBe(true)
  expect(() => toCents('1.234')).toThrow('Not a money amount')
})

test('tells QR-IBANs, Swiss and foreign IBANs apart and checks their digits', () => {
  expect(ibanInfo('CH44 3199 9123 0008 8901 2')).toMatchObject({
    valid: true,
    qr: true,
    swiss: true,
  })
  expect(ibanInfo('ch9300762011623852957')).toEqual({
    valid: true,
    formatted: 'CH93 0076 2011 6238 5295 7',
    country: 'CH',
    swiss: true,
    qr: false,
  })
  expect(ibanInfo('DE89 3704 0044 0532 0130 00')).toMatchObject({
    valid: true,
    swiss: false,
    qr: false,
  })
  expect(ibanInfo('CH93 0076 2011 6238 5295 8')).toEqual({ valid: false })
})

test('derives what the list shows from kind, status and due date', () => {
  const paid = '0.00'
  expect(
    displayStatus({ kind: 'invoice', status: 'open', is_overdue: true, amount_paid: paid }),
  ).toBe('overdue')
  expect(
    displayStatus({ kind: 'invoice', status: 'open', is_overdue: false, amount_paid: paid }),
  ).toBe('open')
  expect(
    displayStatus({ kind: 'credit_note', status: 'paid', is_overdue: false, amount_paid: paid }),
  ).toBe('credit_applied')
  // Fully credited: void, which reads "Credited" when it was paid first (and then refunded).
  expect(
    displayStatus({ kind: 'partial', status: 'void', is_overdue: false, amount_paid: paid }),
  ).toBe('void')
  expect(
    displayStatus({ kind: 'partial', status: 'void', is_overdue: false, amount_paid: '400.00' }),
  ).toBe('credited')
  expect(dueLabel('2026-11-10', '2026-11-05')).toBe('Due in 5 days')
  expect(dueLabel('2026-11-04', '2026-11-05')).toBe('1 day overdue')
  expect(addDays('2026-12-15', 30)).toBe('2027-01-14')
})

test('numbers follow the chosen format; credit notes get CN- unless it prints the type', () => {
  expect(exampleNumber('{YYYY}-{NNN}', '2026-03-05', 7)).toBe('2026-007')
  expect(exampleNumber('{NNN}/{YYYY}', '2026-03-05', 1234)).toBe('1234/2026')
  expect(exampleNumber('RE-{YYYY}-{NNN}', '2026-03-05', 1, 'credit_note')).toBe('CN-RE-2026-001')
  expect(exampleNumber('FV/{N}/{MM}/{YY}', '2026-03-05', 17)).toBe('FV/17/03/26')
  expect(exampleNumber('{TYPE}-{YYYY}{MM}{DD}-{NN}', '2026-03-05', 3, 'credit_note')).toBe(
    'CN-20260305-03',
  )
})

test('each kind takes the next number of its own counter', () => {
  const counters = {
    series: {
      invoice: { year: 42, ever: 90 },
      credit_note: { year: 3, ever: 5 },
      proforma: { year: 1, ever: 1 },
      self_billed: { year: 1, ever: 1 },
    },
    quote: 7,
  }
  const next = (format: string, kind: Parameters<typeof nextNumberOf>[2]) =>
    nextNumberOf(format, '2026-03-05', kind, counters)
  expect(next('{YYYY}-{NNN}', 'invoice')).toBe('2026-042')
  expect(next('{YYYY}-{NNN}', 'debit_note')).toBe('2026-042')
  expect(next('{YYYY}-{NNN}', 'credit_note')).toBe('CN-2026-003')
  expect(next('{YYYY}-{NNN}', 'proforma')).toBe('PF-2026-001')
  expect(next('{NNN}', 'invoice')).toBe('090')
  expect(next('{NNN}', 'credit_note')).toBe('CN-005')
  expect(next('{TYPE}-{YYYY}-{NNN}', 'prepayment')).toBe('PP-2026-042')
  expect(next('{TYPE}-{YYYY}-{NNN}', 'quote')).toBe('Q-2026-007')
  // quotes count per year, so a format without one keeps the default
  expect(next('{TYPE}-{NNN}', 'quote')).toBe('Q-2026-007')
  expect(next('{YYYY}-{NNN}', 'quote')).toBe('Q-2026-007')
})

test('number formats are checked as the API checks them', () => {
  expect(numberFormatError('{YYYY}-{NNN}')).toBeNull()
  expect(numberFormatError('FV/{N}/{MM}/{YYYY}')).toBeNull()
  expect(numberFormatError('INV-{NNNN}')).toBeNull()
  expect(numberFormatError('{YYYY}')).toBe('Put the running number in exactly once.')
  expect(numberFormatError('{YYYY}-{N}-{NN}')).toBe('Put the running number in exactly once.')
  expect(numberFormatError('{YYYY}:{NNN}')).toMatch(/^Use only letters/)
  expect(numberFormatError('{YYYY}-{X}')).toMatch(/^Use only letters/)
  expect(numberFormatError('{YYYY}-{NNNNNNN}')).toMatch(/^Use only letters/)
  expect(numberFormatError(`${'A'.repeat(32)}{YYYY}{N}`)).toBe('Use at most 40 characters.')
})

test('reads the structured cannot_issue reasons, and nothing from other errors', () => {
  const reasons = [
    { code: 'settings_incomplete', field: 'settings.seller.zip', message: 'Add the ZIP.' },
    { code: 'no_lines', field: 'lines', message: 'Add at least one line.' },
  ]
  expect(
    cannotIssueReasons(
      new ApiError(422, 'cannot_issue', 'Not yet.', { reasons: [...reasons, 'stray'] }),
    ),
  ).toEqual(reasons)
  expect(cannotIssueReasons(new ApiError(422, 'validation_failed', 'Check.'))).toBeNull()
})

test('credit notes of one invoice are a filter of their own', () => {
  const params = parseListParams(new URLSearchParams('kind=credit_note&credited=inv_7'))
  expect(params.credited).toBe('inv_7')
  expect(apiQuery(params).get('credited_invoice_id')).toBe('inv_7')
  expect(listParamsToQuery(params).toString()).toBe('kind=credit_note&credited=inv_7')
})

test('a credit note on a paid invoice leaves the customer owed money back', () => {
  const paid = {
    amount_paid: '1000.00',
    amount_credited: '0.00',
    amount_refunded: '0.00',
    payable_total: '1000.00',
  }
  expect(refundAfterCredit(paid, '400.00')).toBe('400.00')
  // Part-paid: only what goes beyond the payable amount is owed back.
  expect(refundAfterCredit({ ...paid, amount_paid: '700.00' }, '400.00')).toBe('100.00')
  expect(refundAfterCredit({ ...paid, amount_paid: '500.00' }, '400.00')).toBe('0.00')
  // Refunds already recorded count against it.
  expect(refundAfterCredit({ ...paid, amount_refunded: '150.00' }, '400.00')).toBe('250.00')
  expect(parseListParams(new URLSearchParams('status=refund_due')).status).toEqual(['refund_due'])
})

test.each([
  ['jan.muster', 'jan.muster'],
  ['@jan_m', 'jan_m'],
  [' https://revolut.me/jan-muster/ ', 'jan-muster'],
  ['HTTPS://WWW.Revolut.me/JanM?utm=x', 'JanM'],
  ['ja', null],
  ['jan muster', null],
  ['revolut.me/jan/10chf', null],
  ['https://example.com/jan', null],
])('reads the revolut.me username of %j', (text, want) => {
  expect(revolutUsername(text)).toBe(want)
})

const of = (change: Parameters<typeof sampleSettings>[0]) =>
  sampleSettings({
    revolut_enabled: true,
    revolut_username: 'muster',
    iban: 'CH9300762011623852957',
    ...change,
  })

test('offers the QR bill only where it can exist, Revolut when it is enabled', () => {
  expect(defaultPaymentMethods(of({}), 'CHF')).toEqual({ qr_bill: true, revolut: true })
  expect(defaultPaymentMethods(of({ revolut_enabled: false }), 'USD')).toEqual({
    qr_bill: false,
    revolut: false,
  })
  expect(defaultPaymentMethods(of({ iban: null }), 'EUR').qr_bill).toBe(false)
  expect(defaultPaymentMethods(of({ iban: 'DE89370400440532013000' }), 'EUR').qr_bill).toBe(false)
  expect(qrBillBlocker(of({}), 'EUR')).toBeNull()
  expect(qrBillBlocker(of({ iban: null }), 'EUR')).toMatch(/IBAN/)
  expect(qrBillBlocker(of({}), 'USD')).toMatch(/CHF and EUR/)
  expect(qrBillBlocker(of({ iban: 'DE89370400440532013000' }), 'EUR')).toMatch(/Swiss/)
  expect(qrBillBlocker(of({ qr_bill_enabled: false }), 'CHF')).toMatch(/off/)
  expect(
    usableMethods({ qr_bill: true, revolut: true }, of({ revolut_username: null }), 'USD'),
  ).toEqual({ qr_bill: false, revolut: false })
})

const einvoiceFormatValues = (seller: string, buyer: string) =>
  einvoiceFormatsFor(seller, buyer).map((format) => format.value)

describe('instalments and e-invoices', () => {
  const server = setupServer(...handlers)
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
  afterAll(() => server.close())

  test('intervals have labels for a select', () => {
    expect(INTERVALS[2]).toEqual({ value: 'monthly', label: 'Monthly' })
    expect(INTERVALS.map((entry) => entry.value)).toEqual([
      'weekly',
      'biweekly',
      'monthly',
      'quarterly',
      'yearly',
    ])
  })

  test('exemption codes are official VATEX-EU codes only; O defaults to VATEX-EU-O', () => {
    expect(VATEX_CODES.every((code) => code.value.startsWith('VATEX-EU-') && code.label)).toBe(true)
    expect(new Set(VATEX_CODES.map((code) => code.value)).size).toBe(VATEX_CODES.length)
    expect(defaultExemptionCode('O')).toBe('VATEX-EU-O')
    expect(defaultExemptionCode('E')).toBeNull()
    expect(defaultExemptionCode('S')).toBeNull()
    const known = new Set(VATEX_CODES.map((code) => code.value))
    for (const category of ['O', 'AE', 'K', 'G'] as const)
      expect(known.has(defaultExemptionCode(category) ?? '')).toBe(true)
  })

  test('the sample invoice has a three-part schedule that adds up to its amount', async () => {
    const { data } = await invoicesApi.get('inv_mock_schedule')
    const items = data.instalments?.items ?? []
    expect(items.map((item) => item.status)).toEqual(['paid', 'part_paid', 'open'])
    expect(items.reduce((sum, item) => sum + toCents(item.amount), 0n)).toBe(
      toCents(data.payable_total),
    )
    expect(items[1]?.open).toBe('220.70')
    expect(data).toMatchObject({ plan: null, reminders_enabled: true })
  })

  test('e-invoice downloads in the five formats', async () => {
    expect(EINVOICE_FORMATS.map((entry) => entry.value)).toEqual([
      'xrechnung-ubl',
      'xrechnung-cii',
      'peppol',
      'factur-x',
      'ro-cius',
    ])
    expect(einvoiceUrl('inv_1', 'peppol')).toBe('/api/v1/invoices/inv_1/einvoice?format=peppol')
    const values = einvoiceFormatValues
    expect(values('CH', 'DE')).toEqual(['xrechnung-ubl', 'xrechnung-cii', 'peppol', 'factur-x'])
    expect(values('CH', 'RO')).toContain('ro-cius')
    expect(values('PL', 'DE').at(-1)).toBe('ksef-fa3')
    const res = await fetch(
      new URL(einvoiceUrl('inv_mock_schedule', 'xrechnung-cii'), location.href),
    )
    expect(res.headers.get('content-type')).toContain('application/xml')
    expect(res.headers.get('content-disposition')).toContain('2026-042.xml')
    expect(await res.text()).toContain('CrossIndustryInvoice')
    const hybrid = await fetch(new URL(einvoiceUrl('inv_mock_schedule', 'factur-x'), location.href))
    expect(hybrid.headers.get('content-type')).toBe('application/pdf')
    expect(hybrid.headers.get('content-disposition')).toContain('2026-042.pdf')
    const bad = await fetch(new URL('/api/v1/invoices/inv_1/einvoice?format=pdf', location.href))
    expect(bad.status).toBe(400)
  })
})

test('only a Romanian buyer in another currency needs the RON rate', () => {
  expect(needsRonRate('RO', 'EUR')).toBe(true)
  expect(needsRonRate('RO', 'RON')).toBe(false)
  expect(needsRonRate('DE', 'EUR')).toBe(false)
  expect(needsRonRate(undefined, 'EUR')).toBe(false)
})

test('reads the dunning levels of an older API as the steps the server makes of them', () => {
  const { steps: _, ...dunning } = sampleSettings().dunning
  const settings = settingsFrom({
    ...sampleSettings(),
    dunning: {
      ...dunning,
      levels: [
        { days: 10, fee: '0.00', text: null },
        { name: 'Second notice', days: 14, fee: '20.00', text: 'Please pay now.' },
        { days: 7, fee: '30.00' },
      ],
    },
  })
  expect(settings.dunning.steps).toEqual([
    { name: null, timing: 'after_due', days: 10, fee: '0.00', text: null, qr_bill: true },
    {
      name: 'Second notice',
      timing: 'after_previous',
      days: 14,
      fee: '20.00',
      text: 'Please pay now.',
      qr_bill: true,
    },
    { name: null, timing: 'after_previous', days: 7, fee: '30.00', text: null, qr_bill: true },
  ])
  expect(settings.dunning).not.toHaveProperty('levels')
  expect(settings.dunning.enabled).toBe(dunning.enabled)
})

test('keeps the steps of a current API as they are', () => {
  expect(settingsFrom(sampleSettings())).toEqual(sampleSettings())
})

test('formatRange keeps the first year only across years', () => {
  expect(formatRange('2026-10-01', '2026-11-08')).toBe('1 Oct – 8 Nov 2026')
  expect(formatRange('2025-12-01', '2026-11-30')).toBe('1 Dec 2025 – 30 Nov 2026')
})

test('preset number formats follow the seller country; every preset is valid', () => {
  expect(numberFormatsFor('US')[0]).toBe('INV-{NNNN}')
  expect(numberFormatsFor('LI')).toEqual(numberFormatsFor('CH'))
  expect(numberFormatsFor('JP')).toContain('{YYYY}/{TYPE}/{NNN}')
  for (const country of ['CH', 'DE', 'AT', 'FR', 'IT', 'ES', 'PL', 'GB', 'US', undefined]) {
    expect(numberFormatsFor(country)).toHaveLength(4)
    for (const format of numberFormatsFor(country)) expect(numberFormatError(format)).toBeNull()
  }
})

describe('repeatsAmount', () => {
  const line = { quantity: '1.000', unit: null, discount_percent: '0' }
  it('is true for one plain line without VAT', () => expect(repeatsAmount(line, 'none')).toBe(true))
  it('is false when the meta row says more', () => {
    expect(repeatsAmount({ ...line, quantity: '2' }, 'none')).toBe(false)
    expect(repeatsAmount({ ...line, unit: 'hour' }, 'none')).toBe(false)
    expect(repeatsAmount({ ...line, discount_percent: '10' }, 'none')).toBe(false)
    expect(repeatsAmount(line, 'exclusive')).toBe(false)
  })
})
