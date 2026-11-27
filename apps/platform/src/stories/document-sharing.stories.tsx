import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { ItemsView } from '@/components/documents/items-view'
import { fileKey } from '@/components/documents/selection'
import { ShareDialog } from '@/components/documents/share-dialog'
import type { DocFile, DocumentShare, DocumentShareLink } from '@/lib/documents'

import { desktop, pageParameters } from './pages/frame'

const file = (change: Partial<DocFile> = {}): DocFile => ({
  id: 'doc_1',
  name: '2025-IN-002.pdf',
  folder_id: null,
  folder: null,
  size: 61_000,
  content_type: 'application/pdf',
  kind: 'pdf',
  sha256: null,
  tags: [],
  ai_filing: null,
  previewable: false,
  links: [],
  shared_with: [],
  retained_until: null,
  uploaded_by: null,
  created_at: '2026-11-18T10:00:00Z',
  updated_at: '2026-11-18T10:00:00Z',
  deleted_at: null,
  deleted_by: null,
  purge_at: null,
  ...change,
})

const keller: DocumentShare = {
  client_id: 'cli_1',
  client_name: 'Keller AG',
  shared_at: '2026-11-01T10:00:00Z',
}

/** The share endpoints over an in-memory list, so a story sees its own writes. */
const shareHandlers = (start: DocumentShare[]) => {
  let shares = [...start]
  let links: DocumentShareLink[] = []
  return pageParameters('/documents', {}, [
    http.get('/api/v1/documents/doc_1/shares', () => HttpResponse.json({ data: shares })),
    http.get('/api/v1/clients', () =>
      HttpResponse.json({
        data: [
          { id: 'cli_1', name: 'Keller AG', city: 'Zürich', contacts: [] },
          { id: 'cli_2', name: 'Meier GmbH', city: 'Bern', contacts: [] },
        ],
      }),
    ),
    http.post<never, { client_id: string }>(
      '/api/v1/documents/doc_1/shares',
      async ({ request }) => {
        const { client_id } = await request.json()
        shares = [
          { client_id, client_name: 'Meier GmbH', shared_at: '2026-11-23T10:00:00Z' },
          ...shares,
        ]
        return new HttpResponse(null, { status: 204 })
      },
    ),
    http.delete('/api/v1/documents/doc_1/shares', ({ request }) => {
      const client = new URL(request.url).searchParams.get('client_id')
      shares = shares.filter((share) => share.client_id !== client)
      return new HttpResponse(null, { status: 204 })
    }),
    http.get('/api/v1/documents/doc_1/share-links', () => HttpResponse.json({ data: links })),
    http.post<never, { single_use: boolean; expires_in_seconds?: number }>(
      '/api/v1/documents/doc_1/share-links',
      async ({ request }) => {
        const body = await request.json()
        const now = new Date()
        const link = {
          id: 'dsl_1',
          single_use: body.single_use,
          created_at: now.toISOString(),
          expires_at: body.expires_in_seconds
            ? new Date(now.getTime() + body.expires_in_seconds * 1000).toISOString()
            : null,
          used_at: null,
        }
        links = [link]
        return HttpResponse.json({ data: { ...link, token: 'A'.repeat(43) } }, { status: 201 })
      },
    ),
    http.delete('/api/v1/documents/doc_1/share-links', () => {
      links = []
      return new HttpResponse(null, { status: 204 })
    }),
  ])
}

const meta = {
  title: 'Documents/Share with client',
  parameters: shareHandlers([]),
  globals: desktop,
  render: () => (
    <ShareDialog
      file={file({ links: [{ type: 'client', id: 'cli_2', label: 'Meier GmbH', retains: false }] })}
      onClose={() => {}}
    />
  ),
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)

/** Nobody yet: one muted line; the linked client is preselected and Enter shares with it. */
export const ShareWithLinkedClient: Story = {
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Share document' })
    await expect(await within(dialog).findByText('Not shared with any client yet.')).toBeVisible()
    const share = within(dialog).getByRole('button', { name: 'Share' })
    await waitFor(() => expect(share).toBeEnabled())
    await userEvent.click(share)
    const sharedWith = within(dialog).getByRole('region', { name: 'Shared with' })
    await expect(await within(sharedWith).findByText('Meier GmbH')).toBeVisible()
    await expect(
      await within(dialog).findByRole('button', { name: 'View as client' }),
    ).toBeVisible()
  },
}

