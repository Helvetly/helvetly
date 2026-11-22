import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { SendDialog } from '@/components/invoices/invoice-dialogs'
import { QuoteSendDialog } from '@/components/quotes/quote-dialogs'
import { RecipientFields } from '@/components/recipient-fields'
import type { Client } from '@/lib/clients'
import { sampleQuote } from '@/mocks/quotes'
import { listItem, sampleInvoice } from '@/test/invoice-api'
import { sampleClient } from '@/test/invoice-fixtures'

import { sessionHandler } from './screen-fixtures'

const meta = { title: 'Invoices/Send email dialogs' } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const draft = {
  to: ['billing@acme.ch'],
  subject: 'Invoice 2026-001 from Muster GmbH',
  message: 'Hello\n\nPlease find attached our invoice 2026-001.\n\nKind regards\nMuster GmbH',
}
const noClient = http.get('/api/v1/clients/:id', () =>
  HttpResponse.json({ error: { code: 'not_found', message: 'No.' } }, { status: 404 }),
)
const sent: { body: Record<string, unknown> | null } = { body: null }
const read = () => sent.body
const sendHandler = http.post<never, Record<string, unknown>>(
  '/api/v1/invoices/:id/send',
  async ({ request }) => {
    sent.body = await request.json()
    return HttpResponse.json({ data: sampleInvoice() })
  },
)
const invoice = listItem(sampleInvoice({ status: 'open', number: '2026-001' }))

/** The draft fills To, Subject and Message once it arrives (fields disabled meanwhile) and Send posts them as shown. */
export const InvoicePrefilled: Story = {
  parameters: {
    msw: {
      handlers: [
        noClient,
        sendHandler,
        http.get('/api/v1/invoices/:id/email', async () => {
          await delay(300)
          return HttpResponse.json({ data: { ...draft, reply_to: 'office@muster.ch' } })
        }),
      ],
    },
  },
  render: () => <SendDialog invoice={invoice} onClose={() => {}} />,
  play: async ({ canvasElement }) => {
    sent.body = null
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('dialog'))
    await expect(dialog.getByRole('textbox', { name: /^Subject/ })).toBeDisabled()
    await waitFor(() =>
      expect(dialog.getByRole('textbox', { name: /^Subject/ })).toHaveValue(draft.subject),
    )
    await expect(dialog.getByRole('textbox', { name: /^Message/ })).toHaveValue(draft.message)
    await expect(dialog.getByText('Replies go to office@muster.ch')).toBeVisible()
    // The whole prefilled message is in view, without scrolling the field.
    const field = dialog.getByRole('textbox', { name: /^Message/ })
    await expect(field.scrollHeight).toBeLessThanOrEqual(field.clientHeight)
    await userEvent.click(dialog.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(read()).toEqual(draft))
  },
}

/** The draft cannot be built: fields stay empty and editable, and sending still works (the server writes the default). */
export const QuoteDraftFailed: Story = {
  parameters: {
    msw: {
      handlers: [
        noClient,
        http.get('/api/v1/quotes/:id/email', () =>
          HttpResponse.json({ error: { code: 'internal', message: 'No.' } }, { status: 500 }),
        ),
      ],
    },
  },
  render: () => <QuoteSendDialog quote={sampleQuote()} onClose={() => {}} />,
  play: async ({ canvasElement }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('dialog'))
    await waitFor(() => expect(dialog.getByRole('textbox', { name: /^Subject/ })).toBeEnabled())
    await expect(dialog.getByRole('textbox', { name: /^Subject/ })).toHaveValue('')
    await expect(dialog.getByRole('textbox', { name: /^Message/ })).toHaveValue('')
  },
}

