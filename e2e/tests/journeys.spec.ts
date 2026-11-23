import { randomUUID } from 'node:crypto'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'

import { expect, object, openPage, signIn, test, text, today, uniqueName } from './fixtures'

test('signed-out deep links keep their safe return path', async ({ page }) => {
  await page.goto('/clients?search=Acme')
  await expect(page).toHaveURL(/\/login\?next=/)
  const next = new URL(page.url()).searchParams.get('next')
  expect(next).toBe('/clients?search=Acme')
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
})

test('email sign-in validates input, rejects a wrong code, accepts once and logs out', async ({
  page,
  email,
}) => {
  await page.goto('/login?next=%2Fclients')
  await page.getByLabel('Email', { exact: true }).fill('invalid')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByText('Enter an email address such as ana@example.com.')).toBeVisible()
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  const codeResponse = await page.request.get(
    `/api/v1/auth/email/dev-code?email=${encodeURIComponent(email)}`,
  )
  const code = text(object(await codeResponse.json()).code)
  await page.getByLabel('Code', { exact: true }).fill(code === '000000' ? '111111' : '000000')
  await expect(page.getByText(/That code is not right/)).toBeVisible()
  await page.getByLabel('Code', { exact: true }).fill(code)
  await expect(page).toHaveURL(/\/welcome/)
  // The welcome is finished, not skipped: the company step has no skip, only the optional steps after it do.
  // The first step asks for the name, empty: nothing comes from the email address.
  const nameInput = page.getByRole('textbox', { name: /^What should we call you/ })
  await expect(nameInput).toHaveValue('')
  await nameInput.fill('Journey Owner')
  // The workspace name is its own required field here, blank for the sign-up placeholder and never taken from the company.
  const workspaceInput = page.getByRole('textbox', { name: /^Workspace name/ })
  await expect(workspaceInput).toHaveValue('')
  await workspaceInput.fill('Journey Workspace')
  await page.getByRole('button', { name: 'Get started' }).click()
  await page.getByLabel(/^Company name/).fill('Journey AG')
  // The legal form follows the name's ending; the server refuses to finish a Swiss company without one.
  await expect(page.getByRole('button', { name: /^Legal form/ })).toContainText('AG / SA')
  await expect(page.getByRole('textbox', { name: /^Workspace name/ })).toHaveCount(0)
  await page.getByLabel(/^Street/).fill('Bahnhofstrasse')
  await page.getByLabel(/^Number/).fill('1')
  await page.getByLabel(/^ZIP/).fill('8001')
  await page.getByLabel(/^City/).fill('Zurich')
  // VAT registration starts on and then needs the UID; this person is not registered.
  await page.getByRole('switch', { name: 'Registered for VAT' }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  // The import step is offered: the installation can import (E2E fakes the import model, so `ai_available`).
  await expect(page.getByRole('heading', { name: 'Bring your data' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'You’re all set, Journey Owner' })).toBeVisible()
  await page.getByRole('button', { name: 'Go to the dashboard' }).click()
  await expect(page).toHaveURL(/\/clients/)
  const saved = object(await (await page.request.get('/api/v1/session')).json())
  expect(object(saved.user).name).toBe('Journey Owner')
  expect(object(saved.workspace).name).toBe('Journey Workspace')
  const company = object(
    object(await (await page.request.get('/api/v1/invoice-settings')).json()).data,
  )
  expect(object(company.seller).legal_form).toBe('ag')
  await expect(page.getByRole('button', { name: 'New client', exact: true })).toBeVisible()
  const replay = await page.request.post('/api/v1/auth/email/verify', {
    data: { email, code, next: '/' },
  })
  expect(replay.status()).toBe(410)
  await page.getByRole('button', { name: 'Journey Owner', exact: false }).click()
  await page.getByRole('menuitem', { name: 'Log out' }).click()
  await expect(page).toHaveURL(/\/login/)
  expect((await page.request.get('/api/v1/session')).status()).toBe(401)
})

test('client form preserves validation, one rapid save and data after refresh', async ({
  page,
  api,
}) => {
  await openPage(page, '/clients?new=1', 'Clients')
  await page.getByRole('button', { name: 'Add client', exact: true }).click()
  await expect(page.getByLabel('Company name', { exact: false })).toBeFocused()
  const name = uniqueName('Browser Client')
  await page.getByLabel('Company name', { exact: false }).fill(name)
  await page.keyboard.press('Control+Enter')
  await page.keyboard.press('Control+Enter')
  await expect(page.getByRole('dialog', { name: 'New client', exact: true })).toHaveCount(0)
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible()
  const response = await api.request.get(`/api/v1/clients?search=${encodeURIComponent(name)}`)
  const result = object(await response.json())
  expect(Array.isArray(result.data) ? result.data.length : -1).toBe(1)
  await page.reload()
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible()
})

