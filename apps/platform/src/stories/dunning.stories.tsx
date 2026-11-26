import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import { TooltipProvider } from '@helvetly/ui/components/tooltip'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { DunningCard } from '@/components/invoices/dunning-card'
import type { FieldErrors } from '@/components/section-form'
import { DunningSteps, type StepDraft } from '@/components/settings/dunning-steps'
import { InvoiceSettingsPage } from '@/components/settings/invoice-settings'
import type { Dunning } from '@/lib/dunning'
import type { SettingsInput } from '@/lib/invoices'
import { sampleInvoice, sampleSettings } from '@/test/invoice-api'

const session = {
  user: { id: 'usr_story', email: 'anna@example.com', name: 'Anna Muster', avatar_url: null },
  workspace: { id: 'wrk_story', name: 'Muster AG', timezone: 'Europe/Zurich' },
  role: 'owner',
  scopes: ['*:*'],
  onboarded: true,
  csrf_token: 'storybook-only',
}

const meta = { title: 'Invoices/Dunning', parameters: { layout: 'fullscreen' } } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const saved: { body: Partial<SettingsInput> | null } = { body: null }
// read through a call, so the reset in play does not narrow it to null
const lastSaved = () => saved.body

const settingsHandlers = (refuse = false) => [
  http.get('/api/v1/session', () => HttpResponse.json(session)),
  http.get('/api/v1/invoice-settings', () => HttpResponse.json({ data: sampleSettings() })),
  http.put<never, Partial<SettingsInput>>('/api/v1/invoice-settings', async ({ request }) => {
    saved.body = await request.json()
    if (refuse)
      return HttpResponse.json(
        {
          error: {
            code: 'validation_failed',
            message: 'Check the highlighted fields.',
            details: { fields: { 'dunning.steps.2.fee': 'Enter a fee such as 20.00.' } },
          },
        },
        { status: 422 },
      )
    return HttpResponse.json({ data: sampleSettings() })
  }),
]

// A column like the app's SidebarInset: the page fills the width under its header.
const settingsPage = () => (
  <SidebarProvider>
    <div className="flex min-w-0 flex-1 flex-col">
      <InvoiceSettingsPage />
    </div>
  </SidebarProvider>
)

/** The settings section: a step is edited in its dialog (a fee off the 0.05 steps is refused there), Apply changes the draft and the section's Save sends it. */
export const Settings: Story = {
  parameters: { msw: { handlers: settingsHandlers() } },
  render: settingsPage,
  play: async ({ canvasElement }) => {
    saved.body = null
    const page = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await page.findByRole('switch', { name: 'Send reminders automatically' }))
    const section = within(page.getByRole('region', { name: 'Dunning' }))
    await expect(section.getByText('10 days after due · no fee')).toBeVisible()
    await userEvent.click(section.getByRole('button', { name: 'Edit Reminder 2' }))
    const dialog = within(await body.findByRole('dialog', { name: 'Edit Reminder 2' }))
    const fee = dialog.getByRole('textbox', { name: 'Fee' })
    await userEvent.clear(fee)
    await userEvent.type(fee, '2.33')
    await userEvent.click(dialog.getByRole('button', { name: 'Apply' }))
    await expect(dialog.getByText('From 0 to 1000.00, in steps of 0.05.')).toBeVisible()
    await userEvent.clear(fee)
    await userEvent.type(fee, '20')
    await userEvent.click(dialog.getByRole('button', { name: 'Apply' }))
    await expect(
      section.getByText('14 days after the previous · CHF 20.00 fee'),
    ).toBeVisible()
    await expect(section.getByText('Unsaved changes')).toBeVisible()
    await userEvent.click(section.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(lastSaved()?.dunning?.steps[1]?.fee).toBe('20.00'))
    await expect(await section.findByText('Saved')).toBeVisible()
    await expect(lastSaved()?.dunning?.enabled).toBe(true)
    await userEvent.click(page.getByRole('switch', { name: 'Default interest' }))
    await expect(page.getByRole('radio', { name: 'The first reminder' })).toBeChecked()
  },
}

