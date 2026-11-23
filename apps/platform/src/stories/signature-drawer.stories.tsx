import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { CreateSignatureDrawer } from '@/components/signatures/create-drawer'
import type { Client } from '@/lib/clients'
import type { DocFile } from '@/lib/documents'
import type { Template } from '@/lib/templates'
import { blankPdf } from '@/mocks/blank-pdf'
import { sampleClient } from '@/test/invoice-fixtures'

import { members } from './pages/api'
import { screenHandlers, storySession } from './screen-fixtures'

const client: Client = sampleClient({
  id: 'cli_story',
  name: 'Alpenglow AG',
  email: 'office@alpenglow.ch',
  contacts: [
    {
      id: 'con_1',
      name: 'Lena Huber',
      role: 'CEO',
      email: 'lena@alpenglow.ch',
      phone: null,
      is_primary: true,
    },
    {
      id: 'con_2',
      name: 'Marco Steiner',
      role: 'CFO',
      email: 'marco@alpenglow.ch',
      phone: null,
      is_primary: false,
    },
  ],
})

const pdf: DocFile = {
  id: 'doc_story',
  name: 'Service agreement.pdf',
  folder_id: null,
  folder: null,
  size: 2048,
  content_type: 'application/pdf',
  kind: 'pdf',
  sha256: '0'.repeat(64),
  tags: [],
  ai_filing: null,
  previewable: true,
  links: [],
  retained_until: null,
  uploaded_by: storySession.user,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  deleted_at: null,
  deleted_by: null,
  purge_at: null,
}

const template: Template = {
  id: 'tpl_sign',
  name: 'Mandate agreement',
  description: null,
  document: { id: 'doc_story', name: 'Mandate agreement.pdf' },
  signers: [{ label: 'Client', fill: 'client' }],
  fields: [
    {
      id: 'fld_name',
      kind: 'client.name',
      signer: null,
      page: 1,
      x: 0.1,
      y: 0.1,
      w: 0.3,
      h: 0.05,
      label: null,
    },
    {
      id: 'fld_sig',
      kind: 'signature',
      signer: 0,
      page: 1,
      x: 0.1,
      y: 0.7,
      w: 0.3,
      h: 0.08,
      label: null,
    },
  ],
  used_count: 0,
  last_used_at: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
}

let generated: unknown = null
const page = (data: unknown[]) => ({
  data,
  meta: { page: 1, page_size: 50, total: data.length, total_pages: 1 },
})

const meta = {
  title: 'Signatures/Send for signature',
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/documents/doc_story/content', () =>
          HttpResponse.text(blankPdf(), { headers: { 'Content-Type': 'application/pdf' } }),
        ),
        http.post('/api/v1/signatures/email-preview', () =>
          HttpResponse.json({
            data: { subject: 'Mandate agreement', html: '<p>Hello</p>', text: 'Hello' },
          }),
        ),
        http.get('/api/v1/clients', () => HttpResponse.json(page([client]))),
        http.get('/api/v1/members', () => HttpResponse.json({ data: members })),
        http.get('/api/v1/templates', () => HttpResponse.json({ data: [template] })),
        http.post('/api/v1/templates/tpl_sign/documents', async ({ request }) => {
          generated = await request.json()
          return HttpResponse.json({
            data: {
              document: { id: 'doc_filled', name: 'Mandate agreement – Alpenglow AG.pdf' },
              signature_request_id: 'sig_new',
              emailed_to: null,
            },
          })
        }),
        ...screenHandlers,
      ],
    },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)
const search = () => body().findByRole('combobox', { name: 'Add signer' })
const signers = () => within(body().getByRole('region', { name: 'Signers' }))

/** A contact picked from the suggestions leaves them; typing its address again is refused. */
export const SignerDedupe: Story = {
  render: () => (
    <CreateSignatureDrawer initial={pdf} folderId={null} onClose={fn()} onSent={fn()} />
  ),
  play: async () => {
    await userEvent.click(await search())
    const option = await body().findByRole('option', { name: /Marco Steiner/ })
    await userEvent.click(option)
    await expect(signers().getByText('Marco Steiner')).toBeVisible()
    await expect(signers().getByText('Client · Alpenglow AG')).toBeVisible()

    await userEvent.click(await search())
    await body().findByRole('option', { name: /Lena Huber/ })
    await expect(body().queryByRole('option', { name: /Marco Steiner/ })).toBeNull()
    // The team is offered too, the person signed in as "Me".
    await expect(body().getByRole('option', { name: /Anna Muster.*Me/ })).toBeVisible()

    await userEvent.type(await search(), 'MARCO@alpenglow.ch')
    await expect(await body().findByRole('alert')).toHaveTextContent('is already a signer')
    await userEvent.keyboard('{Enter}')
    await expect(signers().getAllByRole('listitem')).toHaveLength(1)
  },
}

