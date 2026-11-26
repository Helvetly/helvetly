import { randomUUID } from 'node:crypto'

import { expect, object, test, text } from './fixtures'

test('a guest can download a one-time document link once', async ({
  api,
  browser,
  baseURL,
  page,
}) => {
  const bytes = Buffer.from(`%PDF-1.4\n${randomUUID()}\n%%EOF`)
  const upload = await api.request.post('/api/v1/documents', {
    headers: { 'X-CSRF-Token': api.csrf },
    multipart: { file: { name: 'Agreement.pdf', mimeType: 'application/pdf', buffer: bytes } },
  })
  await expect(upload).toBeOK()
  const file = object(object(await upload.json()).data)

  await page.goto('/documents')
  await page.getByRole('button', { name: 'Share Agreement.pdf' }).click()
  const dialog = page.getByRole('dialog', { name: 'Share document' })
  await dialog.getByRole('radio', { name: 'Share by link' }).check()
  await dialog.getByRole('button', { name: /Expires after/ }).click()
  await page.getByRole('option', { name: 'Minutes', exact: true }).click()
  await dialog.getByRole('spinbutton', { name: 'Duration' }).fill('15')
  await dialog.getByRole('switch', { name: 'One-time download' }).click()
  await dialog.getByRole('button', { name: 'Create link' }).click()
  const link = dialog.getByRole('textbox', { name: 'Share by link' })
  await expect(link).toHaveValue(/\/share#[A-Za-z0-9_-]{43}$/)
  const address = await link.inputValue()

  const guest = await browser.newContext({ baseURL })
  const recipient = await guest.newPage()
  await recipient.goto(address)
  await expect(recipient.getByRole('heading', { name: 'Shared document' })).toBeVisible()
  await recipient.reload()
  const [download] = await Promise.all([
    recipient.waitForEvent('download'),
    recipient.getByRole('button', { name: 'Download' }).click(),
  ])
  expect(download.suggestedFilename()).toBe('Agreement.pdf')
  expect(await download.failure()).toBeNull()
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  expect(Buffer.concat(chunks)).toEqual(bytes)

  const redeemed = await guest.request.post('/api/v1/public/document-share/download', {
    form: { token: new URL(address).hash.slice(1) },
  })
  expect(redeemed.status()).toBe(404)
  await guest.close()

  const list = await api.request.get(`/api/v1/documents/${text(file.id)}/share-links`)
  await expect(list).toBeOK()
  const response = await list.text()
  expect(response).not.toContain(new URL(address).hash.slice(1))
  expect(object(JSON.parse(response)).data).toEqual([
    expect.objectContaining({ single_use: true, used_at: expect.any(String) }),
  ])
})
