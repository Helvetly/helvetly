import { describe, expect, it } from 'vitest'

import {
  dayLabel,
  eventSentence,
  foldEvents,
  payloadFacts,
  rowSentence,
  sentenceText,
} from './audit-log'
import type { FinancialEvent } from './books'

const peter = { id: 'usr_1', name: 'Peter Muster' }

const event = (over: Partial<FinancialEvent>): FinancialEvent => ({
  seq: 1,
  kind: 'invoice.issued',
  category: 'invoices',
  subject_type: 'invoice',
  subject_id: 'inv_1',
  subject: { number: '2026/INV/001', party: 'Acme AG', currency: 'CHF' },
  actor: peter,
  at: '2026-11-20T08:47:00Z',
  payload: {},
  prev_hash: '',
  hash: '',
  ...over,
})

const text = (e: FinancialEvent) => sentenceText(eventSentence(e))

describe('eventSentence', () => {
  it.each<[string, Partial<FinancialEvent>, string]>([
    [
      'an issued invoice',
      { payload: { payable_total: '99.00' } },
      'Invoice 2026/INV/001 issued to Acme AG',
    ],
    [
      'an issued credit note',
      { payload: { kind: 'credit_note' } },
      'Credit note 2026/INV/001 issued to Acme AG',
    ],
    [
      'a payment, in the invoice’s currency',
      { kind: 'payment.added', category: 'payments', payload: { amount: '99.00' } },
      'Payment of CHF 99.00 recorded on 2026/INV/001',
    ],
    [
      'a removed payment',
      { kind: 'payment.deleted', category: 'payments', payload: { amount: '10.00' } },
      'Payment of CHF 10.00 removed from 2026/INV/001',
    ],
    [
      'the portal turned off',
      {
        kind: 'workspace.portal_turned_off',
        category: 'portal',
        subject_type: 'workspace',
        subject: null,
      },
      'Client portal turned off',
    ],
    [
      'a new portal address',
      {
        kind: 'workspace.portal_address_changed',
        category: 'portal',
        subject_type: 'workspace',
        subject: null,
        payload: { from: 'old', to: 'new' },
      },
      'Client portal address changed to new',
    ],
    [
      'a portal preview',
      {
        kind: 'portal.preview_started',
        category: 'portal',
        subject_type: 'client',
        subject: null,
        payload: { client_name: 'Acme AG' },
      },
      'Viewed the portal as Acme AG, read-only',
    ],
    [
      'a portal preview ended',
      {
        kind: 'portal.preview_ended',
        category: 'portal',
        subject_type: 'client',
        subject: null,
        payload: { client_name: 'Acme AG' },
      },
      'Ended the portal preview as Acme AG',
    ],
    [
      'a booked expense',
      {
        kind: 'expense.booked',
        category: 'expenses',
        subject_type: 'expense',
        subject: { number: '14', party: 'Papeterie SA', currency: 'EUR' },
      },
      'Expense 14 booked from Papeterie SA',
    ],
    [
      'an approved quote',
      {
        kind: 'approval.approved',
        category: 'approvals',
        subject_type: 'quote',
        subject: { number: 'Q-7', party: 'Acme AG', currency: 'CHF' },
      },
      'Quote Q-7 approved',
    ],
    [
      'a draft without a number',
      {
        kind: 'approval.submitted',
        category: 'approvals',
        subject: { number: null, party: 'Acme AG', currency: 'CHF' },
      },
      'Invoice draft submitted for approval',
    ],
    [
      'a closed month',
      {
        kind: 'period.closed',
        category: 'books',
        subject_type: 'period',
        subject_id: '2026-10',
        subject: null,
        payload: { month: '2026-10' },
      },
      'October 2026 closed',
    ],
    [
      'an instalment plan',
      { kind: 'plan.created', subject_type: 'plan', subject: null, payload: { count: 6 } },
      'Instalment plan of 6 instalments created',
    ],
    [
      'a ZIP of documents',
      {
        kind: 'documents.exported',
        category: 'settings',
        subject_type: 'workspace',
        subject: null,
        payload: { files: 12 },
      },
      '12 documents downloaded as a ZIP',
    ],
    [
      'an HR event',
      { kind: 'employee.archived', category: 'employees', subject_type: 'employee', subject: null },
      'Employee archived',
    ],
    [
      'an unknown kind',
      { kind: 'something.new', category: 'settings', subject: null },
      'Entry recorded',
    ],
  ])('reads %s', (_, over, want) => {
    expect(text(event(over))).toBe(want)
  })

  it('links the record while it exists, and only shows its number when it is gone', () => {
    const [, link] = eventSentence(event({})).parts
    expect(link).toEqual({ label: '2026/INV/001', href: '/invoices?id=inv_1' })
    const gone = eventSentence(event({ subject: null, payload: { number: '2026-009' } }))
    expect(gone.parts[1]).toEqual({ label: '2026-009', href: null })
  })

  it('puts an issued total beside the sentence', () => {
    expect(eventSentence(event({ payload: { payable_total: '99.00' } })).amount).toBe('CHF 99.00')
  })
})

