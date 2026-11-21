import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { billingFixture } from '@/components/billing/billing-fixture'
import { EmployeesPage } from '@/components/employees/employees-page'

import { sessionHandler, unavailable } from '../screen-fixtures'
import { hr } from './api'
import { closeHeidi, dark, desktop, expectCompactStacked, Frame, phone, shows } from './frame'
import { billingOn, hrPage } from './hr'

const meta = {
  title: 'Pages/Employees',
  beforeEach: closeHeidi,
  parameters: hrPage('/employees'),
  render: () => (
    <Frame>
      <EmployeesPage />
    </Frame>
  ),
  globals: desktop,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)
const drawer = async (name: string | RegExp) =>
  within(await body().findByRole('dialog', { name }, { timeout: 8000 }))

export const List: Story = {
  play: async (context) => {
    await shows('Lara Brunner', 'Noah Weber')?.(context)
    // The explanation of employees and members sits behind its (?).
    await expect(body().getByRole('button', { name: 'About Employees and members' })).toBeVisible()
    await expect(body().getByRole('combobox', { name: 'Department' })).toBeEnabled()
  },
}
const positionHeader = () =>
  body().getAllByRole('columnheader', { name: /position/i })[0] as HTMLElement

const nameHeader = () => body().getAllByRole('columnheader', { name: /name/i })[0] as HTMLElement

/** A header sorts the list on the server: the first column is marked, a click puts the sort in the URL. */
export const SortByHeader: Story = {
  play: async (context) => {
    await shows('Lara Brunner')?.(context)
    await expect(nameHeader()).toHaveAttribute('aria-sort', 'ascending')
    await userEvent.click(within(positionHeader()).getByRole('button', { name: /position/i }))
    await waitFor(() => expect(window.location.search).toContain('sort=position'))
  },
}

export const ListDark = dark(List)
export const ListPhone = phone(List)

const emptyList = http.get('/api/v1/employees', () =>
  HttpResponse.json({
    data: [],
    departments: [],
    meta: { page: 1, page_size: 200, total: 0, total_pages: 0 },
  }),
)

export const Empty: Story = {
  parameters: hrPage('/employees', {}, [emptyList]),
  play: async (context) => {
    await shows('No employees yet')?.(context)
    // No departments yet: the filter is off instead of offering nothing.
    await expect(body().getByRole('combobox', { name: 'Department' })).toBeDisabled()
    // One first action: the empty state's button, not a second one in the header.
    await expect(body().getAllByRole('button', { name: /New employee/ })).toHaveLength(1)
  },
}
export const EmptyPhone = phone(Empty)

export const LoadError: Story = {
  parameters: hrPage('/employees', {}, [http.get('/api/v1/employees', unavailable)]),
  play: async (context) => {
    await shows('Couldn’t load this list')?.(context)
    await expect(body().getByRole('button', { name: /Try again/ })).toBeVisible()
  },
}

/** A member with full access to the general areas: "*" never reaches employees, so no menu item and no page. */
export const NoPermission: Story = {
  parameters: hrPage('/employees', {}, [sessionHandler({ role: 'member', scopes: ['*:*'] })]),
  play: async (context) => {
    await shows("You don't have access to employees")?.(context)
    // Not in the menu either; the rest of the team area stays.
    await expect(body().queryByRole('link', { name: 'Employees', hidden: true })).toBeNull()
    await expect(
      body().getAllByRole('link', { name: 'Members', hidden: true }).length,
    ).toBeGreaterThan(0)
  },
}

export const DrawerTabs: Story = {
  parameters: hrPage('/employees', { id: 'emp_1' }),
  play: async () => {
    const sheet = await drawer('Lara Brunner')
    await expect(
      await sheet.findByText('Register mode: pay is recorded, not calculated.'),
    ).toBeVisible()
    await expect(sheet.getByText('Gross-to-net calculation is not offered.')).toBeVisible()
    await expect(sheet.queryByText(/compliant/i)).toBeNull()
    await expect(sheet.getByText('Luca Rossi')).toBeVisible()
    await expect(sheet.getByText('•••• 3012')).toBeVisible()

    await userEvent.click(sheet.getByRole('button', { name: 'Reveal' }))
    await expect(await sheet.findByText('CH9300762011623853012')).toBeVisible()
    await userEvent.click(sheet.getByRole('button', { name: 'Hide' }))
    await expect(sheet.queryByText('CH9300762011623853012')).toBeNull()

    await userEvent.click(sheet.getByRole('tab', { name: 'History' }))
    await expect(await sheet.findByText('Pay terms added')).toBeVisible()
  },
}
export const DrawerTabsDark = dark(DrawerTabs)
export const DrawerTabsPhone = phone(DrawerTabs)

