import { describe, expect, it } from 'vitest'

import { proposalFacts } from './proposal-facts'

describe('proposalFacts', () => {
  it('reads the kind, client and year of a client path', () => {
    expect(
      proposalFacts({
        folder: 'Clients/Kunde AG/Documents/2026/Bank Statements',
        tags: ['bank-statement', 'kunde'],
      }),
    ).toEqual({ kind: 'Bank statement', client: 'Kunde AG', year: '2026' })
  })

  it('has no client outside Clients and no kind for a free tag', () => {
    expect(proposalFacts({ folder: 'Tax Documents/2025', tags: ['tax-document'] })).toMatchObject({
      client: null,
      year: '2025',
    })
    expect(proposalFacts({ folder: 'Insurance', tags: ['insurance'] })).toEqual({
      kind: null,
      client: null,
      year: null,
    })
  })
})
