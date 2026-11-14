import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ExpenseForm } from './expense-form'

afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200) => Response.json(body, { status })

/** A fake API: categories, a preview echoing the total, and whatever `onWrite` answers to writes. */
function stubApi(onWrite: (url: string, body: unknown) => Response | Promise<Response>) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input)
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : null
    if (url.endsWith('/expense-categories'))
      return json({
        data: [
          {
            id: 'exc_1',
            name: 'Travel',
            account_code: '6640',
            is_archived: false,
            expenses_count: 0,
          },
        ],
      })
    if (url.endsWith('/expenses/preview'))
      return json({ error: { code: 'http_404', message: 'x' } }, 404)
    if (url.includes('/session') || url.includes('/invoice-settings')) return json({}, 404)
    return onWrite(url, body)
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const renderForm = async () => {
  const onSaved = vi.fn<() => void>()
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TooltipProvider>
        <ExpenseForm onClose={vi.fn<() => void>()} onSaved={onSaved} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  await screen.findByRole('textbox', { name: /Supplier$/ })
  return { onSaved }
}

test('⌘Enter saves a draft with exact amounts', async () => {
  const fetch = stubApi((_, body) =>
    json(
      {
        data: {
          id: 'exp_1',
          number: 7,
          status: 'draft',
          ...(typeof body === 'object' ? body : {}),
        },
      },
      201,
    ),
  )
  const { onSaved } = await renderForm()

  await userEvent.type(screen.getByRole('textbox', { name: /Supplier$/ }), 'SBB')
  await userEvent.type(screen.getByRole('textbox', { name: 'Line 1 amount' }), '54,05')
  await userEvent.keyboard('{Meta>}{Enter}{/Meta}')

  await waitFor(() => expect(onSaved).toHaveBeenCalled(), { timeout: 3000 })
  const write = fetch.mock.calls.find(
    ([url, init]) => String(url).endsWith('/expenses') && init?.method === 'POST',
  )
  expect(JSON.parse(String(write?.[1]?.body))).toMatchObject({
    supplier_name: 'SBB',
    lines: [{ amount: '54.05', vat_rate: '8.1' }],
    payment_status: 'unpaid',
  })
})

test('repeated save shortcuts while saving create only one expense', async () => {
  const pending = Promise.withResolvers<Response>()
  const fetch = stubApi(() => pending.promise)
  const { onSaved } = await renderForm()
  await userEvent.type(screen.getByRole('textbox', { name: /Supplier$/ }), 'SBB')
  await userEvent.keyboard('{Meta>}{Enter}{Enter}{/Meta}')

  pending.resolve(json({ data: { id: 'exp_1', number: 7, status: 'draft' } }, 201))
  await waitFor(() => expect(onSaved).toHaveBeenCalled())
  expect(
    fetch.mock.calls.filter(
      ([url, init]) => String(url).endsWith('/expenses') && init?.method === 'POST',
    ),
  ).toHaveLength(1)
  expect(onSaved).toHaveBeenCalledOnce()
})

test('save shortcuts cannot resubmit a successful expense while its route is closing', async () => {
  const fetch = stubApi(() => json({ data: { id: 'exp_1', number: 7, status: 'draft' } }, 201))
  const { onSaved } = await renderForm()
  await userEvent.type(screen.getByRole('textbox', { name: /Supplier$/ }), 'SBB')
  await userEvent.keyboard('{Control>}{Enter}{/Control}')
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  await userEvent.keyboard('{Control>}{Enter}{/Control}')
  expect(
    fetch.mock.calls.filter(
      ([url, init]) => String(url).endsWith('/expenses') && init?.method === 'POST',
    ),
  ).toHaveLength(1)
})

test('booking an incomplete expense shows what is missing without sending anything', async () => {
  const fetch = stubApi(() => json({}, 500))
  await renderForm()
  await userEvent.click(screen.getByRole('button', { name: 'Save and book' }))

  expect(await screen.findByText('Enter the supplier to book.')).toBeInTheDocument()
  expect(screen.getByText('Choose a category to book.')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: /Supplier$/ })).toHaveFocus()
  const created = fetch.mock.calls.filter(
    ([url, init]) => String(url).endsWith('/expenses') && init?.method === 'POST',
  )
  expect(created).toHaveLength(0)
})

test('a server field error lands on its field', async () => {
  stubApi(() =>
    json(
      {
        error: {
          code: 'validation_failed',
          message: 'Check the highlighted fields.',
          details: {
            fields: { supplier_vat_number: 'This UID does not exist: check its digits.' },
          },
        },
      },
      422,
    ),
  )
  await renderForm()
  await userEvent.type(screen.getByRole('textbox', { name: /Supplier VAT/ }), 'CHE-123.456.789')
  await userEvent.click(screen.getByRole('button', { name: 'Save draft' }))

  expect(
    await screen.findByText('This UID does not exist: check its digits.', {}, { timeout: 3000 }),
  ).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: /Supplier VAT/ })).toHaveFocus()
})

test('a new expense waits for the workspace settings and categories before taking its defaults', async () => {
  const settings = Promise.withResolvers<Response>()
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input)
      if (url.includes('/invoice-settings')) return settings.promise
      if (url.endsWith('/expense-categories')) return json({ data: [] })
      return json({ error: { code: 'http_404', message: 'x' } }, 404)
    }),
  )
  const rendered = renderForm()

  expect(screen.queryByRole('button', { name: /Currency/ })).toBeNull()
  settings.resolve(
    json({ data: { currency: 'EUR', vat_registered: false, default_vat_rate: '8.1' } }),
  )
  await rendered
  expect(screen.getByRole('button', { name: 'Currency' })).toHaveTextContent('EUR')
})
