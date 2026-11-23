import { describe, expect, it } from 'vitest'

import { addressHeadline, addressPlace, mapsHref, type Address } from './addresses'

const zurich: Address = {
  label: 'Bahnhofstrasse 1, 8001 Zürich',
  street: 'Bahnhofstrasse',
  house_number: '1',
  postcode: '8001',
  city: 'Zürich',
  country: 'CH',
  lat: 47.37,
  lon: 8.54,
}
const kochel: Address = {
  label: 'Seehof, 82431 Kochel, Germany',
  street: 'Seehof',
  postcode: '82431',
  city: 'Kochel',
  country: 'DE',
  lat: 48,
  lon: 11,
}

describe('address lines', () => {
  it.each([
    [zurich, 'CH', 'Bahnhofstrasse 1', '8001 Zürich'],
    [kochel, 'CH', 'Seehof', '82431 Kochel · DE'],
    [kochel, 'DE', 'Seehof', '82431 Kochel'],
    [
      { label: '8001 Zürich', postcode: '8001', city: 'Zürich', lat: 0, lon: 0 },
      'CH',
      '8001 Zürich',
      '8001 Zürich',
    ],
    [{ label: 'Bern', lat: 0, lon: 0 }, 'CH', 'Bern', ''],
  ])('%o in %s', (address, country, headline, place) => {
    expect(addressHeadline(address)).toBe(headline)
    expect(addressPlace(address, country)).toBe(place)
  })
})

describe('mapsHref', () => {
  it('searches OpenStreetMap for the text as typed', () => {
    expect(mapsHref(' Rue de l’Hôpital 12, 2000 Neuchâtel ')).toBe(
      'https://www.openstreetmap.org/search?query=Rue%20de%20l%E2%80%99H%C3%B4pital%2012%2C%202000%20Neuch%C3%A2tel',
    )
  })
})
