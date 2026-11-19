import { randomUUID } from 'node:crypto'

import type { APIRequestContext, BrowserContext } from '@playwright/test'

import { expect, object, signIn, test, text, uniqueName } from './fixtures'

const portalURL = 'http://localhost:8009' // e2e/scripts/e2e-server.mjs

/** The workspace's portal path, "/w/<slug>/", as its settings show it. */
async function portalPath(request: APIRequestContext) {
  const res = await request.get('/api/v1/workspace/portal')
  await expect(res).toBeOK()
  const address = object(object(await res.json()).data)
  expect(text(address.url)).toBe(`${portalURL}/w/${text(address.slug)}/`)
  return `/w/${text(address.slug)}/`
}

/** Starts a portal sign-in under `prefix`, waiting out the per-address cooldown, and returns the code. */
async function code(context: BrowserContext, prefix: string, email: string) {
  let sent = await context.request.post(`${prefix}api/v1/public/portal/auth/start`, {
    data: { email },
  })
  if (sent.status() === 429) {
    const seconds = Number(object(object(object(await sent.json()).error).details).resend_in)
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000))
    sent = await context.request.post(`${prefix}api/v1/public/portal/auth/start`, {
      data: { email },
    })
  }
  expect(sent.status()).toBe(202)
  const dev = await context.request.get(
    `/api/v1/auth/email/dev-code?email=${encodeURIComponent(email)}`,
  )
  await expect(dev).toBeOK()
  return text(object(await dev.json()).code)
}

/** The portal page at `path`, with or without its trailing slash (next dev drops it, the static export keeps it). */
const at = (path: string) => new RegExp(`^${portalURL}${path.replace(/\/$/, '')}/?$`)

const session = async (context: BrowserContext, prefix: string) =>
  context.request.get(`${prefix}api/v1/public/portal/session`)