/** The server refuses a step's field: the row says so and its dialog opens with the field marked. */
export const SettingsRefused: Story = {
  parameters: { msw: { handlers: settingsHandlers(true) } },
  render: settingsPage,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await page.findByRole('switch', { name: 'Send reminders automatically' }))
    const section = within(page.getByRole('region', { name: 'Dunning' }))
    await userEvent.click(section.getByRole('button', { name: 'Save' }))
    await expect(await section.findByText('Enter a fee such as 20.00.')).toBeVisible()
    await userEvent.click(section.getByRole('button', { name: 'Edit Final reminder' }))
    const dialog = within(await body.findByRole('dialog', { name: 'Edit Final reminder' }))
    await expect(dialog.getByRole('textbox', { name: 'Fee' })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  },
}

const draft = (change: Partial<StepDraft>): StepDraft => ({
  key: crypto.randomUUID(),
  name: '',
  timing: 'after_previous',
  days: '14',
  fee: '0.00',
  qr_bill: true,
  ...change,
})

const full = [
  draft({ name: 'Freundlicher Hinweis', timing: 'before_due', days: '3', qr_bill: false }),
  draft({ timing: 'after_due', days: '10', fee: '0.00' }),
  draft({ fee: '20.00' }),
  draft({ fee: '30.00' }),
]

const NO_ERRORS: FieldErrors = {}

function Steps({ initial, errors = NO_ERRORS }: { initial: StepDraft[]; errors?: FieldErrors }) {
  const [steps, setSteps] = useState(initial)
  return (
    <TooltipProvider>
      <div className="max-w-2xl rounded-2xl bg-card px-5 py-5 ring-1 ring-border sm:px-7">
        <DunningSteps steps={steps} currency="CHF" errors={errors} onChange={setSteps} />
      </div>
    </TooltipProvider>
  )
}

const phone = {
  viewport: { options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } } },
}

/** The default three steps as a timeline after the due date. */
export const StepsDefault: Story = {
  render: () => (
    <Steps initial={[draft({ timing: 'after_due', days: '10' }), draft({}), draft({})]} />
  ),
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(page.getByText('Due date')).toBeVisible()
    await expect(page.getByText('Payment reminder')).toBeVisible()
    await expect(page.getByText('Final reminder')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add a reminder' })).toBeEnabled()
  },
}

/** A note before the due date and three reminders with fees. */
export const StepsFull: Story = {
  render: () => <Steps initial={full} />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    await expect(
      page.getByText('3 days before due · friendly note · no QR bill'),
    ).toBeVisible()
    await expect(
      page.getByText('14 days after the previous · CHF 30.00 fee'),
    ).toBeVisible()
    const items = within(page.getByRole('list', { name: 'Reminders' })).getAllByRole('listitem')
    await expect(items[1]).toHaveTextContent('Due date')
  },
}

