import { Button } from '@helvetly/ui/components/button'
import { SidebarProvider } from '@helvetly/ui/components/sidebar'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { HeidiFormView } from '@/components/heidi/heidi-form'
import { PageHeader } from '@/components/shell/page-header'
import { AdoptDialog } from '@/components/signatures/adopt-dialog'
import { CreateSignatureDrawer } from '@/components/signatures/create-drawer'
import { TemplateEditor } from '@/components/templates/template-editor'
import type { DocFile } from '@/lib/documents'
import type { Template } from '@/lib/templates'

import { screenHandlers, storySession } from './screen-fixtures'

const meta = {
  title: 'Design system/Action consistency',
  parameters: { msw: { handlers: screenHandlers } },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

async function sameAction(button: HTMLElement, reference: HTMLElement) {
  // A disabled primary is a muted chip on purpose, and turning live animates its colours: compare
  // once the action is enabled and the transition has settled.
  await waitFor(() => expect(button).toBeEnabled())
  await waitFor(() => {
    const actual = getComputedStyle(button)
    const expected = getComputedStyle(reference)
    expect(button.getBoundingClientRect().height).toBe(reference.getBoundingClientRect().height)
    for (const property of [
      'borderRadius',
      'fontSize',
      'fontWeight',
      'paddingLeft',
      'paddingRight',
      'backgroundColor',
      'color',
    ] as const)
      expect(actual[property]).toBe(expected[property])
  })
}
function Reference({ large = false, outline = false }: { large?: boolean; outline?: boolean }) {
  return (
    <Button
      data-testid="reference-action"
      size={large ? 'xl' : 'default'}
      variant={outline ? 'outline' : 'default'}
    >
      Reference action
    </Button>
  )
}
export const PagePrimary: Story = {
  render: () => (
    <SidebarProvider>
      <div className="grid w-full content-start gap-4">
        <Reference />
        <PageHeader tabs={['Records']} primary="New record" />
      </div>
    </SidebarProvider>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await sameAction(
      canvas.getByRole('button', { name: 'New record' }),
      canvas.getByTestId('reference-action'),
    )
  },
}
export const HeidiContinue: Story = {
  render: () => (
    <div className="grid max-w-md gap-6">
      <Reference />
      <HeidiFormView
        form={{
          id: 'form_consistency',
          question: 'Which currency?',
          fields: [
            { name: 'currency', label: 'Currency', kind: 'choice', options: ['CHF', 'EUR'] },
          ],
        }}
        disabled={false}
        onSubmit={fn()}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('radio', { name: 'CHF' }))
    await sameAction(
      canvas.getByRole('button', { name: 'Continue' }),
      canvas.getByTestId('reference-action'),
    )
  },
}
export const SignatureWizard: Story = {
  render: () => (
    <>
      <Reference />
      <CreateSignatureDrawer initial={null} folderId={null} onClose={fn()} onSent={fn()} />
    </>
  ),
  play: async ({ canvasElement }) => {
    const body = within(document.body)
    const action = await body.findByRole('button', { name: 'Next' })
    await waitFor(() => expect(action).toBeVisible())
    await sameAction(action, within(canvasElement).getByTestId('reference-action'))
    await userEvent.click(action)
    await expect(await body.findByText('Choose a PDF to send.')).toBeVisible()
  },
}
export const TemplateWizard: Story = {
  render: () => (
    <>
      <Reference />
      <TemplateEditor
        template={null}
        initialDocument={null}
        folderId={null}
        onClose={fn()}
        onSaved={fn()}
      />
    </>
  ),
  play: async ({ canvasElement }) => {
    const action = await within(document.body).findByRole('button', { name: 'Next' })
    await waitFor(() => expect(action).toBeVisible())
    await sameAction(action, within(canvasElement).getByTestId('reference-action'))
  },
}
export const SignatureDialog: Story = {
  render: () => (
    <>
      <Reference large outline />
      <AdoptDialog name="Anna Muster" onAdopt={fn()} onClose={fn()} />
    </>
  ),
  play: async ({ canvasElement }) => {
    const body = within(document.body)
    const action = await body.findByRole('button', { name: 'Cancel' })
    await waitFor(() => expect(action).toBeVisible())
    await sameAction(action, within(canvasElement).getByTestId('reference-action'))
    const natural = body.getByRole('button', { name: 'Anna Muster, Natural style' })
    await userEvent.click(natural)
    await expect(natural).toHaveAttribute('aria-pressed', 'true')
    await userEvent.clear(body.getByRole('textbox', { name: 'Your name' }))
    await expect(body.getByRole('button', { name: 'Your name, Natural style' })).toBeVisible()
    await expect(body.getByRole('button', { name: 'Adopt and sign' })).toBeDisabled()
  },
}
export const SignatureDialogDark: Story = { ...SignatureDialog, parameters: { dark: true } }

