import type { InvoiceSettings } from '@/lib/invoices'
import { sampleInvoice, sampleSchedule, sampleSettings } from '@/test/invoice-api'
import { sampleClient } from '@/test/invoice-fixtures'

import { priceCatalogueLine, unresolvedCataloguePrice } from './catalogue-price'
import {
  addPickedLine,
  applyClient,
  changeVatMode,
  emptyValues,
  editorLine,
  instalmentGap,
  instalmentsSummary,
  lockedInput,
  moveLine,
  prepaidTotal,
  reasonTarget,
  scheduleBlocker,
  serverErrors,
  startInstalments,
  toInput,
  valuesFromInvoice,
  withoutCreditLocks,
  type EditorLine,
} from './editor-model'

test.each(['10', '100', '1000', '10.00'])(
  'reopening a draft preserves quantity %s and integer VAT rates',
  (quantity) => {
    const invoice = sampleInvoice()
    invoice.lines = [
      {
        id: 'lin_1',
        position: 1,
        description: 'Consulting',
        quantity,
        unit: 'hour',
        unit_price: '100.00',
        discount_percent: '0',
        vat_category: 'S',
        vat_rate: '20',
        vat_exemption_code: null,
        vat_exemption_reason: null,
        amount: '1000.00',
      },
    ]
    const values = valuesFromInvoice(invoice, '8.1')
    expect(values.lines[0]?.quantity).toBe(quantity === '10.00' ? '10' : quantity)
    expect(values.lines[0]?.vat_rate).toBe('20')
    expect(toInput(values).input.lines?.[0]).toMatchObject({
      quantity: quantity === '10.00' ? '10' : quantity,
      vat_rate: '20',
    })
  },
)

test('picking a catalogue item preserves an integer VAT rate ending in zero', () => {
  const picked = {
    description: 'European consulting',
    quantity: '1',
    unit: 'hour' as const,
    unit_price: '100.00',
    vat_category: 'S' as const,
    vat_rate: '20',
  }
  expect(addPickedLine([], picked, 'exclusive', '8.1').lines[0]?.vat_rate).toBe('20')
})

const settings = {
  seller: {
    name: 'Muster GmbH',
    street: '',
    street_number: '',
    apt: null,
    zip: '',
    city: '',
    country: 'CH',
    vat_number: null,
    email: null,
    phone: null,
  },
  vat_registered: true,
  default_vat_mode: 'exclusive',
  default_vat_rate: '8.1',
  iban: null,
  bank_name: null,
  bic: null,
  currency: 'CHF',
  language: 'de',
  default_terms_days: 30,
  number_format: '{YYYY}-{NNN}',
  footer: 'Thank you.',
  qr_bill_enabled: true,
  revolut_enabled: false,
  revolut_username: null,
  instalments: sampleSettings().instalments,
  dunning: sampleSettings().dunning,
  payment_confirmation: true,
  logo_file_id: null,
  logo_url: null,
  is_complete: false,
  missing_fields: [],
} satisfies InvoiceSettings

const line = (change: Partial<EditorLine>): EditorLine => ({
  key: change.key ?? 'k',
  description: '',
  quantity: '1',
  unit: null,
  unit_price: '',
  discount_percent: '',
  vat_category: 'S',
  vat_rate: '8.1',
  vat_exemption_code: null,
  vat_exemption_reason: '',
  ...change,
})

test('a client brings its currency, language and terms', () => {
  const client = sampleClient({ currency: 'EUR', language: 'fr', payment_terms_days: 10 })
  const values = applyClient(
    { ...emptyValues(settings), issue_date: '2026-11-05' },
    client,
    settings,
  )
  expect(values).toMatchObject({
    client_id: 'cli_1',
    currency: 'EUR',
    language: 'fr',
    due_date: '2026-11-15',
  })
  expect(values.footer).toBe('Thank you.')
})

