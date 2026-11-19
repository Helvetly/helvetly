import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { InvoiceLinkField } from '@/components/engagements/invoice-link-field'
import { EngagementLink } from '@/components/invoices/engagement-link'

import { emptyPage } from './screen-fixtures'

const meta = {
  title: 'Shared flows/Engagement and invoice link',
  parameters: { layout: 'padded' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const engagements = [
  { id: 'eng_1', title: 'German lessons' },
  { id: 'eng_2', title: 'Brand guidelines' },
]
/** The picker's button once its options have loaded (it is off while there are none). */
const openable = async (canvas: HTMLElement, name: RegExp) => {
  const button = await within(canvas).findByRole('button', { name })
  await waitFor(() => expect(button).toBeEnabled())
  return button
}
const page = (data: unknown[]) => HttpResponse.json({ ...emptyPage, data })
const list = http.get('/api/v1/engagements', () => page(engagements))
const notLinked = http.get('/api/v1/invoices/:id/engagement', () =>
  HttpResponse.json({ data: null }),
)

function EditorRow({ clientId, invoiceId }: { clientId: string; invoiceId: string | null }) {
  const [pending, setPending] = useState('')
  return (
    <div className="w-80">
      <EngagementLink
        id="engagement-link"
        clientId={clientId}
        invoiceId={invoiceId}
        pending={pending}
        onPendingChange={setPending}
      />
      <Toaster />
    </div>
  )
}

/** The invoice editor's row without a client: off. */
export const EditorNoClient: Story = {
  parameters: { msw: { handlers: [list, notLinked] } },
  render: () => <EditorRow clientId="" invoiceId={null} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button')).toBeDisabled()
  },
}

/** A client without engagements: a new one is created in place instead of a dead picker. */
export const EditorNoCandidates: Story = {
  parameters: {
    msw: { handlers: [http.get('/api/v1/engagements', () => page([])), notLinked] },
  },
  render: () => <EditorRow clientId="cli_1" invoiceId="inv_1" />,
  play: async ({ canvasElement }) => {
    const create = await within(canvasElement).findByRole('button', { name: 'New engagement' })
    await expect(create).toBeEnabled()
    await userEvent.click(create)
    await expect(
      await within(document.body).findByRole('dialog', { name: /New engagement/ }),
    ).toBeVisible()
    // the accessibility check reads colours, so let the drawer finish fading in
    await Promise.allSettled(document.getAnimations().map((animation) => animation.finished))
  },
}

/** Picking attaches the saved draft and says so. */
export const EditorPicking: Story = {
  parameters: {
    msw: {
      handlers: [
        list,
        notLinked,
        http.post('/api/v1/engagements/:id/invoices', () =>
          HttpResponse.json({ data: { invoice_id: 'inv_1', period: {} } }, { status: 201 }),
        ),
      ],
    },
  },
  render: () => <EditorRow clientId="cli_1" invoiceId="inv_1" />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await openable(canvasElement, /Choose an engagement/))
    await userEvent.click(await within(document.body).findByText('German lessons'))
    await waitFor(() =>
      expect(within(document.body).getByText('Linked to German lessons.')).toBeVisible(),
    )
  },
}

/** The server refuses (the dates fit no period): the reason shows, nothing else changes. */
export const EditorLinkError: Story = {
  parameters: {
    msw: {
      handlers: [
        list,
        notLinked,
        http.post('/api/v1/engagements/:id/invoices', () =>
          HttpResponse.json(
            {
              error: {
                code: 'validation_failed',
                message: 'The invoice date is outside every period.',
              },
            },
            { status: 422 },
          ),
        ),
      ],
    },
  },
  render: () => <EditorRow clientId="cli_1" invoiceId="inv_1" />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await openable(canvasElement, /Choose an engagement/))
    await userEvent.click(await within(document.body).findByText('German lessons'))
    await waitFor(() =>
      expect(
        within(document.body).getByText('The invoice date is outside every period.'),
      ).toBeVisible(),
    )
  },
}

/** Already linked: the engagement's name and a way to remove it. */
export const EditorLinked: Story = {
  parameters: {
    msw: {
      handlers: [
        list,
        http.get('/api/v1/invoices/:id/engagement', () =>
          HttpResponse.json({ data: engagements[0] }),
        ),
      ],
    },
  },
  render: () => <EditorRow clientId="cli_1" invoiceId="inv_1" />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('link', { name: 'German lessons' }),
    ).toBeVisible()
    await expect(
      within(canvasElement).getByRole('button', { name: 'Remove from engagement' }),
    ).toBeVisible()
  },
}

function FormRow({ clientId }: { clientId: string }) {
  const [value, setValue] = useState('')
  return (
    <div className="w-80">
      <InvoiceLinkField id="invoice-link" clientId={clientId} value={value} onChange={setValue} />
    </div>
  )
}
const invoice = {
  id: 'inv_1',
  number: '2026-014',
  issue_date: '2026-11-02',
  currency: 'CHF',
  total: '2700.00',
}

/** The engagement form before a client is chosen: off. */
export const FormNoClient: Story = {
  render: () => <FormRow clientId="" />,
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: /Choose a client first/ }),
    ).toBeDisabled()
  },
}

/** A client whose invoices all belong to an engagement already: off, with a muted hint. */
export const FormNoCandidates: Story = {
  parameters: { msw: { handlers: [http.get('/api/v1/invoices', () => page([]))] } },
  render: () => <FormRow clientId="cli_1" />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('button', {
        name: /No invoices without an engagement/,
      }),
    ).toBeDisabled()
  },
}

/** Picking one of the client's invoices shows its number, date and total. */
export const FormPicking: Story = {
  parameters: { msw: { handlers: [http.get('/api/v1/invoices', () => page([invoice]))] } },
  render: () => <FormRow clientId="cli_1" />,
  play: async ({ canvasElement }) => {
    await userEvent.click(await openable(canvasElement, /Choose an invoice/))
    await userEvent.click(await within(document.body).findByText('2026-014'))
    await expect(within(canvasElement).getByRole('button')).toHaveTextContent('2026-014')
  },
}
