import { toast } from 'sonner'

import { ApiError } from './api'
import {
  can,
  canReadPath,
  describeHR,
  effectiveHR,
  effectiveScopes,
  hrScopes,
  levelsOf,
  PRESETS,
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
  ['/books/vat-return', 'vat-return'],
  ['/books/ledger', 'ledger'],
  ['/books', 'periods'],
  ['/books/', 'periods'],
  ['/settings/audit-log', 'audit-log'],
  ['/settings/workspace', 'workspace'],
  ['/developers', 'api'],
  ['/settings/security', null],
  ['/employees', 'employees'],
  ['/employees/payroll', 'payroll'],
  ['/settings/employment', 'employees'],
  ['/settings/documents', 'invoices'],
  ['/account', null],
  ['/', null],
  ['/clientsx', null],
] as const)('%s belongs to %s', (path, resource) => {
  expect(resourceForPath(path)).toBe(resource)
})

// Mirrors apps/api/internal/permissions.Allows: owner all, admin all plus their HR list (null: payroll view), a member's
// "*" never reaches HR.
test.each([
  ['owner', undefined, 'write:employees', true],
  ['owner', undefined, 'write:payroll', true],
  ['owner', undefined, 'write:invoices', true],
  ['admin', undefined, 'write:invoices', true],
  ['admin', null, 'read:payroll', true],
  ['admin', null, 'write:payroll', false],
  ['admin', null, 'read:employees', false],
  ['admin', [], 'read:payroll', false],
  ['admin', [], 'write:ledger', true],
  ['admin', ['write:employees'], 'write:employees', true],
  ['admin', ['write:employees'], 'read:payroll', false],
  // An admin's list carries HR only: a general scope in it changes nothing.
  ['admin', ['read:clients'], 'write:clients', true],
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

test.each([
  ['owner', null, ['write:employees', 'write:payroll']],
  ['admin', null, ['read:payroll']],
  ['admin', undefined, ['read:payroll']],
  ['admin', [], []],
  ['admin', ['write:employees', 'read:payroll'], ['write:employees', 'read:payroll']],
  ['member', ['*:*', 'read:employees'], ['read:employees']],
  ['member', null, []],
] as const)('effectiveHR(%s, %j) is %j', (role, scopes, hr) => {
  expect(effectiveHR(role, scopes)).toEqual(hr)
})

test('Full access sets Payroll View, Read only and Custom no HR access', () => {
  expect(Object.fromEntries(PRESETS.map((preset) => [preset.id, preset.hr]))).toEqual({
    full: ['read:payroll'],
    read: [],
    custom: [],
  })
})

test('a preset is recognised by the general areas, whatever the HR rows hold', () => {
  expect(presetOf(['*:*', 'read:payroll'])).toBe('full')
  expect(presetOf(['*:*', 'write:employees'])).toBe('full')
  expect(presetOf(['read:*', 'write:payroll'])).toBe('read')
})

test('HR access is set row by row, beside the general list', () => {
  expect(levelsOf(['*:*']).employees).toBe('none')
  expect(levelsOf(['write:payroll']).payroll).toBe('edit')
  expect(levelsOf(['read:payroll']).payroll).toBe('view')
  expect(scopesFor({ ...levelsOf(['*:*']), employees: 'edit' })).toEqual(['*:*', 'write:employees'])
  expect(scopesFor({ ...levelsOf(['read:clients']), payroll: 'view' })).toEqual([
    'read:clients',
    'read:payroll',
  ])
  // An admin's editor: no general area, only the HR rows.
  expect(scopesFor({ ...levelsOf([]), payroll: 'edit' })).toEqual(['write:payroll'])
  expect(hrScopes(['*:*', 'read:payroll', 'write:clients'])).toEqual(['read:payroll'])
})

test.each([
  [['*:*'], null],
  [['write:payroll'], 'edit payroll'],
  [['read:*', 'write:employees', 'read:payroll'], 'edit employees and view payroll'],
] as const)('describeHR(%j) is %s', (scopes, text) => {
  expect(describeHR(scopes)).toBe(text)
})

test.each([
  [['read:employees'], '/employees', true],
  [['read:payroll'], '/employees', true],
  [['read:payroll'], '/employees/', true],
  [['read:payroll'], '/employees/payroll', true],
  [['read:employees'], '/employees/payroll', false],
  [['read:payroll'], '/settings/employment', true],
  [['read:employees'], '/settings/employment', true],
  [['*:*'], '/employees', false],
  [['*:*'], '/settings/employment', false],
  [['read:clients'], '/clients', true],
  [['read:clients'], '/books/ledger', false],
  [[], '/account', true],
  [['read:invoices'], '/settings/documents', true],
  [['read:clients'], '/settings/documents', false],
] as const)('canReadPath(%j, %s) is %s', (scopes, path, expected) => {
  expect(canReadPath(scopes, path)).toBe(expected)
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