test('sends normalized numbers, skips untouched lines and reports bad numbers by line', () => {
  const values = {
    ...emptyValues(settings),
    client_id: 'cli_1',
    discount_percent: '5',
    lines: [
      line({ key: 'a', description: ' Design ', quantity: '2,5', unit_price: "1'450" }),
      line({ key: 'b' }),
      line({
        key: 'c',
        description: 'Hosting',
        quantity: 'x',
        unit_price: '49',
        vat_category: 'E',
        vat_rate: '8.1',
      }),
    ],
  }
  const { input, errors, keys } = toInput(values)
  expect(keys).toEqual(['a', 'c'])
  expect(input.lines?.[0]).toEqual({
    description: 'Design',
    quantity: '2.5',
    unit: null,
    unit_price: '1450.00',
    discount_percent: '0',
    vat_category: 'S',
    vat_rate: '8.1',
    vat_exemption_code: null,
    vat_exemption_reason: null,
  })
  // Only the standard category carries a rate.
  expect(input.lines?.[1]?.vat_rate).toBe('0')
  expect(input.discount_percent).toBe('5')
  expect(errors).toEqual({ 'c.quantity': 'A number like 1 or 2.5' })

  // The preview gets every row, so its amounts line up with what is on screen.
  expect(toInput(values, true).input.lines).toHaveLength(3)
})

test('exempt lines send their code and reason; other categories send neither', () => {
  const values = {
    ...emptyValues(settings),
    lines: [
      line({
        key: 'a',
        description: 'Training',
        unit_price: '100',
        vat_category: 'E',
        vat_rate: '0',
        vat_exemption_code: 'VATEX-EU-132-1I',
        vat_exemption_reason: ' Art. 21 MWSTG ',
      }),
      line({
        key: 'b',
        description: 'Design',
        unit_price: '100',
        vat_exemption_code: 'VATEX-EU-AE',
        vat_exemption_reason: 'stale',
      }),
      line({
        key: 'c',
        description: 'Long',
        unit_price: '1',
        vat_category: 'O',
        vat_exemption_reason: 'x'.repeat(301),
      }),
    ],
  }
  const { input, errors } = toInput(values)
  expect(input.lines?.[0]).toMatchObject({
    vat_exemption_code: 'VATEX-EU-132-1I',
    vat_exemption_reason: 'Art. 21 MWSTG',
  })
  expect(input.lines?.[1]).toMatchObject({ vat_exemption_code: null, vat_exemption_reason: null })
  expect(errors).toEqual({ 'c.vat_exemption_reason': 'At most 300 characters' })
})

test('a line priced in another currency blocks saving until its price is typed', () => {
  const foreign = line({ key: 'a', description: 'Licence', price_currency: 'EUR' })
  const values = { ...emptyValues(settings), lines: [foreign] }
  expect(toInput(values).errors).toEqual({ 'a.unit_price': 'Enter the CHF price' })
  // The preview still runs: an empty price counts as zero there.
  expect(toInput(values, true).errors).toEqual({})
  expect(toInput({ ...values, lines: [{ ...foreign, unit_price: '90' }] }).errors).toEqual({})
})

test('reopening a draft loads the exemption code and reason', () => {
  const invoice = sampleInvoice()
  invoice.lines = [
    {
      id: 'lin_1',
      position: 1,
      description: 'Training',
      quantity: '1',
      unit: null,
      unit_price: '100.00',
      discount_percent: '0',
      vat_category: 'E',
      vat_rate: '0',
      vat_exemption_code: 'VATEX-EU-79-C',
      vat_exemption_reason: 'Basis',
      amount: '100.00',
    },
  ]
  expect(valuesFromInvoice(invoice, '8.1').lines[0]).toMatchObject({
    vat_exemption_code: 'VATEX-EU-79-C',
    vat_exemption_reason: 'Basis',
  })
})

