import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { DocumentsPage } from '@/components/documents/documents-page'

import { sessionHandler } from '../screen-fixtures'
import { closeHeidi, dark, desktop, Frame, pageParameters, phone, shows } from './frame'

const meta = {
  title: 'Pages/Documents',
  beforeEach: closeHeidi,
  parameters: pageParameters('/documents'),
  render: () => (
    <Frame>
      <DocumentsPage />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

export const FoldersAndFiles: Story = { play: shows('Receipts 2026', 'Budget 2027.xlsx') }
export const FoldersAndFilesDark = dark(FoldersAndFiles)
export const FoldersAndFilesPhone = phone(FoldersAndFiles)

/** A folder opens inside "All files": no tab for it, the breadcrumb says where you are. */
export const FolderStaysInAllFiles: Story = {
  parameters: pageParameters('/documents', { folder: 'fld_contracts' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const crumbs = await body.findByRole('navigation', { name: 'Breadcrumbs' }, { timeout: 8000 })
    await waitFor(() => expect(within(crumbs).getByText('Contracts')).toBeVisible())
    // "All files" stays the header's tab, the default view pinned tabs join.
    const views = body.getByRole('navigation', { name: 'Views' })
    await expect(within(views).getByRole('button', { name: 'All files' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  },
}

export const Templates: Story = {
  parameters: pageParameters('/documents', { view: 'templates' }),
  play: shows('Power of attorney'),
}
export const TemplatesDark = dark(Templates)
export const TemplatesPhone = phone(Templates)

const noFolders = http.get('/api/v1/documents/folders', () => HttpResponse.json({ data: [] }))
let created: unknown = null
const createFolder = http.post('/api/v1/documents/folders', async ({ request }) => {
  created = await request.json()
  return HttpResponse.json({ data: { id: 'fld_new', name: 'Contracts', parent_id: null } })
})

/** No folders yet: suggestions are dashed "+ name" chips, not rows that look like real folders. */
export const NoFolders: Story = {
  parameters: pageParameters('/documents', {}, [noFolders, createFolder]),
  play: async ({ canvasElement }) => {
    created = null
    const body = within(canvasElement.ownerDocument.body)
    const tree = await body.findByRole('navigation', { name: 'Folders' }, { timeout: 8000 })
    const folders = within(tree)
    await waitFor(() => expect(folders.getByText('No folders yet')).toBeVisible())
    await expect(folders.getByText('Uploads are sorted into folders automatically')).toBeVisible()
    await expect(folders.queryByRole('list', { name: 'Folder tree' })).toBeNull()
    const suggestions = within(folders.getByRole('list', { name: 'Suggested' }))
    const chips = suggestions.getAllByRole('button').map((chip) => chip.getAttribute('aria-label'))
    await expect(chips).toEqual([
      'Create folder Contracts',
      'Create folder Bank statements',
      'Create folder Tax 2026',
    ])
    await userEvent.click(suggestions.getByRole('button', { name: 'Create folder Contracts' }))
    await waitFor(() => expect(created).toMatchObject({ name: 'Contracts' }))
  },
}
export const NoFoldersDark = dark(NoFolders)

/** A member who only reads sees that there are no folders, without suggestions to create one. */
export const NoFoldersReadOnly: Story = {
  parameters: pageParameters('/documents', {}, [
    noFolders,
    sessionHandler({ role: 'member', scopes: ['read:*'] }),
  ]),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const tree = await body.findByRole('navigation', { name: 'Folders' }, { timeout: 8000 })
    const folders = within(tree)
    await waitFor(() => expect(folders.getByText('No folders yet')).toBeVisible())
    await expect(folders.queryByText('Uploads are sorted into folders automatically')).toBeNull()
    await expect(folders.queryByRole('list', { name: 'Suggested' })).toBeNull()
    await expect(folders.queryByRole('button', { name: 'New folder' })).toBeNull()
  },
}
