import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { APIRequestContext, BrowserContext } from '@playwright/test'

import { expect, object, test, text, uniqueName, type FinancialAPI } from './fixtures'

const portalURL = 'http://localhost:8009' // e2e/scripts/e2e-server.mjs

const code = async (request: APIRequestContext, email: string) => {
  const sent = await request.post('/api/v1/public/portal/auth/start', { data: { email } })
  expect(sent.status()).toBe(202)
  const dev = await request.get(`/api/v1/auth/email/dev-code?email=${encodeURIComponent(email)}`)
  await expect(dev).toBeOK()
  return text(object(await dev.json()).code)
}

/** Signs `email` in through the portal's login screen; the page ends on the overview. */
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

async function issuedInvoice(api: FinancialAPI, client: Record<string, unknown>) {
  const draft = await api.draft(client)
  return api.save(`/invoices/${text(draft.id)}/issue`)
}

test('a client signs in with its email, reads shared data, asks for a change and is cut off when the portal goes off', async ({
  api,
  playwright,
  baseURL,
}) => {
  await api.settings()
  const client = await api.client()
  const other = await api.client()
  const clientId = text(client.id)
  const contactEmail = `portal-${randomUUID()}@example.test`

  // Staff: turn the portal on for the client's email, share a document, issue invoices.
  await api.save(`/clients/${clientId}`, { email: contactEmail, portal_enabled: true }, 'PATCH')
  const invoice = await issuedInvoice(api, client)
  const foreignInvoice = await issuedInvoice(api, other)
  const upload = await api.request.post('/api/v1/documents', {
    headers: { 'X-CSRF-Token': api.csrf },
    multipart: {
      file: {
        name: `shared-${randomUUID().slice(0, 8)}.pdf`,
        mimeType: 'application/pdf',
        buffer: Buffer.from(`%PDF-1.4\n${randomUUID()}\n%%EOF`),
      },
    },
  })
  await expect(upload).toBeOK()
  const document = object(object(await upload.json()).data)
  await expect(
    await api.write(`/documents/${text(document.id)}/shares`, { client_id: clientId }),
  ).toBeOK()

  // Contact: its own cookie jar, no staff session.
  const portal = await playwright.request.newContext({ baseURL })
  try {
    const unauthenticated = await portal.get('/api/v1/public/portal/invoices')
    expect(unauthenticated.status()).toBe(401)

    const verified = await portal.post('/api/v1/public/portal/auth/verify', {
      data: { email: contactEmail, code: await code(portal, contactEmail) },
    })
    expect(verified.status()).toBe(201)
    const csrf = text(object(await verified.json()).csrf_token)

    const session = object(await (await portal.get('/api/v1/public/portal/session')).json())
    expect(object(session.client).id).toBe(clientId)

    const invoices = object(await (await portal.get('/api/v1/public/portal/invoices')).json())
    expect(Array.isArray(invoices.data) ? invoices.data.map((i) => object(i).id) : []).toEqual([
      invoice.id,
    ])
    const pdf = await portal.get(`/api/v1/public/portal/invoices/${text(invoice.id)}/pdf`)
    await expect(pdf).toBeOK()
    expect(pdf.headers()['content-type']).toContain('application/pdf')
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF')
    // Another client's invoice does not exist for this contact.
    const foreign = await portal.get(
      `/api/v1/public/portal/invoices/${text(foreignInvoice.id)}/pdf`,
    )
    expect(foreign.status()).toBe(404)

    const documents = object(await (await portal.get('/api/v1/public/portal/documents')).json())
    expect(Array.isArray(documents.data) ? documents.data.map((d) => object(d).id) : []).toEqual([
      document.id,
    ])
    const download = await portal.get(
      `/api/v1/public/portal/documents/${text(document.id)}/download`,
      { maxRedirects: 0 },
    )
    expect(download.status()).toBe(302)

    // The contact asks for a new city; staff approves; the client shows it.
    const asked = await portal.post('/api/v1/public/portal/profile/requests', {
      data: { city: 'Bern' },
      headers: { 'X-CSRF-Token': csrf },
    })
    expect(asked.status()).toBe(201)
    const pending = await api.request.get(`/api/v1/clients/${clientId}/change-request`)
    await expect(pending).toBeOK()
    expect(object(object(object(await pending.json()).data).fields).city).toBe('Bern')
    const approved = await api.write(`/clients/${clientId}/change-request/approve`)
    await expect(approved).toBeOK()
    expect((await api.read(`/clients/${clientId}`)).city).toBe('Bern')
    expect(
      object(await (await api.request.get(`/api/v1/clients/${clientId}/change-request`)).json())
        .data,
    ).toBeNull()

    // Turning the portal off ends the session on the very next request.
    await api.save(`/clients/${clientId}`, { portal_enabled: false }, 'PATCH')
    expect((await portal.get('/api/v1/public/portal/session')).status()).toBe(401)
    expect((await portal.get('/api/v1/public/portal/invoices')).status()).toBe(401)
  } finally {
    await portal.dispose()
  }
})