/** Remove asks first; Cancel keeps the share, Remove ends it. */
export const RemoveWithConfirm: Story = {
  parameters: shareHandlers([keller]),
  play: async () => {
    const dialog = await body().findByRole('dialog', { name: 'Share document' })
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Remove Keller AG' }))
    await expect(await body().findByText('Stop sharing with Keller AG?')).toBeVisible()
    await userEvent.click(body().getByRole('button', { name: 'Cancel' }))
    await expect(within(dialog).getByText('Keller AG')).toBeVisible()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove Keller AG' }))
    await userEvent.click(await body().findByRole('button', { name: 'Remove' }))
    await expect(await within(dialog).findByText('Not shared with any client yet.')).toBeVisible()
  },
}

export const TimeLimitedLink: Story = {
  parameters: shareHandlers([]),
  play: async () => {
    const dialog = within(await body().findByRole('dialog', { name: 'Share document' }))
    await userEvent.click(dialog.getByRole('radio', { name: 'Share by link' }))
    await userEvent.click(dialog.getByRole('button', { name: /Expires after/ }))
    await userEvent.click(await body().findByRole('option', { name: 'Hours' }))
    const duration = dialog.getByRole('spinbutton', { name: 'Duration' })
    await userEvent.clear(duration)
    await userEvent.type(duration, '2')
    await userEvent.click(dialog.getByRole('switch', { name: 'One-time download' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Create link' }))
    const url = await dialog.findByRole('textbox', { name: 'Share by link' })
    await expect(url).toHaveValue(new URL(`/share#${'A'.repeat(43)}`, window.location.origin).href)
    const createdLinks = await dialog.findByRole('region', { name: 'Created links' })
    await expect(await within(createdLinks).findByText(/Expires [A-Za-z0-9]/)).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Revoke link' }))
    await waitFor(() => expect(url).not.toBeInTheDocument())
  },
}

function Grid({ files, selected }: { files: DocFile[]; selected: string[] }) {
  return (
    <div className="w-[720px] p-6">
      <ItemsView
        canWrite
        layout="grid"
        folders={[]}
        files={files}
        selected={new Set(selected.map(fileKey))}
        focused={null}
        renaming={null}
        showLocation={false}
        from={null}
        sort="name"
        desc={false}
        onSort={() => {}}
        onClick={() => {}}
        onToggle={() => {}}
        onToggleAll={() => {}}
        onRenameDone={() => {}}
        onContext={() => {}}
        menu={() => null}
        onBand={() => {}}
        onBackground={() => {}}
        collapsed={new Set()}
        onToggleSection={() => {}}
      />
    </div>
  )
}

const intersects = (a: DOMRect, b: DOMRect) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/**
 * A selected card keeps its selected look under the cursor (no grey hover), and the share button sits in its own
 * column: it never covers the size and date, and stays shown (pressed) while the file is shared.
 */
export const GridCards: Story = {
  render: () => (
    <Grid
      files={[
        file(),
        file({
          id: 'doc_2',
          name: 'Contract with a very long name for Keller AG.pdf',
          shared_with: [keller],
        }),
      ]}
      selected={['doc_1']}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const selected = canvasElement.querySelector<HTMLElement>('[data-selected]')
    await expect(selected).not.toBeNull()
    // Hover styles apply only to unselected cards.
    await expect(selected?.className).not.toMatch(/(^|\s)hover:/)
    await expect(selected?.className).toContain('data-selected:hover:ring-primary')

    const shared = canvas.getByRole('button', {
      name: 'Share Contract with a very long name for Keller AG.pdf',
    })
    await expect(shared).toHaveAttribute('aria-pressed', 'true')
    await expect(getComputedStyle(shared.parentElement ?? shared).opacity).toBe('1')
    await userEvent.hover(shared)
    await expect(await body().findByRole('tooltip')).toHaveTextContent('Shared with Keller AG')

    const overlaps = canvas.getAllByRole('button', { name: /^Share / }).map((button) => {
      const card = button.closest<HTMLElement>('.group\\/card')
      const details = card ? within(card).getByText(/2026/) : null
      return details
        ? intersects(button.getBoundingClientRect(), details.getBoundingClientRect())
        : null
    })
    await expect(overlaps).toEqual([false, false])
  },
}
