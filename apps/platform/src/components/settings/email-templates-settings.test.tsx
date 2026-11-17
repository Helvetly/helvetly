import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { resetEmailTemplatesMock } from '@/mocks/email-templates'
import { handlers } from '@/mocks/handlers'

import { EmailTemplatesSettingsPage } from './email-templates-settings'

const push = vi.fn<(href: string) => void>()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn<() => void>() }),
  usePathname: () => '/settings/emails/',
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
const server = setupServer(session('owner', ['*:*']), ...handlers)
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
          <EmailTemplatesSettingsPage />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

const message = () => screen.findByRole<HTMLTextAreaElement>('textbox', { name: 'Message' })
const subject = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Subject' })

test('insertsVariableAtCursor: the chip goes where the cursor was, in the last focused field', async () => {
  const user = setup()
  const body = await message()
  await user.clear(body)
  await user.type(body, 'Hi ')
  await user.click(screen.getByRole('button', { name: '{client}' }))
  expect(body.value).toBe('Hi {client}')
  await waitFor(() => expect(body.selectionStart).toBe('Hi {client}'.length))

  await user.clear(subject())
  await user.type(subject(), 'Re: ')
  await user.click(screen.getByRole('button', { name: '{number}' }))
  expect(subject().value).toBe('Re: {number}')
})

test('a variable chip explains itself in a tooltip', async () => {
  const user = setup()
  await message()
  await user.hover(screen.getByRole('button', { name: '{due_date}' }))
  expect((await screen.findAllByText('Due date, e.g. 31.12.2026')).length).toBeGreaterThan(0)
})

test('showsCustomDotPerLanguage, resetOnlyWhenCustom and plain-text encoding', async () => {
  const user = setup()
  const body = await message()
  const french = screen.getByRole('radio', { name: 'Français' })
  expect(screen.queryByRole('radio', { name: /customised/ })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Reset to default' })).toBeNull()

  await user.click(french)
  const frenchBody = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' })
  expect(frenchBody).not.toBe(body)
  await user.clear(frenchBody)
  await user.type(frenchBody, '<b>Bonjour</b> & merci')
  await user.click(screen.getByRole('button', { name: 'Save' }))

  expect(await screen.findByRole('radio', { name: 'Français, customised' })).toBeInTheDocument()
  expect(screen.getAllByRole('radio', { name: /customised/ })).toHaveLength(1)
  expect(sent.at(-1)).toMatchObject({
    url: expect.stringContaining('/email-templates/invoice/fr'),
    body: { body: '<b>Bonjour</b> & merci' },
  })
  expect(frenchBody.value).toBe('<b>Bonjour</b> & merci')

  await user.click(await screen.findByRole('button', { name: 'Reset to default' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Reset to default' })).toBeNull())
  expect(screen.queryByRole('radio', { name: /customised/ })).toBeNull()
  await waitFor(() =>
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Message' }).value).toContain(
      '{number}',
    ),
  )
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
  await message()
  await user.clear(subject())
  await user.type(subject(), 'x')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('Enter a subject of at most 200 characters.')).toBeVisible()
  expect(subject()).toHaveAttribute('aria-invalid', 'true')
})

test('unsavedChangesGuardOnTabSwitch', async () => {
  const user = setup()
  await message()
  await user.type(subject(), '!')
  await user.click(screen.getByRole('button', { name: 'Invoices' }))
  expect(await screen.findByText('Leave without saving?')).toBeVisible()
  expect(push).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Discard and leave' }))
  expect(push).toHaveBeenCalledWith('/settings/invoices')
})

test('is read-only without invoice-settings write', async () => {
  server.use(session('member', ['read:invoice-settings']))
  setup()
  const body = await message()
  await waitFor(() => expect(body).toBeDisabled())
  expect(subject()).toBeDisabled()
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  expect(screen.queryByRole('button', { name: '{client}' })).toBeNull()
})
