import { join } from 'node:path'

import type { Page } from '@playwright/test'

import { expect, object, test, text, today, type FinancialAPI } from './fixtures'

// A course of 5 lessons at CHF 200, paid in full; the client took 2 and quit, so 3 (CHF 600) go back.

/** A screenshot of a key state, into HELVETLY_E2E_SHOTS when set (else the test's output folder). */
const shot = (page: Page, name: string) =>
  page.screenshot({
    path: process.env.HELVETLY_E2E_SHOTS
      ? join(process.env.HELVETLY_E2E_SHOTS, `instalment-refund-${name}.png`)
      : test.info().outputPath(`${name}.png`),
    fullPage: true,
  })

async function lessonsDraft(api: FinancialAPI, extra: Record<string, unknown> = {}) {
  await api.settings()
  const client = await api.client()
  const draft = await api.draft(client, {
    vat_mode: 'none',
    lines: [{ description: 'Lessons', quantity: '5', unit_price: '200' }],
    ...extra,
  })
  expect(draft.payable_total).toBe('1000.00')
  return text(draft.id)
}

async function recordPayment(page: Page, amount: string) {
  await page.getByRole('tab', { name: /Payments/ }).click()
  await page.getByRole('button', { name: 'Record payment' }).click()
  const dialog = page.getByRole('dialog', { name: 'Record a payment' })
  await dialog.getByLabel('Amount').fill(amount)
  await dialog.getByRole('button', { name: 'Record payment' }).click()
  await expect(dialog).toBeHidden()
}

async function creditNoteFromMenu(page: Page) {
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Create credit note' }).click()
  await page
    .getByRole('dialog', { name: /^Credit / })
    .getByRole('button', { name: 'Create credit note' })
    .click()
}

/** The amount the invoice summary shows under a label (Paid, Credited, Refunded, …). */
const summary = (page: Page, label: string) =>
  page
    .getByRole('dialog')
    .locator('dt', { hasText: new RegExp(`^${label}$`) })
    .locator('+ dd')

async function refundDueList(page: Page, number: string, listed: boolean) {
  await page.goto('/invoices')
  await page.getByRole('button', { name: /Filters/ }).click()
  await page.getByRole('checkbox', { name: 'Refund due' }).click()
  await page.keyboard.press('Escape')
  const row = page.getByRole('row', { name: new RegExp(number) })
  if (listed) await expect(row).toBeVisible()
  else await expect(row).toHaveCount(0)
}

/** Runs step on each item in turn: browser steps must not overlap. */
async function inTurn<T>(items: T[], step: (item: T) => Promise<void>): Promise<void> {
  const [first, ...rest] = items
  if (first === undefined) return
  await step(first)
  await inTurn(rest, step)
}

const instalments = (invoice: Record<string, unknown>) => {
  const items = object(invoice.instalments).items
  if (!Array.isArray(items)) throw new Error('Expected instalments')
  return items.map((item) => {
    const { effective, paid, open, status } = object(item)
    return { effective, paid, open, status }
  })
}

