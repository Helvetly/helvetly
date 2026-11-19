import { setCsrfToken } from '@helvetly/ui/lib/http'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { portalHandlers, portalProfile, portalSession } from '@/mocks/portal'

import { PortalProfile } from './portal-profile'

const meta = {
  title: 'Portal/Profile',
  parameters: { msw: { handlers: portalHandlers } },
  beforeEach: () => setCsrfToken(portalSession.csrf_token),
  render: () => <PortalProfile />,
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>

const P = '/api/v1/public/portal/profile'
let sent: unknown

export const SendsOnlyChangedFields: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post(`${P}/requests`, async ({ request }) => {
          const body = await request.json()
          sent = body
          return HttpResponse.json(
            { id: 'r1', fields: body, created_at: '2026-11-10T10:00:00Z' },
            { status: 201 },
          )
        }),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const submit = await canvas.findByRole('button', { name: 'Request change' })
    await expect(submit).toBeDisabled()
    await userEvent.type(canvas.getByLabelText('City'), ' West')
    await expect(submit).toBeEnabled()
    await userEvent.click(submit)
    await waitFor(() => expect(sent).toEqual({ city: 'Bern West' }))
  },
}

export const FieldErrorFrom422: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const zip = await canvas.findByLabelText('ZIP')
    await userEvent.clear(zip)
    await userEvent.type(zip, 'bad')
    await userEvent.click(canvas.getByRole('button', { name: 'Request change' }))
    await expect(await canvas.findByText('This value isn’t valid.')).toBeVisible()
    await expect(zip).toHaveAttribute('aria-invalid', 'true')
  },
}

export const PendingRequest: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(P, () =>
          HttpResponse.json({
            ...portalProfile,
            pending: { id: 'r1', fields: { city: 'Zürich' }, created_at: '2026-11-10T10:00:00Z' },
          }),
        ),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Waiting for approval')).toBeVisible()
    await expect(canvas.getByText('Zürich')).toBeVisible()
  },
}

let phoneSent: unknown

/** The phone opens in its national format, refuses an invalid number and is requested as E.164. */
export const PhoneAsE164: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(P, () =>
          HttpResponse.json({
            ...portalProfile,
            profile: { ...portalProfile.profile, phone: '+41782390999' },
          }),
        ),
        http.post(`${P}/requests`, async ({ request }) => {
          const body = await request.json()
          phoneSent = body
          return HttpResponse.json(
            { id: 'r1', fields: body, created_at: '2026-11-10T10:00:00Z' },
            { status: 201 },
          )
        }),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    phoneSent = undefined
    const canvas = within(canvasElement)
    const phone = await canvas.findByLabelText('Phone')
    await expect(phone).toHaveValue('078 239 09 99')
    const submit = canvas.getByRole('button', { name: 'Request change' })
    await expect(submit).toBeDisabled()
    await userEvent.clear(phone)
    await userEvent.type(phone, '123')
    await userEvent.click(submit)
    await expect(await canvas.findByText('Enter a valid phone number.')).toBeVisible()
    await expect(phoneSent).toBeUndefined()
    await userEvent.clear(phone)
    await userEvent.type(phone, '442244646')
    await expect(phone).toHaveValue('44 224 46 46')
    await userEvent.click(submit)
    await waitFor(() => expect(phoneSent).toEqual({ phone: '+41442244646' }))
  },
}

/** Grouped cards, the pending request as a calm banner on top. */
export const PendingRequestDark: Story = {
  ...PendingRequest,
  parameters: { ...PendingRequest.parameters, dark: true },
  play: async (context) => {
    await PendingRequest.play?.(context)
    const canvas = within(context.canvasElement)
    const legends = [...context.canvasElement.querySelectorAll('legend')].map((l) => l.textContent)
    await expect(legends).toEqual(['Company', 'Contact', 'Address', 'Tax IDs'])
    // The banner comes before the form.
    const banner = canvas.getByRole('region', { name: 'Pending change request' })
    await expect(
      banner.compareDocumentPosition(canvas.getByRole('group', { name: 'Company' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  },
}

export const LoadError: Story = {
  parameters: {
    msw: {
      handlers: [http.get(P, () => HttpResponse.json({}, { status: 500 })), ...portalHandlers],
    },
  },
  play: async ({ canvasElement }) => {
    const alert = await within(canvasElement).findByRole('alert')
    await expect(alert).toHaveTextContent('Your details couldn’t be loaded')
    await expect(within(alert).getByRole('button', { name: 'Try again' })).toBeVisible()
  },
}

export const Loading: Story = {
  parameters: { msw: { handlers: [http.get(P, () => new Promise(() => {})), ...portalHandlers] } },
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(within(canvasElement).getAllByRole('status', { name: 'Loading' })[0]).toBeVisible(),
    )
  },
}

const rejection = (decidedAt: string) => ({
  ...portalProfile,
  last_decision: {
    id: 'r1',
    fields: { vat_number: 'CHE-123.456.789' },
    created_at: '2026-11-01T10:00:00Z',
    status: 'rejected',
    applied_fields: null,
    reason: 'This VAT number belongs to another company.',
    decided_at: decidedAt,
  },
})

/** A recent rejection shows with the supplier's reason above the form. */
export const RejectedRequest: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(P, () => HttpResponse.json(rejection(new Date().toISOString()))),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const notice = await canvas.findByRole('region', { name: 'Rejected change request' })
    await expect(notice).toHaveTextContent('Your last change request was not accepted')
    await expect(notice).toHaveTextContent('This VAT number belongs to another company.')
  },
}

