import { describe, expect, it } from 'vitest'

import { ApiError } from './api'
import { isApprovalRequired, ruleSummary } from './approvals'

const names: Record<string, string> = { acc: 'Accountants', mgmt: 'Management' }
const groupName = (id: string) => names[id]

describe('ruleSummary', () => {
  it.each([
    [[], ''],
    [[{ group_id: null, min: 1 }], '1 person who can see invoices must approve.'],
    [[{ group_id: 'acc', min: 1 }], '1 person from Accountants must approve.'],
    [
      [
        { group_id: 'acc', min: 2 },
        { group_id: 'mgmt', min: 1 },
      ],
      '2 people from Accountants and 1 from Management must approve.',
    ],
    // Later rules count other people: one person fills one slot.
    [
      [
        { group_id: 'acc', min: 1 },
        { group_id: null, min: 2 },
      ],
      '1 person from Accountants and 2 more people must approve.',
    ],
    [
      [
        { group_id: 'acc', min: 1 },
        { group_id: 'mgmt', min: 1 },
        { group_id: null, min: 1 },
      ],
      '1 person from Accountants, 1 from Management and 1 more person must approve.',
    ],
    [[{ group_id: 'gone', min: 1 }], '1 person from a deleted group must approve.'],
  ])('%j reads "%s"', (rules, sentence) => {
    expect(ruleSummary(rules, groupName)).toBe(sentence)
  })
})

const conflict = (code: string) => new ApiError(409, code, 'x', {})

describe('isApprovalRequired', () => {
  it('is the issue call’s 409 approval_required only', () => {
    expect(isApprovalRequired(conflict('approval_required'))).toBe(true)
    expect(isApprovalRequired(conflict('invalid_state'))).toBe(false)
    expect(isApprovalRequired(new Error('approval_required'))).toBe(false)
  })
})
