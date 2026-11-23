import { Toaster } from '@helvetly/ui/components/sonner'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { useAIFilingToast } from '@/components/documents/ai-filing'
import { Preview, type PreviewCommands } from '@/components/documents/preview'
import { newUploads } from '@/components/documents/upload-queue'
import type { DocFile } from '@/lib/documents'

import { screenHandlers, sessionHandler, storySession } from './screen-fixtures'

const invoices = { id: 'fld_invoices', name: 'Invoices' }

const file = (id: string, over: Partial<DocFile> = {}): DocFile => ({
  id,
  name: `${id}.pdf`,
  folder_id: null,
  folder: null,
  size: 2048,
  content_type: 'application/pdf',
  kind: 'pdf',
  sha256: '0'.repeat(64),
  tags: [],
  ai_filing: null,
  previewable: false,
  links: [],
  retained_until: null,
  uploaded_by: storySession.user,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  deleted_at: null,
  deleted_by: null,
  purge_at: null,
  ...over,
})

const filed = (id: string, over: Partial<DocFile> = {}): DocFile =>
  file(id, {
    folder_id: invoices.id,
    folder: invoices,
    tags: ['invoice', 'acme'],
    ai_filing: {
      status: 'filed',
      folder: invoices,
      created_folder: false,
      tags: ['invoice', 'acme'],
    },
    ...over,
  })

const meta = {
  title: 'Domain screens/Documents AI filing',
  parameters: { ownMain: true },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const commands: PreviewCommands = {
  rename: fn(),
  move: fn(),
  copy: fn(),
  trash: fn(),
  restore: fn(),
  link: fn(),
  unlink: fn(),
  openFolder: fn(),
  sign: fn(),
  extract: fn(),
}

/** What the tags panel sent: PATCH bodies and DELETE …/filing calls, by story. */
const sent: { tags: unknown[]; undone: string[] } = { tags: [], undone: [] }

/** The details show the tags and that AI sorted the file; tags are edited in place, Undo puts it back. */
export const TagsAndSortedByAI: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/documents/doc_a', () => HttpResponse.json({ data: filed('doc_a') })),
        http.patch('/api/v1/documents/doc_a', async ({ request }) => {
          sent.tags.push(await request.json())
          return HttpResponse.json({ data: filed('doc_a') })
        }),
        http.delete('/api/v1/documents/doc_a/filing', async () => {
          // Slower than the play: a toast left over from the story before would pass its check without the request.
          await delay(300)
          sent.undone.push('doc_a')
          return HttpResponse.json({ data: file('doc_a') })
        }),
        ...screenHandlers,
      ],
    },
  },
  render: () => (
    <>
      <Preview
        id="doc_a"
        siblings={[filed('doc_a'), file('doc_b', { tags: ['paid', 'invoice'] })]}
        commands={commands}
        onNavigate={fn()}
        onClose={fn()}
      />
      <Toaster />
    </>
  ),
  play: async () => {
    sent.tags = []
    sent.undone = []
    const body = within(document.body)
    await body.findByText('Sorted by AI into Invoices')
    await expect(body.getByText('acme')).toBeVisible()

    await userEvent.click(body.getByRole('button', { name: 'Edit' }))
    const input = body.getByRole('textbox', { name: 'Tags' })
    await userEvent.type(input, 'pa')
    // suggested from the tags of the files around it
    await userEvent.click(await body.findByRole('button', { name: /paid/ }))
    await userEvent.type(input, '{Enter}')
    await waitFor(() => expect(sent.tags).toEqual([{ tags: ['invoice', 'acme', 'paid'] }]))

    await userEvent.click(body.getByRole('button', { name: 'Undo' }))
    await body.findByText('File put back where uploaded.')
    await expect(sent.undone).toEqual(['doc_a'])
  },
}
export const TagsAndSortedByAIDark: Story = {
  ...TagsAndSortedByAI,
  parameters: { ...TagsAndSortedByAI.parameters, dark: true },
}

