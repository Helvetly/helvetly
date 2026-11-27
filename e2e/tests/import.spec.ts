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

  // The CSV was only the import's source: it never shows in Documents and is gone once the import is done.
  const documents = object(await (await api.request.get('/api/v1/documents')).json()).data
  expect(JSON.stringify(documents)).not.toContain('clients.csv')
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

test("a PDF imported from a client's drawer becomes that client's invoice", async ({
  page,
  api,
}) => {
  await api.approveAI()
  await api.settings()
  const client = await api.client()
  const name = String(client.name)
  const number = uniqueName('RE-E2E').replaceAll(' ', '-')

  await page.goto(`/clients?id=${String(client.id)}`)
  const header = page.getByRole('banner').filter({ hasText: name })
  await header.getByRole('button', { name: 'More ways to add invoices' }).click()
  await page.getByRole('menuitem', { name: 'Import invoices' }).click()
  const drawer = page.getByRole('dialog', { name: `Import invoices for ${name}` })
  await expect(drawer.getByText(/every invoice read is assigned to this client/)).toBeVisible()
  await drawer.getByLabel('Choose files to import').setInputFiles({
    name: `${number}.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.7\n${number}\n%%EOF\n`),
  })
  await drawer.getByRole('button', { name: 'Process with AI', exact: true }).click()
  const table = drawer.getByRole('table', { name: 'Records found' })
  await expect(table.getByText(number)).toBeVisible({ timeout: 30_000 })
  await drawer.getByRole('button', { name: /^Import 1/ }).click()
  await expect(drawer.getByText('1 created', { exact: false })).toBeVisible()

  // A client's imports are listed with that client only, never on the Invoices page.
  const unscoped = object(await (await api.request.get('/api/v1/imports?kind=invoices')).json())
  expect(unscoped.data).toEqual([])
  const batches = object(
    await (
      await api.request.get(`/api/v1/imports?kind=invoices&client_id=${String(client.id)}`)
    ).json(),
  ).data
  if (!Array.isArray(batches)) throw new Error('Expected import batches')
  const batch = await api.read(`/imports/${String(object(batches[0]).id)}`)
  expect(batch.client_id).toBe(client.id)
  const records = batch.records
  if (!Array.isArray(records)) throw new Error('Expected records')
  const invoice = await api.read(`/invoices/${String(object(records[0]).entity_id)}`)
  expect(invoice.client_id).toBe(client.id)
})

test('a CSV kept in Documents is read with AI from its row and imported, with no second copy', async ({
  page,
  api,
}) => {
  const name = uniqueName('Kept Delta')
  const file = `${uniqueName('clients').replaceAll(' ', '-')}.csv`
  // Kept before the AI is approved, so filing leaves it at the top level.
  const kept = await api.request.post('/api/v1/documents', {
    headers: { 'X-CSRF-Token': api.csrf },
    multipart: {
      file: {
        name: file,
        mimeType: 'text/csv',
        buffer: Buffer.from(`name,email,city,country\n${name},delta@example.test,Chur,CH\n`),
      },
    },
  })
  expect(kept.status()).toBe(201)
  await api.approveAI()
  const count = async () => object(await (await api.request.get('/api/v1/documents')).json()).meta

  const before = await count()
  await openPage(page, '/documents', 'Documents')
  await page.getByRole('checkbox', { name: `Select ${file}` }).click()
  await page
    .getByRole('toolbar', { name: 'Selected rows' })
    .getByRole('button', { name: 'Extract with AI' })
    .click()
  const drawer = page.getByRole('dialog', { name: 'Import documents' })
  await expect(drawer.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  await drawer.getByRole('button', { name: /^Import 1/ }).click()
  await expect(drawer.getByText('1 created', { exact: false })).toBeVisible()

  const response = await api.request.get(`/api/v1/clients?search=${encodeURIComponent(name)}`)
  const rows = object(await response.json()).data
  if (!Array.isArray(rows)) throw new Error('Expected clients')
  expect(rows.map((row) => object(row).name)).toEqual([name])
  expect(await count()).toEqual(before)
})

test('a PDF imported twice shows the same records the second time, each matched to what Helvetly has', async ({
  page,
  api,
}) => {
  await api.approveAI()
  await api.settings()
  const number = uniqueName('IN-E2E').replaceAll(' ', '-')
  const pdf = {
    name: `${number}.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.7\n${number}\n%%EOF\n`),
  }
  const importOnce = async () => {
    await page.goto('/documents?import=1')
    const drawer = page.getByRole('dialog', { name: 'Import documents' })
    await drawer.getByLabel('Choose files to import').setInputFiles(pdf)
    await drawer.getByRole('button', { name: 'Process with AI', exact: true }).click()
    await expect(drawer.getByRole('button', { name: new RegExp(`^${number}\\.pdf`) })).toHaveText(
      /Invoice you issued · (2 records found|All 2 records already in Helvetly)/,
      { timeout: 30_000 },
    )
    return drawer
  }

  const first = await importOnce()
  await expect(first.getByRole('heading', { name: /^Clients\s*1$/ })).toBeVisible()
  await expect(first.getByRole('heading', { name: /^Invoices\s*1$/ })).toBeVisible()
  await first.getByRole('button', { name: /^Import 2/ }).click()
  await expect(first.getByText('2 created', { exact: false })).toBeVisible()

  const again = await importOnce()
  const file = again.getByRole('button', { name: new RegExp(`^${number}\\.pdf`) })
  await expect(file).toContainText('All 2 records already in Helvetly')
  await expect(file).toContainText('already in Documents, not stored again')
  await expect(file).toHaveAttribute('aria-expanded', 'false')
  await expect(again.getByRole('button', { name: /^Import 0/ })).toBeDisabled()
  await file.click()
  await expect(again.getByText('Matches Development Buyer AG in Helvetly')).toBeVisible()
  await expect(again.getByText(`Already in Helvetly: ${number}`, { exact: false })).toBeVisible()
  await expect(again.getByRole('checkbox', { name: `Select ${number}` })).not.toBeChecked()

  // Nothing was created twice: one client, one invoice with that number.
  const clients = object(
    await (await api.request.get('/api/v1/clients?search=Development%20Buyer')).json(),
  ).data
  expect(Array.isArray(clients) && clients.length).toBe(1)
})

