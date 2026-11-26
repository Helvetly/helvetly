import { createTranslators } from '@helvetly/i18n'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { getRouter } from '@storybook/nextjs-vite/navigation.mock'
import { delay, http, HttpResponse } from 'msw'
import { expect, fireEvent, spyOn, userEvent, waitFor, within } from 'storybook/test'

import { DocumentsPage } from '@/components/documents/documents-page'
import { FolderName } from '@/components/documents/system-mark'
import { RecordLink } from '@/components/record-link'

import de from '../../messages/de.json'
import en from '../../messages/en.json'
import fr from '../../messages/fr.json'
import it from '../../messages/it.json'
import { sessionHandler } from '../screen-fixtures'
import { files as sampleFiles, folders as sampleFolders, page } from './api'
import { filtersPlay } from './filters'
import { closeHeidi, dark, desktop, Frame, pageParameters, phone, shows } from './frame'
import { sameRowMenus } from './menus'

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
    // Its one action sits in the page's header; the empty list repeats none.
    const [action, ...more] = body.getAllByRole('button', { name: 'Send for signature' })
    await expect(more).toHaveLength(0)
    await expect(action?.closest('header')).not.toBeNull()
    for (const name of ['Upload', 'Create', 'Organize with AI'])
      expect(within(body.getByRole('main')).queryByRole('button', { name })).toBeNull()
  },
}

const noTemplates = http.get('/api/v1/templates', () => HttpResponse.json({ data: [] }))

/** No templates yet: New template stays in the header, the empty state only explains. */
export const TemplatesEmpty: Story = {
  parameters: pageParameters('/documents', { view: 'templates' }, [noTemplates]),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await waitFor(() => expect(body.getByText('No templates yet')).toBeVisible(), { timeout: 8000 })
    const [action, ...more] = body.getAllByRole('button', { name: 'New template' })
    await expect(more).toHaveLength(0)
    await expect(action?.closest('header')).not.toBeNull()
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
    await userEvent.click(drawer.getByRole('button', { name: /^Template / }))
    await expect(await body.findByRole('option', { name: /^Power of attorney/ })).toBeVisible()
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
    // Bank Statements is a system folder, so it is never suggested as a plain one.
    await expect(chips).toEqual(['Create folder Contracts', 'Create folder Tax 2026'])
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

function treeFolder(id: string, name: string, parent: string | null, files: number, total = files) {
  return {
    ...sampleFolders[2],
    id,
    name,
    parent_id: parent,
    file_count: files,
    size: files * 1000,
    total_files: total,
    total_size: total * 1000,
  }
}
const invoices = treeFolder('fld_invoices', 'Invoices', null, 2, 9)
const nestedFolders = http.get('/api/v1/documents/folders', () =>
  HttpResponse.json({
    data: [
      ...sampleFolders,
      invoices,
      treeFolder('fld_invoices_2025', '2025', invoices.id, 0, 7),
      treeFolder('fld_invoices_pdf', 'PDFs', 'fld_invoices_2025', 7),
      treeFolder('fld_empty_group', 'Archive', invoices.id, 0),
      treeFolder('fld_empty', 'Empty folder', 'fld_empty_group', 0),
      { ...treeFolder('fld_hidden', 'Quotes', invoices.id, 0), system_kind: 'quotes' },
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
    await expect(tree.getByRole('button', { name: 'Invoices 4 items' })).toBeVisible()
    await expect(tree.getByRole('button', { name: '2025 1 item' })).toBeVisible()
    await expect(tree.getByRole('button', { name: 'Archive 1 item' })).toBeVisible()
    await userEvent.click(tree.getByRole('button', { name: 'Expand Archive' }))
    await expect(tree.getByRole('button', { name: 'Empty folder' })).toBeVisible()
    await expect(tree.queryByRole('button', { name: 'Expand Empty folder' })).toBeNull()
    await expect(tree.queryByText('Quotes')).toBeNull()
    await expect(folderItem(canvasElement, invoices.id)).toHaveAttribute(
      'title',
      expect.stringMatching(/^4 items · /),
    )

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
/** The list counts an empty child folder as one item. */
export const FolderContentsCount: Story = {
  parameters: pageParameters('/documents', { folder: invoices.id, layout: 'list' }, [
    nestedFolders,
  ]),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const archive = await body.findByRole('row', { name: /Select Archive/ }, { timeout: 8000 })
    await expect(archive).toHaveTextContent('1 item · 0 B')
  },
}
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

const longName = 'Signed agreements with suppliers and subcontractors 2026'
const longFolder = http.get('/api/v1/documents/folders', () =>
  HttpResponse.json({
    data: [...sampleFolders, treeFolder('fld_long', longName, null, 12)],
  }),
)

/**
 * Sidebar counts are small round badges, right-aligned; a long folder name is cut with "…" and its
 * tooltip names it in full, while a name that fits gets no tooltip.
 */
export const SidebarCounts: Story = {
  parameters: pageParameters('/documents', {}, [longFolder]),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const nav = await body.findByRole('navigation', { name: 'Folders' }, { timeout: 8000 })
    const name = await within(nav).findByText(longName)
    const row = name.closest('button')
    const badge = row?.querySelector('[data-slot=count-badge]')
    await expect(row).toHaveAccessibleName(`${longName} 12 items`)
    await expect(badge?.querySelector('[aria-hidden]')).toHaveTextContent(/^12$/)
    await expect(badge).toHaveClass('rounded-full')
    await expect(name.scrollWidth).toBeGreaterThan(name.clientWidth)

    await userEvent.hover(name)
    await expect(await body.findByRole('tooltip')).toHaveTextContent(longName)
    await userEvent.unhover(name)
    await waitFor(() => expect(body.queryByRole('tooltip')).toBeNull())
    // "Recent" fits, so hovering it shows nothing.
    await userEvent.hover(within(nav).getByText('Recent'))
    await new Promise((resolve) => setTimeout(resolve, 200))
    await expect(body.queryByRole('tooltip')).toBeNull()
  },
}

/** A plain click on a file opens its preview and selects nothing; its checkbox selects. */
export const CardClickOpens: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const [name] = await body.findAllByText('Budget 2027.xlsx', {}, { timeout: 8000 })
    if (!name) throw new Error('Budget 2027.xlsx is not shown')
    await userEvent.click(name)
    // The preview is the address's ?file=, as everywhere a file opens.
    await waitFor(() => expect(url(canvasElement).get('file')).toBe('doc_3'))
    await expect(body.queryAllByRole('checkbox', { checked: true })).toHaveLength(0)

    const check = body.getByRole('checkbox', { name: 'Select Budget 2027.xlsx' })
    await userEvent.click(check)
    await expect(check).toBeChecked()
    await expect(body.queryAllByRole('checkbox', { checked: true })).toHaveLength(1)
  },
}

/** In the list a row's click opens the file too; the row's checkbox selects. */
export const RowClickOpens: Story = {
  ...CardClickOpens,
  parameters: pageParameters('/documents', { layout: 'list' }),
}

/** A folder's card or row on the page (not its entry in the sidebar). */
function folderItem(canvas: HTMLElement, id: string) {
  const item = canvas.ownerDocument.querySelector(`[data-key="folder:${id}"]`)
  if (!item) throw new Error(`folder ${id} is not shown`)
  return item
}

/** A plain click on a folder opens it and selects nothing; its checkbox selects without opening. */
export const FolderClickOpens: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const check = await body.findByRole('checkbox', { name: 'Select Contracts' }, { timeout: 8000 })
    await userEvent.click(check)
    await expect(check).toBeChecked()
    await expect(url(canvasElement).get('folder')).toBeNull()

    await userEvent.click(folderItem(canvasElement, 'fld_contracts'))
    await waitFor(() => expect(url(canvasElement).get('folder')).toBe('fld_contracts'))
  },
}

