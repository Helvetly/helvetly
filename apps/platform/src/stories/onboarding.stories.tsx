import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { WelcomePage } from '@/components/onboarding/onboarding'
import type { Session } from '@/lib/api'
import { sampleSettings } from '@/test/invoice-api'

import { storySession } from './screen-fixtures'

const session: Session = { ...storySession, onboarded: false }
const settings = sampleSettings()

const meta = {
  title: 'Onboarding',
  parameters: {
    layout: 'fullscreen',
    ownMain: true,
    nextjs: { navigation: { pathname: '/welcome' } },
    msw: {
      handlers: [
        http.get('/api/v1/session', () => HttpResponse.json(session)),
        http.patch('/api/v1/account', async ({ request }) => {
          const input = (await request.json()) as { name: string }
          return HttpResponse.json({ data: { ...session.user, name: input.name } })
        }),
        http.post('/api/v1/session/onboarded', () => new HttpResponse(null, { status: 204 })),
        http.get('/api/v1/invoice-settings', () => HttpResponse.json({ data: settings })),
        http.put('/api/v1/invoice-settings', () => HttpResponse.json({ data: settings })),
      ],
    },
  },
  render: () => <WelcomePage session={session} />,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const step = (canvasElement: HTMLElement, name: string) =>
  within(canvasElement).findByTestId(`onboarding-step-${name}`)
const next = async (canvasElement: HTMLElement, from: string, label: RegExp) => {
  const current = within(await step(canvasElement, from))
  const button = await current.findByRole('button', { name: label })
  // A step's button stays disabled while the previous step still saves.
  await waitFor(() => expect(button).toBeEnabled())
  await userEvent.click(button)
}

/** The first step asks what to call the person and goes on once the name is saved. */
const begin = async (canvasElement: HTMLElement, name = 'Anna Muster') => {
  const welcome = within(await step(canvasElement, 'welcome'))
  await userEvent.type(
    await welcome.findByRole('textbox', { name: /What should we call you/ }),
    name,
  )
  await next(canvasElement, 'welcome', /Get started/)
}

export const Welcome: Story = {
  play: async ({ canvasElement }) => {
    const welcome = within(await step(canvasElement, 'welcome'))
    // Each step fades in.
    await waitFor(() =>
      expect(welcome.getByRole('heading', { name: 'Welcome to Helvetly' })).toBeVisible(),
    )
    // Nothing is guessed from the account: the name input starts empty.
    await expect(welcome.getByRole('textbox', { name: /What should we call you/ })).toHaveValue('')
    // The brand word wears the marketing italic; the orb is gone.
    const brand = canvasElement.querySelector('h1 .accent')
    await expect(brand).toHaveTextContent('Helvetly')
    await expect(getComputedStyle(brand as Element).fontStyle).toBe('italic')
    await expect(canvasElement.querySelector('.heidi-orb-halo')).toBeNull()
    const cards = welcome.getAllByRole('listitem')
    await expect(cards.length).toBeLessThanOrEqual(4)
    for (const title of [
      'Get paid',
      'Clients & documents',
      'Bring your data',
      'Heidi, your assistant',
    ])
      expect(welcome.getByText(title)).toBeVisible()
  },
}

export const WelcomeDark: Story = { ...Welcome, parameters: { dark: true } }

/** An empty name stays on the first step with its error; nothing is saved. */
export const NameRequired: Story = {
  play: async ({ canvasElement }) => {
    const welcome = within(await step(canvasElement, 'welcome'))
    const input = await welcome.findByRole('textbox', { name: /What should we call you/ })
    await userEvent.click(welcome.getByRole('button', { name: /Get started/ }))
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(input).toHaveFocus())
    await expect(welcome.getByText('Enter a name of up to 100 characters.')).toBeVisible()
    await expect(canvasElement.querySelector('[data-testid="onboarding-step-company"]')).toBeNull()
  },
}

