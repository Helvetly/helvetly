import { describe, expect, it } from 'vitest'

import type { HeidiUsage } from '@/lib/heidi'

import { shouldWarn, tokenShare } from './token-warning'

const usage = (over: Partial<HeidiUsage>): HeidiUsage => ({
  period: '2026-11',
  tokens_used: 0,
  tokens_included: 1000,
  tokens_purchased: 0,
  tokens_remaining: 1000,
  mode: 'openai',
  ...over,
})

describe('token warning', () => {
  it.each([
    [749, false],
    [750, true],
    [999, true],
    [1200, true],
  ])('%i of 1000 tokens used: warns %s', (used, warns) => {
    expect(shouldWarn(tokenShare(usage({ tokens_used: used })))).toBe(warns)
  })

  it('counts bought tokens into the allowance', () => {
    expect(tokenShare(usage({ tokens_used: 750, tokens_purchased: 1000 }))).toBe(37)
  })

  it.each<[string, Partial<HeidiUsage> | undefined]>([
    ['still loading', undefined],
    ['local answers only', { mode: 'local', tokens_used: 900 }],
    ['usage not reconciled', { usage_uncertain: true, tokens_used: 900 }],
    ['no plan cap', { tokens_included: null, tokens_used: 900 }],
    ['no allowance at all', { tokens_included: 0, tokens_used: 900 }],
  ])('no share when %s', (_, over) => {
    expect(tokenShare(over && usage(over))).toBeNull()
  })
})
