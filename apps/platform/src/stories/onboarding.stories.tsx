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

export const Welcome: Story = {
  play: async ({ canvasElement }) => {
    const welcome = within(await step(canvasElement, 'welcome'))
    // Each step fades in.
    await waitFor(() =>
      expect(welcome.getByRole('heading', { name: 'Welcome to Helvetly, Anna' })).toBeVisible(),
    )
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

export const Company: Story = {
  play: async ({ canvasElement }) => {
    await next(canvasElement, 'welcome', /Get started/)
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
    await next(canvasElement, 'welcome', /Get started/)
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

export const AllSteps: Story = {
  play: async ({ canvasElement }) => {
    await next(canvasElement, 'welcome', /Get started/)
    const company = within(await step(canvasElement, 'company'))
    await waitFor(() =>
      expect(company.getByRole('heading', { name: 'Your company' })).toBeVisible(),
    )
    await next(canvasElement, 'company', /Continue/)
    await next(canvasElement, 'logo', /^Continue/)
    await next(canvasElement, 'preferences', /Continue/)
    const done = within(await step(canvasElement, 'done'))
    await waitFor(() => expect(done.getByRole('heading', { name: 'You’re all set' })).toBeVisible())
    await expect(done.getByText('Your company is ready to issue invoices')).toBeVisible()
    await Promise.all(
      [/Add your first client/, /Create an invoice/, /Import your clients/, /Ask Heidi/].map(
        (name) => waitFor(() => expect(done.getByRole('button', { name })).toBeEnabled()),
      ),
    )
  },
}

export const AllStepsDark: Story = { ...AllSteps, parameters: { dark: true } }

/** A real 300 × 200 picture, drawn in the browser, so the cropper and the encoding run as for a person's file. */
async function logoFile(type = 'image/png') {
  const canvas = document.createElement('canvas')
  canvas.width = 300
  canvas.height = 200
  const context = canvas.getContext('2d')
  if (!context) throw new Error('no 2d context')
  context.fillStyle = 'teal'
  context.fillRect(0, 0, 300, 200)
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
    await next(canvasElement, 'welcome', /Get started/)
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

/** The document logo starts as the whole picture: saved untouched, the same bytes the person picked. */
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
    await next(canvasElement, 'welcome', /Get started/)
    await next(canvasElement, 'company', /Continue/)
    const logos = within(await step(canvasElement, 'logo'))
    const field = logos
      .getByTestId('logo-drop')
      .parentElement?.querySelector<HTMLInputElement>('input[type=file]')
    if (!field) throw new Error('no file input')
    const picked = await logoFile()
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
    await next(canvasElement, 'welcome', /Get started/)
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
    await next(canvasElement, 'welcome', /Get started/)
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
    await next(canvasElement, 'welcome', /Get started/)
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