/** Editing in the dialog: the standard text preview, steps out of order refused, a new timing, Remove with confirmation. */
export const StepsEditing: Story = {
  render: () => <Steps initial={full} />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(page.getByRole('button', { name: 'Edit Payment reminder' }))
    let dialog = within(await body.findByRole('dialog', { name: 'Edit Payment reminder' }))
    await waitFor(() => expect(dialog.getByText(/According to our records/)).toBeVisible())
    await userEvent.click(dialog.getByRole('radio', { name: 'Before due' }))
    await expect(dialog.queryByRole('textbox', { name: 'Fee' })).toBeNull()
    await userEvent.click(dialog.getByRole('button', { name: 'Apply' }))
    await expect(dialog.getByText(/Count from the due date after a note before it/)).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(body.queryByRole('dialog')).toBeNull())

    await userEvent.click(page.getByRole('button', { name: 'Edit Final reminder' }))
    dialog = within(await body.findByRole('dialog', { name: 'Edit Final reminder' }))
    await userEvent.click(dialog.getByRole('radio', { name: 'After due' }))
    const days = dialog.getByRole('textbox', { name: 'Days' })
    await userEvent.clear(days)
    await userEvent.type(days, '10')
    await userEvent.click(dialog.getByRole('button', { name: 'Apply' }))
    await expect(dialog.getByText('Each reminder must come after the one before it.')).toBeVisible()
    await userEvent.clear(days)
    await userEvent.type(days, '30')
    await userEvent.click(dialog.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(body.queryByRole('dialog')).toBeNull())
    await expect(page.getByText('30 days after due · CHF 30.00 fee')).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Edit Final reminder' }))
    dialog = within(await body.findByRole('dialog', { name: 'Edit Final reminder' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Remove reminder' }))
    await userEvent.click(await body.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(body.queryByRole('dialog')).toBeNull())
    await expect(page.queryByText('Letzte Aufforderung vor der Betreibung.')).toBeNull()
    await expect(
      within(page.getByRole('list', { name: 'Reminders' })).getAllByRole('listitem'),
    ).toHaveLength(4)
  },
}

/** A step the server refused is marked in the list. */
export const StepsError: Story = {
  render: () => (
    <Steps initial={full} errors={{ 'dunning_steps.3.fee': 'Enter a fee such as 20.00.' }} />
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('Enter a fee such as 20.00.')).toBeVisible()
  },
}

export const StepsDark: Story = { ...StepsFull, parameters: { dark: true } }

export const StepsPhone: Story = {
  ...StepsEditing,
  parameters: phone,
  globals: { viewport: { value: 'phone' } },
}

let state: Dunning
const fresh = (): Dunning => ({
  applies: true,
  enabled: true,
  client_enabled: true,
  paused: false,
  next: { level: 1, levels: 2, title: 'Zahlungserinnerung', due_on: '2026-12-15' },
  notices: [],
})
const invoice = sampleInvoice({ id: 'inv_story', number: '2026-014', status: 'open' })

/** The invoice's card: send by hand moves to the final level, which then can be sent as well; pause in between. */
export const InvoiceCard: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/invoices/:id/dunning', () => HttpResponse.json({ data: state })),
        http.post<{ action: string }>('/api/v1/invoices/:id/dunning/:action', ({ params }) => {
          if (params.action === 'pause' || params.action === 'resume') {
            state = { ...state, paused: params.action === 'pause' }
            return HttpResponse.json({ data: state })
          }
          const next = state.next
          if (!next)
            return HttpResponse.json(
              { error: { code: 'invalid_state', message: 'None left.' } },
              { status: 409 },
            )
          state = {
            ...state,
            next:
              next.level < next.levels
                ? { ...next, level: 2, title: 'Letzte Mahnung', due_on: '2026-12-29' }
                : null,
            notices: [
              ...state.notices,
              {
                level: next.level,
                levels: next.levels,
                title: next.title,
                sent_at: '2026-11-09T09:00:00Z',
                sent_on: '2026-11-09',
                confirmed: true,
                open_amount: '1081.00',
                fee: next.level === 1 ? '0.00' : '20.00',
                interest: next.level === 1 ? '0.00' : '2.05',
                total: next.level === 1 ? '1081.00' : '1103.05',
                interest_rate: next.level === 1 ? '0' : '5',
                interest_from: next.level === 1 ? null : '2026-11-10',
                email: 'ap@kunde.ch',
                sent_by: 'Anna Muster',
              },
            ],
          }
          return HttpResponse.json({ data: state })
        }),
      ],
    },
  },
  render: () => (
    <TooltipProvider>
      <div className="max-w-md">
        <DunningCard invoice={invoice} canManage />
      </div>
    </TooltipProvider>
  ),
  play: async ({ canvasElement }) => {
    state = fresh()
    const page = within(canvasElement)
    await expect(await page.findByText('Zahlungserinnerung goes out on 15 Dec 2026.')).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Send reminder' }))
    await expect(await page.findByText('Letzte Mahnung goes out on 29 Dec 2026.')).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Pause' }))
    await expect(
      await page.findByText('Paused: no reminder goes out until you resume.'),
    ).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Resume' }))
    // The buttons stay disabled (pointer-events: none) until the resume request settles.
    const sendFinal = await page.findByRole('button', { name: 'Send final reminder' })
    await waitFor(() => expect(sendFinal).toBeEnabled())
    await userEvent.click(sendFinal)
    await expect(await page.findByText('All reminders were sent.')).toBeVisible()
    const sent = page.getByRole('list', { name: 'Reminders sent' })
    await expect(
      within(sent)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Zahlungserinnerung', 'Letzte Mahnung'])
    await expect(within(sent).getByText('interest CHF 2.05')).toBeVisible()
    await expect(within(sent).getAllByText('To ap@kunde.ch · by Anna Muster')).toHaveLength(2)
    await expect(sent.querySelectorAll('time[datetime="2026-11-09T09:00:00Z"]')).toHaveLength(2)
    await expect(page.queryByRole('button')).not.toBeInTheDocument()
  },
}

