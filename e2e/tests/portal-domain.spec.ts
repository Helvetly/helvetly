import { randomUUID } from 'node:crypto'

import type { APIRequestContext } from '@playwright/test'

import { expect, object, test, text, uniqueName } from './fixtures'

// The Go API itself (e2e/scripts/e2e-server.mjs): requests carry a customer's Host as Caddy passes it,
// which the next dev servers in front of it would not.
const apiOrigin = 'http://127.0.0.1:3338'
const portalHost = 'localhost:8009'

test('a workspace adds its own portal domain, its DNS checks pass, it becomes active and that host serves its portal', async ({
  api,
  playwright,
}) => {
  const name = uniqueName('Domain')
  await api.save('/workspace', { name }, 'PATCH')
  const email = `domain-${randomUUID()}@example.test`
  const client = await api.save('/clients', {
    name: uniqueName('Client'),
    is_company: false,
    email,
  })
  await api.save(`/clients/${text(client.id)}`, { portal_enabled: true }, 'PATCH')
  const slug = text(object(await api.read('/workspace/portal')).slug)
  const host = `portal.e2e-${randomUUID().slice(0, 8)}.ch`

  // Added: pending, with the CNAME to the target and the TXT record that proves the domain is the workspace's.
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
    { type: 'CNAME', name: host, value: 'domains.helvetly.com' },
    {
      type: 'TXT',
      name: `_helvetly-verify.${host}`,
      value: expect.stringMatching(/^helvetly-[0-9a-f]{32}$/),
    },
  ])

  const on = async (h: string): Promise<APIRequestContext> =>
    playwright.request.newContext({
      baseURL: apiOrigin,
      extraHTTPHeaders: { Host: h },
      maxRedirects: 0,
    })
  const domain = await on(host)
  const portal = await on(portalHost)
  try {
    // Not served while pending, and no certificate before the TXT record proves the domain is the workspace's.
    const certifiable = async () =>
      (await portal.get(`/api/v1/public/portal/domain-check?domain=${host}`)).status()
    expect((await domain.get('/api/v1/public/portal/scope')).status()).toBe(404)
    expect(await certifiable()).toBe(404)

    // "Re-check" (at most every 10 s): the records are found (HELVETLY_E2E_FAKE_DOMAINS) and HTTPS answers.
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
    expect(await certifiable()).toBe(200)

    // The host is the workspace's portal: its scope at the root, the address it names is the domain.
    const scope = object(await (await domain.get('/api/v1/public/portal/scope')).json())
    expect(scope.name).toBe(name)
    expect(scope.url).toBe(`http://${host}/`)

    // A client signs in there; the session holds on that host only.
    await expect(
      await domain.post('/api/v1/public/portal/auth/start', { data: { email } }),
    ).toBeOK()
    const dev = await api.request.get(
      `/api/v1/auth/email/dev-code?email=${encodeURIComponent(email)}`,
    )
    const verified = await domain.post('/api/v1/public/portal/auth/verify', {
      data: { email, code: text(object(await dev.json()).code) },
    })
    expect(verified.status()).toBe(201)
    const cookie = verified.headers()['set-cookie'] ?? ''
    expect(cookie).not.toMatch(/domain=/i)
    expect(
      object(object(await (await domain.get('/api/v1/public/portal/session')).json()).client).id,
    ).toBe(client.id)

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
  } finally {
    await domain.dispose()
    await portal.dispose()
  }
})
