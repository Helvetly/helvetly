import { toast } from 'sonner'

import { ApiError } from './api'
import {
  can,
  describeAccess,
  levelsOf,
  presetOf,
  resourceForPath,
  scopesFor,
  toastForbidden,
} from './permissions'

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
  [['read:*', 'write:invoices', 'write:expenses'], 'accountant'],
  [['write:expenses', 'write:invoices', 'read:*'], 'accountant'],
  [['read:clients'], 'custom'],
  [['read:*', 'write:invoices'], 'custom'],
  [[], 'custom'],
] as const)('presetOf(%j) is %s', (scopes, expected) => {
  expect(presetOf(scopes)).toBe(expected)
})

test('null scopes (owner, admin) are full access', () => {
  expect(presetOf(null)).toBe('full')
})

test('members, settings and billing never go past view', () => {
  expect(levelsOf(['*:*']).members).toBe('view')
  expect(levelsOf(['write:billing']).billing).toBe('view')
})

test('a matrix that equals a preset turns back into its list', () => {
  expect(scopesFor(levelsOf(['*:*']))).toEqual(['*:*'])
  expect(scopesFor({ ...levelsOf(['read:*']), clients: 'none' })).not.toContain('read:clients')
  expect(scopesFor({ ...levelsOf([]), invoices: 'edit' })).toEqual(['write:invoices'])
})

test.each([
  [['*:*'], 'Can view and edit everything'],
  [['read:*'], 'Can view everything'],
  [
    ['read:*', 'write:invoices', 'write:expenses'],
    'Can view everything, edit invoices and expenses',
  ],
  [['read:clients', 'write:invoices'], 'Can view clients and invoices, edit invoices'],
  [[], 'No access'],
] as const)('describeAccess(%j)', (scopes, text) => {
  expect(describeAccess(scopes)).toBe(text)
})

test.each([
  ['/clients', 'clients'],
  ['/clients/', 'clients'],
  ['/invoices/new', 'invoices'],
  ['/settings/billing', 'billing'],
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