/** Employees view only: records and their documents, never pay, the sealed fields or edits. */
export const DrawerWithoutPay: Story = {
  parameters: hrPage('/employees', { id: 'emp_1' }, [
    sessionHandler({ role: 'member', scopes: ['read:*', 'read:employees'] }),
  ]),
  play: async () => {
    const sheet = await drawer('Lara Brunner')
    await expect(await sheet.findByRole('tab', { name: 'Employment' })).toBeVisible()
    await waitFor(() => expect(sheet.queryByRole('tab', { name: 'Pay' })).toBeNull())
    await expect(sheet.getByRole('tab', { name: 'Documents' })).toBeVisible()
    await expect(sheet.queryByText('Protected details')).toBeNull()
    await expect(sheet.queryByRole('button', { name: 'Reveal' })).toBeNull()
    await expect(sheet.queryByRole('button', { name: /Edit/ })).toBeNull()
  },
}

const created = fn()
export const CreateValidation: Story = {
  parameters: hrPage('/employees', { new: '1' }, [
    http.post('/api/v1/employees', async ({ request }) => {
      created(await request.json())
      return HttpResponse.json(
        {
          error: {
            code: 'validation_failed',
            message: 'Check the highlighted fields.',
            details: { fields: { work_region: 'Choose a canton of Switzerland.' } },
          },
        },
        { status: 422 },
      )
    }),
  ]),
  beforeEach: () => {
    closeHeidi()
    created.mockClear()
  },
  play: async () => {
    // The loading sheet goes first: wait for the form itself.
    await body().findByLabelText(/First name/, undefined, { timeout: 8000 })
    const form = await drawer('New employee')
    // Pre-filled from the company settings, and said so behind the section's (?).
    await expect(form.getByLabelText(/Work country/)).toHaveValue('CH')
    await expect(form.getByRole('button', { name: 'About Where they work' })).toBeVisible()
    // Laid out like the client form: an icon tile and a description per section.
    await expect(form.getByText('Who they are and how to reach them.')).toBeVisible()
    await expect(form.getByText('Role, dates and working time.')).toBeVisible()
    await expect(
      form.getByRole('heading', { name: 'Person' }).closest('section')?.querySelector('svg'),
    ).not.toBeNull()

    await userEvent.click(form.getByRole('button', { name: 'Save' }))
    await expect(await form.findByText('Enter the first name.')).toBeVisible()
    await expect(form.getByText('Enter the start date.')).toBeVisible()
    await expect(created).not.toHaveBeenCalled()

    await userEvent.type(form.getByLabelText(/First name/), 'Mia')
    await userEvent.type(form.getByLabelText(/Last name/), 'Keller')
    await userEvent.type(form.getByLabelText(/Start date/), '2026-12-01')
    await userEvent.click(form.getByRole('button', { name: 'Save' }))
    // The server's field error lands on the canton.
    await expect(await form.findByText('Choose a canton of Switzerland.')).toBeVisible()
    await expect(form.getByLabelText('Canton')).toHaveAttribute('aria-invalid', 'true')
    await expect(created).toHaveBeenCalledWith(
      expect.objectContaining({ first_name: 'Mia', work_country: 'CH', employer_country: 'CH' }),
    )
  },
}
export const CreateValidationPhone = phone(CreateValidation)

