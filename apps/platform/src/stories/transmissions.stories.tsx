import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { TransmissionsCard } from '@/components/invoices/transmissions-card'
import type { Transmission } from '@/lib/transmissions'

const meta = { title: 'Invoices/E-invoice transmissions' } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const base: Transmission = {
  id: 'trn_peppol',
  invoice_id: 'inv_story',
  channel: 'storecove',
  format: 'peppol',
  status: 'failed',
  external_id: null,
  attempts: 8,
  last_error: 'Recipient 0192:991825827 is not registered on Peppol.',
  created_at: '2026-11-09T10:00:00Z',
  updated_at: '2026-11-09T11:30:00Z',
  next_attempt_at: null,
}
const exported: Transmission = {
  ...base,
  id: 'trn_export',
  channel: 'export',
  format: 'xrechnung-ubl',
  status: 'sent',
  external_id: '2026-0042.xml',
  attempts: 1,
  last_error: null,
}

const retried: { id: string | null } = { id: null }
const lastRetried = () => retried.id

/** A failed Peppol transmission shows the provider's reason and is queued again; an export shows its file. */
export const FailedAndExported: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/invoices/inv_story/transmissions', () =>
          HttpResponse.json({
            data: retried.id
              ? [{ ...base, status: 'queued', last_error: null }, exported]
              : [base, exported],
          }),
        ),
        http.post<{ tid: string }>(
          '/api/v1/invoices/inv_story/transmissions/:tid/retry',
          ({ params }) => {
            retried.id = params.tid
            return HttpResponse.json({ data: { ...base, status: 'queued' } }, { status: 202 })
          },
        ),
      ],
    },
  },
  render: () => (
    <div className="max-w-md p-6">
      <TransmissionsCard invoiceId="inv_story" canManage />
    </div>
  ),
  play: async ({ canvasElement }) => {
    retried.id = null
    const page = within(canvasElement)
    await expect(await page.findByText(/not registered on Peppol/)).toBeVisible()
    await expect(page.getByText(/Sent · .* · 2026-0042\.xml/)).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(lastRetried()).toBe('trn_peppol'))
    await waitFor(() =>
      expect(page.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument(),
    )
    await expect(page.getByText(/Queued ·/)).toBeVisible()
  },
}
