import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { expect, fireEvent, userEvent, waitFor, within } from 'storybook/test'

import { EmailComposer, type Recipients } from '@/components/email-composer'
import { OptionSegments } from '@/components/option-segments'
import { SignaturesView } from '@/components/signatures/signatures-view'
import { FillTemplateDrawer } from '@/components/templates/fill-drawer'
import { TemplatesView } from '@/components/templates/templates-view'
import type { AIWriteInput } from '@/lib/ai-write'
import type { SignatureRequest, SigningOrder } from '@/lib/signatures'
import type { GenerateRequest, Template, TemplateInput } from '@/lib/templates'
import { emailTemplateHandlers, resetEmailTemplatesMock } from '@/mocks/email-templates'
import { sampleClient } from '@/test/invoice-fixtures'

import { emptyPage, sessionHandler } from './screen-fixtures'

const meta = { title: 'Shared flows/Sending documents' } satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)

// ---- the composer ----

let asked: AIWriteInput[] = []
const aiHandler = http.post<never, AIWriteInput>('/api/v1/ai/write', async ({ request }) => {
  asked.push(await request.json())
  return HttpResponse.json({ data: { text: 'Bonjour\n\nVoici le contrat signé.' } })
})

function Composer() {
  const [recipients, setRecipients] = useState<Recipients>({
    to: 'hello@alpenglow.ch',
    cc: '',
    bcc: '',
  })
  const [subject, setSubject] = useState('Agreement from Muster AG')
  const [message, setMessage] = useState('Hello\n\nPlease find the agreement attached.')
  return (
    <div className="grid w-[560px] gap-4">
      <EmailComposer
        id="story"
        recipients={recipients}
        onRecipients={setRecipients}
        subject={subject}
        onSubject={setSubject}
        message={message}
        onMessage={setMessage}
        errors={{}}
        language="fr"
        attachments={['Agreement.pdf']}
        context={{ document: 'Agreement' }}
      />
      <Toaster />
    </div>
  )
}

/** Cc and Bcc wait behind their toggles; the message counts its characters, grows to 8 lines, then scrolls. */
export const ComposerCopiesAndCount: Story = {
  parameters: { msw: { handlers: [sessionHandler(), aiHandler] } },
  render: () => <Composer />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('textbox', { name: /^Cc/ })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Cc' }))
    await expect(canvas.getByRole('textbox', { name: /^Cc/ })).toHaveFocus()
    await userEvent.click(canvas.getByRole('button', { name: 'Bcc' }))
    await expect(canvas.getByRole('textbox', { name: /^Bcc/ })).toBeVisible()
    await expect(canvas.getByText('Agreement.pdf')).toBeVisible()

    const message = canvas.getByRole<HTMLTextAreaElement>('textbox', { name: /^Message/ })
    const count = canvasElement.querySelector('[data-slot="textarea-count"]')
    await expect(count).toHaveTextContent(`${message.value.length} / 2500`)
    const short = message.clientHeight
    await expect(message.scrollHeight).toBeLessThanOrEqual(message.clientHeight + 1)
    await userEvent.type(message, '{enter}line'.repeat(5))
    await waitFor(() => expect(message.clientHeight).toBeGreaterThan(short))
    const grown = message.clientHeight
    await userEvent.type(message, '{enter}more'.repeat(10))
    // at 8 lines it stops growing and scrolls
    await expect(message.clientHeight).toBeLessThanOrEqual(grown * 1.6)
    await expect(message.scrollHeight).toBeGreaterThan(message.clientHeight)
    await expect(count).toHaveTextContent(`${message.value.length} / 2500`)
  },
}

