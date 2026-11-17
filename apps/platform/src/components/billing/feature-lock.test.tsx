import { billingFixture } from './billing-fixture'
import { employeesHidden, featureLock } from './feature-lock'

test('a feature the plan lacks names the cheapest plan that has it', () => {
  const basic = billingFixture({ plan: 'basic', locked: false })
  expect(featureLock(basic, 'heidi')).toEqual({
    plan: expect.objectContaining({ id: 'pro' }),
    hint: 'Your plan doesn’t include Heidi; Pro does',
  })
  expect(featureLock(basic, 'einvoice_xml')?.hint).toBe(
    'Your plan doesn’t include e-invoice XML; Business does',
  )
  const pro = billingFixture({ plan: 'pro', locked: false })
  expect(featureLock(pro, 'ledger_exports')).toBeNull()
  expect(featureLock(pro, 'client_portal')?.plan?.id).toBe('business')
  expect(
    featureLock(billingFixture({ plan: 'business', locked: false }), 'client_portal'),
  ).toBeNull()
})

test('no tag while billing has not answered, without a plan or self-hosted', () => {
  expect(featureLock(undefined, 'heidi')).toBeNull()
  // without a plan the whole workspace is read-only and says so elsewhere
  expect(featureLock(billingFixture(), 'heidi')).toBeNull()
  expect(featureLock(billingFixture({ enabled: false, features: ['heidi'] }), 'heidi')).toBeNull()
})

test('employees are hidden on a plan without them unless the owner has records to read', () => {
  const pro = billingFixture({ plan: 'pro', locked: false })
  expect(employeesHidden(pro)).toBe(true)
  expect(employeesHidden({ ...pro, has_employees: false })).toBe(true)
  expect(employeesHidden({ ...pro, has_employees: true })).toBe(false)
  const business = billingFixture({ plan: 'business', locked: false })
  expect(employeesHidden(business)).toBe(false)
  expect(employeesHidden({ ...business, has_employees: false })).toBe(false)
  // billing not answered yet: hidden, so nothing flashes in and out; no plan at all: nothing is hidden
  expect(employeesHidden(undefined)).toBe(true)
  expect(employeesHidden(billingFixture())).toBe(false)
})
