import { totals } from '@/mocks/employees'

import { missingNotes, monthLabel, monthOr, monthPeriod, shiftMonth } from './payroll'

test.each([
  ['2026-11', '2026-11'],
  ['2026-13', '2026-03'],
  ['bad', '2026-03'],
  [null, '2026-03'],
])('monthOr(%s) is %s', (value, expected) => {
  expect(monthOr(value, new Date('2026-03-10T12:00:00Z'))).toBe(expected)
})

test.each([
  ['2026-11', 1, '2026-12'],
  ['2026-12', 1, '2027-01'],
  ['2026-01', -1, '2025-12'],
  ['2026-03', -14, '2025-01'],
])('shiftMonth(%s, %i) is %s', (month, delta, expected) => {
  expect(shiftMonth(month, delta)).toBe(expected)
})

test('monthPeriod covers the whole month, leap years included', () => {
  expect(monthPeriod('2026-11')).toEqual({ start: '2026-11-01', end: '2026-11-30' })
  expect(monthPeriod('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' })
})

test('monthLabel names the month', () => {
  expect(monthLabel('2026-11')).toBe('November 2026')
})

test('missingNotes counts what each currency lacks, nothing when complete', () => {
  const [chf, eur] = totals
  if (!chf || !eur) throw new Error('The totals fixture needs CHF and EUR.')
  expect(missingNotes(chf)).toEqual([])
  expect(missingNotes(eur)).toEqual([
    '1 entry missing deductions',
    '1 entry missing net pay',
    '1 entry missing employer costs',
  ])
  expect(missingNotes({ ...eur, missing_gross: 2 })[0]).toBe('2 entries missing gross pay')
})

test('the entry form sends an empty figure as missing (null), never 0', async () => {
  const { entryInput } = await import('@/components/employees/payroll-entry')
  const input = entryInput({
    employee_id: 'emp_1',
    period_start: '2026-11-01',
    period_end: '2026-11-30',
    pay_date: '',
    currency: 'CHF',
    gross: ' 6000.00 ',
    deductions: '',
    net: '',
    employer_costs: '0',
    components: [],
    source_ref: '',
    note: '',
  })
  expect(input).toMatchObject({
    gross: '6000.00',
    deductions: null,
    net: null,
    employer_costs: '0',
  })
  expect(input.pay_date).toBeNull()
})