export const ProtectedFieldsUnavailable: Story = {
  parameters: hrPage('/employees', { new: '1' }, [
    http.post('/api/v1/employees', () =>
      HttpResponse.json(
        {
          error: {
            code: 'protected_fields_unavailable',
            message: 'Bank account and tax id cannot be stored: the server has no SECRET_KEY.',
          },
        },
        { status: 409 },
      ),
    ),
  ]),
  play: async () => {
    // The loading sheet goes first: wait for the form itself.
    await body().findByLabelText(/First name/, undefined, { timeout: 8000 })
    const form = await drawer('New employee')
    await userEvent.type(form.getByLabelText(/First name/), 'Mia')
    await userEvent.type(form.getByLabelText(/Last name/), 'Keller')
    await userEvent.type(form.getByLabelText(/Start date/), '2026-12-01')
    await userEvent.type(form.getByLabelText(/Bank account/), 'CH93 0076 2011 6238 5301 2')
    await userEvent.click(form.getByRole('button', { name: 'Save' }))
    await expect(await form.findByRole('alert')).toHaveTextContent('no SECRET_KEY')
  },
}

const addedTerms = fn()
export const AddPayTerms: Story = {
  parameters: hrPage('/employees', { id: 'emp_1' }, [
    http.post('/api/v1/employees/:id/pay-terms', async ({ request }) => {
      const input = await request.json()
      addedTerms(input)
      return HttpResponse.json({
        data: [
          {
            ...hr.payTerms[0],
            id: 'pt_3',
            effective_from: '2027-01-01',
            amount: '6300.00',
            current: false,
          },
          ...hr.payTerms,
        ],
      })
    }),
  ]),
  beforeEach: () => {
    closeHeidi()
    addedTerms.mockClear()
  },
  play: async () => {
    const sheet = await drawer('Lara Brunner')
    await userEvent.click(await sheet.findByRole('tab', { name: 'Pay' }))
    await expect(await sheet.findByText('Current')).toBeVisible()
    await userEvent.click(sheet.getByRole('button', { name: 'Add pay terms' }))
    const form = within(sheet.getByRole('form', { name: 'New pay terms' }))
    await userEvent.type(form.getByLabelText(/Effective from/), '2027-01-01')
    await userEvent.type(form.getByLabelText(/Amount/), '6300')
    await userEvent.click(form.getByRole('button', { name: 'Add pay terms' }))
    await waitFor(() =>
      expect(addedTerms).toHaveBeenCalledWith(
        expect.objectContaining({ effective_from: '2027-01-01', amount: '6300', currency: 'CHF' }),
      ),
    )
    await expect(await sheet.findByText('CHF 6’300.00')).toBeVisible()
  },
}

export const DocumentsRetention: Story = {
  parameters: hrPage('/employees', { id: 'emp_1' }),
  play: async () => {
    const sheet = await drawer('Lara Brunner')
    await userEvent.click(await sheet.findByRole('tab', { name: 'Documents' }))
    await expect(await sheet.findByText('Payslip October 2026.pdf')).toBeVisible()
    await expect(sheet.getByText('Legal hold')).toBeVisible()
    await expect(
      sheet.getByText(/Keep until 31 Dec 2036 · set by its retention rule/),
    ).toBeVisible()
    await expect(sheet.getByText('No retention date yet')).toBeVisible()
    await expect(sheet.getAllByRole('list', { name: 'Retention guidance' }).length).toBe(2)
    await expect(sheet.getByRole('link', { name: 'Payslip October 2026.pdf' })).toHaveAttribute(
      'href',
      '/api/v1/employees/emp_1/documents/doc_2/download',
    )
    // Uploading needs a type, said before anything is sent.
    const upload = within(sheet.getByRole('form', { name: 'Add a document' }))
    await userEvent.click(upload.getByRole('button', { name: 'Upload' }))
    await expect(await upload.findByText('Choose the kind of document.')).toBeVisible()
  },
}
export const DocumentsRetentionDark = dark(DocumentsRetention)

