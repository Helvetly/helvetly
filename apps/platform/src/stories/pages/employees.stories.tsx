import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, fn, userEvent, waitFor, within } from 'storybook/test'

import { EmployeesPage } from '@/components/employees/employees-page'

import { sessionHandler, unavailable } from '../screen-fixtures'
import { hr } from './api'
import { closeHeidi, dark, desktop, Frame, pageParameters, phone, shows } from './frame'

const meta = {
  title: 'Pages/Employees',
  beforeEach: closeHeidi,
  parameters: pageParameters('/employees'),
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
  parameters: pageParameters('/employees', {}, [emptyList]),
  play: async (context) => {
    await shows('No employees yet')?.(context)
    // No departments yet: the filter is off instead of offering nothing.
    await expect(body().getByRole('combobox', { name: 'Department' })).toBeDisabled()
    await expect(body().getAllByRole('button', { name: /New employee/ }).length).toBeGreaterThan(0)
  },
}

export const LoadError: Story = {
  parameters: pageParameters('/employees', {}, [http.get('/api/v1/employees', unavailable)]),
  play: async (context) => {
    await shows('Couldn’t load this list')?.(context)
    await expect(body().getByRole('button', { name: /Try again/ })).toBeVisible()
  },
}

/** A member with full access to the general areas: "*" never reaches employees, so no menu item and no page. */
export const NoPermission: Story = {
  parameters: pageParameters('/employees', {}, [
    sessionHandler({ role: 'member', scopes: ['*:*'] }),
  ]),
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
  parameters: pageParameters('/employees', { id: 'emp_1' }),
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

/** HR scopes for employees only: the Pay and Documents tabs stay away. */
export const DrawerWithoutPay: Story = {
  parameters: pageParameters('/employees', { id: 'emp_1' }, [
    sessionHandler({ role: 'member', scopes: ['read:*', 'read:employees'] }),
  ]),
  play: async () => {
    const sheet = await drawer('Lara Brunner')
    await expect(await sheet.findByRole('tab', { name: 'Employment' })).toBeVisible()
    await waitFor(() => expect(sheet.queryByRole('tab', { name: 'Pay' })).toBeNull())
    await expect(sheet.queryByRole('tab', { name: 'Documents' })).toBeNull()
    await expect(sheet.queryByRole('button', { name: 'Reveal' })).toBeNull()
    await expect(sheet.queryByRole('button', { name: /Edit/ })).toBeNull()
  },
}

const created = fn()
export const CreateValidation: Story = {
  parameters: pageParameters('/employees', { new: '1' }, [
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
    // Pre-filled from the company settings, and said so.
    await expect(form.getByLabelText(/Work country/)).toHaveValue('CH')
    await expect(form.getAllByText('Suggested from company settings').length).toBeGreaterThan(0)

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
  parameters: pageParameters('/employees', { new: '1' }, [
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
  parameters: pageParameters('/employees', { id: 'emp_1' }, [
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
  parameters: pageParameters('/employees', { id: 'emp_1' }),
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
