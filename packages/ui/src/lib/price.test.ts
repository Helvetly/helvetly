import { formatAmount, formatPrice, monthOf, savingOf, yearlyFreeMonths, yearOf } from './price'

const chf = (amount: number) => ({ amount, currency: 'chf' })

test('a year is twelve months less 20 %, up to a whole franc', () => {
  expect([1900, 4900, 9900].map((m) => yearOf(chf(m)).amount)).toEqual([18300, 47100, 95100])
  expect(yearOf(chf(2500)).amount).toBe(24000)
  // The tiered plans' bases and extra people (plans.go): Basic, Pro, Business.
  expect([9900, 1000, 1500, 2000].map((m) => yearOf(chf(m)).amount)).toEqual([
    95100, 9600, 14400, 19200,
  ])
})

test('yearly saves twelve months less the year', () => {
  expect([1900, 4900, 9900].map((m) => savingOf(chf(m)).amount)).toEqual([4500, 11700, 23700])
})

test('a yearly price a month is exact, so twelve of it are the year', () => {
  expect(monthOf(chf(18300))).toEqual(chf(1525))
  expect(monthOf(chf(47100))).toEqual(chf(3925))
  expect(monthOf(chf(95100))).toEqual(chf(7925))
  expect(monthOf(chf(10200))).toEqual(chf(850))
  expect(formatPrice(monthOf(chf(18300)))).toBe('CHF 15.25')
})

test('prices show whole francs bare and the rest with rappen', () => {
  expect(formatPrice(chf(1900))).toBe('CHF 19')
  expect(formatPrice(chf(1850))).toBe('CHF 18.50')
  expect(formatAmount(chf(114000))).toBe("1'140")
})

test('the yearly saving is twelve months less the year', () => {
  expect([1900, 4900, 9900].map((m) => savingOf(chf(m)).amount)).toEqual([4500, 11700, 23700])
})

test('a page in another language formats in its own locale', () => {
  expect(formatAmount(chf(1525), 'nl-NL')).toBe('15,25')
  expect(formatPrice(chf(114000), 'sv-SE')).toBe('CHF 1\u00a0140')
})

test('yearly free months: Pro first, whole months, "over" with a remainder', () => {
  const basic = { id: 'basic', name: 'Basic', month: 1900, year: 18300 }
  const pro = { id: 'pro', name: 'Pro', month: 4900, year: 47100 }
  // 588 − 471 = 117 saved, 2.39 months: over 2, never 3.
  expect(yearlyFreeMonths([basic, pro])).toEqual({ plan: 'Pro', months: 2, over: true })
  // Exactly two months.
  expect(yearlyFreeMonths([{ ...pro, year: 49000 }])).toEqual({
    plan: 'Pro',
    months: 2,
    over: false,
  })
  // Without Pro, the plan saving the most.
  const business = { id: 'business', name: 'Business', month: 9900, year: 95100 }
  expect(yearlyFreeMonths([basic, business])).toEqual({ plan: 'Business', months: 2, over: true })
  // Free, or less than a month saved: no line.
  expect(yearlyFreeMonths([{ id: 'free', name: 'Free', month: 0, year: 0 }])).toBeUndefined()
  expect(yearlyFreeMonths([{ ...pro, year: 55000 }])).toBeUndefined()
  expect(yearlyFreeMonths([])).toBeUndefined()
})
