import { expect, test, text } from './fixtures'

test('an issued invoice is marked as sent without email: sent_at set, no email delivered', async ({
  api,
  page,
}) => {
  await api.settings()
  const draft = await api.draft(await api.client())
  const invoice = await api.save(`/invoices/${text(draft.id)}/issue`)
  const id = text(invoice.id)
  expect(invoice.sent_at).toBeNull()

  await page.goto(`/invoices?id=${id}`)
  await page.getByRole('button', { name: 'Send', exact: true }).first().click()
  const dialog = page.getByRole('dialog', { name: 'Send by email' })
  await dialog.getByRole('button', { name: 'Mark as sent without email' }).click()
  await expect(page.getByText(`${text(invoice.number)} marked as sent.`)).toBeVisible()
  await expect(dialog).toBeHidden()

  const sent = await api.read(`/invoices/${id}`)
  expect(text(sent.sent_at)).not.toBe('')
  const deliveries = await api.request.get(`/api/v1/invoices/${id}/deliveries`)
  await expect(deliveries).toBeOK()
  expect(await deliveries.json()).toMatchObject({ data: [] })

  // a repeat (a double-click, a retry) keeps the first date
  const again = await api.save(`/invoices/${id}/send`, { email: false })
  expect(again.sent_at).toBe(sent.sent_at)
})
