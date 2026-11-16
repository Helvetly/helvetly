import { billingFixture } from './billing-fixture'
import { featureLock } from './feature-lock'

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