test('server errors land on the line they are about', () => {
  expect(
    serverErrors({ 'lines.1.unit_price': 'Too high.', due_date: 'Bad.', x: 3 }, ['a', 'c']),
  ).toEqual({
    'c.unit_price': 'Too high.',
    due_date: 'Bad.',
  })
})

test('moving, switching VAT off and locking credit notes', () => {
  const lines = [line({ key: 'a' }), line({ key: 'b' }), line({ key: 'c' })]
  expect(moveLine(lines, 2, 0).map((entry) => entry.key)).toEqual(['c', 'a', 'b'])
  expect(moveLine(lines, 0, 5)).toBe(lines)

  const none = changeVatMode({ ...emptyValues(settings), lines }, 'none', '8.1')
  expect(none.lines.every((entry) => entry.vat_category === 'O' && entry.vat_rate === '0')).toBe(
    true,
  )
  expect(changeVatMode(none, 'exclusive', '8.1').lines[0]).toMatchObject({
    vat_category: 'S',
    vat_rate: '8.1',
  })

  expect(
    Object.keys(
      withoutCreditLocks({
        client_id: 'c',
        currency: 'CHF',
        vat_mode: 'none',
        discount_percent: '1',
        note: 'x',
      }),
    ),
  ).toEqual(['note'])
})

test('cannot-issue reasons point at the field to fix', () => {
  expect(reasonTarget('due_date')).toEqual({ field: 'due_date' })
  expect(reasonTarget('lines.2.description')).toEqual({ field: 'description', line: 2 })
  expect(reasonTarget('lines')).toEqual({ field: 'add-line' })
  expect(reasonTarget('settings.iban')).toBeNull()
  expect(reasonTarget(undefined)).toBeNull()
})

test('a catalogue item replaces the untouched first line, else it is appended', () => {
  const picked = {
    description: 'Consulting hour',
    quantity: '1',
    unit: 'hour' as const,
    unit_price: '180.00',
    vat_category: 'S' as const,
    vat_rate: '8.10',
  }
  const blank = emptyValues(settings).lines
  const replaced = addPickedLine(blank, picked, 'exclusive', '8.1')
  expect(replaced.lines).toHaveLength(1)
  expect(replaced.lines[0]).toMatchObject({
    description: 'Consulting hour',
    unit_price: '180.00',
    vat_rate: '8.1',
  })
  expect(replaced.lines[0]?.key).toBe(replaced.key)

  const typed = [line({ key: 'a', description: 'Design' })]
  const appended = addPickedLine(typed, picked, 'exclusive', '8.1')
  expect(appended.lines.map((entry) => entry.description)).toEqual(['Design', 'Consulting hour'])

  const two = [line({ key: 'a' }), line({ key: 'b' })]
  expect(addPickedLine(two, picked, 'exclusive', '8.1').lines).toHaveLength(3)
})

test('a final invoice sends its prepayment ids; other kinds never do', () => {
  const prepayments = [
    { id: 'inv_p1', number: '2026-003', payable_total: '1000.00' },
    { id: 'inv_p2', number: '2026-004', payable_total: '250.55' },
  ]
  const values = { ...emptyValues(settings), client_id: 'cli_1', prepayments }
  expect(toInput(values).input.prepayment_ids).toEqual(['inv_p1', 'inv_p2'])
  expect(toInput({ ...values, kind: 'partial' }).input).not.toHaveProperty('prepayment_ids')
  expect(prepaidTotal(prepayments)).toBe('1250.55')
  expect(prepaidTotal([])).toBe('0.00')
})

test('proforma and self-billed send no payment methods; invoices keep theirs', () => {
  const { input } = toInput({ ...emptyValues(settings), client_id: 'cli_1' })
  expect(lockedInput('proforma', input)).not.toHaveProperty('payment_methods')
  expect(lockedInput('self_billed', input)).not.toHaveProperty('payment_methods')
  expect(lockedInput('partial', input)).toHaveProperty('payment_methods')
  expect(lockedInput('credit_note', input)).not.toHaveProperty('currency')
})

