import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { categoryChanges, ExpenseCategoriesSheet } from './expense-categories-sheet'

afterEach(() => vi.unstubAllGlobals())

const travel = {
  id: 'exc_1',
  name: 'Travel',
  account_code: '6640',
  preset: 'travel',
  vat_treatment: 'standard',
  is_archived: false,
  expenses_count: 2,
}
const old = {
  ...travel,
  id: 'exc_2',
  name: 'Old costs',
  account_code: '6700',
  preset: null,
  vat_treatment: null,
}

test.each([
  ['nothing changed', 'Travel', '6640', {}],
  ['a new name', 'Business trips', '6640', { name: 'Business trips' }],
  ['a new account, the name untouched', ' Travel ', '6641', { account_code: '6641' }],
])('%s', (_, name, account, want) => {
  expect(categoryChanges(travel, name, account)).toEqual(want)
})

function setup() {
  const patches: { url: string; body: unknown }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input)
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>
        patches.push({ url, body })
        return Response.json({ data: { ...travel, ...body } })
      }
      if (url.includes('/expense-categories?'))
        return Response.json({ data: [travel, { ...old, is_archived: true }] })
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
  return patches
}

test('lists archived categories last and asks for every one', async () => {
  setup()
  const archived = await screen.findByRole('heading', { name: 'Archived' })
  expect(within(archived.parentElement as HTMLElement).getByText('Old costs')).toBeVisible()
  expect(screen.getByText(/Standard rate 8\.1% · 2 expenses/)).toBeVisible()
  expect(vi.mocked(fetch).mock.calls[0]?.[0]).toContain('include_archived=1')
})

test('renaming sends only the name; restoring sends only the archive flag', async () => {
  const patches = setup()
  await userEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0] as HTMLElement)
  const name = screen.getByRole('textbox', { name: 'Category name' })
  await userEvent.clear(name)
  await userEvent.type(name, 'Business trips{Enter}')
  await waitFor(() => expect(patches).toHaveLength(1))
  expect(patches[0]).toEqual({
    url: '/api/v1/expense-categories/exc_1?lang=en',
    body: { name: 'Business trips' },
  })
  await userEvent.click(screen.getByRole('button', { name: 'Restore' }))
  await waitFor(() => expect(patches).toHaveLength(2))
  expect(patches[1]?.body).toEqual({ is_archived: false })
})
