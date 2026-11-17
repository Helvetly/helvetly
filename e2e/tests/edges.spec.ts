import { randomUUID } from 'node:crypto'

import type { BrowserContext } from '@playwright/test'

import { expect, object, openPage, signIn, test, text } from './fixtures'

test('invited read-only member can read clients but cannot edit or access invoices', async ({
  api,
  browser,
  baseURL,
}) => {
  const client = await api.client()
  const email = `e2e-member-${randomUUID()}@example.test`
  const invitation = await api.save('/members/invitations', {
    email,
    role: 'member',
    scopes: ['read:clients'],
    send_email: false,
  })
  const token = new URL(text(invitation.url)).searchParams.get('token')
  expect(token).toBeTruthy()
  const context = await browser.newContext({ baseURL })
  try {
    const member = await signIn(context.request, email)
    // A new verified identity automatically claims its open address-bound invitations.
    const replay = await member.write('/invitations/accept', { token })
    await expect(replay).toBeOK()
    member.csrf = text(object(await replay.json()).csrf_token)
    expect((await member.read(`/clients/${text(client.id)}`)).name).toBe(client.name)
    expect(
      (await member.write(`/clients/${text(client.id)}`, { name: 'Denied' }, 'PATCH')).status(),
    ).toBe(403)
    expect((await member.request.get('/api/v1/invoices')).status()).toBe(403)
    const page = await context.newPage()
    await openPage(page, '/clients', 'Read-only clients')
    await expect(page.getByText(text(client.name), { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'New client', exact: true })).toHaveCount(0)
    await page.goto('/invoices')
    await expect(
      page.getByText(/You don.t have access|No access|Access denied/).first(),
    ).toBeVisible()
  } finally {
    await context.close()
  }
})

test('closed months reject financial writes and reopening restores the process', async ({
  page,
  api,
}) => {
  await api.settings()
  const month = '2025-01'
  await api.save('/periods', { month })
  const draft = await api.draft(await api.client(), {
    issue_date: `${month}-15`,
    due_date: `${month}-30`,
  })
  const blocked = await api.write(`/invoices/${text(draft.id)}/issue`)
  expect(blocked.status()).toBe(409)
  expect(object(object(await blocked.json()).error).code).toBe('period_closed')
  await openPage(page, '/books', 'Accounting periods')
  await expect(page.getByRole('listitem', { name: 'January 2025' })).toContainText('Closed')
  await api.save(`/periods/${month}/reopen`)
  expect((await api.save(`/invoices/${text(draft.id)}/issue`)).status).toBe('open')
})

test.describe('core page layouts', () => {
  let authenticatedState: Awaited<ReturnType<BrowserContext['storageState']>> | undefined
  // These read-only cases share a session to stay within the API's per-IP sign-in budget.
  test.use({
    storageState: async ({ browser, baseURL }, use) => {
      if (!authenticatedState) {
        const context = await browser.newContext({ baseURL })
        try {
          const api = await signIn(context.request, `e2e-layout-${randomUUID()}@example.test`)
          await api.settings()
          authenticatedState = await context.storageState()
        } finally {
          await context.close()
        }
      }
      await use(authenticatedState)
    },
  })
  const routes = [
    'clients',
    'products',
    'invoices',
    'expenses',
    'documents',
    'members',
    'engagements',
    'account',
    'settings/billing/plans',
  ]
  for (const width of [375, 1440]) {
    for (const theme of ['light', 'dark']) {
      for (const route of routes) {
        test(`${route} fits ${width}px in ${theme} without horizontal overflow`, async ({
          page,
        }, testInfo) => {
          test.setTimeout(120_000)
          await page.setViewportSize({ width, height: 900 })
          await page.emulateMedia({ colorScheme: theme === 'dark' ? 'dark' : 'light' })
          await openPage(page, `/${route}`, route)
          if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/)
          else await expect(page.locator('html')).not.toHaveClass(/dark/)
          if (route === 'account') {
            await expect(
              page.getByRole('heading', { name: 'Account settings', exact: true }),
            ).toBeVisible()
            await expect(page.getByLabel(/^Full name\*?$/)).toBeVisible()
            await expect(page.getByRole('button', { name: 'Turn on', exact: true })).toBeVisible()
            await expect(
              page.getByRole('button', { name: 'Add passkey', exact: true }),
            ).toBeVisible()
          }
          if (route === 'settings/billing/plans')
            await expect(
              page.getByRole('heading', { name: 'Choose a plan', exact: true }),
            ).toBeVisible()
          await page.evaluate(() => document.fonts.ready)
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth),
          ).toBeLessThanOrEqual(width)
          await page.screenshot({
            path: testInfo.outputPath(`${route}-${width}-${theme}.png`),
            animations: 'disabled',
          })
        })
      }
    }
  }
})

test('the dashboard names itself and its period filter drives the key figures', async ({
  page,
  api,
}) => {
  await api.settings()
  const draft = await api.draft(await api.client()) // 1,000.00 + 8.1% VAT = 1,081.00
  await api.save(`/invoices/${text(draft.id)}/issue`)
  await api.save(`/invoices/${text(draft.id)}/mark-paid`)
  await openPage(page, '/', 'Dashboard')
  await expect(page.getByRole('navigation', { name: 'Views' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Save a view' })).toHaveCount(0)
  const figures = page.getByRole('region', { name: 'Key figures' })
  await expect(figures).toContainText('Paid this month')
  await expect(figures).toContainText(/1.081/)
  await page.getByRole('button', { name: /^Period: This month/ }).click()
  await page.getByRole('menuitemradio', { name: 'Last month' }).click()
  await expect(figures).toContainText('Paid last month')
  await expect(figures).not.toContainText(/1.081/)
  await page.reload()
  await expect(page.getByRole('button', { name: /^Period: Last month/ })).toBeVisible()
})
