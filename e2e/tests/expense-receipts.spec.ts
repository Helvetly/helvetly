import { randomUUID } from 'node:crypto'

import { expect, object, openPage, test, text, today, uniqueName } from './fixtures'

const receiptFile = (name: string) => ({
  name,
  mimeType: 'application/pdf',
  buffer: Buffer.from(`%PDF-1.7\nE2E receipt ${randomUUID()}\n%%EOF\n`),
})

test('a receipt uploaded in the drawer makes the expense ready to book; deleting it makes it incomplete again', async ({
  page,
  api,
}) => {
  await api.settings()
  const categories = object(await (await api.request.get('/api/v1/expense-categories')).json()).data
  if (!Array.isArray(categories) || !categories.length) throw new Error('Expected categories')
  const supplier = uniqueName('Receipt Supplier')
  const expense = await api.save('/expenses', {
    supplier_name: supplier,
    document_date: today(),
    category_id: text(object(categories[0]).id),
    lines: [{ amount: '42.00', vat_rate: '8.1' }],
    input_tax: 'full',
  })
  await openPage(page, `/expenses?id=${text(expense.id)}`, 'Expenses')
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByText('Incomplete', { exact: true })).toBeVisible()
  await expect(drawer.getByRole('button', { name: 'Book', exact: true })).toBeDisabled()

  await drawer.getByLabel('Upload receipts').setInputFiles(receiptFile('lunch.pdf'))
  await expect(drawer.getByText('Ready to book', { exact: true })).toBeVisible()
  await expect(drawer.getByText('Not ready to book')).toHaveCount(0)
  await expect(drawer.getByRole('button', { name: 'Book', exact: true })).toBeEnabled()
  const read = object(
    object(await (await api.request.get(`/api/v1/expenses/${text(expense.id)}`)).json()).data,
  )
  expect(read.is_complete).toBe(true)
  expect(read.receipts_count).toBe(1)

  // Another receipt keeps it ready; deleting both brings the receipt back as missing.
  await drawer.getByLabel('Add another receipt').setInputFiles(receiptFile('lunch-2.pdf'))
  await expect(drawer.getByRole('list', { name: 'All receipts' }).getByRole('button')).toHaveCount(
    2,
  )
  const deleteReceipt = async (name: string) => {
    await drawer.getByRole('button', { name: `Show ${name}` }).click()
    await drawer.getByRole('button', { name: `Delete ${name}` }).click()
    await page.getByRole('button', { name: 'Delete receipt' }).click()
    await expect(drawer.getByRole('button', { name: `Delete ${name}` })).toHaveCount(0)
  }
  await deleteReceipt('lunch-2.pdf')
  await expect(drawer.getByText('Ready to book', { exact: true })).toBeVisible()
  await deleteReceipt('lunch.pdf')
  await expect(drawer.getByText('Incomplete', { exact: true })).toBeVisible()
  await expect(drawer.getByRole('list', { name: 'Missing:' }).getByRole('button')).toHaveText(
    'Receipt',
  )
  await expect(drawer.getByRole('button', { name: 'Book', exact: true })).toBeDisabled()
})

test('a receipt picked in the new-expense form counts as soon as the drawer opens', async ({
  page,
  api,
}) => {
  await api.settings()
  const supplier = uniqueName('Form Receipt')
  await openPage(page, '/expenses?new=1', 'Expenses')
  const form = page.getByRole('dialog')
  // The receipt comes first; E2E's Heidi usage says no AI model, so Continue opens the form with it staged.
  await form.getByLabel('Upload receipts').setInputFiles(receiptFile('form-receipt.pdf'))
  await form.getByRole('button', { name: 'Continue' }).click()
  await form.getByRole('textbox', { name: 'Supplier', exact: true }).fill(supplier)
  await form.getByRole('button', { name: 'Save draft' }).click()

  const drawer = page.getByRole('dialog')
  await expect(drawer.getByRole('heading', { name: supplier })).toBeVisible()
  await expect(drawer.getByText('form-receipt.pdf')).toBeVisible()
  // The bug: the drawer opened on the first save's answer and still asked for the receipt.
  const missing = drawer.getByRole('list', { name: 'Missing:' })
  await expect(missing).toBeVisible()
  await expect(missing.getByRole('button', { name: 'Receipt' })).toHaveCount(0)
})

type Folder = { id: string; name: string; parent_id: string | null; system_kind: string | null }

test('a receipt is filed in Expenses/<year>/<category> and follows the draft’s category', async ({
  page,
  api,
}) => {
  await api.settings()
  const categories = object(await (await api.request.get('/api/v1/expense-categories')).json()).data
  if (!Array.isArray(categories) || categories.length < 2) throw new Error('Expected categories')
  const first = object(categories[0])
  const second = object(categories[1])
  const expense = await api.save('/expenses', {
    supplier_name: uniqueName('Folder Supplier'),
    document_date: today(),
    category_id: text(first.id),
    lines: [{ amount: '12.00', vat_rate: '8.1' }],
  })
  const file = `folder-${randomUUID().slice(0, 8)}.pdf`
  await openPage(page, `/expenses?id=${text(expense.id)}`, 'Expenses')
  // The name shows as a pending row before the upload is stored: wait for the upload itself.
  const uploaded = page.waitForResponse(
    (r) =>
      r.request().method() === 'POST' && r.url().endsWith(`/expenses/${text(expense.id)}/receipts`),
  )
  await page.getByRole('dialog').getByLabel('Upload receipts').setInputFiles(receiptFile(file))
  expect((await uploaded).status()).toBe(201)
  await expect(page.getByRole('dialog').getByText(file)).toBeVisible()

  const year = today().slice(0, 4)
  const placeOf = async (language = 'en') => {
    const response = await api.request.get('/api/v1/documents/folders', {
      headers: { 'Accept-Language': language },
    })
    const all = object(await response.json()).data as Folder[]
    const docs = object(await (await api.request.get(`/api/v1/documents?search=${file}`)).json())
      .data as { folder_id: string | null }[]
    const path: Folder[] = []
    for (let id = docs[0]?.folder_id ?? null; id;) {
      const folder = all.find((f) => f.id === id)
      if (!folder) break
      path.unshift(folder)
      id = folder.parent_id
    }
    return path
  }
  let path = await placeOf()
  expect(path.map((f) => f.name)).toEqual(['Expenses', year, text(first.name)])
  expect(path.map((f) => f.system_kind)).toEqual(['expenses', 'year', 'expense_category'])

  await api.save(`/expenses/${text(expense.id)}`, { category_id: text(second.id) }, 'PATCH')
  path = await placeOf()
  expect(path.map((f) => f.name)).toEqual(['Expenses', year, text(second.name)])

  await api.save(`/expenses/${text(expense.id)}`, { category_id: null }, 'PATCH')
  expect((await placeOf('de')).map((f) => f.name)).toEqual(['Ausgaben', year, 'Ohne Kategorie'])

  const category = path[2]
  const renamed = await api.write(`/documents/folders/${category?.id}`, { name: 'Mine' }, 'PATCH')
  expect(renamed.status()).toBe(409)
})