test('portal screens in the browser: sign in, read, ask for a change, staff approves', async ({
  api,
  page,
  browser,
}) => {
  await api.settings()
  const client = await api.client()
  const clientId = text(client.id)
  const contactEmail = `portal-ui-${randomUUID()}@example.test`
  await api.save(`/clients/${clientId}`, { email: contactEmail, portal_enabled: true }, 'PATCH')
  await issuedInvoice(api, client)
  const fileName = `shared-${randomUUID().slice(0, 8)}.pdf`
  const upload = await api.request.post('/api/v1/documents', {
    headers: { 'X-CSRF-Token': api.csrf },
    multipart: {
      file: {
        name: fileName,
        mimeType: 'application/pdf',
        buffer: Buffer.from(`%PDF-1.4\n${randomUUID()}\n%%EOF`),
      },
    },
  })
  const document = object(object(await upload.json()).data)
  await expect(
    await api.write(`/documents/${text(document.id)}/shares`, { client_id: clientId }),
  ).toBeOK()

  const shots = join(process.env.TMPDIR ?? tmpdir(), 'helvetly')
  await mkdir(shots, { recursive: true })
  // The portal is its own app on its own host (PORTAL_URL), next to the platform.
  const context = await browser.newContext({ baseURL: portalURL })
  try {
    const portal = await context.newPage()
    await portal.goto('/')
    await expect(portal).toHaveURL(/\/login\/?$/)
    await portal.getByLabel('Email', { exact: true }).fill(contactEmail)
    await portal.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(portal.getByRole('heading', { name: 'Check your email' })).toBeVisible()
    const dev = await context.request.get(
      `/api/v1/auth/email/dev-code?email=${encodeURIComponent(contactEmail)}`,
    )
    await portal.getByLabel('Code', { exact: true }).fill(text(object(await dev.json()).code))

    await expect(portal).toHaveURL(`${portalURL}/`)
    await expect(portal.getByText('CHF 1’081.00').first()).toBeVisible()
    await portal.screenshot({ path: join(shots, 'portal-overview-desktop.png') })
    await portal.setViewportSize({ width: 390, height: 844 })
    await portal.screenshot({ path: join(shots, 'portal-overview-mobile.png') })
    await portal.setViewportSize({ width: 1280, height: 800 })

    await portal.getByRole('link', { name: 'Invoices', exact: true }).click()
    await expect(portal.getByRole('link', { name: /Download PDF of invoice/ })).toHaveAttribute(
      'href',
      /\/api\/v1\/public\/portal\/invoices\/.+\/pdf$/,
    )
    await portal.getByRole('link', { name: 'Documents', exact: true }).click()
    await expect(portal.getByText(fileName)).toBeVisible()

    // Profile lives in the account menu.
    await portal.getByRole('button', { name: /^Account menu/ }).click()
    await portal.getByRole('menuitem', { name: 'Profile' }).click()
    await portal.getByLabel('City', { exact: true }).fill('Bern')
    await portal.getByRole('button', { name: 'Request change' }).click()
    await expect(portal.getByText('Waiting for approval')).toBeVisible()
    await portal.screenshot({ path: join(shots, 'portal-profile.png') })

    // Staff sees the request on the client and approves it.
    await page.goto(`/clients?id=${clientId}`)
    const notice = page.getByRole('region', { name: 'Change request' })
    await expect(notice).toContainText('asked to change 1 field')
    await notice.getByRole('button', { name: 'Review' }).click()
    const review = page.getByRole('dialog', { name: 'Profile change requested by the client' })
    await expect(review).toContainText('Bern')
    await review.getByRole('button', { name: 'Approve 1 change' }).click()
    await expect(review).toHaveCount(0)
    await expect(page.locator('output').getByText('Changes applied')).toBeVisible()
    await expect(notice).toHaveCount(0)
    expect((await api.read(`/clients/${clientId}`)).city).toBe('Bern')
  } finally {
    await context.close()
  }
})

