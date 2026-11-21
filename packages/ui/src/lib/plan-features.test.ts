import { describe, expect, it } from 'vitest'

import {
  type OfferCatalogue,
  planAllowance,
  type PlanId,
  planFeatureLines,
  planFootnote,
} from './plan-features'

const cap = (basic: number | null, pro: number | null, business: number | null) => ({
  plans: {
    basic: { included: basic !== 0, value: basic },
    pro: { included: pro !== 0, value: pro },
    business: { included: business !== 0, value: business },
  },
})

const offer: OfferCatalogue = {
  plans: [
    { id: 'basic', name: 'Basic' },
    { id: 'pro', name: 'Pro' },
    { id: 'business', name: 'Business' },
  ],
  comparison: [
    { key: 'swiss_qr', plans: { basic: true, pro: true, business: true } },
    { key: 'revolut', plans: { basic: true, pro: true, business: true } },
    { key: 'client_portal', plans: { basic: false, pro: false, business: true } },
  ],
  max_self_service_seats: { basic: 3, pro: 12, business: null },
  limits: {
    clients: cap(7, 70, null),
    invoices_per_month: cap(9, 9, null),
    storage_bytes: cap(250_000_000, 2_000_000_000, 2_000_000_000),
    emails_per_month: cap(1, 1500, 1500),
    expenses_per_month: cap(0, 40, 40),
  },
}
const features: Record<PlanId, string[]> = {
  basic: [],
  pro: ['expenses', 'ai_import'],
  business: ['expenses', 'ai_import', 'custom_portal_domain'],
}

const text = (lines: { amount?: string; label: string }[]) =>
  lines.map((line) => [line.amount, line.label].filter(Boolean).join(' '))
const [basic, pro, business] = planFeatureLines(offer, (id) => features[id], 'en')

describe('planFeatureLines', () => {
  it('lists the first plan in full, its numbers from the offer', () => {
    expect(basic?.basis).toBeUndefined()
    expect(text(basic?.lines ?? [])).toEqual([
      '3 team members',
      '7 clients',
      '9 invoices / month',
      'Swiss QR bills and Revolut payment links',
      'Books: dashboard, reports and period closing',
      '250 MB document storage',
      '1 email to clients / month',
    ])
  })

  it('gives every other plan only what it adds, then what it raises', () => {
    expect(pro?.basis).toBe('Everything in Basic, plus:')
    expect(text(pro?.lines ?? [])).toEqual([
      '40 expenses / month',
      'AI import: turn PDFs, photos and spreadsheets into invoices, clients and expenses',
      '12 team members',
      '70 clients',
      '2 GB document storage',
      '1’500 emails to clients / month',
    ])
  })

  it('shows unlimited as ∞, read out as Unlimited, and features the comparison does not name', () => {
    expect(business?.basis).toBe('Everything in Pro, plus:')
    expect(text(business?.lines ?? [])).toEqual([
      'Client portal: clients view and pay invoices, accept quotes and download documents',
      'Your portal on your own domain (portal.yourcompany.ch)',
      '∞ team members',
      '∞ clients',
      '∞ invoices / month',
    ])
    expect(business?.lines[2]).toEqual({
      key: 'people',
      amount: '∞',
      spoken: 'Unlimited',
      label: 'team members',
    })
  })

  it('gives an allowance the same way the lines and the comparison table show it', () => {
    expect(planAllowance(offer, 'clients', 'pro', 'en')).toEqual({ amount: '70', value: 70 })
    expect(planAllowance(offer, 'clients', 'business', 'en')).toEqual({
      amount: '∞',
      spoken: 'Unlimited',
      value: null,
    })
    expect(planAllowance(offer, 'storage_bytes', 'pro', 'en')?.amount).toBe('2 GB')
    expect(planAllowance(offer, 'expenses_per_month', 'basic', 'en')).toBeUndefined()
    expect(planAllowance(offer, 'quotes_per_month', 'basic', 'en')).toBeUndefined()
  })

  it('words the lines in the asked language', () => {
    const [, , german] = planFeatureLines(offer, (id) => features[id], 'de')
    expect(german?.basis).toBe('Alles aus Pro, dazu:')
    expect(german?.lines[2]).toMatchObject({
      amount: '∞',
      spoken: 'Unbegrenzt',
      label: 'Teammitglieder',
    })
    expect(planFootnote('de')).toContain('Teammitglied')
  })
})
