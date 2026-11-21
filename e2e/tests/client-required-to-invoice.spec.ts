import { expect, test, text, uniqueName } from './fixtures'

test('issuing to a client without its address: refused, fixed in the client drawer in place, then issued', async ({
  api,
  page,
}) => {
  await api.settings()
  const name = uniqueName('No Address')
  // Only the name and country: a client is saved without its address, and drafted to.
  const client = await api.save('/clients', {
    name,
    country: 'CH',
    language: 'en',
    currency: 'CHF',
  })
  expect(client.is_draft).toBe(true)
  const id = text((await api.draft(client)).id)

  await page.goto(`/invoices?id=${id}`)
  const drawer = page.getByRole('dialog').first()
  const issue = async () => {
    await drawer.getByRole('button', { name: 'Issue', exact: true }).click()
    await page
      .getByRole('dialog', { name: /^Issue this/ })
      .getByRole('button', { name: 'Issue' })
      .click()
  }
  await issue()

  const blockers = page.getByRole('dialog', { name: 'Not ready to issue yet' })
  await expect(blockers).toContainText("Complete the client's address")
  await blockers.getByRole('button', { name: /Complete the client/ }).click()

  // The client's form opens over the page, on the first missing field; the URL stays the invoice's.
  const form = page.getByRole('dialog', { name: `Edit ${name}` })
  await expect(form.getByRole('textbox', { name: 'Street', exact: true })).toBeFocused()
  expect(new URL(page.url()).pathname).toMatch(/^\/invoices\/?$/)
  await form.getByRole('textbox', { name: 'Street', exact: true }).fill('Rue du Lac')
  await form.getByRole('textbox', { name: 'Number', exact: true }).fill('12')
  await form.getByRole('textbox', { name: 'ZIP', exact: true }).fill('1003')
  await form.getByRole('textbox', { name: 'City', exact: true }).fill('Lausanne')
  await form.getByRole('button', { name: 'Save changes' }).click()
  await expect(form).toBeHidden()
  await expect
    .poll(async () => (await api.read(`/clients/${text(client.id)}`)).is_draft)
    .toBe(false)

  await blockers.getByRole('button', { name: 'Close' }).first().click()
  await expect(blockers).toBeHidden()
  await issue()
  await expect.poll(async () => (await api.read(`/invoices/${id}`)).status).toBe('open')
})
