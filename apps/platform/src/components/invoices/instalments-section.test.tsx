import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { useState } from 'react'

import { editorApi, sampleSchedule, sampleSettings } from '@/test/invoice-api'
import { sampleClient } from '@/test/invoice-fixtures'

import { scheduleBlocker, type EditorInstalments } from './editor-model'
import { InstalmentsSection } from './instalments-section'
import { InvoiceEditorDrawer } from './invoice-editor'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn<() => void>(), replace: vi.fn<() => void>() }),
  usePathname: () => '/invoices/new',
  useSearchParams: () => new URLSearchParams(),
}))

const clients = [sampleClient()]
const requests: { method: string; path: string; body: unknown }[] = []
const server = setupServer(
  http.get('/api/v1/session', () =>
    HttpResponse.json({ user: { id: 'usr_1', name: 'Anna' }, role: 'owner', csrf_token: 't' }),
  ),
  http.get('/api/v1/clients', () =>
    HttpResponse.json({ data: clients, meta: { page: 1, page_size: 8, total: 1, total_pages: 1 } }),
  ),
  http.get('/api/v1/clients/:id', () => HttpResponse.json({ data: clients[0] })),
  http.get('/api/v1/invoices', () =>
    HttpResponse.json({ data: [], meta: { page: 1, page_size: 50, total: 0, total_pages: 0 } }),
  ),
  ...editorApi(clients),
)
server.events.on('request:start', async ({ request }) => {
  if (request.method === 'GET') return
  requests.push({
    method: request.method,
    path: new URL(request.url).pathname,
    body: await request
      .clone()
      .json()
      .catch(() => null),
  })
})
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())

// What the server's preview generates for 1'081.00 in three monthly parts.
const generated = sampleSchedule().items.map(({ due_date, amount }) => ({ due_date, amount }))

function Harness() {
  const [value, setValue] = useState<EditorInstalments | null>(null)
  const [reminders, setReminders] = useState(true)
  const blocker = scheduleBlocker(
    { kind: 'invoice', instalments: value, issue_date: '2026-11-05', currency: 'CHF' },
    '1081.00',
    generated,
  )
  return (
    <TooltipProvider>
      <InstalmentsSection
        value={value}
        onChange={setValue}
        reminders={reminders}
        onReminders={setReminders}
        payable="1081.00"
        generated={generated}
        currency="CHF"
        issueDate="2026-11-05"
        firstDue="2026-12-01"
        settings={sampleSettings()}
        errors={{}}
        blocker={blocker}
      />
    </TooltipProvider>
  )
}

const amounts = () =>
  screen
    .getAllByRole('textbox', { name: /^Instalment \d amount$/ })
    .map((input) => (input instanceof HTMLInputElement ? input.value : ''))

const renderHarness = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Harness />
    </QueryClientProvider>,
  )
const dialog = () => screen.getByRole('dialog', { name: 'Pay in instalments' })

test('switching on opens the settings; Save leaves the summary in the footer row', async () => {
  renderHarness()
  await userEvent.click(screen.getByRole('switch', { name: 'Pay in instalments' }))
  expect(within(dialog()).getByRole('switch', { name: 'Payment reminders' })).toBeChecked()
  await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByText('3× · Monthly · from 1 Dec 2026')).toBeVisible()
  expect(screen.getByRole('switch', { name: 'Pay in instalments' })).toBeChecked()
})

test('Cancel on the first switch-on turns instalments off again', async () => {
  renderHarness()
  await userEvent.click(screen.getByRole('switch', { name: 'Pay in instalments' }))
  await userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('switch', { name: 'Pay in instalments' })).not.toBeChecked()
  expect(screen.queryByRole('button', { name: 'Edit instalments' })).not.toBeInTheDocument()
})

