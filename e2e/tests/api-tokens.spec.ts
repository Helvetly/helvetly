import { expect, object, test, text, uniqueName } from './fixtures'

test('a token made in Settings → API & MCP opens the API without cookies until it is revoked', async ({
  api,
  page,
  playwright,
  baseURL,
}) => {
  await page.goto('/settings/api')
  const section = page.getByRole('region', { name: 'API tokens' })
  await section.getByRole('button', { name: 'Create token' }).click()
  const drawer = page.getByRole('dialog', { name: 'Create API token' })
  const name = uniqueName('E2E token')
  await drawer.getByRole('textbox', { name: /Name/ }).fill(name)
  await drawer.getByRole('radio', { name: 'Full access' }).check()
  await drawer.getByRole('button', { name: 'Create token' }).click()

  const shown = page.getByRole('dialog', { name: 'Your new token' })
  const secret = text(await shown.getByText(/^hvt_[A-Z2-7]{26}$/).textContent())
  await shown.getByRole('button', { name: 'Done' }).click()
  await expect(section.getByText(name)).toBeVisible()

  // A fresh context: no session cookie, only the bearer header.
  const bare = await playwright.request.newContext({ baseURL })
  try {
    const bearer = { Authorization: `Bearer ${secret}` }
    await expect(await bare.get('/api/v1/clients', { headers: bearer })).toBeOK()

    await section.getByRole('button', { name: `Revoke ${name}` }).click()
    await page
      .getByRole('dialog', { name: `Revoke “${name}”?` })
      .getByRole('button', { name: 'Revoke' })
      .click()
    await expect(section.getByText(name)).toHaveCount(0)
    expect((await bare.get('/api/v1/clients', { headers: bearer })).status()).toBe(401)

    // A read-only token reads but cannot write.
    const read = await api.save('/account/tokens', {
      name: uniqueName('E2E read'),
      scopes: ['read:*'],
      expires_in_days: 30,
    })
    const readOnly = { Authorization: `Bearer ${text(read.token)}` }
    await expect(await bare.get('/api/v1/clients', { headers: readOnly })).toBeOK()
    const write = await bare.post('/api/v1/clients', {
      headers: readOnly,
      data: { name: 'Not allowed' },
    })
    expect(write.status()).toBe(403)
    expect(object(object(await write.json()).error).code).toBe('token_scope')

    // A token scoped to clients reads clients and nothing else.
    const narrow = await api.save('/account/tokens', {
      name: uniqueName('E2E clients'),
      scopes: ['read:clients'],
      expires_in_days: 30,
    })
    const clientsOnly = { Authorization: `Bearer ${text(narrow.token)}` }
    await expect(await bare.get('/api/v1/clients', { headers: clientsOnly })).toBeOK()
    const invoices = await bare.get('/api/v1/invoices', { headers: clientsOnly })
    expect(invoices.status()).toBe(403)
    expect(object(object(await invoices.json()).error).code).toBe('token_scope')
  } finally {
    await bare.dispose()
  }
})

test('a token scoped to products creates, updates and deletes a product, and only that', async ({
  api,
  playwright,
  baseURL,
}) => {
  const made = await api.save('/account/tokens', {
    name: uniqueName('E2E products'),
    scopes: ['write:products'],
    expires_in_days: 30,
  })
  const bare = await playwright.request.newContext({ baseURL })
  try {
    const headers = { Authorization: `Bearer ${text(made.token)}` }
    const name = uniqueName('E2E consulting')
    const created = await bare.post('/api/v1/products', {
      headers,
      data: { type: 'service', name, unit: 'hour', unit_price: '180.00', vat_category: 'S' },
    })
    expect(created.status()).toBe(201)
    const product = object(object(await created.json()).data)
    const id = text(product.id)
    expect(product.name).toBe(name)
    expect(product.unit_price).toBe('180.00')

    const updated = await bare.patch(`/api/v1/products/${id}`, {
      headers,
      data: { unit_price: '195.50', description: 'Senior rate' },
    })
    await expect(updated).toBeOK()
    expect(object(object(await updated.json()).data)).toMatchObject({
      unit_price: '195.50',
      description: 'Senior rate',
    })
    // The session sees the token's change: one API, one workspace.
    expect(await api.read(`/products/${id}`)).toMatchObject({ unit_price: '195.50' })

    expect((await bare.delete(`/api/v1/products/${id}`, { headers })).status()).toBe(204)
    expect((await bare.get(`/api/v1/products/${id}`, { headers })).status()).toBe(404)

    // write:products implies read:products, nothing else.
    const clients = await bare.post('/api/v1/clients', { headers, data: { name: 'Not allowed' } })
    expect(clients.status()).toBe(403)
    expect(object(object(await clients.json()).error)).toMatchObject({
      code: 'token_scope',
      details: { scope: 'write:clients' },
    })
    const members = await bare.get('/api/v1/members', { headers })
    expect(members.status()).toBe(403)
    expect(object(object(await members.json()).error).code).toBe('token_not_allowed')
  } finally {
    await bare.dispose()
  }
})