test('an unfinished invoice import is offered on Invoices only, never on Engagements', async ({
  page,
  api,
}) => {
  await api.approveAI()
  await api.settings()
  const number = uniqueName('IN-CTX').replaceAll(' ', '-')
  await page.goto('/invoices?import=1')
  const invoices = page.getByRole('dialog', { name: 'Import invoices' })
  await invoices.getByLabel('Choose files to import').setInputFiles({
    name: `${number}.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.7\n${number}\n%%EOF\n`),
  })
  await invoices.getByRole('button', { name: 'Process with AI', exact: true }).click()
  await expect(invoices.getByRole('table', { name: 'Records found' })).toBeVisible({
    timeout: 30_000,
  })
  // Closed without importing: the batch stays, unfinished.
  await invoices.getByRole('button', { name: 'Close' }).click()
  await expect(invoices).toBeHidden()

  const listed = page.waitForResponse((r) => r.url().includes('/api/v1/imports?kind=engagements'))
  await page.goto('/engagements?import=1')
  const engagements = page.getByRole('dialog', { name: 'Import engagements' })
  await expect(engagements).toBeVisible()
  expect(object(await (await listed).json()).data).toEqual([])
  await expect(engagements.getByRole('button', { name: 'Process with AI' })).toBeVisible()
  await expect(engagements.getByText(/An unfinished import/)).toHaveCount(0)

  await page.goto('/invoices?import=1')
  await expect(invoices.getByText(/An unfinished import of invoices/)).toBeVisible()
  await invoices.getByRole('button', { name: 'Continue import' }).click()
  await expect(invoices.getByText(`${number}.pdf`).first()).toBeVisible()
})

test('a quote PDF imported from the quotes page becomes a sent quote with its own number', async ({
  page,
  api,
}) => {
  await api.approveAI()
  await api.settings()
  const client = await api.client()
  const name = String(client.name)
  const number = uniqueName('OF-E2E').replaceAll(' ', '-')

  await openPage(page, '/quotes', 'Quotes')
  await page.getByRole('button', { name: 'New quote options' }).click()
  await page.getByRole('menuitem', { name: 'Import quotes' }).click()
  const drawer = page.getByRole('dialog', { name: 'Import quotes' })
  await drawer.getByLabel('Choose files to import').setInputFiles({
    name: `${number}.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.7\n${number}\n%%EOF\n`),
  })
  await drawer.getByRole('button', { name: 'Process with AI', exact: true }).click()
  const table = drawer.getByRole('table', { name: 'Records found' })
  await expect(table.getByText(number)).toBeVisible({ timeout: 30_000 })

  // The quote is the client's chosen in review, whatever the document's buyer was called.
  await drawer.getByRole('button', { name: `Edit ${number}` }).click()
  const editor = page.getByRole('dialog', { name: /Edit record/ })
  await editor.getByRole('button', { name: 'Client', exact: true }).click()
  await page.getByPlaceholder('Search clients by name, city or #number…').fill(name)
  await page.getByRole('option', { name: new RegExp(name) }).click()
  await editor.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(editor).toBeHidden()

  await drawer.getByRole('button', { name: /^Import 1/ }).click()
  await expect(drawer.getByText('1 created', { exact: false })).toBeVisible()

  const quotes = object(await (await api.request.get('/api/v1/quotes')).json()).data
  if (!Array.isArray(quotes)) throw new Error('Expected quotes')
  const quote = object(quotes.find((row) => object(row).number === number))
  // Sent on 15 Jan, valid for 30 days: past that, the list shows it expired.
  expect(quote.status).toBe('expired')
  expect(quote.client_id).toBe(client.id)
  expect(quote.valid_until).toBe('2026-02-14')

  // The same PDF again is the same quote: its number is taken, so nothing is created twice.
  await page.goto('/quotes?import=1')
  const again = page.getByRole('dialog', { name: 'Import quotes' })
  await again.getByLabel('Choose files to import').setInputFiles({
    name: `${number}.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.7\n${number}\n%%EOF\n`),
  })
  await again.getByRole('button', { name: 'Process with AI', exact: true }).click()
  // The record is read again, but waits with the taken number as its issue: nothing is created twice.
  const issueOfNewest = async () => {
    const list = object(await (await api.request.get('/api/v1/imports?kind=quotes')).json()).data
    if (!Array.isArray(list) || !list.length) return null
    const batch = await api.read(`/imports/${String(object(list[0]).id)}`)
    const records = Array.isArray(batch.records) ? batch.records : []
    return records.length ? object(object(records[0]).issues).number : null
  }
  await expect.poll(issueOfNewest, { timeout: 30_000 }).toBe(`Quote ${number} already exists.`)
  await expect(again.getByRole('checkbox', { name: `Select ${number}` })).not.toBeChecked()
  const all = object(await (await api.request.get('/api/v1/quotes')).json()).data
  expect(Array.isArray(all) && all.filter((row) => object(row).number === number)).toHaveLength(1)
})
