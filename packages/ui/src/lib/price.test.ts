import { formatAmount, formatPrice, monthOf, yearOf } from './price'

const chf = (amount: number) => ({ amount, currency: 'chf' })

test('a year is twelve months less 20 %, up to a whole franc', () => {
  expect([1900, 4900, 9900].map((m) => yearOf(chf(m)).amount)).toEqual([18300, 47100, 95100])
  expect(yearOf(chf(2500)).amount).toBe(24000)
})

test('a yearly price a month is rounded to the rappen', () => {
  expect(monthOf(chf(18300))).toEqual(chf(1525))
  expect(monthOf(chf(10000))).toEqual(chf(833))
})

test('prices show whole francs bare and the rest with rappen', () => {
  expect(formatPrice(chf(1900))).toBe('CHF 19')
  expect(formatPrice(chf(1850))).toBe('CHF 18.50')
  expect(formatAmount(chf(114000))).toBe("1'140")
})
