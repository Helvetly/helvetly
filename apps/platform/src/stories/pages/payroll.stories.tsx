import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { PayrollPage } from '@/components/employees/payroll-page'

import { sessionHandler } from '../screen-fixtures'
import { hr } from './api'
import { closeHeidi, dark, desktop, Frame, phone, shows } from './frame'
import { billingOn, hrPage } from './hr'

const NOVEMBER = { month: '2026-11' }

const meta = {
  title: 'Pages/Payroll',
  beforeEach: closeHeidi,
  parameters: hrPage('/employees/payroll', NOVEMBER),
  render: () => (
    <Frame>
      <PayrollPage />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)
/** A toast fades in: wait until it can be seen. */
const toasted = (text: string) =>
  waitFor(() => expect(body().getByText(text)).toBeVisible(), { timeout: 8000 })
const entryParameters = (id: string, handlers: Parameters<typeof hrPage>[2] = []) =>
  hrPage('/employees/payroll', { ...NOVEMBER, entry: id }, handlers)

/** Noah's import lacks deductions, net pay and employer costs: dashes, and the EUR card says so. */
export const Month: Story = {
  play: async (context) => {
    await shows('Noah Weber', 'November 2026', '1 entry missing net pay')?.(context)
    const row = body()
      .getAllByText('Noah Weber')
      .find((node) => node.checkVisibility())
      ?.closest<HTMLElement>('tr, li')
    if (!row) throw new Error('Noah’s entry is not listed.')
    await expect(within(row).getAllByText(/—/).length).toBeGreaterThan(0)
    await expect(within(row).queryByText(/EUR 0\.00/)).toBeNull()
    // A month's sum over only some entries is not shown as its total: incomplete sums read "—".
    const eur = body().getAllByRole('region', { name: 'Totals in EUR' })[0]
    if (!eur) throw new Error('No EUR totals.')
    await expect(within(eur).queryByText(/EUR 0\.00/)).toBeNull()
    await expect(within(eur).getByText(/5.200\.00/)).toBeVisible()
    await expect(body().getByText('Recorded, not calculated')).toBeVisible()
  },
}
const grossHeader = () => body().getAllByRole('columnheader', { name: /^gross/i })[0] as HTMLElement

/** A header orders the month's entries in the browser: the latest period leads, a click on Gross keeps the sort in the URL. */
export const SortByHeader: Story = {
  play: async (context) => {
    await shows('Noah Weber')?.(context)
    await expect(body().getAllByRole('columnheader', { name: /period/i })[0]).toHaveAttribute(
      'aria-sort',
      'descending',
    )
    await userEvent.click(within(grossHeader()).getByRole('button', { name: /^gross$/i }))
    await waitFor(() => expect(window.location.search).toContain('sort=-gross'))
  },
}

export const MonthDark = dark(Month)
export const MonthPhone = phone(Month)

export const ShowCorrected: Story = {
  play: async (context) => {
    await shows('Noah Weber')?.(context)
    await expect(body().queryByText('Corrected')).toBeNull()
    await userEvent.click(body().getByRole('switch', { name: 'Show corrected entries' }))
    await waitFor(
      () =>
        expect(
          body()
            .getAllByText('Corrected')
            .some((node) => node.checkVisibility()),
        ).toBe(true),
      { timeout: 8000 },
    )
  },
}

export const Empty: Story = {
  parameters: hrPage('/employees/payroll', NOVEMBER, [
    http.get('/api/v1/payroll/entries', () => HttpResponse.json({ data: [] })),
    http.get('/api/v1/payroll/summary', () =>
      HttpResponse.json({ data: { month: '2026-11', currencies: [] } }),
    ),
  ]),
  play: shows('No payroll entries for November 2026'),
}

/** A member whose "*" reaches every area but HR: no payroll. */
export const NoPermission: Story = {
  parameters: hrPage('/employees/payroll', NOVEMBER, [
    sessionHandler({ role: 'member', scopes: ['*:*'] }),
  ]),
  play: shows("You don't have access to payroll"),
}

const approved = fn()
export const ApproveSuccess: Story = {
  parameters: entryParameters('pay_1', [
    http.post<never, { version: number }>(
      '/api/v1/payroll/entries/pay_1/approve',
      async ({ request }) => {
        approved(await request.json())
        return HttpResponse.json({ data: hr.entry({ status: 'approved', version: 2 }) })
      },
    ),
  ]),
  beforeEach: () => approved.mockClear(),
  play: async () => {
    const drawer = within(await body().findByRole('dialog', {}, { timeout: 8000 }))
    await userEvent.click(await drawer.findByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(approved).toHaveBeenCalledWith({ version: 1 }))
    await toasted('Entry approved.')
  },
}

/** Someone changed the draft meanwhile: the approval says so and offers a reload. */
export const ApproveConflict: Story = {
  parameters: entryParameters('pay_1', [
    http.post('/api/v1/payroll/entries/pay_1/approve', () =>
      HttpResponse.json(
        {
          error: {
            code: 'conflict',
            message: 'This entry was changed meanwhile. Reload it and try again.',
          },
        },
        { status: 409 },
      ),
    ),
  ]),
  play: async () => {
    const drawer = within(await body().findByRole('dialog', {}, { timeout: 8000 }))
    await userEvent.click(await drawer.findByRole('button', { name: 'Approve' }))
    const alert = await drawer.findByRole('alert')
    await expect(alert).toHaveTextContent('This entry was changed meanwhile')
    await userEvent.click(within(alert).getByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(drawer.queryByRole('alert')).toBeNull())
  },
}

const paid = fn()
export const MarkPaid: Story = {
  parameters: entryParameters('pay_2', [
    http.post<never, Record<string, unknown>>(
      '/api/v1/payroll/entries/pay_2/payment',
      async ({ request }) => {
        paid(await request.json())
        return HttpResponse.json({
          data: hr.entry({ id: 'pay_2', status: 'approved', payment_status: 'paid' }),
        })
      },
    ),
  ]),
  beforeEach: () => paid.mockClear(),
  play: async () => {
    const drawer = within(await body().findByRole('dialog', {}, { timeout: 8000 }))
    await expect(await drawer.findByText('Noah Weber')).toBeVisible()
    await userEvent.click(drawer.getByRole('button', { name: 'Mark as paid' }))
    await waitFor(() =>
      expect(paid).toHaveBeenCalledWith({ version: 2, status: 'paid', paid_on: '2026-11-25' }),
    )
    await toasted('Marked as paid.')
  },
}

const correction = hr.entry({ id: 'pay_9', supersedes_id: 'pay_3', employee_name: 'Elena Rossi' })
const corrected = fn()
export const Correction: Story = {
  parameters: entryParameters('pay_3', [
    http.post('/api/v1/payroll/entries/pay_3/correct', () => {
      corrected()
      return HttpResponse.json({ data: correction }, { status: 201 })
    }),
    http.get('/api/v1/payroll/entries/pay_9', () => HttpResponse.json({ data: correction })),
  ]),
  beforeEach: () => corrected.mockClear(),
  play: async () => {
    const drawer = within(await body().findByRole('dialog', {}, { timeout: 8000 }))
    await userEvent.click(await drawer.findByRole('button', { name: 'Correct' }))
    await waitFor(() => expect(corrected).toHaveBeenCalled())
    await toasted('Correction started as a draft.')
  },
}

export const BookingsPreview: Story = {
  play: async (context) => {
    await shows('Noah Weber')?.(context)
    await userEvent.click(body().getByRole('button', { name: 'Bookings' }))
    const drawer = within(await body().findByRole('dialog', {}, { timeout: 8000 }))
    await expect(
      await drawer.findByText(/Blocked: Some figures are missing/, {}, { timeout: 8000 }),
    ).toBeVisible()
    await expect(drawer.getByRole('button', { name: /Book 1/ })).toBeEnabled()
    await expect(await drawer.findByRole('link', { name: /as Banana/ })).toHaveAttribute(
      'href',
      '/api/v1/payroll/bookings/pb_1/export?format=banana',
    )
  },
}

export const NewEntryValidation: Story = {
  parameters: hrPage('/employees/payroll', { ...NOVEMBER, new: '1' }, [
    http.post('/api/v1/payroll/entries', () =>
      HttpResponse.json(
        {
          error: {
            code: 'validation_failed',
            message: 'Check the highlighted fields.',
            details: { fields: { employee_id: 'Choose the employee.' } },
          },
        },
        { status: 422 },
      ),
    ),
  ]),
  play: async () => {
    const drawer = within(
      await body().findByRole('dialog', { name: 'New entry' }, { timeout: 8000 }),
    )
    await expect(drawer.getByLabelText(/Period start/)).toHaveValue('2026-11-01')
    await userEvent.click(drawer.getByRole('button', { name: 'Save' }))
    await expect(await drawer.findByText('Choose the employee.')).toBeVisible()
  },
}

const fourEyes = (approvers: number) =>
  http.get('/api/v1/employment/settings', () =>
    HttpResponse.json({
      data: {
        ...hr.employmentSettings,
        require_second_approver: true,
        payroll_approvers: approvers,
      },
    }),
  )

/** Four-eyes on and the signed-in person entered the figures, with nobody else to approve: Approve is off and says why. */
export const FourEyesAuthor: Story = {
  parameters: entryParameters('pay_1', [fourEyes(1)]),
  play: async () => {
    const drawer = within(await body().findByRole('dialog', {}, { timeout: 8000 }))
    // Disabled once the settings arrive: query again, as the button moves into its tooltip wrapper.
    await waitFor(() => expect(drawer.getByRole('button', { name: 'Approve' })).toBeDisabled(), {
      timeout: 8000,
    })
    const approve = drawer.getByRole('button', { name: 'Approve' })
    await userEvent.hover(approve.parentElement ?? approve)
    await expect(
      await body().findAllByText(/You entered these figures\..*Nobody else can approve yet/),
    ).not.toHaveLength(0)
    await expect(drawer.getByText('Created by Anna Muster')).toBeVisible()
  },
}
export const FourEyesAuthorDark = dark(FourEyesAuthor)
export const FourEyesAuthorPhone = phone(FourEyesAuthor)

/** Another person entered them: Approve works; the server's second_approver_required still reads clearly. */
export const FourEyesRefused: Story = {
  parameters: entryParameters('pay_1', [
    fourEyes(2),
    http.get('/api/v1/payroll/entries/pay_1', () =>
      HttpResponse.json({ data: hr.entry({ created_by_id: 'usr_other' }) }),
    ),
    http.post('/api/v1/payroll/entries/pay_1/approve', () =>
      HttpResponse.json(
        {
          error: {
            code: 'second_approver_required',
            message:
              'You entered the current figures of this entry. Another person with Payroll edit access must approve it.',
          },
        },
        { status: 403 },
      ),
    ),
  ]),
  play: async () => {
    const drawer = within(await body().findByRole('dialog', {}, { timeout: 8000 }))
    const approve = await drawer.findByRole('button', { name: 'Approve' })
    await expect(approve).toBeEnabled()
    await userEvent.click(approve)
    await toasted(
      'You entered these figures. Another person with Payroll edit access must approve them.',
    )
  },
}

/** An approved entry names who created and who approved it. */
export const AuditTrail: Story = {
  parameters: entryParameters('pay_3'),
  play: async () => {
    const drawer = within(await body().findByRole('dialog', {}, { timeout: 8000 }))
    await expect(
      await drawer.findByText('Created by Anna Muster · Approved by Anna Muster'),
    ).toBeVisible()
  },
}

/** The owner after a downgrade: the register stays readable and exportable, writes are off. */
export const OwnerAfterDowngrade: Story = {
  parameters: entryParameters('pay_1', [billingOn('pro')]),
  play: async () => {
    const drawer = within(await body().findByRole('dialog', {}, { timeout: 8000 }))
    await waitFor(() => expect(drawer.getByRole('button', { name: 'Approve' })).toBeDisabled(), {
      timeout: 8000,
    })
    await expect(drawer.getByRole('button', { name: /Delete draft/ })).toBeDisabled()
  },
}

/** The register after a downgrade: readable and exportable, no new entries. */
export const OwnerAfterDowngradeRegister: Story = {
  parameters: hrPage('/employees/payroll', NOVEMBER, [billingOn('pro')]),
  play: async (context) => {
    await shows('Noah Weber', /you can view and export it/)?.(context)
    await expect(body().getAllByRole('link', { name: /Export CSV/ }).length).toBeGreaterThan(0)
    await expect(body().queryByRole('button', { name: /New entry/ })).toBeNull()
  },
}

/** Not on the plan, not the owner: the lock instead of the register. */
export const LockedByPlan: Story = {
  parameters: hrPage('/employees/payroll', NOVEMBER, [
    billingOn('pro'),
    sessionHandler({ role: 'member', scopes: ['write:payroll'] }),
  ]),
  play: shows('Staff records and payroll in one place'),
}
