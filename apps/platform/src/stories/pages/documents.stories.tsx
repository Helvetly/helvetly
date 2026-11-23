import { createTranslators } from '@helvetly/i18n'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fireEvent, spyOn, userEvent, waitFor, within } from 'storybook/test'

import { DocumentsPage } from '@/components/documents/documents-page'
import { FolderName } from '@/components/documents/system-mark'

import de from '../../messages/de.json'
import en from '../../messages/en.json'
import fr from '../../messages/fr.json'
import it from '../../messages/it.json'
import { sessionHandler } from '../screen-fixtures'
import { folders as sampleFolders } from './api'
import { filtersPlay } from './filters'
import { closeHeidi, dark, desktop, Frame, pageParameters, phone, shows } from './frame'

const meta = {
  title: 'Pages/Documents',
  // The last Group by choice is kept per browser; each story starts in Folders unless its URL says.
  beforeEach: () => {
    closeHeidi()
    localStorage.removeItem('helvetly.documents.group')
  },
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
  parameters: pageParameters('/documents', { view: 'signatures' }, [
    http.get('/api/v1/signatures', () => HttpResponse.json({ data: [] })),
  ]),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await expect(
      await body.findByText('Nothing out for signature', {}, { timeout: 8000 }),
    ).toBeVisible()
    // The page's own action, and the empty list's.
    await expect(body.getAllByRole('button', { name: 'PDF for signature' })).toHaveLength(2)
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

const lockTip = "Managed by Helvetly: can't be renamed, moved or deleted"

/** Helvetly's own folders carry a quiet lock, and their menu offers no rename, move or trash. */
export const SystemFolders: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const nav = await body.findByRole('navigation', { name: 'Folders' }, { timeout: 8000 })
    const tree = within(nav)
    const clients = await tree.findByRole('button', { name: /^Clients/ })
    // Clients and Expenses; the plain folders have none.
    await expect(tree.getAllByLabelText(lockTip)).toHaveLength(2)
    await expect(within(clients).getByLabelText(lockTip)).toBeVisible()

    await userEvent.pointer({ keys: '[MouseRight]', target: clients })
    const menu = within(await body.findByRole('menu'))
    await expect(menu.getByRole('menuitem', { name: /New folder inside/ })).toBeVisible()
    await expect(menu.queryByRole('menuitem', { name: /Rename/ })).toBeNull()
    await expect(menu.queryByRole('menuitem', { name: /Move to Trash/ })).toBeNull()
    await userEvent.keyboard('{Escape}')
    // the open menu hides the rest of the page from the accessibility tree until it is gone
    await waitFor(() => expect(body.queryByRole('menu')).toBeNull())

    // A plain folder keeps them.
    await userEvent.pointer({
      keys: '[MouseRight]',
      target: await tree.findByRole('button', { name: /^Tax/ }),
    })
    const plain = within(await body.findByRole('menu'))
    await expect(plain.getByRole('menuitem', { name: /Rename/ })).toBeVisible()
    await expect(plain.getByRole('menuitem', { name: /Move to Trash/ })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    // the open menu hides the rest of the page from the accessibility tree until it is gone
    await waitFor(() => expect(body.queryByRole('menu')).toBeNull())

    // Inside, the empty-system rule leaves 2025 where it holds files; the path opens.
    await userEvent.click(await tree.findByRole('button', { name: 'Expand Clients' }))
    await expect(await tree.findByText('Acme AG')).toBeVisible()
  },
}
export const SystemFoldersDark = dark(SystemFolders)

/** A stale screen: the server refuses to trash a system folder, and the toast says so in words. */
export const SystemFolderRefused: Story = {
  parameters: pageParameters('/documents', {}, [
    http.get('/api/v1/documents/folders', () =>
      HttpResponse.json({ data: sampleFolders.map((f) => ({ ...f, system_kind: null })) }),
    ),
    http.post('/api/v1/documents/bulk', () =>
      HttpResponse.json(
        { error: { code: 'system_folder', message: 'This folder is managed by Helvetly.' } },
        { status: 409 },
      ),
    ),
  ]),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const nav = await body.findByRole('navigation', { name: 'Folders' }, { timeout: 8000 })
    await userEvent.pointer({
      keys: '[MouseRight]',
      target: await within(nav).findByRole('button', { name: /^Clients/ }),
    })
    await userEvent.click(await body.findByRole('menuitem', { name: /Move to Trash/ }))
    await expect(
      await body.findByText(
        "This folder is managed by Helvetly and can't be renamed, moved or deleted.",
      ),
    ).toBeInTheDocument()
  },
}

