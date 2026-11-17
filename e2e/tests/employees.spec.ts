import { randomUUID } from 'node:crypto'

import { expect, object, signIn, test, text, type FinancialAPI } from './fixtures'

// Employees and the payroll register against the real API, database and object storage.

async function employee(api: FinancialAPI, extra: Record<string, unknown> = {}) {
  return api.save('/employees', {
    first_name: 'Anna',
    last_name: `Muster ${randomUUID().slice(0, 6)}`,
    employment_start: '2024-01-01',
    employer_country: 'CH',
    work_country: 'CH',
    work_region: 'ZH',
    position: 'Engineer',
    ...extra,
  })
}

const october = (id: string, extra: Record<string, unknown> = {}) => ({
  employee_id: id,
  period_start: '2026-10-01',
  period_end: '2026-10-31',
  currency: 'CHF',
  gross: '6000.00',
  deductions: '820.00',
  net: '5180.00',
  employer_costs: '710.00',
  ...extra,
})

async function rows(api: FinancialAPI, path: string): Promise<Record<string, unknown>[]> {
  const response = await api.request.get(`/api/v1${path}`)
  await expect(response).toBeOK()
  const data = object(await response.json()).data
  if (!Array.isArray(data)) throw new Error(`Expected a list from ${path}`)
  return data.map(object)
}

test('employees are not members: no user, no invitation, no seat', async ({ api }) => {
  const before = await rows(api, '/members')
  const invitationsBefore = await rows(api, '/members/invitations')
  await Promise.all([0, 1, 2].map((i) => employee(api, { employee_number: `E-${i}` })))
  expect(await rows(api, '/employees')).toHaveLength(3)
  expect(await rows(api, '/members')).toHaveLength(before.length)
  expect(await rows(api, '/members/invitations')).toHaveLength(invitationsBefore.length)
})

test('payroll: two approvals at once, approved is not paid, a correction keeps the original, booked once', async ({
  api,
}) => {
  await api.settings()
  const anna = await employee(api)
  const entry = await api.save('/payroll/entries', october(text(anna.id)))
  const id = text(entry.id)

  const [a, b] = await Promise.all([
    api.write(`/payroll/entries/${id}/approve`, { version: 1 }),
    api.write(`/payroll/entries/${id}/approve`, { version: 1 }),
  ])
  expect([a.status(), b.status()].toSorted()).toEqual([200, 409])
  const approved = await api.read(`/payroll/entries/${id}`)
  expect(approved.status).toBe('approved')
  expect(approved.payment_status).toBe('unpaid')

  const edit = await api.write(
    `/payroll/entries/${id}`,
    { version: approved.version, gross: '1.00' },
    'PATCH',
  )
  expect(edit.status()).toBe(409)

  const correction = await api.save(`/payroll/entries/${id}/correct`)
  await api.save(
    `/payroll/entries/${text(correction.id)}`,
    { version: 1, gross: '6100.00', net: '5280.00' },
    'PATCH',
  )
  await api.save(`/payroll/entries/${text(correction.id)}/approve`, { version: 2 })
  const original = await api.read(`/payroll/entries/${id}`)
  expect(original.superseded_by).toBe(correction.id)
  expect(original.gross).toBe('6000.00')

  await api.save(`/payroll/entries/${text(correction.id)}/payment`, {
    version: 3,
    status: 'paid',
    paid_on: '2026-10-28',
  })
  const booking = await api.save('/payroll/bookings', { to: '2026-10-31' })
  expect(booking.items).toBe(2) // the correction's accrual and payment; the original was never booked
  const again = await api.write('/payroll/bookings', { to: '2026-10-31' })
  expect(again.status()).toBe(409)
  const journal = await api.request.get(
    `/api/v1/payroll/bookings/${text(booking.id)}/export?format=csv`,
  )
  await expect(journal).toBeOK()
  const csv = await journal.text()
  expect(csv).toContain('5000,2279,5280.00')
  expect(csv).toContain('5700,2270,710.00')
})

