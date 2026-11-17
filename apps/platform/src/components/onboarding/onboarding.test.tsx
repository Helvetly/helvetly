import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'

import { AIApprovalProvider } from '@/components/ai/ai-approval'
import { billingFixture } from '@/components/billing/billing-fixture'
import type { Session } from '@/lib/api'
import type { Billing } from '@/lib/billing'
import type { HeidiUsage } from '@/lib/heidi'
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
let asked: unknown[] = [] // any call to the (retired) name-suggestion endpoint
let workspaceName = 'Muster GmbH'
let usage: HeidiUsage = { ...noAI() }
let uploads = 0
let billing: Billing = billingFixture({ enabled: false, locked: false })
function noAI(): HeidiUsage {
  return {
    period: '2026-11',
    tokens_used: 0,
    tokens_included: null,
    tokens_purchased: 0,
    tokens_remaining: null,
    provider_available: false,
  }
}
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

// The welcome keeps the confirmed name in this browser; each test starts without it.
afterEach(() => localStorage.clear())

const server = setupServer(
  http.get('/api/v1/session', () => HttpResponse.json(session())),
  http.get('/api/v1/billing', () => HttpResponse.json({ data: billing })),
  http.get('/api/v1/heidi/usage', () => HttpResponse.json(usage)),
  http.post('/api/v1/imports', () => {
    uploads++
    return HttpResponse.json({ error: { code: 'x', message: 'x' } }, { status: 500 })
  }),
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
    return HttpResponse.json({ error: { code: 'gone', message: 'gone' } }, { status: 410 })
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
  usage = noAI()
  uploads = 0
  finished = 0
  saved = []
  renamed = []
  named = []
  asked = []
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
      <TooltipProvider>
        <AIApprovalProvider>{children}</AIApprovalProvider>
      </TooltipProvider>
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
  // A workspace that already has its own name starts with it; the sign-up placeholder starts blank.
  const workspace = screen.getByRole('textbox', { name: /Workspace name/ })
  if (!(workspace as HTMLInputElement).value) await user.type(workspace, 'Muster Treuhand')
  await user.click(screen.getByRole('button', { name: /Get started/ }))
  // A step moves focus to its heading when it has rendered; typing before that loses the first keys.
  const company = await screen.findByRole('heading', { name: 'Your company' })
  await waitFor(() => expect(company).toHaveFocus())
}

/** A write that answers only when the test lets it. */
const gated = () => {
  const { promise: gate, resolve: open } = Promise.withResolvers<void>()
  return { gate, open }
}

describe('focus and scroll after a step change', () => {
  // The worst order: the animation frame runs before React commits the next step, so focusing "the heading"
  // then would hit the old one, which the commit removes. The new heading must get it after the commit.
  test("the new step's heading takes focus and its scroller starts at the top, whatever the frame order", async () => {
    workspaceName = 'Muster Treuhand'
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((frame) => {
      frame(0)
      return 0
    })
    const user = userEvent.setup()
    wrap(<Welcome />)
    await user.type(
      await screen.findByRole('textbox', { name: /What should we call you\?/ }),
      'Anna',
    )
    const scroller = screen.getByRole('main').parentElement as HTMLElement
    scroller.scrollTop = 120
    await user.click(screen.getByRole('button', { name: /Get started/ }))
    const company = await screen.findByRole('heading', { name: 'Your company' })
    expect(company).toHaveFocus()
    expect(scroller.scrollTop).toBe(0)
  })
})

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

