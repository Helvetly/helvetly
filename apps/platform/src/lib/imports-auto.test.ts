import { expect, test } from 'vitest'

import { goesToImport } from '@/lib/heidi'
import { foundSummary, isImportBatch, recordsByKind, type ImportRecord } from '@/lib/imports'

const record = (id: string, kind: ImportRecord['kind']): ImportRecord => ({
  id,
  file_id: 'imf_1',
  kind,
  status: 'pending',
  data: {},
  issues: {},
  duplicate: null,
  entity_id: null,
  error: null,
})

test('groups an auto import by kind, clients first, and sums it up', () => {
  const records = [
    record('i1', 'invoices'),
    record('c1', 'clients'),
    record('e1', 'engagements'),
    record('i2', 'invoices'),
  ]
  expect(recordsByKind(records).map((group) => [group.kind, group.records.length])).toEqual([
    ['clients', 1],
    ['invoices', 2],
    ['engagements', 1],
  ])
  expect(foundSummary(records)).toBe('1 client, 2 invoices and 1 engagement')
  expect(foundSummary([record('x', 'expenses')])).toBe('1 expense')
  expect(foundSummary([])).toBe('')
})

test('accepts an auto batch with recognised files and refuses an unknown record kind', () => {
  const batch = {
    id: 'imp_1',
    kind: 'auto',
    status: 'review',
    created_at: '2026-11-15T10:00:00Z',
    files: [
      {
        id: 'imf_1',
        name: 'a.pdf',
        size: 1,
        status: 'done',
        error: null,
        chunks_done: 1,
        chunks_total: 1,
        reused: false,
        document_type: 'sales_invoice',
      },
    ],
    records: [record('c1', 'clients')],
  }
  expect(isImportBatch(batch)).toBe(true)
  expect(
    isImportBatch({ ...batch, records: [{ ...record('c1', 'clients'), kind: 'timesheets' }] }),
  ).toBe(false)
  expect(
    isImportBatch({ ...batch, files: [{ ...batch.files[0], document_type: 'love_letter' }] }),
  ).toBe(false)
})

test('sends chat files to an import when asked, or when only an import can read them', () => {
  const pdf = new File(['x'], 'invoice.pdf', { type: 'application/pdf' })
  const zip = new File(['x'], 'invoices.zip', { type: 'application/zip' })
  expect(goesToImport('What is due on this?', [pdf])).toBe(false)
  expect(goesToImport('Zaimportuj te faktury', [pdf])).toBe(true)
  expect(goesToImport('Import these', [pdf])).toBe(true)
  expect(goesToImport('Here you go', [zip])).toBe(true)
  expect(
    goesToImport(
      'Here you go',
      Array.from({ length: 5 }, () => pdf),
    ),
  ).toBe(true)
  expect(goesToImport('Import this', [])).toBe(false)
})
