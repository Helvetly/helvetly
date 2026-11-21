import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { AIApprovalProvider } from '@/components/ai/ai-approval'
import { aiConsent, aiNotice } from '@/mocks/ai-notice'

import { ExpenseForm } from './expense-form'

afterEach(() => vi.unstubAllGlobals())

const json = (body: unknown, status = 200) => Response.json(body, { status })

/** A fake API: categories, a preview echoing the total, and whatever `onWrite` answers to writes. */
function stubApi(onWrite: (url: string, body: unknown) => Response | Promise<Response>) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const url = String(input)
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null
    if (url.includes('/expense-categories?'))
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

const renderForm = async (initialFiles?: File[], seededSession?: object, withApproval = false) => {
  const onSaved = vi.fn<() => void>()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  if (seededSession) client.setQueryData(['session'], seededSession)
  const view = render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        {withApproval ? (
          <AIApprovalProvider>
            <ExpenseForm
              onClose={vi.fn<() => void>()}
              onSaved={onSaved}
              initialFiles={initialFiles}
            />
          </AIApprovalProvider>
        ) : (
          <ExpenseForm
            onClose={vi.fn<() => void>()}
            onSaved={onSaved}
            initialFiles={initialFiles}
          />
        )}
      </TooltipProvider>
    </QueryClientProvider>,
  )
  await screen.findByRole('textbox', { name: /Supplier$/ })
  return { onSaved, client, unmount: view.unmount }
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
      if (url.includes('/expense-categories?')) return json({ data: [] })
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

const session = (id: string) => ({
  user: { id: 'u', email: 'u@x.test', name: 'U', avatar_url: null },
  workspace: { id },
  role: 'owner',
  onboarded: true,
  csrf_token: 't',
})
const photo = (name = 'migros.jpg', type = 'image/jpeg') => new File(['x'], name, { type })
const NONE = {
  supplier_name: null,
  supplier_vat_number: null,
  supplier_country: null,
  reference: null,
  description: null,
  document_date: null,
  due_date: null,
  currency: null,
  amount: null,
  vat_rate: null,
  amount_2: null,
  vat_rate_2: null,
}
const answer = (fields: Record<string, string | null>, issues: Record<string, string> = {}) =>
  json({ data: { fields: { ...NONE, ...fields }, issues } })
const isPreview = ([url]: Parameters<typeof globalThis.fetch>) =>
  String(url).endsWith('/expenses/receipt-preview')
const recognizeButton = () => screen.getByRole('button', { name: 'Recognize receipt' })
const supplier = () => screen.getByRole('textbox', { name: /Supplier$/ })
const amount = () => screen.getByRole('textbox', { name: 'Line 1 amount' })

test('a staged receipt is never read until the person asks, and reading fills the form for review', async () => {
  const fetch = stubApi(() =>
    answer({
      supplier_name: 'Migros',
      reference: 'R-7',
      currency: 'CHF',
      amount: '108.10',
      vat_rate: '8.1',
    }),
  )
  await renderForm([photo()])
  expect(fetch.mock.calls.filter(isPreview)).toHaveLength(0)

  await userEvent.click(recognizeButton())

  await waitFor(() => expect(supplier()).toHaveValue('Migros'))
  expect(amount()).toHaveValue('108.10')
  expect(screen.getByRole('combobox', { name: 'Line 1 VAT rate' })).toHaveValue('8.1')
  expect(screen.getByText(/Filled in from the receipt: .*Supplier/)).toBeInTheDocument()
  const [, init] = fetch.mock.calls.find(isPreview) ?? []
  expect(init?.method).toBe('POST')
  const form = init?.body
  expect(form).toBeInstanceOf(FormData)
  expect((form as FormData).get('request_id')).toEqual(expect.any(String))
  expect(((form as FormData).get('file') as File).name).toBe('migros.jpg')
  // Reading saves nothing.
  expect(
    fetch.mock.calls.filter(
      ([url, i]) => String(url).endsWith('/expenses') && i?.method === 'POST',
    ),
  ).toHaveLength(0)
})

test('what the person typed or cleared while reading is kept, and the amounts are protected as a group', async () => {
  const pending = Promise.withResolvers<Response>()
  stubApi(() => pending.promise)
  await renderForm([photo()])
  await userEvent.click(recognizeButton())
  expect(screen.getByRole('button', { name: 'Reading the receipt…' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled()

  await userEvent.type(supplier(), 'Mine')
  await userEvent.clear(supplier())
  await userEvent.type(amount(), '5')
  pending.resolve(
    answer({
      supplier_name: 'Migros',
      reference: 'R-7',
      currency: 'EUR',
      amount: '108.10',
      vat_rate: '8.1',
    }),
  )

  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: /receipt no/i })).toHaveValue('R-7'),
  )
  expect(supplier()).toHaveValue('')
  expect(amount()).toHaveValue('5')
  expect(screen.getByRole('button', { name: 'Currency' })).toHaveTextContent('CHF')
  expect(screen.getByText(/Kept what you entered: Supplier, Amounts/)).toBeInTheDocument()
})

