import { ApiError } from '@helvetly/ui/lib/http'
import { describe, expect, it } from 'vitest'

import { domainOf, proofOf } from './portal-domain'

describe('domainOf', () => {
  it.each([
    ['portal.firma.ch', 'portal.firma.ch'],
    ['  Portal.Firma.CH  ', 'portal.firma.ch'],
    ['https://portal.firma.ch/login?x=1', 'portal.firma.ch'],
    ['http://portal.firma.ch:8443/', 'portal.firma.ch'],
    ['portal.firma.ch.', 'portal.firma.ch'],
    ['portal.firma.ch#top', 'portal.firma.ch'],
  ])('%s → %s', (input, want) => expect(domainOf(input)).toBe(want))
})

describe('proofOf', () => {
  const verify = { type: 'TXT', name: '_helvetly-verify.portal.firma.ch', value: 'helvetly-abc' }
  it.each([
    ['taken with a record', new ApiError(409, 'domain_taken', 'x', { verify }), verify],
    ['taken without', new ApiError(409, 'domain_taken', 'x'), undefined],
    [
      'malformed record',
      new ApiError(409, 'domain_taken', 'x', { verify: { type: 'TXT' } }),
      undefined,
    ],
    ['another code', new ApiError(409, 'domain_exists', 'x', { verify }), undefined],
    ['not an API error', new Error('x'), undefined],
  ])('%s', (_, failure, want) => expect(proofOf(failure)).toEqual(want))
})
