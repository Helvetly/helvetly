import { describe, expect, it } from 'vitest'

import { clientFromDocument } from './import-client-field'

describe('clientFromDocument', () => {
  it('starts a new client with what the document carried, and only that', () => {
    expect(
      clientFromDocument({
        client_name: 'Anna Beispiel',
        client_street: 'Bahnhofstrasse',
        client_street_number: '12',
        client_zip: '8001',
        client_city: 'Zürich',
        client_country: 'ch',
        client_is_company: false,
      }),
    ).toEqual({
      name: 'Anna Beispiel',
      street: 'Bahnhofstrasse',
      street_number: '12',
      zip: '8001',
      city: 'Zürich',
      country: 'CH',
      is_company: false,
    })
  })

  it('drops a country that is not a two-letter code', () => {
    expect(clientFromDocument({ client_name: 'X', client_country: 'Switzerland' })).toEqual({
      name: 'X',
      is_company: false,
    })
  })

  it.each([
    ['Anna Beispiel', {}, false],
    ['Muster AG', {}, true],
    ['Alpenglow Studio GmbH', {}, true],
    ['Max Muster', { client_vat_number: 'CHE-123.456.789 MWST' }, true],
  ])('reads %s as a company: %s → %s when the model did not say', (name, extra, company) => {
    expect(clientFromDocument({ client_name: name, ...extra }).is_company).toBe(company)
  })
})
