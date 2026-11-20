import { randomUUID } from 'node:crypto'

import type { BrowserContext } from '@playwright/test'

import {
  expect,
  object,
  portalAt,
  portalPath,
  portalURL,
  signIn,
  test,
  text,
  uniqueName,
} from './fixtures'

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

const at = portalAt

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

/** Signs `email` in through the login screen at `path` ("/w/<slug>/"); the page ends on that portal's overview. */
async function signInAt(context: BrowserContext, path: string, email: string) {
  const portal = await context.newPage()
  await portal.goto(`${path}login/`)
  await portal.getByLabel('Email', { exact: true }).fill(email)
  await portal.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(portal.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  const dev = await context.request.get(
    `/api/v1/auth/email/dev-code?email=${encodeURIComponent(email)}`,
  )
  await portal.getByLabel('Code', { exact: true }).fill(text(object(await dev.json()).code))
  await expect(portal).toHaveURL(at(path))
  return portal
}

test('the shared portal signs nobody in and emails the links; a client of two workspaces signs in at each address', async ({
  api,
  playwright,
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000) // the second sign-in waits out the per-address code cooldown
  const email = `two-ui-${randomUUID()}@example.test`
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
    const second = await other.save('/clients', {
      name: uniqueName('Second'),
      is_company: false,
      email,
    })
    await other.save(`/clients/${text(second.id)}`, { portal_enabled: true }, 'PATCH')
    const secondPath = await portalPath(staff)

    // The shared portal: no sign-in form, only the way to the suppliers' own links.
    const shared = await context.newPage()
    await shared.goto('/')
    await expect(shared).toHaveURL(/\/login\/?$/)
    await expect(
      shared.getByRole('heading', { name: "Sign in through your supplier's portal link" }),
    ).toBeVisible()
    await shared.getByLabel('Email', { exact: true }).fill(email)
    await shared.getByRole('button', { name: 'Email me my portal links' }).click()
    await expect(shared.getByRole('heading', { name: 'Check your inbox' })).toBeVisible()
    // The same answer for an address that is nobody's client, and no sign-in by API either.
    const answers = await Promise.all(
      [email, `nobody-${randomUUID()}@example.test`].map((address) =>
        context.request.post('/api/v1/public/portal/auth/links', { data: { email: address } }),
      ),
    )
    expect(answers.map((res) => res.status())).toEqual([202, 202])
    expect(await Promise.all(answers.map((res) => res.text()))).toEqual(['', ''])
    const refused = await Promise.all([
      context.request.post('/api/v1/public/portal/auth/start', { data: { email } }),
      context.request.post('/api/v1/public/portal/auth/verify', {
        data: { email, code: '123456' },
      }),
    ])
    expect(refused.map((res) => res.status())).toEqual([404, 404])
    expect((await session(context, '/')).status()).toBe(401)

    // Each address signs in on its own and opens only its own workspace.
    const one = await signInAt(context, firstPath, email)
    await expect(one.locator('header').getByLabel(firstName, { exact: true })).toBeVisible()
    expect((await session(context, secondPath)).status()).toBe(401)
    await code(context, secondPath, email) // waits out the address's cooldown; the screen then asks for a new code
    const two = await signInAt(context, secondPath, email)
    await expect(two.locator('header').getByLabel(secondName, { exact: true })).toBeVisible()
    const own = object(await (await session(context, secondPath)).json())
    expect(object(own.client).id).toBe(second.id)
    // The account switcher offers this workspace's clients only.
    expect(Array.isArray(own.clients) ? own.clients.map((c) => object(c).id) : []).toEqual([
      second.id,
    ])
    expect(object(object(await (await session(context, firstPath)).json()).client).id).toBe(
      first.id,
    )
    expect((await session(context, '/')).status()).toBe(401)
  } finally {
    await context.close()
    await staff.dispose()
  }
})

test('the owner turns the whole portal off in settings: the client is signed out and the address says it is not available; on again lets them back in', async ({
  api,
  page,
  browser,
}) => {
  test.setTimeout(120_000) // the second sign-in waits out the per-address code cooldown
  const email = `off-${randomUUID()}@example.test`
  const client = await api.save('/clients', { name: uniqueName('Off'), is_company: false, email })
  await api.save(`/clients/${text(client.id)}`, { portal_enabled: true }, 'PATCH')
  const path = await portalPath(api.request)
  const context = await browser.newContext({ baseURL: portalURL })
  try {
    const verified = await context.request.post(`${path}api/v1/public/portal/auth/verify`, {
      data: { email, code: await code(context, path, email) },
    })
    expect(verified.status()).toBe(201)
    await expect(await session(context, path)).toBeOK()

    await page.goto('/settings/workspace#portal-address')
    const toggle = page.getByRole('switch', { name: 'Client portal', exact: true })
    await expect(toggle).toBeChecked()
    await toggle.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('Turn off the client portal?')
    await dialog.getByRole('button', { name: 'Turn off', exact: true }).click()
    await expect(toggle).not.toBeChecked()

    // Off: the session is gone, no sign-in, and the address names nobody.
    expect((await session(context, path)).status()).toBe(401)
    const again = await context.request.post(`${path}api/v1/public/portal/auth/verify`, {
      data: { email, code: '000000' },
    })
    // No code is sent while off (the same answer as for an unknown address), so nothing verifies.
    expect(again.status()).not.toBe(201)
    expect((await session(context, path)).status()).toBe(401)
    const portal = await context.newPage()
    await portal.goto(`${path}login/`)
    await expect(
      portal.getByRole('heading', { name: 'The client portal is not available' }),
    ).toBeVisible()
    await expect(portal.getByLabel('Email', { exact: true })).toHaveCount(0)

    // On again (no question): the client's own access is as it was.
    await toggle.click()
    await expect(toggle).toBeChecked()
    const back = await context.request.post(`${path}api/v1/public/portal/auth/verify`, {
      data: { email, code: await code(context, path, email) },
    })
    expect(back.status()).toBe(201)
  } finally {
    await context.close()
  }
})
