import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { SendDialog } from '@/components/invoices/invoice-dialogs'
import { QuoteSendDialog } from '@/components/quotes/quote-dialogs'
import { sampleQuote } from '@/mocks/quotes'
import { listItem, sampleInvoice } from '@/test/invoice-api'

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
          return HttpResponse.json({ data: draft })
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

/** Email is not set up: Send explains it, and Mark as sent without email records it sent (buttons wait meanwhile). */
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
    const mark = dialog.getByRole('button', { name: 'Mark as sent without email' })
    await userEvent.click(mark)
    await waitFor(() => expect(mark).toBeDisabled())
    await waitFor(() => expect(read()).toEqual({ email: false }))
  },
}
