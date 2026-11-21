import type { Page } from '@playwright/test'

import { expect, object, test, text, today, uniqueName, type FinancialAPI } from './fixtures'

/** React's warnings about doubled children: two drawers for one record. */
function watchKeyWarnings(page: Page) {
  const warnings: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' && /same key|unique "key"/.test(message.text()))
      warnings.push(message.text())
  })
  return warnings
}

/**
 * Clicking a row twice in a row opens exactly one drawer, at once, and Esc closes it with the
 * address cleared; the page under it stays.
 */
async function opensOnce(page: Page, path: string, row: string, title: RegExp, cell = row) {
  const warnings = watchKeyWarnings(page)
  await page.goto(path)
  // A plain cell of the row: some names open a card of their own instead.
  const target = page.getByText(cell).first()
  await expect(target).toBeVisible()
  // The file manager opens on dblclick; two explicit single clicks do not send that event.
  if (path === '/documents') await target.dblclick()
  else {
    await target.click()
    await target.click({ force: true, noWaitAfter: true }).catch(() => {})
  }
  const dialog = page.locator('[data-slot=sheet-content]')
  await expect(dialog).toHaveCount(1, { timeout: 1000 })
  await expect(dialog.getByText(title).first()).toBeVisible()
  // Still one once everything it loads has arrived.
  await page.waitForLoadState('networkidle')
  await expect(dialog).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('[data-slot=exit-ghost]')).toHaveCount(0)
  await expect(target).toBeVisible()
  expect(warnings).toEqual([])
}

async function category(api: FinancialAPI) {
  const list = object(await (await api.request.get('/api/v1/expense-categories')).json()).data
  if (!Array.isArray(list) || !list.length) throw new Error('Expected seeded categories')
  return text(object(list[0]).id)
}

test('each record kind opens one drawer per record, at once, and Esc closes it', async ({
  page,
  api,
}) => {
  await api.settings()
  const client = await api.client()
  const name = text(client.name)
  await opensOnce(page, '/clients', name, new RegExp(name), 'Person')

  const invoice = await api.draft(client)
  await opensOnce(page, '/invoices', name, /Draft/)
  expect(invoice.id).toBeTruthy()

  await api.save('/quotes', {
    client_id: client.id,
    lines: [
      {
        description: 'Website relaunch',
        quantity: '2',
        unit_price: '150',
        vat_category: 'S',
        vat_rate: '8.1',
      },
    ],
  })
  await opensOnce(page, '/quotes', name, /Website relaunch/)

  const supplier = uniqueName('Drawer Supplier')
  await api.save('/expenses', {
    supplier_name: supplier,
    supplier_country: 'CH',
    document_date: today(),
    category_id: await category(api),
    lines: [{ amount: '10', vat_rate: '0' }],
    input_tax: 'none',
  })
  await opensOnce(page, '/expenses', supplier, new RegExp(supplier))

  const engagement = uniqueName('Drawer Retainer')
  await api.save('/engagements', {
    client_id: text(client.id),
    title: engagement,
    quantity: '10',
    unit: 'hour',
    billing: 'arrears',
    unit_price: '100',
    price_basis: 'net',
    currency: 'CHF',
    vat_category: 'S',
    vat_rate: '8.1',
    start_date: today(),
    recurrence: 'monthly',
  })
  await opensOnce(page, '/engagements', engagement, new RegExp(engagement))

  const file = `${uniqueName('drawer').replace(' ', '-')}.pdf`
  const upload = await api.request.post('/api/v1/documents', {
    headers: { 'X-CSRF-Token': api.csrf },
    multipart: {
      file: {
        name: file,
        mimeType: 'application/pdf',
        buffer: Buffer.from(`%PDF-1.7\n${file}\n%%EOF\n`),
      },
    },
  })
  expect(upload.status()).toBe(201)
  await opensOnce(page, '/documents', file, new RegExp(file.replace('.', '\\.')))
})

test('editing an expense from its drawer keeps one drawer on screen', async ({ page, api }) => {
  const warnings = watchKeyWarnings(page)
  await api.settings()
  const supplier = uniqueName('Edit Supplier')
  const expense = await api.save('/expenses', {
    supplier_name: supplier,
    supplier_country: 'CH',
    document_date: today(),
    category_id: await category(api),
    lines: [{ amount: '10', vat_rate: '0' }],
    input_tax: 'none',
  })
  await page.goto(`/expenses?id=${text(expense.id)}`)
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(supplier).first()).toBeVisible()
  await dialog.getByRole('button', { name: /^Edit/ }).first().click()
  await expect(dialog).toHaveCount(1)
  await expect(dialog.getByRole('textbox').first()).toBeVisible()
  await page.waitForLoadState('networkidle')
  await expect(dialog).toHaveCount(1)
  expect(warnings).toEqual([])
})

test('the new-quote drawer closes on Esc', async ({ page, api }) => {
  await api.settings()
  await page.goto('/quotes?new=1')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(page).not.toHaveURL(/new=1/)
})

test('a client opens and closes from the keyboard alone, and focus returns to its row', async ({
  page,
  api,
}) => {
  const client = await api.client()
  const name = text(client.name)
  await page.goto('/clients')
  const trigger = page.getByRole('button', { name: new RegExp(name) }).first()
  await expect(trigger).toBeVisible()
  // Tab from the top of the page, as a keyboard user would, until the client's name has focus.
  await page.locator('body').focus()
  await expect
    .poll(
      async () => {
        await page.keyboard.press('Tab')
        return trigger.evaluate((element) => element === document.activeElement)
      },
      { intervals: [0] },
    )
    .toBe(true)
  await expect(trigger).toBeFocused()
  await page.keyboard.press('Enter')
  const drawer = page.locator('[data-slot=sheet-content]')
  await expect(drawer).toHaveCount(1)
  await expect
    .poll(() => drawer.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true)
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  await expect(trigger).toBeFocused()
})