/** Write with AI offers friendlier wording and a translation into the reader's language, and writes in it. */
export const ComposerImproveWithAI: Story = {
  beforeEach: () => {
    asked = []
  },
  parameters: { msw: { handlers: [sessionHandler(), aiHandler] } },
  render: () => <Composer />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Write with AI' }))
    await expect(await body().findByRole('button', { name: 'Friendlier' })).toBeVisible()
    await userEvent.click(body().getByRole('button', { name: 'Translate to Français' }))
    await userEvent.click(await body().findByRole('button', { name: 'Use this' }))
    await waitFor(() =>
      expect(within(canvasElement).getByRole('textbox', { name: /^Message/ })).toHaveValue(
        'Bonjour\n\nVoici le contrat signé.',
      ),
    )
    await expect(asked[0]).toMatchObject({
      field: 'email_message',
      action: 'translate',
      language: 'fr',
    })
  },
}

// ---- options with a description ----

function Order() {
  const [order, setOrder] = useState<SigningOrder>('parallel')
  return (
    <div className="w-[520px]">
      <OptionSegments
        label="Signing order"
        value={order}
        onChange={setOrder}
        options={[
          { value: 'parallel', label: 'Everyone at once', text: 'All signers get their link now.' },
          {
            value: 'sequential',
            label: 'One after another',
            text: 'Each gets their link when the one before has signed.',
          },
        ]}
      />
    </div>
  )
}

/** Both options start their text at the same left offset and use the same sizes, whichever is chosen. */
export const OptionsShareTheirLayout: Story = {
  render: () => <Order />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const offsets = () =>
      canvas.getAllByRole('button').map((button) => {
        const title = button.querySelector<HTMLElement>('[data-slot="option-title"]')
        const text = button.querySelector<HTMLElement>('[data-slot="option-text"]')
        if (!title || !text) throw new Error('an option without its title and text')
        const left = button.getBoundingClientRect().left
        return {
          title: title.getBoundingClientRect().left - left,
          text: text.getBoundingClientRect().left - left,
          titleSize: getComputedStyle(title).fontSize,
          textSize: getComputedStyle(text).fontSize,
        }
      })
    const same = async () => {
      const [first, second] = offsets()
      if (!first || !second) throw new Error('two options expected')
      await expect(Math.abs(first.title - second.title)).toBeLessThanOrEqual(1)
      await expect(Math.abs(first.text - second.text)).toBeLessThanOrEqual(1)
      await expect(Math.abs(first.title - first.text)).toBeLessThanOrEqual(1)
      await expect(first.titleSize).toBe(second.titleSize)
      await expect(first.textSize).toBe(second.textSize)
    }
    await same()
    await userEvent.click(canvas.getByRole('button', { name: /^One after another/ }))
    await same()
  },
}

// ---- a document from a template, opened from a client ----

const template = (change: Partial<Template> = {}): Template => ({
  id: 'tpl_1',
  name: 'Service agreement',
  description: null,
  document: { id: 'doc_tpl', name: 'Service agreement.pdf' },
  signers: [],
  fields: [
    {
      id: 'tfd_1',
      kind: 'client.name',
      signer: null,
      label: null,
      page: 1,
      x: 0.1,
      y: 0.1,
      w: 0.4,
      h: 0.03,
    },
  ],
  used_count: 0,
  last_used_at: null,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
  ...change,
})

let generated: GenerateRequest | null = null
const generateHandler = http.post<{ id: string }, GenerateRequest>(
  '/api/v1/templates/:id/documents',
  async ({ request }) => {
    generated = await request.json()
    return HttpResponse.json(
      {
        data: {
          document: { id: 'doc_new', name: 'Service agreement.pdf' },
          signature_request_id: null,
          emailed_to: 'hello@alpenglow.ch',
        },
      },
      { status: 201 },
    )
  },
)

/**
 * Opened from a client: the client is fixed (with Change), the email has a step of its own, prefilled from the
 * workspace's Document template, with the real email beside it, and sends what it shows.
 */