test('catalogue creates a priced item through the actual form', async ({ page, api }) => {
  await api.settings()
  await openPage(page, '/products?new=1', 'Products & services')
  const form = page.getByRole('dialog', { name: 'New product or service', exact: true })
  await form.getByRole('textbox', { name: 'Name', exact: true }).fill(uniqueName('Browser Service'))
  await form.getByRole('textbox', { name: 'Unit price', exact: true }).fill('100')
  await form.getByRole('button', { name: /Add to catalogue|Add item|Add product/ }).click()
  await expect(form).toHaveCount(0)
  await expect(page.getByText('100.00', { exact: false }).first()).toBeVisible()
  const response = await api.request.get('/api/v1/products')
  const rows = object(await response.json()).data
  expect(Array.isArray(rows) ? rows.length : -1).toBe(1)
  if (!Array.isArray(rows)) throw new Error('Expected catalogue rows')
  // A new item's price is gross by default: 100 incl. 8.1 % VAT.
  expect(object(rows[0]).unit_price_net).toBe('92.51')
  expect(object(rows[0]).unit_price_gross).toBe('100.00')
})

test('issued invoice, payment, credit and refund agree with the browser and historical PDF', async ({
  page,
  api,
}) => {
  await api.settings()
  const client = await api.client()
  const invoice = await api.draft(client)
  const path = `/invoices/${text(invoice.id)}`
  await page.goto(`/invoices/edit?id=${text(invoice.id)}`)
  await expect(page.getByRole('button', { name: /^Issue/ }).first()).toBeVisible()
  await page
    .getByRole('button', { name: /^Issue/ })
    .first()
    .click()
  await page
    .getByRole('dialog', { name: 'Issue this invoice?' })
    .getByRole('button', { name: 'Issue invoice' })
    .click()
  await expect.poll(async () => (await api.read(path)).status).toBe('open')
  const issued = await api.read(path)
  expect(issued.payable_total).toBe('1081.00')
  const originalPDF = await api.request.get(`/api/v1${path}/pdf`)
  await expect(originalPDF).toBeOK()
  const before = await originalPDF.body()
  expect(before.subarray(0, 5).toString()).toBe('%PDF-')
  await api.save(`${path}/payments`, {
    amount: '400.00',
    paid_on: today(),
    method: 'bank_transfer',
  })
  expect((await api.read(path)).amount_due).toBe('681.00')
  await api.save(`${path}/mark-paid`)
  const credit = await api.save(`${path}/credit-note`, {
    reason: 'Service reduction',
    lines: [
      { description: 'One hour returned', quantity: '1', unit_price: '100', vat_rate: '8.1' },
    ],
  })
  await api.save(`/invoices/${text(credit.id)}/issue`)
  expect((await api.read(path)).refund_due).toBe('108.10')
  await api.save(`${path}/refunds`, {
    amount: '108.10',
    refunded_on: today(),
    method: 'bank_transfer',
  })
  expect((await api.read(path)).refund_due).toBe('0.00')
  await api.save(`/clients/${text(client.id)}`, { name: 'Renamed after issue' }, 'PATCH')
  const after = await api.request.get(`/api/v1${path}/pdf`)
  expect(await after.body()).toEqual(before)
  await page.goto(`/invoices?id=${text(invoice.id)}`)
  await expect(page.getByText(text(issued.number), { exact: true }).first()).toBeVisible()
  await expect(page.getByText(text(client.name), { exact: false }).first()).toBeVisible()
})

for (const amount of ['0', '-1', '1081.01']) {
  test(`payment of ${amount} is rejected without changing the balance`, async ({ api }) => {
    await api.settings()
    const invoice = await api.draft(await api.client())
    const path = `/invoices/${text(invoice.id)}`
    await api.save(`${path}/issue`)
    const invalid = await api.write(`${path}/payments`, {
      amount,
      paid_on: today(),
      method: 'cash',
    })
    expect(invalid.status()).toBe(422)
    expect((await api.read(path)).amount_paid).toBe('0.00')
  })
}

