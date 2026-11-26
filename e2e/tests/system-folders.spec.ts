import { expect, object, openPage, test, text, type FinancialAPI } from './fixtures'

type Folder = { id: string; name: string; parent_id: string | null; system_kind: string | null }

const folders = async (api: FinancialAPI, language = 'en') => {
  const response = await api.request.get('/api/v1/documents/folders', {
    headers: { 'Accept-Language': language },
  })
  await expect(response).toBeOK()
  return object(await response.json()).data as Folder[]
}

/** The folder at path (names top level first), or undefined. */
const at = (all: Folder[], path: string[]) => {
  let parent: string | null = null
  let found: Folder | undefined
  for (const name of path) {
    found = all.find((f) => f.parent_id === parent && f.name === name)
    if (!found) return undefined
    parent = found.id
  }
  return found
}

test('an issued invoice’s PDF is filed in Clients/<client>/Invoices/<year>', async ({
  api,
  page,
}) => {
  await api.settings()
  const client = await api.client()
  const invoice = await api.save(`/invoices/${text((await api.draft(client)).id)}/issue`)
  const year = text(invoice.issue_date).slice(0, 4)

  const all = await folders(api)
  const folder = at(all, ['Clients', text(client.name), 'Invoices', year])
  expect(folder?.system_kind).toBe('year')
  const listed = await api.request.get(`/api/v1/documents?folder_id=${folder?.id}`)
  await expect(listed).toBeOK()
  const files = object(await listed.json()).data as Record<string, unknown>[]
  expect(files).toHaveLength(1)
  const pdf = object(files[0])
  expect(text(pdf.name)).toContain(text(invoice.number).replaceAll('/', '-'))
  expect(pdf.links).toEqual([
    expect.objectContaining({ type: 'invoice', id: invoice.id, retains: true }),
  ])

  // the same folders in German, made once
  const german = await folders(api, 'de-CH')
  expect(german).toHaveLength(all.length)
  expect(at(german, ['Kunden', text(client.name), 'Rechnungen', year])?.id).toBe(folder?.id)

  await openPage(page, `/documents?folder=${folder?.id}`, 'Documents')
  await expect(page.getByText(text(pdf.name)).first()).toBeVisible()
})

test('Clients, Expenses and Bank Statements cannot be renamed, moved or deleted', async ({
  api,
  page,
}) => {
  const all = await folders(api)
  const clients = at(all, ['Clients'])
  const expenses = at(all, ['Expenses'])
  const bank = at(all, ['Bank Statements'])
  expect(clients?.system_kind).toBe('clients')
  expect(expenses?.system_kind).toBe('expenses')
  expect(bank?.system_kind).toBe('bank_statements')
  const mine = await api.save('/documents/folders', { name: `Mine ${Date.now()}` })

  const refused = async (folder: Folder | undefined) => {
    const rename = await api.write(`/documents/folders/${folder?.id}`, { name: 'Gone' }, 'PATCH')
    expect(rename.status()).toBe(409)
    expect(object(object(await rename.json()).error).code).toBe('system_folder')
    const moved = await api.write(
      `/documents/folders/${folder?.id}`,
      { parent_id: mine.id },
      'PATCH',
    )
    expect(moved.status()).toBe(409)
    const trashed = await api.save('/documents/bulk', { action: 'trash', folder_ids: [folder?.id] })
    expect(trashed.updated).toBe(0)
    expect(trashed.skipped).toHaveLength(1)
  }
  await Promise.all([refused(clients), refused(expenses), refused(bank)])
  expect((await folders(api)).filter((f) => f.system_kind === 'clients')).toHaveLength(1)

  // the page shows the mark and offers no rename, move or delete for it
  await openPage(page, '/documents', 'Documents')
  const tree = page.getByRole('list', { name: 'Folder tree' })
  const row = tree.getByText('Clients', { exact: true }).first()
  await expect(tree.getByLabel(/can't be renamed/i).first()).toBeVisible()
  await expect(row).toBeVisible()
  await row.click({ button: 'right' })
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /rename/i })).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: /move/i })).toHaveCount(0)
  await expect(menu.getByRole('menuitem', { name: /trash|delete/i })).toHaveCount(0)
})
