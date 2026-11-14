import { sampleSettings } from '@/test/invoice-api'

import { toSettingsInput, validate, valuesFrom } from './onboarding-model'

test.each([
  ['registering moves the VAT mode off none', 'none', true, 'exclusive'],
  ['registering keeps a chosen mode', 'inclusive', true, 'inclusive'],
  ['unregistering sets none', 'exclusive', false, 'none'],
] as const)('%s', (_, mode, registered, want) => {
  const settings = sampleSettings({ default_vat_mode: mode, vat_registered: mode !== 'none' })
  const input = toSettingsInput(settings, { ...valuesFrom(settings), vat_registered: registered })
  expect(input.default_vat_mode).toBe(want)
  expect(input.seller.vat_number).toBe(registered ? 'CHE-109.322.551 MWST' : null)
})

test('defaults to Switzerland and sends the IBAN without spaces', () => {
  const settings = sampleSettings({ iban: null })
  settings.seller.country = ''
  const values = { ...valuesFrom(settings), iban: 'ch93 0076 2011 6238 5295 7' }
  expect(values.country).toBe('CH')
  expect(toSettingsInput(settings, values)).toMatchObject({
    iban: 'CH9300762011623852957',
    // Settings the welcome doesn't ask about go back as they were.
    number_format: 'YYYY-NNN',
    qr_bill_enabled: true,
  })
  expect(validate(values)).toEqual({})
  expect(validate({ ...values, iban: 'CH93 0076 2011 6238 5295 8' })).toHaveProperty('iban')
})

test('a seller in a market Helvetly cannot serve yet is refused before saving', () => {
  const values = valuesFrom(sampleSettings())
  for (const country of ['HU', 'PT', 'RO'])
    expect(validate({ ...values, country }).country).toMatch(`seller in ${country}`)
  expect(validate({ ...values, country: 'DE' })).not.toHaveProperty('country')
})