test('Edit changes the schedule; Cancel there keeps what was saved', async () => {
  renderHarness()
  await userEvent.click(screen.getByRole('switch', { name: 'Pay in instalments' }))
  await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }))

  await userEvent.click(screen.getByRole('button', { name: 'Edit instalments' }))
  await userEvent.selectOptions(
    within(dialog()).getByRole('combobox', { name: 'Interval' }),
    'quarterly',
  )
  await userEvent.click(within(dialog()).getByRole('switch', { name: 'Payment reminders' }))
  await userEvent.click(within(dialog()).getByRole('button', { name: 'Save' }))
  expect(screen.getByText('3× · Quarterly · from 1 Dec 2026')).toBeVisible()

  await userEvent.click(screen.getByRole('button', { name: 'Edit instalments' }))
  expect(within(dialog()).getByRole('switch', { name: 'Payment reminders' })).not.toBeChecked()
  const count = within(dialog()).getByRole('textbox', { name: 'Number of instalments' })
  await userEvent.clear(count)
  await userEvent.type(count, '6')
  await userEvent.click(within(dialog()).getByRole('switch', { name: 'Payment reminders' }))
  await userEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }))
  expect(screen.getByText('3× · Quarterly · from 1 Dec 2026')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'Edit instalments' }))
  expect(within(dialog()).getByRole('switch', { name: 'Payment reminders' })).not.toBeChecked()
})

test('section shows the server rows until one is edited', async () => {
  renderHarness()
  await userEvent.click(screen.getByRole('switch', { name: 'Pay in instalments' }))
  expect(screen.getByRole('textbox', { name: 'Number of instalments' })).toHaveValue('3')
  expect(screen.getByRole('combobox', { name: 'Interval' })).toHaveValue('monthly')
  expect(amounts()).toEqual(['360.35', '360.35', '360.30'])
  expect(screen.getByRole('switch', { name: 'Payment reminders' })).toBeChecked()

  const first = screen.getByRole('textbox', { name: 'Instalment 1 amount' })
  await userEvent.clear(first)
  await userEvent.type(first, '400')
  expect(screen.getByRole('status')).toHaveTextContent('Off by 39.65')
  expect(within(dialog()).getByRole('button', { name: 'Save' })).toBeDisabled()

  // Equal parts again; a new count drops the typed rows too.
  await userEvent.click(screen.getByRole('button', { name: 'Equal parts' }))
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(amounts()).toEqual(['360.35', '360.35', '360.30'])
  await userEvent.type(screen.getByRole('textbox', { name: 'Instalment 2 amount' }), '1')
  const count = screen.getByRole('textbox', { name: 'Number of instalments' })
  await userEvent.clear(count)
  await userEvent.type(count, '4')
  expect(screen.queryByRole('button', { name: 'Equal parts' })).not.toBeInTheDocument()
  expect(amounts()).toEqual(['360.35', '360.35', '360.30'])
})

test('sum mismatch blocks issue button', async () => {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TooltipProvider>
        <SidebarProvider>
          <InvoiceEditorDrawer
            compose={{ id: null, kind: 'invoice', client: null }}
            onClose={() => {}}
            onCreated={() => {}}
          />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
  await userEvent.click(await screen.findByRole('option', { name: /Alpenglow/ }))
  await userEvent.type(screen.getByLabelText('Line 1 description'), 'Workshop')
  await userEvent.type(screen.getByLabelText('Line 1 price'), '2900')
  // The preview answers 3'134.90 whatever is typed (sampleInvoice).
  expect(await screen.findByText('3’134.90', {}, { timeout: 3000 })).toBeInTheDocument()

  await userEvent.click(screen.getByRole('switch', { name: 'Pay in instalments' }))
  // The rows are the preview's, asked for without items so the server generates them.
  await waitFor(() => expect(amounts()).toEqual(['1044.95', '1044.95', '1045.00']), {
    timeout: 3000,
  })
  const previewed = requests.findLast((r) => r.path === '/api/v1/invoices/preview')
  expect(previewed?.body).toMatchObject({ instalments: { count: 3, interval: 'monthly' } })
  expect(previewed?.body).not.toHaveProperty('instalments.items')
  // Behind the open dialog, so hidden from the accessibility tree.
  const issue = screen.getByRole('button', { name: 'Issue invoice', hidden: true })
  expect(issue).toBeEnabled()

  const first = screen.getByRole('textbox', { name: 'Instalment 1 amount' })
  await userEvent.clear(first)
  await userEvent.type(first, '1000')
  expect(screen.getByText('Off by 44.95')).toBeInTheDocument()
  expect(issue).toBeDisabled()

  // The typed rows are what the draft saves.
  await waitFor(
    () =>
      expect(
        requests.some(
          (r) =>
            JSON.stringify(r.body).includes('"instalments":{"count":3') &&
            JSON.stringify(r.body).includes('"amount":"1000.00"'),
        ),
      ).toBe(true),
    { timeout: 3000 },
  )
})
