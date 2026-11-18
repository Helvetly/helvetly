import { describe, expect, it } from 'vitest'

import { legalFormOptions, suggestLegalForm, type LegalForms } from '@/lib/legal-forms'

const forms: LegalForms = {
  CH: [
    { code: 'sole', group: 'sole', name: 'Einzelunternehmen' },
    { code: 'gmbh', group: 'company', name: 'GmbH', suffixes: ['GmbH', 'Sàrl'] },
    { code: 'ag', group: 'company', name: 'AG', names: { fr: 'SA' }, suffixes: ['AG', 'SA'] },
  ],
  DE: [
    { code: 'kg', group: 'partnership', name: 'KG', suffixes: ['KG'] },
    {
      code: 'gmbh_co_kg',
      group: 'partnership',
      name: 'GmbH & Co. KG',
      suffixes: ['GmbH & Co. KG'],
    },
    { code: 'gmbh', group: 'company', name: 'GmbH', suffixes: ['GmbH'] },
  ],
  PL: [{ code: 'spzoo', group: 'company', name: 'sp. z o.o.', suffixes: ['sp. z o.o.'] }],
}

describe('suggestLegalForm', () => {
  it.each([
    ['CH', 'Muster GmbH', 'gmbh'],
    ['CH', 'Muster Sàrl', 'gmbh'],
    ['CH', 'Muster AG', 'ag'],
    ['CH', 'muster ag.', 'ag'],
    ['CH', 'Bag Shop', null],
    ['CH', 'Bag', null],
    ['CH', 'Anna Muster', null],
    ['DE', 'Muster GmbH & Co. KG', 'gmbh_co_kg'],
    ['DE', 'Muster KG', 'kg'],
    ['PL', 'Kowalski Sp. z o. o.', 'spzoo'],
    ['PL', 'Kowalski sp.z o.o.', 'spzoo'],
    ['US', 'Acme GmbH', null],
  ])('%s "%s" → %s', (country, name, code) => {
    expect(suggestLegalForm(forms, country, name)).toBe(code)
  })
})

describe('legalFormOptions', () => {
  it('lists the country forms with their group, and none for a country without a list', () => {
    expect(legalFormOptions(forms, 'CH').map((option) => option.value)).toEqual([
      'sole',
      'gmbh',
      'ag',
    ])
    expect(legalFormOptions(forms, 'CH').every((option) => option.group)).toBe(true)
    expect(legalFormOptions(forms, 'US')).toEqual([])
    expect(legalFormOptions(undefined, 'CH')).toEqual([])
  })
})
