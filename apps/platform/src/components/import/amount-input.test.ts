import { describe, expect, it } from 'vitest'

import { amountInput } from './import-edit-drawer'

describe('amountInput', () => {
  it.each([
    ['352.80ssssss', '352.80'],
    ['s2ssss', '2'],
    ["1'234.50", "1'234.50"],
    ['-12,5', '-12,5'],
    ['CHF 100', ' 100'],
  ])('%s → %s', (typed, kept) => expect(amountInput(typed)).toBe(kept))
})
