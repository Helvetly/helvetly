import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { useQueryClient } from '@tanstack/react-query'
import { delay, http, HttpResponse } from 'msw'
import { useReducer, useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { StagedUpload } from '@/components/documents/staged-upload'
import { newUploads, queueReducer, type Upload } from '@/components/documents/upload-queue'
import { UploadTray } from '@/components/documents/upload-tray'
import type { DocFile, Folder, OrganizeItem, OrganizeProposal, StagedFile } from '@/lib/documents'
import { usageKey, type HeidiUsage } from '@/lib/heidi'

import { sessionHandler } from './screen-fixtures'

const meta = {
  title: 'Shared flows/Staged upload',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)
const BATCH = 'batch-story-1'

const stagedFile = (id: string, name: string): StagedFile => ({
  id,
  batch_id: BATCH,
  name,
  size: 48_000,
  content_type: 'application/pdf',
})

const docFile = (id: string, name: string, folderId: string | null): DocFile => ({
  id,
  name,
  folder_id: folderId,
  folder: null,
  size: 48_000,
  content_type: 'application/pdf',
  kind: 'pdf',
  sha256: null,
  tags: [],
  ai_filing: null,
  previewable: true,
  links: [],
  retained_until: null,
  uploaded_by: null,
  created_at: '2026-11-27T09:00:00Z',
  updated_at: '2026-11-27T09:00:00Z',
  deleted_at: null,
  deleted_by: null,
  purge_at: null,
})

const folder = (id: string, name: string, parent: string | null = null): Folder => ({
  id,
  name,
  parent_id: parent,
  file_count: 0,
  size: 0,
  total_files: 0,
  total_size: 0,
  starred: false,
  created_by: null,
  created_at: '2026-01-05T09:00:00Z',
  updated_at: '2026-01-05T09:00:00Z',
})

/** An upload batch whose files are all up: these staged, plus the duplicates the server refused. */
function batchOf(files: StagedFile[], duplicates: string[] = []): Upload[] {
  const uploads = newUploads(
    [...files.map((f) => new File(['x'], f.name)), ...duplicates.map((n) => new File(['x'], n))],
    'fld_inbox',
    'Inbox',
    'fail',
    BATCH,
  )
  return uploads.map((upload, i) => {
    const staged = files[i]
    return staged
      ? { ...upload, status: 'staged', progress: 1, staged }
      : {
          ...upload,
          status: 'duplicate',
          error: `This file has already been uploaded as ${upload.file.name}.`,
        }
  })
}

const consented: HeidiUsage = {
  period: '2026-11',
  tokens_used: 0,
  tokens_included: null,
  tokens_purchased: 0,
  tokens_remaining: null,
  consent: {
    granted: true,
    version: 'v1',
    current_version: 'v1',
    changed_at: null,
    changed_by: '',
  },
}

/** The Documents page's upload pieces: the tray and the staged-upload choice, over a ready batch. */
function Harness({ initial, ai }: { initial: Upload[]; ai: boolean }) {
  const queryClient = useQueryClient()
  useState(() => (ai ? queryClient.setQueryData(usageKey, consented) : undefined))
  const [uploads, dispatch] = useReducer(queueReducer, initial)
  return (
    <>
      <UploadTray uploads={uploads} act={dispatch} />
      <StagedUpload uploads={uploads} dispatch={dispatch} />
    </>
  )
}

const two = [stagedFile('doc_s1', 'statement-oct.pdf'), stagedFile('doc_s2', 'tax-2025.pdf')]
const proposals: OrganizeProposal[] = [
  {
    document_id: 'doc_s1',
    name: 'statement-oct.pdf',
    from_folder: 'Inbox',
    folder: 'Clients/Kunde AG/Documents/2026/Bank Statements',
    tags: ['bank-statement'],
    reason: 'A bank statement naming Kunde AG, dated October 2026.',
    change: true,
  },
  {
    document_id: 'doc_s2',
    name: 'tax-2025.pdf',
    from_folder: 'Inbox',
    folder: 'Tax Documents/2025',
    tags: ['tax-document'],
    reason: 'The tax assessment for 2025.',
    change: true,
  },
]

let confirmed: { folder_id: string | null; items?: OrganizeItem[] } | null = null
let cancelled = 0
let analysed: string[][] = []

const confirmHandler = http.post<never, { folder_id: string | null; items?: OrganizeItem[] }>(
  `/api/v1/documents/staged/${BATCH}/confirm`,
  async ({ request }) => {
    confirmed = await request.json()
    return HttpResponse.json({
      data: {
        documents: two.map((f) => docFile(f.id, f.name, 'fld_inbox')),
        duplicates: [],
      },
    })
  },
)
const handlers = [
  sessionHandler(),
  http.get('/api/v1/documents/folders', () =>
    HttpResponse.json({ data: [folder('fld_inbox', 'Inbox')] }),
  ),
  confirmHandler,
  http.post(`/api/v1/documents/staged/${BATCH}/cancel`, () => {
    cancelled++
    return new HttpResponse(null, { status: 204 })
  }),
  http.post<never, { ids: string[] }>(
    `/api/v1/documents/staged/${BATCH}/analyze`,
    async ({ request }) => {
      const { ids } = await request.json()
      analysed.push(ids)
      await delay(150)
      return HttpResponse.json({
        data: {
          proposals: proposals.filter((p) => ids.includes(p.document_id)),
          considered: ids.length,
        },
      })
    },
  ),
]
const reset = () => {
  confirmed = null
  cancelled = 0
  analysed = []
}

/** "Just upload" files the batch where the person was; the tray then says where each file went. */
export const JustUpload: Story = {
  beforeEach: reset,
  parameters: { msw: { handlers } },
  render: () => <Harness initial={batchOf(two, ['old-copy.pdf'])} ai />,
  play: async () => {
    const dialog = within(await body().findByRole('dialog', { name: 'Uploaded 2 files' }))
    await expect(dialog.getByText('statement-oct.pdf')).toBeVisible()
    // the duplicate was not staged: it is reported, not offered
    await expect(
      dialog.getByText('This file has already been uploaded as old-copy.pdf.'),
    ).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'AI smart grouping' })).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Just upload' }))
    await waitFor(() => expect(confirmed).toEqual({ folder_id: 'fld_inbox' }))
    await waitFor(() => expect(body().queryByRole('dialog')).toBeNull())
    const tray = within(body().getByRole('region', { name: 'Uploads' }))
    await expect(tray.getAllByText('Uploaded · Inbox')).toHaveLength(2)
  },
}