const workspaceField = () => screen.getByRole('textbox', { name: /Workspace name/ })
const nameField = () => screen.findByRole('textbox', { name: /What should we call you\?/ })
const get = () => screen.getByRole('button', { name: /Get started/ })

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

  test('a name over 60 characters is refused before anything is sent', async () => {
    const user = userEvent.setup()
    wrap(<Welcome />)
    const input = await screen.findByRole('textbox', { name: /What should we call you\?/ })
    expect(input).toHaveAttribute('maxlength', '60')
    expect(workspaceField()).toHaveAttribute('maxlength', '50')
    fireEvent.change(input, { target: { value: 'x'.repeat(61) } })
    await user.click(get())
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter a name of up to 60 characters.')).toBeInTheDocument()
    expect(named).toEqual([])
  })

  test('an empty, over-long or refused name stays on the first step with its input', async () => {
    const user = userEvent.setup()
    wrap(<Welcome />)
    const input = await screen.findByRole('textbox', { name: /What should we call you\?/ })
    await user.click(screen.getByRole('button', { name: /Get started/ }))
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(input).toHaveFocus())
    expect(screen.getByText('Enter a name of up to 60 characters.')).toBeInTheDocument()
    server.use(
      http.patch('/api/v1/account', () =>
        HttpResponse.json(
          {
            error: {
              code: 'validation_failed',
              message: 'Check the highlighted fields.',
              details: { fields: { name: 'Enter a name of up to 60 characters.' } },
            },
          },
          { status: 422 },
        ),
      ),
    )
    await user.type(input, 'Anna')
    await user.click(screen.getByRole('button', { name: /Get started/ }))
    expect(await screen.findByText('Enter a name of up to 60 characters.')).toBeInTheDocument()
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

  describe('the workspace name on the first step', () => {
    test('starts blank for the sign-up placeholder', async () => {
      workspaceName = 'My workspace'
      wrap(<Welcome />)
      await nameField()
      expect(workspaceField()).toHaveValue('')
    })

    test('keeps a chosen name, editable, trimmed, saved with the account name before Company', async () => {
      workspaceName = 'Muster GmbH'
      const user = userEvent.setup()
      wrap(<Welcome />)
      await user.type(await nameField(), 'Anna')
      expect(workspaceField()).toHaveValue('Muster GmbH')
      await user.clear(workspaceField())
      await user.type(workspaceField(), '  Muster AG  ')
      await user.click(get())
      expect(await screen.findByRole('heading', { name: 'Your company' })).toBeInTheDocument()
      expect(named).toEqual([{ name: 'Anna' }])
      expect(renamed).toEqual([{ name: 'Muster AG' }])
      expect(finished).toBe(0)
    })

    test('an unchanged chosen name sends no workspace request', async () => {
      workspaceName = 'Muster GmbH'
      const user = userEvent.setup()
      wrap(<Welcome />)
      await start(user)
      expect(renamed).toEqual([])
    })

    test.each([
      ['', 'Required'],
      ['   ', 'Required'],
      ['x'.repeat(51), 'Enter a name of up to 50 characters.'],
    ])('the blank or over-long workspace name %j sends nothing', async (value, message) => {
      workspaceName = 'My workspace'
      const user = userEvent.setup()
      wrap(<Welcome />)
      await user.type(await nameField(), 'Anna')
      // maxLength stops typing at 50, so a longer value goes in without typing.
      fireEvent.change(workspaceField(), { target: { value } })
      await user.click(get())
      expect(workspaceField()).toHaveAttribute('aria-invalid', 'true')
      expect(screen.getAllByText(message).length).toBeGreaterThan(0)
      expect(named).toHaveLength(0)
      expect(renamed).toHaveLength(0)
    })

    test('a refused workspace name keeps both values, and the retry repeats only the workspace write', async () => {
      workspaceName = 'My workspace'
      const user = userEvent.setup()
      wrap(<Welcome />)
      await user.type(await nameField(), 'Anna')
      await user.type(workspaceField(), 'Taken')
      server.use(
        http.patch('/api/v1/workspace', () =>
          HttpResponse.json(
            { error: { code: 'invalid_request', message: 'That workspace name is taken.' } },
            { status: 400 },
          ),
        ),
      )
      await user.click(get())
      expect(await screen.findByText('That workspace name is taken.')).toBeInTheDocument()
      expect(workspaceField()).toHaveValue('Taken')
      expect(await nameField()).toHaveValue('Anna')
      expect(screen.queryByRole('heading', { name: 'Your company' })).not.toBeInTheDocument()
      server.resetHandlers()
      await user.clear(workspaceField())
      await user.type(workspaceField(), 'Free')
      await user.click(get())
      expect(await screen.findByRole('heading', { name: 'Your company' })).toBeInTheDocument()
      expect(named).toEqual([{ name: 'Anna' }]) // saved once, not again
      expect(renamed).toEqual([{ name: 'Free' }])
    })

    test('a refused account name keeps both values and sends no workspace request', async () => {
      workspaceName = 'My workspace'
      const user = userEvent.setup()
      wrap(<Welcome />)
      await user.type(await nameField(), 'Anna')
      await user.type(workspaceField(), 'Muster')
      server.use(
        http.patch('/api/v1/account', () =>
          HttpResponse.json(
            { error: { code: 'server_error', message: 'Try again.' } },
            { status: 500 },
          ),
        ),
      )
      await user.click(get())
      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
      expect(workspaceField()).toHaveValue('Muster')
      expect(renamed).toHaveLength(0)
      server.resetHandlers()
      await user.click(get())
      expect(await screen.findByRole('heading', { name: 'Your company' })).toBeInTheDocument()
      expect(renamed).toEqual([{ name: 'Muster' }])
    })

    test('both inputs stay locked through both saves, so what advances is what is shown', async () => {
      workspaceName = 'My workspace'
      const account = gated()
      const workspace = gated()
      server.use(
        http.patch('/api/v1/account', async ({ request }) => {
          await account.gate
          const input = (await request.json()) as { name: string }
          named.push(input)
          return HttpResponse.json({ data: { ...session().user, name: input.name } })
        }),
        http.patch('/api/v1/workspace', async ({ request }) => {
          await workspace.gate
          renamed.push(await request.json())
          return HttpResponse.json({ data: { id: 'wsp_1', name: 'x', timezone: 'Europe/Zurich' } })
        }),
      )
      const user = userEvent.setup()
      wrap(<Welcome />)
      await user.type(await nameField(), 'Anna')
      await user.type(workspaceField(), 'Submitted Workspace')
      await user.click(get())
      await waitFor(() => expect(workspaceField()).toHaveAttribute('readonly'))
      await user.type(workspaceField(), ' Latest') // ignored while the account write is pending
      expect(workspaceField()).toHaveValue('Submitted Workspace')
      account.open()
      await waitFor(() => expect(named).toHaveLength(1))
      expect(workspaceField()).toHaveAttribute('readonly') // still locked for the workspace write
      expect(await nameField()).toHaveAttribute('readonly')
      workspace.open()
      expect(await screen.findByRole('heading', { name: 'Your company' })).toBeInTheDocument()
      expect(renamed).toEqual([{ name: 'Submitted Workspace' }])
    })

    test('a double submit in one tick sends each write once', async () => {
      workspaceName = 'My workspace'
      const user = userEvent.setup()
      wrap(<Welcome />)
      await user.type(await nameField(), 'Anna')
      await user.type(workspaceField(), 'Muster')
      const form = workspaceField().closest('form') as HTMLFormElement
      // Raw events, not fireEvent: no render happens between the two, as with a fast double click.
      const submit = () =>
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      submit()
      submit()
      expect(await screen.findByRole('heading', { name: 'Your company' })).toBeInTheDocument()
      expect(named).toEqual([{ name: 'Anna' }])
      expect(renamed).toEqual([{ name: 'Muster' }])
    })

    test('a failed save unlocks both inputs for a correction', async () => {
      workspaceName = 'My workspace'
      const user = userEvent.setup()
      wrap(<Welcome />)
      await user.type(await nameField(), 'Anna')
      await user.type(workspaceField(), 'Taken')
      server.use(
        http.patch('/api/v1/workspace', () =>
          HttpResponse.json(
            { error: { code: 'invalid_request', message: 'That workspace name is taken.' } },
            { status: 400 },
          ),
        ),
      )
      await user.click(get())
      expect(await screen.findByText('That workspace name is taken.')).toBeInTheDocument()
      await waitFor(() => expect(workspaceField()).not.toHaveAttribute('readonly'))
      expect(await nameField()).not.toHaveAttribute('readonly')
      await user.type(workspaceField(), '2')
      expect(workspaceField()).toHaveValue('Taken2')
    })

    test('Company has no workspace field, editing it changes nothing, and nothing asks for a suggestion', async () => {
      workspaceName = 'My workspace'
      const user = userEvent.setup()
      wrap(<Welcome />)
      await start(user)
      await fillCompany(user, 'Muster Treuhand GmbH')
      expect(screen.queryByRole('textbox', { name: /Workspace name/ })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Suggest a name/ })).not.toBeInTheDocument()
      await user.type(screen.getByLabelText('IBAN'), 'CH9300762011623852957')
      await user.click(screen.getByRole('button', { name: /Continue/ }))
      expect(await screen.findByRole('heading', { name: 'Add your logo' })).toBeInTheDocument()
      expect(renamed).toEqual([{ name: 'Muster Treuhand' }]) // only the first step's write
      expect(asked).toHaveLength(0)
    })

    test('going back keeps the typed values', async () => {
      workspaceName = 'My workspace'
      const user = userEvent.setup()
      wrap(<Welcome />)
      await start(user, 'Anna')
      await user.click(screen.getByRole('button', { name: /Back/ }))
      expect(await nameField()).toHaveValue('Anna')
      expect(workspaceField()).toHaveValue('Muster Treuhand')
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

    test('the number format starts as the workspace has it, shows this year’s example and is saved', async () => {
      const user = userEvent.setup()
      await toDefaults(user, { ...empty, number_format: '{YYYY}/{NNN}' })
      const year = new Date().getFullYear()
      expect(screen.getByText(`Your next invoice: ${year}/001`)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /Number format/ }))
      await user.click(await screen.findByRole('option', { name: new RegExp(`RE-${year}-001`) }))
      expect(screen.getByText(`Your next invoice: RE-${year}-001`)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /Continue/ }))
      await waitFor(() => expect(saved.at(-1)?.number_format).toBe('RE-{YYYY}-{NNN}'))
    })

    test('a preset number format follows the company’s country', async () => {
      const user = userEvent.setup()
      server.use(http.get('/api/v1/invoice-settings', () => HttpResponse.json({ data: empty })))
      wrap(<Welcome />)
      await start(user)
      await fillCompany(user)
      await user.click(screen.getByRole('button', { name: /^Country/ }))
      await user.click(await screen.findByRole('option', { name: /United States/ }))
      await user.click(screen.getByRole('button', { name: /Continue/ }))
      await user.click(await screen.findByRole('button', { name: 'Skip' }, { timeout: 5000 }))
      await screen.findByRole('heading', { name: 'Invoice defaults' }, { timeout: 5000 })
      expect(screen.getByText('Your next invoice: INV-0001')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /Number format/ }))
      expect(await screen.findByRole('option', { name: /^00001/ })).toBeInTheDocument()
    })

    test('a custom number format is built from placeholders, checked and saved', async () => {
      const user = userEvent.setup()
      await toDefaults(user)
      const year = new Date().getFullYear()
      await user.click(screen.getByRole('button', { name: /Number format/ }))
      await user.click(await screen.findByRole('option', { name: /Custom format/ }))
      const field = screen.getByRole('textbox', { name: 'Custom format' })
      await user.clear(field)
      await user.type(field, 'FV/')
      const savedBefore = saved.length
      const placeholders = within(screen.getByRole('group', { name: 'Insert a placeholder' }))
      await user.click(screen.getByRole('button', { name: /Continue/ }))
      expect(await screen.findByText('Put the running number in exactly once.')).toBeInTheDocument()
      expect(saved).toHaveLength(savedBefore)
      await user.click(placeholders.getByRole('button', { name: /Running number/ }))
      await waitFor(() => expect(field).toHaveFocus()) // the caret lands after the placeholder a frame later
      await user.type(field, '/', { skipClick: true })
      await user.click(placeholders.getByRole('button', { name: /{YYYY}/ }))
      expect(field).toHaveValue('FV/{NNN}/{YYYY}')
      expect(screen.getByText(`Your next invoice: FV/001/${year}`)).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: /Continue/ }))
      await waitFor(() => expect(saved.at(-1)?.number_format).toBe('FV/{NNN}/{YYYY}'))
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

