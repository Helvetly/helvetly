import { describe, expect, it } from 'vitest'

import { amountInput, normalizeAmount } from './import-edit-drawer'

describe('amountInput', () => {
  it.each([
    ['352.80ssssss', '352.80'],
    ['s2ssss', '2'],
    ["1'234.50", "1'234.50"],
    ['-12,5', '-12,5'],
    ['CHF 100', ' 100'],
  ])('%s → %s', (typed, kept) => expect(amountInput(typed)).toBe(kept))
})

describe('normalizeAmount', () => {
  it.each([
    ['22222', '22222'],
    ["1'234.50", '1234.50'],
    ['1’234,5', '1234.5'],
    ['1.234,56', '1234.56'],
    ['1,234.56', '1234.56'],
    ['1,234', '1234'],
    ['-12,50', '-12.50'],
    ['', null],
    ['12.3.4', null],
  ])('%s → %s', (typed, plain) => expect(normalizeAmount(typed)).toBe(plain))
})
