import { randomUUID } from 'node:crypto'

import { expect, object, openPage, signIn, test, text, uniqueName } from './fixtures'

test('a deleted workspace is restored by its owner with its data and members', async ({
  api,
  page,
  browser,
  baseURL,
}) => {
  const name = uniqueName('E2E Restore')
  const created = await api.write('/workspaces', { name, timezone: 'Europe/Zurich' })
  await expect(created).toBeOK()
  api.csrf = text(object(await created.json()).csrf_token)
  await api.settings()
  await expect(await api.write('/session/onboarded')).toBeOK()
  const client = await api.client()

  const mate = `e2e-mate-${randomUUID()}@example.test`
  await api.save('/members/invitations', {
    email: mate,
    role: 'member',
    scopes: ['read:clients'],
    send_email: false,
  })
  const context = await browser.newContext({ baseURL })
  try {
    // The teammate's address-bound invitation is claimed at sign-in.
    const teammate = await signIn(context.request, mate)
    const memberOf = async (member: typeof teammate) => {
      const { data } = object(await (await member.request.get('/api/v1/session/workspaces')).json())
      if (!Array.isArray(data)) throw new Error('Expected a list of workspaces')
      return data.map((item) => text(object(item).name))
    }
    expect(await memberOf(teammate)).toContain(name)

    const deleted = await api.write('/workspace', { confirm: name }, 'DELETE')
    await expect(deleted).toBeOK()
    api.csrf = text(object(await deleted.json()).csrf_token)
    // Deleting ended the teammate's session in it.
    expect((await teammate.request.get('/api/v1/session/workspaces')).status()).toBe(401)

    await openPage(page, '/account', 'Account settings')
    const section = page.getByRole('region', { name: 'Deleted workspaces' })
    await expect(section.getByText(name, { exact: true })).toBeVisible()
    await expect(section.getByText(/can be restored until/)).toBeVisible()
    await section.getByRole('button', { name: 'Restore' }).click()

    await expect(page).toHaveURL(/\/$/)
    await openPage(page, '/clients', 'Clients')
    await expect(page.getByText(text(client.name), { exact: true }).first()).toBeVisible()
    const again = await browser.newContext({ baseURL })
    try {
      expect(await memberOf(await signIn(again.request, mate))).toContain(name)
    } finally {
      await again.close()
    }

    // Restoring consumed the entry: the section is gone and a second try is refused.
    await openPage(page, '/account', 'Account settings')
    await expect(page.getByRole('region', { name: 'Deleted workspaces' })).toHaveCount(0)
  } finally {
    await context.close()
  }
})