/** A new address is added as typed, and its name is asked for in place. */
export const AddByTypedEmail: Story = {
  render: () => (
    <CreateSignatureDrawer initial={pdf} folderId={null} onClose={fn()} onSent={fn()} />
  ),
  play: async () => {
    await userEvent.type(await search(), 'nora@example.org')
    await expect(await body().findByRole('option', { name: 'Add nora@example.org' })).toBeVisible()
    await userEvent.keyboard('{Enter}')
    const name = await signers().findByRole('textbox', { name: 'Signer 1 name' })
    await waitFor(() => expect(name).toHaveFocus())
    await userEvent.type(name, 'Nora Graf{Enter}')
    await expect(signers().queryByRole('textbox', { name: 'Signer 1 name' })).toBeNull()
    await expect(signers().getByText('Nora Graf')).toBeVisible()
    await expect(signers().getByText('nora@example.org')).toBeVisible()
  },
}

/** Reordering is offered only for one after another: a handle that moves with the arrow keys. */
export const ReorderOnlyInSequence: Story = {
  render: () => (
    <CreateSignatureDrawer
      initial={pdf}
      client={client}
      folderId={null}
      onClose={fn()}
      onSent={fn()}
    />
  ),
  play: async () => {
    await userEvent.type(await search(), 'nora@example.org{Enter}')
    await userEvent.type(
      await signers().findByRole('textbox', { name: 'Signer 2 name' }),
      'Nora Graf{Enter}',
    )
    await expect(signers().queryByRole('button', { name: /^Reorder/ })).toBeNull()

    await userEvent.click(body().getByRole('button', { name: /One after another/ }))
    const handle = signers().getByRole('button', { name: 'Reorder Lena Huber' })
    handle.focus()
    await userEvent.keyboard('{ArrowDown}')
    const rows = signers().getAllByRole('listitem')
    await expect(rows[0]).toHaveTextContent('Nora Graf')
    await expect(rows[1]).toHaveTextContent('Lena Huber')
  },
}

/** Opened from a client, its main contact is the first signer. */
export const PrefilledFromClient: Story = {
  render: () => (
    <CreateSignatureDrawer
      initial={pdf}
      client={client}
      folderId={null}
      onClose={fn()}
      onSent={fn()}
    />
  ),
  play: async () => {
    await search()
    const rows = signers().getAllByRole('listitem')
    await expect(rows).toHaveLength(1)
    await expect(rows[0]).toHaveTextContent('Lena Huber')
    await expect(rows[0]).toHaveTextContent('lena@alpenglow.ch')
    await expect(rows[0]).toHaveTextContent('Client · Alpenglow AG')
  },
}

/** A PDF goes as before: the PDF, who signs, then Place fields. */
export const PdfPath: Story = {
  render: () => (
    <CreateSignatureDrawer initial={pdf} folderId={null} onClose={fn()} onSent={fn()} />
  ),
  play: async () => {
    await userEvent.type(await search(), 'nora@example.org{Enter}')
    await userEvent.type(
      await signers().findByRole('textbox', { name: 'Signer 1 name' }),
      'Nora Graf{Enter}',
    )
    await userEvent.click(body().getByRole('button', { name: 'Next' }))
    await expect(
      await body().findByRole('complementary', { name: 'Field palette' }),
    ).toBeInTheDocument()
  },
}

/** From a template: pick it and the client, check the details, the role's signer is the client's contact, send. */
const onSent = fn()
export const TemplatePath: Story = {
  render: () => (
    <CreateSignatureDrawer initial={null} folderId={null} onClose={fn()} onSent={onSent} />
  ),
  play: async () => {
    onSent.mockClear()
    generated = null
    await userEvent.click(await body().findByRole('button', { name: /From a template/ }))
    await userEvent.click(await body().findByRole('button', { name: /Mandate agreement/ }))
    await userEvent.click(await body().findByRole('button', { name: /Alpenglow AG/ }))
    await userEvent.click(body().getByRole('button', { name: 'Next' }))

    await expect(await body().findByText('Check the details')).toBeVisible()
    await expect(body().getByRole('textbox', { name: /Client name/ })).toHaveValue('Alpenglow AG')
    await userEvent.click(body().getByRole('button', { name: 'Next' }))

    const row = (await body().findByRole('region', { name: 'Signers' })).querySelector('li')
    await expect(row).toHaveTextContent('Lena Huber')
    await expect(row).toHaveTextContent('Client')
    // A role's signer is edited, not removed, and nothing is added beside the roles.
    await expect(body().queryByRole('combobox', { name: 'Add signer' })).toBeNull()
    await userEvent.click(body().getByRole('button', { name: 'Next' }))
    // The template has its signing fields: no Place fields step, straight to the message.
    await expect(await body().findByText('The email to the signers')).toBeVisible()
    await userEvent.click(body().getByRole('button', { name: 'Next' }))
    await userEvent.click(await body().findByRole('button', { name: 'Send for signature' }))

    await waitFor(() => expect(onSent).toHaveBeenCalledWith('sig_new'))
    await expect(generated).toMatchObject({
      client_id: 'cli_story',
      title: 'Mandate agreement – Alpenglow AG',
      delivery: {
        type: 'signature',
        signers: [{ name: 'Lena Huber', email: 'lena@alpenglow.ch' }],
        expires_in_days: 30,
      },
    })
  },
}
