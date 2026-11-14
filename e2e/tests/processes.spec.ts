import { expect, object, openPage, test, text, today, uniqueName } from './fixtures'

test('instalments and engagement usage produce independent, exact invoice balances', async ({
  page,
  api,
}) => {
  await api.settings()
  const client = await api.client()
  const scheduled = await api.draft(client, {
    instalments: { count: 3, interval: 'monthly', first_due_date: '2027-01-31' },
  })
  const issued = await api.save(`/invoices/${text(scheduled.id)}/issue`)
  const schedule = object(issued.instalments)
  if (!Array.isArray(schedule.items)) throw new Error('Expected scheduled instalments')
  expect(schedule.items.map((value) => object(value).amount)).toEqual([
    '360.35',
    '360.35',
    '360.30',
  ])
  expect(schedule.items.map((value) => object(value).due_date)).toEqual([
    '2027-01-31',
    '2027-02-28',
    '2027-03-31',
  ])
  await api.save(`/invoices/${text(scheduled.id)}/payments`, {
    amount: '500',
    method: 'bank_transfer',
  })
  const after = object((await api.read(`/invoices/${text(scheduled.id)}`)).instalments)
  if (!Array.isArray(after.items)) throw new Error('Expected allocation')
  expect(object(after.items[0]).open).toBe('0.00')
  expect(object(after.items[1]).open).toBe('220.70')

  const source = await api.draft(client)
  const plan = await api.save(`/invoices/${text(source.id)}/plan`, {
    count: 3,
    interval: 'monthly',
    first_due_date: '2027-01-31',
    auto_send: false,
  })
  const planPath = `/instalment-plans/${text(plan.id)}`
  expect((await api.save(`${planPath}/pause`)).status).toBe('paused')
  expect((await api.save(`${planPath}/resume`)).status).toBe('active')
  expect((await api.save(`${planPath}/cancel`)).status).toBe('cancelled')
  expect((await api.write(`${planPath}/resume`)).status()).toBe(409)
  expect(
    (
      await api.write(
        `/invoices/${text(source.id)}`,
        { note: 'Cannot edit a plan source' },
        'PATCH',
      )
    ).status(),
  ).toBe(409)

  const engagement = await api.save('/engagements', {
    client_id: text(client.id),
    title: uniqueName('E2E Retainer'),
    quantity: '10',
    unit: 'hour',
    billing: 'arrears',
    unit_price: '100',
    price_basis: 'net',
    currency: 'CHF',
    vat_category: 'S',
    vat_rate: '8.1',
    start_date: today(),
    recurrence: 'monthly',
  })
  const engagementPath = `/engagements/${text(engagement.id)}`
  const logged = await api.save(`${engagementPath}/entries`, {
    date: today(),
    quantity: '2.5',
    note: 'E2E delivery',
  })
  const periodID = text(object(logged.period).id)
  const billed = await api.save(`${engagementPath}/periods/${periodID}/invoice`, {
    kind: 'usage',
    detail: 'per_entry',
  })
  const generated = await api.read(`/invoices/${text(billed.invoice_id)}`)
  expect(generated.net_total).toBe('250.00')
  expect(generated.vat_total).toBe('20.25')
  expect(generated.payable_total).toBe('270.25')
  expect(
    (await api.write(`${engagementPath}/periods/${periodID}/invoice`, { kind: 'usage' })).status(),
  ).toBe(409)
  await openPage(page, `/engagements?id=${text(engagement.id)}`, 'Engagement detail')
  await expect(page.getByText(text(engagement.title), { exact: true }).first()).toBeVisible()
  const report = await api.request.get(`/api/v1${engagementPath}/periods/${periodID}/report`)
  await expect(report).toBeOK()
  expect((await report.body()).subarray(0, 5).toString()).toBe('%PDF-')
})

test('session expiry clears protected pages and keeps a safe return path', async ({
  page,
  api,
}) => {
  await api.client('Private record before expiry')
  await openPage(page, '/clients', 'Clients')
  await expect(
    page.getByText('Private record before expiry', { exact: true }).first(),
  ).toBeVisible()
  await expect(await api.write('/session', undefined, 'DELETE')).toBeOK()
  await page.reload()
  await expect(page).toHaveURL(/\/login\?next=/)
  await expect(page.getByText('Private record before expiry', { exact: true })).toHaveCount(0)
  expect((await api.request.get('/api/v1/clients')).status()).toBe(401)
})

test('a platform passkey registers, signs in and can be removed through the browser', async ({
  page,
  api,
}) => {
  const device = await page.context().newCDPSession(page)
  await device.send('WebAuthn.enable')
  const authenticator = await device.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  })
  try {
    await openPage(page, '/account', 'Account settings')
    await page.getByRole('button', { name: 'Add passkey', exact: true }).click()
    await expect
      .poll(async () => {
        const response = await api.request.get('/api/v1/account/passkeys')
        await expect(response).toBeOK()
        const data = object(await response.json()).data
        return Array.isArray(data) ? data.length : -1
      })
      .toBe(1)
    await expect(await api.write('/session', undefined, 'DELETE')).toBeOK()
    await page.goto('/login')
    await page.getByRole('button', { name: 'Continue with a passkey', exact: true }).click()
    await expect.poll(async () => (await api.request.get('/api/v1/session')).status()).toBe(200)
    await openPage(page, '/account', 'Account settings')
    await page.getByRole('button', { name: /^Remove / }).click()
    await expect
      .poll(async () => {
        const response = await api.request.get('/api/v1/account/passkeys')
        await expect(response).toBeOK()
        const data = object(await response.json()).data
        return Array.isArray(data) ? data.length : -1
      })
      .toBe(0)
  } finally {
    await device.send('WebAuthn.removeVirtualAuthenticator', {
      authenticatorId: authenticator.authenticatorId,
    })
    await device.detach()
  }
})
