import type { Page } from '@playwright/test'

import { expect, object, openPage, test, text, uniqueName, type FinancialAPI } from './fixtures'

const csv = (name: string) => `name,email,city,country\n${name},alpha@example.test,Zürich,CH\n`

/**
 * Opens the clients import with one CSV chosen and asks for it to be read: the first AI use asks for approval. E2E
 * fakes only the import model (HELVETLY_E2E_FAKE_AI), so Heidi's usage says no provider and the platform would let the
 * server refuse instead of asking; only that flag is changed, the approval itself stays the server's.
 */
async function readWithAI(page: Page, name: string) {
  await page.route('**/api/v1/heidi/usage', async (route) => {
    const response = await route.fetch()
    await route.fulfill({
      response,
      json: { ...object(await response.json()), provider_available: true },
    })
  })
  await openPage(page, '/clients', 'Clients')
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Import', exact: true }).click()
  const drawer = page.getByRole('dialog', { name: 'Import clients' })
  await drawer.getByLabel('Choose files to import').setInputFiles({
    name: 'clients.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv(name), 'utf8'),
  })
  await drawer.getByRole('button', { name: 'Process with AI', exact: true }).click()
  return drawer
}

const consentOf = async (api: FinancialAPI) => object((await api.consent()).data)

test('an approval names the notice in force; a platform without versions is refused and nothing changes', async ({
  api,
}) => {
  const notice = object((await api.consent()).notice)
  const refusals = await Promise.all(
    [{ granted: true }, { granted: true, version: '2000-01-01' }].map((body) =>
      api.write('/heidi/consent', body, 'PUT'),
    ),
  )
  for (const refused of refusals) expect(refused.status()).toBe(409)
  const codes = await Promise.all(
    refusals.map(async (refused) => object(object(await refused.json()).error).code),
  )
  expect(codes).toEqual(['ai_consent_version_changed', 'ai_consent_version_changed'])
  expect(await consentOf(api)).toMatchObject({
    granted: false,
    changed_at: null,
    current_version: notice.version,
  })
  // a withdrawal is taken whatever the card showed
  await expect(
    await api.write('/heidi/consent', { granted: false, version: '2000-01-01' }, 'PUT'),
  ).toBeOK()
})

test('a tab still showing an earlier notice is refused, shown the current one and approves only that', async ({
  page,
  api,
}) => {
  const current = object((await api.consent()).notice)
  let reads = 0
  // the tab read the notice before a new one was deployed
  await page.route('**/api/v1/heidi/consent?*', async (route) => {
    if (++reads > 1) return route.fallback()
    const response = await route.fetch()
    const body = object(await response.json())
    await route.fulfill({
      response,
      json: {
        ...body,
        notice: { ...object(body.notice), version: '2000-01-01', lead: 'The earlier notice.' },
      },
    })
  })
  const name = uniqueName('Notice Alpha')
  const drawer = await readWithAI(page, name)
  const ask = page.getByRole('dialog', { name: text(current.title) })
  await expect(ask.getByText('The earlier notice.')).toBeVisible()
  const refused = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/heidi/consent') && response.request().method() === 'PUT',
  )
  await ask.getByRole('button', { name: 'Approve and continue' }).click()
  expect((await refused).status()).toBe(409)
  await expect(ask.getByRole('status')).toContainText('This notice has changed since it was shown')
  await expect(ask.getByText(text(current.lead))).toBeVisible()
  expect(await consentOf(api)).toMatchObject({ granted: false }) // never approved on the person's behalf

  await ask.getByRole('button', { name: 'Approve and continue' }).click()
  await expect(
    drawer.getByRole('table', { name: 'Records found' }).getByText(name, { exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  })
  expect(await consentOf(api)).toMatchObject({ granted: true, version: current.version })
})

test('after a withdrawal the next AI use asks again, with the current notice, before anything is read', async ({
  page,
  api,
}) => {
  await api.approveAI()
  await expect(await api.write('/heidi/consent', { granted: false }, 'PUT')).toBeOK()
  const current = object((await api.consent()).notice)
  const uploads: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/v1/imports'))
      uploads.push(request.url())
  })
  const name = uniqueName('Notice Beta')
  const drawer = await readWithAI(page, name)
  const ask = page.getByRole('dialog', { name: text(current.title) })
  await expect(ask.getByText(text(current.lead))).toBeVisible()
  expect(uploads).toEqual([])
  await ask.getByRole('button', { name: 'Approve and continue' }).click()
  await expect(
    drawer.getByRole('table', { name: 'Records found' }).getByText(name, { exact: true }),
  ).toBeVisible({
    timeout: 30_000,
  })
  expect(uploads).toHaveLength(1)
  expect(await consentOf(api)).toMatchObject({ granted: true, version: current.version })
})
