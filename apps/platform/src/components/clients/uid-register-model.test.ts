import { describe, expect, it } from 'vitest'

import type { RegisterCompany } from '@/lib/uid-register'

import { emptyValues } from './client-form-model'
import {
  registerApplies,
  registerCheck,
  registerFill,
  replacedFields,
  uidToCheck,
} from './uid-register-model'

const swisscom: RegisterCompany = {
  uid: 'CHE-102.753.938',
  name: 'Swisscom AG',
  street: 'Alte Tiefenaustrasse',
  house_number: '6',
  zip: '3050',
  city: 'Bern',
  active: true,
  vat: true,
}

describe('registerApplies', () => {
  it.each([
    [true, 'CH', true],
    [false, 'CH', false],
    [true, 'DE', false],
  ])('company %s in %s: %s', (is_company, country, want) => {
    expect(registerApplies({ is_company, country })).toBe(want)
  })
})

describe('registerFill', () => {
  it('fills name, address, UID and VAT number', () => {
    expect(registerFill({ ...emptyValues(), name: 'swissc' }, swisscom)).toEqual({
      name: 'Swisscom AG',
      street: 'Alte Tiefenaustrasse',
      street_number: '6',
      zip: '3050',
      city: 'Bern',
      registration_number: 'CHE-102.753.938',
      vat_number: 'CHE-102.753.938 MWST',
    })
  })

  it('leaves the VAT number of a company without VAT, and what already matches', () => {
    const fill = registerFill(
      { ...emptyValues(), city: 'Bern', vat_number: 'CHE-102.753.938' },
      { ...swisscom, vat: false, street: undefined },
    )
    expect(fill).not.toHaveProperty('vat_number')
    expect(fill).not.toHaveProperty('city')
    expect(fill).not.toHaveProperty('street')
  })

  it('names the typed fields it replaces, not the name it searched with', () => {
    const values = { ...emptyValues(), name: 'Swiss', street: 'Bahnhofstrasse', zip: '' }
    expect(replacedFields(values, registerFill(values, swisscom))).toEqual(['street'])
  })
})

describe('uidToCheck', () => {
  it.each([
    ['CHE-102.753.938 MWST', 'CHE-102.753.938'],
    ['che102753938', 'CHE-102.753.938'],
    ['CHE-102.753.939', null],
    ['DE123456789', null],
    ['', null],
  ])('%s → %s', (vat, want) => {
    expect(uidToCheck(vat)).toBe(want)
  })
})

const answer = (company: RegisterCompany | null) => ({ loading: false, failed: false, company })

describe('registerCheck', () => {
  it.each([
    ['CHE-102.753.938 MWST', answer(swisscom), 'ok', 'active and VAT-registered'],
    ['CHE-102.753.938', answer({ ...swisscom, vat: false }), 'ok', 'not VAT-registered'],
    ['CHE-102.753.938 MWST', answer({ ...swisscom, vat: false }), 'warn', 'remove MWST'],
    ['CHE-102.753.938', answer({ ...swisscom, active: false }), 'warn', 'no longer active'],
    ['CHE-102.753.938', answer(null), 'warn', 'Not found'],
    [
      'CHE-102.753.938',
      { loading: false, failed: true, company: undefined },
      'muted',
      "can't be reached",
    ],
    ['CHE-102.753.938', { loading: true, failed: false, company: undefined }, 'muted', 'Checking'],
  ] as const)('%s', (vat, given, tone, text) => {
    const check = registerCheck(vat, given)
    expect(check.tone).toBe(tone)
    expect(check.text).toContain(text)
  })
})