test('payroll CSV import: read without the AI model, bad rows kept back, the same file never creates twice', async ({
  api,
}) => {
  const number = `E-${randomUUID().slice(0, 6)}`
  await employee(api, { employee_number: number })
  const csv =
    'employee_number;period_start;period_end;currency;gross;deductions;net;employer_costs\n' +
    `${number};2026-09-01;2026-09-30;CHF;6000,00;820,00;5180,00;\n` +
    `${number}-missing;2026-09-01;2026-09-30;CHF;100.00;;;\n`
  const upload = async () => {
    const response = await api.request.post('/api/v1/imports', {
      headers: { 'X-CSRF-Token': api.csrf },
      multipart: {
        kind: 'payroll',
        'files[]': {
          name: 'september.csv',
          mimeType: 'text/csv',
          buffer: Buffer.from(csv, 'utf8'),
        },
      },
    })
    expect(response.status(), await response.text()).toBe(201)
    const id = text(object(object(await response.json()).data).id)
    await expect
      .poll(async () => (await api.read(`/imports/${id}`)).status, { timeout: 30_000 })
      .not.toBe('extracting')
    return api.read(`/imports/${id}`)
  }
  const batch = await upload()
  const records = batch.records
  if (!Array.isArray(records)) throw new Error('Expected records')
  expect(records).toHaveLength(2)
  const ids = records.map((r) => text(object(r).id))
  const commit = await api.save(`/imports/${text(batch.id)}/commit`, { record_ids: ids })
  const results = commit.results
  if (!Array.isArray(results)) throw new Error('Expected results')
  expect(results.map((r) => object(r).status).toSorted()).toEqual(['created', 'failed'])

  const entries = await rows(api, '/payroll/entries?month=2026-09')
  expect(entries).toHaveLength(1)
  const [imported] = entries
  expect(imported?.employer_costs).toBeNull() // an empty cell stays missing, never 0
  expect(imported?.status).toBe('draft') // importing certifies nothing

  const again = await upload()
  const first = text(object((again.records as unknown[])[0]).id)
  const repeat = await api.save(`/imports/${text(again.id)}/commit`, { record_ids: [first] })
  expect(object((repeat.results as unknown[])[0]).status).toBe('conflict')
  expect(await rows(api, '/payroll/entries?month=2026-09')).toHaveLength(1)

  // The payroll file is an HR file, not a document.
  expect(JSON.stringify(await rows(api, '/documents'))).not.toContain('september.csv')
})

test('HR data stays out of documents, members with full access and API tokens', async ({
  api,
  browser,
  baseURL,
  playwright,
}) => {
  const anna = await employee(api)
  const upload = await api.request.post(`/api/v1/employees/${text(anna.id)}/documents`, {
    headers: { 'X-CSRF-Token': api.csrf },
    multipart: {
      type: 'employment_contract',
      document_date: '2024-01-01',
      file: {
        name: 'anna-contract.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(`%PDF-1.4\n${randomUUID()}\n%%EOF`),
      },
    },
  })
  expect(upload.status(), await upload.text()).toBe(201)
  const doc = object(object(await upload.json()).data)
  expect(doc.retain_until).toBeNull() // counted from the end of employment, which has not come
  expect(JSON.stringify(await rows(api, '/documents?search=anna'))).toBe('[]')
  expect((await api.request.get(`/api/v1/documents/${text(doc.id)}`)).status()).toBe(404)
  const download = await api.request.get(
    `/api/v1/employees/${text(anna.id)}/documents/${text(doc.id)}/download`,
    { maxRedirects: 0 },
  )
  expect(download.status()).toBe(200) // streamed, never a signed link
  expect(download.headers()['cache-control']).toContain('no-store')

  // A member with full access to everything else sees no employee.
  const email = `e2e-member-${randomUUID()}@example.test`
  await api.save('/members/invitations', {
    email,
    role: 'member',
    scopes: ['*:*'],
    send_email: false,
  })
  const context = await browser.newContext({ baseURL })
  try {
    const member = await signIn(context.request, email)
    expect((await member.request.get('/api/v1/employees')).status()).toBe(403)
    expect((await member.request.get(`/api/v1/payroll/entries`)).status()).toBe(403)
  } finally {
    await context.close()
  }

  // A full-access API token reaches no HR route.
  const token = await api.write('/account/tokens', {
    name: 'E2E HR',
    scopes: ['read:*', 'write:*'],
    expires_in_days: 30,
  })
  if (token.status() === 402) return // the plan has no API access: tokens cannot exist at all
  expect(token.status(), await token.text()).toBe(201)
  const secret = text(object(object(await token.json()).data).token)
  const bare = await playwright.request.newContext({ baseURL })
  try {
    await Promise.all(
      ['/api/v1/employees', `/api/v1/employees/${text(anna.id)}`, '/api/v1/payroll/entries'].map(
        async (path) => {
          const response = await bare.get(path, { headers: { Authorization: `Bearer ${secret}` } })
          expect(response.status(), path).toBe(403)
          expect(object(object(await response.json()).error).code).toBe('token_not_allowed')
        },
      ),
    )
  } finally {
    await bare.dispose()
  }
})
