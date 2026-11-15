import { toast } from 'sonner'

import { ApiError } from './api'
import {
  can,
  describeAccess,
  effectiveScopes,
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
  ['/employees', 'employees'],
  ['/employees/payroll', 'payroll'],
  ['/settings/employment', 'employees'],
  ['/account', null],
  ['/', null],
  ['/clientsx', null],
] as const)('%s belongs to %s', (path, resource) => {
  expect(resourceForPath(path)).toBe(resource)
})

// Mirrors apps/api/internal/permissions.Allows: owner all, admin all but HR, a member's "*" never reaches HR.
test.each([
  ['owner', undefined, 'write:employees', true],
  ['owner', undefined, 'write:payroll-approval', true],
  ['owner', undefined, 'read:payroll-export', true],
  ['owner', undefined, 'write:invoices', true],
  ['admin', undefined, 'write:invoices', true],
  ['admin', undefined, 'read:employees', false],
  ['admin', undefined, 'read:payroll', false],
  ['member', ['*:*'], 'read:employees', false],
  ['member', ['*:*'], 'write:clients', true],
  ['member', ['read:*'], 'read:payroll', false],
  ['member', ['read:employees'], 'read:employees', true],
  ['member', ['read:employees'], 'write:employees', false],
  ['member', ['write:payroll'], 'read:payroll', true],
  ['member', ['*:payroll'], 'write:payroll', true],
  ['member', ['*:payroll'], 'read:employees', false],
  ['member', undefined, 'read:employees', false],
] as const)('%s with %j may %s: %s', (role, scopes, need, expected) => {
  expect(can(effectiveScopes(role, scopes), need)).toBe(expected)
})

test('HR access is granted row by row, beside the presets', () => {
  expect(presetOf(['*:*', 'read:employees'])).toBe('full')
  expect(levelsOf(['*:*']).employees).toBe('none')
  expect(levelsOf(['write:payroll-approval'])['payroll-approval']).toBe('edit')
  // Approving is a change: a read scope gives no level.
  expect(levelsOf(['read:payroll-approval'])['payroll-approval']).toBe('none')
  expect(scopesFor({ ...levelsOf(['*:*']), 'payroll-approval': 'edit' })).toEqual([
    '*:*',
    'write:payroll-approval',
  ])
  expect(scopesFor({ ...levelsOf(['read:clients']), payroll: 'view' })).toEqual([
    'read:clients',
    'read:payroll',
  ])
  expect(describeAccess(['*:*', 'read:employees'])).toBe(
    'Can view and edit everything; HR: view employees',
  )
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
