import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse, type JsonBodyType } from 'msw'
import { setupServer } from 'msw/node'

import { billingFixture } from '@/components/billing/billing-fixture'
import { billingKeys, type Billing } from '@/lib/billing'

import { InviteDialog } from './invite-dialog'

vi.mock('sonner', () => ({ toast: { error: vi.fn<() => void>(), success: vi.fn<() => void>() } }))

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

const invitation = {
  id: 'inv_1',
  email: 'new@example.ch',
  role: 'member',
  scopes: null,
  invited_by: 'Olga',
  created_at: '2026-11-01T00:00:00Z',
  expires_at: '2026-11-08T00:00:00Z',
  url: 'https://x.ch/invite?token=abc',
  email_sent: true,
}

/** Opens the dialog as an owner and answers the invitation POST, recording its body. */
let client = new QueryClient()

function setup(
  status = 201,
  body: JsonBodyType = { data: invitation },
  plan: Billing = billingFixture({ enabled: false }),
  actorRole = 'owner',
) {
  const sent = vi.fn<(body: unknown) => void>()
  server.use(
    http.get('/api/v1/billing', () => HttpResponse.json({ data: plan })),
    http.post('/api/v1/members/invitations', async ({ request }) => {
      sent(await request.json())
      return HttpResponse.json(body, { status })
    }),
  )
  client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <InviteDialog actorRole={actorRole} onClose={() => {}} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return sent
}

const send = async (email = 'new@example.ch') => {
  await userEvent.type(screen.getByLabelText(/Email/), email)
  await userEvent.click(screen.getByRole('button', { name: 'Send invitation' }))
}

test('a member is invited with Full access unless another preset is picked', async () => {
  const sent = setup()
  await send()
  await waitFor(() =>
    expect(sent).toHaveBeenCalledWith({
      email: 'new@example.ch',
      role: 'member',
      send_email: true,
      scopes: ['*:*'],
    }),
  )
})

test.each([
  ['Read only', ['read:*'], 'Can view everything and change nothing.'],
  // An owner's pick of Full access also gives the payroll register to view.
  [
    'Full access',
    ['*:*', 'read:payroll'],
    'Can view and edit everything. Members, the workspace and billing stay with owners and admins. HR: view payroll.',
  ],
])('the %s preset sends its scopes and says what they allow', async (name, scopes, summary) => {
  const sent = setup()
  if (name === 'Full access')
    await userEvent.click(screen.getByRole('radio', { name: 'Read only' }))
  await userEvent.click(screen.getByRole('radio', { name }))
  expect(screen.getByText(summary)).toBeVisible()
  await send()
  await waitFor(() =>
    expect(sent).toHaveBeenCalledWith({
      email: 'new@example.ch',
      role: 'member',
      send_email: true,
      scopes,
    }),
  )
})

test('Custom sends one scope per row of the matrix', async () => {
  const sent = setup()
  await userEvent.click(screen.getByRole('radio', { name: 'Read only' }))
  await userEvent.click(screen.getByRole('radio', { name: 'Custom' }))
  expect(screen.getByText('Choose what they can view and edit in each area.')).toBeVisible()
  expect(screen.queryByText('Can view everything and change nothing.')).toBeNull()
  await userEvent.click(screen.getByRole('radio', { name: 'Invoices: Edit' }))
  await userEvent.click(screen.getByRole('radio', { name: 'Clients: No access' }))
  await userEvent.click(screen.getByRole('radio', { name: 'Ledger: Edit' }))
  await userEvent.click(screen.getByRole('radio', { name: 'Audit log: No access' }))
  // Areas run by owners and admins, the audit log and the API have no Edit.
  for (const area of ['Members', 'Workspace', 'Billing', 'Audit log', 'API & MCP'])
    expect(screen.queryByRole('radio', { name: `${area}: Edit` })).toBeNull()
  await send()
  await waitFor(() =>
    expect(sent).toHaveBeenCalledWith({
      email: 'new@example.ch',
      role: 'member',
      send_email: true,
      scopes: [
        'write:invoices',
        'read:expenses',
        'read:products',
        'read:documents',
        'read:engagements',
        'read:members',
        'read:invoice-settings',
        'read:vat-return',
        'write:ledger',
        'read:periods',
        'read:workspace',
        'read:billing',
        'read:api',
        'read:scheduling',
      ],
    }),
  )
})

test('no area left blocks sending', async () => {
  setup()
  await userEvent.click(screen.getByRole('radio', { name: 'Custom' }))
  for (const area of [
    'Clients',
    'Invoices',
    'Expenses',
    'Products & services',
    'Documents',
    'Engagements',
    'Members',
    'Invoice settings',
    'VAT return',
    'Ledger',
    'Period closing',
    'Audit log',
    'Workspace',
    'Billing',
    'API & MCP',
    'Scheduling',
  ])
    await userEvent.click(screen.getByRole('radio', { name: `${area}: No access` }))
  expect(screen.getByRole('button', { name: 'Send invitation' })).toBeDisabled()
})