/** A double-click opens the folder once: the second click lands on what the opened folder shows. */
export const FolderDoubleClickOpensOnce: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await body.findAllByText('Contracts', {}, { timeout: 8000 })
    const name = folderItem(canvasElement, 'fld_contracts')
    const push = spyOn(window.history, 'pushState')
    try {
      await userEvent.dblClick(name)
      await waitFor(() => expect(url(canvasElement).get('folder')).toBe('fld_contracts'))
      const opens = push.mock.calls.filter(([, , to]) => String(to).includes('fld_contracts'))
      await expect(opens).toHaveLength(1)
    } finally {
      push.mockRestore()
    }
  },
}

/** In the list a folder row's click opens it too. */
export const FolderRowClickOpens: Story = {
  ...FolderClickOpens,
  parameters: pageParameters('/documents', { layout: 'list' }),
}

/**
 * Shift on a checkbox selects the range from the last one clicked, across folders and files as
 * shown; another Shift-click from the same anchor shrinks it; ⌘ toggles one; nothing opens.
 */
export const CheckboxShiftRange: Story = {
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument
    await within(doc.body).findAllByText('Contracts', {}, { timeout: 8000 })
    // Each item's checkbox, in the order shown (not the list's "Select all").
    const boxes = () =>
      [...doc.querySelectorAll<HTMLElement>('[role=checkbox][aria-label^="Select "]')].filter(
        (box) => box.getAttribute('aria-label') !== 'Select all',
      )
    const checked = () =>
      boxes().flatMap((box, index) => (box.getAttribute('aria-checked') === 'true' ? [index] : []))
    const folders = doc.querySelectorAll('[data-key^="folder:"]').length
    const end = folders + 1 // a folder to the second file
    await expect(boxes().length).toBeGreaterThan(end + 1)
    const click = (index: number, modifiers: { shiftKey?: boolean; metaKey?: boolean } = {}) => {
      const box = boxes()[index]
      if (!box) throw new Error(`no checkbox ${index}`)
      fireEvent.click(box, modifiers)
    }
    click(0)
    await waitFor(() => expect(checked()).toEqual([0]))
    click(end, { shiftKey: true })
    await waitFor(() => expect(checked()).toEqual(Array.from({ length: end + 1 }, (_, i) => i)))
    click(1, { shiftKey: true })
    await waitFor(() => expect(checked()).toEqual([0, 1]))
    click(end + 1, { metaKey: true })
    await waitFor(() => expect(checked()).toEqual([0, 1, end + 1]))
    await expect(url(canvasElement).get('folder')).toBeNull()
    await expect(url(canvasElement).get('file')).toBeNull()
  },
}

/** The same in the list's rows. */
export const CheckboxShiftRangeList: Story = {
  ...CheckboxShiftRange,
  parameters: pageParameters('/documents', { layout: 'list' }),
}

/** Files from the desktop, the way a browser sends a drag of them. */
function desktopDrag(type: 'dragenter' | 'dragover' | 'drop', file: File, target: Element) {
  const data = new DataTransfer()
  data.items.add(file)
  const event = new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

/**
 * Files dragged anywhere over the page light it up; a drop outside any folder uploads to the
 * current folder, the browser never opens the file, and the page's light goes out.
 */
export const DropUploadsAnywhere: Story = {
  parameters: pageParameters('/documents', {}, [
    http.post('/api/v1/documents', () =>
      HttpResponse.json({ data: { ...sampleFiles[0], id: 'doc_new', name: 'scan.pdf' } }),
    ),
  ]),
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument
    const body = within(doc.body)
    await body.findAllByText('Contracts', {}, { timeout: 8000 })
    const file = new File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' })
    desktopDrag('dragenter', file, doc.body)
    await expect(desktopDrag('dragover', file, doc.body).defaultPrevented).toBe(true)
    await waitFor(() => expect(body.getByText(/Drop to upload to/)).toBeVisible())
    const drop = desktopDrag('drop', file, doc.body)
    await expect(drop.defaultPrevented).toBe(true)
    await waitFor(() => expect(body.queryByText(/Drop to upload to/)).toBeNull())
    await body.findByTitle('scan.pdf', {}, { timeout: 8000 })
  },
}

