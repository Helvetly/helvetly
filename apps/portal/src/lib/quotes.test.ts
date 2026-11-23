import { describe, expect, it } from 'vitest'

import { portalDocuments } from '@/mocks/portal'

import { documentTitle } from './quotes'

const doc = portalDocuments[0]!

describe('documentTitle', () => {
  it('names a sent quote by its number and revision', () => {
    expect(documentTitle({ ...doc, quote: { number: 'Q-2026-001', revision: 1 } })).toBe(
      'Quote Q-2026-001',
    )
    expect(documentTitle({ ...doc, quote: { number: 'Q-2026-001', revision: 2 } })).toBe(
      'Quote Q-2026-001 · Rev. 2',
    )
  })

  it('keeps the file name of any other document', () => {
    expect(documentTitle({ ...doc, name: 'Contract.pdf', quote: null })).toBe('Contract.pdf')
  })
})
