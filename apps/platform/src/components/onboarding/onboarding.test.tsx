import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'

import { billingFixture } from '@/components/billing/billing-fixture'
import type { Session } from '@/lib/api'
import type { Billing } from '@/lib/billing'
import type { SettingsInput } from '@/lib/invoices'
import { sampleSettings } from '@/test/invoice-api'

import { Welcome } from './onboarding'
import { OnboardingRedirect, welcomeHref } from './onboarding-redirect'

const replace = vi.fn<(href: string) => void>()
let pathname = '/welcome'
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn<() => void>(), replace }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(window.location.search),
}))

let onboarded = false
let finished = 0
let saved: SettingsInput[] = []
let renamed: unknown[] = []
let workspaceName = 'Muster GmbH'
let billing: Billing = billingFixture({ enabled: false, locked: false })
// A brand-new workspace: nothing about the company yet.
const empty = sampleSettings({
  seller: {
    name: '',
    street: '',
    street_number: '',
    apt: null,
    zip: '',
    city: '',
    country: '',
    vat_number: null,
    email: null,
    phone: null,
  },
  vat_registered: false,
  default_vat_mode: 'none',
  iban: null,
  is_complete: false,
  missing_fields: ['seller.name', 'seller.street', 'iban'],
})

const session = (): Session => ({
  user: { id: 'usr_1', email: 'anna@example.com', name: 'Anna Muster', avatar_url: null },
  workspace: { id: 'wsp_1', name: workspaceName },
  role: 'owner',
  onboarded,
  csrf_token: 't',
})

const server = setupServer(
  http.get('/api/v1/session', () => HttpResponse.json(session())),
  http.get('/api/v1/billing', () => HttpResponse.json({ data: billing })),
  http.post('/api/v1/session/onboarded', () => {
    finished++
    onboarded = true
    return new HttpResponse(null, { status: 204 })
  }),
  http.patch('/api/v1/workspace', async ({ request }) => {
    renamed.push(await request.json())
    return HttpResponse.json({ data: { id: 'wsp_1', name: 'x', timezone: 'Europe/Zurich' } })
  }),
  http.get('/api/v1/invoice-settings', () => HttpResponse.json({ data: empty })),
  http.put('/api/v1/invoice-settings', async ({ request }) => {
    const input = (await request.json()) as SettingsInput
    saved.push(input)
    return HttpResponse.json({ data: { ...empty, ...input, missing_fields: ['iban'] } })
  }),
)
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
beforeEach(() => {
  server.resetHandlers()
  onboarded = false
  finished = 0
  saved = []
  renamed = []
  workspaceName = 'Muster GmbH'
  billing = billingFixture({ enabled: false, locked: false })
  pathname = '/welcome'
  replace.mockClear()
  window.history.replaceState(null, '', '/welcome?next=%2Finvoices%3Fstatus%3Dopen')
})
afterAll(() => server.close())

const wrap = (children: ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>,
  )

const welcome = () => screen.findByRole('heading', { name: 'Welcome to Helvetly, Anna' })
const left = () => waitFor(() => expect(replace).toHaveBeenCalledWith('/invoices?status=open'))