const swissSaved = fn()
/** Swiss work shows the Swiss fields; withholding tax asks for its canton; the server's 422 lands inline. */
export const SwissFields: Story = {
  parameters: hrPage('/employees', { new: '1' }, [
    http.post('/api/v1/employees', async ({ request }) => {
      swissSaved(await request.json())
      return HttpResponse.json(
        {
          error: {
            code: 'validation_failed',
            message: 'Check the highlighted fields.',
            details: {
              fields: { social_security_number: 'Enter the AHV number as 756.XXXX.XXXX.XX.' },
            },
          },
        },
        { status: 422 },
      )
    }),
  ]),
  beforeEach: () => {
    closeHeidi()
    swissSaved.mockClear()
  },
  play: async () => {
    await body().findByLabelText(/First name/, undefined, { timeout: 8000 })
    const form = await drawer('New employee')
    await expect(form.getByText('Pay & insurance')).toBeVisible()
    await expect(form.getByRole('textbox', { name: /Pension fund/ })).toBeVisible()
    // A fixed-term contract needs its end date before anything is sent.
    await userEvent.type(form.getByLabelText(/First name/), 'Mia')
    await userEvent.type(form.getByLabelText(/Last name/), 'Keller')
    await userEvent.type(form.getByLabelText(/Start date/), '2026-12-01')
    await userEvent.selectOptions(form.getByLabelText(/Employment type/), 'fixed_term')
    await userEvent.click(form.getByRole('checkbox', { name: /Withholding tax \(Quellensteuer\)/ }))
    await userEvent.click(form.getByRole('button', { name: 'Save' }))
    await expect(await form.findByText('A fixed-term contract needs its end date.')).toBeVisible()
    await expect(
      form.getByText('Choose the canton the withholding tax is settled with.'),
    ).toBeVisible()
    await expect(swissSaved).not.toHaveBeenCalled()

    await userEvent.type(form.getByLabelText(/End date/), '2027-11-30')
    await userEvent.selectOptions(form.getByLabelText(/Withholding tax canton/), 'ZH')
    await userEvent.type(form.getByRole('textbox', { name: /Social security number/ }), '756.1')
    await userEvent.click(form.getByRole('button', { name: 'Save' }))
    await expect(await form.findByText('Enter the AHV number as 756.XXXX.XXXX.XX.')).toBeVisible()
    await expect(form.getByRole('textbox', { name: /Social security number/ })).toHaveAttribute(
      'aria-invalid',
      'true',
    )
    await expect(swissSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        employment_type: 'fixed_term',
        employment_end: '2027-11-30',
        withholding_tax: true,
        withholding_tax_canton: 'ZH',
      }),
    )

    // Work abroad hides the Swiss section.
    await userEvent.selectOptions(form.getByLabelText(/Work country/), 'DE')
    await waitFor(() => expect(form.queryByText('Pay & insurance')).toBeNull())
  },
}
export const SwissFieldsDark = dark(SwissFields)
export const SwissFieldsPhone = phone(SwissFields)

/** Payroll view only (an admin's default): the list to pick names from, no record to open, no create. */
export const PayrollOnlyViewer: Story = {
  parameters: hrPage('/employees', {}, [sessionHandler({ role: 'admin', scopes: undefined })]),
  play: async (context) => {
    await shows('Lara Brunner')?.(context)
    await expect(body().queryByRole('button', { name: 'Lara Brunner' })).toBeNull()
    await expect(body().queryByRole('button', { name: /New employee/ })).toBeNull()
    await expect(body().getAllByText('Payroll').length).toBeGreaterThan(0)
  },
}

/** Pro: Employees stays in the menu, and the page is the same compact upsell as Approvals. */
export const ProUpsell: Story = {
  parameters: hrPage('/employees', {}, [billingOn('pro', false)]),
  play: async (context) => {
    await shows('Staff records and payroll in one place')?.(context)
    await expectCompactStacked(body().getByText(/Employee records with contracts/))
    await expect(body().getByRole('link', { name: 'Upgrade to Business' })).toHaveAttribute(
      'href',
      '/settings/billing/plans/',
    )
    await expect(body().getByRole('link', { name: 'Compare plans' })).toBeVisible()
    await expect(body().queryByText('Lara Brunner')).toBeNull()
  },
}
/** The sidebar lists Employees on every plan; on Pro it carries the plan's tag. */
export const ProMenuListsEmployees: Story = {
  parameters: hrPage('/employees', {}, [billingOn('pro', false)]),
  play: async (context) => {
    await shows('Staff records and payroll in one place')?.(context)
    await expect(
      body().getAllByRole('link', { name: /Employees/, hidden: true }).length,
    ).toBeGreaterThan(0)
  },
}
export const ProUpsellDark = dark(ProUpsell)
export const ProUpsellPhone = phone(ProUpsell)

