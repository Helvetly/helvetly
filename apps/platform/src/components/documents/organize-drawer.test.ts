import { describe, expect, it } from 'vitest'

import type { Folder } from '@/lib/documents'

import { folderEntries } from './folder-combobox'

const folder = (id: string, name: string, parent: string | null = null) =>
  ({ id, name, parent_id: parent }) as Pick<Folder, 'id' | 'name' | 'parent_id'>

describe('folderEntries', () => {
  it('keeps the whole path of every folder', () => {
    const entries = folderEntries([
      folder('a', 'Invoices'),
      folder('b', '2025', 'a'),
      folder('c', 'Q1', 'b'),
    ])
    expect(entries.map(({ path }) => path)).toEqual([
      'Invoices',
      'Invoices/2025',
      'Invoices/2025/Q1',
    ])
  })
})