/** The account refuses the name: the input and its text stay, and the step does not advance. */
export const NameRefused: Story = {
  parameters: {
    msw: {
      handlers: [
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
        ...meta.parameters.msw.handlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const welcome = within(await step(canvasElement, 'welcome'))
    const input = await welcome.findByRole('textbox', { name: /What should we call you/ })
    await userEvent.type(input, 'Anna')
    await userEvent.click(welcome.getByRole('button', { name: /Get started/ }))
    await expect(await welcome.findByText('Enter a name of up to 100 characters.')).toBeVisible()
    await expect(input).toHaveValue('Anna')
    await expect(canvasElement.querySelector('[data-testid="onboarding-step-company"]')).toBeNull()
  },
}

export const Company: Story = {
  play: async ({ canvasElement }) => {
    await begin(canvasElement)
    const company = within(await step(canvasElement, 'company'))
    const zip = company.getByLabelText(/^ZIP/)
    await waitFor(() => expect(zip).toBeEnabled())
    // Focusing a field leaves every field below it where it was.
    const iban = company.getByLabelText('IBAN')
    const before = iban.getBoundingClientRect().top
    await userEvent.click(zip)
    await expect(zip).toHaveFocus()
    await expect(iban.getBoundingClientRect().top).toBe(before)
  },
}

/** A new workspace: the company step has no way past it until the required details are in. */
/** A long step scrolls on its own: the page and the preview stay put, the bottom stays reachable. */
export const CompanyScroll: Story = {
  // The whole page, as in the app: no story padding around it.
  parameters: { bare: true },
  play: async ({ canvasElement }) => {
    await begin(canvasElement)
    const company = within(await step(canvasElement, 'company'))
    await waitFor(() => expect(company.getByLabelText(/^ZIP/)).toBeEnabled())
    const scroller = (await step(canvasElement, 'company')).closest<HTMLElement>(
      'main',
    )!.parentElement!
    const preview = canvasElement.querySelector('aside')!
    const doc = document.documentElement
    await expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)
    await expect(doc.scrollHeight).toBeLessThanOrEqual(window.innerHeight)
    const before = preview.getBoundingClientRect().top
    scroller.scrollTop = scroller.scrollHeight
    await waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(0))
    await expect(preview.getBoundingClientRect().top).toBe(before)
    await expect(doc.scrollTop).toBe(0)
    const button = company.getByRole('button', { name: /Continue/ })
    await expect(button).toBeVisible()
    const box = button.getBoundingClientRect()
    await expect(box.bottom).toBeLessThanOrEqual(scroller.getBoundingClientRect().bottom + 1)
    await next(canvasElement, 'company', /Continue/)
    const logo = within(await step(canvasElement, 'logo'))
    await waitFor(() => expect(logo.getByRole('heading', { level: 1 })).toHaveFocus())
    await expect(scroller.scrollTop).toBe(0)
  },
}

export const CompanyRequired: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/invoice-settings', () =>
          HttpResponse.json({
            data: sampleSettings({
              seller: {
                ...settings.seller,
                name: '',
                street: '',
                street_number: '',
                apt: null,
                zip: '',
                city: '',
              },
            }),
          }),
        ),
        ...meta.parameters.msw.handlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await begin(canvasElement)
    const company = within(await step(canvasElement, 'company'))
    await waitFor(() => expect(company.getByLabelText(/Company name/)).toBeEnabled())
    await expect(company.queryByRole('button', { name: /do it later|Skip/ })).toBeNull()
    await userEvent.click(company.getByRole('button', { name: /Continue/ }))
    const name = await company.findByLabelText(/Company name/)
    await expect(name).toHaveAttribute('aria-invalid', 'true')
    await waitFor(() => expect(name).toHaveFocus())
    await expect(company.getByLabelText(/Apt \/ suite/)).not.toHaveAttribute('aria-invalid')
    await expect(canvasElement.querySelector('[data-testid="onboarding-step-logo"]')).toBeNull()
  },
}

export const CompanyRequiredDark: Story = {
  ...CompanyRequired,
  parameters: { ...CompanyRequired.parameters, dark: true },
}

/** A new workspace still called "My workspace": the one-time AI name suggestion is offered, off until consented to. */
const newWorkspace: Session = {
  ...session,
  workspace: { ...session.workspace, name: 'My workspace' },
}
const suggestionHandlers = (reply: () => Response) => [
  http.post('/api/v1/workspace/name-suggestion', reply),
  ...meta.parameters.msw.handlers,
]
const toSuggestion = async (canvasElement: HTMLElement) => {
  await begin(canvasElement)
  const company = within(await step(canvasElement, 'company'))
  await waitFor(() => expect(company.getByLabelText(/Company name/)).toBeEnabled())
  return company
}

