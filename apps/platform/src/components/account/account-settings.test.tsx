import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'

import { settingsPageAt } from '@/components/settings/settings-tabs'
import type { Session } from '@/lib/api'
import { accountHandlers, resetAccountMock } from '@/mocks/account'

import { AccountSettings } from './account-settings'

const push = vi.fn<(href: string) => void>()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn<() => void>() }),
  usePathname: () => '/account',
}))

const session: Session = {
  user: { id: 'usr_1', email: 'pete@helvetly.example', name: 'Pete K.', avatar_url: null },
  workspace: { id: 'wsp_1', name: 'My workspace', timezone: 'Europe/Zurich' },
  role: 'owner',
  onboarded: true,
  csrf_token: 'csrf',
}
const server = setupServer(
  http.get('/api/v1/session', () => HttpResponse.json(session)),
  http.get('/api/v1/auth/config', () =>
    HttpResponse.json({ google: true, email: true, passkey: true, dev_codes: false }),
  ),
  http.get('/api/v1/account/passkeys', () => HttpResponse.json({ data: [] })),
  ...accountHandlers,
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(resetAccountMock)
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <SidebarProvider>
          <AccountSettings />
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

const section = (name: string) => screen.getByRole('region', { name })

test('shows every section of Account settings', async () => {
  renderPage()
  await screen.findByRole('region', { name: 'Profile' })
  for (const name of [
    'Sign-in methods',
    'Two-factor authentication',
    'Active sessions',
    'Danger zone',
  ])
    expect(screen.getByRole('region', { name })).toBeInTheDocument()
  expect(await within(section('Sign-in methods')).findByText(/pete\.k@example\.com/)).toBeVisible()
})

test('disconnecting Google leaves Connect', async () => {
  renderPage()
  const signIn = await screen.findByRole('region', { name: 'Sign-in methods' })
  await userEvent.click(await within(signIn).findByRole('button', { name: 'Disconnect' }))
  expect(await within(signIn).findByRole('button', { name: 'Connect' })).toBeVisible()
})

test('signs out one session, then all the others', async () => {
  renderPage()
  const sessions = await screen.findByRole('region', { name: 'Active sessions' })
  expect(await within(sessions).findByText('This device')).toBeVisible()
  await userEvent.click(within(sessions).getByRole('button', { name: 'Sign out Safari on iOS 26' }))
  await waitFor(() => expect(within(sessions).queryByText('Safari on iOS 26')).toBeNull())
  await userEvent.click(
    within(sessions).getByRole('button', { name: 'Sign out of all other sessions' }),
  )
  const confirm = await screen.findByRole('dialog', { name: 'Sign out of all other sessions?' })
  await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
  expect(within(sessions).getAllByRole('listitem').length).toBeGreaterThan(1)
  await userEvent.click(
    within(sessions).getByRole('button', { name: 'Sign out of all other sessions' }),
  )
  await userEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sign out' }),
  )
  await waitFor(() => expect(within(sessions).getAllByRole('listitem')).toHaveLength(1))
  expect(within(sessions).queryByRole('button', { name: /Sign out/ })).toBeNull()
})

test('turns on two-factor authentication with a code and shows the recovery codes', async () => {
  renderPage()
  const twoFactor = await screen.findByRole('region', { name: 'Two-factor authentication' })
  await userEvent.click(await within(twoFactor).findByRole('button', { name: 'Turn on' }))
  const dialog = await screen.findByRole('dialog')
  expect(await within(dialog).findByText('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')).toBeVisible()
  expect(within(dialog).getByTestId('totp-qr')).toHaveTextContent(
    'QR code for your authenticator app',
  )
  expect(within(dialog).getByRole('button', { name: 'Copy key' })).toBeVisible()
  const input = within(dialog).getByLabelText('Code from the app')
  await userEvent.type(input, '000000')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Turn on' }))
  expect(await within(dialog).findByText(/not valid/)).toBeVisible()
  await userEvent.clear(input)
  await userEvent.type(input, '123456')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Turn on' }))
  expect(await screen.findByText('Save your recovery codes')).toBeVisible()
  await userEvent.click(screen.getByRole('button', { name: 'I’ve saved them' }))
  expect(await within(twoFactor).findByText('10 recovery codes left')).toBeVisible()
})

test('saves the name', async () => {
  renderPage()
  const input = await screen.findByLabelText('Full name')
  await userEvent.clear(input)
  await userEvent.type(input, 'Pete Krajewski')
  await userEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled())
  expect(screen.getByLabelText('Full name')).toHaveValue('Pete Krajewski')
})

test('the settings tabs mark this page and open another one', async () => {
  renderPage()
  const tabs = await screen.findByRole('navigation', { name: 'Views' })
  // Owners and admins also get the audit log, once the session says who this is.
  await within(tabs).findByRole('button', { name: 'Audit log' })
  const names = within(tabs)
    .getAllByRole('button')
    .map((tab) => tab.textContent)
  expect(names).toEqual([
    'Workspace',
    'Account',
    'API & MCP',
    'Billing',
    'Invoices',
    'VAT return',
    'Ledger',
    'Closing',
    'Audit log',
  ])
  expect(within(tabs).getByRole('button', { name: 'Account' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await userEvent.click(within(tabs).getByRole('button', { name: 'Billing' }))
  expect(push).toHaveBeenCalledWith('/settings/billing')
})

test('settingsPageAt picks the tab by path, or its closest parent', () => {
  expect(settingsPageAt('/account')?.label).toBe('Account')
  expect(settingsPageAt('/settings/vat-return/')?.label).toBe('VAT return')
  expect(settingsPageAt('/settings/billing/plans')?.label).toBe('Billing')
  expect(settingsPageAt('/clients')).toBeUndefined()
})

const pngFile = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'me.png', {
    type: 'image/png',
  })

// Cropping, saving and removing run in a real browser: Account/Profile photo stories.
test('a picked photo opens the crop dialog; cancelling sends nothing; a wrong type says why', async () => {
  const uploads: string[] = []
  server.events.on('request:start', ({ request }) => {
    if (request.url.endsWith('/account/avatar')) uploads.push(request.method)
  })
  renderPage()
  const profile = await screen.findByRole('region', { name: 'Profile' })
  expect(within(profile).getByText(/Upload a photo to show instead of your initials/)).toBeVisible()
  await userEvent.upload(screen.getByTestId('profile-photo-input'), pngFile())
  const dialog = await screen.findByRole('dialog', { name: 'Crop your photo' })
  expect(within(dialog).getByRole('slider', { name: 'Zoom' })).toHaveAttribute('aria-valuenow', '1')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(uploads).toEqual([])
  expect(within(profile).getAllByRole('button', { name: 'Upload photo' })).toHaveLength(2)
  const gif = new File(['GIF89a'], 'me.gif', { type: 'image/gif' })
  await userEvent.upload(screen.getByTestId('profile-photo-input'), gif, { applyAccept: false })
  expect(await within(profile).findByRole('alert')).toHaveTextContent('PNG, JPEG or WebP')
  expect(screen.queryByRole('dialog')).toBeNull()
  server.events.removeAllListeners()
})
