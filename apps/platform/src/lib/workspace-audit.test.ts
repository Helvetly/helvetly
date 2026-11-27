import { describe, expect, it } from 'vitest'

import {
  auditQuery,
  auditTally,
  evidenceHref,
  findingGroups,
  findingValues,
  type AuditFinding,
} from './workspace-audit'

const finding = (
  severity: AuditFinding['severity'],
  category: AuditFinding['category'],
  code: string,
): AuditFinding => ({ id: code, class: 'error', severity, category, code, evidence: [] })
describe('workspace audit', () => {
  it('groups recurring problems by severity, area and check and keeps critical findings first', () => {
    const all = [
      finding('low', 'clients', 'same_name'),
      finding('high', 'invoices', 'original_total'),
      finding('critical', 'documents', 'file_integrity'),
      finding('high', 'invoices', 'original_total'),
      finding('high', 'quotes', 'original_total'),
    ]
    expect(findingGroups(all, '', '').map(([k, rows]) => [k, rows.length])).toEqual([
      ['critical/documents/file_integrity', 1],
      ['high/invoices/original_total', 2],
      ['high/quotes/original_total', 1],
      ['low/clients/same_name', 1],
    ])
    expect(findingGroups(all, 'invoices', 'low')).toEqual([])
    expect(findingGroups(all, 'quotes', 'high')).toHaveLength(1)
  })
  it('uses the document drawer route and encodes the evidence id', () => {
    expect(evidenceHref({ kind: 'document', id: 'doc_1&x=2', label: 'Bank statement' })).toBe(
      '/documents?file=doc_1%26x%3D2',
    )
  })
  it('asks for the chosen areas only, and for everything when none is chosen', () => {
    expect(auditQuery([])).toBe('?lang=en')
    expect(auditQuery(['invoices', 'payments'])).toBe('?lang=en&areas=invoices,payments')
  })
  it('labels compared values, formats dates and words a count of unreferenced credits', () => {
    const base = finding('high', 'payments', 'original_total')
    expect(findingValues({ ...base, values: ['CHF 800.00', 'CHF 880.00'] })).toEqual([
      { label: 'Original', value: 'CHF 800.00' },
      { label: 'Record', value: 'CHF 880.00' },
    ])
    expect(
      findingValues({ ...base, code: 'payment_unmatched', values: ['CHF 10.00', '2026-03-04'] }),
    ).toEqual([
      { label: undefined, value: 'CHF 10.00' },
      { label: undefined, value: '4 Mar 2026' },
    ])
    expect(findingValues({ ...base, code: 'unreferenced_transfer', values: ['1'] })).toEqual([
      { value: '1 bank credit without a reference' },
    ])
    expect(findingValues({ ...base, code: 'unreferenced_transfer', values: ['3'] })).toEqual([
      { value: '3 bank credits without a reference' },
    ])
  })
  it('counts findings per severity and area', () => {
    expect(
      auditTally([
        finding('high', 'invoices', 'a'),
        finding('high', 'payments', 'b'),
        finding('low', 'invoices', 'c'),
      ]),
    ).toEqual({ severity: { high: 2, low: 1 }, area: { invoices: 2, payments: 1 } })
  })
})
