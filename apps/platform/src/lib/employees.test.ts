import {
  apiQuery,
  DEFAULT_PARAMS,
  formatPay,
  historyLabel,
  listParamsToQuery,
  parseListParams,
  placeLabel,
} from './employees'

test.each([
  [null, 'CHF', '—'],
  [undefined, 'CHF', '—'],
  ['', 'EUR', '—'],
  ['0.00', 'CHF', 'CHF 0.00'],
  ['6000.00', 'CHF', 'CHF 6’000.00'],
] as const)('formatPay(%j, %s) is %s: missing is never 0', (value, currency, text) => {
  expect(formatPay(value, currency)).toBe(text)
})

test('list params come from the URL, unknown values fall back to the defaults', () => {
  expect(parseListParams(new URLSearchParams())).toEqual(DEFAULT_PARAMS)
  expect(parseListParams(new URLSearchParams('q=lara&status=archived&department=Studio'))).toEqual({
    search: 'lara',
    status: 'archived',
    department: 'Studio',
    sort: { field: 'name', desc: false },
  })
  expect(parseListParams(new URLSearchParams('status=fired')).status).toBe('active')
  expect(parseListParams(new URLSearchParams('sort=-since')).sort).toEqual({
    field: 'since',
    desc: true,
  })
  expect(parseListParams(new URLSearchParams('sort=bank_account')).sort).toEqual({
    field: 'name',
    desc: false,
  })
})

test('list params go back to the URL without defaults, keeping the drawer keys', () => {
  const query = listParamsToQuery(
    { search: 'x', status: 'all', department: null, sort: { field: 'since', desc: true } },
    new URLSearchParams('id=emp_1&status=ended&sort=name'),
  )
  expect(query.toString()).toBe('id=emp_1&q=x&status=all&sort=-since')
  expect(listParamsToQuery(DEFAULT_PARAMS).toString()).toBe('')
})

test('the API query always names the status and trims the search', () => {
  expect(apiQuery({ ...DEFAULT_PARAMS, search: '  lara ', department: 'Studio' }).toString()).toBe(
    'status=active&page_size=200&search=lara&department=Studio',
  )
  expect(apiQuery({ ...DEFAULT_PARAMS, sort: { field: 'position', desc: true } }).toString()).toBe(
    'status=active&page_size=200&sort=-position',
  )
})

test('history kinds read as words', () => {
  expect(historyLabel('employee.pay_terms_added')).toBe('Pay terms added')
  expect(historyLabel('employee.something_new')).toBe('something new')
})

test('a place reads with the region name, or the codes while countries load', () => {
  const countries = [
    {
      code: 'CH',
      name: 'Switzerland',
      group: 'ch',
      regions: [{ code: 'ZH', name: 'Zurich' }],
      locality: false,
      research_status: 'researched',
    },
  ]
  expect(placeLabel(countries, 'CH', 'ZH')).toBe('Zurich, Switzerland')
  expect(placeLabel(undefined, 'CH', null)).toBe('CH')
})
