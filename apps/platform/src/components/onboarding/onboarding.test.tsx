import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
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
let named: unknown[] = []
let asked: unknown[] = []
// What the one-time name suggestion answers; each test sets its own.
let suggestReply: () => Promise<Response> | Response = () =>
  HttpResponse.json({ data: { name: 'Muster', company_name: 'Muster Treuhand GmbH' } })
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
  http.patch('/api/v1/account', async ({ request }) => {
    const input = (await request.json()) as { name: string }
    named.push(input)
    return HttpResponse.json({ data: { ...session().user, name: input.name } })
  }),
  http.post('/api/v1/workspace/name-suggestion', async ({ request }) => {
    asked.push(await request.json())
    return suggestReply()
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
  named = []
  asked = []
  suggestReply = () =>
    HttpResponse.json({ data: { name: 'Muster', company_name: 'Muster Treuhand GmbH' } })
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

type User = ReturnType<typeof userEvent.setup>
/** The company step's required fields (the country starts on Switzerland). */
const fillCompany = async (user: User, name = 'Muster GmbH') => {
  await waitFor(() => expect(screen.getByLabelText(/Company name/)).toBeEnabled()) // once the settings have loaded
  await user.type(screen.getByLabelText(/Company name/), name)
  await user.type(screen.getByLabelText(/^Street/), 'Bahnhofstrasse')
  await user.type(screen.getByLabelText(/^Number/), '12')
  await user.type(screen.getByLabelText(/^ZIP/), '8001')
  await user.type(screen.getByLabelText(/^City/), 'Zürich')
}

/** The first step asks what to call the person; nothing is taken from the account. */
const start = async (user: User, name = 'Anna Muster') => {
  await user.type(await screen.findByRole('textbox', { name: /What should we call you\?/ }), name)
  await user.click(screen.getByRole('button', { name: /Get started/ }))
  // A step moves focus to its heading when it has rendered; typing before that loses the first keys.
  const company = await screen.findByRole('heading', { name: 'Your company' })
  await waitFor(() => expect(company).toHaveFocus())
}

const welcome = () => screen.findByRole('heading', { name: 'Welcome to Helvetly' })
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

  test('without a plan yet, the wait after Checkout stays put', async () => {
    billing = billingFixture()
    pathname = '/activating/'
    wrap(
      <OnboardingRedirect session={session()}>
        <p>The app</p>
      </OnboardingRedirect>,
    )
    expect(await screen.findByText('The app')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
  })

  test.each([
    ['/', '/welcome'],
    ['/welcome?next=%2F', '/welcome'],
    ['/activating/', '/welcome'],
    ['//evil.example', '/welcome'],
    ['/clients?id=cli_1', '/welcome?next=%2Fclients%3Fid%3Dcli_1'],
  ])('welcomeHref(%s) is %s', (next, want) => expect(welcomeHref(next)).toBe(want))
})

/** Walks a new workspace to the invoice defaults step, with `settings` as the server has them. */
const toDefaults = async (user: User, settings = empty) => {
  server.use(http.get('/api/v1/invoice-settings', () => HttpResponse.json({ data: settings })))
  wrap(<Welcome />)
  await start(user)
  await screen.findByRole('heading', { name: 'Your company' })
  await fillCompany(user)
  await user.click(screen.getByRole('button', { name: /Continue/ }))
  await screen.findByRole('heading', { name: 'Add your logo' }, { timeout: 5000 })
  await user.click(screen.getByRole('button', { name: 'Skip' }))
  await screen.findByRole('heading', { name: 'Invoice defaults' }, { timeout: 5000 })
}
const termsSaved = () => saved.at(-1)?.default_terms_days

const toCompany = async (user: User) => {
  workspaceName = 'My workspace'
  wrap(<Welcome />)
  await start(user)
  await screen.findByRole('heading', { name: 'Your company' })
  await fillCompany(user, 'Muster Treuhand GmbH')
}
const refuse = (code: string, status: number) => () =>
  HttpResponse.json({ error: { code, message: code } }, { status })

const suggestButton = () => screen.getByRole('button', { name: /Suggest a name|Suggesting/ })

const workspaceField = () => screen.getByRole('textbox', { name: /Workspace name/ })

const consent = () => screen.getByRole('checkbox', { name: /Share only your company name/ })

describe('the welcome', () => {
  test('shows on the first visit, with focus on its heading and the progress', async () => {
    wrap(<Welcome />)
    const heading = await welcome()
    await waitFor(() => expect(heading).toHaveFocus())
    expect(screen.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('max', '5')
  })

  test('has no orb, and typing a name leaves the typed heading alone', async () => {
    const user = userEvent.setup()
    const { container } = wrap(<Welcome />)
    const heading = await welcome()
    expect(container.querySelector('.heidi-orb-halo')).toBeNull()
    expect(heading.querySelector('.accent')).toHaveTextContent('Helvetly')
    const shown = () => heading.querySelector('[aria-hidden]')?.textContent
    await user.type(
      await screen.findByRole('textbox', { name: /What should we call you\?/ }),
      'Anna',
    )
    expect(shown()).toBe('Welcome to Helvetly')
    expect(heading).toHaveAccessibleName('Welcome to Helvetly')
  })

  test('asks what to call the person, empty, and greets with the saved answer only', async () => {
    const user = userEvent.setup()
    wrap(<Welcome />)
    await welcome()
    // The account is "Anna Muster", but the input starts empty and nothing is saved unasked.
    const input = await screen.findByRole('textbox', { name: /What should we call you\?/ })
    expect(input).toHaveValue('')
    expect(screen.queryByText(/Anna/)).not.toBeInTheDocument()
    expect(named).toHaveLength(0)
    await user.type(input, '  Dr. Anna-Maria Muster  ')
    await user.click(screen.getByRole('button', { name: /Get started/ }))
    expect(await screen.findByRole('heading', { name: 'Your company' })).toBeInTheDocument()
    expect(named).toEqual([{ name: 'Dr. Anna-Maria Muster' }])
    // Back on the first step the greeting is the full saved name, not its first word.
    await user.click(screen.getByRole('button', { name: /Back/ }))
    expect(
      await screen.findByRole('heading', { name: 'Welcome to Helvetly, Dr. Anna-Maria Muster' }),
    ).toBeInTheDocument()
  })

  test('an empty, over-long or refused name stays on the first step with its input', async () => {
    const user = userEvent.setup()
    wrap(<Welcome />)
    const input = await screen.findByRole('textbox', { name: /What should we call you\?/ })
    await user.click(screen.getByRole('button', { name: /Get started/ }))
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(input).toHaveFocus())
    expect(screen.getByText('Enter a name of up to 100 characters.')).toBeInTheDocument()
    server.use(
      http.patch('/api/v1/account', () =>
        HttpResponse.json(
          {
            error: {
              code: 'validation_failed',
              message: 'Check the highlighted fields.',
              details: { fields: { name: 'Enter a name of up to 100 characters.' } },
            },
          },
          { status: 422 },
        ),
      ),
    )
    await user.type(input, 'Anna')
    await user.click(screen.getByRole('button', { name: /Get started/ }))
    expect(await screen.findByText('Enter a name of up to 100 characters.')).toBeInTheDocument()
    expect(input).toHaveValue('Anna')
    expect(screen.queryByRole('heading', { name: 'Your company' })).not.toBeInTheDocument()
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
    await start(user)
    await screen.findByRole('heading', { name: 'Your company' })
    await user.keyboard('{Escape}')
    // The company step cannot be skipped, and cannot be left empty or with only some of it.
    expect(screen.queryByRole('button', { name: 'I’ll do it later' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    const name = await screen.findByLabelText(/Company name/)
    expect(name).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(name).toHaveFocus())
    expect(screen.getAllByText('Required').length).toBeGreaterThanOrEqual(5)
    expect(screen.getByRole('heading', { name: 'Your company' })).toBeInTheDocument()
    expect(saved).toHaveLength(0)
    expect(finished).toBe(0)
    expect(replace).not.toHaveBeenCalled()
    await user.type(name, 'Muster GmbH')
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    expect(await screen.findByLabelText(/^Street/)).toHaveFocus()
    expect(screen.getByLabelText(/Company name/)).not.toHaveAttribute('aria-invalid')
    expect(saved).toHaveLength(0)
  })

  test('a VAT-registered company needs its VAT number; the apartment is always optional', async () => {
    const user = userEvent.setup()
    wrap(<Welcome />)
    await start(user)
    await screen.findByRole('heading', { name: 'Your company' })
    await fillCompany(user)
    await user.click(screen.getByLabelText(/Registered for VAT/))
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    expect(await screen.findByLabelText('UID number')).toHaveAttribute('aria-invalid', 'true')
    expect(saved).toHaveLength(0)
    await user.click(screen.getByLabelText(/Registered for VAT/))
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    expect(await screen.findByRole('heading', { name: 'Add your logo' })).toBeInTheDocument()
    expect(saved[0]?.seller).toMatchObject({ apt: null, vat_number: null })
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
    await start(user)
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
    await start(user)
    const company = await screen.findByRole('heading', { name: 'Your company' })
    await waitFor(() => expect(company).toHaveFocus())
    await fillCompany(user, 'Muster Treuhand GmbH')
    await user.type(screen.getByLabelText('IBAN'), 'CH9300762011623852957')
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    expect(await screen.findByRole('heading', { name: 'Add your logo' })).toBeInTheDocument()
    expect(renamed).toEqual(expected)
  })

  test('the workspace name is its own field: it follows the company until edited, then never changes', async () => {
    workspaceName = 'My workspace'
    const user = userEvent.setup()
    wrap(<Welcome />)
    await start(user)
    await screen.findByRole('heading', { name: 'Your company' })
    await fillCompany(user, 'Muster Treuhand GmbH')
    const field = screen.getByRole('textbox', { name: /Workspace name/ })
    await waitFor(() => expect(field).toHaveValue('Muster Treuhand GmbH'))
    await user.clear(field)
    await user.type(field, 'Muster')
    await user.clear(screen.getByLabelText(/Company name/))
    await user.type(screen.getByLabelText(/Company name/), 'Muster Treuhand AG')
    expect(field).toHaveValue('Muster')
    await user.type(screen.getByLabelText('IBAN'), 'CH9300762011623852957')
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    expect(await screen.findByRole('heading', { name: 'Add your logo' })).toBeInTheDocument()
    expect(renamed).toEqual([{ name: 'Muster' }])
  })

  test('a name the person already chose is kept, and a blank or refused one blocks the step', async () => {
    workspaceName = 'Muster GmbH'
    const user = userEvent.setup()
    wrap(<Welcome />)
    await start(user)
    await screen.findByRole('heading', { name: 'Your company' })
    await fillCompany(user, 'Another Company AG')
    const field = screen.getByRole('textbox', { name: /Workspace name/ })
    expect(field).toHaveValue('Muster GmbH')
    await user.clear(field)
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(saved).toHaveLength(0)
    server.use(
      http.patch('/api/v1/workspace', () =>
        HttpResponse.json(
          {
            error: {
              code: 'invalid_request',
              message: 'Give the workspace a name of up to 100 characters.',
            },
          },
          { status: 400 },
        ),
      ),
    )
    await user.type(field, 'Bad name')
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    expect(await screen.findByText(/name of up to 100 characters/)).toBeInTheDocument()
    expect(field).toHaveValue('Bad name')
    expect(screen.getByRole('heading', { name: 'Your company' })).toBeInTheDocument()
  })

  describe('the one-time name suggestion', () => {
    test('asks nothing without the person ticking consent and entering a company', async () => {
      const user = userEvent.setup()
      workspaceName = 'My workspace'
      wrap(<Welcome />)
      await start(user)
      await screen.findByRole('heading', { name: 'Your company' })
      await waitFor(() => expect(consent()).toBeInTheDocument())
      expect(consent()).not.toBeChecked() // off by default
      expect(suggestButton()).toBeDisabled() // no company yet
      await fillCompany(user, 'Muster Treuhand GmbH')
      expect(suggestButton()).toBeDisabled() // no consent yet
      await user.click(consent())
      expect(suggestButton()).toBeEnabled()
      expect(asked).toHaveLength(0) // typing and ticking never call the model
    })

    test('one click sends only the company name and fills the untouched field, still editable', async () => {
      const user = userEvent.setup()
      await toCompany(user)
      await user.click(consent())
      await user.click(suggestButton())
      expect(
        await screen.findByText('Workspace name suggested. You can edit it.'),
      ).toBeInTheDocument()
      expect(asked).toEqual([{ company_name: 'Muster Treuhand GmbH', consent: true }])
      expect(workspaceField()).toHaveValue('Muster')
      await user.type(screen.getByLabelText('IBAN'), 'CH9300762011623852957')
      await user.click(screen.getByRole('button', { name: /Continue/ }))
      expect(await screen.findByRole('heading', { name: 'Add your logo' })).toBeInTheDocument()
      expect(renamed).toEqual([{ name: 'Muster' }])
    })

    test('a result that arrives after the company name changed is dropped', async () => {
      const user = userEvent.setup()
      const hold = Promise.withResolvers<void>()
      suggestReply = async () => {
        await hold.promise
        return HttpResponse.json({ data: { name: 'Muster', company_name: 'Muster Treuhand GmbH' } })
      }
      await toCompany(user)
      await user.click(consent())
      await user.click(suggestButton())
      expect(screen.getByRole('button', { name: /Suggesting/ })).toBeDisabled()
      await user.type(screen.getByLabelText(/Company name/), ' AG')
      hold.resolve()
      expect(await screen.findByText(/one-time suggestion has been used/)).toBeInTheDocument()
      expect(workspaceField()).toHaveValue('Muster Treuhand GmbH AG')
    })

    test('a result never overwrites a name the person typed meanwhile', async () => {
      const user = userEvent.setup()
      const hold = Promise.withResolvers<void>()
      suggestReply = async () => {
        await hold.promise
        return HttpResponse.json({ data: { name: 'Muster', company_name: 'Muster Treuhand GmbH' } })
      }
      await toCompany(user)
      await user.click(consent())
      await user.click(suggestButton())
      await user.clear(workspaceField())
      await user.type(workspaceField(), 'Mine')
      hold.resolve()
      expect(await screen.findByText(/one-time suggestion has been used/)).toBeInTheDocument()
      expect(workspaceField()).toHaveValue('Mine')
    })

    test.each([
      ['ai_unavailable', 502, 'We couldn’t suggest a name. Enter one yourself.', false],
      ['rate_limited', 429, 'We couldn’t suggest a name. Enter one yourself.', true],
      [
        'suggestion_used',
        409,
        'Your one-time suggestion has been used. Enter or edit the name yourself.',
        false,
      ],
      ['ai_not_configured', 409, 'Name suggestions are unavailable. Enter a name yourself.', false],
    ])(
      '%s leaves the manual name and %s only retries when nothing was spent',
      async (code, status, note, retry) => {
        const user = userEvent.setup()
        suggestReply = refuse(code, status)
        await toCompany(user)
        await user.click(consent())
        await user.click(suggestButton())
        expect(await screen.findByText(note)).toBeInTheDocument()
        expect(workspaceField()).toHaveValue('Muster Treuhand GmbH')
        expect(screen.queryByRole('button', { name: 'Suggest a name' }) !== null).toBe(retry)
        await user.clear(workspaceField())
        await user.type(workspaceField(), 'Muster')
        expect(workspaceField()).toHaveValue('Muster')
      },
    )

    test('is not offered where the person already chose the workspace name', async () => {
      const user = userEvent.setup()
      workspaceName = 'Muster GmbH'
      wrap(<Welcome />)
      await start(user)
      await screen.findByRole('heading', { name: 'Your company' })
      expect(
        screen.queryByRole('checkbox', { name: /Share only your company name/ }),
      ).not.toBeInTheDocument()
    })
  })

  test('the logo step asks for the workspace mark first, then the document logo', async () => {
    const user = userEvent.setup()
    wrap(<Welcome />)
    await start(user)
    await screen.findByRole('heading', { name: 'Your company' })
    await fillCompany(user)
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    await screen.findByRole('heading', { name: 'Add your logo' })
    const mark = screen.getByText('Workspace logo')
    const document = screen.getByText('Document logo')
    expect(mark.compareDocumentPosition(document) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  test('walks through the company, logo and defaults, saving each, then opens a next step', async () => {
    const user = userEvent.setup()
    wrap(<Welcome />)
    await start(user)

    const company = await screen.findByRole('heading', { name: 'Your company' })
    await waitFor(() => expect(company).toHaveFocus())
    await fillCompany(user)
    await user.type(screen.getByLabelText(/Apt \/ suite/), '  3rd floor ')
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
      seller: {
        name: 'Muster GmbH',
        street: 'Bahnhofstrasse',
        street_number: '12',
        apt: '3rd floor',
        zip: '8001',
        city: 'Zürich',
        country: 'CH',
        vat_number: 'CHE-109.322.551 MWST',
      },
      vat_registered: true,
      default_vat_mode: 'exclusive',
      iban: 'CH9300762011623852957',
    })

    await user.click(screen.getByRole('button', { name: 'Skip' }))
    expect(await screen.findByRole('heading', { name: 'Invoice defaults' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Français' }))
    await user.click(screen.getByRole('radio', { name: 'Custom' }))
    await user.clear(screen.getByLabelText('Number of days'))
    await user.type(screen.getByLabelText('Number of days'), '45')
    await user.click(screen.getByRole('button', { name: /Continue/ }))

    expect(
      await screen.findByRole('heading', { name: 'You’re all set, Anna Muster' }),
    ).toBeInTheDocument()
    // The UID follows the invoice language.
    expect(saved[1]).toMatchObject({
      language: 'fr',
      default_terms_days: 45,
      currency: 'CHF',
      seller: { vat_number: 'CHE-109.322.551 TVA' },
    })
    // Reaching the end is finishing: a reload here does not start over.
    await waitFor(() => expect(finished).toBe(1))
    // What is still missing is a warning with its way out, not one more list row.
    const warning = screen.getByRole('status')
    expect(warning).toHaveTextContent('Still needed to issue invoices')
    expect(warning).toHaveTextContent('IBAN')
    expect(within(warning).getByRole('button', { name: 'Finish in Settings' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: /Add your first client/ }))
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/clients?new=1'))
    expect(finished).toBe(1)
  })
  describe('payment terms', () => {
    test('offers 7, 14 and 30 days and Custom, with 30 chosen, and a help icon', async () => {
      const user = userEvent.setup({ delay: null })
      await toDefaults(user)
      for (const name of ['7 days', '14 days', '30 days', 'Custom'])
        expect(screen.getByRole('radio', { name })).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: '30 days' })).toBeChecked()
      expect(screen.queryByLabelText('Number of days')).toBeNull()
      expect(screen.getByRole('button', { name: 'Payment terms' })).toBeInTheDocument()
      await user.click(screen.getByRole('radio', { name: '14 days' }))
      await user.click(screen.getByRole('button', { name: /Continue/ }))
      await waitFor(() => expect(termsSaved()).toBe(14))
    })

    test('a saved 10 days is shown as Custom with its value and is sent unchanged', async () => {
      const user = userEvent.setup({ delay: null })
      await toDefaults(user, { ...empty, default_terms_days: 10 })
      expect(screen.getByRole('radio', { name: 'Custom' })).toBeChecked()
      expect(screen.getByLabelText('Number of days')).toHaveValue('10')
      await user.click(screen.getByRole('button', { name: /Continue/ }))
      await waitFor(() => expect(termsSaved()).toBe(10))
    })

    test.each([['0'], ['365'], ['45']])('custom %s days is saved as that number', async (text) => {
      const user = userEvent.setup({ delay: null })
      await toDefaults(user)
      await user.click(screen.getByRole('radio', { name: 'Custom' }))
      await user.clear(screen.getByLabelText('Number of days'))
      await user.type(screen.getByLabelText('Number of days'), text)
      await user.click(screen.getByRole('button', { name: /Continue/ }))
      await waitFor(() => expect(termsSaved()).toBe(Number(text)))
    })

    test.each([[''], ['-1'], ['366'], ['1.5'], ['abc']])(
      'custom "%s" is refused inline, focused, and not saved',
      async (text) => {
        const user = userEvent.setup({ delay: null })
        await toDefaults(user)
        await user.click(screen.getByRole('radio', { name: 'Custom' }))
        const field = screen.getByLabelText('Number of days')
        await user.clear(field)
        if (text) await user.type(field, text)
        const before = saved.length
        await user.click(screen.getByRole('button', { name: /Continue/ }))
        expect(await screen.findByText('Enter 0 to 365 days.')).toBeInTheDocument()
        expect(field).toHaveAttribute('aria-invalid', 'true')
        await waitFor(() => expect(field).toHaveFocus())
        expect(saved).toHaveLength(before)
        expect(screen.getByRole('heading', { name: 'Invoice defaults' })).toBeInTheDocument()
      },
    )

    test('the typed days stay when the server refuses the save', async () => {
      const user = userEvent.setup({ delay: null })
      await toDefaults(user)
      server.use(
        http.put('/api/v1/invoice-settings', () =>
          HttpResponse.json({ error: { code: 'internal', message: 'Nope.' } }, { status: 500 }),
        ),
      )
      await user.click(screen.getByRole('radio', { name: 'Custom' }))
      await user.clear(screen.getByLabelText('Number of days'))
      await user.type(screen.getByLabelText('Number of days'), '45')
      await user.click(screen.getByRole('button', { name: /Continue/ }))
      expect(await screen.findByRole('alert')).toBeInTheDocument()
      expect(screen.getByLabelText('Number of days')).toHaveValue('45')
      expect(screen.getByRole('heading', { name: 'Invoice defaults' })).toBeInTheDocument()
    })
  })
})
