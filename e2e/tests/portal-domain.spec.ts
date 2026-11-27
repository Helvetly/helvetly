import { randomUUID } from 'node:crypto'

import type { APIRequestContext, Page } from '@playwright/test'

import { expect, object, portalURL, test, text, uniqueName } from './fixtures'

// The Go API itself (e2e/scripts/e2e-server.mjs), against a fake Cloudflare: requests carry a customer's Host as
// Cloudflare and Caddy pass it, which the next dev servers in front of it would not.
const apiOrigin = 'http://127.0.0.1:3338'
const portalHost = 'localhost:8009'

async function checkLoginBrand(page: Page, email: string, name: string, logo: string) {
  const mark = page.locator(`img[src="${logo}"]`)
  await expect(page.getByRole('heading', { name: 'Client portal', exact: true })).toBeVisible()
  await expect(mark).toBeVisible()
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()
  await expect(mark).toBeVisible()
  await expect(page).toHaveTitle(`Sign in · Client portal · ${name}`)
  await expect(page.locator(`head link[rel="icon"][href="${logo}"]`)).toHaveCount(1)
}

test('a workspace adds its own portal domain, Cloudflare and its TXT record make it active and that host serves its portal', async ({
  api,
  browser,
  page,
  playwright,
}) => {
  const name = uniqueName('Domain')
  await api.save('/workspace', { name }, 'PATCH')
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 64
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is unavailable')
    context.fillStyle = '#a83122'
    context.fillRect(0, 0, 64, 64)
    return canvas.toDataURL().split(',')[1] ?? ''
  })
  await expect(
    await api.request.put('/api/v1/workspace/logo', {
      headers: { 'X-CSRF-Token': api.csrf },
      multipart: {
        file: { name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') },
      },
    }),
  ).toBeOK()
  const email = `domain-${randomUUID()}@example.test`
  const client = await api.save('/clients', {
    name: uniqueName('Client'),
    is_company: false,
    email,
  })
  await api.save(`/clients/${text(client.id)}`, { portal_enabled: true }, 'PATCH')
  const slug = text(object(await api.read('/workspace/portal')).slug)
  const host = `portal.e2e-${randomUUID().slice(0, 8)}.ch`

  // Added: pending, with the CNAME to the portal's host and the TXT record Cloudflare names to prove ownership.
  const added = object(
    (
      await api.save(
        '/workspace/portal/domain',
        { hostname: `https://${host.toUpperCase()}/` },
        'PUT',
      )
    ).domain,
  )
  expect(added.hostname).toBe(host)
  expect(added.stage).toBe('dns')
  expect(added.records).toEqual([
    { type: 'CNAME', name: host, value: 'portal.helvetly.com' },
    { type: 'TXT', name: `_cf-custom-hostname.${host}`, value: expect.any(String) },
  ])

  const on = async (h: string): Promise<APIRequestContext> =>
    playwright.request.newContext({
      baseURL: apiOrigin,
      extraHTTPHeaders: { Host: h },
      maxRedirects: 0,
    })
  const domain = await on(host)
  const portal = await on(portalHost)
  const custom = await browser.newContext({ baseURL: portalURL })
  const slugContext = await browser.newContext({
    baseURL: portalURL,
    viewport: { width: 390, height: 844 },
    colorScheme: 'dark',
  })
  const pendingScope = Promise.withResolvers<void>()
  try {
    // Not served while pending: no portal, no API.
    expect((await domain.get('/')).status()).toBe(404)
    expect((await domain.get('/api/v1/public/portal/scope')).status()).toBe(404)

    // "Re-check" (at most every 10 s): Cloudflare has seen the CNAME and issued the certificate, and the TXT record
    // is found (HELVETLY_E2E_FAKE_DOMAINS).
    await expect
      .poll(
        async () => {
          const res = await api.write('/workspace/portal/domain/check', {})
          return res.ok()
            ? object(object(object(await res.json()).data).domain).status
            : res.status()
        },
        { timeout: 30_000, intervals: [2_000] },
      )
      .toBe('active')

    // The host is the workspace's portal: its scope at the root, the address it names is the domain.
    const scope = object(await (await domain.get('/api/v1/public/portal/scope')).json())
    expect(scope.name).toBe(name)
    expect(scope.url).toBe(`http://${host}/`)

    // Next dev serves the UI. Send its unprefixed requests to Go as the customer's host.
    let cookie = ''
    await custom.route('**/api/v1/public/portal/**', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      const path = url.pathname + url.search
      if (path.endsWith('/scope')) await pendingScope.promise
      const response = await route.fetch({
        url: new URL(path, apiOrigin).href,
        headers: { ...(await request.allHeaders()), Host: host },
        maxRedirects: 0,
      })
      if (path.endsWith('/auth/verify')) cookie = response.headers()['set-cookie'] ?? ''
      await route.fulfill({ response })
    })
    const clientPortal = await custom.newPage()
    const logo = text(scope.logo_url)
    await clientPortal.goto('/login')
    await expect(clientPortal.locator('[data-slot="loader"][aria-busy="true"]')).toBeVisible()
    await expect(clientPortal.locator('main img, main .logo-teal')).toHaveCount(0)
    pendingScope.resolve()
    await checkLoginBrand(clientPortal, email, name, logo)
    // A client signs in there; the session holds on that host only.
    const dev = await api.request.get(
      `/api/v1/auth/email/dev-code?email=${encodeURIComponent(email)}`,
    )
    const code = text(object(await dev.json()).code)
    const [verified, session] = await Promise.all([
      clientPortal.waitForResponse('**/api/v1/public/portal/auth/verify'),
      clientPortal.waitForResponse(
        (response) => response.ok() && response.url().endsWith('/api/v1/public/portal/session'),
      ),
      clientPortal.getByLabel('Code', { exact: true }).fill(code),
    ])
    expect(verified.status()).toBe(201)
    expect(cookie).toContain('portal_session')
    expect(cookie).not.toMatch(/domain=/i)
    expect(object(object(await session.json()).client).id).toBe(client.id)
    await expect(clientPortal.locator(`header img[src="${logo}"]`)).toBeVisible()

    await api.save('/workspace/portal/access', { enabled: false }, 'PUT')
    await clientPortal.goto('/login')
    await expect(
      clientPortal.getByRole('heading', { name: 'The client portal is not available' }),
    ).toBeVisible()
    await expect(clientPortal.getByText(name, { exact: true })).toHaveCount(0)
    await expect(clientPortal.locator(`head link[href="${logo}"]`)).toHaveCount(0)
    await api.save('/workspace/portal/access', { enabled: true }, 'PUT')

    // Never the staff app or its API on a customer's host, and an unknown host is no portal at all.
    expect((await domain.get('/api/v1/workspace')).status()).toBe(404)
    const stranger = await on(`portal.unknown-${randomUUID().slice(0, 8)}.ch`)
    expect((await stranger.get('/')).status()).toBe(404)
    expect((await stranger.get('/api/v1/public/portal/scope')).status()).toBe(404)
    await stranger.dispose()

    // The slug address moves to the domain while it works (302: it may break).
    const moved = await portal.get(`/w/${slug}/invoices/`)
    expect(moved.status()).toBe(302)
    expect(moved.headers().location).toBe(`http://${host}/invoices/`)

    // Removed: the slug serves again and the host is nobody's.
    expect((await api.write('/workspace/portal/domain', {}, 'DELETE')).status()).toBe(204)
    await expect
      .poll(async () => (await portal.get(`/w/${slug}/`)).status(), { timeout: 35_000 })
      .not.toBe(302)
    await expect
      .poll(async () => (await domain.get('/api/v1/public/portal/scope')).status(), {
        timeout: 35_000,
      })
      .toBe(404)
    const slugPage = await slugContext.newPage()
    await slugPage.goto(`/w/${slug}/login`)
    await checkLoginBrand(slugPage, `slug-${randomUUID()}@example.test`, name, `/w/${slug}${logo}`)
  } finally {
    pendingScope.resolve()
    await custom.close()
    await slugContext.close()
    await domain.dispose()
    await portal.dispose()
  }
})
