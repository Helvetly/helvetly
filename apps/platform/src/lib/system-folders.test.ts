import { createTranslators } from '@helvetly/i18n'
import { describe, expect, it } from 'vitest'

import de from '../messages/de.json'
import en from '../messages/en.json'
import fr from '../messages/fr.json'
import it_ from '../messages/it.json'
import type { Folder, SystemKind } from './documents'
import { folderLabel, pathLabel, withoutEmptySystem } from './system-folders'

const translator = createTranslators({ en, de, fr, it: it_ })

const folder = (
  id: string,
  name: string,
  system_kind: SystemKind | null,
  parent_id: string | null = null,
  total_files = 0,
): Folder => ({
  id,
  name,
  system_kind,
  parent_id,
  file_count: 0,
  size: 0,
  total_files,
  total_size: 0,
  starred: false,
  created_by: null,
  created_at: '',
  updated_at: '',
})

describe('folderLabel', () => {
  it.each([
    ['en', 'Clients', 'Invoices'],
    ['de', 'Kunden', 'Rechnungen'],
    ['fr', 'Clients', 'Factures'],
    ['it', 'Clienti', 'Fatture'],
  ] as const)('shows system folders in %s', (language, clients, invoices) => {
    const t = translator(language)
    expect(folderLabel({ name: 'Clients', system_kind: 'clients' }, t)).toBe(clients)
    expect(folderLabel({ name: 'Invoices', system_kind: 'invoices' }, t)).toBe(invoices)
  })

  it.each([
    ['en', 'Contracts'],
    ['de', 'Verträge'],
    ['fr', 'Contrats'],
    ['it', 'Contratti'],
  ] as const)('shows the Contracts folder in %s', (language, label) => {
    expect(folderLabel({ name: 'Contracts', system_kind: 'contracts' }, translator(language))).toBe(
      label,
    )
  })

  it.each([
    ['en', 'Bank Statements'],
    ['de', 'Kontoauszüge'],
    ['fr', 'Relevés bancaires'],
    ['it', 'Estratti conto'],
  ] as const)('shows the Bank Statements folder in %s', (language, label) => {
    expect(
      folderLabel(
        { name: 'Bank Statements', system_kind: 'bank_statements' },
        translator(language),
      ),
    ).toBe(label)
  })

  it('switching the language changes only the labels of typed system folders', () => {
    const german = translator('de')
    expect(folderLabel({ name: 'Acme AG', system_kind: 'client' }, german)).toBe('Acme AG')
    expect(folderLabel({ name: '2025', system_kind: 'year' }, german)).toBe('2025')
    expect(folderLabel({ name: 'Invoices', system_kind: null }, german)).toBe('Invoices')
    expect(folderLabel({ name: 'Travel' }, german)).toBe('Travel')
    expect(folderLabel({ name: 'Expenses', system_kind: 'expenses' }, german)).toBe('Ausgaben')
  })

  it.each([
    ['en', 'Uncategorised'],
    ['de', 'Ohne Kategorie'],
    ['fr', 'Sans catégorie'],
    ['it', 'Senza categoria'],
  ] as const)('shows the folder of expenses without a category in %s', (language, label) => {
    const t = translator(language)
    expect(folderLabel({ name: 'Uncategorised', system_kind: 'expense_category' }, t)).toBe(label)
    expect(folderLabel({ name: 'Travel', system_kind: 'expense_category' }, t)).toBe('Travel')
    expect(folderLabel({ name: 'Uncategorised', system_kind: null }, t)).toBe('Uncategorised')
  })
})

describe('pathLabel', () => {
  const t = translator('de')
  it('translates the root and the record type of a client path', () => {
    expect(pathLabel('Clients/Acme AG/Invoices/2025', t)).toBe('Kunden/Acme AG/Rechnungen/2025')
    expect(pathLabel('Clients/Invoices/Quotes', t)).toBe('Kunden/Invoices/Offerten')
    expect(pathLabel('Clients/Acme AG/Documents/2025/Contracts', t)).toBe(
      'Kunden/Acme AG/Dokumente/2025/Verträge',
    )
  })
  it('translates the root and the folder of expenses without a category', () => {
    expect(pathLabel('Expenses/2025/Uncategorised', t)).toBe('Ausgaben/2025/Ohne Kategorie')
    expect(pathLabel('Expenses/2025/Travel', t)).toBe('Ausgaben/2025/Travel')
    expect(pathLabel('Expenses/Uncategorised/2025', t)).toBe('Ausgaben/Uncategorised/2025')
  })
  it('translates the Bank Statements root', () => {
    expect(pathLabel('Bank Statements/2025', t)).toBe('Kontoauszüge/2025')
  })

  it('leaves other paths alone', () => {
    expect(pathLabel('Invoices/2025', t)).toBe('Invoices/2025')
    expect(pathLabel('', t)).toBe('')
  })
})

const ids = (folders: Folder[]) => folders.map((entry) => entry.id)

describe('withoutEmptySystem', () => {
  const tree = [
    folder('c', 'Clients', 'clients'),
    folder('a', 'Acme AG', 'client', 'c'),
    folder('ai', 'Invoices', 'invoices', 'a', 1),
    folder('aq', 'Quotes', 'quotes', 'a'),
    folder('b', 'Beta SA', 'client', 'c'),
    folder('bq', 'Quotes', 'quotes', 'b'),
    folder('mine', 'Notes', null, 'bq'),
    folder('e', 'Expenses', 'expenses'),
    folder('ey', '2025', 'year', 'e'),
    folder('eyt', 'Travel', 'expense_category', 'ey', 2),
    folder('eyu', 'Uncategorised', 'expense_category', 'ey'),
  ]
  it('hides empty system sub-folders, keeping roots and what holds files or a made folder', () => {
    expect(ids(withoutEmptySystem(tree))).toEqual([
      'c',
      'a',
      'ai',
      'b',
      'bq',
      'mine',
      'e',
      'ey',
      'eyt',
    ])
  })
  it('keeps the open folder and its path', () => {
    expect(ids(withoutEmptySystem(tree, new Set(['eyu'])))).toContain('eyu')
  })
})
