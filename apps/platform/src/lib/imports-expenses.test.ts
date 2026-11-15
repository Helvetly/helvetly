import { isHeic, RECEIPT_ACCEPT } from './expenses'
import {
  IMPORT_KINDS,
  importKindByLabel,
  isImportBatch,
  isImportKind,
  recordChanges,
  type ImportBatch,
} from './imports'

const expenses = IMPORT_KINDS.expenses

const batch: ImportBatch = {
  id: 'imp_1',
  kind: 'expenses',
  status: 'review',
  created_at: '2026-11-09T10:00:00Z',
  files: [],
  records: [
    {
      id: 'imr_1',
      file_id: 'imf_1',
      kind: 'expenses',
      status: 'pending',
      data: { supplier_name: 'Migros', amount: '108.10', vat_rate: '8.1', reverse_charge: false },
      issues: {},
      duplicate: { id: 'exp_1', label: 'Expense 4 · Migros', reason: 'same date and total' },
      entity_id: null,
      error: null,
    },
  ],
}

test('expenses is a kind Heidi can offer, opening on the expenses page', () => {
  expect(isImportKind('expenses')).toBe(true)
  expect(importKindByLabel('Expenses')).toBe('expenses')
  expect(expenses.path).toBe('/expenses')
  expect(expenses.entityHref('exp_1 2')).toBe('/expenses?id=exp_1%202')
  expect(expenses.listKey).toEqual(['expenses'])
})

test('every shown and editable expense field has a label', () => {
  for (const field of [...expenses.columns, ...expenses.editable])
    expect(expenses.fields).toHaveProperty(field)
})

test('an expenses batch from the contract passes the guard', () => {
  expect(isImportBatch(batch)).toBe(true)
})

test('the review shows reverse charge as Yes or No and sends only a change', () => {
  const data = { amount: '108.10', reverse_charge: false }
  expect(recordChanges(data, { amount: '108.10', reverse_charge: 'No' })).toEqual({})
  expect(recordChanges(data, { amount: ' 108.15 ', reverse_charge: 'Yes' })).toEqual({
    amount: '108.15',
    reverse_charge: 'Yes',
  })
})

test('reviews name a receipt by its supplier', () => {
  expect(expenses.labelKey).toBe('supplier_name')
})

test('HEIC photos stay out of the AI import but remain manual receipts', () => {
  expect(isHeic(new File([''], 'IMG_0042.HEIC'))).toBe(true)
  expect(isHeic(new File([''], 'scan', { type: 'image/heif' }))).toBe(true)
  expect(isHeic(new File([''], 'migros.jpg', { type: 'image/jpeg' }))).toBe(false)
  expect(RECEIPT_ACCEPT).toContain('.heic')
})
