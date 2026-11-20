import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { billingFixture } from '@/components/billing/billing-fixture'
import { resetEmailTemplatesMock } from '@/mocks/email-templates'
import { handlers } from '@/mocks/handlers'

import { EmailTemplatesSections } from './email-templates-settings'
import { SettingsPage } from './layout'
import { SettingsHeader } from './settings-tabs'

const push = vi.fn<(href: string) => void>()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn<() => void>() }),
  usePathname: () => '/settings/workspace/',
}))

const session = (role: string, scopes: string[]) =>
  http.get('/api/v1/session', () =>
    HttpResponse.json({
      user: { id: 'usr_1', name: 'Anna', email: 'a@example.com', avatar_url: null },
      workspace: { id: 'wrk_1', name: 'Muster AG', timezone: 'Europe/Zurich' },
      role,
      scopes,
      onboarded: true,
      csrf_token: 'x',
    }),
  )
// The settings tabs read the plan (the Employees tab shows on Business).
const billing = http.get('/api/v1/billing', () =>
  HttpResponse.json({
    data: billingFixture({ plan: 'business', status: 'active', locked: false }),
  }),
)
const server = setupServer(session('owner', ['*:*']), billing, ...handlers)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  resetEmailTemplatesMock()
  push.mockClear()
})
afterEach(() => server.resetHandlers())

let sent: { url: string; body: unknown }[] = []
server.events.on('request:start', async ({ request }) => {
  if (request.method === 'PUT') sent.push({ url: request.url, body: await request.clone().json() })
})
beforeEach(() => {
  sent = []
})

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SidebarProvider>
          <SettingsHeader />
          <SettingsPage title="Workspace" description="">
            <EmailTemplatesSections />
          </SettingsPage>
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const dialog = () => screen.findByRole('dialog')
const open = async (user: ReturnType<typeof userEvent.setup>, kind: string, language?: string) => {
  await user.click(await screen.findByRole('button', { name: `Edit the ${kind} email` }))
  const box = within(await dialog())
  if (language) await user.click(box.getByRole('radio', { name: new RegExp(`^${language}`) }))
  return box
}
// The dialog holds the page's only text fields.
const field = (name: string) =>
  screen.getByRole<HTMLTextAreaElement>('textbox', { name: new RegExp(`^${name}`) })

test('lists one row per document type; the language is chosen in the dialog', async () => {
  const user = setup()
  const list = await screen.findByRole('list', { name: 'Email templates' })
  expect(within(list).getAllByRole('listitem')).toHaveLength(4)
  for (const kind of ['Invoice', 'Credit note', 'Proforma', 'Quote'])
    expect(within(list).getByRole('button', { name: `Edit the ${kind} email` })).toBeVisible()
  expect(within(list).queryByRole('radio')).toBeNull()
  expect(
    within(list).getByText('Sent with a quote, so the client can review and accept it.'),
  ).toBeVisible()
  const box = await open(user, 'Quote')
  expect(box.getByRole('heading', { name: 'Quote email' })).toBeVisible()
  expect(box.getAllByRole('radio')).toHaveLength(4)
})

