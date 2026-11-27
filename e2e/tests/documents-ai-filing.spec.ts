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
  const filedUpload = page.waitForResponse(
    (response) => response.url().endsWith('/confirm') && response.request().method() === 'POST',
  )
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name,
      mimeType: 'text/plain',
      buffer: Buffer.from(`Contract ${randomUUID()}`),
    })
  // With AI approved the upload is staged first; "Just upload" files it as before, with AI filing.
  await page
    .getByRole('dialog', { name: 'Uploaded 1 file' })
    .getByRole('button', { name: 'Just upload' })
    .click()
  const filedDocs = object(object(await (await filedUpload).json()).data).documents
  if (!Array.isArray(filedDocs)) throw new Error('Expected the filed documents')
  const id = text(object(filedDocs[0]).id)

  // the development model files by the name: a new top-level "Contracts" folder (a common kind, named in the asker's language), tagged "contract"
  await expect(page.getByText('Filed 1 file into Contracts.')).toBeVisible({ timeout: 30_000 })
  const filed = await documentOf(api, id)
  expect(object(filed.folder).name).toBe('Contracts')
  expect(filed.tags).toContain('contract')
  expect(object(filed.ai_filing).status).toBe('filed')

  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByText('File put back where uploaded.')).toBeVisible()
  const back = await documentOf(api, id)
  expect(back.folder_id).toBeNull()
  expect(back.tags).toEqual([])
  const folders = object(await (await api.request.get('/api/v1/documents/folders')).json()).data
  expect(JSON.stringify(folders)).not.toContain('"Contracts"')
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
