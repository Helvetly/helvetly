import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { OrganizeDrawer } from '@/components/documents/organize-drawer'
import type { Folder, OrganizeItem, OrganizeProposal } from '@/lib/documents'

import { sessionHandler } from './screen-fixtures'

const meta = {
  title: 'Shared flows/Organize documents',
  parameters: { layout: 'fullscreen' },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)

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

const proposals: OrganizeProposal[] = [
  {
    document_id: 'doc_1',
    name: '2025-IN-001.pdf',
    from_folder: null,
    folder: 'Invoices/2025',
    tags: ['invoice', 'lessons'],
    reason: 'An invoice you issued in January 2025.',
    change: true,
  },
  {
    document_id: 'doc_2',
    name: 'lease-office.pdf',
    from_folder: null,
    folder: 'Contracts',
    tags: ['contract'],
    reason: 'A lease agreement for the office.',
    change: true,
  },
  {
    document_id: 'doc_3',
    name: 'receipt-2024-12.png',
    from_folder: 'Receipts/2024',
    folder: 'Receipts/2024',
    tags: ['receipt'],
    reason: 'Already filed with the 2024 receipts.',
    change: false,
  },
]

let applied: OrganizeItem[] = []

const handlers = [
  sessionHandler(),
  http.get('/api/v1/documents/folders', () =>
    HttpResponse.json({
      data: [
        folder('fld_c', 'Contracts'),
        folder('fld_r', 'Receipts'),
        folder('fld_r24', '2024', 'fld_r'),
      ],
    }),
  ),
  http.post('/api/v1/documents/organize', () =>
    HttpResponse.json({ data: { proposals, considered: 3 } }),
  ),
  http.post<never, { items: OrganizeItem[] }>(
    '/api/v1/documents/organize/apply',
    async ({ request }) => {
      applied = (await request.json()).items
      return HttpResponse.json({
        data: {
          moved: applied.length,
          tagged: applied.length,
          undo: { previous: [], created_folders: [] },
        },
      })
    },
  ),
]

/**
 * Heidi proposes a folder and tags per document; the ones that already sit well are hidden until asked, a folder
 * that does not exist yet says so, and only the ticked rows (with any edits) are applied.
 */
export const ProposeAndApply: Story = {
  beforeEach: () => {
    applied = []
  },
  parameters: { msw: { handlers } },
  render: () => <OrganizeDrawer onClose={() => {}} />,
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Suggest an organization' }))
    const table = await body().findByRole('table', { name: 'Proposed changes' })
    await expect(body().getByText('2 to move')).toBeVisible()
    await expect(body().getByText('1 already in place')).toBeVisible()
    await expect(within(table).queryByText('receipt-2024-12.png')).toBeNull()
    // Invoices/2025 does not exist yet; Contracts does.
    await expect(within(table).getAllByText('New folder')).toHaveLength(1)

    // Both changes are ticked; the person extends one folder path and drops a tag.
    const leasePath = within(
      within(table).getByRole('group', { name: 'Folder for lease-office.pdf' }),
    )
    await userEvent.click(leasePath.getByRole('button', { name: /^Add folder/ }))
    const popup = within(document.body)
    await userEvent.type(await popup.findByPlaceholderText(/search/i), 'Office')
    await userEvent.click(await popup.findByText(/Add “Office”/))
    await userEvent.click(within(table).getByRole('button', { name: 'Remove tag lessons' }))

    await userEvent.click(body().getByRole('switch'))
    await expect(within(table).getByText('receipt-2024-12.png')).toBeVisible()

    await userEvent.click(body().getByRole('button', { name: 'Apply 2 changes' }))
    await waitFor(() =>
      expect(applied).toEqual([
        { document_id: 'doc_1', folder: 'Invoices/2025', tags: ['invoice'] },
        { document_id: 'doc_2', folder: 'Contracts/Office', tags: ['contract'] },
      ]),
    )
  },
}

/** Nothing to change: the drawer says so instead of an empty table. */
export const AllInPlace: Story = {
  parameters: {
    msw: {
      handlers: [
        sessionHandler(),
        http.get('/api/v1/documents/folders', () => HttpResponse.json({ data: [] })),
        http.post('/api/v1/documents/organize', () =>
          HttpResponse.json({ data: { proposals: [proposals[2]], considered: 1 } }),
        ),
      ],
    },
  },
  render: () => <OrganizeDrawer onClose={() => {}} />,
  play: async () => {
    await userEvent.click(await body().findByRole('button', { name: 'Suggest an organization' }))
    await expect(await body().findByText(/Everything already sits in a good place/)).toBeVisible()
    await expect(body().getByRole('button', { name: 'Apply' })).toBeDisabled()
  },
}