const lockTip = "Managed by Helvetly: can't be renamed, moved or deleted"

/** Helvetly's own folders carry a quiet lock, and their menu offers no rename, move or trash. */
export const SystemFolders: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const nav = await body.findByRole('navigation', { name: 'Folders' }, { timeout: 8000 })
    const tree = within(nav)
    const clients = await tree.findByRole('button', { name: /^Clients/ })
    // Clients, Expenses and Bank Statements; the plain folders have none.
    await expect(tree.getAllByLabelText(lockTip)).toHaveLength(3)
    await expect(await tree.findByRole('button', { name: /^Bank Statements/ })).toBeVisible()
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

/**
 * The search is a button until asked for; it opens in its own row below the toolbar, so the
 * breadcrumbs and the other controls keep their room.
 */
export const ToolbarSearch: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const open = await body.findByRole('button', { name: 'Search files' }, { timeout: 8000 })
    await expect(body.queryByRole('searchbox')).toBeNull()
    const grid = body.getByRole('button', { name: 'Grid' })
    const before = grid.getBoundingClientRect().left

    await userEvent.click(open)
    await expect(open).toHaveAttribute('aria-expanded', 'true')
    const search = body.getByRole('searchbox', { name: 'Search files' })
    await expect(search).toHaveFocus()
    await new Promise((resolve) => setTimeout(resolve, 300))
    await expect(grid.getBoundingClientRect().left).toBe(before)
    await expect(search.getBoundingClientRect().top).toBeGreaterThanOrEqual(
      grid.getBoundingClientRect().bottom,
    )
    await userEvent.click(open)
    await expect(open).toHaveAttribute('aria-expanded', 'false')
    await expect(body.queryByRole('searchbox')).toBeNull()
    await expect(open).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    const field = body.getByRole('searchbox').closest('label')
    if (!field?.parentElement) throw new Error('Missing Documents search row')
    await expect(colour(field)).toBe(colour(field.parentElement))
    // An unfinished field term has not reached the URL yet.
    await userEvent.keyboard('kind:')
    await userEvent.click(open)
    await expect(body.queryByRole('searchbox')).toBeNull()
    await userEvent.click(open)
    await expect(body.getByRole('searchbox')).toHaveValue('kind:')
    await userEvent.keyboard('{Escape}')

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
    await userEvent.click(open)
    await waitFor(() => expect(url(canvasElement).get('q')).toBe('budget'))
    await expect(body.queryByRole('searchbox')).toBeNull()
    await userEvent.click(open)
    await expect(body.getByRole('searchbox')).toHaveFocus()
    await expect(body.getByRole('searchbox')).toHaveValue('budget')
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
export const ToolbarSearchDark = dark(ToolbarSearch)
export const ToolbarSearchPhone = phone(ToolbarSearch)

/** Deep in the folders with filters on: the chips sit in the search row, the path stays readable. */
export const DeepFolderWithChips: Story = {
  parameters: pageParameters('/documents', { folder: 'fld_deep', date: '30d', kind: 'image' }, [
    http.get('/api/v1/documents/folders', () =>
      HttpResponse.json({
        data: [
          ...sampleFolders,
          invoices,
          { ...invoices, id: 'fld_invoices_2025', name: '2025', parent_id: 'fld_invoices' },
          {
            ...invoices,
            id: 'fld_deep',
            name: 'Unternehmensdokumente',
            parent_id: 'fld_invoices_2025',
          },
        ],
      }),
    ),
  ]),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const chip = await body.findByRole(
      'button',
      { name: 'Remove filter Kind: Image' },
      { timeout: 8000 },
    )
    await expect(chip).toBeVisible()
    const search = body.getByRole('button', { name: 'Search files', expanded: true })
    await userEvent.click(search)
    await expect(body.queryByRole('searchbox')).toBeNull()
    await userEvent.click(search)
    await expect(body.getByRole('searchbox', { name: 'Search files' })).toHaveFocus()
    await expect(body.getByRole('button', { name: 'Remove filter Kind: Image' })).toBeVisible()
    const crumbs = within(body.getByRole('navigation', { name: 'Breadcrumbs' }))
    await waitFor(() =>
      expect(crumbs.getByRole('button', { name: 'Unternehmensdokumente' })).toBeVisible(),
    )
    // Too long for the row: the folders in between fold into "…", the first and current stay whole.
    // Measured after the first paint: the fold follows a moment later.
    const more = await crumbs.findByRole('button', { name: 'Folders in between' })
    await expect(crumbs.queryByRole('button', { name: 'Invoices' })).toBeNull()
    // Whole: each one's text fits its box (a pixel for rounding).
    await Promise.all(
      ['All documents', 'Unternehmensdokumente'].map((name) => {
        const crumb = crumbs.getByRole('button', { name })
        return expect(crumb.scrollWidth).toBeLessThanOrEqual(crumb.clientWidth + 1)
      }),
    )
    await userEvent.click(more)
    const menu = within(await body.findByRole('menu'))
    await expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Invoices',
      '2025',
    ])
    await userEvent.click(menu.getByRole('menuitem', { name: 'Invoices' }))
    await waitFor(() => expect(url(canvasElement).get('folder')).toBe('fld_invoices'))
  },
}

