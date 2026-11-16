import { expect, object, openPage, test, uniqueName } from './fixtures'

test('imports clients from a CSV: upload, review, fix nothing, commit once', async ({
  page,
  api,
}) => {
  const first = uniqueName('Import Alpha')
  const second = uniqueName('Import Beta')
  const csv = `name,email,city,country\n${first},alpha@example.test,Zürich,CH\n${second},beta@example.test,Bern,CH\n`

  await openPage(page, '/clients', 'Clients')
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Import', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Import clients' })
  await drawer.getByLabel('Choose files to import').setInputFiles({
    name: 'clients.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  })
  await drawer.getByRole('button', { name: 'Read files', exact: true }).click()
  const table = drawer.getByRole('table', { name: 'Records found' })
  await expect(table.getByText(first, { exact: true })).toBeVisible({ timeout: 30_000 })
  await expect(table.getByText(second, { exact: true })).toBeVisible()

  const commit = drawer.getByRole('button', { name: /^Import 2/ })
  await commit.click()
  await expect(drawer.getByText('2 created', { exact: false })).toBeVisible()

  const response = await api.request.get(`/api/v1/clients?search=${encodeURIComponent('Import ')}`)
  const rows = object(await response.json()).data
  if (!Array.isArray(rows)) throw new Error('Expected clients')
  const names = rows.map((row) => object(row).name)
  expect(names).toEqual(expect.arrayContaining([first, second]))
  expect(names.filter((name) => name === first)).toHaveLength(1)

  // The CSV is now a Document: the same bytes again are read from it, not stored twice.
  const documents = object(await (await api.request.get('/api/v1/documents')).json()).data
  expect(JSON.stringify(documents)).toContain('clients.csv')
})
