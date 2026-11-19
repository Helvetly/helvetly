import { describe, expect, it } from 'vitest'

import { formatUid, isEmail, isValidUid, isWebsite } from './client-fields'

describe('client fields', () => {
  it.each([
    ['ana@example.ch', true],
    ['ana@example', false],
    ['ana example.ch', false],
  ])('isEmail(%s) = %s', (value, ok) => expect(isEmail(value)).toBe(ok))

  it.each([
    ['example.ch', true],
    ['https://www.example.ch/about', true],
    ['example', false],
    ['not a site', false],
  ])('isWebsite(%s) = %s', (value, ok) => expect(isWebsite(value)).toBe(ok))

  it('formats and checks a Swiss UID', () => {
    expect(formatUid('che109322551 mwst')).toBe('CHE-109.322.551 MWST')
    expect(isValidUid('CHE-109.322.551 MWST')).toBe(true)
    expect(isValidUid('CHE-109.322.552')).toBe(false)
    expect(formatUid('DE123456789')).toBe('DE123456789')
  })
})
