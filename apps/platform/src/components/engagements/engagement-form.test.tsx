import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Session } from '@/lib/api'
import { clientKeys, type Client } from '@/lib/clients'
import { queryKeys } from '@/lib/queries'

import { EngagementForm } from './engagement-form'

afterEach(() => vi.unstubAllGlobals())

function stubApi(onEngagement: () => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input)
      if (url.endsWith('/session')) return Response.json(session)
      if (url.includes('/engagements')) return onEngagement()
      if (url.includes('/clients/'))
        return Response.json({ data: { id: 'cli_1', name: 'Muster AG' } })
      return Response.json({ data: [], meta: { page: 1, page_size: 20, total: 0, total_pages: 0 } })
    }),
  )
}

/** `priced`: switch from the default "Paid separately" to Advance, so the price fields show. */
async function renderForm({ priced = true } = {}) {
  const onOpenChange = vi.fn<(open: boolean) => void>()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <EngagementForm open onOpenChange={onOpenChange} clientId="cli_1" />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  await screen.findByRole('textbox', { name: /Title/ })
  if (priced) await userEvent.click(screen.getByRole('radio', { name: 'Advance' }))
  return onOpenChange
}

test('closing a dirty form asks before discarding', async () => {
  stubApi(() => Response.json({}))
  const onOpenChange = await renderForm()

  await userEvent.type(screen.getByRole('textbox', { name: /Title/ }), 'Lessons')
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onOpenChange).not.toHaveBeenCalled()
  await userEvent.click(await screen.findByRole('button', { name: 'Discard' }))
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

test('a clean form closes without asking', async () => {
  stubApi(() => Response.json({}))
  const onOpenChange = await renderForm({ priced: false })

  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onOpenChange).toHaveBeenCalledWith(false)
})

test('repeated save shortcuts create only one engagement while the request is pending', async () => {
  const pending = Promise.withResolvers<Response>()
  const create = vi.fn<() => Promise<Response>>(() => pending.promise)
  stubApi(create)
  const onOpenChange = await renderForm()
  await userEvent.type(screen.getByRole('textbox', { name: /Title/ }), 'Lessons')
  await userEvent.type(screen.getByRole('textbox', { name: /Quantity/ }), '30')
  await userEvent.type(screen.getByRole('textbox', { name: /Price per/ }), '120')
  fireEvent.change(screen.getByLabelText(/^Ends/), { target: { value: '2027-03-31' } })
  await userEvent.keyboard('{Control>}{Enter}{Enter}{/Control}')
  const requests = create.mock.calls.length
  pending.resolve(Response.json({ data: { id: 'eng_1', title: 'Lessons' } }, { status: 201 }))
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  expect(requests).toBe(1)
})

test('save shortcuts cannot resubmit a successful engagement while its route is closing', async () => {
  const create = vi.fn<() => Response>(() =>
    Response.json({ data: { id: 'eng_1', title: 'Lessons' } }, { status: 201 }),
  )
  stubApi(create)
  const onOpenChange = await renderForm()
  await userEvent.type(screen.getByRole('textbox', { name: /Title/ }), 'Lessons')
  await userEvent.type(screen.getByRole('textbox', { name: /Quantity/ }), '30')
  await userEvent.type(screen.getByRole('textbox', { name: /Price per/ }), '120')
  fireEvent.change(screen.getByLabelText(/^Ends/), { target: { value: '2027-03-31' } })
  await userEvent.keyboard('{Control>}{Enter}{/Control}')
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  await userEvent.keyboard('{Control>}{Enter}{/Control}')
  expect(create).toHaveBeenCalledOnce()
})

test('a server field error lands on its input and gets focus', async () => {
  stubApi(() =>
    Response.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Check the highlighted fields.',
          details: { fields: { reference: 'Too long.' } },
        },
      },
      { status: 422 },
    ),
  )
  await renderForm()

  await userEvent.type(screen.getByRole('textbox', { name: /Title/ }), 'Lessons')
  await userEvent.type(screen.getByRole('textbox', { name: /Quantity/ }), '30')
  await userEvent.type(screen.getByRole('textbox', { name: /Price per/ }), '120')
  fireEvent.change(screen.getByLabelText(/^Ends/), { target: { value: '2027-03-31' } })
  await userEvent.click(screen.getByRole('button', { name: 'Create engagement' }))

  const reference = await screen.findByRole('textbox', { name: /Reference/ })
  await waitFor(() => expect(reference).toHaveAttribute('aria-invalid', 'true'))
  expect(reference).toHaveFocus()
  expect(screen.getByText('Too long.')).toBeInTheDocument()
})