/** The Filters popover and the search's chips show the URL's filters; a pick and "Clear all" go to the URL. */
export const Filters: Story = {
  parameters: pageParameters('/documents', { date: '7d' }),
  play: filtersPlay({
    chips: ['Uploaded: Last 7 days'],
    pick: { control: /^Kind/, option: 'PDF', key: 'kind', value: 'pdf' },
    cleared: ['date', 'kind'],
  }),
}

/**
 * The sidebar's types are toggles: several at once, each marked, the same state as the Kind filter
 * (its chip and the popover); "Uploaded by me" is the popover's last control, above "Clear all".
 */
const kindRequests: URLSearchParams[] = []
const typesPage = pageParameters('/documents', {}, [
  http.get('/api/v1/documents', ({ request }) => {
    kindRequests.push(new URL(request.url).searchParams)
    return HttpResponse.json(page(sampleFiles))
  }),
])
export const TypesMultiSelect: Story = {
  // A query string: the kind repeats (a record holds one value per key).
  parameters: {
    ...typesPage,
    nextjs: { navigation: { pathname: '/documents', query: 'kind=pdf&kind=image' } },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const types = within(
      await body.findByRole('navigation', { name: 'File types' }, { timeout: 8000 }),
    )
    const pressed = (name: string) =>
      types.getByRole('button', { name }).getAttribute('aria-pressed')
    await expect(['PDFs', 'Images', 'Spreadsheets', 'Documents'].map(pressed)).toEqual([
      'true',
      'true',
      'false',
      'false',
    ])
    await waitFor(() =>
      expect(kindRequests.some((query) => query.getAll('kind').join() === 'pdf,image')).toBe(true),
    )
    await expect(
      await body.findByRole('button', { name: 'Remove filter Kind: PDF or Image' }),
    ).toBeVisible()

    // The popover's Kind holds both; "Uploaded by me" comes last, right above "Clear all".
    await userEvent.click(body.getByRole('button', { name: /^Filters/ }))
    const dialog = await body.findByRole('dialog', { name: 'Filters' })
    await expect(within(dialog).getByRole('button', { name: /^Kind/ })).toHaveTextContent(
      /PDF.*Image/,
    )
    const controls = [...dialog.querySelectorAll('button, [role="checkbox"]')]
    const mine = within(dialog).getByRole('checkbox', { name: 'Uploaded by me' })
    const clearAll = within(dialog).getByRole('button', { name: 'Clear all' })
    await expect(controls.indexOf(clearAll) - controls.indexOf(mine)).toBe(1)
    await userEvent.keyboard('{Escape}')

    // A row toggles its type in or out; "Clear" in the section's header takes them all out.
    await userEvent.click(types.getByRole('button', { name: 'Spreadsheets' }))
    await waitFor(() =>
      expect(url(canvasElement).getAll('kind')).toEqual(['pdf', 'image', 'spreadsheet']),
    )
    await userEvent.click(types.getByRole('button', { name: 'PDFs' }))
    await waitFor(() => expect(url(canvasElement).getAll('kind')).toEqual(['image']))
    await userEvent.click(types.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(url(canvasElement).has('kind')).toBe(false))
  },
}
export const TypesMultiSelectDark = dark(TypesMultiSelect)

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
    // the ZIP lives in the header's "…" menu, not the toolbar
    await expect(body.queryByRole('button', { name: /ZIP/ })).toBeNull()
    await userEvent.click(groups.getByRole('button', { name: /^Invoices/ }))
    await waitFor(() => expect(url(canvasElement).get('type')).toBe('invoices'))
  },
}
export const GroupedByTypeDark = dark(GroupedByType)

// Storybook's navigation mock does not re-render on a URL change: each story starts from its URL and checks the URL
// one step produces.

/** On a phone, Group by is the toolbar's "…": the same presets and levels. */
export const GroupedByTypePhone: Story = {
  ...phone(GroupedByType),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await groupList(canvasElement)
    const triggers = body.getAllByRole('button', { name: 'Group: Type' })
    await userEvent.click(triggers.find((button) => button.checkVisibility()) ?? triggers[0]!)
    const panel = within(await body.findByRole('dialog', { name: 'Group by' }))
    await expect(
      within(panel.getByRole('list', { name: 'Group levels' })).getByText('Type'),
    ).toBeVisible()
    await userEvent.click(panel.getByRole('button', { name: 'Add level' }))
    await waitFor(() => expect(url(canvasElement).get('group')).toBe('type,year'))
  },
}

/** By default the button says Folders, with no dot, and the popover says so: nothing to reset. */
export const GroupDefault: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const trigger = await body.findByRole('button', { name: 'Group: Folders' }, { timeout: 8000 })
    await expect(trigger.querySelector('[data-grouped-dot]')).toBeNull()
    await userEvent.click(trigger)
    const panel = within(await body.findByRole('dialog', { name: 'Group by' }))
    await expect(panel.getByRole('button', { name: /Folders \(default\)/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(panel.getByText('No grouping: files are shown in folders.')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Reset to folders' })).toBeDisabled()
  },
}
export const GroupDefaultDark = dark(GroupDefault)

/** Group by's builder from Folders: a first level, remembered for next time. */
export const SwitchGrouping: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await body.findByRole('button', { name: 'Group: Folders' }, { timeout: 8000 }),
    )
    const panel = within(await body.findByRole('dialog', { name: 'Group by' }))
    await userEvent.click(panel.getByRole('button', { name: 'Add level' }))
    await waitFor(() => expect(url(canvasElement).get('group')).toBe('type'))
    await expect(localStorage.getItem('helvetly.documents.group')).toBe('type')
  },
}

