import { setCsrfToken } from '@helvetly/ui/lib/http'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { portalHandlers, portalSession } from '@/mocks/portal'
import { bookingInfo, schedulingHandlers } from '@/mocks/scheduling'

import { LinkBooking, PortalBook } from './portal-book'

const S = '/api/v1/public/portal/scheduling'
const handlers = [...schedulingHandlers, ...portalHandlers]
const meta = {
  title: 'Portal/Book',
  component: PortalBook,
  beforeEach: () => setCsrfToken(portalSession.csrf_token),
  parameters: {
    msw: { handlers },
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
    },
  },
} satisfies Meta<typeof PortalBook>
export default meta
type Story = StoryObj<typeof meta>

const withHandlers = (...more: typeof handlers) => ({
  ...meta.parameters,
  msw: { handlers: [...more, ...handlers] },
})

/** Picks the first free time of the week shown. */
async function pickFirstSlot(canvas: ReturnType<typeof within>) {
  const slots = await canvas.findAllByRole('button', { name: /^Book / })
  await userEvent.click(slots[0]!)
}

/** Type → host → a slot → confirm → confirmed, with a link to the sessions. */
export const Flow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText('Free cancellation up to 24 hours before the start.'),
    ).toBeVisible()
    await expect(canvas.getByText('CHF 90.00')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: /^Trial lesson/ }))
    const hosts = canvas.getByRole('group', { name: 'With' })
    await userEvent.click(within(hosts).getByText('Tom Huber'))
    await expect(canvas.getByText(/^Times in .* time$/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Previous week' })).toBeDisabled()
    await pickFirstSlot(canvas)
    const form = canvas.getByRole('form', { name: 'Confirm your booking' })
    await expect(within(form).queryByLabelText('Your name')).toBeNull()
    await userEvent.click(within(form).getByRole('button', { name: 'Confirm booking' }))
    await expect(await canvas.findByText('Confirmed')).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'See your sessions' })).toHaveAttribute(
      'href',
      '/sessions/',
    )
    await userEvent.click(canvas.getByRole('button', { name: 'Book another session' }))
    await expect(canvas.getByRole('button', { name: /^Trial lesson/ })).toBeVisible()
  },
}

export const FlowDark: Story = { ...Flow, parameters: { ...meta.parameters, dark: true } }

/** Several of the client's packages fit: the client picks one, and the booking names it. */
export const PackageChoice: Story = {
  parameters: withHandlers(
    http.post(`${S}/booking`, async ({ request }) => {
      const sent = (await request.json()) as { engagement_id?: string; starts_at: string }
      if (sent.engagement_id !== 'eng_2')
        return HttpResponse.json(
          { error: { code: 'bad', message: 'No package.' } },
          { status: 422 },
        )
      return HttpResponse.json(
        {
          data: {
            id: 'soc_new',
            title: 'Follow-up call',
            starts_at: sent.starts_at,
            ends_at: sent.starts_at,
            status: 'scheduled',
            host_name: 'Lea Meier',
          },
        },
        { status: 201 },
      )
    }),
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /^Follow-up call/ }))
    // One host: nothing to choose.
    await expect(canvas.queryByRole('group', { name: 'With' })).toBeNull()
    await pickFirstSlot(canvas)
    const form = canvas.getByRole('form', { name: 'Confirm your booking' })
    await userEvent.click(within(form).getByText('Support retainer'))
    await userEvent.click(within(form).getByRole('button', { name: 'Confirm booking' }))
    await expect(await canvas.findByText('Confirmed')).toBeVisible()
  },
}

/** Someone else took the time first: back to the slots with a note, nothing lost. */
export const SlotTaken: Story = {
  parameters: withHandlers(
    http.post(`${S}/booking`, async () => {
      await delay(200)
      return HttpResponse.json(
        { error: { code: 'slot_taken', message: 'This time has just been taken: pick another.' } },
        { status: 409 },
      )
    }),
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /^Trial lesson/ }))
    await pickFirstSlot(canvas)
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm booking' }))
    await expect(await canvas.findByRole('button', { name: 'Booking…' })).toBeDisabled()
    await expect(
      await canvas.findByText('This time was just taken: please pick another.'),
    ).toBeVisible()
    await expect((await canvas.findAllByRole('button', { name: /^Book / })).length).toBeGreaterThan(
      0,
    )
  },
}

