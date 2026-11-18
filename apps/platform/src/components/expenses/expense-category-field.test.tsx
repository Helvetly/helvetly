import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ExpenseCategoryField } from './expense-category-field'

afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200) => Response.json(body, { status })
const travel = {
  id: 'exc_1',
  name: 'Travel',
  account_code: '6640',
  is_archived: false,
  expenses_count: 0,
}

function setup(role: string, categories: unknown[], by: 'id' | 'name' = 'id', value = '') {
  const posts: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/expense-categories') && init?.method === 'POST') {
        const body: unknown = JSON.parse(String(init.body))
        posts.push(body)
        return json(
          { data: { ...travel, id: 'exc_2', name: 'Software', account_code: '6570' } },
          201,
        )
      }
      if (url.endsWith('/expense-categories')) return json({ data: categories })
      return json({}, 404)
    }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['session'], { role })
  const onChange = vi.fn<(value: string) => void>()
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ExpenseCategoryField id="cat" value={value} by={by} onChange={onChange} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return { posts, onChange }
}

test('an admin creates a category and it is selected by id', async () => {
  const { posts, onChange } = setup('admin', [travel])
  await userEvent.click(await screen.findByRole('button', { name: 'New category' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Category name' }), 'Software')
  const code = screen.getByRole('textbox', { name: /Account code/ })
  expect(code).toHaveValue('6700')
  await userEvent.clear(code)
  await userEvent.type(code, '6570')
  await userEvent.click(screen.getByRole('button', { name: 'Create' }))

  await waitFor(() => expect(onChange).toHaveBeenCalledWith('exc_2'))
  expect(posts).toEqual([{ name: 'Software', account_code: '6570' }])
})

test('a member sees no create action', async () => {
  setup('member', [travel])
  await screen.findByText('Choose a category')
  expect(screen.queryByRole('button', { name: 'New category' })).toBeNull()
})

test('an empty list disables the picker but an owner can still create', async () => {
  setup('owner', [])
  expect(await screen.findByRole('button', { name: /No categories yet/ })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'New category' })).toBeEnabled()
})

test('a name no category carries is offered as a new category, keeping the name', async () => {
  const { posts, onChange } = setup('owner', [travel], 'name', 'Software')
  expect(await screen.findByText('Suggested new category: Software')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Create' }))
  expect(screen.getByRole('textbox', { name: 'Category name' })).toHaveValue('Software')
  await userEvent.click(screen.getAllByRole('button', { name: 'Create' })[1] as HTMLElement)
  await waitFor(() => expect(posts).toHaveLength(1))
  await waitFor(() => expect(onChange).toHaveBeenCalledWith('Software'))
})
