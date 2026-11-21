import { describe, expect, it } from 'vitest'

import type { ApprovalRule } from '@/lib/approvals'

import { nextSource, policyProblems } from './approvals-settings'

const noRules: ApprovalRule[] = []
const off = { enabled: false, min_total: '', rules: noRules }
const drafts = (invoice: Partial<typeof off>) => ({
  invoice: { ...off, ...invoice },
  credit_note: off,
  debit_note: off,
  corrected: off,
  quote: off,
  expense: off,
})

describe('policyProblems', () => {
  it('leaves a switched-off policy alone, whatever it holds', () => {
    expect(policyProblems(drafts({ enabled: false, min_total: 'abc' }))).toEqual({})
  })

  it('asks for a rule, whole counts of at least one and a positive threshold', () => {
    expect(policyProblems(drafts({ enabled: true }))).toEqual({
      'invoice.rules': 'Add at least one rule.',
    })
    expect(
      policyProblems(
        drafts({
          enabled: true,
          min_total: '0',
          rules: [
            { group_id: null, min: 0 },
            { group_id: 'acc', min: 1.5 },
          ],
        }),
      ),
    ).toEqual({
      'invoice.rules.0.min': 'Ask for at least 1 approval.',
      'invoice.rules.1.min': 'Ask for at least 1 approval.',
      'invoice.min_total': 'Enter an amount above 0, e.g. 1000.',
    })
  })

  it('takes a threshold as people type it', () => {
    for (const min_total of ["1'000.00", '1000', '250,50', ''])
      expect(
        policyProblems(drafts({ enabled: true, min_total, rules: [{ group_id: null, min: 1 }] })),
      ).toEqual({})
  })
})

describe('nextSource', () => {
  const groups = [
    { id: 'acc', name: 'Accountants', member_ids: [] },
    { id: 'mgmt', name: 'Management', member_ids: [] },
  ]
  it('offers each group once, then anyone, then nothing', () => {
    expect(nextSource([], groups)).toBe('acc')
    expect(nextSource([{ group_id: 'acc', min: 1 }], groups)).toBe('mgmt')
    expect(
      nextSource(
        [
          { group_id: 'acc', min: 1 },
          { group_id: 'mgmt', min: 1 },
        ],
        groups,
      ),
    ).toBeNull()
    expect(
      nextSource(
        [
          { group_id: 'acc', min: 1 },
          { group_id: 'mgmt', min: 1 },
          { group_id: null, min: 1 },
        ],
        groups,
      ),
    ).toBeUndefined()
  })
})