export const InvoiceCardDark: Story = {
  ...InvoiceCard,
  parameters: { ...InvoiceCard.parameters, dark: true },
}

/** Dunning is off for this invoice: Pause has nothing to stop, so it is disabled and its tooltip says why; one sent by the hourly job reads "automatically". */
export const InvoiceCardDunningOff: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/invoices/:id/dunning', () =>
          HttpResponse.json({
            data: {
              ...fresh(),
              enabled: false,
              next: { level: 2, levels: 2, title: 'Letzte Mahnung', due_on: '2026-12-29' },
              notices: [
                {
                  level: 1,
                  levels: 2,
                  title: 'Zahlungserinnerung',
                  sent_at: '2026-11-09T09:00:00Z',
                  sent_on: '2026-11-09',
                  confirmed: true,
                  open_amount: '1081.00',
                  fee: '0.00',
                  interest: '0.00',
                  total: '1081.00',
                  interest_rate: '0',
                  interest_from: null,
                  email: 'ap@kunde.ch',
                  sent_by: null,
                },
              ],
            } satisfies Dunning,
          }),
        ),
      ],
    },
  },
  render: InvoiceCard.render,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement)
    const body = within(canvasElement.ownerDocument.body)
    const pause = await page.findByRole('button', { name: 'Pause' })
    await expect(pause).toBeDisabled()
    await userEvent.hover(pause.parentElement ?? pause)
    await expect(await body.findByRole('tooltip')).toHaveTextContent('nothing to pause')
    await expect(page.getByRole('button', { name: 'Send final reminder' })).toBeEnabled()
    await expect(page.getByText('To ap@kunde.ch · automatically')).toBeVisible()
  },
}

/** A reminder the mail server may have taken (the connection dropped) says its delivery is not confirmed. */
export const InvoiceCardDeliveryUnconfirmed: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/invoices/:id/dunning', () =>
          HttpResponse.json({
            data: {
              ...fresh(),
              next: { level: 2, levels: 2, title: 'Letzte Mahnung', due_on: '2026-12-29' },
              notices: [
                {
                  level: 1,
                  levels: 2,
                  title: 'Zahlungserinnerung',
                  sent_at: '2026-11-09T09:00:00Z',
                  sent_on: '2026-11-09',
                  confirmed: false,
                  open_amount: '1081.00',
                  fee: '0.00',
                  interest: '0.00',
                  total: '1081.00',
                  interest_rate: '0',
                  interest_from: null,
                  email: 'ap@kunde.ch',
                  sent_by: null,
                },
              ],
            } satisfies Dunning,
          }),
        ),
      ],
    },
  },
  render: InvoiceCard.render,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText(
        'Delivery not confirmed: the mail server may have taken it, so it is not sent again.',
      ),
    ).toBeVisible()
  },
}
