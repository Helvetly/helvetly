import {
  apiQuery,
  canDeleteClients,
  DEFAULT_PARAMS,
  effectiveSearch,
  isLeitwegId,
  listParamsToQuery,
  parseListParams,
  statusView,
  streetLine,
} from './clients'

test('reads the list state from the URL and ignores what it does not know', () => {
  expect(
    parseListParams(
      new URLSearchParams(
        'page=3&q=keller&status=draft&status=bogus&status=draft&type=company&sort=-number&id=cli_1',
      ),
    ),
  ).toEqual({
    page: 3,
    search: 'keller',
    status: ['draft'],
    type: 'company',
    tags: [],
    countries: [],
    name: '',
    email: '',
    city: '',
    created: null,
    sort: 'number',
    desc: true,
  })
  expect(parseListParams(new URLSearchParams('page=-2&sort=nanoid&type=robot&created=1d'))).toEqual(
    DEFAULT_PARAMS,
  )
})

test('writes only what differs from the defaults, and keeps other keys', () => {
  const query = listParamsToQuery(
    { ...DEFAULT_PARAMS, page: 2, status: ['active', 'complete'], sort: 'name', desc: false },
    new URLSearchParams('id=cli_9&page=7'),
  )
  expect(query.toString()).toBe('id=cli_9&page=2&status=active&status=complete&sort=name')
  expect(listParamsToQuery(DEFAULT_PARAMS).toString()).toBe('')
})

test('round-trips through the URL', () => {
  const params = {
    ...DEFAULT_PARAMS,
    search: 'Zürich',
    type: 'person' as const,
    name: 'Acme AG',
    city: 'Bern',
    sort: 'city' as const,
  }
  expect(parseListParams(listParamsToQuery(params))).toEqual(params)
})

test('searches from two characters, or at once for a number', () => {
  expect(effectiveSearch('k')).toBe('')
  expect(effectiveSearch(' ke ')).toBe('ke')
  expect(effectiveSearch('7')).toBe('7')
  expect(effectiveSearch('#12')).toBe('#12')
  expect(apiQuery({ ...DEFAULT_PARAMS, search: 'k' }).get('search')).toBeNull()
  expect(apiQuery({ ...DEFAULT_PARAMS, page: 2 }).toString()).toBe(
    'page=2&page_size=50&sort=-created_at',
  )
  expect(apiQuery(DEFAULT_PARAMS, false).has('page')).toBe(false)
  vi.useFakeTimers({ now: new Date(2026, 10, 22) })
  expect(apiQuery({ ...DEFAULT_PARAMS, created: 'year' }).get('created_from')).toBe('2026-01-01')
  vi.useRealTimers()
  const created = { ...DEFAULT_PARAMS, created: '30d' as const }
  expect(parseListParams(listParamsToQuery(created))).toEqual(created)
})

test('only owners and admins delete clients', () => {
  expect(canDeleteClients('owner')).toBe(true)
  expect(canDeleteClients('admin')).toBe(true)
  expect(canDeleteClients('member')).toBe(false)
  expect(canDeleteClients(undefined)).toBe(false)
})

test('tag and country filters travel through the URL and the API query', () => {
  const params = parseListParams(
    new URLSearchParams('tag=VIP&tag=Retail&tag=VIP&country=ch&country=xyz'),
  )
  expect(params.tags).toEqual(['VIP', 'Retail'])
  expect(params.countries).toEqual(['CH'])
  expect(listParamsToQuery(params).toString()).toBe('tag=VIP&tag=Retail&country=CH')
  expect(apiQuery(params, false).toString()).toBe('tag=VIP&tag=Retail&country=CH&sort=-created_at')
})

test('a Leitweg-ID is checked as the server checks it', () => {
  expect(isLeitwegId('04011000-1234512345-06')).toBe(true)
  expect(isLeitwegId(' 991-33333test-33 ')).toBe(true)
  expect(isLeitwegId('04011000-1234512345-07')).toBe(false)
  expect(isLeitwegId('991-12345-06')).toBe(false)
  expect(isLeitwegId('04011000-12345')).toBe(false)
})

test('names the status quick view, whatever the order, and none for other combinations', () => {
  expect(statusView([])).toBe('all')
  expect(statusView(['active'])).toBe('active')
  expect(statusView(['draft'])).toBe('draft')
  expect(statusView(['inactive'])).toBe('inactive')
  expect(statusView(['complete'])).toBeNull()
  expect(statusView(['active', 'draft'])).toBeNull()
})

const at = (country: string, street_number: string, apt: string | null) =>
  streetLine({ street: 'Marszałkowska', street_number, apt, country })

test('puts the apartment on the street line: slash in Poland, comma elsewhere', () => {
  expect(at('PL', '3', '3')).toBe('Marszałkowska 3/3')
  expect(at('PL', '3A', ' 2 ')).toBe('Marszałkowska 3A/2')
  expect(at('PL', '', '5')).toBe('Marszałkowska, 5')
  expect(at('CH', '21', 'Apt 21')).toBe('Marszałkowska 21, Apt 21')
  expect(at('US', '1', 'Suite 4B')).toBe('Marszałkowska 1, Suite 4B')
  expect(at('PL', '3', null)).toBe('Marszałkowska 3')
  expect(at('PL', '3', '  ')).toBe('Marszałkowska 3')
  expect(streetLine({ apt: '12' })).toBe('12')
  expect(streetLine({})).toBe('')
})
