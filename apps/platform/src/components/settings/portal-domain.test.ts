import { describe, expect, it } from 'vitest'

import { domainOf } from './portal-domain'

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
