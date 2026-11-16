import { randomUUID } from 'node:crypto'

import type { Browser } from '@playwright/test'

import { expect, object, signIn, test, text, type FinancialAPI } from './fixtures'

// Who reaches employees and payroll, four-eyes approval and the owner's export, on the real API and screens.

async function employee(api: FinancialAPI) {
  return api.save('/employees', {
    first_name: 'Anna',
    last_name: `Muster ${randomUUID().slice(0, 6)}`,
    employment_start: '2024-01-01',
    employer_country: 'CH',
    work_country: 'CH',
  })
}

const october = (id: string) => ({
  employee_id: id,
  period_start: '2026-10-01',
  period_end: '2026-10-31',
  currency: 'CHF',
  gross: '6000.00',
  deductions: '820.00',
  net: '5180.00',
})

/** Invites a person with a role and scopes, signs them in in their own browser context. */
async function join(
  owner: FinancialAPI,
  browser: Browser,
  baseURL: string | undefined,
  role: 'admin' | 'member',
  scopes: string[] | null,
  name?: string,
) {
  const email = `e2e-${role}-${randomUUID()}@example.test`
  await owner.save('/members/invitations', { email, role, scopes, send_email: false })
  const context = await browser.newContext({ baseURL })
  const api = await signIn(context.request, email)
  if (name) await expect(await api.write('/account', { name }, 'PATCH')).toBeOK()
  return { api, context, page: await context.newPage() }
}

const name = (person: Record<string, unknown>) =>
  `${text(person.first_name)} ${text(person.last_name)}`

test('self-hosted (billing off): every feature is allowed, so the module works without a plan and shows no lock', async ({
  api,
  page,
}) => {
  const billing = object(object(await (await api.request.get('/api/v1/billing')).json()).data)
  expect(billing.enabled).toBe(false)
  await employee(api)
  await page.goto('/employees')
  await expect(page.getByRole('button', { name: 'New employee' }).first()).toBeVisible()
  await expect(page.getByText(/Your plan doesn.t include/)).toHaveCount(0)
})

test('an admin holds payroll view by default: the register read-only, the list by name, no record', async ({
  api,
  browser,
  baseURL,
}) => {
  const anna = await employee(api)
  await api.save('/payroll/entries', october(text(anna.id)))
  const admin = await join(api, browser, baseURL, 'admin', null)
  try {
    expect((await admin.api.request.get('/api/v1/employees')).status()).toBe(200)
    expect((await admin.api.request.get(`/api/v1/employees/${text(anna.id)}`)).status()).toBe(403)
    expect((await admin.api.request.get('/api/v1/payroll/entries?month=2026-10')).status()).toBe(
      200,
    )
    const refused = await admin.api.write('/payroll/entries', october(text(anna.id)))
    expect(refused.status()).toBe(403)

    const { page } = admin
    await page.goto('/employees/payroll?month=2026-10')
    await expect(page.getByRole('button', { name: name(anna) }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'New entry' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Import' })).toHaveCount(0)

    await page.goto('/employees')
    await expect(page.getByText(name(anna)).filter({ visible: true }).first()).toBeVisible()
    // Names are plain text: payroll view picks employees, it never opens their records.
    await expect(page.getByRole('button', { name: name(anna) })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'New employee' })).toHaveCount(0)
  } finally {
    await admin.context.close()
  }
})

