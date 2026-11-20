import type { Page } from '@playwright/test'

import { expect, test, text } from './fixtures'

/** The draft the editor opened, read back from the API by the id in the URL. */
async function composed(page: Page, read: (path: string) => Promise<Record<string, unknown>>) {
  await expect(page).toHaveURL(/compose=/)
  const id = new URL(page.url()).searchParams.get('compose')
  return read(`/invoices/${text(id)}`)
}

/** Opens the New invoice menu's `item` and returns its picker. */
async function pickerOf(page: Page, item: RegExp, title: string) {
  await page.getByRole('button', { name: 'New invoice options' }).click()
  await page.getByRole('menuitem', { name: item }).click()
  return page.getByRole('dialog', { name: title })
}

test('credit and debit notes start from the New invoice menu by picking the issued invoice', async ({
  api,
  page,
}) => {
  await api.settings()
  const client = await api.client()
  const draft = await api.draft(client) // a draft is never offered

  // Nothing issued yet: the item still opens, and the picker says why it is empty.
  await page.goto('/invoices')
  const empty = await pickerOf(page, /Credit note/, 'Credit note')
  await expect(empty.getByText('No issued invoices yet')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(empty).toBeHidden()

  const issued = await api.save(`/invoices/${text(draft.id)}/issue`)
  const number = text(issued.number)
  await api.draft(client)
  await page.reload()

  const picker = await pickerOf(page, /Credit note/, 'Credit note')
  await picker.getByPlaceholder('Search number or client').fill(number)
  await expect(picker.getByRole('option')).toHaveCount(1)
  await picker.getByRole('option', { name: new RegExp(number) }).click()
  await page
    .getByRole('dialog', { name: `Credit Invoice ${number}?` })
    .getByRole('button', { name: 'Create credit note' })
    .click()
  expect(await composed(page, (path) => api.read(path))).toMatchObject({
    kind: 'credit_note',
    status: 'draft',
    credited_invoice: { id: issued.id, number },
  })

  await page.goto('/invoices')
  const debit = await pickerOf(page, /Debit note/, 'Debit note')
  await debit.getByRole('option', { name: new RegExp(number) }).click()
  await page
    .getByRole('dialog', { name: `Charge more on Invoice ${number}?` })
    .getByRole('button', { name: 'Create debit note' })
    .click()
  expect(await composed(page, (path) => api.read(path))).toMatchObject({
    kind: 'debit_note',
    status: 'draft',
  })
})
