import { randomUUID } from 'node:crypto'

import type { BrowserContext } from '@playwright/test'

import { expect, object, signIn, test, text, today, type FinancialAPI } from './fixtures'

const portalURL = 'http://localhost:8009' // e2e/scripts/e2e-server.mjs

const line = {
  description: 'Website relaunch',
  quantity: '12',
  unit: 'hour',
  unit_price: '150',
  vat_category: 'S',
  vat_rate: '8.1',
}

/** A client with the portal on for a fresh address, and a quote sent to it (no SMTP in E2E: marked sent). */
async function sentQuote(api: FinancialAPI) {
  await api.settings()
  const client = await api.client()
  const email = `quote-${randomUUID()}@example.test`
  await api.save(`/clients/${text(client.id)}`, { email, portal_enabled: true }, 'PATCH')
  const draft = await api.save('/quotes', {
    client_id: client.id,
    lines: [line],
    intro: 'As discussed.',
  })
  expect(draft).toMatchObject({ status: 'draft', number: null, payable_total: '1945.80' })
  const quote = await api.save(`/quotes/${text(draft.id)}/send`, { email: false })
  expect(quote.status).toBe('sent')
  expect(text(quote.number)).toMatch(new RegExp(`^Q-${today().slice(0, 4)}-\\d{3}$`))
  return { client, email, quote }
}

