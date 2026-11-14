import { approx, sumQuantities, withUnit } from './engagement-bits'

test.each([
  ['0.652', '0.7'],
  ['3', '3'],
  ['0.04', '0'],
  ['12.25', '12.3'],
])('approx(%s) is %s', (input, output) => expect(approx(input)).toBe(output))

test('sumQuantities adds decimals without float noise', () => {
  expect(sumQuantities(['0.1', '0.2'])).toBe('0.3')
  expect(sumQuantities(['1.5', '2.25'])).toBe('3.75')
  expect(sumQuantities([])).toBe('0')
})

test('withUnit appends the short unit, or nothing without one', () => {
  expect(withUnit('6.50', 'hour')).toBe('6.5 h')
  expect(withUnit('3', null)).toBe('3')
})
