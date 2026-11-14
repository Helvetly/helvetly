import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import {
  nextStack,
  parseRecordHref,
  recordPageHref,
  RecordDrawersContext,
  RecordLink,
  type RecordRef,
} from './record-link'

describe('parseRecordHref', () => {
  it.each([
    ['/invoices?id=inv_1', { kind: 'invoice', id: 'inv_1' }],
    ['/clients/?id=cli_1', { kind: 'client', id: 'cli_1' }],
    ['/engagements?id=eng%201', { kind: 'engagement', id: 'eng 1' }],
    ['/invoices?id=inv_1&refund=1', null],
    ['/invoices?client=cli_1', null],
    ['/expenses?id=exp_1', { kind: 'expense', id: 'exp_1' }],
    ['/documents?file=doc_1', { kind: 'document', id: 'doc_1' }],
    ['/documents?view=signatures&request=sig_1', { kind: 'signature', id: 'sig_1' }],
    ['/documents?request=sig_1', null],
    ['/documents?view=trash&request=sig_1', null],
    ['/documents?folder=f_1', null],
    ['/members', null],
    ['/notifications', null],
  ])('%s', (href, record) => {
    expect(parseRecordHref(href)).toEqual(record)
  })
})

describe('recordPageHref', () => {
  it.each([
    [{ kind: 'invoice', id: 'inv_1' }, '/invoices?id=inv_1'],
    [{ kind: 'document', id: 'doc 1' }, '/documents?file=doc+1'],
    [{ kind: 'signature', id: 'sig_1' }, '/documents?view=signatures&request=sig_1'],
  ] as const)('%j → %s', (record, href) => {
    expect(recordPageHref(record)).toBe(href)
    expect(parseRecordHref(href)).toEqual(record)
  })
})

describe('nextStack', () => {
  const invoice = { kind: 'invoice', id: 'inv_1' } as const
  const client = { kind: 'client', id: 'cli_1' } as const

  it('puts a new record on top', () => {
    expect(nextStack([client], invoice, '/dashboard')).toEqual([client, invoice])
  })
  it('brings a record already open back to the top, closing those above it', () => {
    expect(nextStack([client, invoice], client, '/dashboard')).toEqual([client])
  })
  it("uncovers the page's own drawer for the record instead of opening it twice", () => {
    expect(nextStack([invoice], client, '/clients?status=active&id=cli_1')).toEqual([])
    const signature = { kind: 'signature', id: 'sig_1' } as const
    expect(nextStack([], signature, '/documents?view=signatures&request=sig_1')).toEqual([])
    expect(nextStack([], signature, '/documents?file=sig_1')).toEqual([signature])
  })
})

describe('RecordLink', () => {
  it('opens a record in place, and leaves other links and new-tab clicks alone', async () => {
    const open = vi.fn<(record: RecordRef) => void>()
    render(
      <RecordDrawersContext.Provider value={open}>
        <RecordLink href="/invoices?id=inv_1">Invoice</RecordLink>
        <RecordLink href="/invoices?client=cli_1">All invoices</RecordLink>
      </RecordDrawersContext.Provider>,
    )
    await userEvent.click(screen.getByText('Invoice'))
    expect(open).toHaveBeenCalledWith({ kind: 'invoice', id: 'inv_1' })
    open.mockClear()
    await userEvent.click(screen.getByText('All invoices'))
    const user = userEvent.setup()
    await user.keyboard('{Meta>}')
    await user.click(screen.getByText('Invoice'))
    expect(open).not.toHaveBeenCalled()
  })
})