const rows = (amounts: string[]) => amounts.map((amount) => ({ due_date: '', amount }))

test('the sum check names what the rows are off by', () => {
  expect(instalmentGap(rows(['400', '360.35', '360.30']), '1081.00')).toBe('39.65')
  expect(instalmentGap(rows(['300', '360.35', '360.30']), '1081.00')).toBe('60.35')
  expect(instalmentGap(rows(['360.35', '360.35', '360.30']), '1081.00')).toBeNull()
  expect(instalmentGap(rows(['x', '1']), '1081.00')).toBeNull()
})

test('a schedule is sent generated (no items) until a row is edited; off sends null', () => {
  const defaults = sampleSettings()
  const base = emptyValues(defaults)
  expect(toInput(base).input).toMatchObject({ instalments: null, reminders_enabled: true })
  const on = { ...base, instalments: startInstalments(defaults, '2026-12-01') }
  expect(toInput(on).input.instalments).toEqual({
    count: 3,
    interval: 'monthly',
    first_due_date: '2026-12-01',
  })
  const edited = {
    ...on,
    instalments: {
      ...startInstalments(defaults, '2026-12-01'),
      items: [
        { due_date: '2026-12-01', amount: '400' },
        { due_date: '2027-01-01', amount: '681' },
      ],
      count: '2',
    },
  }
  expect(toInput(edited).input.instalments).toEqual({
    count: 2,
    interval: 'monthly',
    first_due_date: '2026-12-01',
    items: [
      { due_date: '2026-12-01', amount: '400.00' },
      { due_date: '2027-01-01', amount: '681.00' },
    ],
  })
  // The preview gets the schedule without rows, so it answers the generated ones.
  expect(toInput(edited, true).input.instalments).toEqual({
    count: 2,
    interval: 'monthly',
    first_due_date: '2026-12-01',
  })
  const unfinished = { ...on, instalments: { ...on.instalments, count: '1' } }
  expect(toInput(unfinished, true).input.instalments).toBeUndefined()
  expect(toInput({ ...on, instalments: { ...on.instalments, count: '13' } }).errors).toHaveProperty(
    'instalments.count',
  )
  expect(toInput({ ...on, kind: 'credit_note' }).input).not.toHaveProperty('instalments')
})

test('a draft reopens with its schedule as saved', () => {
  const draft = sampleInvoice({ payable_total: '1081.00', instalments: sampleSchedule() })
  expect(valuesFromInvoice(draft, '8.1').instalments).toEqual({
    count: '3',
    interval: 'monthly',
    first_due_date: '2026-12-01',
    items: [
      { due_date: '2026-12-01', amount: '360.35' },
      { due_date: '2027-01-01', amount: '360.35' },
      { due_date: '2027-02-01', amount: '360.30' },
    ],
  })
})

test('issuing waits while the rows are off or one is due before the issue date', () => {
  const values = {
    ...emptyValues(sampleSettings()),
    issue_date: '2026-11-05',
    instalments: startInstalments(sampleSettings(), '2026-12-01'),
  }
  const generated = sampleSchedule().items.map(({ due_date, amount }) => ({ due_date, amount }))
  expect(scheduleBlocker(values, '1081.00', generated)).toBeNull()
  const typed = [
    { due_date: '2026-12-01', amount: '400.00' },
    { due_date: '2027-01-01', amount: '360.35' },
    { due_date: '2027-02-01', amount: '360.30' },
  ]
  expect(
    scheduleBlocker(
      { ...values, instalments: { ...values.instalments, items: typed } },
      '1081.00',
      generated,
    ),
  ).toBe('Off by 39.65')
  expect(
    scheduleBlocker(
      values,
      '1081.00',
      generated.with(0, { due_date: '2026-11-01', amount: '360.35' }),
    ),
  ).toBe('An instalment is due before the issue date.')
})

