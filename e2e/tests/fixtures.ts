import { randomUUID } from 'node:crypto'

import {
  expect,
  test as base,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'

export function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected an API object')
  return Object.fromEntries(Object.entries(value))
}

export function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Expected an API string')
  return value
}

export const uniqueName = (prefix: string) => `${prefix} ${randomUUID().slice(0, 8)}`
export const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Zurich' })

export class FinancialAPI {
  constructor(
    readonly request: APIRequestContext,
    public csrf: string,
    readonly emailResendAt = 0,
  ) {}

  async waitForEmailResend() {
    const wait = this.emailResendAt - Date.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  }

  async write(path: string, data: unknown = {}, method = 'POST') {
    return this.request.fetch(`/api/v1${path}`, {
      method,
      data,
      headers: { 'X-CSRF-Token': this.csrf },
    })
  }

  async save(path: string, data?: unknown, method = 'POST') {
    const response = await this.write(path, data, method)
    expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBe(true)
    return object(object(await response.json()).data)
  }

  /** Approves AI use for this person in this workspace, naming the notice version in force as the platform does. */
  async approveAI() {
    const notice = object((await this.consent()).notice)
    await expect(
      await this.write('/heidi/consent', { granted: true, version: notice.version }, 'PUT'),
    ).toBeOK()
  }

  async consent() {
    const response = await this.request.get('/api/v1/heidi/consent?lang=en')
    await expect(response).toBeOK()
    return object(await response.json())
  }

  async read(path: string) {
    const response = await this.request.get(`/api/v1${path}`)
    await expect(response).toBeOK()
    return object(object(await response.json()).data)
  }

  async settings() {
    return this.save(
      '/invoice-settings',
      {
        seller: {
          name: 'E2E Zürich GmbH',
          street: 'Bahnhofstrasse',
          street_number: '1',
          zip: '8001',
          city: 'Zürich',
          country: 'CH',
          vat_number: 'CHE-109.322.551 MWST',
          legal_form: 'gmbh',
        },
        iban: 'CH4431999123000889012',
      },
      'PUT',
    )
  }

  async client(name = uniqueName('E2E Client')) {
    return this.save('/clients', {
      name,
      street: 'Rue du Lac',
      street_number: '12',
      zip: '1003',
      city: 'Lausanne',
      country: 'CH',
      email: 'client@example.test',
      language: 'en',
      currency: 'CHF',
    })
  }

  async draft(client: Record<string, unknown>, extra: Record<string, unknown> = {}) {
    return this.save('/invoices', {
      client_id: text(client.id),
      language: 'en',
      lines: [
        {
          description: 'Consulting',
          quantity: '10',
          unit_price: '100',
          vat_category: 'S',
          vat_rate: '8.1',
        },
      ],
      ...extra,
    })
  }
}

export async function signIn(request: APIRequestContext, email: string) {
  let sent = await request.post('/api/v1/auth/email/start', { data: { email } })
  if (sent.status() === 429) {
    const error = object(object(await sent.json()).error)
    expect(error.code).toBe('code_cooldown')
    const seconds = object(error.details).resend_in
    if (typeof seconds !== 'number' || seconds < 0 || seconds > 60)
      throw new Error('Invalid email resend cooldown')
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000))
    sent = await request.post('/api/v1/auth/email/start', { data: { email } })
  }
  expect(sent.status()).toBe(202)
  const seconds = object(await sent.json()).resend_in
  if (typeof seconds !== 'number') throw new Error('Missing email resend cooldown')
  const emailResendAt = Date.now() + (seconds + 1) * 1000
  const devCode = await request.get(
    `/api/v1/auth/email/dev-code?email=${encodeURIComponent(email)}`,
  )
  await expect(devCode).toBeOK()
  const code = text(object(await devCode.json()).code)
  const verified = await request.post('/api/v1/auth/email/verify', {
    data: { email, code, next: '/clients', timezone: 'Europe/Zurich' },
  })
  await expect(verified).toBeOK()
  const csrf = text(object(await verified.json()).csrf_token)
  const api = new FinancialAPI(request, csrf, emailResendAt)
  const session = object(await (await request.get('/api/v1/session')).json())
  if (session.onboarded === false && (session.role === 'owner' || session.role === 'admin')) {
    await api.settings() // the server refuses to finish the welcome without the company details
    await expect(await api.write('/session/onboarded')).toBeOK()
  }
  return api
}

export type Person = {
  api: FinancialAPI
  context: BrowserContext
  page: Page
  id: string
  name: string
}

/** Invites a member who may read everything, signs them in in their own browser context and names them. */
export async function join(
  owner: FinancialAPI,
  browser: Browser,
  baseURL: string | undefined,
  name: string,
): Promise<Person> {
  const email = `e2e-approver-${randomUUID()}@example.test`
  await owner.save('/members/invitations', {
    email,
    role: 'member',
    scopes: ['read:*'],
    send_email: false,
  })
  const context = await browser.newContext({ baseURL })
  const api = await signIn(context.request, email)
  await expect(await api.write('/account', { name }, 'PATCH')).toBeOK()
  const session = object(await (await context.request.get('/api/v1/session')).json())
  return { api, context, page: await context.newPage(), id: text(object(session.user).id), name }
}

export const test = base.extend<{ api: FinancialAPI; email: string; runtimeErrors: void }>({
  runtimeErrors: [
    async ({ page }, use, testInfo) => {
      const errors: string[] = []
      const consoleMessages: { level: string; message: string }[] = []
      const failedResponses: { path: string; status: number }[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error' || message.type() === 'warning')
          consoleMessages.push({ level: message.type(), message: message.text() })
      })
      page.on('response', (response) => {
        if (response.status() >= 400)
          failedResponses.push({
            path: new URL(response.url()).pathname,
            status: response.status(),
          })
      })
      await use()
      await testInfo.attach('browser-runtime', {
        body: JSON.stringify({ errors, consoleMessages, failedResponses }, null, 2),
        contentType: 'application/json',
      })
      expect(errors, 'Uncaught browser exceptions').toEqual([])
      expect(
        failedResponses.filter(
          ({ path, status }) =>
            status === 404 &&
            path.startsWith('/api/v1/') &&
            !/^\/api\/v1\/heidi\/conversations\/[A-Za-z0-9_-]+$/.test(path),
        ),
        'Unexpected missing application API routes',
      ).toEqual([])
    },
    { auto: true },
  ],
  email: async ({ browserName }, use) => {
    await use(`${browserName}-e2e-${randomUUID()}@example.test`)
  },
  api: async ({ page, email }, use) => {
    await use(await signIn(page.request, email))
  },
})

export async function openPage(page: Page, path: string, heading: string) {
  await page.goto(path)
  await expect(page.locator('main'), heading).toBeVisible()
}

export const portalURL = 'http://localhost:8009' // e2e/scripts/e2e-server.mjs

/** The workspace's portal path, "/w/<slug>/", as its settings show it: clients sign in only there. */
export async function portalPath(request: APIRequestContext) {
  const res = await request.get('/api/v1/workspace/portal')
  await expect(res).toBeOK()
  const address = object(object(await res.json()).data)
  expect(text(address.url)).toBe(`${portalURL}/w/${text(address.slug)}/`)
  return `/w/${text(address.slug)}/`
}

/** The portal page at `path`, with or without its trailing slash (next dev drops it, the static export keeps it). */
export const portalAt = (path: string) => new RegExp(`^${portalURL}${path.replace(/\/$/, '')}/?$`)

export { expect }