export const FillFromClientThenEmail: Story = {
  beforeEach: () => {
    generated = null
    resetEmailTemplatesMock()
  },
  parameters: {
    msw: {
      handlers: [
        sessionHandler(),
        generateHandler,
        ...emailTemplateHandlers,
        http.get('/api/v1/templates', () => HttpResponse.json({ data: [template()] })),
        http.get('/api/v1/clients', () => HttpResponse.json(emptyPage)),
      ],
    },
  },
  render: () => (
    <FillTemplateDrawer
      template={template()}
      client={sampleClient({ language: 'en' })}
      onClose={() => {}}
    />
  ),
  play: async () => {
    const sheet = within(await body().findByRole('dialog'))
    await expect(sheet.getByText('For: Alpenglow Studio GmbH')).toBeVisible()
    await expect(sheet.queryByRole('searchbox', { name: 'Search clients' })).toBeNull()
    await userEvent.click(sheet.getByRole('button', { name: 'Change' }))
    await expect(sheet.getByRole('searchbox', { name: 'Search clients' })).toBeVisible()

    await userEvent.click(sheet.getByRole('button', { name: 'Next' }))
    await userEvent.click(await sheet.findByRole('button', { name: 'Next' }))
    await userEvent.click(await sheet.findByRole('button', { name: /^Email it to the client/ }))
    await userEvent.click(sheet.getByRole('button', { name: 'Next' }))

    const title = 'Service agreement – Alpenglow Studio GmbH'
    const subject = await sheet.findByRole('textbox', { name: /^Subject/ })
    await waitFor(() => expect(subject).toHaveValue(`${title} from Muster AG`))
    await expect(sheet.getByRole('textbox', { name: /^To/ })).toHaveValue('hello@alpenglow.ch')
    await expect(
      sheet.getByRole<HTMLTextAreaElement>('textbox', { name: /^Message/ }).value,
    ).toContain(`Please find “${title}” attached`)
    await expect(
      sheet.getByRole<HTMLTextAreaElement>('textbox', { name: /^Message/ }).value,
    ).toMatch(/Anna Muster\nMuster AG$/)
    await expect(sheet.getByText(`${title}.pdf`)).toBeVisible()
    await userEvent.click(sheet.getByRole('button', { name: 'Cc' }))
    await userEvent.type(sheet.getByRole('textbox', { name: /^Cc/ }), 'office@alpenglow.ch')

    await userEvent.click(sheet.getByRole('button', { name: 'Send email' }))
    await waitFor(() => expect(generated).not.toBeNull())
    await expect(generated?.delivery).toMatchObject({
      type: 'email',
      to: 'hello@alpenglow.ch',
      cc: ['office@alpenglow.ch'],
      subject: `${title} from Muster AG`,
      language: 'en',
    })
  },
}

// ---- the lists' menus ----

const contextMenu = (target: Element) => fireEvent.contextMenu(target)

let created: TemplateInput | null = null

/** A template row's right-click and "…" menus hold the same actions; without its PDF, those needing it say why. */
export const TemplateMenus: Story = {
  beforeEach: () => {
    created = null
  },
  parameters: {
    msw: {
      handlers: [
        sessionHandler(),
        http.get('/api/v1/templates', () =>
          HttpResponse.json({
            data: [template(), template({ id: 'tpl_2', name: 'Old offer', document: null })],
          }),
        ),
        http.post<never, TemplateInput>('/api/v1/templates', async ({ request }) => {
          created = await request.json()
          return HttpResponse.json({ data: template({ id: 'tpl_3', name: created.name }) })
        }),
      ],
    },
  },
  render: () => (
    <>
      <TemplatesView onEdit={() => {}} onFill={() => {}} />
      <Toaster />
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    contextMenu(await canvas.findByText('Service agreement'))
    const menu = within(await body().findByRole('menu'))
    await Promise.all(
      ['Use template', 'Edit template', 'Rename', 'Duplicate', 'Download source PDF', 'Delete'].map(
        (name) => expect(menu.getByRole('menuitem', { name: new RegExp(name) })).toBeVisible(),
      ),
    )
    await userEvent.click(menu.getByRole('menuitem', { name: 'Duplicate' }))
    await waitFor(() => expect(created?.name).toBe('Service agreement (copy)'))

    await userEvent.click(canvas.getByRole('button', { name: 'More for Old offer' }))
    const more = within(await body().findByRole('menu'))
    const use = more.getByRole('menuitem', { name: 'Use template' })
    await expect(use).toHaveAttribute('aria-disabled', 'true')
    await userEvent.hover(use)
    await expect(await body().findByRole('tooltip')).toHaveTextContent(
      'Its PDF was deleted: choose another in the editor.',
    )
    // choosing it does nothing, and closes the tooltip so Escape reaches the menu
    await userEvent.click(use)
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body().queryByRole('menu')).toBeNull())
  },
}

