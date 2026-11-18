import { describe, expect, it } from 'vitest'

import { countryOutsideSwissRules } from './swiss-scope-notice'

describe('countryOutsideSwissRules', () => {
  it.each([
    ['CH', null],
    ['LI', null],
    [undefined, null], // an older API without the country: no notice rather than a wrong one
    ['', null],
    ['DE', 'DE'],
    ['FR', 'FR'],
    ['PL', 'PL'],
  ])('%s → %s', (country, expected) => {
    expect(countryOutsideSwissRules(country)).toBe(expected)
  })
})