const toggle = (seq: number, minute: number, on: boolean, actor = peter) =>
  event({
    seq,
    kind: on ? 'workspace.portal_turned_on' : 'workspace.portal_turned_off',
    category: 'portal',
    subject_type: 'workspace',
    subject_id: 'wsp_1',
    subject: null,
    actor,
    at: `2026-11-20T09:${String(minute).padStart(2, '0')}:00Z`,
  })

describe('foldEvents', () => {
  it('folds a switch turned off and on by one person into one row', () => {
    const rows = foldEvents([1, 2, 3, 4, 5, 6].map((n) => toggle(n, n * 4, n % 2 === 0)))
    expect(rows).toHaveLength(1)
    expect(sentenceText(rowSentence(rows[0]!))).toBe('Client portal turned off and on 6 times')
  })

  it('keeps apart other people, long pauses and different records or amounts', () => {
    const rows = foldEvents([
      toggle(1, 0, false),
      toggle(2, 1, true, { id: 'usr_2', name: 'Anna' }),
      toggle(3, 2, false),
      event({ seq: 4, kind: 'payment.added', payload: { amount: '1.00', payment_id: 'a' } }),
      event({ seq: 5, kind: 'payment.added', payload: { amount: '1.00', payment_id: 'b' } }),
    ])
    expect(rows.map((row) => row.events.length)).toEqual([1, 1, 1, 1, 1])
    const late = foldEvents([
      toggle(1, 0, false),
      { ...toggle(2, 0, true), at: '2026-11-20T10:31:00Z' },
    ])
    expect(late).toHaveLength(2)
  })

  it('counts repeats of the same change', () => {
    const rows = foldEvents([event({ seq: 1 }), event({ seq: 2 })])
    expect(rowSentence(rows[0]!).times).toBe(2)
  })
})

describe('dayLabel', () => {
  const now = new Date(2026, 10, 22, 10)
  it('names today and yesterday, else the weekday and date', () => {
    expect(dayLabel('2026-11-22', now)).toBe('Today')
    expect(dayLabel('2026-11-21', now)).toBe('Yesterday')
    expect(dayLabel('2026-11-20', now)).toMatch(/Friday.*20.*November.*2026/)
  })
})

describe('payloadFacts', () => {
  it('leaves out internal ids and formats amounts in the right currency', () => {
    const facts = payloadFacts(
      event({
        payload: {
          payment_id: 'pay_1',
          request_id: 'apr_1',
          member_ids: ['usr_1'],
          amount: '5.00',
          base_total: '4.50',
          base_currency: 'EUR',
          reason: 'Wrong client',
        },
      }),
    )
    expect(facts).toEqual([
      { key: 'amount', value: 'CHF 5.00' },
      { key: 'base_total', value: 'EUR 4.50' },
      { key: 'base_currency', value: 'EUR' },
      { key: 'reason', value: 'Wrong client' },
    ])
  })
})
