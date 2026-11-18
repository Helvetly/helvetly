import {
  addTag,
  typedTag,
  CURRENCIES,
  draftHint,
  formatUid,
  isValidUid,
  emptyValues,
  RO_COUNTIES,
  missingAddress,
  serverFieldErrors,
  toInput,
  validate,
  type FormValues,
} from './client-form-model'

const values = (change: Partial<FormValues>): FormValues => ({ ...emptyValues(), ...change })

test('blank fields become null, text is trimmed, email lowercased, phone in E.164', () => {
  const input = toInput(
    values({
      name: '  Konditorei Muster AG ',
      email: ' Info@Konditorei-Muster.CH ',
      phone: '044 224 46 46',
      street: 'Bahnhofstrasse',
      preferred_name: '   ',
      country: 'ch',
    }),
    false,
  )
  expect(input).toMatchObject({
    name: 'Konditorei Muster AG',
    preferred_name: null,
    email: 'info@konditorei-muster.ch',
    phone: '+41442244646',
    street: 'Bahnhofstrasse',
    street_number: null,
    country: 'CH',
    note: null,
  })
  expect(input).not.toHaveProperty('is_active')
  expect(toInput(values({ name: 'A', is_active: false }), true).is_active).toBe(false)
})

test('a number with its own country code keeps it', () => {
  expect(toInput(values({ name: 'A', phone: '+49 30 901820' }), false).phone).toBe('+4930901820')
})

test('only the name is required; phone and the rest are optional', () => {
  expect(validate(values({ name: 'Ab' }))).toEqual({})
  expect(validate(values({}))).toEqual({ name: 'Enter the company name.' })
  expect(validate(values({ is_company: false })).name).toBe('Enter the full name.')
  expect(validate(values({ name: 'A', email: 'nope', phone: '123' }))).toEqual({
    email: 'Enter a valid email address.',
    phone: 'Enter a valid phone number.',
  })
  expect(validate(values({ name: 'A', note: 'x'.repeat(1001) })).note).toBe(
    'Use at most 1000 characters.',
  )
})

test('the draft hint lists what the address still needs, in form order', () => {
  expect(missingAddress(values({ street: 'Seestrasse', country: '' }))).toEqual([
    'street_number',
    'zip',
    'city',
    'country',
  ])
  expect(draftHint(['street_number', 'zip', 'city'])).toBe(
    'Draft until the address is complete: add number, ZIP and city.',
  )
  expect(draftHint(['country'])).toBe('Draft until the address is complete: add country.')
  expect(draftHint([])).toBeNull()
})

test('server field errors keep only the fields the form shows', () => {
  expect(serverFieldErrors({ fields: { email: 'Already used.', bogus: 'x', phone: 42 } })).toEqual({
    email: 'Already used.',
  })
  expect(serverFieldErrors({})).toEqual({})
})

test('formats a Swiss UID as it is typed and checks its digit', () => {
  expect(formatUid('che')).toBe('CHE')
  expect(formatUid('che1234')).toBe('CHE-123.4')
  expect(formatUid('CHE-123.456.788 mwst')).toBe('CHE-123.456.788 MWST')
  expect(formatUid('che 123 456 788 tva')).toBe('CHE-123.456.788 TVA')
  expect(formatUid('CHE-1234567889999')).toBe('CHE-123.456.788')
  expect(formatUid('DE123456789')).toBe('DE123456789')
  // Typed one character at a time, as in the field.
  const typed = [...'che123456788mwst'].reduce((value, char) => formatUid(value + char), '')
  expect(typed).toBe('CHE-123.456.788 MWST')
  expect(formatUid('CHE-123.456.788 X')).toBe('CHE-123.456.788')
  expect(isValidUid('CHE-123.456.788')).toBe(true)
  expect(isValidUid('CHE-123.456.788 IVA')).toBe(true)
  expect(isValidUid('CHE-123.456.789')).toBe(false)
  expect(validate(values({ name: 'A', vat_number: 'CHE-123.456.789' })).vat_number).toMatch(
    /isn’t valid/,
  )
  expect(validate(values({ name: 'A', vat_number: 'DE123456789' }))).toEqual({})
})

