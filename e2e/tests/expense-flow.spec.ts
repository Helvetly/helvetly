import type { Page } from '@playwright/test'

import { expect, join, object, openPage, test, text, today, type FinancialAPI } from './fixtures'

// The receipt-first new expense and reading a draft's receipt again, on the real API with the development model
// (HELVETLY_E2E_FAKE_AI): it reads every receipt as Development Supplier AG, DEV-1, CHF 108.10 at 8.1 %, in the first
// listed category. Billing is off in E2E, so the AI import and approvals are allowed.

/** A 1×1 PNG: enough for the server's image check; the development model does not look at the pixels. */
const png = (name: string) => ({
  name,
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
})

/**
 * E2E fakes only the import model, so Heidi's usage says no provider and the platform would switch reading off;
 * only that flag is changed, the reading itself is the server's.
 */
async function withAIModel(page: Page) {
  await page.route('**/api/v1/heidi/usage', async (route) => {
    const response = await route.fetch()
    await route.fulfill({
      response,
      json: { ...object(await response.json()), provider_available: true },
    })
  })
}

/** The expense policy: one approval from a group holding only this person. */
async function requireApproval(owner: FinancialAPI, member: string) {
  const response = await owner.write('/approvals/groups', {
    name: 'Management',
    member_ids: [member],
  })
  expect(response.status()).toBe(201)
  const groupId = text(object(object(await response.json()).data).id)
  await owner.save(
    '/approvals/policies/expense',
    { enabled: true, min_total: null, rules: [{ group_id: groupId, min: 1 }] },
    'PUT',
  )
}

/** A decision names the open request, read in the deciding person's own session. */
async function decide(api: FinancialAPI, id: string, action: 'approve' | 'reject', comment = '') {
  const { request_id } = await api.read(`/expenses/${id}/approval`)
  const response = await api.write(`/expenses/${id}/approval/${action}`, {
    request_id,
    ...(comment ? { comment } : {}),
  })
  await expect(response).toBeOK()
}

test('a new expense starts with its receipt, is filled in by the AI and booked', async ({
  page,
  api,
}) => {
  await api.settings()
  await api.approveAI()
  await withAIModel(page)
  await openPage(page, '/expenses?new=1', 'Expenses')
  const sheet = page.getByRole('dialog')
  await expect(sheet.getByRole('switch', { name: /Read with AI/ })).toBeChecked()
  await expect(sheet.getByRole('button', { name: 'Continue' })).toBeDisabled()
  await sheet.getByLabel('Upload receipts').setInputFiles(png('dev-receipt.png'))
  const read = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/expenses/receipt-preview'),
  )
  await sheet.getByRole('button', { name: 'Continue' }).click()
  expect((await read).status()).toBe(200)

  // The same sheet now holds the filled form, the file still staged.
  await expect(sheet.getByRole('textbox', { name: 'Supplier', exact: true })).toHaveValue(
    'Development Supplier AG',
  )
  await expect(sheet.getByRole('textbox', { name: 'Line 1 amount' })).toHaveValue('108.10')
  await expect(sheet.getByText('dev-receipt.png')).toBeVisible()
  await sheet.getByRole('button', { name: 'Save and book' }).click()

  const drawer = page.getByRole('dialog')
  await expect(drawer.getByRole('heading', { name: 'Development Supplier AG' })).toBeVisible()
  await expect(page).toHaveURL(/[?&]id=/)
  const id = new URL(page.url()).searchParams.get('id') ?? ''
  await expect.poll(async () => (await api.read(`/expenses/${id}`)).status).toBe('booked')
  const booked = await api.read(`/expenses/${id}`)
  expect(booked).toMatchObject({ total: '108.10', reference: 'DEV-1', receipts_count: 1 })
  // Booked figures are records: nothing offers to read the receipt again.
  await expect(drawer.getByRole('button', { name: 'Read again with AI' })).toHaveCount(0)
})

test('after a rejection the receipt is read again, the chosen values applied and the draft approved and booked', async ({
  page,
  api,
  browser,
  baseURL,
}) => {
  const maria = await join(api, browser, baseURL, 'Maria Manager')
  try {
    await api.settings()
    await api.approveAI()
    await requireApproval(api, maria.id)
    const categories = object(
      await (await api.request.get('/api/v1/expense-categories')).json(),
    ).data
    if (!Array.isArray(categories) || !categories.length)
      throw new Error('Expected seeded categories')
    const expense = await api.save('/expenses', {
      supplier_name: 'Dev Supplier',
      supplier_country: 'CH',
      document_date: today(),
      category_id: text(object(categories[0]).id),
      lines: [{ amount: '108.10', vat_rate: '8.1' }],
      input_tax: 'full',
    })
    const id = text(expense.id)

    await withAIModel(page)
    await openPage(page, `/expenses?id=${id}`, 'Expenses')
    const drawer = page.getByRole('dialog')
    const uploaded = page.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith(`/expenses/${id}/receipts`),
    )
    await drawer.getByLabel('Upload receipts').setInputFiles(png('dev-receipt.png'))
    expect((await uploaded).status()).toBe(201)

    await expect(await api.write(`/expenses/${id}/approval`, {})).toBeOK()
    await decide(maria.api, id, 'reject', 'The supplier name is not the one on the receipt.')
    await expect
      .poll(async () => (await api.read(`/expenses/${id}`)).approval_state)
      .toBe('rejected')

    await page.reload()
    await drawer.getByRole('button', { name: 'Read again with AI' }).click()
    const differences = drawer.getByRole('list', { name: 'Differences' })
    await expect(differences).toBeVisible()
    const row = (field: RegExp) =>
      differences.getByRole('listitem').filter({ hasText: field }).getByRole('checkbox')
    // An empty field is ticked; a value that differs waits for the person.
    await expect(row(/^Invoice \/ receipt no\./)).toBeChecked()
    await expect(row(/^Supplier(?! country)/)).not.toBeChecked()
    await row(/^Supplier(?! country)/).check()
    await expect
      .poll(async () => (await api.read(`/expenses/${id}`)).supplier_name)
      .toBe('Dev Supplier')
    await drawer.getByRole('button', { name: /^Apply \d+ changes?$/ }).click()

    await expect
      .poll(async () => (await api.read(`/expenses/${id}`)).supplier_name)
      .toBe('Development Supplier AG')
    const applied = await api.read(`/expenses/${id}`)
    expect(applied.reference).toBe('DEV-1')
    // The date read differs from the draft's and was not ticked: it stays.
    expect(applied.document_date).toBe(today())
    await expect(drawer.getByRole('heading', { name: 'Development Supplier AG' })).toBeVisible()

    await drawer.getByRole('button', { name: 'Submit for approval' }).click()
    await expect(drawer.getByText('Pending approval').first()).toBeVisible()
    await decide(maria.api, id, 'approve')
    await page.reload()
    await drawer.getByRole('button', { name: 'Book', exact: true }).click()
    await expect.poll(async () => (await api.read(`/expenses/${id}`)).status).toBe('booked')
  } finally {
    await maria.context.close()
  }
})