test('a failed reading keeps every entry and the form stays usable', async () => {
  stubApi(() => json({ error: { code: 'ai_unavailable', message: 'Allowance used.' } }, 503))
  await renderForm([photo()])
  await userEvent.type(supplier(), 'SBB')
  await userEvent.click(recognizeButton())

  expect(
    await screen.findByText(/The receipt could not be read: Allowance used\./),
  ).toBeInTheDocument()
  expect(supplier()).toHaveValue('SBB')
  expect(recognizeButton()).toBeEnabled()
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled()
})

test('withheld amounts (reverse charge, several VAT bands) stay empty and say why', async () => {
  stubApi(() =>
    answer(
      { supplier_name: 'Hetzner GmbH' },
      { amounts: 'Reverse charge: the form cannot record it yet.' },
    ),
  )
  await renderForm([photo()])
  await userEvent.click(recognizeButton())

  await waitFor(() => expect(supplier()).toHaveValue('Hetzner GmbH'))
  expect(amount()).toHaveValue('')
  expect(screen.getByText(/Reverse charge: the form cannot record it yet\./)).toBeInTheDocument()
})

test('with several receipts one must be chosen, and only that file is sent', async () => {
  const fetch = stubApi(() => answer({ supplier_name: 'Coop' }))
  await renderForm([photo('a.jpg'), photo('b.jpg')])
  expect(recognizeButton()).toBeDisabled()

  await userEvent.click(screen.getByRole('button', { name: /Choose the receipt to read/ }))
  await userEvent.click(await screen.findByRole('option', { name: 'b.jpg' }))
  await userEvent.click(recognizeButton())

  await waitFor(() => expect(supplier()).toHaveValue('Coop'))
  const form = fetch.mock.calls.find(isPreview)?.[1]?.body
  expect(((form as FormData).get('file') as File).name).toBe('b.jpg')
})

test('removing the receipt while it is read drops the answer', async () => {
  const pending = Promise.withResolvers<Response>()
  stubApi(() => pending.promise)
  await renderForm([photo()])
  await userEvent.click(recognizeButton())
  await userEvent.click(screen.getByRole('button', { name: /^Remove migros\.jpg/ }))
  pending.resolve(answer({ supplier_name: 'Migros' }))

  await userEvent.click(screen.getByRole('button', { name: 'Save draft' }))
  expect(supplier()).toHaveValue('')
})

