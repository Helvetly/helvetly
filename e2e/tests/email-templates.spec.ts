import { randomUUID } from 'node:crypto'

import { expect, object, signIn, test, text, type FinancialAPI } from './fixtures'

const line = {
  description: 'Consulting',
  quantity: '2',
  unit_price: '100',
  vat_category: 'S',
  vat_rate: '8.1',
}

async function issued(api: FinancialAPI, language: 'en' | 'de') {
  await api.settings()
  const client = await api.client()
  await api.save(`/clients/${text(client.id)}`, { language }, 'PATCH')
  const draft = await api.draft(client, { language })
  return { client, invoice: await api.save(`/invoices/${text(draft.id)}/issue`) }
}

async function draftEmail(api: FinancialAPI, path: string) {
  return api.read(`${path}/email`)
}

test('owner customises the English invoice email, the send dialog shows it rendered, reset restores the default', async ({
  api,
  page,
}) => {
  const { client, invoice } = await issued(api, 'en')
  const number = text(invoice.number)

  await page.goto('/settings/workspace')
  const editInvoice = async () => {
    await page.getByRole('button', { name: 'Edit the Invoice email' }).click()
    const dialog = page.getByRole('dialog', { name: 'Invoice email' })
    await dialog.getByRole('radio', { name: /^English/ }).click()
    return dialog
  }
  let editor = await editInvoice()
  // Both fields are required: an empty subject is refused before anything is sent.
  await editor.locator('#email-template-invoice-en-subject').fill('')
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(editor.getByText('Enter a subject.')).toBeVisible()
  await editor.locator('#email-template-invoice-en-subject').fill('Bill {number} for {client}')
  await editor.locator('#email-template-invoice-en-body').fill('Dear {client}, see {number}.')
  await editor.getByRole('button', { name: 'Save' }).click()
  await expect(editor).toBeHidden()
  await expect(page.getByText('1 language customised')).toBeVisible()

  // A refresh keeps the saved template.
  await page.reload()
  editor = await editInvoice()
  await expect(editor.getByRole('radio', { name: 'English, customised' })).toBeChecked()
  await expect(editor.locator('#email-template-invoice-en-subject')).toHaveValue(
    'Bill {number} for {client}',
  )
  await page.keyboard.press('Escape')

  const rendered = await draftEmail(api, `/invoices/${text(invoice.id)}`)
  expect(rendered.subject).toBe(`Bill ${number} for ${text(client.name)}`)
  expect(rendered.message).toBe(`Dear ${text(client.name)}, see ${number}.`)

  await page.goto(`/invoices?id=${text(invoice.id)}`)
  await page
    .getByRole('button', { name: 'Send by email' })
    .or(page.getByRole('button', { name: 'Send', exact: true }))
    .first()
    .click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel('Subject')).toHaveValue(`Bill ${number} for ${text(client.name)}`)
  await expect(dialog.getByLabel('Message')).toHaveValue(
    `Dear ${text(client.name)}, see ${number}.`,
  )
  await page.keyboard.press('Escape')

  // Reset restores the standard wording.
  await page.goto('/settings/workspace')
  editor = await editInvoice()
  await editor.getByRole('button', { name: 'Reset to default' }).click()
  await expect(editor.getByRole('radio', { name: 'English', exact: true })).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(page.getByText(/language customised/)).toHaveCount(0)
  const standard = await draftEmail(api, `/invoices/${text(invoice.id)}`)
  expect(standard.subject).toBe(`Invoice ${number} from E2E Zürich GmbH`)
})

test('a German invoice keeps the German default while the English template is customised', async ({
  api,
}) => {
  const { invoice } = await issued(api, 'de')
  await api.save(
    '/email-templates/invoice/en',
    { subject: 'English {number}', body: 'English body' },
    'PUT',
  )
  const email = await draftEmail(api, `/invoices/${text(invoice.id)}`)
  expect(email.subject).toBe(`Rechnung ${text(invoice.number)} von E2E Zürich GmbH`)
  expect(text(email.message)).toContain('Guten Tag')
})

test('quote send dialog is prefilled from the quote template', async ({ api, page }) => {
  await api.settings()
  const client = await api.client()
  const quote = await api.save('/quotes', { client_id: client.id, lines: [line] })
  await api.save(
    '/email-templates/quote/en',
    { subject: 'Offer for {client}', body: 'Valid until {valid_until}' },
    'PUT',
  )
  const email = await draftEmail(api, `/quotes/${text(quote.id)}`)
  expect(email.subject).toBe(`Offer for ${text(client.name)}`)

  await page.goto(`/quotes?id=${text(quote.id)}`)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Send quote' })
  await expect(dialog.getByLabel('Subject')).toHaveValue(`Offer for ${text(client.name)}`)
})

test('a member without invoice-settings write sees the page read-only and the API refuses writes', async ({
  api,
  browser,
  baseURL,
}) => {
  const email = `e2e-member-${randomUUID()}@example.test`
  await api.save('/members/invitations', {
    email,
    role: 'member',
    scopes: ['read:workspace', 'read:invoice-settings'],
    send_email: false,
  })
  const context = await browser.newContext({ baseURL })
  try {
    const member = await signIn(context.request, email)
    const page = await context.newPage()
    await page.goto('/settings/workspace')
    await expect(
      page
        .getByText('Only people who can edit invoice settings can change these templates.')
        .first(),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Edit the Invoice email' }).click()
    const editor = page.getByRole('dialog')
    await editor.getByRole('radio', { name: /^English/ }).click()
    await expect(editor.locator('#email-template-invoice-en-subject')).toBeDisabled()
    await expect(editor.getByRole('button', { name: 'Save' })).toHaveCount(0)
    await expect(editor.getByRole('button', { name: 'Reset to default' })).toHaveCount(0)
    const refused = await member.write(
      '/email-templates/invoice/en',
      { subject: 'x', body: 'y' },
      'PUT',
    )
    expect(refused.status()).toBe(403)
    expect(
      object(await (await member.request.get('/api/v1/email-templates')).json()),
    ).toHaveProperty('data')
  } finally {
    await context.close()
  }
})
