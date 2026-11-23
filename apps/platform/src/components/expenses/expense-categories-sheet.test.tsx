import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { ExpenseCategory } from '@/lib/expenses'

import { categoryChanges, draftErrors, ExpenseCategoriesSheet } from './expense-categories-sheet'

afterEach(() => vi.unstubAllGlobals())

const travel: ExpenseCategory = {
  id: 'exc_1',
  name: 'Travel',
  account_code: '6640',
  preset: 'travel',
  vat_treatment: 'standard',
  is_archived: false,
  expenses_count: 2,
}
const old: ExpenseCategory = {
  ...travel,
  id: 'exc_2',
  name: 'Old costs',
  account_code: '6700',
  preset: null,
  vat_treatment: null,
  is_archived: true,
}

test.each([
  ['nothing changed', 'Travel', '6640', 'standard', {}],
  ['a new name', 'Business trips', '6640', 'standard', { name: 'Business trips' }],
  ['a new account, the name untouched', ' Travel ', '6641', 'standard', { account_code: '6641' }],
  ['a new VAT rate', 'Travel', '6640', 'reduced', { vat_treatment: 'reduced' }],
] as const)('%s', (_, name, account, vat, want) => {
  expect(categoryChanges(travel, { name, account, vat })).toEqual(want)
})

test.each([
  ['a new name and chart account', 'Coworking', '6000', {}],
  ['no name', ' ', '6000', { name: 'Enter a name.' }],
  ['a taken name, any case', 'travel', '6000', { name: 'Another category already has this name.' }],
  ['an archived name', 'Old Costs', '6000', { name: 'Another category already has this name.' }],
  ['a 3-digit account', 'Coworking', '600', { account_code: expect.stringMatching(/4-digit/) }],
])('a draft with %s', (_, name, account, want) => {
  expect(draftErrors({ name, account, vat: 'standard' }, [travel, old])).toEqual(want)
})

test('an edit keeps its own name and a legacy account', () => {
  const legacy = { ...travel, account_code: '664' }
  expect(draftErrors({ name: 'Travel', account: '664', vat: '' }, [legacy], legacy)).toEqual({})
})

function setup() {
  const writes: { method: string; url: string; body: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input)
      if (init?.method === 'PATCH' || init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        writes.push({ method: init.method, url, body })
        return Response.json({ data: { ...travel, id: 'exc_new', ...body } })
      }
      if (url.includes('/expense-categories?')) return Response.json({ data: [travel, old] })
      return Response.json({}, { status: 404 })
    }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ExpenseCategoriesSheet onClose={vi.fn<() => void>()} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return writes
}

test('groups categories, hides archived ones until asked and asks for every one', async () => {
  setup()
  expect(await screen.findByRole('heading', { name: 'Marketing & travel' })).toBeVisible()
  expect(screen.getByText('Standard 8.1%')).toBeVisible()
  expect(screen.getByText('2 expenses')).toBeVisible()
  expect(screen.queryByText('Old costs')).toBeNull()
  await userEvent.click(screen.getByRole('switch'))
  expect(screen.getByText('Old costs')).toBeVisible()
  expect(screen.getByRole('heading', { name: 'Other' })).toBeVisible()
  expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain('include_archived=1')
})

test('renaming sends only the name; unarchiving sends only the archive flag', async () => {
  const writes = setup()
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
  const name = screen.getByRole('textbox', { name: /Category name/ })
  await userEvent.clear(name)
  await userEvent.type(name, 'Business trips{Enter}')
  await waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0]).toEqual({
    method: 'PATCH',
    url: '/api/v1/expense-categories/exc_1?lang=en',
    body: { name: 'Business trips' },
  })
  await userEvent.click(screen.getByRole('switch'))
  await userEvent.click(screen.getByRole('button', { name: 'Unarchive' }))
  await waitFor(() => expect(writes).toHaveLength(2))
  expect(writes[1]?.body).toEqual({ is_archived: false })
})