const storyDocument: DocFile = {
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

/** Signers keep their rows through removals and moves; a moved row keeps the keyboard on its handle. */
export const SignerRowIdentity: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/clients', () =>
          HttpResponse.json({
            data: [],
            meta: { page: 1, page_size: 8, total: 0, total_pages: 0 },
          }),
        ),
        ...screenHandlers,
      ],
    },
  },
  render: () => (
    <CreateSignatureDrawer initial={storyDocument} folderId={null} onClose={fn()} onSent={fn()} />
  ),
  play: async () => {
    const body = within(document.body)
    const search = await body.findByRole('combobox', { name: 'Add signer' })
    const add = async (number: number, name: string) => {
      await userEvent.type(search, `${name.toLowerCase()}@example.org{Enter}`)
      await userEvent.type(
        await body.findByRole('textbox', { name: `Signer ${number} name` }),
        `${name}{Enter}`,
      )
    }
    await add(1, 'Anna')
    await add(2, 'Beat')
    await add(3, 'Cora')
    await add(4, 'Dario')
    const list = within(body.getByRole('region', { name: 'Signers' }))
    // Removing a row keeps the rows after it: Cora's row is the same element, one place up.
    const cora = list.getByText('Cora').closest('li')
    await userEvent.click(list.getByRole('button', { name: 'Remove signer 2' }))
    await expect(list.getAllByRole('listitem')[1]).toBe(cora)
    // One after another: the handle moves its row, and keeps the focus.
    await userEvent.click(body.getByRole('button', { name: /One after another/ }))
    const handle = list.getByRole('button', { name: 'Reorder Anna' })
    handle.focus()
    await userEvent.keyboard('{ArrowDown}')
    await expect(list.getAllByRole('listitem')[1]).toHaveTextContent('Anna')
    await expect(document.activeElement).toBe(handle)
  },
}

const box = { page: 1, x: 0.1, w: 0.3, h: 0.06, label: null }
const storyTemplate: Template = {
  id: 'tpl_story',
  name: 'Service agreement',
  description: null,
  document: { id: 'doc_story', name: 'Service agreement.pdf' },
  signers: [
    { label: 'Client', fill: 'client' },
    { label: 'Witness', fill: 'manual' },
    { label: 'Guarantor', fill: 'manual' },
  ],
  fields: [
    { id: 'fld_1', kind: 'signature', signer: 0, ...box, y: 0.1 },
    { id: 'fld_2', kind: 'signature', signer: 1, ...box, y: 0.3 },
    { id: 'fld_3', kind: 'signature', signer: 2, ...box, y: 0.5 },
  ],
  used_count: 0,
  last_used_at: null,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
}
let savedTemplate: unknown = null

export const TemplateRoleIdentity: Story = {
  parameters: {
    msw: {
      handlers: [
        http.put('/api/v1/templates/tpl_story', async ({ request }) => {
          savedTemplate = await request.json()
          return HttpResponse.json({ data: storyTemplate })
        }),
        ...screenHandlers,
      ],
    },
  },
  render: () => (
    <TemplateEditor
      template={storyTemplate}
      initialDocument={null}
      folderId={null}
      onClose={fn()}
      onSaved={fn()}
    />
  ),
  play: async () => {
    savedTemplate = null
    const body = within(document.body)
    await userEvent.click(await body.findByRole('button', { name: 'Back' }))
    const guarantor = await body.findByRole('textbox', { name: 'Signer 3 role' })
    await userEvent.click(body.getByRole('button', { name: 'Remove signer 2' }))
    await expect(body.getByRole('textbox', { name: 'Signer 2 role' })).toBe(guarantor)
    await expect(guarantor).toHaveValue('Guarantor')
    // The rows' identities stay in the editor: the saved roles are exactly the contract's.
    await userEvent.click(body.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(savedTemplate).not.toBeNull())
    await expect(savedTemplate).toHaveProperty('signers', [
      { label: 'Client', fill: 'client' },
      { label: 'Guarantor', fill: 'manual' },
    ])
    await expect(savedTemplate).toHaveProperty('fields.length', 2)
    await expect(savedTemplate).toHaveProperty('fields.1.signer', 1)
  },
}
