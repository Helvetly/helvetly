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

export const SignerRowIdentity: Story = {
  render: () => (
    <CreateSignatureDrawer initial={storyDocument} folderId={null} onClose={fn()} onSent={fn()} />
  ),
  play: async () => {
    const body = within(document.body)
    const addSigner = async (number: number, name: string) => {
      if (number > 1) await userEvent.click(body.getByRole('button', { name: 'Add signer' }))
      await userEvent.type(
        await body.findByRole('textbox', { name: `Signer ${number} name` }),
        name,
      )
    }
    await addSigner(1, 'Anna')
    await addSigner(2, 'Beat')
    await addSigner(3, 'Cora')
    await addSigner(4, 'Dario')
    // Removing a row keeps the rows after it: Cora's input is the same element, one place up.
    const cora = body.getByRole('textbox', { name: 'Signer 3 name' })
    await userEvent.click(body.getByRole('button', { name: 'Remove signer 2' }))
    await expect(body.getByRole('textbox', { name: 'Signer 2 name' })).toBe(cora)
    await expect(cora).toHaveValue('Cora')
    // Moving a row by keyboard keeps focus on that row's Move down.
    const anna = body.getByRole('textbox', { name: 'Signer 1 name' })
    await userEvent.click(anna)
    await userEvent.tab()
    await userEvent.tab()
    await expect(document.activeElement).toHaveAccessibleName('Move down')
    await userEvent.keyboard('{Enter}')
    await expect(body.getByRole('textbox', { name: 'Signer 2 name' })).toBe(anna)
    await expect(document.activeElement).toHaveAccessibleName('Move down')
    await expect(document.activeElement?.closest('li')).toBe(anna.closest('li'))
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
