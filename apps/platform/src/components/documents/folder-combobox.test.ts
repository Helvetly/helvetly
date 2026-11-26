import { describe, expect, it } from 'vitest'

import { folderProblem } from './folder-combobox'

const existing = new Set(
  ['Clients', 'Clients/Acme', 'Clients/Acme/Invoices', 'Clients/Acme/Invoices/2026', 'Plain'].map(
    (path) => path.toLowerCase(),
  ),
)

describe('folderProblem', () => {
  it.each([
    ['Clients/Acme/Invoices/2026', null],
    ['Clients/Acme/Invoices/2026/Receipts', 'x'],
    ['Clients/Acme/Invoices/2027', null],
    ['Clients/Acme/Documents/2027/Contracts', null],
    ['Clients/Acme/Documents/2027/Contracts/Renewals', 'x'],
    ['Clients/Newco', 'x'],
    ['Expenses/2026/Travel', null],
    ['Plain/Sub/Deeper', null],
    ['Brand new', null],
  ])('%s', (path, bad) => {
    expect(folderProblem(path, existing) === null).toBe(bad === null)
  })
})