const translators = createTranslators({ en, de, fr, it })

/** The same folders in German: system folders translate, a client's name and the year do not. */
export const SystemFolderNamesGerman: Story = {
  render: () => (
    <ul>
      {sampleFolders
        .filter((folder) => folder.id.startsWith('fld_sys_'))
        .map((folder) => (
          <li key={folder.id}>
            <FolderName folder={folder} t={translators('de')} />
          </li>
        ))}
    </ul>
  ),
  play: async ({ canvasElement }) => {
    const view = within(canvasElement)
    await expect(view.getByText('Kunden')).toBeVisible()
    await expect(view.getByText('Rechnungen')).toBeVisible()
    await expect(view.getByText('Ausgaben')).toBeVisible()
    await expect(view.getByText('Acme AG')).toBeVisible()
    await expect(view.getAllByText('2025')).toHaveLength(2)
    await expect(view.queryByText('Invoices')).toBeNull()
  },
}

const everyKind = http.get('/api/v1/documents/usage', () =>
  HttpResponse.json({
    data: {
      files: 40,
      size: 9_000_000,
      by_kind: [
        { kind: 'pdf', files: 15, size: 3_600_000 },
        { kind: 'image', files: 6, size: 1_500_000 },
        { kind: 'spreadsheet', files: 4, size: 1_000_000 },
        { kind: 'document', files: 4, size: 900_000 },
        { kind: 'presentation', files: 2, size: 800_000 },
        { kind: 'text', files: 3, size: 500_000 },
        { kind: 'archive', files: 2, size: 400_000 },
        { kind: 'other', files: 4, size: 300_000 },
      ],
      trash: { files: 0, size: 0 },
    },
  }),
)

const colour = (node: Element) => getComputedStyle(node).backgroundColor

/** Each kind's share has its own colour, and its legend dot the same one. */
export const StorageColours: Story = {
  parameters: pageParameters('/documents', {}, [everyKind]),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const overview = await body.findByRole(
      'region',
      { name: 'Storage overview' },
      { timeout: 8000 },
    )
    const dots = [...overview.querySelectorAll('li > [data-kind]')]
    const segments = [...overview.querySelectorAll('[aria-hidden] > [data-kind]')]
    await expect(dots).toHaveLength(8)
    await expect(new Set(dots.map(colour)).size).toBe(8)
    await expect(segments.map(colour)).toEqual(dots.map(colour))
  },
}
export const StorageColoursDark = dark(StorageColours)

/** The search is a button until asked for; opening it moves none of the other controls. */
export const ToolbarSearch: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const open = await body.findByRole('button', { name: 'Search files' }, { timeout: 8000 })
    await expect(body.queryByRole('searchbox')).toBeNull()
    const grid = body.getByRole('button', { name: 'Grid' })
    const before = grid.getBoundingClientRect().left

    await userEvent.click(open)
    const search = body.getByRole('searchbox', { name: 'Search files' })
    await expect(search).toHaveFocus()
    await new Promise((resolve) => setTimeout(resolve, 300))
    await expect(grid.getBoundingClientRect().left).toBe(before)

    // Escape on an empty field folds it back and hands the focus to the button.
    await userEvent.keyboard('{Escape}')
    await expect(body.queryByRole('searchbox')).toBeNull()
    await expect(body.getByRole('button', { name: 'Search files' })).toHaveFocus()

    // "/" opens it too; with a query it stays open after leaving it and offers a clear button.
    await userEvent.keyboard('/')
    await expect(body.getByRole('searchbox', { name: 'Search files' })).toHaveFocus()
    await userEvent.keyboard('budget')
    await userEvent.tab()
    await expect(body.getByRole('searchbox', { name: 'Search files' })).toHaveValue('budget')
    await userEvent.click(body.getByRole('button', { name: 'Clear search' }))
    await expect(body.getByRole('searchbox', { name: 'Search files' })).toHaveValue('')
    await expect(body.getByRole('searchbox', { name: 'Search files' })).toHaveFocus()

    // Escape clears a query first, then closes.
    await userEvent.keyboard('x{Escape}')
    await expect(body.getByRole('searchbox', { name: 'Search files' })).toHaveValue('')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('searchbox')).toBeNull())
  },
}
export const ToolbarSearchPhone = phone(ToolbarSearch)