/** Email is not set up: Send explains it, and Mark as sent records it sent (buttons wait meanwhile). */
export const InvoiceMailDownMarkSent: Story = {
  parameters: {
    msw: {
      handlers: [
        noClient,
        http.get('/api/v1/invoices/:id/email', () => HttpResponse.json({ data: draft })),
        http.post<never, Record<string, unknown>>(
          '/api/v1/invoices/:id/send',
          async ({ request }) => {
            sent.body = await request.json()
            if (sent.body.email !== false)
              return HttpResponse.json(
                {
                  error: {
                    code: 'mail_unavailable',
                    message: 'Email is not set up on this server.',
                  },
                },
                { status: 503 },
              )
            await delay(400)
            return HttpResponse.json({ data: sampleInvoice({ sent_at: '2026-11-18T10:00:00Z' }) })
          },
        ),
      ],
    },
  },
  render: () => <SendDialog invoice={invoice} onClose={() => {}} />,
  play: async ({ canvasElement }) => {
    sent.body = null
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('dialog'))
    await waitFor(() =>
      expect(dialog.getByRole('textbox', { name: /^Subject/ })).toHaveValue(draft.subject),
    )
    await userEvent.click(dialog.getByRole('button', { name: 'Send' }))
    await expect(
      await dialog.findByText(/Mark the invoice as sent, then send the PDF yourself/),
    ).toBeVisible()
    const mark = dialog.getByRole('button', { name: 'Mark as sent' })
    await userEvent.click(mark)
    await waitFor(() => expect(mark).toBeDisabled())
    await waitFor(() => expect(read()).toEqual({ email: false }))
  },
}

/**
 * Opening puts the cursor in To, not on the (?) beside its label: no tip pops up on its own, keyboard focus
 * still shows it, and Mark as sent is an outlined button with an icon at the left of the footer.
 */
export const InvoiceOpensInTo: Story = {
  parameters: {
    msw: {
      handlers: [
        noClient,
        sendHandler,
        http.get('/api/v1/invoices/:id/email', async () => {
          await delay(300)
          return HttpResponse.json({ data: draft })
        }),
      ],
    },
  },
  render: () => <SendDialog invoice={invoice} onClose={() => {}} />,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const dialog = within(await body.findByRole('dialog'))
    const to = dialog.getByRole('textbox', { name: /^To/ })
    await waitFor(() => expect(to).toHaveFocus())
    await expect(body.queryByRole('tooltip')).toBeNull()
    await waitFor(() => expect(to).toHaveValue('billing@acme.ch'))
    await expect(to).toHaveFocus()
    await userEvent.tab({ shift: true })
    await expect(dialog.getByRole('button', { name: /^About To/ })).toHaveFocus()
    await expect(await body.findByRole('tooltip')).toHaveTextContent(/Separate several addresses/)
    const mark = dialog.getByRole('button', { name: 'Mark as sent' })
    await expect(mark).toHaveAttribute('data-variant', 'outline')
    await expect(mark.querySelector('svg')).not.toBeNull()
    const cancel = dialog.getByRole('button', { name: 'Cancel' })
    await expect(mark.getBoundingClientRect().right).toBeLessThan(
      cancel.getBoundingClientRect().left,
    )
  },
}
export const InvoiceOpensInToPhone: Story = {
  ...InvoiceOpensInTo,
  globals: { viewport: { value: 'phone' } },
}

/** The dialog as it opens with its draft in, for the visual suite. */
export const InvoiceReady: Story = {
  parameters: {
    // The dialog opens with focus in To; the baseline shows it that way.
    visual: { keepFocus: true },
    msw: {
      handlers: [
        noClient,
        http.get('/api/v1/invoices/:id/email', () => HttpResponse.json({ data: draft })),
      ],
    },
  },
  render: () => <SendDialog invoice={invoice} onClose={() => {}} />,
  play: async ({ canvasElement }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('dialog'))
    await waitFor(() =>
      expect(dialog.getByRole('textbox', { name: /^Subject/ })).toHaveValue(draft.subject),
    )
  },
}