test('an admin invitation keeps the default HR access unless the owner changes it', async () => {
  const sent = setup()
  await userEvent.click(screen.getByRole('radio', { name: /Admin/ }))
  // No presets: an admin's general access is fixed; only the HR rows are shown.
  expect(screen.queryByRole('group', { name: 'Access' })).toBeNull()
  expect(screen.getByText('Full access as admin; HR: view payroll')).toBeVisible()
  expect(screen.getByRole('radio', { name: 'Payroll: View' })).toBeChecked()
  await send()
  await waitFor(() =>
    expect(sent).toHaveBeenCalledWith({ email: 'new@example.ch', role: 'admin', send_email: true }),
  )
})

test("an owner sets an admin invitation's HR access", async () => {
  const sent = setup()
  await userEvent.click(screen.getByRole('radio', { name: /Admin/ }))
  await userEvent.click(screen.getByRole('radio', { name: 'Employees: Edit' }))
  await userEvent.click(screen.getByRole('radio', { name: 'Payroll: No access' }))
  await send()
  await waitFor(() =>
    expect(sent).toHaveBeenCalledWith({
      email: 'new@example.ch',
      role: 'admin',
      send_email: true,
      scopes: ['write:employees'],
    }),
  )
})

test('an admin inviting cannot touch HR access, and a preset leaves it alone', async () => {
  const sent = setup(201, { data: invitation }, billingFixture({ enabled: false }), 'admin')
  for (const radio of await screen.findAllByRole('radio', { name: /^(Employees|Payroll):/ }))
    expect(radio).toBeDisabled()
  expect(
    screen.getByRole('button', {
      name: 'Only the workspace owner can change access to employees and payroll.',
    }),
  ).toBeVisible()
  await userEvent.click(screen.getByRole('radio', { name: 'Read only' }))
  await send()
  await waitFor(() =>
    expect(sent).toHaveBeenCalledWith({
      email: 'new@example.ch',
      role: 'member',
      send_email: true,
      scopes: ['read:*'],
    }),
  )
})

test('without Employees in the plan, and no records, the HR rows are not offered', async () => {
  setup(201, { data: invitation }, billingFixture({ plan: 'pro', locked: false, status: 'active' }))
  await screen.findByRole('radio', { name: 'Read only' })
  await waitFor(() => expect(screen.queryByRole('radio', { name: /^Employees:/ })).toBeNull())
})

test('without Employees in the plan, with records, the HR rows are locked with the plan that has them', async () => {
  setup(
    201,
    { data: invitation },
    { ...billingFixture({ plan: 'pro', locked: false, status: 'active' }), has_employees: true },
  )
  expect(await screen.findByText('Business', { selector: '[data-slot=plan-tag]' })).toBeVisible()
  for (const radio of screen.getAllByRole('radio', { name: /^(Employees|Payroll):/ }))
    expect(radio).toBeDisabled()
})

test('a 422 on scopes is shown under the access block', async () => {
  setup(422, {
    error: {
      code: 'validation_failed',
      message: 'Invalid.',
      details: { fields: { scopes: 'Unknown scope.' } },
    },
  })
  await send()
  expect(await screen.findByRole('alert')).toHaveTextContent('Unknown scope.')
})

test('by link sends no email and shows the link to share', async () => {
  const sent = setup(201, { data: { ...invitation, email_sent: false } })
  await userEvent.type(screen.getByLabelText(/Email/), 'new@example.ch')
  await userEvent.click(screen.getByRole('radio', { name: 'By link' }))
  await userEvent.click(screen.getByRole('button', { name: 'Create link' }))
  await waitFor(() =>
    expect(sent).toHaveBeenCalledWith(expect.objectContaining({ send_email: false })),
  )
  expect(await screen.findByDisplayValue(invitation.url)).toBeVisible()
  expect(screen.getByText(`Invitation link for ${invitation.email}`)).toBeVisible()
})

const perSeat = (over: Partial<Billing> = {}) =>
  billingFixture({ plan: 'pro', interval: 'month', pricing: 'per_seat', locked: false, ...over })

test('on a per-seat plan the footer says what the person adds, once accepted', async () => {
  setup(201, { data: invitation }, perSeat())
  expect(await screen.findByText('Adds CHF 49 / month incl. VAT once accepted')).toBeVisible()
})

test('the yearly price shows for a yearly per-seat subscription', async () => {
  setup(201, { data: invitation }, perSeat({ interval: 'year' }))
  expect(await screen.findByText('Adds CHF 471 / year incl. VAT once accepted')).toBeVisible()
})

test.each([
  ['a flat plan', { pricing: 'flat' as const }],
  ['billing off', { enabled: false, pricing: 'per_seat' as const }],
  ['no plan', { plan: '' as const, interval: '' as const, pricing: '' as const }],
])('there is no cost note on %s', async (_name, over) => {
  setup(201, { data: invitation }, perSeat(over))
  await screen.findByRole('button', { name: 'Send invitation' })
  // the plan has arrived, so a missing note is not merely a note still loading
  await waitFor(() => expect(client.getQueryState(billingKeys.overview)?.status).toBe('success'))
  expect(screen.queryByText(/once accepted/)).toBeNull()
})
