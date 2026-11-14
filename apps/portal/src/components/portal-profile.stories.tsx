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