const request = (change: Partial<SignatureRequest> = {}): SignatureRequest => ({
  id: 'sig_1',
  title: 'Lease 2027',
  message: null,
  status: 'pending',
  signing_order: 'parallel',
  document: { id: 'doc_lease', name: 'Lease 2027.pdf' },
  signed_document: null,
  folder_id: null,
  original_sha256: 'a'.repeat(64),
  final_sha256: null,
  page_count: 2,
  expires_at: '2026-12-23T10:00:00Z',
  created_by: { id: 'usr_story', name: 'Anna Muster' },
  created_at: '2026-11-20T10:00:00Z',
  completed_at: null,
  signers: [
    {
      id: 'sgr_1',
      position: 1,
      name: 'Luc Romand',
      email: 'luc@example.ch',
      status: 'sent',
      sent_at: '2026-11-20T10:00:00Z',
      viewed_at: null,
      signed_at: null,
      declined_at: null,
      decline_reason: null,
    },
  ],
  fields: [],
  ...change,
})

let reminded: string[] = []

/** A request's menu: reminding and revoking only while it waits; a finished one downloads the signed PDF. */
export const SignatureMenus: Story = {
  beforeEach: () => {
    reminded = []
  },
  parameters: {
    msw: {
      handlers: [
        sessionHandler(),
        http.get('/api/v1/signatures', () =>
          HttpResponse.json({
            data: [
              request(),
              request({
                id: 'sig_2',
                title: 'NDA',
                status: 'completed',
                signed_document: { id: 'doc_nda_signed', name: 'NDA (signed).pdf' },
                completed_at: '2026-11-21T10:00:00Z',
              }),
            ],
          }),
        ),
        http.post<{ id: string }>('/api/v1/signatures/:id/remind', ({ params }) => {
          reminded.push(params.id)
          return HttpResponse.json({ data: request() })
        }),
      ],
    },
  },
  render: () => (
    <>
      <SignaturesView onOpen={() => {}} onShowDocument={() => {}} />
      <Toaster />
    </>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    contextMenu(await canvas.findByText('Lease 2027'))
    let menu = within(await body().findByRole('menu'))
    await Promise.all(
      ['Open', 'Send reminder', 'Download original PDF', 'Open in Documents', 'Revoke'].map(
        (name) =>
          expect(menu.getByRole('menuitem', { name: new RegExp(`^${name}$`) })).toBeVisible(),
      ),
    )
    await userEvent.click(menu.getByRole('menuitem', { name: 'Send reminder' }))
    await waitFor(() => expect(reminded).toEqual(['sig_1']))

    await userEvent.click(canvas.getByRole('button', { name: 'More for NDA' }))
    menu = within(await body().findByRole('menu'))
    await expect(menu.getByRole('menuitem', { name: /^Send reminder/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await expect(menu.getByRole('menuitem', { name: /^Revoke/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await expect(menu.getByRole('menuitem', { name: 'Download signed PDF' })).toHaveAttribute(
      'href',
      expect.stringContaining('/documents/doc_nda_signed/download'),
    )
    await userEvent.keyboard('{Escape}')
  },
}
