import { ApiError } from '@/lib/api'
import { sampleSettings } from '@/test/invoice-api'

import {
  currencyLock,
  formField,
  reminderSummary,
  toSettingsInput,
  validate,
  valuesFrom,
} from './invoice-settings'

test.each([
  ['https://revolut.me/muster/', 'muster'],
  ['@muster', 'muster'],
  ['no spaces', 'no spaces'], // sent as typed: the form shows the error and the API refuses it
  ['  ', null],
])('saves the revolut.me username of %j as %j', (typed, saved) => {
  const values = { ...valuesFrom(sampleSettings()), revolut_enabled: true, revolut_username: typed }
  expect(toSettingsInput(values)).toMatchObject({ revolut_enabled: true, revolut_username: saved })
})

test('keeps the payment method switches it read', () => {
  const input = toSettingsInput(valuesFrom(sampleSettings({ qr_bill_enabled: false })))
  expect(input).toMatchObject({
    qr_bill_enabled: false,
    revolut_enabled: false,
    revolut_username: null,
  })
})

test('settings save instalments', () => {
  const values = valuesFrom(sampleSettings())
  expect(toSettingsInput(values).instalments).toEqual(sampleSettings().instalments)
  const changed = {
    ...values,
    instalments_count: '6',
    instalments_mode: 'plan' as const,
    instalments_plan_lead_days: '14',
    instalments_remind_before_days: '0',
    instalments_remind_after_days: '10, 3 ,3',
  }
  expect(toSettingsInput(changed).instalments).toEqual({
    count: 6,
    interval: 'monthly',
    mode: 'plan',
    plan_lead_days: 14,
    plan_auto_send: true,
    reminders_enabled: true,
    remind_before_days: 0,
    remind_after_days: [3, 10],
  })
  expect(
    toSettingsInput({ ...changed, instalments_remind_after_days: '' }).instalments,
  ).toMatchObject({ remind_after_days: [] })
})

test('a 409 currency_locked reads as the reason the currency is fixed', () => {
  expect(
    currencyLock(new ApiError(409, 'currency_locked', 'The base currency cannot change.')),
  ).toBe('The base currency cannot change.')
  expect(currencyLock(new ApiError(409, 'conflict', 'Other.'))).toBeNull()
  expect(currencyLock(new Error('offline'))).toBeNull()
})

test.each([
  [
    '5',
    '3, 10',
    'Your client gets a reminder 5 days before, and 3 and 10 days after each due date, until the instalment is paid.',
  ],
  [
    '1',
    '',
    'Your client gets a reminder 1 day before each due date, until the instalment is paid.',
  ],
  [
    '0',
    '10, 3, 3',
    'Your client gets a reminder 3 and 10 days after each due date, until the instalment is paid.',
  ],
  [
    '0',
    '1, 5, 30',
    'Your client gets a reminder 1, 5 and 30 days after each due date, until the instalment is paid.',
  ],
  ['0', '', 'No reminders are sent.'],
  [
    '0',
    '3, 1x',
    'Your client gets a reminder 3 days after each due date, until the instalment is paid.',
  ],
])('reminders %j before and %j after read as a sentence', (before, after, sentence) => {
  expect(reminderSummary(before, after)).toBe(sentence)
})

test('settings save dunning as typed, normalised', () => {
  const values = valuesFrom(sampleSettings())
  expect(toSettingsInput(values).dunning).toEqual(sampleSettings().dunning)
  const changed = {
    ...values,
    dunning_enabled: true,
    dunning_steps: [
      {
        key: 'a',
        name: ' ',
        timing: 'before_due' as const,
        days: '3',
        fee: '0.00',
        qr_bill: false,
      },
      {
        key: 'b',
        name: '',
        timing: 'after_due' as const,
        days: '7',
        fee: '',
        qr_bill: true,
      },
      {
        key: 'c',
        name: 'Letzte Aufforderung',
        timing: 'after_previous' as const,
        days: '14',
        fee: '20',
        qr_bill: true,
      },
    ],
    dunning_interest_enabled: true,
    dunning_interest_rate: '5,5',
    dunning_interest_from: 'due_date' as const,
  }
  expect(toSettingsInput(changed).dunning).toEqual({
    enabled: true,
    steps: [
      { name: null, timing: 'before_due', days: 3, fee: '0.00', qr_bill: false },
      { name: null, timing: 'after_due', days: 7, fee: '0.00', qr_bill: true },
      {
        name: 'Letzte Aufforderung',
        timing: 'after_previous',
        days: 14,
        fee: '20.00',
        qr_bill: true,
      },
    ],
    interest_enabled: true,
    interest_rate: '5.5',
    interest_from: 'due_date',
  })
})

test('dunning steps are checked in the order they go out, keyed by step', () => {
  const values = valuesFrom(sampleSettings())
  expect(Object.keys(validate(values)).filter((key) => key.startsWith('dunning'))).toEqual([])
  const [first, second] = values.dunning_steps
  if (!first || !second) throw new Error('two steps expected')
  const errors = validate({
    ...values,
    dunning_steps: [first, { ...second, timing: 'after_due', days: '5', fee: '2.33' }],
  })
  expect(errors['dunning_steps.1.timing']).toBe('Each reminder must come after the one before it.')
  expect(errors['dunning_steps.1.fee']).toBe('From 0 to 1000.00, in steps of 0.05.')
})

test('the company phone opens in its national format, saves E.164 and refuses invalid numbers', () => {
  const settings = sampleSettings({ seller: { ...sampleSettings().seller, phone: '+41782390999' } })
  const values = valuesFrom(settings)
  expect(values).toMatchObject({ phone: '078 239 09 99', phone_country: 'CH' })
  expect(toSettingsInput(values).seller.phone).toBe('+41782390999')
  expect(toSettingsInput({ ...values, phone: '30 901820', phone_country: 'DE' }).seller.phone).toBe(
    '+4930901820',
  )
  expect(toSettingsInput({ ...values, phone: ' ' }).seller.phone).toBeNull()
  expect(validate({ ...values, phone: '123' }).phone).toBe('Enter a valid phone number.')
  expect(validate(values).phone).toBeUndefined()
  // No number yet: the country follows the seller's address.
  const german = sampleSettings({ seller: { ...sampleSettings().seller, country: 'DE' } })
  expect(valuesFrom(german).phone_country).toBe('DE')
})

test('the company website is optional, a URL or a bare domain', () => {
  const values = valuesFrom(sampleSettings())
  expect(values.website).toBe('')
  expect(toSettingsInput(values).seller.website).toBeNull()
  expect(toSettingsInput({ ...values, website: ' firma.ch ' }).seller.website).toBe('firma.ch')
  expect(
    valuesFrom(
      sampleSettings({ seller: { ...sampleSettings().seller, website: 'https://firma.ch' } }),
    ).website,
  ).toBe('https://firma.ch')
  for (const ok of ['', 'firma.ch', 'https://www.firma.ch/de', 'http://firma.ch'])
    expect(validate({ ...values, website: ok }).website).toBeUndefined()
  for (const bad of ['firma', 'ftp://firma.ch', 'fir ma.ch'])
    expect(validate({ ...values, website: bad }).website).toBe('Enter a website such as muster.ch.')
})
test('the server’s step errors land on the step', () => {
  expect(formField('dunning.steps.2.fee')).toBe('dunning_steps.2.fee')
  expect(formField('dunning.steps')).toBe('dunning_steps')
})
