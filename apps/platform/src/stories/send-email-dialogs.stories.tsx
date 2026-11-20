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