test('rollover is hidden unless advance and recurring; auto drafts explain they are drafts', async () => {
  stubApi(() => Response.json({}))
  await renderForm()

  expect(screen.queryByRole('switch', { name: /Carry unused/ })).toBeNull()
  expect(screen.getByText(/Drafts only, you issue them/)).toBeTruthy()
  expect(screen.getByRole('radio', { name: 'One summary line' })).toBeChecked()

  await userEvent.click(screen.getByRole('radio', { name: 'Recurring' }))
  expect(await screen.findByRole('switch', { name: /Carry unused/ })).toBeTruthy()

  await userEvent.click(screen.getByRole('radio', { name: 'Arrears' }))
  expect(screen.queryByRole('switch', { name: /Carry unused/ })).toBeNull()
})

test('the description and a different overage price stay behind their buttons', async () => {
  stubApi(() => Response.json({}))
  await renderForm()

  expect(screen.queryByRole('textbox', { name: /Description/ })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: /Add description/ }))
  expect(await screen.findByRole('textbox', { name: /Description/ })).toHaveFocus()
  // The API's limit, counted as on the product form.
  expect(screen.getByText('0 / 1000')).toBeInTheDocument()

  expect(screen.queryByRole('textbox', { name: /Price for extra/ })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: /Different price for extra hours/ }))
  const overage = await screen.findByRole('textbox', { name: /Price for extra hours/ })
  expect(overage).toHaveFocus()
  // It follows the regular price: the currency and Net/Gross show around it, without pickers of its own.
  const box = overage.parentElement!
  expect(box.textContent).toMatch(/^CHF\s*Net$/)
  await userEvent.click(screen.getByRole('radio', { name: 'Gross' }))
  expect(box.textContent).toMatch(/^CHF\s*Gross$/)
})

test('schedule and billing are radio cards; recurring asks "Every"', async () => {
  stubApi(() => Response.json({}))
  await renderForm()

  expect(screen.getByRole('radiogroup', { name: 'Schedule' })).toBeTruthy()
  expect(screen.getByRole('radio', { name: 'One-off' })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'Advance' })).toBeChecked()
  expect(screen.queryByRole('textbox', { name: /Every/ })).toBeNull()

  await userEvent.click(screen.getByRole('radio', { name: 'Recurring' }))
  expect(await screen.findByRole('textbox', { name: /Every/ })).toBeTruthy()
  expect(screen.queryByRole('radio', { name: '3 months' })).toBeNull()
})

test('Ends is a plain date without duration shortcuts, and the summary reads the form back', async () => {
  stubApi(() => Response.json({}))
  await renderForm()

  expect(screen.getByText(/Add a quantity and a start date/)).toBeTruthy()
  await userEvent.type(screen.getByRole('textbox', { name: /Title/ }), 'German lessons')
  await userEvent.type(screen.getByRole('textbox', { name: /Quantity/ }), '30')
  await userEvent.type(screen.getByRole('textbox', { name: /Price per/ }), '90')
  expect(screen.queryByRole('group', { name: 'Run for' })).toBeNull()
  expect(screen.queryByRole('radio', { name: '3 months' })).toBeNull()
  fireEvent.change(screen.getByLabelText(/^Ends/), { target: { value: '2027-03-31' } })

  expect(screen.getByLabelText(/^Ends/)).toHaveValue('2027-03-31')
  const summary = screen.getByRole('complementary', { name: 'Summary' })
  expect((summary.textContent ?? '').replace(/\s+/g, ' ')).toMatch(
    /30 h German lessons for Muster AG · .* · billed upfront/,
  )
  expect(summary).toHaveTextContent('CHF 2’700.00')
  expect(summary).toHaveTextContent('No invoice is created automatically')
})

test('the side panel previews the list row with placeholders, then the real values', async () => {
  stubApi(() => Response.json({}))
  await renderForm()

  const panel = screen.getByRole('complementary', { name: 'Summary' })
  expect(panel).toHaveTextContent('Engagement title')
  expect(panel).toHaveTextContent('Active')

  await userEvent.type(screen.getByRole('textbox', { name: /Title/ }), 'German lessons')
  await userEvent.type(screen.getByRole('textbox', { name: /Quantity/ }), '30')
  expect(panel).not.toHaveTextContent('Engagement title')
  expect(panel).toHaveTextContent('0 of 30 h used')

  await userEvent.click(screen.getByRole('switch', { name: /Create invoice drafts/ }))
  expect(panel).toHaveTextContent('Drafts automatic')
  expect(panel).toHaveTextContent('An advance invoice draft is created when the period starts.')
})

const muster = { id: 'cli_1', name: 'Muster AG' } as const satisfies Partial<Client>
const session: Session = {
  user: { id: 'usr_1', email: 'a@b.ch', name: 'Anna', avatar_url: null },
  workspace: { id: 'ws_1', name: 'Studio' },
  role: 'owner',
  onboarded: true,
  csrf_token: 'csrf',
}