/** A level's select picks what it groups by: Client › Type becomes Client › Year. */
export const BuildClientYear: Story = {
  parameters: pageParameters('/documents', { group: 'client,type' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const trigger = await body.findByRole(
      'button',
      { name: 'Group: Client › Type' },
      { timeout: 8000 },
    )
    await expect(trigger.querySelector('[data-grouped-dot]')).not.toBeNull()
    await userEvent.click(trigger)
    const panel = within(await body.findByRole('dialog', { name: 'Group by' }))
    // a level offers only what no other level uses
    const second = panel.getByRole('combobox', { name: 'Level 2' })
    await expect(within(second).queryByRole('option', { name: 'Client' })).toBeNull()
    await userEvent.selectOptions(second, 'year')
    await waitFor(() => expect(url(canvasElement).get('group')).toBe('client,year'))
  },
}

/** Client › Year in plain words. */
export const GroupedClientYear: Story = {
  parameters: pageParameters('/documents', { group: 'client,year' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await body.findByRole('button', { name: 'Group: Client › Year' }, { timeout: 8000 }),
    )
    const panel = within(await body.findByRole('dialog', { name: 'Group by' }))
    await expect(
      panel.getByText('Files grouped by client, then by year inside each client.'),
    ).toBeVisible()
    await expect(panel.getByRole('button', { name: /Folders \(default\)/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  },
}
export const GroupedClientYearDark = dark(GroupedClientYear)

/** Reset to folders: the explicit way back to the default. */
export const ResetToFolders: Story = {
  parameters: pageParameters('/documents', { group: 'type,year', type: 'invoices' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await body.findByRole('button', { name: 'Group: Type › Year' }, { timeout: 8000 }),
    )
    const panel = within(await body.findByRole('dialog', { name: 'Group by' }))
    await userEvent.click(panel.getByRole('button', { name: 'Reset to folders' }))
    await waitFor(() => expect(url(canvasElement).get('group')).toBeNull())
    await expect(url(canvasElement).get('type')).toBeNull()
    await expect(localStorage.getItem('helvetly.documents.group')).toBe('')
  },
}

/** Levels in any order: Client › Year gets a second level after it. */
export const AddALevel: Story = {
  parameters: pageParameters('/documents', { group: 'client,year' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await body.findByRole('button', { name: 'Group: Client › Year' }, { timeout: 8000 }),
    )
    const panel = within(await body.findByRole('dialog', { name: 'Group by' }))
    await expect(panel.getByRole('button', { name: 'Move Client up' })).toBeDisabled()
    await expect(panel.getByRole('button', { name: 'Move Year down' })).toBeDisabled()
    await userEvent.click(panel.getByRole('button', { name: 'Add level' }))
    await waitFor(() => expect(url(canvasElement).get('group')).toBe('client,year,type'))
    await expect(localStorage.getItem('helvetly.documents.group')).toBe('client,year,type')
  },
}

/** Three levels: nothing left to add; a level moves down. */
export const ReorderLevels: Story = {
  parameters: pageParameters('/documents', { group: 'client,year,type' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await body.findByRole('button', { name: 'Group: Client › Year › Type' }, { timeout: 8000 }),
    )
    const panel = within(await body.findByRole('dialog', { name: 'Group by' }))
    await expect(panel.getByRole('button', { name: 'Add level' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await userEvent.click(panel.getByRole('button', { name: 'Move Client down' }))
    await waitFor(() => expect(url(canvasElement).get('group')).toBe('year,client,type'))
  },
}

/** A level is removed; the groups chosen so far stay as filters. */
export const RemoveALevel: Story = {
  parameters: pageParameters('/documents', { group: 'client,year', client: 'cli_acme' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(
      await body.findByRole('button', { name: 'Group: Client › Year' }, { timeout: 8000 }),
    )
    const panel = within(await body.findByRole('dialog', { name: 'Group by' }))
    await userEvent.click(panel.getByRole('button', { name: 'Remove Client' }))
    await waitFor(() => expect(url(canvasElement).get('group')).toBe('year'))
    await expect(url(canvasElement).get('client')).toBe('cli_acme')
  },
}

/** Opens the header's "…" menu (the page's own actions). */
const pageMenu = async (canvas: HTMLElement) => {
  const body = within(canvas.ownerDocument.body)
  const more = await body.findByRole('button', { name: 'More' }, { timeout: 8000 })
  await userEvent.click(more)
  return within(await body.findByRole('menu'))
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
    const menu = await pageMenu(canvasElement)
    await expect(menu.getByRole('menuitem', { name: 'Import invoices, contracts…' })).toBeVisible()
    await userEvent.click(menu.getByRole('menuitem', { name: 'Download as ZIP' }))
    await expect(
      await body.findByText('Your ZIP is downloading.', {}, { timeout: 8000 }),
    ).toBeInTheDocument()
    const link = clicks.mock.contexts[0]
    await expect(link instanceof HTMLAnchorElement ? link.getAttribute('href') : '').toBe(
      '/api/v1/documents/groups/zip?type=invoices&group=type%2Cyear',
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

    // the open menu hides the rest of the page from the accessibility tree until it is gone
    await waitFor(() => expect(body.queryByRole('menu')).toBeNull())
    fireEvent.contextMenu(groups.getByRole('button', { name: /^Invoices/ }))
    await userEvent.click(await body.findByRole('menuitem', { name: 'Download all (ZIP)' }))
    await expect(
      await body.findByText(/A ZIP holds at most 1000 files/, {}, { timeout: 8000 }),
    ).toBeInTheDocument()
    await expect(clicks).toHaveBeenCalledTimes(1)
    clicks.mockRestore()
  },
}

/** Big selections: the ZIP is prepared in the background, and the menu says so until it is ready. */
export const ZipInBackground: Story = {
  parameters: pageParameters(
    '/documents',
    { group: 'type,year', type: 'invoices' },
    (() => {
      let queued = false
      return [
        http.get('/api/v1/documents/groups/zip', () =>
          HttpResponse.json({ data: { async: true, files: 12, bytes: 9_000_000 } }),
        ),
        http.post('/api/v1/documents/groups/zip', () => {
          queued = true
          return HttpResponse.json(
            {
              data: {
                id: 'zip_1',
                name: 'documents-invoices.zip',
                status: 'pending',
                files: 12,
                bytes: 9_000_000,
                created_at: '2026-11-23T10:00:00Z',
                expires_at: null,
              },
            },
            { status: 202 },
          )
        }),
        http.get('/api/v1/documents/exports', () =>
          HttpResponse.json({
            data: queued
              ? [
                  {
                    id: 'zip_1',
                    name: 'documents-invoices.zip',
                    status: 'pending',
                    files: 12,
                    bytes: 9_000_000,
                    created_at: '2026-11-23T10:00:00Z',
                    expires_at: null,
                  },
                ]
              : [],
          }),
        ),
      ]
    })(),
  ),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const clicks = catchDownloads()
    await groupList(canvasElement)
    await userEvent.click(
      (await pageMenu(canvasElement)).getByRole('menuitem', { name: 'Download as ZIP' }),
    )
    await expect(
      await body.findByText(
        "Preparing your ZIP. We'll notify you when it's ready.",
        {},
        { timeout: 8000 },
      ),
    ).toBeInTheDocument()
    await expect(clicks).not.toHaveBeenCalled()
    clicks.mockRestore()
    await userEvent.keyboard('{Escape}')
    const menu = await pageMenu(canvasElement)
    await waitFor(() =>
      expect(menu.getByRole('menuitem', { name: 'Preparing ZIP…' })).toHaveAttribute(
        'aria-disabled',
        'true',
      ),
    )
    await userEvent.keyboard('{Escape}')
  },
}

/** Nothing in the view: Download as ZIP is off and says why. */
export const ZipEmptyView: Story = {
  parameters: pageParameters('/documents', { group: 'type' }, [
    http.get('/api/v1/documents/groups', () =>
      HttpResponse.json({ data: { by: 'type', groups: [] } }),
    ),
  ]),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await body.findByText('Nothing to group here', {}, { timeout: 8000 })
    const menu = await pageMenu(canvasElement)
    await expect(menu.getByRole('menuitem', { name: 'Download as ZIP' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await userEvent.keyboard('{Escape}')
  },
}

/**
 * The bell's link (?zip=) downloads a ready ZIP, through the member's own download route: found by its id, also
 * when ten newer ones push it out of the list.
 */
export const ZipFromNotification: Story = {
  parameters: pageParameters('/documents', { zip: 'zip_1' }, [
    http.get('/api/v1/documents/exports', () => HttpResponse.json({ data: [] })),
    http.get('/api/v1/documents/exports/zip_1/status', () =>
      HttpResponse.json({
        data: {
          id: 'zip_1',
          name: 'documents-invoices.zip',
          status: 'ready',
          files: 12,
          bytes: 9_000_000,
          created_at: '2026-11-23T10:00:00Z',
          expires_at: '2026-11-30T10:00:00Z',
        },
      }),
    ),
  ]),
  play: async ({ canvasElement }) => {
    const clicks = catchDownloads()
    await waitFor(() => expect(clicks).toHaveBeenCalledTimes(1), { timeout: 8000 })
    const link = clicks.mock.contexts[0]
    await expect(link instanceof HTMLAnchorElement ? link.getAttribute('href') : '').toBe(
      '/api/v1/documents/exports/zip_1/download',
    )
    clicks.mockRestore()
    await waitFor(() => expect(url(canvasElement).has('zip')).toBe(false))
  },
}

/** A link to a ZIP that is no longer kept says so, and downloads nothing. */
export const ZipFromNotificationGone: Story = {
  parameters: pageParameters('/documents', { zip: 'zip_old' }, [
    http.get('/api/v1/documents/exports/zip_old/status', () =>
      HttpResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 }),
    ),
  ]),
  play: async ({ canvasElement }) => {
    const clicks = catchDownloads()
    const body = within(canvasElement.ownerDocument.body)
    await expect(
      await body.findByText(
        'This ZIP is no longer available. Download it again from Documents.',
        {},
        { timeout: 8000 },
      ),
    ).toBeInTheDocument()
    await expect(clicks).not.toHaveBeenCalled()
    clicks.mockRestore()
    await waitFor(() => expect(url(canvasElement).has('zip')).toBe(false))
  },
}

/** Type, year and client chips combine (all of them hold), and a grouping keeps them. */
const chipRequests: URLSearchParams[] = []
export const ChipsCombine: Story = {
  parameters: pageParameters('/documents', { client: 'cli_acme', year: '2026', type: 'invoices' }, [
    http.get('/api/v1/documents', ({ request }) => {
      chipRequests.push(new URL(request.url).searchParams)
      return HttpResponse.json(page(sampleFiles))
    }),
  ]),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const chips = await Promise.all(
      ['Client: Acme AG', 'Year: 2026', 'Type: Invoices'].map((chip) =>
        body.findByRole('button', { name: `Remove filter ${chip}` }, { timeout: 8000 }),
      ),
    )
    await Promise.all(chips.map((chip) => expect(chip).toBeVisible()))
    await waitFor(() =>
      expect(
        chipRequests.some(
          (query) =>
            query.get('client') === 'cli_acme' &&
            query.get('year') === '2026' &&
            query.get('type') === 'invoices' &&
            !query.has('folder_id'),
        ),
      ).toBe(true),
    )
    await userEvent.click(body.getByRole('button', { name: 'Group: Folders' }))
    await userEvent.click(
      within(await body.findByRole('dialog', { name: 'Group by' })).getByRole('button', {
        name: 'Add level',
      }),
    )
    await waitFor(() => expect(url(canvasElement).get('group')).toBe('type'))
    await expect(url(canvasElement).get('client')).toBe('cli_acme')
    await expect(url(canvasElement).get('year')).toBe('2026')
    await expect(url(canvasElement).get('type')).toBe('invoices')
  },
}

/** Views are the presets at the top of Group by, with counts; the sidebar has none. */
export const ViewsPresets: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const trigger = await body.findByRole('button', { name: 'Group: Folders' }, { timeout: 8000 })
    await expect(body.queryByRole('navigation', { name: 'Grouped views' })).toBeNull()
    await expect(body.queryByText('Invoices by year')).toBeNull()
    await userEvent.click(trigger)
    const panel = within(await body.findByRole('dialog', { name: 'Group by' }))
    await waitFor(() =>
      expect(panel.getByRole('button', { name: /Invoices by year/ })).toHaveTextContent('12'),
    )
    await expect(panel.getByRole('button', { name: /Receipts by year/ })).toHaveTextContent('6')
    // A count is small figures in the document-number font; screen readers hear what it counts.
    const byClient = panel.getByRole('button', { name: /By client/ })
    await expect(byClient).toHaveAccessibleName(/2 clients/)
    await expect(byClient.querySelector('[data-slot=count-badge]')).toHaveTextContent('2')
    await expect(panel.getByRole('button', { name: /Invoices by year/ })).toHaveAccessibleName(
      /Type › Year.*12 files/,
    )
    await userEvent.click(panel.getByRole('button', { name: /Invoices by year/ }))
    await waitFor(() => expect(url(canvasElement).get('group')).toBe('type,year'))
    await expect(url(canvasElement).get('type')).toBe('invoices')
  },
}

/** The open preset is marked in Group by. */
export const ViewsPresetOpen: Story = {
  parameters: pageParameters('/documents', { group: 'client' }),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const groups = await groupList(canvasElement)
    await expect(groups.getByRole('button', { name: /^Acme AG/ })).toBeVisible()
    await expect(groups.getByRole('button', { name: /^No client/ })).toBeVisible()
    await userEvent.click(body.getByRole('button', { name: 'Group: Client' }))
    const panel = within(await body.findByRole('dialog', { name: 'Group by' }))
    await expect(panel.getByRole('button', { name: /By client/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  },
}

/** An installation without AI: no "Organize with AI", and no Heidi in the sidebar or anywhere else. */
export const WithoutAI: Story = {
  parameters: pageParameters('/documents', {}, [
    http.get('/api/v1/auth/config', () =>
      HttpResponse.json({
        google: true,
        email: true,
        passkey: true,
        dev_codes: false,
        ai_available: false,
      }),
    ),
  ]),
  play: async (context) => {
    await shows('Receipts 2026', 'Budget 2027.xlsx')?.(context)
    const body = within(context.canvasElement.ownerDocument.body)
    await expect(body.getByRole('button', { name: 'Upload' })).toBeVisible()
    await waitFor(() => expect(body.queryByRole('button', { name: 'Organize with AI' })).toBeNull())
    await expect(body.queryByText('Ask Heidi')).toBeNull()
  },
}

/** With AI, the same page offers it: what WithoutAI takes away. */
export const WithAI: Story = {
  play: async (context) => {
    await shows('Receipts 2026')?.(context)
    const body = within(context.canvasElement.ownerDocument.body)
    await expect(
      await body.findByRole('button', { name: 'Organize with AI' }, { timeout: 8000 }),
    ).toBeVisible()
    await expect(body.getAllByText('Ask Heidi').length).toBeGreaterThan(0)
  },
}

/**
 * A PDF's "⋮" and its right-click menu are one menu, in the standard groups: view, share and sign,
 * edit, create (Extract with AI in Heidi's tone), then Move to Trash alone and last.
 */
export const FileMenu: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const [button] = await body.findAllByRole(
      'button',
      { name: /^Actions for .+\.pdf$/ },
      { timeout: 8000 },
    )
    if (!button) throw new Error('no PDF in the list')
    const order = await sameRowMenus(button)
    const label = '[^,|]*'
    await expect(order.join(', ')).toMatch(
      new RegExp(
        [
          `^${label}\\.pdf`,
          `Preview${label}`,
          `Download${label}`,
          '\\|',
          `Share…${label}`,
          `Send for signature…${label}`,
          '\\|',
          `Rename${label}`,
          'Move to…',
          'Copy to…',
          `Cut${label}`,
          '\\|',
          `Make a template…${label}`,
          `Extract with AI${label}`,
          '\\|',
          `Move to Trash${label}$`,
        ].join(', '),
      ),
    )
  },
}

export const LockedFileMenu: Story = {
  parameters: pageParameters('/documents', {}, [
    http.get('/api/v1/documents', () =>
      HttpResponse.json(
        page(sampleFiles.map((file) => ({ ...file, record_file: file.id === 'doc_1' }))),
      ),
    ),
  ]),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const [button] = await body.findAllByRole('button', {
      name: 'Actions for Mandate agreement Alpenglow.pdf',
    })
    if (!button) throw new Error('Missing original')
    const actions = await sameRowMenus(button)
    await expect(actions).not.toContain('Move to…')
    await expect(actions.some((label) => label.startsWith('Cut'))).toBe(false)
    await expect(actions).toContain('Copy to…')
    await expect(actions.some((label) => label.startsWith('Download'))).toBe(true)
    const clear = body.queryByRole('button', { name: 'Clear selection' })
    if (clear) await userEvent.click(clear)
    await userEvent.click(
      body.getByRole('checkbox', { name: 'Select Mandate agreement Alpenglow.pdf' }),
    )
    await userEvent.click(body.getByRole('checkbox', { name: 'Select Budget 2027.xlsx' }))
    const move = body.getByRole('button', { name: 'Move to…' })
    await expect(move).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(move)
    await expect(body.queryByRole('dialog')).toBeNull()
    await userEvent.keyboard('{Control>}x{/Control}')
    await expect(body.queryByText(/cut\. Paste with/)).toBeNull()
  },
}

// The list still has this file. The detail request decides whether its drawer can open.
let missingFile = Promise.withResolvers<void>()
let requestedFile = Promise.withResolvers<void>()
export const MissingFilePreview: Story = {
  parameters: pageParameters('/documents', { file: 'doc_3', folder: 'fld_contracts' }, [
    http.get('/api/v1/documents/doc_3', async () => {
      requestedFile.resolve()
      await missingFile.promise
      return HttpResponse.json(
        { error: { code: 'not_found', message: 'Not found.' } },
        { status: 404 },
      )
    }),
  ]),
  beforeEach: () => {
    requestedFile = Promise.withResolvers<void>()
    missingFile = Promise.withResolvers<void>()
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await requestedFile.promise
    try {
      await expect(body.queryByRole('dialog')).toBeNull()
    } finally {
      missingFile.resolve()
    }
    await waitFor(() => expect(getRouter().replace).toHaveBeenCalledWith('/documents/'))
    await expect(body.queryByRole('dialog')).toBeNull()
  },
}

export const MissingStackedFile: Story = {
  render: () => (
    <Frame>
      <RecordLink href="/documents?file=doc_gone">Open linked file</RecordLink>
    </Frame>
  ),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole('link', { name: 'Open linked file' }))
    await waitFor(() => expect(getRouter().replace).toHaveBeenCalledWith('/documents/'))
    await expect(url(canvasElement).getAll('drawer')).toEqual([])
    await expect(body.queryByRole('dialog')).toBeNull()
  },
}

export const RetryFilePreview: Story = {
  parameters: pageParameters('/documents', { file: 'doc_3' }, [
    http.get(
      '/api/v1/documents/doc_3',
      () =>
        HttpResponse.json(
          { error: { code: 'unavailable', message: 'Service unavailable.' } },
          { status: 503 },
        ),
      { once: true },
    ),
  ]),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const error = within(await body.findByRole('alert'))
    await userEvent.click(error.getByRole('button', { name: 'Try again' }))
    await expect(await body.findByRole('dialog', { name: 'Budget 2027.xlsx' })).toBeVisible()
  },
}