test('instalment schedule: a CHF 600 credit after full payment is refunded and settles it', async ({
  page,
  api,
}) => {
  const id = await lessonsDraft(api)
  const path = `/invoices/${id}`

  await page.goto(`/invoices?compose=${id}`)
  await page.getByRole('switch', { name: 'Pay in instalments' }).click()
  await page.getByLabel('Number of instalments').fill('5')
  const amounts = page.getByRole('textbox', { name: /^Instalment \d amount$/ })
  await expect(amounts).toHaveCount(5)
  expect(await Promise.all((await amounts.all()).map((amount) => amount.inputValue()))).toEqual(
    Array(5).fill('200.00'),
  )
  await page
    .getByRole('button', { name: /^Issue/ })
    .first()
    .click()
  await page
    .getByRole('dialog', { name: 'Issue this invoice?' })
    .getByRole('button', { name: 'Issue invoice' })
    .click()
  await expect.poll(async () => (await api.read(path)).status).toBe('open')
  const number = text((await api.read(path)).number)
  await expect(page.getByRole('dialog').getByText(number, { exact: true })).toBeVisible()

  await inTurn(Array(5).fill('200'), (amount) => recordPayment(page, amount))
  await expect.poll(async () => (await api.read(path)).amount_paid).toBe('1000.00')
  expect((await api.read(path)).status).toBe('paid')
  await shot(page, 'a1-paid')

  await creditNoteFromMenu(page)
  // The draft credits all 5 lessons; 2 were taken, so 3 are credited.
  await page.getByLabel('Line 1 quantity').fill('3')
  await page
    .getByRole('button', { name: /^Issue/ })
    .first()
    .click()
  const confirm = page.getByRole('dialog', { name: 'Issue this credit note?' })
  await expect(confirm).toContainText('they will be owed CHF 600.00 back')
  await shot(page, 'a2-credit-confirm')
  await confirm.getByRole('button', { name: 'Issue credit note' }).click()
  await expect.poll(async () => (await api.read(path)).refund_due).toBe('600.00')
  const credited = await api.read(path)
  expect(credited).toMatchObject({
    status: 'paid',
    amount_paid: '1000.00',
    amount_credited: '600.00',
    amount_due: '0.00',
    amount_refunded: '0.00',
  })
  // the credit comes off the last instalments first
  const paid = { effective: '200.00', paid: '200.00', open: '0.00', status: 'paid' }
  const creditedAway = { effective: '0.00', paid: '0.00', open: '0.00', status: 'credited' }
  expect(instalments(credited)).toEqual([paid, paid, creditedAway, creditedAway, creditedAway])

  await refundDueList(page, number, true)
  await shot(page, 'a3-refund-due-filter')
  await page
    .getByRole('row', { name: new RegExp(number) })
    .getByText(number)
    .click()
  await expect(page.getByText('Refund due CHF 600.00')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Instalments' }).getByRole('row')).toContainText([
    /^1.*CHF 200\.00.*Paid$/,
    /^2.*CHF 200\.00.*Paid$/,
    /^3.*CHF 0\.00CHF 200\.00 credited.*Credited$/,
    /^4.*CHF 0\.00CHF 200\.00 credited.*Credited$/,
    /^5.*CHF 0\.00CHF 200\.00 credited.*Credited$/,
  ])
  await shot(page, 'a4-refund-due')

  await page.getByRole('button', { name: 'Record refund' }).click()
  const refund = page.getByRole('dialog', { name: 'Record a refund' })
  await expect(refund.getByLabel('Amount')).toHaveValue('600.00')
  await refund.getByRole('button', { name: 'Record refund' }).click()
  await expect(refund).toBeHidden()
  await expect(page.getByText('Refund due CHF 600.00')).toBeHidden()
  // Every movement under its own name, with the net: never "Paid · credited CHF 1'000.00 · 600.00".
  await expect(summary(page, 'Paid')).toHaveText('CHF 1’000.00')
  await expect(summary(page, 'Credited')).toHaveText('CHF 600.00')
  await expect(summary(page, 'Refunded')).toHaveText('CHF 600.00')
  await expect(page.getByText('Net CHF 400.00')).toBeVisible()
  await expect(page.getByText(/Paid · credited/)).toHaveCount(0)
  const settled = await api.read(path)
  expect(settled).toMatchObject({ status: 'paid', refund_due: '0.00', amount_refunded: '600.00' })
  expect(instalments(settled)).toEqual([paid, paid, creditedAway, creditedAway, creditedAway])
  await page.getByRole('tab', { name: /Payments/ }).click()
  await expect(page.getByText('Refund · Bank transfer')).toBeVisible()
  await shot(page, 'a5-refunded')
  await refundDueList(page, number, false)
})

