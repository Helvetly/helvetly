import { describe, expect, it } from 'vitest'

import { evidenceHref, findingGroups, type AuditFinding } from './workspace-audit'

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
})
