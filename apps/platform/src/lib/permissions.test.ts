import { toast } from 'sonner'

import { ApiError } from './api'
import { can, levelsOf, presetOf, resourceForPath, scopesFor, toastForbidden } from './permissions'

vi.mock('sonner', () => ({ toast: { error: vi.fn<() => void>() } }))
vi.mock('next/navigation', () => ({ usePathname: () => '/' }))

test.each([
  [['*:*'], 'write:invoices', true],
  [['read:*'], 'read:clients', true],
  [['read:*'], 'write:clients', false],
  [['write:invoices'], 'read:invoices', true],
  [['write:invoices'], 'read:clients', false],
  [['*:invoices'], 'write:invoices', true],
  [['*:invoices'], 'read:expenses', false],
  [['write:*'], 'read:billing', true],
  [['read:clients', 'write:expenses'], 'write:expenses', true],
  [[], 'read:clients', false],
] as const)('can(%j, %s) is %s', (scopes, need, expected) => {
  expect(can(scopes, need)).toBe(expected)
})

test.each([
  [['*:*'], 'full'],
  [['read:*'], 'read'],
  // the former accountant preset reads as custom
  [['read:*', 'write:invoices', 'write:expenses'], 'custom'],
  [['read:clients'], 'custom'],
  [['read:*', 'write:invoices'], 'custom'],
  [[], 'custom'],
] as const)('presetOf(%j) is %s', (scopes, expected) => {
  expect(presetOf(scopes)).toBe(expected)
})

test('null scopes (owner, admin) are full access', () => {
  expect(presetOf(null)).toBe('full')
})

test('areas managed by role, the audit log and the API never go past view', () => {
  const full = levelsOf(['*:*'])
  for (const area of ['members', 'workspace', 'billing', 'audit-log', 'api'] as const)
    expect(full[area]).toBe('view')
  expect(levelsOf(['write:billing']).billing).toBe('view')
})

test('each settings area has its own level', () => {
  const levels = levelsOf(['write:ledger', 'read:vat-return', 'read:api'])
  expect(levels.ledger).toBe('edit')
  expect(levels['vat-return']).toBe('view')
  expect(levels['invoice-settings']).toBe('none')
  expect(levels.periods).toBe('none')
  expect(levels.api).toBe('view')
  expect(levelsOf(['*:*'])['invoice-settings']).toBe('edit')
})

test('a matrix that equals a preset turns back into its list', () => {
  expect(scopesFor(levelsOf(['*:*']))).toEqual(['*:*'])
  expect(scopesFor({ ...levelsOf(['read:*']), clients: 'none' })).not.toContain('read:clients')
  expect(scopesFor({ ...levelsOf([]), invoices: 'edit' })).toEqual(['write:invoices'])
})

test.each([
  ['/clients', 'clients'],
  ['/clients/', 'clients'],
  ['/invoices/new', 'invoices'],
  ['/settings/billing', 'billing'],
  ['/settings/billing/plans', 'billing'],
  ['/settings/invoices', 'invoice-settings'],
  ['/settings/vat-return', 'vat-return'],
  ['/settings/ledger', 'ledger'],
  ['/settings/periods', 'periods'],
  ['/settings/audit-log', 'audit-log'],
  ['/settings/workspace', 'workspace'],
  ['/settings/api', 'api'],
  ['/settings/security', null],
  ['/account', null],
  ['/', null],
  ['/clientsx', null],
] as const)('%s belongs to %s', (path, resource) => {
  expect(resourceForPath(path)).toBe(resource)
})

const refusal = (details: Record<string, unknown>) => new ApiError(403, 'forbidden', 'No.', details)

describe('a 403 that names a scope', () => {
  test('shows a toast saying what was refused', () => {
    expect(toastForbidden(refusal({ scope: 'write:invoices' }))).toBe(true)
    expect(toast.error).toHaveBeenCalledWith("You don't have permission to change invoices.", {
      id: 'write:invoices',
    })
  })

  test.each([
    new ApiError(403, 'forbidden', 'Owners only.'),
    new ApiError(409, 'conflict', 'No.', { scope: 'write:invoices' }),
    new Error('boom'),
  ])('is not a toast for %s', (error) => {
    vi.mocked(toast.error).mockClear()
    expect(toastForbidden(error)).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
  })
})