/** Without AI approval there is only "Just upload". */
export const WithoutAI: Story = {
  beforeEach: reset,
  parameters: { msw: { handlers } },
  render: () => <Harness initial={batchOf(two)} ai={false} />,
  play: async () => {
    const dialog = within(await body().findByRole('dialog', { name: 'Uploaded 2 files' }))
    await expect(dialog.getByRole('button', { name: 'Just upload' })).toBeVisible()
    await expect(dialog.queryByRole('button', { name: 'AI smart grouping' })).toBeNull()
  },
}

/** Closing a big batch asks first, then deletes the staged files. */
export const DiscardAsksFirst: Story = {
  beforeEach: reset,
  parameters: { msw: { handlers } },
  render: () => (
    <Harness
      initial={batchOf(['a', 'b', 'c', 'd'].map((n) => stagedFile(`doc_${n}`, `${n}.pdf`)))}
      ai
    />
  ),
  play: async () => {
    await body().findByRole('dialog', { name: 'Uploaded 4 files' })
    await userEvent.keyboard('{Escape}')
    const ask = within(await body().findByRole('dialog', { name: 'Discard 4 uploaded files?' }))
    await userEvent.click(ask.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(cancelled).toBe(1))
    await waitFor(() => expect(body().queryByRole('dialog')).toBeNull())
  },
}

/**
 * AI smart grouping: each file is looked at (a few per request, with progress), then reviewed: the kind, client and
 * year per row, the reason behind an info icon. The person retargets one and leaves one out; Apply files all.
 */
