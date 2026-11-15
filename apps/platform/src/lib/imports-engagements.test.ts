import { IMPORT_KINDS, importKindByLabel, isImportBatch, recordChanges } from './imports'

describe('the engagements import kind', () => {
  const config = IMPORT_KINDS.engagements

  it('is offered by its label and opens on the engagements page', () => {
    expect(importKindByLabel('Engagements')).toBe('engagements')
    expect(config.path).toBe('/engagements')
    expect(config.entityHref('eng_1')).toBe('/engagements?id=eng_1')
  })

  it('labels every column and editable field, and picks the client instead of typing an id', () => {
    for (const field of [...config.columns, ...config.editable])
      expect(config.fields).toHaveProperty(field)
    expect(config.pickClient).toBe(true)
    expect(config.editable).toContain('client_id')
    expect(config.editable).not.toContain('client_name')
  })

  it('reads an engagements batch', () => {
    expect(
      isImportBatch({
        id: 'imp_1',
        kind: 'engagements',
        status: 'review',
        created_at: '2026-11-09T10:00:00Z',
        files: [],
        records: [
          {
            id: 'imr_1',
            file_id: 'imf_1',
            kind: 'engagements',
            status: 'pending',
            data: { client_name: 'Muster AG', title: 'Retainer', interval: 1 },
            issues: { client_id: 'No client matches this document: choose one.' },
            duplicate: null,
            entity_id: null,
            error: null,
          },
        ],
      }),
    ).toBe(true)
  })

  it('sends a picked client as its id and name', () => {
    const data = { client_name: 'Muster', title: 'Retainer' }
    expect(
      recordChanges(data, { client_id: 'cli_1', client_name: 'Muster AG', title: 'Retainer' }),
    ).toEqual({ client_id: 'cli_1', client_name: 'Muster AG' })
  })
})