/** A member who may only read sees the tags, without Edit or Undo. */
export const TagsReadOnly: Story = {
  parameters: {
    msw: {
      handlers: [
        sessionHandler({ role: 'member', scopes: ['read:documents'] }),
        http.get('/api/v1/documents/doc_a', () => HttpResponse.json({ data: filed('doc_a') })),
        ...screenHandlers,
      ],
    },
  },
  render: () => (
    <Preview id="doc_a" siblings={[]} commands={commands} onNavigate={fn()} onClose={fn()} />
  ),
  play: async () => {
    const body = within(document.body)
    await body.findByText('Sorted by AI into Invoices')
    await waitFor(() => expect(body.queryByRole('button', { name: 'Edit' })).toBeNull())
    await expect(body.queryByRole('button', { name: 'Undo' })).toBeNull()
  },
}

/** Automatic tags (what the file is) are outlined, the person's own soft; each automatic one says it in a tooltip. */
export const AutomaticTagsMuted: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/documents/doc_a', () =>
          HttpResponse.json({
            data: file('doc_a', {
              tags: ['urgent', 'invoice', 'year-2026', 'client-acme-ag', '2026-in-005'],
              auto_tags: ['invoice', 'year-2026', 'client-acme-ag', '2026-in-005'],
            }),
          }),
        ),
        ...screenHandlers,
      ],
    },
  },
  render: () => (
    <Preview id="doc_a" siblings={[]} commands={commands} onNavigate={fn()} onClose={fn()} />
  ),
  play: async () => {
    const body = within(document.body)
    const auto = await body.findByText('year-2026')
    await expect(auto).toHaveAttribute('data-auto-tag')
    await expect(auto).toHaveAttribute('data-variant', 'outline')
    await expect(body.getByText('urgent')).not.toHaveAttribute('data-auto-tag')
    auto.focus()
    await expect(
      await body.findByRole('tooltip', { name: /Added automatically/ }),
    ).toBeInTheDocument()
  },
}

const undone: string[] = []

/** Two uploads AI filing will sort; the hook polls them and announces the batch once. */
function FilingAfterUpload() {
  const uploads = newUploads([new File(['a'], 'a.pdf'), new File(['b'], 'b.pdf')], null, '').map(
    (upload, i) => ({
      ...upload,
      status: 'done' as const,
      progress: 1,
      result: file(`doc_${i}`, {
        ai_filing: { status: 'queued', folder: null, created_folder: false, tags: [] },
      }),
    }),
  )
  useAIFilingToast(uploads)
  return <Toaster position="bottom-right" />
}

export const FiledToastWithUndo: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/documents/:id', ({ params }) =>
          HttpResponse.json({ data: filed(String(params.id)) }),
        ),
        http.delete('/api/v1/documents/:id/filing', ({ params }) => {
          undone.push(String(params.id))
          return HttpResponse.json({ data: file(String(params.id)) })
        }),
        ...screenHandlers,
      ],
    },
  },
  render: () => <FilingAfterUpload />,
  play: async () => {
    const body = within(document.body)
    await body.findByText('Filed 2 files into Invoices.', {}, { timeout: 5000 })
    await userEvent.click(body.getByRole('button', { name: 'Undo' }))
    await body.findByText('Files put back where uploaded.')
    await expect(undone.toSorted()).toEqual(['doc_0', 'doc_1'])
  },
}

/** A long uploader's name wraps inside the details card instead of running past its edge. */
export const LongUploaderName: Story = {
  globals: { viewport: { value: 'laptop' } },
  parameters: {
    viewport: {
      options: { laptop: { name: 'Laptop', styles: { width: '1280px', height: '900px' } } },
    },
    msw: {
      handlers: [
        http.get('/api/v1/documents/doc_a', () =>
          HttpResponse.json({
            data: filed('doc_a', {
              uploaded_by: { ...storySession.user, name: 'Peteeeeeeeeeer Kraaaaaaaaaaaaaajewski' },
            }),
          }),
        ),
        ...screenHandlers,
      ],
    },
  },
  render: TagsReadOnly.render,
  play: async () => {
    const body = within(document.body)
    const value = await body.findByText(/Peteeeeeeeeeer Kraaaaaaaaaaaaaajewski/)
    await expect(value).toBeVisible()
    const list = value.closest('dl')
    if (!list) throw new Error('Expected the details list')
    await expect(value.getBoundingClientRect().right).toBeLessThanOrEqual(
      list.getBoundingClientRect().right,
    )
  },
}