export const SmartGrouping: Story = {
  beforeEach: reset,
  parameters: { msw: { handlers } },
  render: () => <Harness initial={batchOf(two)} ai />,
  play: async () => {
    const dialog = within(await body().findByRole('dialog', { name: 'Uploaded 2 files' }))
    await userEvent.click(dialog.getByRole('button', { name: 'AI smart grouping' }))
    await expect(await body().findByText('Looked at 0 of 2')).toBeVisible()
    const table = within(await body().findByRole('table', { name: 'Proposed changes' }))
    await expect(analysed).toEqual([['doc_s1', 'doc_s2']])
    await expect(table.getByText('Bank statement')).toBeVisible()
    // the client and year beside the kind, besides their place in the path
    await expect(table.getAllByText('Kunde AG')).toHaveLength(2)
    await expect(table.getAllByText('2026')).toHaveLength(2)
    await expect(
      table.getByRole('button', { name: 'Why statement-oct.pdf goes here' }),
    ).toBeVisible()

    // the tax file stays in Inbox; the statement goes one level deeper
    await userEvent.click(table.getByRole('checkbox', { name: 'Select tax-2025.pdf' }))
    const statementPath = within(table.getByRole('group', { name: 'Folder for statement-oct.pdf' }))
    await userEvent.click(statementPath.getByRole('button', { name: /^Add folder/ }))
    await userEvent.type(await body().findByPlaceholderText(/search/i), 'October')
    await userEvent.click(await body().findByText(/Add “October”/))

    await userEvent.click(body().getByRole('button', { name: 'File 2 files' }))
    await waitFor(() =>
      expect(confirmed).toEqual({
        folder_id: 'fld_inbox',
        items: [
          {
            document_id: 'doc_s1',
            folder: 'Clients/Kunde AG/Documents/2026/Bank Statements/October',
            tags: ['bank-statement'],
          },
        ],
      }),
    )
    const tray = within(await body().findByRole('region', { name: 'Uploads' }))
    await expect(
      await tray.findByText(
        'Uploaded · Clients › Kunde AG › Documents › 2026 › Bank Statements › October',
      ),
    ).toBeVisible()
    await expect(tray.getByText('Uploaded · Inbox')).toBeVisible()
  },
}

/** A failed analysis says why and goes on from where it stopped when asked again. */
export const AnalysisFails: Story = {
  beforeEach: reset,
  parameters: {
    msw: {
      handlers: [
        http.post(
          `/api/v1/documents/staged/${BATCH}/analyze`,
          () =>
            HttpResponse.json(
              {
                error: {
                  code: 'ai_busy',
                  message: 'The AI is busy right now. Try again in a minute.',
                },
              },
              { status: 503 },
            ),
          { once: true },
        ),
        ...handlers,
      ],
    },
  },
  render: () => <Harness initial={batchOf(two)} ai />,
  play: async () => {
    const dialog = within(await body().findByRole('dialog', { name: 'Uploaded 2 files' }))
    await userEvent.click(dialog.getByRole('button', { name: 'AI smart grouping' }))
    await expect(
      await body().findByText('The AI is busy right now. Try again in a minute.'),
    ).toBeVisible()
    await userEvent.click(body().getByRole('button', { name: 'Retry' }))
    await expect(await body().findByRole('table', { name: 'Proposed changes' })).toBeVisible()
  },
}

/** Filing can be refused (here: storage full); the review stays open with the reason. */
export const FilingFails: Story = {
  beforeEach: reset,
  parameters: {
    msw: {
      handlers: [
        http.post(`/api/v1/documents/staged/${BATCH}/confirm`, () =>
          HttpResponse.json(
            {
              error: { code: 'validation_failed', message: 'This folder doesn’t exist any more.' },
            },
            { status: 422 },
          ),
        ),
        ...handlers,
      ],
    },
  },
  render: () => <Harness initial={batchOf(two)} ai />,
  play: async () => {
    const dialog = within(await body().findByRole('dialog', { name: 'Uploaded 2 files' }))
    await userEvent.click(dialog.getByRole('button', { name: 'AI smart grouping' }))
    await body().findByRole('table', { name: 'Proposed changes' })
    await userEvent.click(body().getByRole('button', { name: 'File 2 files' }))
    await expect(await body().findByText('This folder doesn’t exist any more.')).toBeVisible()
    await expect(body().getByRole('table', { name: 'Proposed changes' })).toBeVisible()
  },
}
