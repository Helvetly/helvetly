import { effectiveScopes } from '@/lib/permissions'

import { hrAccess } from './hr-access'

const lock = { plan: null, hint: 'Your plan doesn’t include employees and payroll' }

test('the owner edits both areas; on a lapsed plan reads stay and every write is off with its reason', () => {
  const owner = effectiveScopes('owner', null)
  expect(hrAccess(owner, 'owner', null)).toMatchObject({
    blocked: false,
    writeEmployees: true,
    writePayroll: true,
    reveal: true,
    lockReason: null,
  })
  const lapsed = hrAccess(owner, 'owner', lock)
  expect(lapsed).toMatchObject({
    blocked: false,
    readEmployees: true,
    readPayroll: true,
    writeEmployees: false,
    writePayroll: false,
    seesEmployeeWrites: true,
    reveal: true,
  })
  expect(lapsed.lockReason).toMatch(/no longer includes the Employees module/)
})

test('others see the lock instead of data while the plan lacks the module', () => {
  expect(hrAccess(['write:employees', 'write:payroll'], 'member', lock).blocked).toBe(true)
})

test('an owner without employee records is offered the plan too, one with records keeps reading', () => {
  const owner = effectiveScopes('owner', null)
  expect(hrAccess(owner, 'owner', lock, false).blocked).toBe(true)
  expect(hrAccess(owner, 'owner', lock, true).blocked).toBe(false)
  expect(hrAccess(owner, 'owner', null, false).blocked).toBe(false)
})

test('an admin holds payroll view by default: the register, not the records', () => {
  const admin = hrAccess(effectiveScopes('admin', null), 'admin', null)
  expect(admin).toMatchObject({
    readEmployees: false,
    readPayroll: true,
    writePayroll: false,
    reveal: false,
  })
})

test('sealed fields need payroll edit; employees edit alone cannot reveal them', () => {
  expect(hrAccess(['write:employees'], 'member', null)).toMatchObject({
    writeEmployees: true,
    readPayroll: false,
    reveal: false,
  })
  expect(hrAccess(['write:payroll'], 'member', null).reveal).toBe(true)
})