describe('the redirect', () => {
  test('sends a first visit to the welcome, coming back to the page it opened', async () => {
    pathname = '/invoices'
    window.history.replaceState(null, '', '/invoices?status=open')
    wrap(
      <OnboardingRedirect session={session()}>
        <p>The app</p>
      </OnboardingRedirect>,
    )
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/welcome?next=%2Finvoices%3Fstatus%3Dopen'),
    )
    expect(screen.queryByText('The app')).not.toBeInTheDocument()
  })

  test.each([
    ['once done', true, '/invoices'],
    ['on the welcome itself', false, '/welcome/'],
  ])('lets the page through %s', async (_, done, at) => {
    onboarded = done
    pathname = at
    wrap(
      <OnboardingRedirect session={session()}>
        <p>The app</p>
      </OnboardingRedirect>,
    )
    expect(await screen.findByText('The app')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  test('without a plan, the first visit is not sent to the welcome: the plan gate sends it on', async () => {
    billing = billingFixture()
    pathname = '/invoices'
    wrap(
      <OnboardingRedirect session={session()}>
        <p>The app</p>
      </OnboardingRedirect>,
    )
    expect(await screen.findByText('The app')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  test('without a plan, the welcome itself sends on to the plan picker', async () => {
    billing = billingFixture()
    pathname = '/welcome/'
    wrap(
      <OnboardingRedirect session={session()}>
        <p>The app</p>
      </OnboardingRedirect>,
    )
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/choose-plan'))
    expect(screen.queryByText('The app')).not.toBeInTheDocument()
  })

  test.each([
    ['/', '/welcome'],
    ['/welcome?next=%2F', '/welcome'],
    ['//evil.example', '/welcome'],
    ['/clients?id=cli_1', '/welcome?next=%2Fclients%3Fid%3Dcli_1'],
  ])('welcomeHref(%s) is %s', (next, want) => expect(welcomeHref(next)).toBe(want))
})

describe('the welcome', () => {
  test('shows on the first visit, with focus on its heading and the progress', async () => {
    wrap(<Welcome />)
    const heading = await welcome()
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('max', '5')
  })

  test('a person who is done goes on without seeing it', async () => {
    onboarded = true
    wrap(<Welcome />)
    await left()
    expect(screen.queryByRole('heading', { name: /Welcome/ })).not.toBeInTheDocument()
  })

  test('can only be finished: no way to skip it, and Esc does nothing', async () => {
    const user = userEvent.setup()
    wrap(<Welcome />)
    await welcome()
    expect(screen.queryByRole('button', { name: /Skip for now/ })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: /Get started/ }))
    await screen.findByRole('heading', { name: 'Your company' })
    await user.keyboard('{Escape}')
    // A step's own skip only moves on.
    await user.click(screen.getByRole('button', { name: 'I’ll do it later' }))
    expect(await screen.findByRole('heading', { name: 'Add your logo' })).toBeInTheDocument()
    expect(finished).toBe(0)
    expect(replace).not.toHaveBeenCalled()
  })

  test('an invalid entry stays, so it is not silently thrown away', async () => {
    const user = userEvent.setup()
    const settingsReady = Promise.withResolvers<void>()
    server.use(
      http.get('/api/v1/invoice-settings', async () => {
        await settingsReady.promise
        return HttpResponse.json({ data: empty })
      }),
    )
    wrap(<Welcome />)
    await user.click(await screen.findByRole('button', { name: /Get started/ }))
    const iban = await screen.findByLabelText('IBAN')
    try {
      expect(iban).toBeDisabled()
    } finally {
      settingsReady.resolve()
    }
    await waitFor(() => expect(iban).toBeEnabled())
    await user.type(iban, 'CH00 not an IBAN')
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    expect(await screen.findByLabelText('IBAN')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('heading', { name: 'Your company' })).toBeInTheDocument()
    expect(finished).toBe(0)
    expect(saved).toHaveLength(0)
  })

  test.each([
    ['My workspace', [{ name: 'Muster Treuhand GmbH' }]],
    ['Muster GmbH', []],
  ])('saving the company names a workspace still called "%s"', async (name, expected) => {
    workspaceName = name
    const user = userEvent.setup()
    wrap(<Welcome />)
    await user.click(await screen.findByRole('button', { name: /Get started/ }))
    const company = await screen.findByRole('heading', { name: 'Your company' })
    await waitFor(() => expect(company).toHaveFocus())
    await user.type(screen.getByLabelText('Company name'), 'Muster Treuhand GmbH')
    await user.type(screen.getByLabelText('IBAN'), 'CH9300762011623852957')
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    expect(await screen.findByRole('heading', { name: 'Add your logo' })).toBeInTheDocument()
    expect(renamed).toEqual(expected)
  })

  test('walks through the company, logo and defaults, saving each, then opens a next step', async () => {
    const user = userEvent.setup()
    wrap(<Welcome />)
    await user.click(await screen.findByRole('button', { name: /Get started/ }))

    const company = await screen.findByRole('heading', { name: 'Your company' })
    await waitFor(() => expect(company).toHaveFocus())
    await user.type(screen.getByLabelText('Company name'), 'Muster GmbH')
    await user.click(screen.getByLabelText(/Registered for VAT/))
    await user.type(screen.getByLabelText('UID number'), '109322552')
    expect(screen.getByLabelText('UID number')).toHaveValue('109.322.552')
    await user.type(screen.getByLabelText('IBAN'), 'CH93 0076 2011 6238 5295 8')
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    expect(await screen.findByText(/UID number isn’t valid/)).toBeInTheDocument()
    expect(screen.getByText(/check digits don’t match/)).toBeInTheDocument()
    expect(screen.getByLabelText('IBAN')).toHaveAttribute('aria-invalid', 'true')
    expect(saved).toHaveLength(0)

    await user.clear(screen.getByLabelText('UID number'))
    await user.type(screen.getByLabelText('UID number'), '109322551')
    await user.clear(screen.getByLabelText('IBAN'))
    await user.type(screen.getByLabelText('IBAN'), 'ch9300762011623852957')
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    expect(await screen.findByRole('heading', { name: 'Add your logo' })).toBeInTheDocument()
    expect(saved[0]).toMatchObject({
      seller: { name: 'Muster GmbH', country: 'CH', vat_number: 'CHE-109.322.551 MWST' },
      vat_registered: true,
      default_vat_mode: 'exclusive',
      iban: 'CH9300762011623852957',
    })

    await user.click(screen.getByRole('button', { name: 'Skip' }))
    expect(await screen.findByRole('heading', { name: 'Invoice defaults' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Français' }))
    await user.click(screen.getByRole('radio', { name: '60 days' }))
    await user.click(screen.getByRole('button', { name: /Continue/ }))

    expect(await screen.findByRole('heading', { name: 'You’re all set' })).toBeInTheDocument()
    // The UID follows the invoice language.
    expect(saved[1]).toMatchObject({
      language: 'fr',
      default_terms_days: 60,
      currency: 'CHF',
      seller: { vat_number: 'CHE-109.322.551 TVA' },
    })
    // Reaching the end is finishing: a reload here does not start over.
    await waitFor(() => expect(finished).toBe(1))
    expect(screen.getByText(/Still needed to issue invoices: IBAN/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Add your first client/ }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/clients?new=1'))
    expect(finished).toBe(1)
  })
})