test('a client opens its supplier’s own portal address, signs in there and sees only that workspace', async ({
  api,
  browser,
}) => {
  const name = uniqueName('Treuhand')
  await api.save('/workspace', { name }, 'PATCH')
  const email = `scoped-${randomUUID()}@example.test`
  const client = await api.save('/clients', {
    name: uniqueName('Scoped'),
    is_company: false,
    email,
  })
  await api.save(`/clients/${text(client.id)}`, { portal_enabled: true }, 'PATCH')
  const path = await portalPath(api.request)

  const context = await browser.newContext({ baseURL: portalURL })
  try {
    const portal = await context.newPage()
    await portal.goto(path)
    await expect(portal).toHaveURL(at(`${path}login/`))
    await expect(portal.getByText(name, { exact: true })).toBeVisible()
    await portal.getByLabel('Email', { exact: true }).fill(email)
    await portal.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(portal.getByRole('heading', { name: 'Check your email' })).toBeVisible()
    const dev = await context.request.get(
      `/api/v1/auth/email/dev-code?email=${encodeURIComponent(email)}`,
    )
    await portal.getByLabel('Code', { exact: true }).fill(text(object(await dev.json()).code))
    await expect(portal).toHaveURL(at(path))
    await expect(portal.locator('header').getByLabel(name, { exact: true })).toBeVisible()

    // Links stay inside the workspace's address.
    await portal.getByRole('link', { name: 'Invoices', exact: true }).click()
    await expect(portal).toHaveURL(at(`${path}invoices/`))

    // The scoped session reads under its own address only.
    const own = object(await (await session(context, path)).json())
    expect(object(own.client).id).toBe(client.id)
    expect((await session(context, '/')).status()).toBe(401)

    // A new address: the old one still leads to the workspace (the Go server 301s its pages, internal/portalscope;
    // E2E serves pages from next dev) and the session carries on under the new one.
    const slug = `s-${randomUUID().slice(0, 12)}`
    await api.save('/workspace/portal', { slug }, 'PUT')
    const old = object(
      await (await context.request.get(`${path}api/v1/public/portal/scope`)).json(),
    )
    expect(old.slug).toBe(slug)
    expect(old.url).toBe(`${portalURL}/w/${slug}/`)
    await portal.goto(`/w/${slug}/invoices/`)
    await expect(portal.getByRole('link', { name: 'Invoices', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )

    // An address nobody has: the API knows no such workspace (the Go server answers its pages with the 404 page).
    const unknown = await context.request.get(
      '/w/no-such-workspace-here/api/v1/public/portal/scope',
    )
    expect(unknown.status()).toBe(404)
  } finally {
    await context.close()
  }
})

test('one address, client of two workspaces, signs in on each address separately', async ({
  api,
  playwright,
  browser,
  baseURL,
}) => {
  const email = `two-${randomUUID()}@example.test`
  const first = await api.save('/clients', { name: uniqueName('First'), is_company: false, email })
  await api.save(`/clients/${text(first.id)}`, { portal_enabled: true }, 'PATCH')
  const firstPath = await portalPath(api.request)

  const staff = await playwright.request.newContext({ baseURL })
  const context = await browser.newContext({ baseURL: portalURL })
  try {
    const other = await signIn(staff, `other-${randomUUID()}@example.test`)
    const second = await other.save('/clients', {
      name: uniqueName('Second'),
      is_company: false,
      email,
    })
    await other.save(`/clients/${text(second.id)}`, { portal_enabled: true }, 'PATCH')
    const secondPath = await portalPath(staff)
    expect(secondPath).not.toBe(firstPath)

    // Signed in on the first address: nothing on the second.
    const verified = await context.request.post(`${firstPath}api/v1/public/portal/auth/verify`, {
      data: { email, code: await code(context, firstPath, email) },
    })
    expect(verified.status()).toBe(201)
    const one = object(await (await session(context, firstPath)).json())
    expect(object(one.client).id).toBe(first.id)
    expect(Array.isArray(one.clients) ? one.clients.length : 0).toBe(1)
    expect((await session(context, secondPath)).status()).toBe(401)
    const foreign = await context.request.get(`${secondPath}api/v1/public/portal/invoices`)
    expect(foreign.status()).toBe(401)

    // Then on the second: both sessions live side by side, each in its own workspace.
    const again = await context.request.post(`${secondPath}api/v1/public/portal/auth/verify`, {
      data: { email, code: await code(context, secondPath, email) },
    })
    expect(again.status()).toBe(201)
    expect(object(object(await (await session(context, secondPath)).json()).client).id).toBe(
      second.id,
    )
    expect(object(object(await (await session(context, firstPath)).json()).client).id).toBe(
      first.id,
    )
    // Switching to the other workspace's client is refused under a scope.
    const csrf = text(object(await again.json()).csrf_token)
    const switched = await context.request.post(
      `${secondPath}api/v1/public/portal/session/client`,
      { data: { client_id: first.id }, headers: { 'X-CSRF-Token': csrf } },
    )
    expect(switched.status()).toBe(404)
  } finally {
    await context.close()
    await staff.dispose()
  }
})

test('a client of two workspaces signs in on the shared portal, chooses the second and lands in its portal', async ({
  api,
  playwright,
  browser,
  baseURL,
}) => {
  const email = `choose-${randomUUID()}@example.test`
  const firstName = uniqueName('First Treuhand')
  await api.save('/workspace', { name: firstName }, 'PATCH')
  const first = await api.save('/clients', { name: uniqueName('First'), is_company: false, email })
  await api.save(`/clients/${text(first.id)}`, { portal_enabled: true }, 'PATCH')
  const firstPath = await portalPath(api.request)

  const staff = await playwright.request.newContext({ baseURL })
  const context = await browser.newContext({ baseURL: portalURL })
  try {
    const other = await signIn(staff, `other-${randomUUID()}@example.test`)
    const secondName = uniqueName('Second Studio')
    await other.save('/workspace', { name: secondName }, 'PATCH')
    const secondClient = uniqueName('Second')
    const second = await other.save('/clients', { name: secondClient, is_company: false, email })
    await other.save(`/clients/${text(second.id)}`, { portal_enabled: true }, 'PATCH')
    const secondPath = await portalPath(staff)

    const portal = await context.newPage()
    await portal.goto('/login/')
    await portal.getByLabel('Email', { exact: true }).fill(email)
    await portal.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(portal.getByRole('heading', { name: 'Check your email' })).toBeVisible()
    const dev = await context.request.get(
      `/api/v1/auth/email/dev-code?email=${encodeURIComponent(email)}`,
    )
    await portal.getByLabel('Code', { exact: true }).fill(text(object(await dev.json()).code))

    // Both accounts, before any session: the choice opens nothing on the shared portal.
    await expect(portal.getByRole('heading', { name: 'Choose an account' })).toBeVisible()
    await expect(
      portal.getByRole('button', { name: `${firstName} as ${text(first.name)}` }),
    ).toBeVisible()
    const pick = portal.getByRole('button', { name: `${secondName} as ${secondClient}` })
    await expect(pick).toBeVisible()
    expect((await session(context, '/')).status()).toBe(401)

    await pick.click()
    await expect(portal).toHaveURL(at(secondPath))
    await expect(portal.locator('header').getByLabel(secondName, { exact: true })).toBeVisible()

    // Signed in to the second workspace's portal only.
    const own = object(await (await session(context, secondPath)).json())
    expect(object(own.client).id).toBe(second.id)
    expect(Array.isArray(own.clients) ? own.clients.length : 0).toBe(1)
    expect((await session(context, firstPath)).status()).toBe(401)
    expect((await session(context, '/')).status()).toBe(401)
    expect((await context.request.get(`${firstPath}api/v1/public/portal/invoices`)).status()).toBe(
      401,
    )
  } finally {
    await context.close()
    await staff.dispose()
  }
})
