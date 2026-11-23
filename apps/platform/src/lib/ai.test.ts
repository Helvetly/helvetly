import { describe, expect, it } from 'vitest'

import { billingFixture } from '@/components/billing/billing-fixture'
import { aiState, planWithMoreAI } from '@/lib/ai'
import type { UsageItem } from '@/lib/billing'

const item = (limit: string, used: number | null, max: number | null): UsageItem => ({
  limit,
  used,
  max,
})

describe('aiState', () => {
  it('hides AI when the installation has none', () => {
    const state = aiState(
      { google: true, email: true, passkey: true, dev_codes: false, ai_available: false },
      undefined,
      [item('ai_automation_tokens_per_month', 10, 10)],
      'automation',
    )
    expect(state).toEqual({ available: false, consented: false, poolLeft: 0, usedUp: false })
  })

  it('shows AI while the config is unknown or from an older API', () => {
    expect(aiState(undefined, undefined, undefined, 'heidi').available).toBe(true)
  })

  it('reads the approval and the pool it is asked for', () => {
    const consent = {
      granted: true,
      version: '1',
      current_version: '1',
      changed_at: null,
      changed_by: '',
    }
    const usage = {
      period: '2026-11',
      tokens_used: 0,
      tokens_included: null,
      tokens_purchased: 0,
      tokens_remaining: null,
      consent,
    }
    const items = [
      item('ai_tokens_per_month', 40, 100),
      item('ai_automation_tokens_per_month', 120, 100),
    ]
    expect(aiState(undefined, usage, items, 'heidi')).toEqual({
      available: true,
      consented: true,
      poolLeft: 60,
      usedUp: false,
    })
    expect(aiState(undefined, usage, items, 'automation')).toMatchObject({
      poolLeft: 0,
      usedUp: true,
    })
    expect(
      aiState(undefined, usage, [item('ai_tokens_per_month', 5, null)], 'heidi').poolLeft,
    ).toBeNull()
  })
})

describe('planWithMoreAI', () => {
  it('names the next plan up with more of the pool', () => {
    expect(planWithMoreAI(billingFixture({ plan: '' }), 'heidi')).toBe('pro')
    expect(planWithMoreAI(billingFixture({ plan: 'basic' }), 'automation')).toBe('pro')
    expect(planWithMoreAI(billingFixture({ plan: 'pro' }), 'heidi')).toBe('business')
    expect(planWithMoreAI(billingFixture({ plan: 'business' }), 'heidi')).toBeNull()
  })
})
