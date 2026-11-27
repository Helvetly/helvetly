import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { Session } from '@/lib/api'
import { queryKeys } from '@/lib/queries'
import { sampleClient } from '@/test/invoice-fixtures'

import { ClientForm } from './client-form'
import { bulkActions, selectionState } from './clients-page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn<() => void>(), push: vi.fn<() => void>() }),
  usePathname: () => '/clients',
  useSearchParams: () => new URLSearchParams(),
}))

afterEach(() => vi.unstubAllGlobals())

const renderForm = (queryClient = new QueryClient()) => {
  const onSaved = vi.fn<() => void>()
  render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ClientForm onClose={vi.fn<() => void>()} onSaved={onSaved} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return { onSaved }
}

test('the server’s field errors land on their fields, and the first one gets focus', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) =>
    init?.method !== 'POST'
      ? Response.json({ data: [] })
      : Response.json(
          {
            error: {
              code: 'validation_failed',
              message: 'Check the highlighted fields.',
              details: {
                fields: { email: 'This email is already used by #4.', vat_number: 'Unknown UID.' },
              },
            },
          },
          { status: 422 },
        ),
  )
  vi.stubGlobal('fetch', fetch)
  const { onSaved } = renderForm()

  await userEvent.type(
    screen.getByRole('textbox', { name: 'Company name' }),
    'Konditorei Muster AG',
  )
  await userEvent.type(screen.getByLabelText('Email'), 'info@konditorei-muster.ch')
  await userEvent.click(screen.getByRole('button', { name: 'Add client' }))

  expect(await screen.findByText('This email is already used by #4.')).toBeInTheDocument()
  expect(screen.getByText('Unknown UID.')).toBeInTheDocument()
  expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
  await waitFor(() => expect(screen.getByLabelText('Email')).toHaveFocus())
  expect(onSaved).not.toHaveBeenCalled()

  const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')
  const body: unknown = JSON.parse(String(post?.[1]?.body))
  expect(body).toMatchObject({
    name: 'Konditorei Muster AG',
    email: 'info@konditorei-muster.ch',
    phone: null,
  })
})

test('⌘Enter submits, but nothing is sent while the form has errors of its own', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [] }))
  vi.stubGlobal('fetch', fetch)
  renderForm()

  await userEvent.click(screen.getByLabelText('Email'))
  await userEvent.keyboard('{Control>}{Enter}{/Control}')

  // Ctrl/⌘+Enter submits from any field, and the form's own check stops it.
  expect(screen.getByText('Enter the company name.')).toBeInTheDocument()
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toEqual([])
})

test('what the address still needs sits behind the (?) next to Address', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [] })),
  )
  renderForm()
  await userEvent.hover(screen.getByRole('button', { name: 'About Address' }))
  expect(await screen.findByRole('tooltip')).toHaveTextContent(
    'Draft until the address is complete: add street, number, ZIP and city.',
  )
})

test('repeated save shortcuts create one client while the request is pending', async () => {
  const pending = Promise.withResolvers<Response>()
  const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) =>
    init?.method === 'POST' ? pending.promise : Response.json({ data: [] }),
  )
  vi.stubGlobal('fetch', fetch)
  const { onSaved } = renderForm()
  await userEvent.type(screen.getByRole('textbox', { name: 'Company name' }), 'Only once AG')
  await userEvent.keyboard('{Meta>}{Enter}{Enter}{/Meta}')
  const writes = fetch.mock.calls.filter(([, init]) => init?.method === 'POST')
  pending.resolve(Response.json({ data: { id: 'cli_once', name: 'Only once AG', number: 1 } }))
  expect(writes).toHaveLength(1)
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
})

test('save shortcuts cannot resubmit a successful form while its route is closing', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) =>
    init?.method === 'POST'
      ? Response.json({ data: { id: 'cli_once', name: 'Only once AG', number: 1 } })
      : Response.json({ data: [] }),
  )
  vi.stubGlobal('fetch', fetch)
  const { onSaved } = renderForm()
  await userEvent.type(screen.getByRole('textbox', { name: 'Company name' }), 'Only once AG')
  await userEvent.keyboard('{Control>}{Enter}{/Control}')
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  await userEvent.keyboard('{Control>}{Enter}{/Control}')
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
})

test('closing while a save is pending keeps the drawer, so a refusal still reaches its fields', async () => {
  const answer = Promise.withResolvers<Response>()
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>((_, init) =>
      init?.method !== 'POST' ? Promise.resolve(Response.json({ data: [] })) : answer.promise,
    ),
  )
  const onClose = vi.fn<() => void>()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TooltipProvider>
        <ClientForm onClose={onClose} onSaved={vi.fn<() => void>()} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  await userEvent.type(
    screen.getByRole('textbox', { name: 'Company name' }),
    'Konditorei Muster AG',
  )
  await userEvent.click(screen.getByRole('button', { name: 'Add client' }))
  await userEvent.keyboard('{Escape}')
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onClose).not.toHaveBeenCalled()
  answer.resolve(
    Response.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Check the highlighted fields.',
          details: { fields: { name: 'Already a client.' } },
        },
      },
      { status: 422 },
    ),
  )
  expect(await screen.findByText('Already a client.')).toBeInTheDocument()
})