export const NameSuggestion: Story = {
  render: () => <WelcomePage session={newWorkspace} />,
  parameters: {
    msw: {
      handlers: suggestionHandlers(() =>
        HttpResponse.json({ data: { name: 'Muster', company_name: settings.seller.name } }),
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const company = await toSuggestion(canvasElement)
    const button = company.getByRole('button', { name: 'Suggest a name' })
    // Off until the person agrees: nothing is sent by default.
    const consent = company.getByRole('checkbox', { name: /Share only your company name/ })
    await expect(consent).not.toBeChecked()
    await expect(button).toBeDisabled()
    await userEvent.click(consent)
    await userEvent.click(button)
    await expect(
      await company.findByText('Workspace name suggested. You can edit it.'),
    ).toBeVisible()
    await expect(company.getByRole('textbox', { name: /Workspace name/ })).toHaveValue('Muster')
  },
}

export const NameSuggestionDark: Story = {
  ...NameSuggestion,
  parameters: { ...NameSuggestion.parameters, dark: true },
}

/** The provider is off or fails: a quiet note, and the name stays a plain field. */
export const NameSuggestionUnavailable: Story = {
  render: () => <WelcomePage session={newWorkspace} />,
  parameters: {
    msw: {
      handlers: suggestionHandlers(() =>
        HttpResponse.json(
          {
            error: {
              code: 'ai_not_configured',
              message: 'Name suggestions are not available on this server.',
            },
          },
          { status: 409 },
        ),
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const company = await toSuggestion(canvasElement)
    await userEvent.click(company.getByRole('checkbox', { name: /Share only your company name/ }))
    await userEvent.click(company.getByRole('button', { name: 'Suggest a name' }))
    await expect(
      await company.findByText('Name suggestions are unavailable. Enter a name yourself.'),
    ).toBeVisible()
    await expect(company.getByRole('textbox', { name: /Workspace name/ })).toBeEnabled()
  },
}

/** After the one use: the note says so and no control is left. */
export const NameSuggestionUsed: Story = {
  render: () => <WelcomePage session={newWorkspace} />,
  parameters: {
    msw: {
      handlers: suggestionHandlers(() =>
        HttpResponse.json({ error: { code: 'suggestion_used', message: 'used' } }, { status: 409 }),
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const company = await toSuggestion(canvasElement)
    await userEvent.click(company.getByRole('checkbox', { name: /Share only your company name/ }))
    await userEvent.click(company.getByRole('button', { name: 'Suggest a name' }))
    await expect(await company.findByText(/one-time suggestion has been used/)).toBeVisible()
    await expect(company.queryByRole('button', { name: 'Suggest a name' })).toBeNull()
  },
}

export const AllSteps: Story = {
  play: async ({ canvasElement }) => {
    await begin(canvasElement)
    const company = within(await step(canvasElement, 'company'))
    await waitFor(() =>
      expect(company.getByRole('heading', { name: 'Your company' })).toBeVisible(),
    )
    await next(canvasElement, 'company', /Continue/)
    await next(canvasElement, 'logo', /^Continue/)
    await next(canvasElement, 'preferences', /Continue/)
    const done = within(await step(canvasElement, 'done'))
    await waitFor(() =>
      expect(done.getByRole('heading', { name: 'You’re all set, Anna Muster' })).toBeVisible(),
    )
    await expect(done.getByText('Your company is ready to issue invoices')).toBeVisible()
    await Promise.all(
      [/Add your first client/, /Create an invoice/, /Import your clients/, /Ask Heidi/].map(
        (name) => waitFor(() => expect(done.getByRole('button', { name })).toBeEnabled()),
      ),
    )
  },
}

export const AllStepsDark: Story = { ...AllSteps, parameters: { dark: true } }

/** An IBAN still missing: a warning with its way out, and four neutral tiles (none looks selected). */
const withoutIban = sampleSettings({ iban: null, is_complete: false, missing_fields: ['iban'] })
export const MissingIban: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/invoice-settings', () => HttpResponse.json({ data: withoutIban })),
        http.put('/api/v1/invoice-settings', () => HttpResponse.json({ data: withoutIban })),
        ...meta.parameters.msw.handlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await begin(canvasElement)
    await next(canvasElement, 'company', /Continue/)
    await next(canvasElement, 'logo', /^Continue/)
    await next(canvasElement, 'preferences', /Continue/)
    const done = within(await step(canvasElement, 'done'))
    const warning = within(await done.findByRole('status'))
    await expect(warning.getByText('Still needed to issue invoices')).toBeVisible()
    await expect(warning.getByText('IBAN')).toBeVisible()
    await expect(warning.getByRole('button', { name: 'Finish in Settings' })).toBeVisible()
    // At rest the four tiles look the same: the first one is not picked out.
    const tiles = [
      /Add your first client/,
      /Create an invoice/,
      /Import your clients/,
      /Ask Heidi/,
    ].map((name) => done.getByRole('button', { name }))
    await waitFor(() => expect(tiles[0]).toBeEnabled())
    const borders = tiles.map((tile) => getComputedStyle(tile).borderTopColor)
    await expect(new Set(borders).size).toBe(1)
    await expect(done.getByText('⌘J')).toBeVisible()
  },
}

export const MissingIbanDark: Story = {
  ...MissingIban,
  parameters: { ...MissingIban.parameters, dark: true },
}

/** A real picture (300 × 200 unless told), drawn in the browser, so the cropper and the encoding run as for a person's file. */
async function logoFile(type = 'image/png', width = 300, height = 200) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no 2d context')
  context.fillStyle = 'teal'
  context.fillRect(0, 0, width, height)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type))
  if (!blob) throw new Error('no blob')
  return new File([blob], 'logo.png', { type })
}

const logoUploads: { path: string; type: string }[] = []
let workspaceLogoFails = true
const logoHandlers = [
  http.put('/api/v1/workspace/logo', async ({ request }) => {
    const file = (await request.formData()).get('file')
    logoUploads.push({ path: 'workspace', type: file instanceof File ? file.type : '' })
    if (workspaceLogoFails)
      return HttpResponse.json(
        { error: { code: 'internal', message: 'Storage is unavailable.' } },
        { status: 500 },
      )
    return HttpResponse.json({ data: { logo_url: '/api/v1/workspace/logo?v=1' } })
  }),
  ...meta.parameters.msw.handlers,
]

/** The logo step has both logos; choosing one opens its crop, and cancelling sends nothing. */
export const LogoCropCancel: Story = {
  parameters: { msw: { handlers: logoHandlers } },
  beforeEach: () => {
    logoUploads.length = 0
  },
  play: async ({ canvasElement }) => {
    await begin(canvasElement)
    await next(canvasElement, 'company', /Continue/)
    const logos = within(await step(canvasElement, 'logo'))
    await expect(logos.getByText('Document logo')).toBeVisible()
    await expect(logos.getByText('Workspace logo')).toBeVisible()
    const field = logos
      .getByTestId('workspace-logo')
      .querySelector<HTMLInputElement>('input[type=file]')
    if (!field) throw new Error('no file input')
    await userEvent.upload(field, await logoFile())
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'Adjust logo' }))
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Use this logo' })).toBeEnabled())
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
    await expect(logoUploads).toHaveLength(0)
  },
}

