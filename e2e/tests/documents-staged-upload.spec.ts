import { randomUUID } from 'node:crypto'

import type { APIRequestContext } from '@playwright/test'

import { expect, object, openPage, test, text } from './fixtures'

const listed = async (request: APIRequestContext, query: string) => {
  const body = object(await (await request.get(`/api/v1/documents?${query}`)).json())
  return Array.isArray(body.data) ? body.data.map((row) => text(object(row).name)) : []
}

test('an upload is staged, then "Just upload" files it into the folder the person is in', async ({
  page,
  api,
}) => {
  await api.approveAI()
  const folder = object(
    object(await (await api.write('/documents/folders', { name: `Inbox ${randomUUID()}` })).json())
      .data,
  )
  await openPage(page, `/documents?folder=${text(folder.id)}`, 'Documents')
  const name = `staged-${randomUUID()}.txt`
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(`Notes ${randomUUID()}`) })

  const dialog = page.getByRole('dialog', { name: 'Uploaded 1 file' })
  await expect(dialog.getByText(name)).toBeVisible()
  // staged: in no list yet
  expect(await listed(api.request, `search=${name}`)).toEqual([])
  await dialog.getByRole('button', { name: 'Just upload' }).click()
  await expect(dialog).toBeHidden()
  await expect.poll(() => listed(api.request, `folder_id=${text(folder.id)}`)).toEqual([name])
})

test('closing the staged upload deletes it: nothing is stored', async ({ page, api }) => {
  await api.approveAI()
  await openPage(page, '/documents', 'Documents')
  const name = `discarded-${randomUUID()}.txt`
  const cancelled = page.waitForResponse(
    (response) => response.url().endsWith('/cancel') && response.request().method() === 'POST',
  )
  await page
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(`Draft ${randomUUID()}`) })
  const dialog = page.getByRole('dialog', { name: 'Uploaded 1 file' })
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  expect((await cancelled).status()).toBe(204)
  await expect(dialog).toBeHidden()
  expect(await listed(api.request, `search=${name}`)).toEqual([])
})