test('the owner grants Employees edit only: records open, pay and payroll stay closed', async ({
  api,
  browser,
  baseURL,
}) => {
  const anna = await employee(api)
  const member = await join(api, browser, baseURL, 'member', ['write:employees'])
  try {
    expect((await member.api.request.get('/api/v1/payroll/entries')).status()).toBe(403)
    expect(
      (await member.api.request.get(`/api/v1/employees/${text(anna.id)}/pay-terms`)).status(),
    ).toBe(403)
    expect(
      (await member.api.request.get(`/api/v1/employees/${text(anna.id)}/protected`)).status(),
    ).toBe(403)

    const { page } = member
    await page.goto('/employees')
    await page
      .getByRole('button', { name: name(anna) })
      .first()
      .click()
    const drawer = page.getByRole('dialog', { name: name(anna) })
    await expect(drawer.getByRole('tab', { name: 'Employment' })).toBeVisible()
    await expect(drawer.getByRole('tab', { name: 'Documents' })).toBeVisible()
    await expect(drawer.getByRole('tab', { name: 'Pay' })).toHaveCount(0)
    await expect(drawer.getByRole('button', { name: 'Reveal' })).toHaveCount(0)
    await expect(drawer.getByRole('button', { name: 'Edit' })).toBeEnabled()

    await page.goto('/employees/payroll')
    await expect(page.getByText(/You don.t have access/).first()).toBeVisible()
  } finally {
    await member.context.close()
  }
})

test('four-eyes: whoever entered the figures cannot approve them, a second person with Payroll edit can', async ({
  api,
  page,
  browser,
  baseURL,
}) => {
  const anna = await employee(api)

  // Alone, the owner is the only approver: the setting says so before anyone else gets access.
  await page.goto('/settings/employment')
  const approval = page.locator('#employment-approval')
  await approval.getByText('Require a second person to approve payroll').click()
  await expect(approval.getByText('Nobody else can approve payroll yet.')).toBeVisible()
  await approval.getByRole('button', { name: 'Save' }).click()
  await expect
    .poll(async () => (await api.read('/employment/settings')).require_second_approver)
    .toBe(true)

  // Named: the audit line shows people's names (an account without a name shows none).
  const author = await join(api, browser, baseURL, 'member', ['write:payroll'], 'Ada Author')
  const second = await join(api, browser, baseURL, 'member', ['write:payroll'], 'Ben Second')
  try {
    expect((await api.read('/employment/settings')).payroll_approvers).toBe(3)
    const entry = await author.api.save('/payroll/entries', october(text(anna.id)))
    const id = text(entry.id)

    const refused = await author.api.write(`/payroll/entries/${id}/approve`, { version: 1 })
    expect(refused.status()).toBe(403)
    expect(object(object(await refused.json()).error).code).toBe('second_approver_required')

    await author.page.goto(`/employees/payroll?month=2026-10&entry=${id}`)
    const mine = author.page.locator('[data-slot=sheet-content]')
    await expect(mine.getByRole('button', { name: 'Approve' })).toBeDisabled()
    await mine
      .locator('span[tabindex="0"]', { has: author.page.getByRole('button', { name: 'Approve' }) })
      .hover()
    await expect(author.page.getByRole('tooltip')).toContainText('You entered these figures')

    await second.page.goto(`/employees/payroll?month=2026-10&entry=${id}`)
    const theirs = second.page.locator('[data-slot=sheet-content]')
    await theirs.getByRole('button', { name: 'Approve' }).click()
    await expect(theirs.getByRole('button', { name: 'Mark as paid' })).toBeVisible()
    await expect(theirs.getByText('Created by Ada Author · Approved by Ben Second')).toBeVisible()
    expect((await api.read(`/payroll/entries/${id}`)).status).toBe('approved')
  } finally {
    await author.context.close()
    await second.context.close()
  }
})

test("the owner's workspace export carries employee data and files in employees/", async ({
  api,
}) => {
  const anna = await employee(api)
  const upload = await api.request.post(`/api/v1/employees/${text(anna.id)}/documents`, {
    headers: { 'X-CSRF-Token': api.csrf },
    multipart: {
      type: 'employment_contract',
      document_date: '2024-01-01',
      file: {
        name: 'contract.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(`%PDF-1.4\n${randomUUID()}\n%%EOF`),
      },
    },
  })
  expect(upload.status(), await upload.text()).toBe(201)
  const exported = await api.request.get('/api/v1/workspace/export')
  await expect(exported).toBeOK()
  expect(exported.headers()['content-type']).toBe('application/zip')
  // ZIP entry names are stored uncompressed in the archive's headers.
  const zip = (await exported.body()).toString('latin1')
  expect(zip).toContain('employees/data/')
  expect(zip).toContain('employees/files/')
})