/**
 * The message box: Write with AI at its bottom left, the count at its bottom right, no resize grip, at most 2500
 * characters; a message the API refuses shows its reason under the field.
 */
export const MessageBox: Story = {
  parameters: {
    msw: {
      handlers: [
        noClient,
        http.get('/api/v1/invoices/:id/email', () => HttpResponse.json({ data: draft })),
        http.post('/api/v1/invoices/:id/send', () =>
          HttpResponse.json(
            {
              error: {
                code: 'validation_failed',
                message: 'Check the highlighted fields.',
                details: { fields: { message: 'Enter a message of at most 2500 characters.' } },
              },
            },
            { status: 422 },
          ),
        ),
      ],
    },
  },
  render: () => <SendDialog invoice={invoice} onClose={() => {}} />,
  play: async ({ canvasElement }) => {
    const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('dialog'))
    const field = dialog.getByRole('textbox', { name: /^Message/ })
    await waitFor(() => expect(field).toHaveValue(draft.message))
    const box = field.closest<HTMLElement>('[data-slot="textarea-box"]')
    if (!box) throw new Error('The message is not in a textarea box')
    const ai = within(box).getByRole('button', { name: 'Write with AI' })
    const count = box.querySelector('[data-slot="textarea-count"]')
    if (!count) throw new Error('The message box has no count')
    await expect(ai.getBoundingClientRect().right).toBeLessThan(count.getBoundingClientRect().left)
    await expect(getComputedStyle(field).resize).toBe('none')
    await expect(getComputedStyle(box).resize).toBe('none')

    await userEvent.clear(field)
    field.focus()
    await userEvent.paste('a'.repeat(2600))
    await expect(field).toHaveValue('a'.repeat(2500))
    await expect(count).toHaveTextContent('2500 / 2500')

    await userEvent.click(dialog.getByRole('button', { name: 'Send' }))
    await expect(
      await dialog.findByText('Enter a message of at most 2500 characters.'),
    ).toBeVisible()
    await expect(field).toHaveAttribute('aria-invalid', 'true')
  },
}

let customer: Client
/**
 * A client without an email: the dialog says so and opens the client's form in place on the email; once saved, the
 * address fills To.
 */
export const InvoiceClientWithoutEmail: Story = {
  parameters: {
    msw: {
      handlers: [
        sessionHandler(),
        http.get('/api/v1/clients/tags', () => HttpResponse.json({ data: [] })),
        http.get('/api/v1/clients/:id', () => HttpResponse.json({ data: customer })),
        http.patch<never, Partial<Client>>('/api/v1/clients/:id', async ({ request }) => {
          customer = { ...customer, ...(await request.json()) }
          return HttpResponse.json({ data: customer })
        }),
        http.get('/api/v1/invoices/:id/email', () =>
          HttpResponse.json({ data: { ...draft, to: [] } }),
        ),
      ],
    },
  },
  beforeEach: () => {
    customer = sampleClient({ id: invoice.client.id, email: null, billing_email: null })
  },
  render: () => <SendDialog invoice={invoice} onClose={() => {}} />,
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body)
    const dialog = within(await page.findByRole('dialog', { name: /Send/ }))
    await expect(await dialog.findByText('The client has no email address.')).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Add the client’s email' }))
    const form = await page.findByRole('dialog', { name: `Edit ${customer.name}` })
    const email = within(form).getByRole('textbox', { name: 'Email' })
    await waitFor(() => expect(email).toHaveFocus())
    await userEvent.type(email, 'anna@acme.ch')
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(form).not.toBeInTheDocument())
    await waitFor(() => expect(dialog.queryByText('The client has no email address.')).toBeNull())
    await expect(dialog.getByRole('textbox', { name: /^To/ })).toHaveValue('anna@acme.ch')
  },
}

/**
 * Cc and Bcc start folded: quiet buttons at the right of To's label reveal each with the cursor in it, an emptied one
 * folds away again on blur without moving To within the dialog, and Send posts both.
 */
