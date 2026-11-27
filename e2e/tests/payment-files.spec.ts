import { expect, object, openPage, test, text, today } from './fixtures'

type Folder = { id: string; name: string; parent_id: string | null }

test('a payment’s confirmation is filed under the client’s Bank Statements and stays there while linked', async ({
  api,
  page,
}) => {
  await api.settings()
  const client = await api.client()
  const path = `/invoices/${text((await api.draft(client)).id)}`
  const invoice = await api.save(`${path}/issue`)
  await api.save(`${path}/payments`, {
    amount: '100.00',
    paid_on: today(),
    method: 'bank_transfer',
  })

  await openPage(page, `/invoices?id=${text(invoice.id)}`, 'Invoices')
  const sheet = page.getByRole('dialog').first()
  await sheet.getByRole('tab', { name: /Payments/ }).click()
  await sheet.getByRole('button', { name: /^Attach a file to / }).click()
  const dialog = page.getByRole('dialog', { name: 'Attach a statement or confirmation' })
  await dialog.locator('input[type=file]').setInputFiles({
    name: 'Gutschrift.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(`%PDF-1.4\n% payment ${Date.now()}\n%%EOF\n`),
  })
  await expect(page.getByText('File attached')).toBeVisible()
  await expect(sheet.getByRole('button', { name: /Gutschrift\.pdf: preview/ })).toBeVisible()

  const payment = object((object(await api.read(path)).payments as unknown[])[0])
  const [file] = payment.documents as Record<string, unknown>[]
  expect(text(file?.name)).toBe('Gutschrift.pdf')

  const all = object(await (await api.request.get('/api/v1/documents/folders')).json())
    .data as Folder[]
  const under = (parent: string | null, name: string) =>
    all.find((f) => f.parent_id === parent && f.name === name)?.id ?? null
  let folder: string | null = null
  for (const name of [
    'Clients',
    text(client.name),
    'Documents',
    today().slice(0, 4),
    'Bank Statements',
  ])
    folder = under(folder, name)
  const doc = object(
    object(await (await api.request.get(`/api/v1/documents/${text(file?.id)}`)).json()).data,
  )
  expect(doc.folder_id).toBe(folder)
  expect(doc.tags).toContain('payment-confirmation')

  // fixed while linked, a normal file again once unlinked
  const mine = await api.save('/documents/folders', { name: `Mine ${Date.now()}` })
  const moved = await api.write(`/documents/${text(file?.id)}`, { folder_id: mine.id }, 'PATCH')
  expect(moved.status()).toBe(409)
  expect(object(object(await moved.json()).error).code).toBe('record_move_locked')
  const unlinked = await api.write(
    `${path}/payments/${text(payment.id)}/documents/${text(file?.id)}`,
    {},
    'DELETE',
  )
  expect(unlinked.status()).toBe(204)
  await expect(
    await api.write(`/documents/${text(file?.id)}`, { folder_id: mine.id }, 'PATCH'),
  ).toBeOK()
})
