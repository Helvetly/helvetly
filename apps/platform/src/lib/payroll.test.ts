import { sortRows } from '@/lib/list-sort'
import { entry, totals } from '@/mocks/employees'

import {
  approvalBlock,
  authorOf,
  missingNotes,
  monthLabel,
  monthOr,
  monthPeriod,
  shiftMonth,
  sortValue,
  type SortField,
} from './payroll'

const fourEyes = { require_second_approver: true, payroll_approvers: 2 }

test('the author is the last editor, else the creator', () => {
  expect(authorOf(entry({ created_by_id: 'usr_a', updated_by_id: null }))).toBe('usr_a')
  expect(authorOf(entry({ created_by_id: 'usr_a', updated_by_id: 'usr_b' }))).toBe('usr_b')
})

test.each([
  ['four-eyes off', { ...fourEyes, require_second_approver: false }, 'usr_a', null],
  ['settings not loaded', undefined, 'usr_a', null],
  ['another person', fourEyes, 'usr_b', null],
  [
    'the author',
    fourEyes,
    'usr_a',
    'You entered these figures. Another person with Payroll edit access must approve them.',
  ],
  [
    'the sole approver',
    { ...fourEyes, payroll_approvers: 1 },
    'usr_a',
    'You entered these figures. Another person with Payroll edit access must approve them. Nobody else can approve yet: give a member Payroll edit access in Members.',
  ],
] as const)('approve under %s', (_, settings, user, reason) => {
  expect(approvalBlock(entry({ created_by_id: 'usr_a' }), user, settings)).toBe(reason)
})

test('the last editor is the author: the creator may approve what someone else changed', () => {
  const changed = entry({ created_by_id: 'usr_a', updated_by_id: 'usr_b' })
  expect(approvalBlock(changed, 'usr_a', fourEyes)).toBeNull()
  expect(approvalBlock(changed, 'usr_b', fourEyes)).not.toBeNull()
})

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

test('the register sorts by its visible columns, with unknown amounts last', () => {
  const rows = [
    entry({ id: 'a', employee_name: 'Zoe', net: '10.00', period_end: '2026-01-31' }),
    entry({ id: 'b', employee_name: 'Abe', net: null, period_end: '2026-01-15' }),
    entry({ id: 'c', employee_name: 'Mia', net: '9.00', period_end: '2026-01-31' }),
  ]
  const order = (field: SortField, desc: boolean) =>
    sortRows(rows, (row) => sortValue(row, field), desc).map((row) => row.id)
  expect(order('employee', false)).toEqual(['b', 'c', 'a'])
  expect(order('net', false)).toEqual(['c', 'a', 'b'])
  expect(order('net', true)).toEqual(['a', 'c', 'b'])
  expect(order('period', true)).toEqual(['a', 'c', 'b'])
})