function renderNew(queryClient: QueryClient, clientId?: string) {
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <EngagementForm open onOpenChange={vi.fn<(open: boolean) => void>()} clientId={clientId} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

test('a cached client keeps its shape and its name shows in the form', async () => {
  stubApi(() => Response.json({}))
  const queryClient = new QueryClient()
  queryClient.setQueryData(clientKeys.detail('cli_1'), muster)
  renderNew(queryClient, 'cli_1')

  expect(await screen.findByText('Muster AG')).toBeVisible()
  await waitFor(() => expect(queryClient.isFetching()).toBe(0))
  expect(queryClient.getQueryData(clientKeys.detail('cli_1'))).toEqual(muster)
})

test('a new engagement waits for the workspace settings before taking its defaults', async () => {
  const settings = Promise.withResolvers<Response>()
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(async (input) => {
      if (String(input).includes('/invoice-settings')) return settings.promise
      return Response.json({ data: [], meta: { page: 1, page_size: 20, total: 0, total_pages: 0 } })
    }),
  )
  renderNew(new QueryClient())

  expect(screen.queryByRole('textbox', { name: /Title/ })).toBeNull()
  settings.resolve(
    Response.json({ data: { currency: 'EUR', vat_registered: false, default_vat_rate: '8.1' } }),
  )
  await userEvent.click(await screen.findByRole('radio', { name: 'Advance' }))
  expect(await screen.findByRole('button', { name: /Currency.*EUR/ })).toBeVisible()
})

test("picking a client applies that client's habits to fields not changed yet", async () => {
  const now = Date.now()
  localStorage.setItem(
    'helvetly.habits.usr_1.ws_1',
    JSON.stringify({
      'engagement.billing@cli_1': { arrears: { s: 2, at: now } },
      'engagement.recurrence@cli_1': { none: { s: 2, at: now } },
    }),
  )
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(async (input) =>
      String(input).includes('/clients')
        ? Response.json({
            data: [muster],
            meta: { page: 1, page_size: 8, total: 1, total_pages: 1 },
          })
        : Response.json({ data: [], meta: { page: 1, page_size: 20, total: 0, total_pages: 0 } }),
    ),
  )
  const queryClient = new QueryClient()
  queryClient.setQueryData(queryKeys.session, session)
  renderNew(queryClient)

  await userEvent.click(await screen.findByRole('radio', { name: 'Recurring' }))
  // A new engagement starts as "Paid separately", the first choice, until the client's habit says otherwise.
  const billing = within(screen.getByRole('radiogroup', { name: 'Billing' })).getAllByRole('radio')
  expect(billing.map((r) => r.getAttribute('value'))).toEqual(['paid', 'advance', 'arrears'])
  expect(screen.getByRole('radio', { name: 'Paid separately' })).toBeChecked()
  await userEvent.click(screen.getByText('Choose a client'))
  await userEvent.click(await screen.findByRole('option', { name: /Muster AG/ }))

  expect(screen.getByRole('radio', { name: 'Arrears' })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'Recurring' })).toBeChecked()
  localStorage.clear()
})

test('an invoice picked under "Already invoiced" is linked after the engagement is created, and a refusal keeps the engagement', async () => {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.includes('/clients/'))
        return Response.json({ data: { id: 'cli_1', name: 'Muster AG' } })
      if (url.endsWith('/engagements'))
        return Response.json({ data: { id: 'eng_1', title: 'Lessons' } }, { status: 201 })
      if (url.endsWith('/engagements/eng_1/invoices'))
        return Response.json(
          { error: { code: 'validation_failed', message: 'Outside every period.' } },
          { status: 422 },
        )
      const invoice = {
        id: 'inv_1',
        number: '2026-001',
        issue_date: '2026-11-02',
        currency: 'CHF',
        total: '120.00',
      }
      return Response.json({
        data: url.includes('/invoices?') ? [invoice] : [],
        meta: { page: 1, total: 1 },
      })
    }),
  )
  const onOpenChange = await renderForm()
  await userEvent.click(await screen.findByRole('button', { name: /^Already invoiced/ }))
  await userEvent.click(await screen.findByText('2026-001'))
  await userEvent.type(screen.getByRole('textbox', { name: /Title/ }), 'Lessons')
  await userEvent.type(screen.getByRole('textbox', { name: /Quantity/ }), '30')
  await userEvent.type(screen.getByRole('textbox', { name: /Price per/ }), '120')
  fireEvent.change(screen.getByLabelText(/^Ends/), { target: { value: '2027-03-31' } })
  await userEvent.click(screen.getByRole('button', { name: 'Create engagement' }))
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  expect(calls.some((c) => c.startsWith('POST') && c.endsWith('/engagements/eng_1/invoices'))).toBe(
    true,
  )
})