/** Whoever cannot manage billing sees what Business gives, without the upgrade actions. */
export const ProUpsellWithoutBilling: Story = {
  parameters: hrPage('/employees', {}, [
    http.get('/api/v1/billing', () =>
      HttpResponse.json({
        data: billingFixture({ plan: 'pro', status: 'active', locked: false, can_manage: false }),
      }),
    ),
    sessionHandler({ role: 'member', scopes: ['write:employees', 'write:payroll'] }),
  ]),
  play: async (context) => {
    await shows('Staff records and payroll in one place')?.(context)
    await expect(body().queryByRole('link', { name: /Upgrade/ })).toBeNull()
    await expect(body().queryByRole('link', { name: 'Compare plans' })).toBeNull()
  },
}

/** Not on the plan, not the owner: the upsell instead of data. */
export const LockedByPlan: Story = {
  parameters: hrPage('/employees', {}, [
    billingOn('pro'),
    sessionHandler({ role: 'member', scopes: ['write:employees', 'write:payroll'] }),
  ]),
  play: async (context) => {
    await shows('Staff records and payroll in one place')?.(context)
    await expect(body().queryByText('Lara Brunner')).toBeNull()
    await expect(body().getByRole('link', { name: 'Upgrade to Business' })).toHaveAttribute(
      'href',
      '/settings/billing/plans/',
    )
  },
}
export const LockedByPlanDark = dark(LockedByPlan)

/** The owner after a downgrade: data stays readable, every write is off and says why. */
export const OwnerAfterDowngrade: Story = {
  parameters: hrPage('/employees', { id: 'emp_1' }, [billingOn('pro')]),
  play: async () => {
    const sheet = await drawer('Lara Brunner')
    // The lock arrives with the plan: query again, as the button moves into its tooltip wrapper.
    await waitFor(() => expect(sheet.getByRole('button', { name: /Edit/ })).toBeDisabled())
    const edit = sheet.getByRole('button', { name: /Edit/ })
    await userEvent.hover(edit.parentElement ?? edit)
    await expect(
      await body().findAllByText(/no longer includes the Employees module/),
    ).not.toHaveLength(0)
    await userEvent.click(sheet.getByRole('button', { name: 'Close' }))
    await expect(
      await body().findByText(/you can view and export it, but not change it/),
    ).toBeVisible()
    await expect(body().queryByRole('button', { name: /New employee/ })).toBeNull()
  },
}
export const OwnerAfterDowngradePhone = phone(OwnerAfterDowngrade)

/** The owner's dry run: what erasing each former employee would delete today, nothing deleted. */
export const RetentionReview: Story = {
  parameters: hrPage('/employees', { retention: '1' }),
  play: async () => {
    const sheet = await drawer('Retention review')
    await expect(sheet.getByText(/Nothing is deleted here/)).toBeVisible()
    await expect(await sheet.findByText('Payslip June 2015.pdf · Payslip')).toBeVisible()
    await expect(sheet.getByText('Legal hold: can’t be erased')).toBeVisible()
    await expect(sheet.getByText(/includes all employee and payroll data/)).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Elena Rossi' })).toBeVisible()
  },
}
export const RetentionReviewDark = dark(RetentionReview)
export const RetentionReviewPhone = phone(RetentionReview)

/** Swiss details for work in Switzerland; the revealed sealed fields include the AHV number. */
export const DrawerSwiss: Story = {
  parameters: hrPage('/employees', { id: 'emp_1' }),
  play: async () => {
    const sheet = await drawer('Lara Brunner')
    await expect(await sheet.findByText('Pensionskasse Muster')).toBeVisible()
    await expect(sheet.getByText('•••• 0097')).toBeVisible()
    await userEvent.click(sheet.getByRole('button', { name: 'Reveal' }))
    await expect(await sheet.findByText('756.1234.5678.97')).toBeVisible()
  },
}