test('instalment plan: partials 3 to 5 credited in full are refunded, 1 and 2 stay paid', async ({
  page,
  api,
}) => {
  const id = await lessonsDraft(api, { due_date: today() })

  await page.goto(`/invoices?compose=${id}`)
  await page.getByRole('button', { name: 'Split into instalment invoices' }).click()
  const dialog = page.getByRole('dialog', { name: 'Split into instalment invoices' })
  await dialog.getByRole('textbox', { name: 'Instalments' }).fill('5')
  await dialog.getByRole('combobox', { name: 'Every' }).selectOption('weekly')
  // due weekly from today and each issued up to 60 days before: all five are due for issue now
  await dialog.getByRole('textbox', { name: 'Issue days before due' }).fill('60')
  await dialog.getByRole('switch', { name: 'Send automatically' }).click()
  await dialog.getByRole('button', { name: 'Create plan' }).click()
  await expect(dialog).toBeHidden()

  // Issued at once by the job the new plan wakes, not at its next hourly run; the card shows them
  // without a reload.
  const card = page.getByRole('region', { name: 'Instalment plan' })
  await expect(card.getByRole('link')).toHaveCount(5, { timeout: 15_000 })
  await shot(page, 'b1-plan-issued')
  const plan = await api.read(
    `/instalment-plans/${text(object((await api.read(`/invoices/${id}`)).plan).id)}`,
  )
  const items = Array.isArray(plan.items) ? plan.items.map(object) : []
  expect(items.map((item) => item.status)).toEqual(Array(5).fill('issued'))
  const partials = items.map((item) => ({ id: text(item.invoice_id), number: text(item.number) }))

  expect(
    await card
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href'))),
  ).toEqual(partials.map((partial) => `/invoices?id=${partial.id}`))
  // A partial's link shows it in the same drawer, not one stacked on top; Back returns to the source.
  const source = page.url()
  await card.getByRole('link').first().click()
  await expect(page).toHaveURL(new RegExp(`[?&]id=${partials[0]?.id}`))
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(
    page.getByRole('dialog').getByText(partials[0]?.number ?? '', { exact: true }),
  ).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(source)
  await expect(card.getByRole('link')).toHaveCount(5)
  await expect(page.getByRole('dialog')).toHaveCount(1)

  // each partial's own page, where its link on the plan card leads
  const open = async (partial: { id: string; number: string }) => {
    await page.goto(`/invoices?id=${partial.id}`)
    await expect(page.getByRole('tab', { name: /Payments/ })).toBeVisible()
  }
  const read = (partial: { id: string }) => api.read(`/invoices/${partial.id}`)
  for (const partial of await Promise.all(partials.map(read)))
    expect(partial.payable_total).toBe('200.00')
  await inTurn(partials, async (partial) => {
    await open(partial)
    await recordPayment(page, '200')
    await expect.poll(async () => (await read(partial)).status).toBe('paid')
  })

  const lessonsNotTaken = partials
    .slice(2)
    .map((partial, index) => ({ ...partial, refundNow: index === 0 }))
  await inTurn(lessonsNotTaken, async (partial) => {
    await open(partial)
    await creditNoteFromMenu(page)
    await page
      .getByRole('button', { name: /^Issue/ })
      .first()
      .click()
    const confirm = page.getByRole('dialog', { name: 'Issue this credit note?' })
    await expect(confirm).toContainText('they will be owed CHF 200.00 back')
    if (partial.refundNow) {
      // one step: issued, then the credited partial opens with its refund dialog
      await confirm.getByRole('button', { name: 'Issue and record refund now' }).click()
    } else {
      await confirm.getByRole('button', { name: 'Issue credit note' }).click()
      await expect.poll(async () => (await read(partial)).refund_due).toBe('200.00')
      await open(partial)
      await expect(page.getByText('Refund due CHF 200.00')).toBeVisible()
      await page.getByRole('button', { name: 'Record refund' }).click()
    }
    const refund = page.getByRole('dialog', { name: 'Record a refund' })
    await expect(refund.getByLabel('Amount')).toHaveValue('200.00')
    await refund.getByRole('button', { name: 'Record refund' }).click()
    await expect(refund).toBeHidden()
    await expect(page.getByText(/^Refund due/)).toBeHidden()
  })
  await page.getByRole('tab', { name: /Payments/ }).click()
  await expect(page.getByText('Refund · Bank transfer')).toBeVisible()
  await shot(page, 'b2-partial-refunded')

  const after = await Promise.all(partials.map(read))
  for (const [index, partial] of after.entries()) {
    const refunded = index >= 2
    // credited in full, a partial is void (store.RefreshBalance), its payment refunded
    expect(partial, text(partial.number)).toMatchObject({
      status: refunded ? 'void' : 'paid',
      amount_paid: '200.00',
      amount_credited: refunded ? '200.00' : '0.00',
      amount_refunded: refunded ? '200.00' : '0.00',
      amount_due: '0.00',
      refund_due: '0.00',
    })
  }
  // void in the data, but paid before it was credited: it reads "Credited", never "Void"
  await open(partials[2] ?? { id: '', number: '' })
  await expect(summary(page, 'Refunded')).toHaveText('CHF 200.00')
  await expect(page.getByRole('dialog').getByText('Void', { exact: true })).toHaveCount(0)
  await expect(
    page.getByRole('dialog').getByText('Credited', { exact: true }).first(),
  ).toBeVisible()
  await shot(page, 'b3-credited-badge')
  await refundDueList(page, partials[2]?.number ?? '', false)
})