/**
 * The document logo starts as the whole picture: saved untouched, the same bytes the person picked, when the picture
 * already has the shape of the field on the PDF (45 × 18 mm, 2.5 : 1), here 1000 × 400.
 */
export const DocumentLogoWholePicture: Story = {
  parameters: {
    msw: {
      handlers: [
        http.put('/api/v1/invoice-settings/logo', async ({ request }) => {
          const file = (await request.formData()).get('file')
          logoUploads.push({
            path: 'document',
            type: file instanceof File ? `${file.type}:${file.size}` : '',
          })
          return HttpResponse.json({ data: settings })
        }),
        ...meta.parameters.msw.handlers,
      ],
    },
  },
  beforeEach: () => {
    logoUploads.length = 0
  },
  play: async ({ canvasElement }) => {
    await begin(canvasElement)
    await next(canvasElement, 'company', /Continue/)
    const logos = within(await step(canvasElement, 'logo'))
    const field = logos
      .getByTestId('logo-drop')
      .parentElement?.querySelector<HTMLInputElement>('input[type=file]')
    if (!field) throw new Error('no file input')
    const picked = await logoFile('image/png', 1000, 400)
    await userEvent.upload(field, picked)
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'Adjust logo' }))
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Use this logo' })).toBeEnabled())
    await userEvent.click(dialog.getByRole('button', { name: 'Use this logo' }))
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
    await expect(logoUploads).toEqual([{ path: 'document', type: `image/png:${picked.size}` }])
  },
}