describe('a reload on the welcome', () => {
  test('keeps the name this person confirmed, while it is still the account name', async () => {
    localStorage.setItem('helvetly.onboarding-name.usr_1', 'Anna Muster')
    wrap(<Welcome />)
    expect(await nameField()).toHaveValue('Anna Muster')
    expect(
      await screen.findByRole('heading', { name: 'Welcome to Helvetly, Anna Muster' }),
    ).toBeInTheDocument()
  })

  test('starts empty when the kept name no longer matches the account', async () => {
    localStorage.setItem('helvetly.onboarding-name.usr_1', 'Pete')
    wrap(<Welcome />)
    expect(await nameField()).toHaveValue('')
  })
})

const available = () => {
  usage = {
    ...noAI(),
    provider_available: true,
    consent: { granted: false, changed_at: null, changed_by: '' },
  }
}
const toImport = async (user: User) => {
  await toDefaults(user)
  await user.click(screen.getByRole('button', { name: /Continue/ }))
  await screen.findByRole('heading', { name: 'Bring your data' })
}

describe('the import step', () => {
  test('is absent without an AI model: five steps, the defaults lead to the end', async () => {
    const user = userEvent.setup()
    await toDefaults(user)
    expect(screen.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('max', '5')
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    await screen.findByRole('heading', { name: /all set/ })
  })

  test('comes before the last step when AI is available, and Skip goes on', async () => {
    available()
    const user = userEvent.setup()
    await toImport(user)
    expect(screen.getByRole('progressbar', { name: 'Setup progress' })).toHaveAttribute('max', '6')
    expect(screen.getByText('Step 5 of 6')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await screen.findByRole('heading', { name: /all set/ })
    expect(screen.getByText('Import your clients')).toBeInTheDocument()
  })

  test('declining the AI approval keeps the chosen files and sends nothing', async () => {
    available()
    const user = userEvent.setup()
    await toDefaults(user)
    await user.click(screen.getByRole('button', { name: /Continue/ }))
    await screen.findByRole('heading', { name: 'Bring your data' })
    await user.click(screen.getByRole('button', { name: 'Import documents' }))
    const drawer = await screen.findByRole('dialog')
    const input = drawer.querySelector('input[type=file]') as HTMLInputElement
    await user.upload(input, new File(['a,b'], 'clients.csv', { type: 'text/csv' }))
    await user.click(within(drawer).getByRole('button', { name: 'Read files' }))
    await user.click(await screen.findByRole('button', { name: 'Not now' }))
    expect(await within(drawer).findByText('clients.csv')).toBeInTheDocument()
    expect(uploads).toBe(0)
  })
})