test('the bulk bar offers only what the selection allows, status and portal grouped', () => {
  const run = {
    status: vi.fn<() => void>(),
    exportCsv: vi.fn<() => void>(),
    remove: vi.fn<() => void>(),
    portal: { change: vi.fn<() => void>() },
  }
  const rows = [
    sampleClient({ id: 'a', is_active: true, portal_enabled: false }),
    sampleClient({ id: 'b', is_active: true, portal_enabled: false }),
  ]
  const labels = (canDelete: boolean, ids: string[]) =>
    bulkActions(canDelete, selectionState(rows, new Set(ids)), run).map((action) => [
      action.label,
      action.group?.label,
    ])
  expect(labels(false, ['a', 'b'])).toEqual([
    ['Deactivate', 'Status'],
    ['Archive', 'Status'],
    ['Enable portal', 'Portal'],
    ['Export CSV', undefined],
  ])
  expect(labels(true, ['a']).map(([label]) => label)).toContain('Delete')
  // A row of another page may be in any state: everything stays offered.
  expect(labels(false, ['a', 'elsewhere']).map(([label]) => label)).toEqual([
    'Activate',
    'Deactivate',
    'Archive',
    'Unarchive',
    'Enable portal',
    'Disable portal',
    'Export CSV',
  ])
  const archived = [
    sampleClient({ id: 'c', archived_at: '2026-11-01T00:00:00Z', is_active: false }),
  ]
  expect(
    bulkActions(false, selectionState(archived, new Set(['c'])), run).map((action) => action.label),
  ).toEqual(['Unarchive', 'Export CSV'])
})

test('a learned country stays when a phone from another country is typed', async () => {
  const session: Session = {
    user: { id: 'usr_1', email: 'a@b.ch', name: 'Anna', avatar_url: null },
    workspace: { id: 'ws_1', name: 'Studio' },
    role: 'owner',
    onboarded: true,
    csrf_token: 'csrf',
  }
  localStorage.setItem(
    'helvetly.habits.usr_1.ws_1',
    JSON.stringify({ 'client.country': { DE: { s: 2, at: Date.now() } } }),
  )
  const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) =>
    init?.method === 'POST'
      ? Response.json({ data: { id: 'cli_1', name: 'Konditorei Muster AG' } }, { status: 201 })
      : Response.json({ data: [] }),
  )
  vi.stubGlobal('fetch', fetch)
  const queryClient = new QueryClient()
  queryClient.setQueryData(queryKeys.session, session)
  renderForm(queryClient)

  await userEvent.type(
    screen.getByRole('textbox', { name: 'Company name' }),
    'Konditorei Muster AG',
  )
  await userEvent.type(screen.getByLabelText('Phone'), '+41 44 123 45 67')
  await userEvent.click(screen.getByRole('button', { name: 'Add client' }))

  await waitFor(() =>
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
  )
  const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')
  expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ country: 'DE' })
  localStorage.clear()
})

test('payment terms offer the 7, 14 and 30 day presets with help, and keep a typed custom number', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(async () => Response.json({ data: [] })),
  )
  renderForm()

  expect(screen.getByRole('button', { name: 'About Payment terms' })).toBeInTheDocument()
  for (const days of ['7 days', '14 days', '30 days'])
    expect(screen.getByRole('radio', { name: days })).toBeInTheDocument()
  expect(screen.queryByRole('radio', { name: '10 days' })).not.toBeInTheDocument()

  await userEvent.click(screen.getByRole('radio', { name: 'Custom' }))
  const days = screen.getByRole('textbox', { name: 'Days' })
  await userEvent.clear(days)
  await userEvent.type(days, '45')
  expect(days).toHaveValue('45')
})

test('the client type is the first choice of the form, and a person is saved as one', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async (_, init) =>
    init?.method !== 'POST'
      ? Response.json({ data: [] })
      : Response.json({ error: { code: 'internal', message: 'Stop here.' } }, { status: 500 }),
  )
  vi.stubGlobal('fetch', fetch)
  renderForm()

  const type = screen.getByRole('radiogroup', { name: 'Client type' })
  expect(screen.getByRole('radio', { name: 'Company' })).toBeChecked()
  expect(screen.getByRole('radio', { name: 'Company' })).toHaveAccessibleDescription(
    'A business: company name, UID and VAT number',
  )
  // Ahead of every field one types into.
  expect(
    type.compareDocumentPosition(screen.getByRole('textbox', { name: 'Company name' })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy()

  await userEvent.click(screen.getByRole('radio', { name: 'Person' }))
  expect(screen.getByRole('radio', { name: 'Person' })).toBeChecked()
  await userEvent.type(screen.getByRole('textbox', { name: 'Full name' }), 'Anna Muster')
  await userEvent.click(screen.getByRole('button', { name: 'Add client' }))

  await waitFor(() =>
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true),
  )
  const post = fetch.mock.calls.find(([, init]) => init?.method === 'POST')
  expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({
    name: 'Anna Muster',
    is_company: false,
  })
})