/** The Filters popover and the search's chips show the URL's filters; a pick and "Clear all" go to the URL. */
export const Filters: Story = {
  parameters: pageParameters('/documents', { date: '7d' }),
  play: filtersPlay({
    chips: ['Uploaded: Last 7 days'],
    pick: { control: /^Kind/, option: 'PDF', key: 'kind', value: 'pdf' },
    cleared: ['date', 'kind'],
  }),
}

// ---- grouped views: virtual folders computed from what each file is ----

const url = (canvas: HTMLElement) => new URL(canvas.ownerDocument.location.href).searchParams
/** The virtual folders of the open level. */
const groupList = async (canvas: HTMLElement) =>
  within(
    await within(canvas.ownerDocument.body).findByRole(
      'list',
      { name: /A view, not a folder/ },
      { timeout: 8000 },
    ),
  )
/** Anchor clicks (downloads) are caught, so the story stays on its page. */
const catchDownloads = () =>
  spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

/** Group by Type: the groups as folders, each marked as a view, the breadcrumb says where. */
export const GroupedByType: Story = {
  parameters: pageParameters('/documents', { group: 'type' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const groups = await groupList(canvasElement)
    await expect(groups.getByRole('button', { name: /^Invoices/ })).toBeVisible()
    await expect(groups.getByRole('button', { name: /^Contracts and signatures/ })).toBeVisible()
    // every one carries the view mark, and the list says once that these are views, not folders
    await expect(
      groups.getAllByRole('listitem').filter((item) => item.querySelector('[data-view-glyph]')),
    ).toHaveLength(5)
    const crumbs = within(body.getByRole('navigation', { name: 'Breadcrumbs' }))
    await expect(crumbs.getByRole('button', { name: 'By type' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    // no ZIP of everything from the top: only inside a group
    await expect(body.queryByRole('button', { name: 'Download all (ZIP)' })).toBeNull()
    await userEvent.click(groups.getByRole('button', { name: /^Invoices/ }))
    await waitFor(() => expect(url(canvasElement).get('type')).toBe('invoices'))
  },
}
export const GroupedByTypeDark = dark(GroupedByType)

/** On a phone, Group by sits in the toolbar's "…" menu. */
export const GroupedByTypePhone: Story = {
  ...phone(GroupedByType),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await groupList(canvasElement)
    await expect(body.queryByRole('button', { name: /^Group by/ })).toBeNull()
    const more = body
      .getAllByRole('button', { name: 'More actions' })
      .find((button) => button.checkVisibility())
    await userEvent.click(more ?? body.getByRole('button', { name: 'More actions' }))
    const menu = within(await body.findByRole('menu'))
    await expect(menu.getByRole('menuitemradio', { name: 'Type' })).toBeChecked()
    await userEvent.click(menu.getByRole('menuitemradio', { name: 'Year → Type' }))
    await waitFor(() => expect(url(canvasElement).get('group')).toBe('year,type'))
  },
}

/** Group by from the toolbar: the choice goes to the URL and is remembered for next time. */
export const SwitchGrouping: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await body.findByRole('button', { name: 'Group by: Folders' }, { timeout: 8000 }),
    )
    const menu = within(await body.findByRole('menu'))
    await expect(menu.getByRole('menuitemradio', { name: 'Folders' })).toBeChecked()
    await userEvent.click(menu.getByRole('menuitemradio', { name: 'Type → Year' }))
    await waitFor(() => expect(url(canvasElement).get('group')).toBe('type,year'))
    await expect(localStorage.getItem('helvetly.documents.group')).toBe('type,year')
  },
}