test('each language keeps its unsaved edits while another is shown, and Save sends every changed one', async () => {
  const user = setup()
  const box = await open(user, 'Invoice', 'Deutsch')
  await user.clear(field('Subject'))
  await user.type(field('Subject'), 'Rechnung')
  await user.click(box.getByRole('radio', { name: 'English' }))
  await user.clear(field('Subject'))
  await user.type(field('Subject'), 'Invoice')
  expect(box.getByRole('radio', { name: 'Deutsch, unsaved changes' })).toBeInTheDocument()
  await user.click(box.getByRole('radio', { name: /^Deutsch/ }))
  expect(field('Subject').value).toBe('Rechnung')
  await user.click(box.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(sent.map((entry) => entry.url.split('/').slice(-2).join('/')).toSorted()).toEqual([
    'invoice/de',
    'invoice/en',
  ])
  expect(await screen.findByText('2 languages customised')).toBeVisible()
})

test('insertsVariableAtCursor: the chip goes where the cursor was, in the last focused field', async () => {
  const user = setup()
  const box = await open(user, 'Invoice')
  const body = field('Message')
  await user.clear(body)
  await user.type(body, 'Hi ')
  await user.click(box.getByRole('button', { name: '{client}' }))
  expect(body.value).toBe('Hi {client}')
  await waitFor(() => expect(body.selectionStart).toBe('Hi {client}'.length))

  const subject = field('Subject')
  await user.clear(subject)
  await user.type(subject, 'Re: ')
  await user.click(box.getByRole('button', { name: '{number}' }))
  expect(subject.value).toBe('Re: {number}')
})

test('a variable chip explains itself in a tooltip', async () => {
  const user = setup()
  const box = await open(user, 'Invoice')
  await user.hover(box.getByRole('button', { name: '{due_date}' }))
  expect((await screen.findAllByText('Due date, e.g. 31.12.2026')).length).toBeGreaterThan(0)
})

test('subject and message are required; nothing is sent while one is empty', async () => {
  const user = setup()
  const box = await open(user, 'Invoice')
  await user.clear(field('Subject'))
  await user.clear(field('Message'))
  await user.click(box.getByRole('button', { name: 'Save' }))
  expect(await box.findByText('Enter a subject.')).toBeVisible()
  expect(box.getByText('Enter a message.')).toBeVisible()
  expect(field('Subject')).toHaveAttribute('aria-invalid', 'true')
  expect(sent).toHaveLength(0)
  await user.type(field('Subject'), 'x')
  expect(box.queryByText('Enter a subject.')).toBeNull()
})

test('saving marks the language customised, keeps plain text, and reset brings the standard back', async () => {
  const user = setup()
  expect(screen.queryByText(/customised/)).toBeNull()
  let box = await open(user, 'Invoice', 'Français')
  expect(box.queryByRole('button', { name: 'Reset to default' })).toBeNull()
  await user.clear(field('Message'))
  await user.type(field('Message'), '<b>Bonjour</b> & merci')
  await user.click(box.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(await screen.findByText('1 language customised')).toBeVisible()
  expect(sent.at(-1)).toMatchObject({
    url: expect.stringContaining('/email-templates/invoice/fr'),
    body: { body: '<b>Bonjour</b> & merci' },
  })

  box = await open(user, 'Invoice', 'Français')
  expect(field('Message').value).toBe('<b>Bonjour</b> & merci')
  expect(box.getByRole('radio', { name: 'Français, customised' })).toBeInTheDocument()
  await user.click(box.getByRole('button', { name: 'Reset to default' }))
  // The dialog stays on the language, now with the standard wording.
  await waitFor(() => expect(field('Message').value).toContain('{number}'))
  expect(box.queryByRole('button', { name: 'Reset to default' })).toBeNull()
  expect(box.getByRole('radio', { name: 'Français' })).toBeInTheDocument()
  await user.click(box.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByText(/customised/)).toBeNull())
})

test('cancel closes without sending', async () => {
  const user = setup()
  const box = await open(user, 'Quote', 'English')
  await user.type(field('Subject'), '!')
  await user.click(box.getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(sent).toHaveLength(0)
})

test('serverFieldErrorShownUnderField', async () => {
  server.use(
    http.put('/api/v1/email-templates/invoice/de', () =>
      HttpResponse.json(
        {
          error: {
            code: 'validation_failed',
            message: 'Check the fields.',
            details: { fields: { subject: 'Enter a subject of at most 200 characters.' } },
          },
        },
        { status: 422 },
      ),
    ),
  )
  const user = setup()
  const box = await open(user, 'Invoice', 'Deutsch')
  await user.clear(field('Subject'))
  await user.type(field('Subject'), 'x')
  await user.click(box.getByRole('button', { name: 'Save' }))
  expect(await box.findByText('Enter a subject of at most 200 characters.')).toBeVisible()
  expect(field('Subject')).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByRole('dialog')).toBeVisible()
})

test('is read-only without invoice-settings write', async () => {
  server.use(session('member', ['read:invoice-settings']))
  const user = setup()
  const box = await open(user, 'Invoice')
  await waitFor(() => expect(field('Message')).toBeDisabled())
  expect(field('Subject')).toBeDisabled()
  expect(box.queryByRole('button', { name: 'Save' })).toBeNull()
  expect(box.queryByRole('button', { name: '{client}' })).toBeNull()
})

test('the Emails tab is gone: the templates are a section of the workspace settings', async () => {
  setup()
  await screen.findByRole('list', { name: 'Email templates' })
  expect(screen.queryByRole('button', { name: 'Emails' })).toBeNull()
})
