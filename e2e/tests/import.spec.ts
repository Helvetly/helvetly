import { expect, object, openPage, test, uniqueName } from './fixtures'

test('imports clients from a CSV: upload, review, fix nothing, commit once', async ({
  page,
  api,
}) => {
  await api.approveAI()
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
  await drawer.getByRole('button', { name: 'Process with AI', exact: true }).click()
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

test('a CSV dropped anywhere on the clients page opens its import with the file, and imports it', async ({
  page,
  api,
}) => {
  await api.approveAI()
  const name = uniqueName('Dropped Gamma')
  const csv = `name,email,city,country\n${name},gamma@example.test,Basel,CH\n`

  await openPage(page, '/clients', 'Clients')
  // A desktop drag: the browser fires dragenter, dragover and drop with the files in a DataTransfer.
  const data = await page.evaluateHandle((text) => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([text], 'dropped-clients.csv', { type: 'text/csv' }))
    return transfer
  }, csv)
  await page.dispatchEvent('main', 'dragenter', { dataTransfer: data })
  await page.dispatchEvent('main', 'dragover', { dataTransfer: data })
  await expect(page.getByText('Drop to read these files into new clients')).toBeVisible()
  await page.dispatchEvent('main', 'drop', { dataTransfer: data })

  const drawer = page.getByRole('dialog', { name: 'Import clients' })
  const chosen = drawer.getByRole('table', { name: 'Chosen files' })
  await expect(chosen.getByText('dropped-clients.csv')).toBeVisible()
  await drawer.getByRole('button', { name: 'Process with AI', exact: true }).click()
  const table = drawer.getByRole('table', { name: 'Records found' })
  await expect(table.getByText(name, { exact: true })).toBeVisible({ timeout: 30_000 })
  await drawer.getByRole('button', { name: /^Import 1/ }).click()
  await expect(drawer.getByText('1 created', { exact: false })).toBeVisible()

  const response = await api.request.get(`/api/v1/clients?search=${encodeURIComponent(name)}`)
  const rows = object(await response.json()).data
  if (!Array.isArray(rows)) throw new Error('Expected clients')
  expect(rows.map((row) => object(row).name)).toEqual([name])
})
