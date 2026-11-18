import { describe, expect, it } from 'vitest'

import type { Folder } from '@/lib/documents'

import { folderPaths } from './organize-drawer'

const folder = (id: string, name: string, parent: string | null = null) =>
  ({ id, name, parent_id: parent }) as Pick<Folder, 'id' | 'name' | 'parent_id'>

describe('folderPaths', () => {
  it('names every folder by its whole path, lower-cased, so a proposal can tell new from existing', () => {
    const paths = folderPaths(
      [folder('a', 'Invoices'), folder('b', '2025', 'a'), folder('c', 'Q1', 'b')].map(
        (entry) => ({ ...entry }) as Folder,
      ),
    )
    expect([...paths].toSorted()).toEqual(['invoices', 'invoices/2025', 'invoices/2025/q1'])
  })
})
