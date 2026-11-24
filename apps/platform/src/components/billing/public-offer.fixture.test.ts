// the website's copy, written by apps/api/internal/billing/public_offer_golden_test.go
import golden from '../../../../web/src/lib/public-offer.golden.json'
import fixture from './public-offer.fixture.json'

test('the fixture is the public offer the API publishes (the Go golden file the website checks too)', () => {
  const { offer_id, ...offer } = fixture
  expect(offer_id).toBe('helvetly-v1')
  expect(offer).toEqual(golden)
})
