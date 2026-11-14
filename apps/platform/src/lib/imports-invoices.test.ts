import {
  displayValue,
  IMPORT_KINDS,
  importKindByLabel,
  isImportBatch,
  type ImportRecord,
} from './imports'

const record = (data: unknown): unknown => ({
  id: 'imr_1',
  file_id: 'imf_1',
  status: 'pending',
  data,
  issues: { client_id: 'No client matches. Import the client first or pick one.' },
  duplicate: null,
  entity_id: null,
  error: null,
})
const batch = (data: unknown) => ({
  id: 'imp_1',
  kind: 'invoices',
  status: 'review',
  created_at: '2026-11-09T10:00:00Z',
  files: [],
  records: [record(data)],
})

describe('the invoices import kind', () => {
  const config = IMPORT_KINDS.invoices

  it('is offered by its label and opens on the invoices page', () => {
    expect(importKindByLabel('Invoices')).toBe('invoices')
    expect(config.path).toBe('/invoices')
    expect(config.entityHref('inv_1')).toBe('/invoices?id=inv_1')
  })

  it('labels every column and editable field, and picks the client instead of typing an id', () => {
    for (const field of [...config.columns, ...config.editable])
      expect(config.fields).toHaveProperty(field)
    expect(config.pickClient).toBe(true)
    expect(config.editable).toContain('client_id')
    expect(config.editable).not.toContain('lines')
  })

  it('reads an invoice with its lines, and refuses lines that are not flat objects', () => {
    const line = { description: 'Beratung', quantity: '8', unit_price: '125.00' }
    expect(isImportBatch(batch({ number: 'RE-1', total: '1081.00', lines: [line] }))).toBe(true)
    expect(isImportBatch(batch({ lines: [{ description: { nested: true } }] }))).toBe(false)
    expect(isImportBatch(batch({ lines: ['8 hours'] }))).toBe(false)
    expect(isImportBatch(batch({ lines: [{ vat_rate: null }] }))).toBe(false)
  })

  it('shows lines as a count', () => {
    const lines: ImportRecord['data'][string] = [{ description: 'a' }, { description: 'b' }]
    expect(displayValue(lines)).toBe('2 lines')
    expect(displayValue([{ description: 'a' }])).toBe('1 line')
  })
})
