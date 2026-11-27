import { randomUUID } from 'node:crypto'

import { expect, object, portalAt, portalPath, portalURL, test, text, uniqueName } from './fixtures'
import { soon, zurichLocal } from './scheduling-fixtures'

// A company's participant (an employee who takes the lessons) signs in to the company's portal and sees only their
// own sessions: never the company's invoices, engagements, other participants' sessions or its profile.
test('a participant signs in to the company portal and sees only their own sessions', async ({
  api,
  browser,
}) => {
  await api.settings()
  const company = await api.client(uniqueName('EuroChem Group AG'))
  const companyId = text(company.id)
  await api.save(
    `/clients/${companyId}`,
    { is_company: true, email: `office-${randomUUID()}@example.test`, portal_enabled: true },
    'PATCH',
  )
  const lorenzoEmail = `lorenzo-${randomUUID()}@example.test`
  const lorenzo = await api.save(`/clients/${companyId}/contacts`, {
    name: 'Lorenzo Percic',
    email: lorenzoEmail,
    roles: ['participant'],
    portal_enabled: true,
  })
  const liam = await api.save(`/clients/${companyId}/contacts`, {
    name: 'Liam Gallagher',
    email: `liam-${randomUUID()}@example.test`,
    roles: ['participant'],
  })
  const session = async (title: string, participant: string | null, days: number) =>
    api.save('/scheduling/events', {
      client_id: companyId,
      title,
      starts_local: zurichLocal(soon(60 * 24 * days)),
      time_zone: 'Europe/Zurich',
      duration_minutes: 60,
      participant_contact_id: participant,
      notify: false,
    })
  const own = uniqueName('Lorenzo German lesson')
  const others = uniqueName('Liam German lesson')
  const companys = uniqueName('Team workshop')
  await session(own, text(lorenzo.id), 2)
  await session(others, text(liam.id), 3)
  await session(companys, null, 4)
  const invoice = await api.save(`/invoices/${text(object(await api.draft(company)).id)}/issue`)

  const context = await browser.newContext({ baseURL: portalURL })
  try {
    const path = await portalPath(api.request)
    const portal = await context.newPage()
    await portal.goto(`${path}login`)
    await portal.getByLabel('Email', { exact: true }).fill(lorenzoEmail)
    await portal.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(portal.getByRole('heading', { name: 'Check your email' })).toBeVisible()
    const dev = await context.request.get(
      `/api/v1/auth/email/dev-code?email=${encodeURIComponent(lorenzoEmail)}`,
    )
    await portal.getByLabel('Code', { exact: true }).fill(text(object(await dev.json()).code))
    await expect(portal).toHaveURL(portalAt(path))

    // Home is his sessions; the tabs are his.
    await expect(portal.getByText(own).first()).toBeVisible()
    await expect(portal.getByText(others)).toHaveCount(0)
    await expect(portal.getByText(companys)).toHaveCount(0)
    const nav = portal.getByRole('navigation', { name: 'Portal' })
    await expect(nav.getByRole('link', { name: 'Documents' })).toBeVisible()
    await Promise.all(
      ['Invoices', 'Engagements', 'Overview'].map((name) =>
        expect(nav.getByRole('link', { name })).toHaveCount(0),
      ),
    )
    await expect(
      portal.getByRole('button', { name: /^Account menu, Lorenzo Percic/ }),
    ).toBeVisible()

    // The API refuses what is not his, whatever the page shows.
    const api404 = async (p: string) =>
      expect((await context.request.get(`${path}api/v1/public/portal${p}`)).status()).toBe(404)
    await api404('/invoices')
    await api404(`/invoices/${text(invoice.id)}/pdf`)
    await api404('/engagements')
    await api404('/profile')

    // Taking his portal access ends the session at once.
    await api.save(
      `/clients/${companyId}/contacts/${text(lorenzo.id)}`,
      { portal_enabled: false },
      'PATCH',
    )
    expect(
      (await context.request.get(`${path}api/v1/public/portal/scheduling/occurrences`)).status(),
    ).toBe(401)
  } finally {
    await context.close()
  }
})
