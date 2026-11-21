import { ApiError } from '@helvetly/ui/lib/http'
import { describe, expect, it } from 'vitest'

import { domainNotice, domainOf, proofOf } from './portal-domain'

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

describe('domainNotice', () => {
  it.each([
    ['dns', null, 'warning', 'Waiting for your DNS records'],
    ['dns', 'dns', 'warning', 'DNS records not found yet'],
    ['dns', 'verification', 'warning', 'Ownership record not found yet'],
    ['certificate', 'certificate', 'warning', 'Certificate is being issued'],
    ['problem', 'dns', 'danger', 'DNS records not found yet'],
    ['problem', 'blocked', 'danger', 'Domain blocked'],
    ['problem', 'taken', 'danger', 'Domain connected elsewhere'],
    ['problem', 'plan', 'warning', 'Your plan does not include your own domain'],
  ] as const)('%s / %s is %s: %s', (stage, problem, tone, title) =>
    expect(domainNotice({ stage, problem })).toMatchObject({ tone, title }),
  )
  it('has nothing to say about an active domain', () =>
    expect(domainNotice({ stage: 'active', problem: null })).toBeNull())
})
