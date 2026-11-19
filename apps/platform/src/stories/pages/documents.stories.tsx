import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { DocumentsPage } from '@/components/documents/documents-page'

import { sessionHandler } from '../screen-fixtures'
import { folders as sampleFolders } from './api'
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

/** Templates are only listed and edited here: New template is the one action, the page's are gone. */
export const Templates: Story = {
  parameters: pageParameters('/documents', { view: 'templates' }),
  play: async (context) => {
    await shows('Power of attorney')?.(context)
    const body = within(context.canvasElement.ownerDocument.body)
    await expect(body.getByRole('button', { name: 'New template' })).toBeVisible()
    for (const name of ['Upload', 'Create', 'Organize with AI', 'Use a template…'])
      expect(within(body.getByRole('main')).queryByRole('button', { name })).toBeNull()
    await expect(body.queryByRole('button', { name: 'More' })).toBeNull()
  },
}
export const TemplatesDark = dark(Templates)
export const TemplatesPhone = phone(Templates)

/** A row opens the template to edit, never the fill flow. */
export const TemplateRowEdits: Story = {
  parameters: pageParameters('/documents', { view: 'templates' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await body.findByRole('button', { name: /^Power of attorney/ }, { timeout: 8000 }),
    )
    await expect(
      await body.findByRole('dialog', { name: 'Power of attorney' }, { timeout: 8000 }),
    ).toBeVisible()
  },
}

/** Signatures, like Templates and Trash, drops the page's file actions for its own one. */
export const Signatures: Story = {
  parameters: pageParameters('/documents', { view: 'signatures' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(
      await body.findByRole('button', { name: 'PDF for signature' }, { timeout: 8000 }),
    ).toBeVisible()
    for (const name of ['Upload', 'Create', 'Organize with AI'])
      expect(within(body.getByRole('main')).queryByRole('button', { name })).toBeNull()
  },
}

const noTemplates = http.get('/api/v1/templates', () => HttpResponse.json({ data: [] }))

/** No templates yet: the empty state offers New template, still without the page's actions. */
export const TemplatesEmpty: Story = {
  parameters: pageParameters('/documents', { view: 'templates' }, [noTemplates]),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(body.getByText('No templates yet')).toBeVisible(), { timeout: 8000 })
    await expect(body.getAllByRole('button', { name: 'New template' }).length).toBeGreaterThan(0)
    for (const name of ['Upload', 'Create', 'Organize with AI'])
      expect(within(body.getByRole('main')).queryByRole('button', { name })).toBeNull()
  },
}

/** Create → Document from template… opens the fill flow: pick a template, then a client. */
export const CreateFromTemplate: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    // In <main>, where the other stories expect it gone from Templates, Signatures and Trash.
    const main = within(await body.findByRole('main', {}, { timeout: 8000 }))
    await userEvent.click(await main.findByRole('button', { name: 'Create' }, { timeout: 8000 }))
    const menu = within(await body.findByRole('menu'))
    await expect(menu.queryByText('Template…')).toBeNull()
    await expect(menu.getByText('PDF for signature…')).toBeVisible()
    await expect(menu.getByText('New folder')).toBeVisible()
    const item = menu.getByRole('menuitem', { name: /^Document from template…/ })
    await expect(item).toHaveTextContent('A contract or letter filled from a client')
    await waitFor(() => expect(item).not.toHaveAttribute('data-disabled'))
    await userEvent.click(item)
    const drawer = within(await body.findByRole('dialog', { name: 'New document from a template' }))
    await expect(await drawer.findByText('Power of attorney')).toBeVisible()
  },
}

/** With no template yet the item is disabled and says where to make one, never an empty picker. */
export const CreateFromTemplateNone: Story = {
  parameters: pageParameters('/documents', {}, [noTemplates]),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole('button', { name: 'Create' }, { timeout: 8000 }))
    const menu = within(await body.findByRole('menu'))
    const item = menu.getByRole('menuitem', { name: /^Document from template…/ })
    await waitFor(() => expect(item).toHaveAttribute('data-disabled'))
    await expect(item).toHaveTextContent(
      'No templates yet. Create one in Templates → New template.',
    )
    await userEvent.keyboard('{Escape}')
  },
}

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

const invoices = { ...sampleFolders[2], id: 'fld_invoices', name: 'Invoices', starred: false }
const nestedFolders = http.get('/api/v1/documents/folders', () =>
  HttpResponse.json({
    data: [
      ...sampleFolders,
      invoices,
      { ...invoices, id: 'fld_invoices_2025', name: '2025', parent_id: 'fld_invoices' },
    ],
  }),
)

/**
 * The sidebar: All documents, Recent, Templates and Signatures on top; a folder's own icon is its
 * disclosure (open while expanded), its name opens it. A selected tile keeps its size.
 */
export const FolderTree: Story = {
  parameters: pageParameters('/documents', {}, [nestedFolders]),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const nav = await body.findByRole('navigation', { name: 'Folders' }, { timeout: 8000 })
    const tree = within(nav)
    const places = Array.from(nav.children)
      .slice(0, 4)
      .map((place) => place.textContent)
    await expect(places).toEqual(['All documents', 'Recent', 'Templates', 'Signatures'])

    const toggle = await tree.findByRole('button', { name: 'Expand Invoices' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(tree.queryByText('2025')).toBeNull()
    await userEvent.click(toggle)
    const collapse = tree.getByRole('button', { name: 'Collapse Invoices' })
    await expect(collapse).toHaveAttribute('aria-expanded', 'true')
    await expect(tree.getByText('2025')).toBeVisible()
    // Leaves have no toggle; the name stays the one way into a folder.
    await expect(tree.queryByRole('button', { name: 'Expand 2025' })).toBeNull()

    // Keyboard: the toggle takes focus and Enter flips it; arrows on the name work too.
    collapse.focus()
    await userEvent.keyboard('{Enter}')
    await expect(tree.getByRole('button', { name: 'Expand Invoices' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    tree.getByRole('button', { name: /^Invoices/ }).focus()
    await userEvent.keyboard('{ArrowRight}')
    await waitFor(() => expect(tree.getByText('2025')).toBeVisible())
    // The arrow stays in the tree: no tile in the grid gets selected by it.
    await expect(body.queryAllByRole('checkbox', { checked: true })).toHaveLength(0)
    const active = canvasElement.ownerDocument.activeElement
    if (active instanceof HTMLElement) active.blur()

    await selectTile(canvasElement)
  },
}
export const FolderTreeDark = dark(FolderTree)
/** On a phone the sidebar is a drawer: the selected tile keeps its size beside the others. */
export const FolderTreePhone: Story = {
  ...phone(FolderTree),
  play: async ({ canvasElement }) => selectTile(canvasElement),
}

async function selectTile(canvasElement: HTMLElement) {
  const body = within(canvasElement.ownerDocument.body)
  const check = await body.findByRole(
    'checkbox',
    { name: 'Select Receipts 2026' },
    { timeout: 8000 },
  )
  await userEvent.click(check)
  await expect(check).toBeChecked()
}