/** Manual confirmation: the hint before, "Waiting for confirmation" after. */
export const ManualConfirmation: Story = {
  parameters: withHandlers(
    http.get(`${S}/booking`, () => HttpResponse.json({ ...bookingInfo, confirmation: 'manual' })),
    http.post(`${S}/booking`, async ({ request }) => {
      const sent = (await request.json()) as { starts_at: string }
      return HttpResponse.json(
        {
          data: {
            id: 'soc_new',
            title: 'Trial lesson',
            starts_at: sent.starts_at,
            ends_at: sent.starts_at,
            status: 'requested',
            host_name: null,
          },
        },
        { status: 201 },
      )
    }),
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /^Trial lesson/ }))
    await expect(canvas.getByText('Muster GmbH confirms each booking.')).toBeVisible()
    await pickFirstSlot(canvas)
    await userEvent.click(canvas.getByRole('button', { name: 'Confirm booking' }))
    await expect(await canvas.findByText('Waiting for confirmation')).toBeVisible()
    await expect(canvas.getByText(/^Muster GmbH confirms Trial lesson on /)).toBeVisible()
  },
}

/** No free time this week: say so; the next week is one click away. */
export const NoSlots: Story = {
  parameters: withHandlers(http.get(`${S}/booking/slots`, () => HttpResponse.json({ data: [] }))),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /^Trial lesson/ }))
    await expect(
      await canvas.findByText('No free times this week. Try the next week.'),
    ).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Next week' }))
    await expect(canvas.getByRole('button', { name: 'Previous week' })).toBeEnabled()
  },
}

export const BookingOff: Story = {
  parameters: withHandlers(
    http.get(`${S}/booking`, () =>
      HttpResponse.json({ mode: 'staff', confirmation: 'auto', policy_text: '', event_types: [] }),
    ),
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Booking is not available')).toBeVisible()
    await expect(
      canvas.getByText('Muster GmbH schedules sessions with you directly.'),
    ).toBeVisible()
  },
}

/** A plan without Scheduling looks the same to the client: the plan is never named. */
export const PlanOff: Story = {
  parameters: withHandlers(
    http.get(`${S}/booking`, () =>
      HttpResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 }),
    ),
  ),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('Booking is not available')).toBeVisible()
  },
}

export const Loading: Story = {
  parameters: withHandlers(
    http.get(`${S}/booking`, async () => {
      await delay('infinite')
      return HttpResponse.json(bookingInfo)
    }),
  ),
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(
        within(canvasElement).getByRole('status', { name: 'Loading booking' }),
      ).toBeInTheDocument(),
    )
  },
}

export const Phone: Story = {
  globals: { viewport: { value: 'phone' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /^Trial lesson/ }))
    await canvas.findAllByRole('button', { name: /^Book / })
    await waitFor(() =>
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth),
    )
  },
}

/** A public booking link: the one type opens at once, name and email are asked, no session needed. */
export const Link: Story = {
  render: () => <LinkBooking token="tok_1" />,
  parameters: meta.parameters,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByRole('heading', { name: 'Book a session with Muster GmbH' }),
    ).toBeVisible()
    await pickFirstSlot(canvas)
    const form = canvas.getByRole('form', { name: 'Confirm your booking' })
    await userEvent.type(within(form).getByLabelText('Your name'), 'Nora Neu')
    await userEvent.type(within(form).getByLabelText('Email'), 'nora@example.ch')
    await userEvent.click(within(form).getByRole('button', { name: 'Confirm booking' }))
    await expect(await canvas.findByText('Confirmed')).toBeVisible()
    await expect(canvas.queryByRole('link', { name: 'See your sessions' })).toBeNull()
  },
}

export const LinkGone: Story = {
  render: () => <LinkBooking token="tok_gone" />,
  parameters: {
    ...withHandlers(
      http.get(`${S}/link`, () =>
        HttpResponse.json({ error: { code: 'not_found', message: 'Not found.' } }, { status: 404 }),
      ),
    ),
  },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText('This booking link is no longer valid'),
    ).toBeVisible()
  },
}