export const ProtectedDocumentTags: Story = {
  parameters: pageParameters('/documents', { file: 'doc_1' }, [
    http.get('/api/v1/documents/doc_1', () =>
      HttpResponse.json({
        data: {
          ...sampleFiles[0],
          tags: ['urgent', 'invoice', 'signed', 'year-2026-02', 'acme', '2026-in-005'],
          auto_tags: ['invoice', 'signed', 'year-2026-02', 'acme', '2026-in-005'],
          locked_tags: ['invoice', 'signed', 'year-2026-02', '2026-in-005'],
        },
      }),
    ),
  ]),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    await userEvent.click(await body.findByRole('button', { name: 'Edit' }))
    await Promise.all(
      ['Invoice', 'Signed', '2026-02', '2026-in-005'].map(async (tag) => {
        await expect(body.getByText(tag, { selector: '[data-auto-tag]' })).toBeVisible()
        await expect(body.queryByRole('button', { name: `Remove ${tag}` })).toBeNull()
      }),
    )
    // A free tag and the client's automatic tag keep their remove control.
    await expect(body.getByRole('button', { name: 'Remove urgent' })).toBeVisible()
    await expect(body.getByRole('button', { name: 'Remove acme' })).toBeVisible()
    // Kind, date and signed tags cannot be typed onto a file.
    const refused = async (typed: string) => {
      await userEvent.type(body.getByRole('textbox', { name: 'Tags' }), `${typed}{Enter}`)
      await expect(
        body.getByText('Set automatically from a document’s record or filing.'),
      ).toBeVisible()
      await expect(body.queryByRole('button', { name: `Remove ${typed}` })).toBeNull()
      await userEvent.clear(body.getByRole('textbox', { name: 'Tags' }))
    }
    await refused('year-2031-09')
    await refused('payment-confirmation')
  },
}

