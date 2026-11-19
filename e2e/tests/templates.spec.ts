import { createHash, randomUUID } from 'node:crypto'

import { expect, object, test, text, uniqueName } from './fixtures'

test('a template built on an uploaded PDF is filled for a client and filed in Documents', async ({
  page,
  api,
}) => {
  // A real PDF: an issued invoice's, uploaded to Documents as the template's source.
  await api.settings()
  const client = await api.client(uniqueName('Template Client'))
  const invoice = await api.draft(client)
  await api.save(`/invoices/${text(invoice.id)}/issue`)
  const source = await api.request.get(`/api/v1/invoices/${text(invoice.id)}/pdf`)
  await expect(source).toBeOK()
  const sourceBytes = await source.body()
  const uploaded = await api.request.post('/api/v1/documents', {
    headers: { 'X-CSRF-Token': api.csrf },
    multipart: {
      file: {
        name: `contract-${randomUUID()}.pdf`,
        mimeType: 'application/pdf',
        buffer: sourceBytes,
      },
    },
  })
  expect(uploaded.status()).toBe(201)
  const sourceDoc = object(object(await uploaded.json()).data)

  const name = uniqueName('Service agreement')
  const template = await api.save('/templates', {
    name,
    description: null,
    document_id: text(sourceDoc.id),
    signers: [],
    fields: [
      { kind: 'client.name', signer: null, page: 1, x: 0.1, y: 0.1, w: 0.4, h: 0.03, label: null },
      {
        kind: 'client.address',
        signer: null,
        page: 1,
        x: 0.1,
        y: 0.14,
        w: 0.4,
        h: 0.06,
        label: null,
      },
      { kind: 'custom', signer: null, page: 1, x: 0.1, y: 0.22, w: 0.4, h: 0.03, label: 'Project' },
    ],
  })
  expect(object(template.document).id).toBe(sourceDoc.id)

  // Filled in the browser: Documents → Create → Document from template…, the template, the client.
  await page.goto('/documents')
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Document from template…/ }).click()
  await page
    .getByRole('dialog', { name: 'New document from a template' })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click()
  await page.getByRole('searchbox', { name: 'Search clients' }).fill(text(client.name))
  await page
    .getByRole('button', { name: new RegExp(`^${text(client.name)}`) })
    .first()
    .click()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  const title = `Agreement ${randomUUID().slice(0, 8)}`
  await page.getByRole('textbox', { name: /^Document title/ }).fill(title)
  await page.getByRole('textbox', { name: /^Project/ }).fill('Website relaunch')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await page.getByRole('button', { name: 'Save to Documents', exact: true }).click()
  await expect(page.getByText(`“${title}.pdf” saved to Documents.`)).toBeVisible()

  // The filed document: in the client's files, a new PDF whose recorded hash is its bytes'.
  const files = object(
    await (await api.request.get(`/api/v1/clients/${text(client.id)}/files`)).json(),
  ).data
  if (!Array.isArray(files)) throw new Error('Expected the client files')
  const filed = files.map(object).find((file) => file.name === `${title}.pdf`)
  if (!filed) throw new Error('The filled document is not among the client files')
  const doc = await api.read(`/documents/${text(filed.id)}`)
  expect(object(doc.folder).name).toBe('Clients')
  expect(doc.links).toEqual([expect.objectContaining({ type: 'client', id: client.id })])
  const content = await api.request.get(`/api/v1/documents/${text(doc.id)}/content`)
  await expect(content).toBeOK()
  const filledBytes = await content.body()
  expect(filledBytes.subarray(0, 5).toString()).toBe('%PDF-')
  expect(filledBytes.equals(sourceBytes)).toBe(false)
  expect(doc.sha256).toBe(createHash('sha256').update(filledBytes).digest('hex'))

  const used = await api.read(`/templates/${text(template.id)}`)
  expect(used.used_count).toBe(1)

  // Without a mail server an email fails, but the document is filed all the same.
  const values = Object.fromEntries(
    (Array.isArray(used.fields) ? used.fields : [])
      .map(object)
      .map((field) => [text(field.id), 'x']),
  )
  const emailed = await api.write(`/templates/${text(template.id)}/documents`, {
    client_id: client.id,
    title,
    values,
    delivery: { type: 'email', to: 'client@example.test', message: null },
  })
  expect(emailed.status()).toBe(503)
  expect(object(object(await emailed.json()).error).code).toBe('mail_unavailable')
  const after = object(
    await (await api.request.get(`/api/v1/clients/${text(client.id)}/files`)).json(),
  ).data
  expect(
    Array.isArray(after) && after.map(object).filter((file) => String(file.name).startsWith(title)),
  ).toHaveLength(2)

  // The source PDF is read, never changed.
  const original = await api.request.get(`/api/v1/documents/${text(sourceDoc.id)}/content`)
  expect((await original.body()).equals(sourceBytes)).toBe(true)
})