/** Inside Invoices of Type → Year: the years, the path, and the ZIP of the whole group. */
export const InsideAGroup: Story = {
  parameters: pageParameters('/documents', { group: 'type,year', type: 'invoices' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const groups = await groupList(canvasElement)
    await expect(groups.getByRole('button', { name: /^2026/ })).toBeVisible()
    const crumbs = within(body.getByRole('navigation', { name: 'Breadcrumbs' }))
    await Promise.all(
      ['All documents', 'By type', 'Invoices'].map((name) =>
        expect(crumbs.getByRole('button', { name })).toBeVisible(),
      ),
    )
    await expect(crumbs.getByRole('button', { name: 'Invoices' })).toHaveAttribute(
      'aria-current',
      'page',
    )

    const clicks = catchDownloads()
    await userEvent.click(body.getByRole('button', { name: 'Download all (ZIP)' }))
    await expect(
      await body.findByText('Your ZIP is downloading.', {}, { timeout: 8000 }),
    ).toBeInTheDocument()
    const link = clicks.mock.contexts[0]
    await expect(link instanceof HTMLAnchorElement ? link.getAttribute('href') : '').toBe(
      '/api/v1/documents/groups/zip?group=type%2Cyear&type=invoices',
    )
    clicks.mockRestore()

    // a crumb goes back a level, keeping the grouping
    await userEvent.click(crumbs.getByRole('button', { name: 'By type' }))
    await waitFor(() => expect(url(canvasElement).has('type')).toBe(false))
    await expect(url(canvasElement).get('group')).toBe('type,year')
  },
}
export const InsideAGroupDark = dark(InsideAGroup)

/** A group's own menu downloads it, and a group too big says why instead of a broken file. */
export const GroupMenuDownload: Story = {
  parameters: pageParameters('/documents', { group: 'type' }, [
    http.get('/api/v1/documents/groups/zip', ({ request }) =>
      new URL(request.url).searchParams.get('type') === 'invoices'
        ? HttpResponse.json(
            {
              error: {
                code: 'zip_too_large',
                message:
                  'A ZIP holds at most 1000 files and 500 MB. Open a smaller group (a year or a client) and download that.',
              },
            },
            { status: 413 },
          )
        : new HttpResponse(null, { status: 204 }),
    ),
  ]),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const clicks = catchDownloads()
    const groups = await groupList(canvasElement)
    fireEvent.contextMenu(groups.getByRole('button', { name: /^Quotes/ }))
    await userEvent.click(await body.findByRole('menuitem', { name: 'Download all (ZIP)' }))
    await waitFor(() => expect(clicks).toHaveBeenCalledTimes(1))
    const link = clicks.mock.contexts[0]
    await expect(link instanceof HTMLAnchorElement ? link.getAttribute('href') : '').toContain(
      'type=quotes',
    )

    fireEvent.contextMenu(groups.getByRole('button', { name: /^Invoices/ }))
    await userEvent.click(await body.findByRole('menuitem', { name: 'Download all (ZIP)' }))
    await expect(
      await body.findByText(/A ZIP holds at most 1000 files/, {}, { timeout: 8000 }),
    ).toBeInTheDocument()
    await expect(clicks).toHaveBeenCalledTimes(1)
    clicks.mockRestore()
  },
}

/** The sidebar's Views: presets with their counts; one click applies the grouping. */
export const ViewsPresets: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const views = within(
      await body.findByRole('navigation', { name: 'Grouped views' }, { timeout: 8000 }),
    )
    await waitFor(() =>
      expect(views.getByRole('button', { name: /Invoices by year/ })).toHaveTextContent('12'),
    )
    await expect(views.getByRole('button', { name: /Receipts by year/ })).toHaveTextContent('6')
    await expect(views.getByRole('button', { name: /By client/ })).toHaveTextContent('2')
    await userEvent.click(views.getByRole('button', { name: /Invoices by year/ }))
    await waitFor(() => expect(url(canvasElement).get('group')).toBe('type,year'))
    await expect(url(canvasElement).get('type')).toBe('invoices')
  },
}

/** A preset that is open is marked in the sidebar. */
export const ViewsPresetOpen: Story = {
  parameters: pageParameters('/documents', { group: 'client' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const views = within(
      await body.findByRole('navigation', { name: 'Grouped views' }, { timeout: 8000 }),
    )
    await expect(views.getByRole('button', { name: /By client/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
    const groups = await groupList(canvasElement)
    await expect(groups.getByRole('button', { name: /^Acme AG/ })).toBeVisible()
    await expect(groups.getByRole('button', { name: /^No client/ })).toBeVisible()
  },
}
