// the website's copy, written by apps/api/internal/billing/public_offer_golden_test.go
import golden from '../../../../web/src/lib/public-offer.golden.json'
import fixture from './public-offer.fixture.json'

test('the fixture is the public offer the API publishes (the Go golden file the website checks too)', () => {
  expect({
    comparison: fixture.comparison,
    usage_details: fixture.usage_details,
    limits: fixture.limits,
  }).toEqual({
    comparison: golden.comparison,
    usage_details: golden.usage_details,
    limits: golden.limits,
  })
})