/**
 * A file's "Linked to" opens the signature request's drawer on top of the preview, sliding in, without
 * leaving the page; closing it uncovers the preview again.
 */
export const LinkedRecordStacks: Story = {
  parameters: pageParameters('/documents', { file: 'doc_1' }, [
    http.get('/api/v1/documents/doc_1', () =>
      HttpResponse.json({
        data: {
          ...sampleFiles[0],
          links: [{ type: 'signature', id: 'sig_1', label: 'Signed · Mandate', retains: false }],
        },
      }),
    ),
    http.get('/api/v1/signatures/sig_1', async () => {
      await delay('infinite')
    }),
  ]),
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body)
    const link = await body.findByRole('link', { name: 'Signed · Mandate' }, { timeout: 8000 })
    const path = window.location.pathname
    await userEvent.click(link)
    const request = await body.findByRole('dialog', { name: 'Loading…' })
    await expect(request).toHaveAttribute('data-state', 'open')
    await expect(request.className).toContain('slide-in-from-right')
    await expect(window.location.pathname).toBe(path)
    await expect(new URLSearchParams(window.location.search).getAll('drawer')).toEqual([
      'signature:sig_1',
    ])

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(body.queryByRole('dialog', { name: 'Loading…' })).toBeNull())
    await expect(body.getByRole('link', { name: 'Signed · Mandate' })).toBeVisible()
  },
}