test('booked expenses separate input tax and settlement and retain export evidence', async ({
  page,
  api,
}) => {
  await api.settings()
  const categories = await api.request.get('/api/v1/expense-categories')
  const list = object(await categories.json()).data
  if (!Array.isArray(list) || !list.length) throw new Error('Expected seeded categories')
  const expense = await api.save('/expenses', {
    supplier_name: uniqueName('Browser Supplier'),
    supplier_country: 'CH',
    document_date: today(),
    category_id: text(object(list[0]).id),
    receipt_missing_reason: 'E2E substitute voucher; no real transaction',
    lines: [{ amount: '108.10', vat_rate: '8.1' }],
    input_tax: 'full',
  })
  const path = `/expenses/${text(expense.id)}`
  const booked = await api.save(`${path}/book`)
  expect(booked.total).toBe('108.10')
  expect(booked.deductible_vat).toBe('8.10')
  const changed = await api.write(path, { lines: [{ amount: '200', vat_rate: '8.1' }] }, 'PATCH')
  expect(changed.status()).toBe(409)
  await openPage(page, '/expenses', 'Expenses')
  await expect(page.getByText(text(expense.supplier_name), { exact: true }).first()).toBeVisible()
  const csv = await api.request.get(`/api/v1/expenses/export?ids=${text(expense.id)}`)
  expect(await csv.text()).toContain('108.10')
  await api.save(`${path}/void`, { reason: 'E2E cancellation' })
  const retained = await api.request.get(`/api/v1/expenses/export?ids=${text(expense.id)}`)
  expect(await retained.text()).toContain('108.10')
})

test('uploaded bytes already in Documents reuse the one file after rename and simultaneous retries', async ({
  page,
  api,
}) => {
  await openPage(page, '/documents', 'Documents')
  const name = `e2e-${randomUUID()}.txt`
  const bytes = Buffer.from(`E2E unique evidence ${randomUUID()}`)
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name, mimeType: 'text/plain', buffer: bytes })
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible()
  // The row shows while the bytes are still on their way: wait for the stored file before retrying.
  await expect
    .poll(async () => {
      const listed = object(
        await (await api.request.get(`/api/v1/documents?search=${name}`)).json(),
      ).data
      return Array.isArray(listed) ? listed.length : 0
    })
    .toBe(1)
  const attempt = () =>
    api.request.post('/api/v1/documents', {
      headers: { 'X-CSRF-Token': api.csrf },
      multipart: { file: { name: `renamed-${name}`, mimeType: 'text/plain', buffer: bytes } },
    })
  const reused = await Promise.all([attempt(), attempt()])
  const ids = await Promise.all(
    reused.map(async (response) => {
      expect(response.status()).toBe(200)
      const body = object(await response.json())
      expect(body.reused).toBe(true)
      expect(object(body.data).name).toBe(name)
      return text(object(body.data).id)
    }),
  )
  expect(new Set(ids).size).toBe(1)
  await page.reload()
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible()
  await expect(page.getByText(`renamed-${name}`, { exact: true })).toHaveCount(0)
  // The browser path: the same bytes under another name give the calm note and no second file.
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name: `again-${name}`, mimeType: 'text/plain', buffer: bytes })
  const tray = page.getByRole('region', { name: 'Uploads' })
  await expect(tray).toContainText('Already in Documents')
  await expect(tray.getByRole('link', { name: 'Show' })).toBeVisible()
  await expect(page.getByText(`again-${name}`, { exact: true })).toHaveCount(0)
  const upload = (fileName: string, buffer: Buffer) =>
    api.request.post('/api/v1/documents', {
      headers: { 'X-CSRF-Token': api.csrf },
      multipart: { file: { name: fileName, mimeType: 'application/octet-stream', buffer } },
    })
  expect((await upload('empty.bin', Buffer.alloc(0))).status()).toBe(422)
  expect((await upload('program.exe', Buffer.from('MZ executable'))).status()).toBe(422)
  expect((await upload('too-large.txt', Buffer.alloc(1024 * 1024 + 1, 'x'))).status()).toBe(413)
  expect((await upload('exact-limit.txt', Buffer.alloc(1024 * 1024, 'x'))).status()).toBe(201)
  const pdf = Buffer.from(`%PDF-1.7\nE2E hash evidence ${randomUUID()}\n%%EOF\n`)
  const document = await upload('hash-evidence.pdf', pdf)
  expect(document.status()).toBe(201)
  const documentID = text(object(object(await document.json()).data).id)
  const categories = object(await (await api.request.get('/api/v1/expense-categories')).json()).data
  if (!Array.isArray(categories) || !categories.length)
    throw new Error('Expected expense categories')
  const expense = await api.save('/expenses', {
    supplier_name: 'Duplicate attachment test',
    document_date: today(),
    category_id: text(object(categories[0]).id),
    lines: [{ amount: '10', vat_rate: '0' }],
    input_tax: 'none',
  })
  const receipt = await api.request.post(`/api/v1/expenses/${text(expense.id)}/receipts`, {
    headers: { 'X-CSRF-Token': api.csrf },
    multipart: {
      'files[]': { name: 'renamed-receipt.pdf', mimeType: 'application/pdf', buffer: pdf },
    },
  })
  // Bytes already in Documents: the receipt is stored and the existing Document linked, no copy.
  expect(receipt.status()).toBe(201)
  const other = await api.save('/expenses', {
    supplier_name: 'Second receipt holder',
    document_date: today(),
    category_id: text(object(categories[0]).id),
    lines: [{ amount: '10', vat_rate: '0' }],
    input_tax: 'none',
  })
  const again = await api.request.post(`/api/v1/expenses/${text(other.id)}/receipts`, {
    headers: { 'X-CSRF-Token': api.csrf },
    multipart: {
      'files[]': { name: 'another-copy.pdf', mimeType: 'application/pdf', buffer: pdf },
    },
  })
  // The same bytes as another expense's receipt stay refused.
  expect(again.status()).toBe(409)
  expect(object(object(await again.json()).error).code).toBe('duplicate_file')
  const client = await api.client()
  const linked = await api.request.post(`/api/v1/clients/${text(client.id)}/files`, {
    headers: { 'X-CSRF-Token': api.csrf },
    multipart: {
      'files[]': { name: 'renamed-client-file.pdf', mimeType: 'application/pdf', buffer: pdf },
    },
  })
  expect(linked.status()).toBe(201)
  const files = object(await linked.json()).data
  if (!Array.isArray(files)) throw new Error('Expected linked client files')
  expect(text(object(files[0]).id)).toBe(documentID)
})

