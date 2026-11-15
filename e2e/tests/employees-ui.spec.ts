import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { Page } from '@playwright/test'

import { expect, object, openPage, signIn, test, text } from './fixtures'

// The employees screens in a real browser on the real API; screenshots for review in $TMPDIR/helvetly/employees.
const shots = join(process.env.TMPDIR ?? tmpdir(), 'helvetly', 'employees')

async function shoot(page: Page, name: string) {
  await mkdir(shots, { recursive: true })
  await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true })
}

test('an owner records an employee, their pay, a document, and a payroll month approved apart from paid', async ({
  api,
  page,
}) => {
  await api.save(
    '/employment/settings',
    { employing_entity: 'E2E Zürich GmbH', country: 'CH', region: 'ZH' },
    'PUT',
  )
  const last = `Muster ${randomUUID().slice(0, 6)}`

  await openPage(page, '/employees', 'Employees')
  await expect(page.getByRole('link', { name: 'Employees', exact: true }).first()).toBeVisible()
  await shoot(page, '01-employees-empty')
  await page.getByRole('button', { name: 'New employee' }).first().click()
  const form = page.getByRole('dialog', { name: 'New employee' })
  await form.getByLabel('First name').fill('Anna')
  await form.getByLabel('Last name').fill(last)
  await form.getByLabel('Start date').fill('2024-01-01')
  await expect(form.getByLabel('Work country')).toHaveValue('CH') // suggested from the company settings
  await shoot(page, '02-employee-form')
  await form.getByRole('button', { name: 'Save' }).click()
  await expect(form).toHaveCount(0)

  const rows = object(await (await api.request.get('/api/v1/employees')).json()).data
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error('Expected one employee')
  const id = text(object(rows[0]).id)
  const terms = await api.write(`/employees/${id}/pay-terms`, {
    effective_from: '2024-01-01',
    basis: 'monthly',
    amount: '6000.00',
    currency: 'CHF',
    frequency: 'monthly',
  })
  await expect(terms).toBeOK()
  const upload = await api.request.post(`/api/v1/employees/${id}/documents`, {
    headers: { 'X-CSRF-Token': api.csrf },
    multipart: {
      type: 'payroll_record',
      document_date: '2025-03-31',
      file: {
        name: 'payroll-2025-03.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from(`%PDF-1.4\n${randomUUID()}\n%%EOF`),
      },
    },
  })
  expect(upload.status(), await upload.text()).toBe(201)

  await page.goto(`/employees?id=${id}`)
  const drawer = page.locator('[data-slot=sheet-content]')
  await expect(drawer.getByText(last).first()).toBeVisible()
  await shoot(page, '03-employee-employment')
  await drawer.getByRole('tab', { name: 'Pay' }).click()
  await expect(drawer.getByText('6’000.00').or(drawer.getByText("6'000.00")).first()).toBeVisible()
  await shoot(page, '04-employee-pay')
  await drawer.getByRole('tab', { name: 'Documents' }).click()
  await expect(drawer.getByText('payroll-2025-03.pdf')).toBeVisible()
  await expect(drawer.getByText(/2035/).first()).toBeVisible() // CH payroll records: 10 years after the business year
  await shoot(page, '05-employee-documents')
  await drawer.getByRole('tab', { name: 'History' }).click()
  await shoot(page, '06-employee-history')

  const entry = await api.save('/payroll/entries', {
    employee_id: id,
    period_start: '2026-10-01',
    period_end: '2026-10-31',
    currency: 'CHF',
    gross: '6000.00',
    deductions: '820.00',
    net: '5180.00',
  })
  await page.goto(`/employees/payroll?month=2026-10&entry=${text(entry.id)}`)
  const sheet = page.locator('[data-slot=sheet-content]')
  await expect(sheet.getByText('Approved is not paid.')).toBeVisible()
  await shoot(page, '07-payroll-entry-draft')
  await sheet.getByRole('button', { name: 'Approve' }).click()
  await expect(sheet.getByRole('button', { name: 'Mark as paid' })).toBeVisible()
  await expect((await api.read(`/payroll/entries/${text(entry.id)}`)).payment_status).toBe('unpaid')
  await sheet.getByLabel('Payment date').fill('2026-10-25')
  await sheet.getByRole('button', { name: 'Mark as paid' }).click()
  await expect
    .poll(async () => (await api.read(`/payroll/entries/${text(entry.id)}`)).payment_status)
    .toBe('paid')
  await page.keyboard.press('Escape')
  await expect(page.getByText('—').first()).toBeVisible() // employer costs were not given: missing, never 0
  await shoot(page, '08-payroll-month')

  await openPage(page, '/settings/employment', 'Employment')
  await shoot(page, '09-settings-employment')

  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/employees')
  await expect(page.getByText(`Anna ${last}`).filter({ visible: true }).first()).toBeVisible()
  await shoot(page, '10-employees-phone')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.evaluate(() => localStorage.setItem('theme', 'dark'))
  await page.goto('/employees/payroll?month=2026-10')
  await expect(page.getByRole('heading', { name: 'Payroll' }).first()).toBeVisible()
  await shoot(page, '11-payroll-dark')
})

test('a member with full access sees no Employees entry and no employee data', async ({
  api,
  browser,
  baseURL,
}) => {
  const email = `e2e-member-${randomUUID()}@example.test`
  await api.save('/members/invitations', {
    email,
    role: 'member',
    scopes: ['*:*'],
    send_email: false,
  })
  const context = await browser.newContext({ baseURL })
  try {
    await signIn(context.request, email)
    const page = await context.newPage()
    await openPage(page, '/clients', 'Clients')
    await expect(page.getByRole('link', { name: 'Employees', exact: true })).toHaveCount(0)
    await page.goto('/employees')
    await expect(
      page.getByText(/You don.t have access|No access|not allowed/i).first(),
    ).toBeVisible()
    await shoot(page, '12-member-no-access')
  } finally {
    await context.close()
  }
})
