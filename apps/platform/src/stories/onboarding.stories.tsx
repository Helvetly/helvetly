import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { AIApprovalProvider } from '@/components/ai/ai-approval'
import { WelcomePage } from '@/components/onboarding/onboarding'
import type { Session } from '@/lib/api'
import type { HeidiUsage } from '@/lib/heidi'
import type { ImportBatch } from '@/lib/imports'
import { legalFormsHandler, sampleSettings } from '@/test/invoice-api'

import { storySession } from './screen-fixtures'

const session: Session = { ...storySession, onboarded: false }
const settings = sampleSettings()
const usage = (available: boolean, granted = false): HeidiUsage => ({
  period: '2026-11',
  tokens_used: 0,
  tokens_included: null,
  tokens_purchased: 0,
  tokens_remaining: null,
  provider_available: available,
  consent: { granted, changed_at: granted ? '2026-11-16T10:00:00Z' : null, changed_by: '' },
})

const meta = {
  title: 'Onboarding',
  // The welcome keeps a confirmed name in this browser; every story starts as a first visit.
  beforeEach: () => {
    localStorage.clear()
  },
  parameters: {
    layout: 'fullscreen',
    ownMain: true,
    nextjs: { navigation: { pathname: '/welcome' } },
    msw: {
      handlers: [
        http.get('/api/v1/session', () => HttpResponse.json(session)),
        http.get('/api/v1/heidi/usage', () => HttpResponse.json(usage(false))),
        http.patch('/api/v1/account', async ({ request }) => {
          const input = (await request.json()) as { name: string }
          return HttpResponse.json({ data: { ...session.user, name: input.name } })
        }),
        http.post('/api/v1/session/onboarded', () => new HttpResponse(null, { status: 204 })),
        http.get('/api/v1/invoice-settings', () => HttpResponse.json({ data: settings })),
        http.put('/api/v1/invoice-settings', () => HttpResponse.json({ data: settings })),
        legalFormsHandler,
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
  // A workspace that already has its own name starts with it; the sign-up placeholder starts blank.
  const workspace = await welcome.findByRole('textbox', { name: /Workspace name/ })
  if (!(workspace as HTMLInputElement).value) await userEvent.type(workspace, 'Muster Treuhand')
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
    // Only the two questions: no feature list competing with them.
    await expect(welcome.queryAllByRole('listitem')).toHaveLength(0)
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
    await expect(welcome.getByText('Enter a name of up to 60 characters.')).toBeVisible()
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
                details: { fields: { name: 'Enter a name of up to 60 characters.' } },
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
    await expect(await welcome.findByText('Enter a name of up to 60 characters.')).toBeVisible()
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

/** A new workspace still called "My workspace": its name is asked for here, blank and required, and never taken from the company. */
const newWorkspace: Session = {
  ...session,
  workspace: { ...session.workspace, name: 'My workspace' },
}

export const WorkspaceNameRequired: Story = {
  render: () => <WelcomePage session={newWorkspace} />,
  play: async ({ canvasElement }) => {
    const welcome = within(await step(canvasElement, 'welcome'))
    const workspace = await welcome.findByRole('textbox', { name: /Workspace name/ })
    await expect(workspace).toHaveValue('')
    await userEvent.type(
      welcome.getByRole('textbox', { name: /What should we call you/ }),
      'Anna Muster',
    )
    await userEvent.click(welcome.getByRole('button', { name: /Get started/ }))
    await waitFor(() => expect(workspace).toHaveAttribute('aria-invalid', 'true'))
    await expect(welcome.getAllByText('Required').length).toBeGreaterThan(0)
  },
}

export const WorkspaceNameRequiredDark: Story = {
  ...WorkspaceNameRequired,
  parameters: { ...WorkspaceNameRequired.parameters, dark: true },
}

/** The account name is saved but the workspace name is refused: both typed values stay and the reason shows. */
export const WorkspaceNameRefused: Story = {
  render: () => <WelcomePage session={newWorkspace} />,
  parameters: {
    msw: {
      handlers: [
        http.patch('/api/v1/workspace', () =>
          HttpResponse.json(
            { error: { code: 'invalid_request', message: 'That workspace name is taken.' } },
            { status: 400 },
          ),
        ),
        ...meta.parameters.msw.handlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const welcome = within(await step(canvasElement, 'welcome'))
    const workspace = await welcome.findByRole('textbox', { name: /Workspace name/ })
    await userEvent.type(
      welcome.getByRole('textbox', { name: /What should we call you/ }),
      'Anna Muster',
    )
    await userEvent.type(workspace, 'Muster Treuhand')
    await userEvent.click(welcome.getByRole('button', { name: /Get started/ }))
    await expect(await welcome.findByText('That workspace name is taken.')).toBeVisible()
    await expect(workspace).toHaveValue('Muster Treuhand')
    await expect(welcome.getByRole('textbox', { name: /What should we call you/ })).toHaveValue(
      'Anna Muster',
    )
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

/** With an AI model on the server, "Bring your data" sits before the last step and reuses the import drawer. */
const aiHandlers = (granted: boolean, extra: ReturnType<typeof http.get>[] = []) => [
  http.get('/api/v1/heidi/usage', () => HttpResponse.json(usage(true, granted))),
  http.put('/api/v1/heidi/consent', () =>
    HttpResponse.json({
      data: { granted: true, changed_at: '2026-11-16T10:00:00Z', changed_by: 'Anna' },
    }),
  ),
  http.get('/api/v1/imports', () => HttpResponse.json({ data: [] })),
  ...extra,
  ...meta.parameters.msw.handlers,
]
const withAI = (handlers: ReturnType<typeof aiHandlers>) => ({
  parameters: { msw: { handlers } },
  render: () => (
    <AIApprovalProvider>
      <WelcomePage session={session} />
    </AIApprovalProvider>
  ),
})

const toImportStep = async (canvasElement: HTMLElement) => {
  await begin(canvasElement)
  await next(canvasElement, 'company', /Continue/)
  await next(canvasElement, 'logo', /^Continue/)
  await next(canvasElement, 'preferences', /Continue/)
  const importing = within(await step(canvasElement, 'import'))
  const heading = await importing.findByRole('heading', { name: 'Bring your data' })
  await waitFor(() => expect(heading).toHaveFocus())
  return importing
}

const body = () => within(document.body)
const chooseFile = async () => {
  const input = await body().findByLabelText('Choose files to import')
  await userEvent.upload(input, new File(['name;email\nMuster AG;info@muster.ch'], 'clients.csv'))
  await expect(body().getByText('clients.csv')).toBeVisible()
}

/** The step is optional: a primary action to import and a Skip; the count includes it. */
export const ImportStepEmpty: Story = {
  ...withAI(aiHandlers(true)),
  play: async ({ canvasElement }) => {
    const importing = await toImportStep(canvasElement)
    await expect(canvasElement.querySelector('progress')).toHaveAttribute('max', '6')
    await expect(importing.getByRole('button', { name: 'Skip' })).toBeVisible()
    await expect(importing.getByRole('button', { name: 'Import documents' })).toBeEnabled()
  },
}

export const ImportStepEmptyDark: Story = {
  ...ImportStepEmpty,
  parameters: { ...ImportStepEmpty.parameters, dark: true },
}

/** The approval is asked when the files are read; Not now keeps them in the drawer. */
export const ImportStepConsent: Story = {
  ...withAI(aiHandlers(false)),
  play: async ({ canvasElement }) => {
    const importing = await toImportStep(canvasElement)
    await userEvent.click(importing.getByRole('button', { name: 'Import documents' }))
    await chooseFile()
    await userEvent.click(body().getByRole('button', { name: 'Process with AI' }))
    const ask = await body().findByRole('dialog', { name: 'Use AI in this workspace?' })
    await userEvent.click(within(ask).getByRole('button', { name: 'Not now' }))
    await waitFor(() =>
      expect(body().queryByRole('dialog', { name: 'Use AI in this workspace?' })).toBeNull(),
    )
    await expect(body().getByText('clients.csv')).toBeVisible()
  },
}

const reviewBatch: ImportBatch = {
  id: 'imp_onboarding',
  kind: 'auto',
  status: 'review',
  created_at: '2026-11-16T09:30:00Z',
  files: [
    {
      id: 'imf_1',
      name: 'clients.csv',
      size: 4800,
      status: 'done',
      error: null,
      chunks_done: 1,
      chunks_total: 1,
      reused: false,
      document_type: 'client_list',
    },
  ],
  records: [
    {
      id: 'imr_1',
      file_id: 'imf_1',
      kind: 'clients',
      status: 'pending',
      data: { name: 'Muster AG', email: 'info@muster.ch', city: 'Bern', country: 'CH' },
      issues: {},
      duplicate: null,
      entity_id: null,
      error: null,
    },
  ],
}

/** Approved: the files are read and the review shows the recognised documents, ready to import. */
export const ImportStepReview: Story = {
  ...withAI(
    aiHandlers(true, [
      http.post('/api/v1/imports', () => HttpResponse.json({ data: reviewBatch }, { status: 201 })),
      http.get('/api/v1/imports/:id', () => HttpResponse.json({ data: reviewBatch })),
    ]),
  ),
  play: async ({ canvasElement }) => {
    const importing = await toImportStep(canvasElement)
    await userEvent.click(importing.getByRole('button', { name: 'Import documents' }))
    await chooseFile()
    await userEvent.click(body().getByRole('button', { name: 'Process with AI' }))
    const review = await body().findByRole('region', { name: 'clients.csv' })
    await expect(within(review).getByText('Muster AG')).toBeVisible()
  },
}

/** No AI model on the server: no import step, five steps, and the defaults lead to the end. */
export const ImportStepAbsent: Story = {
  play: async ({ canvasElement }) => {
    await begin(canvasElement)
    await next(canvasElement, 'company', /Continue/)
    await next(canvasElement, 'logo', /^Continue/)
    await next(canvasElement, 'preferences', /Continue/)
    await within(await step(canvasElement, 'done')).findByRole('heading', { name: /all set/ })
    await expect(canvasElement.querySelector('progress')).toHaveAttribute('max', '5')
    await expect(canvasElement.querySelector('[data-testid="onboarding-step-import"]')).toBeNull()
  },
}

/** The invoice defaults offer the number format, with this year's next number under it. */
export const NumberFormat: Story = {
  play: async ({ canvasElement }) => {
    await begin(canvasElement)
    await next(canvasElement, 'company', /Continue/)
    await next(canvasElement, 'logo', /^Continue/)
    const prefs = within(await step(canvasElement, 'preferences'))
    const year = new Date().getFullYear()
    await expect(await prefs.findByText(`Your next invoice: ${year}-001`)).toBeVisible()
    await userEvent.click(prefs.getByRole('button', { name: /Number format/ }))
    await userEvent.click(
      await within(document.body).findByRole('option', { name: new RegExp(`RE-${year}-001`) }),
    )
    await expect(prefs.getByText(`Your next invoice: RE-${year}-001`)).toBeVisible()
  },
}

export const NumberFormatDark: Story = { ...NumberFormat, parameters: { dark: true } }