test('client files over 95 MB go in requests under Cloudflare’s 100 MB, with one batch’s checks', async ({
  page,
  api,
}, testInfo) => {
  test.setTimeout(180_000)
  const id = text((await api.client()).id)
  const endpoint = `/api/v1/clients/${id}/files`
  const bodies: number[] = []
  page.on('requestfinished', async (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === endpoint)
      bodies.push((await request.sizes()).requestBodySize)
  })
  // Five distinct files of almost 20 MB: over 95 MB in all. Playwright takes files this big only from disk.
  const scans = (prefix: string) =>
    Promise.all(
      [0, 1, 2, 3, 4].map(async (i) => {
        const file = testInfo.outputPath(`${prefix}-${i}.txt`)
        await writeFile(file, Buffer.alloc(19.5 * 1024 * 1024 - i, `${randomUUID()} ${i}\n`))
        return file
      }),
    )
  await page.goto(`/clients?id=${id}`)
  await page.getByRole('tab', { name: /^Files/ }).click()
  const picker = page.getByLabel('Upload files', { exact: true })
  await picker.setInputFiles(await scans('scan'))
  await expect(page.getByText('5 files uploaded.')).toBeVisible({ timeout: 120_000 })
  await expect.poll(() => bodies.length).toBe(2)
  for (const size of bodies) expect(size).toBeLessThan(100_000_000)
  const listed = object(await (await api.request.get(endpoint)).json()).data
  if (!Array.isArray(listed)) throw new Error('Expected client files')
  expect(listed).toHaveLength(5)

  // The same bytes twice in one batch, even in two packs, are sent once: the copy is dropped before anything is sent.
  const fresh = await scans('again')
  const copy = testInfo.outputPath('again-copy.txt')
  await copyFile(fresh[0] ?? '', copy)
  await picker.setInputFiles([...fresh, copy])
  await expect.poll(() => bodies.length, { timeout: 120_000 }).toBe(4)
  const again = object(await (await api.request.get(endpoint)).json()).data
  if (!Array.isArray(again)) throw new Error('Expected client files')
  expect(again).toHaveLength(10)

  // The API refuses one request over 95 MB, though every file is under 20 MB.
  const form = new FormData()
  const blobs = await Promise.all(
    fresh.map(async (file) => [new Blob([await readFile(file)]), basename(file)] as const),
  )
  for (const [blob, name] of blobs) form.append('files[]', blob, name)
  const refused = await api.request.post(endpoint, {
    headers: { 'X-CSRF-Token': api.csrf },
    multipart: form,
  })
  expect(refused.status()).toBe(413)
  expect(object(object(await refused.json()).error).code).toBe('payload_too_large')
})

