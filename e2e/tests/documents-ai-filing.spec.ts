import { randomUUID } from 'node:crypto'

import { expect, object, openPage, test, text, type FinancialAPI } from './fixtures'

const documentOf = async (api: FinancialAPI, id: string) =>
  object(object(await (await api.request.get(`/api/v1/documents/${id}`)).json()).data)

test('AI files an upload into a new folder, says so, and Undo puts it back', async ({
  page,
  api,
}) => {
  await api.approveAI()
  await openPage(page, '/documents', 'Documents')
  const name = `contract-${randomUUID()}.txt`
  const uploaded = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/documents') && response.request().method() === 'POST',
  )
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name,
      mimeType: 'text/plain',
      buffer: Buffer.from(`Contract ${randomUUID()}`),
    })
  const id = text(object(object(await (await uploaded).json()).data).id)

  // the development model files by the name: a new top-level "Contract" folder, tagged "contract"
  await expect(page.getByText('Filed 1 file into Contract.')).toBeVisible({ timeout: 30_000 })
  const filed = await documentOf(api, id)
  expect(object(filed.folder).name).toBe('Contract')
  expect(filed.tags).toContain('contract')
  expect(object(filed.ai_filing).status).toBe('filed')

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByText('File put back where uploaded.')).toBeVisible()
  const back = await documentOf(api, id)
  expect(back.folder_id).toBeNull()
  expect(back.tags).toEqual([])
  const folders = object(await (await api.request.get('/api/v1/documents/folders')).json()).data
  expect(JSON.stringify(folders)).not.toContain('"Contract"')
})

test('without the uploader’s AI approval an upload is never filed', async ({ api }) => {
  const response = await api.request.post('/api/v1/documents', {
    headers: { 'X-CSRF-Token': api.csrf },
    multipart: {
      file: {
        name: `invoice-${randomUUID()}.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from(randomUUID()),
      },
    },
  })
  expect(response.status()).toBe(201)
  const id = text(object(object(await response.json()).data).id)
  expect(object(object(await response.json()).data).ai_filing).toBeNull()
  await new Promise((resolve) => setTimeout(resolve, 4_000)) // longer than a filing tick
  const later = await documentOf(api, id)
  expect(later.folder_id).toBeNull()
  expect(later.ai_filing).toBeNull()
})
