import type { Page } from '@playwright/test'

import { expect, join, object, test, text, today, type FinancialAPI } from './fixtures'

// Approval before a quote is sent and before an expense is booked, on the real API and screens: the author submits,
// cannot approve their own draft, another member approves in their own session, then sending or booking succeeds.
// Billing is off in E2E, so every plan feature (document_approvals included) is allowed.

type Doc = 'quotes' | 'expenses'

/** The policy for one document type: one approval from a group holding only this person. */
async function requireApproval(owner: FinancialAPI, docType: 'quote' | 'expense', member: string) {
  const response = await owner.write('/approvals/groups', {
    name: 'Management',
    member_ids: [member],
  })
  expect(response.status()).toBe(201)
  const groupId = text(object(object(await response.json()).data).id)
  await owner.save(
    `/approvals/policies/${docType}`,
    { enabled: true, min_total: null, rules: [{ group_id: groupId, min: 1 }] },
    'PUT',
  )
}

const approval = (api: FinancialAPI, doc: Doc, id: string) => api.read(`/${doc}/${id}/approval`)

/** The author's own approval is refused: no button in the drawer, 403 from the API. */
async function authorCannotApprove(
  api: FinancialAPI,
  drawer: ReturnType<Page['getByRole']>,
  doc: Doc,
  id: string,
) {
  await expect(drawer.getByRole('button', { name: 'Approve' })).toHaveCount(0)
  const request_id = (await approval(api, doc, id)).request_id
  const own = await api.write(`/${doc}/${id}/approval/approve`, { request_id })
  expect(own.status()).toBe(403)
  expect(object(object(await own.json()).error).code).toBe('approval_not_allowed')
}

async function openDrawer(page: Page, doc: Doc, id: string) {
  await page.goto(`/${doc}?id=${id}`)
  const drawer = page.getByRole('dialog')
  await expect(drawer).toBeVisible()
  return drawer
}

test('a quote is sent only after another member approved it', async ({
  api,
  page,
  browser,
  baseURL,
}) => {
  const maria = await join(api, browser, baseURL, 'Maria Manager')
  try {
    await api.settings()
    await requireApproval(api, 'quote', maria.id)
    const client = await api.client()
    const quote = await api.save('/quotes', {
      client_id: client.id,
      lines: [
        {
          description: 'Consulting',
          quantity: '2',
          unit: 'hour',
          unit_price: '900',
          vat_category: 'S',
          vat_rate: '8.1',
        },
      ],
    })
    const id = text(quote.id)

    // The author submits from the drawer: Submit takes Send's place, and Send waits.
    let drawer = await openDrawer(page, 'quotes', id)
    await drawer.getByRole('button', { name: 'Submit for approval' }).click()
    await expect(drawer.getByText('Pending approval').first()).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'Send', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await authorCannotApprove(api, drawer, 'quotes', id)
    const early = await api.write(`/quotes/${id}/send`, { email: false })
    expect(early.status()).toBe(409)
    expect(object(object(await early.json()).error).code).toBe('approval_required')

    // Maria finds it in "Needs my approval" and approves in her drawer.
    await maria.page.goto('/quotes')
    const band = maria.page.getByRole('region', { name: 'Needs my approval' })
    await band.getByRole('button', { name: new RegExp(text(object(quote.client).name)) }).click()
    const panel = maria.page.getByRole('dialog').getByRole('region', { name: 'Approval' })
    await panel.getByRole('button', { name: 'Approve' }).click()
    await expect(panel.getByText('Maria Manager approved')).toBeVisible()
    expect((await approval(api, 'quotes', id)).state).toBe('approved')

    // Approved: the author sends it (marked as sent, no email) and it gets its number.
    drawer = await openDrawer(page, 'quotes', id)
    await drawer.getByRole('button', { name: 'Send', exact: true }).click()
    await page
      .getByRole('dialog', { name: 'Send quote' })
      .getByRole('button', { name: 'Mark as sent' })
      .click()
    await expect.poll(async () => (await api.read(`/quotes/${id}`)).status).toBe('sent')
    const sent = await api.read(`/quotes/${id}`)
    expect(sent.number).toEqual(expect.any(String))
    expect(sent.approval_state).toBe('approved')
  } finally {
    await maria.context.close()
  }
})

test('an expense is booked only after another member approved it', async ({
  api,
  page,
  browser,
  baseURL,
}) => {
  const maria = await join(api, browser, baseURL, 'Maria Manager')
  try {
    await api.settings()
    await requireApproval(api, 'expense', maria.id)
    const categories = object(
      await (await api.request.get('/api/v1/expense-categories')).json(),
    ).data
    if (!Array.isArray(categories) || !categories.length)
      throw new Error('Expected seeded categories')
    const supplier = `Approval Supplier ${Date.now()}`
    const expense = await api.save('/expenses', {
      supplier_name: supplier,
      supplier_country: 'CH',
      document_date: today(),
      category_id: text(object(categories[0]).id),
      receipt_missing_reason: 'E2E substitute voucher; no real transaction',
      lines: [{ amount: '108.10', vat_rate: '8.1' }],
      input_tax: 'full',
    })
    const id = text(expense.id)

    let drawer = await openDrawer(page, 'expenses', id)
    await drawer.getByRole('button', { name: 'Submit for approval' }).click()
    await expect(drawer.getByText('Pending approval').first()).toBeVisible()
    await expect(drawer.getByRole('button', { name: 'Book', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    await authorCannotApprove(api, drawer, 'expenses', id)
    const early = await api.write(`/expenses/${id}/book`)
    expect(early.status()).toBe(409)
    expect(object(object(await early.json()).error).code).toBe('approval_required')

    await maria.page.goto('/expenses')
    const band = maria.page.getByRole('region', { name: 'Needs my approval' })
    await band.getByRole('button', { name: new RegExp(supplier) }).click()
    const panel = maria.page.getByRole('dialog').getByRole('region', { name: 'Approval' })
    await panel.getByRole('button', { name: 'Approve' }).click()
    await expect(panel.getByText('Maria Manager approved')).toBeVisible()

    drawer = await openDrawer(page, 'expenses', id)
    await drawer.getByRole('button', { name: 'Book', exact: true }).click()
    await expect.poll(async () => (await api.read(`/expenses/${id}`)).status).toBe('booked')
    expect((await api.read(`/expenses/${id}`)).approval_state).toBe('approved')
  } finally {
    await maria.context.close()
  }
})