test('same filename with different bytes remains a different document', async ({ api }) => {
  const upload = (buffer: Buffer) =>
    api.request.post('/api/v1/documents', {
      headers: { 'X-CSRF-Token': api.csrf },
      multipart: {
        file: { name: 'statement.txt', mimeType: 'text/plain', buffer },
        on_conflict: 'keep_both',
      },
    })
  expect((await upload(Buffer.from('First statement'))).status()).toBe(201)
  expect((await upload(Buffer.from('Second statement'))).status()).toBe(201)
})

test('workspace switches isolate records and refresh the browser session', async ({
  page,
  api,
}) => {
  const client = await api.client()
  const before = object(await (await api.request.get('/api/v1/session')).json())
  const firstWorkspace = text(object(before.workspace).id)
  const created = await api.write('/workspaces', {
    name: uniqueName('E2E Other'),
    timezone: 'Europe/Zurich',
  })
  await expect(created).toBeOK()
  api.csrf = text(object(await created.json()).csrf_token)
  await api.settings()
  await expect(await api.write('/session/onboarded')).toBeOK()
  expect((await api.request.get(`/api/v1/clients/${text(client.id)}`)).status()).toBe(404)
  await openPage(page, '/clients', 'Clients')
  await expect(page.getByText(text(client.name), { exact: true })).toHaveCount(0)
  const switched = await api.write('/session/workspace', { workspace_id: firstWorkspace })
  await expect(switched).toBeOK()
  api.csrf = text(object(await switched.json()).csrf_token)
  await page.reload()
  await expect(page.getByText(text(client.name), { exact: true }).first()).toBeVisible()
})

test('the sidebar switcher shows only the chosen workspace, without a reload', async ({
  page,
  api,
}) => {
  const client = await api.client()
  const first = object(object(await (await api.request.get('/api/v1/session')).json()).workspace)
  const otherName = uniqueName('E2E Switch')
  const created = await api.write('/workspaces', { name: otherName, timezone: 'Europe/Zurich' })
  await expect(created).toBeOK()
  api.csrf = text(object(await created.json()).csrf_token)
  await api.settings()
  await expect(await api.write('/session/onboarded')).toBeOK()
  const back = await api.write('/session/workspace', { workspace_id: text(first.id) })
  await expect(back).toBeOK()

  await openPage(page, '/clients', 'Clients')
  await expect(page.getByText(text(client.name), { exact: true }).first()).toBeVisible()
  const switcher = page.getByRole('button', { name: new RegExp(text(first.name)) }).first()
  await switcher.click()
  await page.getByRole('menuitem', { name: new RegExp(otherName) }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('button', { name: new RegExp(otherName) }).first()).toBeVisible()
  await page.getByRole('link', { name: 'Clients', exact: true }).first().click()
  await expect(page).toHaveURL(/\/clients/)
  await expect(page.getByText(text(client.name), { exact: true })).toHaveCount(0)

  // Switching while already on the dashboard must also replace the old workspace's figures.
  await page
    .getByRole('button', { name: new RegExp(otherName) })
    .first()
    .click()
  await page.getByRole('menuitem', { name: new RegExp(text(first.name)) }).click()
  await expect(
    page.getByRole('button', { name: new RegExp(text(first.name)) }).first(),
  ).toBeVisible()
  await page.getByRole('link', { name: 'Clients', exact: true }).first().click()
  await expect(page.getByText(text(client.name), { exact: true }).first()).toBeVisible()
})

test('forged CSRF and foreign-tenant identifiers never mutate data', async ({
  api,
  browser,
  baseURL,
}) => {
  const client = await api.client()
  const forged = await api.request.patch(`/api/v1/clients/${text(client.id)}`, {
    headers: { 'X-CSRF-Token': 'invalid-csrf' },
    data: { name: 'Corrupted' },
  })
  expect(forged.status()).toBe(403)
  const foreign = await browser.newContext({ baseURL })
  try {
    const other = await signIn(foreign.request, `e2e-${randomUUID()}@example.test`)
    expect((await other.request.get(`/api/v1/clients/${text(client.id)}`)).status()).toBe(404)
    expect(
      (await other.write(`/clients/${text(client.id)}`, { name: 'Corrupted' }, 'PATCH')).status(),
    ).toBe(404)
    expect((await api.read(`/clients/${text(client.id)}`)).name).toBe(client.name)
  } finally {
    await foreign.close()
  }
})