test('a HEIC photo says it cannot be read and cannot be sent', async () => {
  const fetch = stubApi(() => answer({}))
  await renderForm([photo('iphone.heic', 'image/heic')])
  expect(recognizeButton()).toBeDisabled()
  expect(screen.getByText(/HEIC photos can't be read automatically/)).toBeInTheDocument()
  expect(fetch.mock.calls.filter(isPreview)).toHaveLength(0)
})

test('closing the form abandons a reading in flight without applying or saving it', async () => {
  const pending = Promise.withResolvers<Response>()
  const fetch = stubApi(() => pending.promise)
  const view = await renderForm([photo()])
  await userEvent.click(recognizeButton())
  const signal = fetch.mock.calls.find(isPreview)?.[1]?.signal
  view.unmount()
  expect(signal?.aborted).toBe(true)
  pending.resolve(answer({ supplier_name: 'Migros' }))
  await Promise.resolve()
})

test('switching workspace while reading drops the answer', async () => {
  const pending = Promise.withResolvers<Response>()
  const fetch = stubApi(() => pending.promise)
  const { client } = await renderForm([photo()])
  client.setQueryData(['session'], session('ws_a'))
  await userEvent.click(recognizeButton())
  client.setQueryData(['session'], session('ws_b'))
  const signal = fetch.mock.calls.find(isPreview)?.[1]?.signal
  await waitFor(() => expect(signal?.aborted).toBe(true))
  pending.resolve(answer({ supplier_name: 'Migros' }))

  await waitFor(() => expect(recognizeButton()).toBeEnabled())
  expect(supplier()).toHaveValue('')
})

const choose = async (name: string) => {
  await userEvent.click(
    screen.getByRole('button', { name: /^(Choose the receipt to read|[ab]\.jpg)$/ }),
  )
  await userEvent.click(await screen.findByRole('option', { name }))
}

test('choosing another receipt while one is read drops the old result', async () => {
  const pending = Promise.withResolvers<Response>()
  const fetch = stubApi(() => pending.promise)
  await renderForm([photo('a.jpg'), photo('b.jpg')])
  await choose('a.jpg')
  await userEvent.click(recognizeButton())
  const signal = fetch.mock.calls.find(isPreview)?.[1]?.signal
  await choose('b.jpg')
  expect(signal?.aborted).toBe(true)
  pending.resolve(answer({ supplier_name: 'FIRST FILE RESULT' }))

  await waitFor(() => expect(recognizeButton()).toBeEnabled())
  expect(supplier()).toHaveValue('')
})

test('a saved supplier country survives recognition', async () => {
  localStorage.setItem(
    'helvetly.habits.u.ws_a',
    JSON.stringify({ 'expense.supplier_country': { DE: { s: 3, at: Date.now() } } }),
  )
  stubApi(() => answer({ supplier_name: 'Migros', supplier_country: 'CH' }))
  await renderForm([photo()], session('ws_a'))
  expect(screen.getByRole('button', { name: 'Supplier country' })).toHaveTextContent('Germany')
  await userEvent.click(recognizeButton())

  await waitFor(() => expect(supplier()).toHaveValue('Migros'))
  expect(screen.getByRole('button', { name: 'Supplier country' })).toHaveTextContent('Germany')
  localStorage.clear()
})

// The real AIApprovalProvider with a fake server: the person's own approval in this workspace.
const usage = (granted: boolean) =>
  json({
    period: '2026-11',
    tokens_used: 0,
    tokens_included: 0,
    tokens_purchased: 0,
    tokens_remaining: 0,
    provider_available: true,
    consent: aiConsent(granted),
  })

function approvalApi(options: { granted: boolean; previews: (call: number) => Response }) {
  const state = { granted: options.granted, previews: 0, puts: 0 }
  const fetch = stubApi((url, _body) => {
    if (url.endsWith('/heidi/usage')) return usage(state.granted)
    if (url.includes('/heidi/consent?'))
      return json({ data: aiConsent(state.granted), notice: aiNotice })
    if (url.endsWith('/heidi/consent')) {
      state.puts += 1
      state.granted = true
      return json({ data: aiConsent(true) })
    }
    state.previews += 1
    return options.previews(state.previews)
  })
  return { state, fetch }
}

test('without approval the receipt is not sent until the person approves, once', async () => {
  const { state } = approvalApi({
    granted: false,
    previews: () => answer({ supplier_name: 'Migros' }),
  })
  await renderForm([photo()], session('ws_a'), true)
  await userEvent.click(recognizeButton())

  await userEvent.click(await screen.findByRole('button', { name: 'Approve and continue' }))

  await waitFor(() => expect(supplier()).toHaveValue('Migros'))
  expect(state).toMatchObject({ puts: 1, previews: 1 })
})

test('"Not now" sends nothing and keeps the form and the receipt', async () => {
  const { state } = approvalApi({
    granted: false,
    previews: () => answer({ supplier_name: 'Migros' }),
  })
  await renderForm([photo()], session('ws_a'), true)
  await userEvent.type(supplier(), 'SBB')
  await userEvent.click(recognizeButton())

  await userEvent.click(await screen.findByRole('button', { name: 'Not now' }))

  await waitFor(() => expect(recognizeButton()).toBeEnabled())
  expect(state).toMatchObject({ puts: 0, previews: 0 })
  expect(supplier()).toHaveValue('SBB')
  expect(screen.getByText('migros.jpg')).toBeInTheDocument()
})

test('a refusal for missing approval is retried once, not in a loop', async () => {
  const { state } = approvalApi({
    granted: true,
    previews: () =>
      json({ error: { code: 'ai_consent_required', message: 'Approve first.' } }, 403),
  })
  await renderForm([photo()], session('ws_a'), true)
  await userEvent.click(recognizeButton())

  expect(
    await screen.findByText(/The receipt could not be read: Approve first\./),
  ).toBeInTheDocument()
  expect(state.previews).toBe(2)
  expect(recognizeButton()).toBeEnabled()
})

test('switching workspace while the approval question is open sends nothing', async () => {
  const { state } = approvalApi({
    granted: false,
    previews: () => answer({ supplier_name: 'Migros' }),
  })
  const { client } = await renderForm([photo()], session('ws_a'), true)
  await userEvent.click(recognizeButton())
  await screen.findByRole('button', { name: 'Approve and continue' })
  act(() => client.setQueryData(['session'], session('ws_b')))

  await waitFor(() => expect(recognizeButton()).toBeEnabled())
  expect(state).toMatchObject({ puts: 0, previews: 0 })
  expect(supplier()).toHaveValue('')
})