test('the RON rate is kept on a draft and sent, blank as null', () => {
  const values = valuesFromInvoice(
    sampleInvoice({ currency: 'EUR', tax_currency_rate: '4.9771' }),
    '8.1',
  )
  expect(values.tax_currency_rate).toBe('4.9771')
  expect(toInput(values).input.tax_currency_rate).toBe('4.9771')
  expect(toInput({ ...values, tax_currency_rate: ' ' }).input.tax_currency_rate).toBeNull()
})

test('a price above what the API accepts is an error on its line, also for the preview', () => {
  const values = {
    ...emptyValues(settings),
    lines: [
      line({ key: 'a', description: 'Max', unit_price: "100'000'000" }),
      line({ key: 'b', description: 'Over', unit_price: '100000000.01' }),
    ],
  }
  expect(toInput(values).errors).toEqual({ 'b.unit_price': 'At most 100’000’000.00' })
  expect(toInput(values, true).errors).toEqual({ 'b.unit_price': 'At most 100’000’000.00' })
})

test.each([
  [
    'the shape before any row is typed',
    { count: '3', interval: 'monthly' as const, first_due_date: '2026-12-19', items: null },
    '3× · Monthly · from 19 Dec 2026',
  ],
  [
    'typed rows: their number and first date',
    {
      count: '3',
      interval: 'quarterly' as const,
      first_due_date: '2026-12-19',
      items: [
        { due_date: '2027-01-05', amount: '500.00' },
        { due_date: '2027-04-05', amount: '500.00' },
      ],
    },
    '2× · Quarterly · from 5 Jan 2027',
  ],
  [
    'no first date yet',
    { count: '4', interval: 'weekly' as const, first_due_date: '', items: null },
    '4× · Weekly · from —',
  ],
])('instalments summary: %s', (_, schedule, expected) => {
  expect(instalmentsSummary(schedule)).toBe(expected)
})

test('a saved catalogue snapshot survives a round trip and a quantity change requires fresh consent', () => {
  const values = emptyValues(sampleSettings())
  const row = values.lines[0]!
  const original = {
    ...row,
    description: 'Part',
    quantity: '1000',
    vat_rate: '8.1',
    unit_price: '0.06',
    catalogue: { price_basis: 'gross' as const, unit_price: '0.07', currency: 'EUR' },
    acceptedConversion: true,
  }
  const saved = toInput({ ...values, currency: 'EUR', vat_mode: 'exclusive', lines: [original] })
    .input.lines![0]!
  const reopened = editorLine({ ...saved, id: 'line', position: 1, amount: '60.00' })
  expect(reopened.catalogue).toEqual(original.catalogue)
  expect(unresolvedCataloguePrice(reopened, 'exclusive', 'EUR')).toBeNull()
  const taxFree = changeVatMode({ ...values, currency: 'EUR', lines: [reopened] }, 'none', '8.1')
  expect(taxFree.lines[0]?.unit_price).toBe('0.06')
  expect(changeVatMode(taxFree, 'inclusive', '8.1').lines[0]?.unit_price).toBe('0.07')
  expect(
    unresolvedCataloguePrice(
      priceCatalogueLine({ ...reopened, quantity: '2000' }, 'exclusive', 'EUR'),
      'exclusive',
      'EUR',
    ),
  ).toMatchObject({ original: '140.00', projected: '129.72', difference: '-10.28' })
  const exact = priceCatalogueLine(
    { ...original, quantity: '0.125', catalogue: { ...original.catalogue, unit_price: '0.12' } },
    'exclusive',
    'EUR',
  )
  expect(exact.unit_price).toBe('0.12')
  expect(unresolvedCataloguePrice(exact, 'exclusive', 'EUR')).toBeNull()
  const manual = { ...original, catalogue: undefined, unit_price: '123.45' }
  expect(priceCatalogueLine(manual, 'inclusive', 'EUR')).toEqual(manual)
})
