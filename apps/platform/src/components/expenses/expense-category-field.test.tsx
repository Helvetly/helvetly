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
  preset: 'travel',
  vat_treatment: 'standard',
  is_archived: false,
  expenses_count: 0,
}

function setup(role: string, categories: unknown[], by: 'id' | 'name' = 'id', value = '') {
  const posts: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input)
      if (url.includes('/expense-categories?') && init?.method === 'POST') {
        const body: unknown = JSON.parse(String(init.body))
        posts.push(body)
        return json(
          { data: { ...travel, id: 'exc_2', name: 'Software', account_code: '6570' } },
          201,
        )
      }
      if (url.includes('/expense-categories?')) return json({ data: categories })
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

test("an admin adds what was typed from the list's last row and it is selected by id", async () => {
  const { posts, onChange } = setup('admin', [travel])
  await userEvent.click(await screen.findByRole('button', { name: /Choose a category/ }))
  expect(screen.getByRole('option', { name: 'Add category' })).toBeVisible()
  await userEvent.type(screen.getByRole('combobox'), 'Software{Enter}')
  const name = await screen.findByRole('textbox', { name: 'Category name' })
  expect(name).toHaveValue('Software')
  const code = screen.getByRole('textbox', { name: /Account code/ })
  expect(code).toHaveValue('6700')
  await userEvent.clear(code)
  await userEvent.type(code, '6570')
  await userEvent.click(screen.getByRole('button', { name: 'Create' }))

  await waitFor(() => expect(onChange).toHaveBeenCalledWith('exc_2'))
  expect(posts).toEqual([{ name: 'Software', account_code: '6570' }])
})

test('the add row reads Add "term" only for a term no category matches, and arrows reach it', async () => {
  setup('owner', [travel])
  await userEvent.click(await screen.findByRole('button', { name: /Choose a category/ }))
  const search = screen.getByRole('combobox')
  await userEvent.type(search, 'travel')
  expect(screen.getByRole('option', { name: 'Add category' })).toBeVisible()
  await userEvent.keyboard('{ArrowDown}{Enter}')
  expect(await screen.findByRole('textbox', { name: 'Category name' })).toHaveValue('')
})

test('a member gets no add row', async () => {
  setup('member', [travel])
  await userEvent.click(await screen.findByRole('button', { name: /Choose a category/ }))
  expect(screen.getByRole('option', { name: /Travel/ })).toBeVisible()
  expect(screen.queryByRole('option', { name: 'Add category' })).toBeNull()
})

test('an empty list stays open for an owner, to add the first category, and disabled for a member', async () => {
  setup('owner', [])
  await userEvent.click(await screen.findByRole('button', { name: /No categories yet/ }))
  expect(screen.getByRole('option', { name: 'Add category' })).toBeVisible()
})

test('an empty list disables the picker for a member', async () => {
  setup('member', [])
  expect(await screen.findByRole('button', { name: /No categories yet/ })).toBeDisabled()
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

test('categories sit under their account headings, presets in the user’s language, and an account code finds one', async () => {
  const lodging = { ...travel, id: 'exc_3', name: 'Lodging', preset: 'lodging' }
  const coworking = {
    ...travel,
    id: 'exc_4',
    name: 'Coworking',
    account_code: '6000',
    preset: null,
  }
  setup('member', [coworking, lodging, travel])
  await userEvent.click(await screen.findByRole('button', { name: /Choose a category/ }))
  expect(screen.getByRole('group', { name: 'Premises & equipment' })).toHaveTextContent('Coworking')
  expect(screen.getByRole('group', { name: 'Marketing & travel' }).textContent).toMatch(
    /Lodging.*Travel/,
  )
  await userEvent.type(screen.getByRole('combobox'), '6000')
  expect(screen.getByRole('option', { name: /Coworking/ })).toBeVisible()
  expect(screen.queryByRole('option', { name: /Travel/ })).toBeNull()
})

test('the name mode keeps the stored name as the value, whatever the label', async () => {
  const { onChange } = setup('member', [travel], 'name')
  await userEvent.click(await screen.findByRole('button', { name: /Choose a category/ }))
  await userEvent.click(screen.getByRole('option', { name: /Travel/ }))
  expect(onChange).toHaveBeenCalledWith('Travel')
})