test('staff turns the portal on for a person with only an email: that email signs in, a contact cannot', async ({
  api,
  page,
  browser,
}) => {
  const email = `john-${randomUUID()}@example.test`
  const contactEmail = `contact-${randomUUID()}@example.test`
  const client = await api.save('/clients', { name: uniqueName('John'), is_company: false, email })
  const clientId = text(client.id)
  await api.save(`/clients/${clientId}/contacts`, { name: 'A Contact', email: contactEmail })

  // Staff: the switch in the client's "Client portal" card.
  await page.goto(`/clients?id=${clientId}`)
  const card = page.locator('section', {
    has: page.getByRole('heading', { name: 'Client portal' }),
  })
  await card.getByRole('switch', { name: 'Client portal' }).click()
  await expect(card.getByText(email)).toBeVisible()
  // The workspace's own portal address, where its clients sign in.
  await expect(card.getByRole('link', { name: /localhost:8009\/w\// })).toHaveAttribute(
    'href',
    new RegExp(`^${portalURL}/w/[a-z0-9-]+/$`),
  )
  expect((await api.read(`/clients/${clientId}`)).portal_enabled).toBe(true)

  // A contact's address gets no code.
  const contactStart = await page.request.post('/api/v1/public/portal/auth/start', {
    data: { email: contactEmail },
  })
  expect(contactStart.status()).toBe(202)
  const contactCode = await page.request.get(
    `/api/v1/auth/email/dev-code?email=${encodeURIComponent(contactEmail)}`,
  )
  expect(contactCode.status()).toBe(404)

  // The client's email signs in to the portal.
  const context = await browser.newContext({ baseURL: portalURL })
  try {
    await signInToPortal(context, email)
    const session = object(
      await (await context.request.get('/api/v1/public/portal/session')).json(),
    )
    expect(object(session.client).id).toBe(clientId)
  } finally {
    await context.close()
  }
})

// 64 × 64 px, already small enough to go up as it is.
const smallPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAA5UlEQVR42u3PhUECAAAAQea0u7u727d7BJDuThHGcgQX+NvgAj10e+n20emnM8DvIL9DtIdpj/Azys8YrXFaEzQnaU7RmKYxQ32W+hy1eWoLVBepLlFZprJCeZXyGqV1ShsUNyluUdimsEN+l/weuX1yB2QPyR6ROSZzQvqU9Bmpc1IXJC9JXpG4JnFD/JY4xO6I3RN9IPpI5InIM+EXwq98v/H9TuiD0CfBL4IBAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwIABAwYMGDBgwMB/gT+jseGWU2gTOAAAAABJRU5ErkJggg==',
  'base64',
)

test('a client uploads a photo, sees it in the account menu, replaces it with a shrunk one and removes it', async ({
  api,
  browser,
}) => {
  const email = `photo-${randomUUID()}@example.test`
  const client = await api.save('/clients', { name: uniqueName('Photo'), is_company: false, email })
  await api.save(`/clients/${text(client.id)}`, { portal_enabled: true }, 'PATCH')

  const context = await browser.newContext({ baseURL: portalURL })
  try {
    const portal = await signInToPortal(context, email)
    const menuPhoto = portal.locator('header [data-slot="avatar-image"]').first()
    await expect(menuPhoto).toHaveCount(0)
    await portal.goto('/profile')
    const photo = portal.getByRole('region', { name: 'Photo' })
    const input = portal.getByTestId('portal-photo-input')

    await input.setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: smallPng })
    await expect(photo.getByRole('button', { name: 'Change photo' })).toBeVisible()
    await expect(menuPhoto).toBeVisible()
    const session = async () =>
      object(await (await context.request.get('/api/v1/public/portal/session')).json())
    const first = text((await session()).avatar_url)
    expect(first).toMatch(/^\/api\/v1\/public\/portal\/avatar\?v=[0-9a-f]{12}$/)

    // A large photo is shrunk to 512 px in the browser before it goes up.
    await input.evaluate(async (element) => {
      const canvas = document.createElement('canvas')
      canvas.width = 1600
      canvas.height = 1200
      const context2d = canvas.getContext('2d')
      if (!context2d) throw new Error('no canvas')
      context2d.fillStyle = 'teal'
      context2d.fillRect(0, 0, 1600, 1200)
      const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, 'image/jpeg'))
      if (!blob) throw new Error('no blob')
      const files = new DataTransfer()
      files.items.add(new File([blob], 'big.jpg', { type: 'image/jpeg' }))
      if (!(element instanceof HTMLInputElement)) throw new Error('not an input')
      element.files = files.files
      element.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await expect.poll(async () => text((await session()).avatar_url)).not.toBe(first)
    // After a reload the photo comes from the API, at most 512 px a side.
    await portal.reload()
    await expect(menuPhoto).toBeVisible()
    const size = await menuPhoto.evaluate((image) =>
      image instanceof HTMLImageElement ? [image.naturalWidth, image.naturalHeight] : [],
    )
    expect(size).toEqual([512, 384])

    await photo.getByRole('button', { name: 'Remove' }).click()
    await portal.getByRole('dialog').getByRole('button', { name: 'Remove photo' }).click()
    await expect(photo.getByRole('button', { name: 'Upload photo' })).toBeVisible()
    await expect(menuPhoto).toHaveCount(0)
    expect((await session()).avatar_url).toBe('')
    expect((await context.request.get('/api/v1/public/portal/avatar')).status()).toBe(404)
  } finally {
    await context.close()
  }
})