/** A refused upload keeps the crop open with the reason; saving again retries it, and a success closes it. */
export const LogoUploadRetry: Story = {
  parameters: { msw: { handlers: logoHandlers } },
  beforeEach: () => {
    logoUploads.length = 0
    workspaceLogoFails = true
    return () => {
      workspaceLogoFails = true
    }
  },
  play: async ({ canvasElement }) => {
    await begin(canvasElement)
    await next(canvasElement, 'company', /Continue/)
    const logos = within(await step(canvasElement, 'logo'))
    const field = logos
      .getByTestId('workspace-logo')
      .querySelector<HTMLInputElement>('input[type=file]')
    if (!field) throw new Error('no file input')
    await userEvent.upload(field, await logoFile())
    const dialog = within(await within(document.body).findByRole('dialog', { name: 'Adjust logo' }))
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Use this logo' })).toBeEnabled())
    await userEvent.click(dialog.getByRole('button', { name: 'Use this logo' }))
    await expect(await dialog.findByRole('alert')).toHaveTextContent('Storage is unavailable.')
    workspaceLogoFails = false
    await userEvent.click(dialog.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(within(document.body).queryByRole('dialog')).toBeNull())
    // Both attempts sent the square PNG the browser made, not the picked file.
    await expect(logoUploads).toEqual([
      { path: 'workspace', type: 'image/png' },
      { path: 'workspace', type: 'image/png' },
    ])
  },
}

const termsSaved: number[] = []

/** The payment terms: a custom number of days, refused above 365 with the error, then saved as typed. */
export const PaymentTermsCustom: Story = {
  parameters: {
    msw: {
      handlers: [
        http.put('/api/v1/invoice-settings', async ({ request }) => {
          const body = (await request.json()) as { default_terms_days: number }
          termsSaved.push(body.default_terms_days)
          return HttpResponse.json({
            data: { ...settings, default_terms_days: body.default_terms_days },
          })
        }),
        ...meta.parameters.msw.handlers,
      ],
    },
  },
  beforeEach: () => {
    termsSaved.length = 0
  },
  play: async ({ canvasElement }) => {
    await begin(canvasElement)
    await next(canvasElement, 'company', /Continue/)
    await next(canvasElement, 'logo', /^Continue/)
    const prefs = within(await step(canvasElement, 'preferences'))
    await expect(prefs.getByRole('radio', { name: '30 days' })).toBeChecked()
    await expect(prefs.getByRole('button', { name: 'Payment terms' })).toBeVisible()
    await userEvent.click(prefs.getByRole('radio', { name: 'Custom' }))
    const days = prefs.getByLabelText('Number of days')
    await userEvent.clear(days)
    await userEvent.type(days, '366')
    termsSaved.length = 0
    await userEvent.click(prefs.getByRole('button', { name: /Continue/ }))
    await expect(await prefs.findByText('Enter 0 to 365 days.')).toBeVisible()
    await waitFor(() => expect(days).toHaveFocus())
    await expect(termsSaved).toHaveLength(0)
    await userEvent.clear(days)
    await userEvent.type(days, '45')
    await userEvent.click(prefs.getByRole('button', { name: /Continue/ }))
    await waitFor(() => expect(termsSaved).toEqual([45]))
  },
}

export const PaymentTermsCustomDark: Story = {
  ...PaymentTermsCustom,
  parameters: { ...PaymentTermsCustom.parameters, dark: true },
}

/** A save the server refuses: the step stays, with the reason in a danger callout above it. */
export const SaveError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.put('/api/v1/invoice-settings', () =>
          HttpResponse.json(
            { error: { code: 'internal', message: 'The settings could not be saved.' } },
            { status: 500 },
          ),
        ),
        ...meta.parameters.msw.handlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await begin(canvasElement)
    await next(canvasElement, 'company', /Continue/)
    const alert = await within(canvasElement).findByRole('alert')
    await expect(alert).toHaveAttribute('data-tone', 'danger')
    await expect(alert.querySelector('svg')).not.toBeNull()
    await expect(within(canvasElement).getByTestId('onboarding-step-company')).toBeVisible()
  },
}

export const SaveErrorDark: Story = {
  ...SaveError,
  parameters: { ...SaveError.parameters, dark: true },
}