test('tags are trimmed, unique ignoring case, at most 30 characters and 10 per client', () => {
  expect(addTag(['VIP'], '  Retail   partner ')).toEqual({ tags: ['VIP', 'Retail-partner'] })
  expect(addTag([], 'dobry-=====')).toEqual({ tags: ['dobry'] })
  expect(addTag([], '-q4-2026-')).toEqual({ tags: ['q4-2026'] })
  expect(addTag([], 'Zürich')).toEqual({ tags: ['Zrich'] })
  expect(addTag([], '===')).toEqual({ tags: [] })
  expect(addTag(['VIP'], 'vip')).toEqual({ tags: ['VIP'] })
  expect(addTag(['VIP'], '   ')).toEqual({ tags: ['VIP'] })
  expect(addTag([], 'x'.repeat(40))).toEqual({ tags: ['x'.repeat(32)] })
  const ten = Array.from({ length: 10 }, (_, i) => `t${i}`)
  expect(addTag(ten, 'more')).toEqual({ tags: ten, error: 'A client has at most 10 tags.' })
})

test('billing defaults: a new client starts with a real language, CHF and 30 days', () => {
  // jsdom's browser language is en-US.
  expect(emptyValues()).toMatchObject({ language: 'en', currency: 'CHF', payment_terms_days: '30' })
  expect(toInput({ ...emptyValues(), name: 'A' }, false)).toMatchObject({
    language: 'en',
    currency: 'CHF',
    payment_terms_days: 30,
    tags: [],
  })
  expect(
    toInput(
      values({ name: 'A', language: 'fr', currency: 'EUR', payment_terms_days: '45' }),
      false,
    ),
  ).toMatchObject({ language: 'fr', currency: 'EUR', payment_terms_days: 45 })
  expect(validate(values({ name: 'A', payment_terms_days: '400' })).payment_terms_days).toBe(
    'Enter 0 to 365 days.',
  )
  expect(CURRENCIES.slice(0, 2).map((currency) => currency.code)).toEqual(['CHF', 'EUR'])
})

test('a county is sent for a Romanian address only', () => {
  const ro = { ...emptyValues(), name: 'Client SRL', country: 'RO', region: 'RO-CJ' }
  expect(toInput(ro, false).region).toBe('RO-CJ')
  expect(toInput({ ...ro, country: 'DE' }, false).region).toBeNull()
  expect(RO_COUNTIES).toHaveLength(42)
  expect(RO_COUNTIES.find((county) => county.value === 'RO-B')?.label).toBe('București (RO-B)')
})

test('e-invoice settings: a Leitweg-ID is checked and sent upper-cased; the format goes as chosen', () => {
  expect(
    validate(values({ name: 'Stadt Bonn', leitweg_id: '04011000-1234512345-07' })).leitweg_id,
  ).toMatch('Leitweg-ID')
  const input = toInput(
    values({
      name: 'Stadt Bonn',
      einvoice_format: 'xrechnung_ubl',
      leitweg_id: ' 991-33333test-33 ',
    }),
    false,
  )
  expect(input).toMatchObject({ einvoice_format: 'xrechnung_ubl', leitweg_id: '991-33333TEST-33' })
  expect(toInput(values({ name: 'A' }), false)).toMatchObject({
    einvoice_format: 'none',
    leitweg_id: null,
  })
})

test('a tag field types only the tag shape', () => {
  expect(typedTag('dobry-=====')).toBe('dobry-')
  expect(typedTag('big client')).toBe('big-client')
  expect(typedTag('-a')).toBe('a')
  expect(typedTag('a--b')).toBe('a-b')
  expect(typedTag('Q4/2026')).toBe('Q42026')
})