export const InvoiceCopiesOnDemand: Story = {
  parameters: {
    msw: {
      handlers: [
        noClient,
        sendHandler,
        http.get('/api/v1/invoices/:id/email', () => HttpResponse.json({ data: draft })),
      ],
    },
  },
  render: () => <SendDialog invoice={invoice} onClose={() => {}} />,
  play: async ({ canvasElement }) => {
    sent.body = null
    const box = await within(canvasElement.ownerDocument.body).findByRole('dialog')
    const dialog = within(box)
    const to = dialog.getByRole('textbox', { name: /^To/ })
    // The centred dialog grows around its middle; inside it, To stays where it is.
    const toOffset = () => to.getBoundingClientRect().top - box.getBoundingClientRect().top
    await waitFor(() => expect(to).toHaveValue('billing@acme.ch'))
    await expect(dialog.queryByRole('textbox', { name: /^Cc/ })).toBeNull()
    await expect(dialog.queryByRole('textbox', { name: /^Bcc/ })).toBeNull()
    const ccButton = dialog.getByRole('button', { name: 'Cc' })
    const bccButton = dialog.getByRole('button', { name: 'Bcc' })
    // In To's label row, at its right.
    const toBox = to.getBoundingClientRect()
    await expect(bccButton.getBoundingClientRect().right).toBeCloseTo(toBox.right, 0)
    await expect(bccButton.getBoundingClientRect().bottom).toBeLessThanOrEqual(toBox.top)
    await expect(ccButton.getBoundingClientRect().right).toBeLessThan(
      bccButton.getBoundingClientRect().left,
    )
    const toTop = toOffset()

    await userEvent.click(bccButton)
    const bcc = dialog.getByRole('textbox', { name: /^Bcc/ })
    await expect(bcc).toHaveFocus()
    await expect(dialog.queryByRole('button', { name: 'Bcc' })).toBeNull()
    await expect(toOffset()).toBe(toTop)
    // Left empty, it folds away again.
    await userEvent.click(ccButton)
    const cc = dialog.getByRole('textbox', { name: /^Cc/ })
    await expect(cc).toHaveFocus()
    await expect(dialog.queryByRole('textbox', { name: /^Bcc/ })).toBeNull()
    await userEvent.type(cc, 'boss@acme.ch')
    await userEvent.click(dialog.getByRole('button', { name: 'Bcc' }))
    await userEvent.type(dialog.getByRole('textbox', { name: /^Bcc/ }), 'audit@muster.ch')
    // A field with addresses stays.
    await expect(dialog.getByRole('textbox', { name: /^Cc/ })).toHaveValue('boss@acme.ch')
    await expect(toOffset()).toBe(toTop)

    await userEvent.click(dialog.getByRole('button', { name: 'Send' }))
    await waitFor(() =>
      expect(read()).toEqual({ ...draft, cc: ['boss@acme.ch'], bcc: ['audit@muster.ch'] }),
    )
  },
}

/** A Cc that comes filled in shows from the start; Bcc stays folded behind its button. */
export const RecipientsWithPrefilledCc: Story = {
  render: () => (
    <div className="grid max-w-md gap-4 p-6">
      <RecipientFields
        id="story"
        to="billing@acme.ch"
        onToChange={fn()}
        toTip="Separate several addresses with commas."
        toPlaceholder="accounts@client.ch"
        cc="boss@acme.ch"
        onCcChange={fn()}
        bcc=""
        onBccChange={fn()}
        errors={{}}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('textbox', { name: /^Cc/ })).toHaveValue('boss@acme.ch')
    await expect(canvas.queryByRole('button', { name: 'Cc' })).toBeNull()
    await expect(canvas.queryByRole('textbox', { name: /^Bcc/ })).toBeNull()
    await expect(canvas.getByRole('button', { name: 'Bcc' })).toBeVisible()
  },
}
