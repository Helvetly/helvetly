import { composeQuery, isLegacyEditorPath, parseCompose } from './compose'

const q = (text: string) => new URLSearchParams(text)

test.each([
  ['/invoices', 'compose=new', { id: null, kind: 'invoice', client: null }],
  [
    '/invoices',
    'compose=new&ckind=proforma&cclient=cli_1',
    { id: null, kind: 'proforma', client: 'cli_1' },
  ],
  ['/invoices', 'compose=new&ckind=credit_note', { id: null, kind: 'invoice', client: null }],
  ['/invoices', 'compose=inv_7', { id: 'inv_7', kind: 'invoice', client: null }],
  ['/invoices', 'status=open', null],
  [
    '/invoices/new',
    'client=cli_1&kind=prepayment',
    { id: null, kind: 'prepayment', client: 'cli_1' },
  ],
  ['/invoices/edit', 'id=inv_7', { id: 'inv_7', kind: 'invoice', client: null }],
  [
    '/invoices/new/',
    'client=cli_1&kind=prepayment',
    { id: null, kind: 'prepayment', client: 'cli_1' },
  ],
  ['/invoices/edit/', 'id=inv_7', { id: 'inv_7', kind: 'invoice', client: null }],
])('%s?%s opens %j', (path, query, expected) => {
  expect(parseCompose(path, q(query))).toEqual(expected)
})

test('only the older editor routes are legacy', () => {
  expect(isLegacyEditorPath('/invoices/new')).toBe(true)
  expect(isLegacyEditorPath('/invoices/edit')).toBe(true)
  expect(isLegacyEditorPath('/invoices')).toBe(false)
})

test('opening and closing the drawer keeps the list state', () => {
  const open = composeQuery(q('status=open'), { id: null, kind: 'partial', client: 'cli_2' })
  expect(open.toString()).toBe('status=open&compose=new&ckind=partial&cclient=cli_2')
  expect(composeQuery(open, null).toString()).toBe('status=open')
  expect(composeQuery(open, { id: 'inv_1', kind: 'invoice', client: null }).toString()).toBe(
    'status=open&compose=inv_1',
  )
})
