import { listItem, sampleInvoice } from '@/test/invoice-api'

import { availableCommands } from './invoice-commands'

test.each(['invoice', 'partial', 'prepayment', 'debit_note', 'corrected'] as const)(
  '%s exposes the API-supported credit and refund actions',
  (kind) => {
    const issued = listItem(sampleInvoice({ kind, status: 'paid', refund_due: '15.00' }))
    expect(availableCommands(issued, true).credit_note).toBe(true)
    expect(availableCommands(issued, true).refund).toBe(true)
    expect(availableCommands({ ...issued, status: 'draft' }, true).credit_note).toBe(false)
  },
)

test.each(['invoice', 'partial', 'prepayment', 'proforma', 'self_billed'] as const)(
  '%s can be duplicated as the same document type',
  (kind) => {
    const invoice = listItem(sampleInvoice({ kind }))
    expect(availableCommands(invoice, true).duplicate).toBe(true)
  },
)

test.each(['credit_note', 'proforma', 'self_billed'] as const)(
  '%s cannot offer receivable-only credit or refund actions',
  (kind) => {
    const invoice = listItem(sampleInvoice({ kind, status: 'paid', refund_due: '15.00' }))
    expect(availableCommands(invoice, true).credit_note).toBe(false)
    expect(availableCommands(invoice, true).refund).toBe(false)
  },
)
