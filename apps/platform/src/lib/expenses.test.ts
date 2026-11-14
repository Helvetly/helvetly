import {
  apiQuery,
  DEFAULT_PARAMS,
  expenseState,
  listParamsToQuery,
  parseListParams,
  type ListParams,
} from './expenses'

test('list state survives a round trip through the URL and leaves defaults out', () => {
  const params: ListParams = {
    page: 3,
    search: 'swisscom',
    view: 'unpaid',
    categories: ['exc_1', 'exc_2'],
    from: '2026-10-01',
    to: '2026-10-31',
    sort: 'total',
    desc: false,
  }
  const query = listParamsToQuery(params, new URLSearchParams('id=exp_1'))
  expect(query.get('id')).toBe('exp_1')
  expect(parseListParams(query)).toEqual(params)
  expect(listParamsToQuery(DEFAULT_PARAMS).toString()).toBe('')
})

test('malformed URL values fall back to the defaults', () => {
  expect(
    parseListParams(new URLSearchParams('page=-2&view=approved&sort=-price&from=yesterday')),
  ).toEqual(DEFAULT_PARAMS)
})

const api = (view: ListParams['view']) => Object.fromEntries(apiQuery({ ...DEFAULT_PARAMS, view }))

test('each tab asks the API for its status or payment filter', () => {
  expect(api('all')).toEqual({ page: '1', page_size: '50', sort: '-document_date' })
  expect(api('review')).toMatchObject({ status: 'draft' })
  expect(api('unpaid')).toMatchObject({ payment: 'unpaid' })
  expect(api('reimburse')).toMatchObject({ payment: 'to_reimburse' })
  expect(api('void')).toMatchObject({ status: 'void' })
  expect(
    apiQuery({ ...DEFAULT_PARAMS, categories: ['a', 'b'] }, false).getAll('category_id'),
  ).toEqual(['a', 'b'])
  expect(apiQuery(DEFAULT_PARAMS, false).has('page')).toBe(false)
})

test.each([
  [
    { status: 'draft', is_complete: false, payment_status: 'unpaid', is_overdue: false },
    'Incomplete',
  ],
  [
    { status: 'draft', is_complete: true, payment_status: 'unpaid', is_overdue: false },
    'Ready to book',
  ],
  [{ status: 'booked', is_complete: true, payment_status: 'unpaid', is_overdue: true }, 'Overdue'],
  [{ status: 'booked', is_complete: true, payment_status: 'unpaid', is_overdue: false }, 'Unpaid'],
  [{ status: 'booked', is_complete: true, payment_status: 'paid', is_overdue: false }, 'Paid'],
  [{ status: 'void', is_complete: true, payment_status: 'paid', is_overdue: false }, 'Void'],
] as const)('%o reads as %s', (expense, label) => {
  expect(expenseState(expense).label).toBe(label)
})