export const RejectedRequestDark: Story = {
  ...RejectedRequest,
  parameters: { ...RejectedRequest.parameters, dark: true },
}

/** After 30 days the rejection no longer shows. */
export const OldRejectionHidden: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get(P, () => HttpResponse.json(rejection('2020-01-01T10:00:00Z'))),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByRole('button', { name: 'Request change' })
    await expect(canvas.queryByRole('region', { name: 'Rejected change request' })).toBeNull()
  },
}

let requiredSent: unknown

/** The name is required as in the platform's client form: cleared, it is refused before anything is sent. */
export const RequiredName: Story = {
  parameters: {
    msw: {
      handlers: [
        http.post(`${P}/requests`, async ({ request }) => {
          requiredSent = await request.json()
          return HttpResponse.json({}, { status: 201 })
        }),
        ...portalHandlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    requiredSent = undefined
    const canvas = within(canvasElement)
    const name = await canvas.findByLabelText(/Company name/)
    // The red asterisk, as on the platform.
    await expect(name.closest('[data-slot="form-field"]')).toHaveTextContent('Company name*')
    await userEvent.clear(name)
    await userEvent.click(canvas.getByRole('button', { name: 'Request change' }))
    await expect(await canvas.findByText('Enter the company name.')).toBeVisible()
    await expect(name).toHaveAttribute('aria-invalid', 'true')
    await expect(name).toHaveFocus()
    await expect(requiredSent).toBeUndefined()
  },
}

/** The platform's checks: email, website and Swiss UID, each under its own field. */
export const FieldValidation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const billing = await canvas.findByLabelText('Invoices go to')
    await userEvent.type(billing, 'books@keller')
    const website = canvas.getByLabelText('Website')
    await userEvent.clear(website)
    await userEvent.type(website, 'keller')
    const vat = canvas.getByLabelText('VAT / UID number')
    await userEvent.type(vat, 'che123456789')
    // Formatted as typed, as in the platform.
    await expect(vat).toHaveValue('CHE-123.456.789')
    await userEvent.click(canvas.getByRole('button', { name: 'Request change' }))
    await expect(await canvas.findByText('Enter a valid email address.')).toBeVisible()
    await expect(canvas.getByText('Enter a website, e.g. example.ch.')).toBeVisible()
    await expect(canvas.getByText('This UID number isn’t valid. Check the digits.')).toBeVisible()
  },
}

/** The sign-in address is shown but cannot be requested here. */
export const SignInEmailReadOnly: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const email = await canvas.findByLabelText('Sign-in email')
    await expect(email).toHaveValue('anna@keller.ch')
    await expect(email).toHaveAttribute('readonly')
    await expect(canvas.getByLabelText('Contact person')).toHaveValue('Anna Keller')
  },
}

const sameRow = (elements: HTMLElement[]) =>
  new Set(elements.map((element) => Math.round(element.getBoundingClientRect().top))).size === 1

/** Street, number and apartment on one line, ZIP, city and country on the next; ZIP and number narrow. */
export const AddressLayout: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const street = await canvas.findByLabelText('Street')
    const number = canvas.getByLabelText('Number')
    const apt = canvas.getByLabelText('Apt / suite')
    const zip = canvas.getByLabelText('ZIP')
    const city = canvas.getByLabelText('City')
    const country = canvas.getByLabelText('Country')
    await expect(sameRow([street, number, apt])).toBe(true)
    await expect(sameRow([zip, city, country])).toBe(true)
    await expect(number.getBoundingClientRect().width).toBeLessThan(
      street.getBoundingClientRect().width / 2,
    )
    await expect(zip.getBoundingClientRect().width).toBeLessThan(city.getBoundingClientRect().width)
  },
}

/** Phones: street and number share a line, the apartment and the country take their own. */
export const AddressLayoutPhone: Story = {
  parameters: {
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
    },
  },
  globals: { viewport: { value: 'phone' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const street = await canvas.findByLabelText('Street')
    await expect(sameRow([street, canvas.getByLabelText('Number')])).toBe(true)
    await expect(sameRow([street, canvas.getByLabelText('Apt / suite')])).toBe(false)
    await expect(sameRow([canvas.getByLabelText('ZIP'), canvas.getByLabelText('City')])).toBe(true)
  },
}

export const AddressLayoutPhoneDark: Story = {
  ...AddressLayoutPhone,
  parameters: { ...AddressLayoutPhone.parameters, dark: true },
}

/** The request bar follows the scroll only once something changed. */
export const StickyOnceChanged: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const bar = (await canvas.findByRole('button', { name: 'Request change' })).parentElement
    await expect(bar).not.toHaveClass('sticky')
    await userEvent.type(canvas.getByLabelText('City'), ' West')
    await expect(bar).toHaveClass('sticky')
  },
}
