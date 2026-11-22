import {
  apiQuery,
  canManageProducts,
  DEFAULT_PARAMS,
  lineFromProduct,
  listParamsToQuery,
  parseListParams,
  type Product,
} from './products'

const item: Product = {
  id: 'prd_1',
  type: 'service',
  name: 'Consulting',
  description: 'Senior, on site',
  sku: 'CONS-1',
  gtin: null,
  unit: 'hour',
  price_basis: 'net',
  unit_price: '150.00',
  unit_price_net: '150.00',
  unit_price_gross: '162.15',
  currency: 'CHF',
  vat_category: 'S',
  vat_rate: '8.1',
  is_archived: false,
  archived_at: null,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
}

test('reads the list state from the URL and ignores what it does not know', () => {
  expect(
    parseListParams(
      new URLSearchParams(
        'page=2&q=web&type=product&status=archived&currency=eur&currency=EUR&sort=-unit_price&id=prd_1',
      ),
    ),
  ).toEqual({
    page: 2,
    search: 'web',
    type: 'product',
    status: 'archived',
    currencies: ['EUR'],
    units: [],
    vatRates: [],
    priceMin: null,
    priceMax: null,
    sku: null,
    updated: null,
    sort: 'unit_price',
    desc: true,
  })
  expect(
    parseListParams(
      new URLSearchParams(
        'page=0&type=robot&status=gone&sort=price&currency=E&unit=week&vat=abc&min=-1&max=1.234&sku=maybe&updated=1d',
      ),
    ),
  ).toEqual(DEFAULT_PARAMS)
})

test('writes only what differs from the defaults and keeps other keys', () => {
  expect(listParamsToQuery(DEFAULT_PARAMS, new URLSearchParams('id=prd_1')).toString()).toBe(
    'id=prd_1',
  )
  const params = {
    ...DEFAULT_PARAMS,
    page: 3,
    type: 'service' as const,
    units: ['hour' as const, 'day' as const],
    vatRates: ['8.1', '0'],
    priceMin: '10',
    priceMax: '99.50',
    sku: 'without' as const,
    updated: '30d' as const,
    sort: 'sku' as const,
    desc: true,
  }
  expect(parseListParams(listParamsToQuery(params))).toEqual(params)
})

test('asks the API for one page with the filters', () => {
  expect(apiQuery({ ...DEFAULT_PARAMS, search: ' web ', currencies: ['CHF'] }).toString()).toBe(
    'page=1&page_size=50&search=web&status=active&currency=CHF&sort=name',
  )
  expect(apiQuery(DEFAULT_PARAMS, false).has('page')).toBe(false)
})

test('the column filters map to the API', () => {
  vi.useFakeTimers({ now: new Date(2026, 10, 22) })
  const query = apiQuery({
    ...DEFAULT_PARAMS,
    units: ['hour'],
    vatRates: ['8.1', '2.6'],
    priceMin: '10',
    priceMax: '99.50',
    sku: 'with',
    updated: '7d',
  })
  vi.useRealTimers()
  expect(query.getAll('unit')).toEqual(['hour'])
  expect(query.getAll('vat_rate')).toEqual(['8.1', '2.6'])
  expect(query.get('price_min')).toBe('10')
  expect(query.get('price_max')).toBe('99.50')
  expect(query.get('sku')).toBe('with')
  expect(query.get('updated_from')).toBe('2026-11-16')
})

test('an item becomes an invoice line with the price of the invoice’s VAT mode', () => {
  expect(lineFromProduct(item, 'exclusive')).toEqual({
    description: 'Consulting – Senior, on site',
    quantity: '1',
    unit: 'hour',
    unit_price: '150.00',
    vat_category: 'S',
    vat_rate: '8.1',
  })
  expect(lineFromProduct(item, 'inclusive').unit_price).toBe('162.15')
  expect(lineFromProduct({ ...item, description: null }, 'none')).toEqual({
    description: 'Consulting',
    quantity: '1',
    unit: 'hour',
    unit_price: '150.00',
    vat_category: 'O',
    vat_rate: '0',
  })
})

test('only owners and admins manage the catalogue', () => {
  expect(['owner', 'admin', 'member', undefined].map(canManageProducts)).toEqual([
    true,
    true,
    false,
    false,
  ])
})