async function signInToPortal(context: BrowserContext, email: string) {
  const portal = await context.newPage()
  await portal.goto('/login')
  await portal.getByLabel('Email', { exact: true }).fill(email)
  await portal.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(portal.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  const dev = await context.request.get(
    `/api/v1/auth/email/dev-code?email=${encodeURIComponent(email)}`,
  )
  await portal.getByLabel('Code', { exact: true }).fill(text(object(await dev.json()).code))
  await expect(portal).toHaveURL(`${portalURL}/`)
  return portal
}

test('a quote is sent, accepted by the client in the portal and becomes one invoice draft', async ({
  api,
  browser,
  page,
}) => {
  const { email, quote } = await sentQuote(api)
  const number = text(quote.number)

  // The client: its own browser, the portal's Quotes page, accept with a note.
  const context = await browser.newContext({ baseURL: portalURL })
  try {
    const portal = await signInToPortal(context, email)
    await portal.getByRole('link', { name: 'Quotes' }).first().click()
    await expect(portal.getByText(number)).toBeVisible()
    const pdf = await context.request.get(`/api/v1/public/portal/quotes/${text(quote.id)}/pdf`)
    await expect(pdf).toBeOK()
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF')
    await portal.getByRole('button', { name: `Accept quote ${number}` }).click()
    const dialog = portal.getByRole('dialog')
    await dialog.getByRole('textbox').fill('Please start in January.')
    await dialog.getByRole('button', { name: 'Accept quote' }).click()
    await expect(dialog).toBeHidden()
    await expect(portal.getByText('Please start in January.')).toBeVisible()
    await portal.reload()
    await expect(portal.getByText('Please start in January.')).toBeVisible()
  } finally {
    await context.close()
  }

  // Staff: the answer is recorded and the owner is told.
  const accepted = await api.read(`/quotes/${text(quote.id)}`)
  expect(accepted).toMatchObject({
    status: 'accepted',
    decided_by: 'client',
    decision_note: 'Please start in January.',
  })
  const bell = object(await (await api.request.get('/api/v1/notifications')).json())
  expect(JSON.stringify(bell.data)).toContain(`accepted quote ${number}`)

  // Staff converts it in the platform: the invoice draft opens and names the quote.
  await page.goto(`/quotes?id=${text(quote.id)}`)
  await page.getByRole('button', { name: 'Create invoice' }).click()
  await page
    .getByRole('dialog', { name: /Create an invoice from/ })
    .getByRole('button', { name: 'Create invoice' })
    .click()
  await expect(page).toHaveURL(/\/invoices\/?.*id=inv_/)
  const converted = await api.read(`/quotes/${text(quote.id)}`)
  const invoiceId = text(object(converted.invoice).id)
  const invoice = await api.read(`/invoices/${invoiceId}`)
  expect(invoice).toMatchObject({
    status: 'draft',
    payable_total: '1945.80',
    quote: { id: quote.id, number },
  })

  // Converting twice is refused, in the UI's API and directly.
  const again = await api.write(`/quotes/${text(quote.id)}/invoice`)
  expect(again.status()).toBe(409)
  expect(object(object(await again.json()).error).code).toBe('quote_invoiced')
})

test('quotes stay inside their workspace and with their client', async ({
  api,
  playwright,
  baseURL,
}) => {
  const { quote } = await sentQuote(api)
  const id = text(quote.id)

  // Another workspace's owner sees nothing and can change nothing.
  const otherRequest = await playwright.request.newContext({ baseURL })
  try {
    const other = await signIn(otherRequest, `quotes-other-${randomUUID()}@example.test`)
    expect((await otherRequest.get(`/api/v1/quotes/${id}`)).status()).toBe(404)
    expect((await otherRequest.get(`/api/v1/quotes/${id}/pdf`)).status()).toBe(404)
    const writes = await Promise.all(
      [`/quotes/${id}/accept`, `/quotes/${id}/invoice`, `/quotes/${id}/revise`].map((path) =>
        other.write(path),
      ),
    )
    expect(writes.map((response) => response.status())).toEqual([404, 404, 404])
    expect((await other.write(`/quotes/${id}`, { note: 'x' }, 'PATCH')).status()).toBe(404)
    const list = object(await (await otherRequest.get('/api/v1/quotes')).json())
    expect(list.data).toEqual([])
  } finally {
    await otherRequest.dispose()
  }

  // Another client of the same workspace cannot see or answer it in the portal.
  const stranger = await api.client()
  const strangerEmail = `quote-stranger-${randomUUID()}@example.test`
  await api.save(
    `/clients/${text(stranger.id)}`,
    { email: strangerEmail, portal_enabled: true },
    'PATCH',
  )
  const portal = await playwright.request.newContext({ baseURL })
  try {
    await portal.post('/api/v1/public/portal/auth/start', { data: { email: strangerEmail } })
    const dev = await portal.get(
      `/api/v1/auth/email/dev-code?email=${encodeURIComponent(strangerEmail)}`,
    )
    const verified = await portal.post('/api/v1/public/portal/auth/verify', {
      data: { email: strangerEmail, code: text(object(await dev.json()).code) },
    })
    expect(verified.status()).toBe(201)
    const csrf = text(object(await verified.json()).csrf_token)
    expect(object(await (await portal.get('/api/v1/public/portal/quotes')).json()).data).toEqual([])
    const answer = await portal.post(`/api/v1/public/portal/quotes/${id}/accept`, {
      data: {},
      headers: { 'X-CSRF-Token': csrf },
    })
    expect(answer.status()).toBe(404)
  } finally {
    await portal.dispose()
  }
  expect((await api.read(`/quotes/${id}`)).status).toBe('sent')
})

test('a declined quote is revised under the same number and sent again', async ({ api }) => {
  const { quote } = await sentQuote(api)
  const id = text(quote.id)
  const declined = await api.save(`/quotes/${id}/decline`, { note: 'Too expensive' })
  expect(declined).toMatchObject({ status: 'declined', decided_by: 'staff' })
  const refused = await api.write(`/quotes/${id}/invoice`)
  expect(refused.status()).toBe(409)
  const revised = await api.save(`/quotes/${id}/revise`)
  expect(revised).toMatchObject({
    status: 'draft',
    revision: 2,
    number: quote.number,
    decided_at: null,
  })
  await api.save(`/quotes/${id}`, { lines: [{ ...line, unit_price: '130' }] }, 'PATCH')
  const resent = await api.save(`/quotes/${id}/send`, { email: false })
  expect(resent).toMatchObject({
    status: 'sent',
    revision: 2,
    number: quote.number,
    payable_total: '1686.35',
  })
})

test('the quotes list searches by number and keeps the search over a reload', async ({
  api,
  page,
}) => {
  const { quote } = await sentQuote(api)
  const number = text(quote.number)
  await page.goto('/quotes')
  const search = page.getByRole('searchbox', { name: 'Search quotes' })
  await search.fill(number.toLowerCase())
  await expect(page).toHaveURL(new RegExp(`q=${number.toLowerCase()}`))
  await expect(page.getByRole('button', { name: number })).toBeVisible()
  await page.reload()
  await expect(search).toHaveValue(number.toLowerCase())
  await expect(page.getByRole('button', { name: number })).toBeVisible()

  await search.fill('no such quote')
  await expect(page.getByText('Nothing matches “no such quote”')).toBeVisible()
  await page.getByRole('button', { name: 'Clear search and filters' }).click()
  await expect(search).toHaveValue('')
  await expect(page.getByRole('button', { name: number })).toBeVisible()
})
