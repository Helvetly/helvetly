import { Toaster } from '@helvetly/ui/components/sonner'
import { setCsrfToken } from '@helvetly/ui/lib/http'
import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { delay, http, HttpResponse } from 'msw'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import type { ClientSession } from '@/lib/scheduling'
import { portalHandlers, portalSession } from '@/mocks/portal'
import { request, schedulingHandlers, upcomingSessions } from '@/mocks/scheduling'

import { NextSessionCard, PortalSessions } from './portal-sessions'

const S = '/api/v1/public/portal/scheduling'
const handlers = [...schedulingHandlers, ...portalHandlers]
const meta = {
  title: 'Portal/Sessions',
  component: PortalSessions,
  decorators: [
    (Story) => (
      <>
        <Story />
        <Toaster />
      </>
    ),
  ],
  beforeEach: () => setCsrfToken(portalSession.csrf_token),
  parameters: {
    msw: { handlers },
    viewport: {
      options: { phone: { name: 'Phone', styles: { width: '390px', height: '844px' } } },
    },
  },
} satisfies Meta<typeof PortalSessions>
export default meta
type Story = StoryObj<typeof meta>

const body = () => within(document.body)
const withUpcoming = (list: ClientSession[], ...more: typeof handlers) => ({
  ...meta.parameters,
  msw: {
    handlers: [
      ...more,
      http.get(`${S}/occurrences`, ({ request: req }) =>
        HttpResponse.json({
          data: new URL(req.url).searchParams.get('when') === 'past' ? [] : list,
        }),
      ),
      ...handlers,
    ],
  },
})
const [soon, onTime] = upcomingSessions as [ClientSession, ClientSession, ClientSession]
const hour = 3_600_000

/** Upcoming with the join link only within 24 h, deadlines in words, and past ones with their attendance. */
export const Filled: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('Strategy call')).toBeVisible()
    await expect(canvas.getAllByRole('link', { name: /^Join/ })).toHaveLength(1)
    await expect(canvas.getAllByText(/^Free cancellation until/).length).toBeGreaterThan(0)
    await expect(canvas.getByText('The free cancellation period has ended')).toBeVisible()
    await expect(canvas.getAllByText(/· Zurich$/).length).toBeGreaterThan(0)
    await expect(canvas.getByText('Moved')).toBeVisible()
    const past = canvas.getByRole('region', { name: 'Past' })
    await expect(await within(past).findByText('Attended')).toBeVisible()
    await expect(within(past).getByText('Cancelled late')).toBeVisible()
    await expect(within(past).getByText('Missed')).toBeVisible()
    // Past sessions have nothing to ask.
    await expect(within(past).queryByRole('button')).toBeNull()
    await expect(canvas.getAllByRole('link', { name: /^Add to calendar: / })[0]).toHaveAttribute(
      'href',
      `${S}/occurrences/soc_soon/ics`,
    )
    await expect(await canvas.findByRole('link', { name: 'Book a session' })).toHaveAttribute(
      'href',
      '/book/',
    )
  },
}
export const FilledDark: Story = { ...Filled, parameters: { ...meta.parameters, dark: true } }

export const Phone: Story = {
  globals: { viewport: { value: 'phone' } },
  play: async ({ canvasElement }) => {
    await within(canvasElement).findByText('Strategy call')
    await waitFor(() =>
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth),
    )
  },
}

/** A late cancellation names the consequence, and the request waits for the business. */
export const LateCancel: Story = {
  parameters: withUpcoming(
    [soon],
    http.post(`${S}/occurrences/:id/cancel-request`, async () => {
      await delay(300)
      return HttpResponse.json({ data: request({ id: 'srq_1', late: true }) }, { status: 201 })
    }),
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(
      await canvas.findByRole('button', { name: /^Cancel session Strategy call/ }),
    )
    const dialog = body().getByRole('dialog', { name: 'Cancel Strategy call?' })
    await expect(within(dialog).getByText(/decides on your request/)).toBeVisible()
    await expect(within(dialog).getByText('This counts as a used session.')).toBeVisible()
    await userEvent.type(within(dialog).getByLabelText('Note'), 'Ill, sorry')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel session' }))
    await expect(await within(dialog).findByRole('button', { name: 'Sending…' })).toBeDisabled()
    await waitFor(() => expect(body().queryByRole('dialog')).toBeNull())
    await expect(
      await body().findByText('Your request has been sent to Muster GmbH.'),
    ).toBeInTheDocument()
  },
}

/** On time: no warning, and the auto-approved cancellation says the session is cancelled. */
export const OnTimeCancel: Story = {
  parameters: withUpcoming([onTime]),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /^Cancel session Coaching/ }))
    const dialog = body().getByRole('dialog')
    await expect(within(dialog).getByText(/within the free cancellation period/)).toBeVisible()
    await expect(within(dialog).queryByText('This counts as a used session.')).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep session' }))
    await waitFor(() => expect(body().queryByRole('dialog')).toBeNull())
    await userEvent.click(canvas.getByRole('button', { name: /^Cancel session Coaching/ }))
    await userEvent.click(body().getByRole('button', { name: 'Cancel session' }))
    await expect(await body().findByText('Coaching session is cancelled.')).toBeInTheDocument()
  },
}

/** Up to three times; sending needs at least one. */
export const Reschedule: Story = {
  parameters: withUpcoming([onTime]),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(await canvas.findByRole('button', { name: /^Reschedule / }))
    const dialog = body().getByRole('dialog', { name: 'Reschedule Coaching session?' })
    const send = within(dialog).getByRole('button', { name: 'Send request' })
    await expect(send).toBeDisabled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add another time' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add another time' }))
    await expect(within(dialog).queryByRole('button', { name: 'Add another time' })).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove time 3' }))
    await expect(within(dialog).getByRole('button', { name: 'Add another time' })).toBeVisible()
    await userEvent.type(within(dialog).getByLabelText('Time 1'), '2030-03-04T10:00')
    await expect(send).toBeEnabled()
    await userEvent.click(send)
    await waitFor(() => expect(body().queryByRole('dialog')).toBeNull())
    await expect(
      await body().findByText('Your request has been sent to Muster GmbH.'),
    ).toBeInTheDocument()
  },
}

/** An open request shows its state; a pending one can be withdrawn. */
export const OpenRequest: Story = {
  parameters: withUpcoming([
    { ...onTime, can_cancel: false, can_reschedule: false, request: request({ id: 'srq_open' }) },
  ]),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText('You asked to cancel this session. Waiting for Muster GmbH.'),
    ).toBeVisible()
    await expect(canvas.queryByRole('button', { name: /^Cancel session / })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Withdraw request' }))
    await expect(await body().findByText('Your request has been withdrawn.')).toBeInTheDocument()
  },
}

/** The business proposed another time: the client accepts or keeps the original. */
export const Proposal: Story = {
  parameters: withUpcoming([
    {
      ...onTime,
      can_cancel: false,
      can_reschedule: false,
      request: request({
        id: 'srq_prop',
        kind: 'reschedule',
        status: 'proposed',
        staff_proposal: new Date(Date.now() + 100 * hour).toISOString(),
      }),
    },
  ]),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText(/^Muster GmbH proposes .* instead\.$/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Keep original time' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Accept new time' }))
    await expect(await body().findByText('The session has been moved.')).toBeInTheDocument()
  },
}

/** A booking waiting for confirmation: no cancel or move, it is withdrawn instead. */
export const PendingBooking: Story = {
  parameters: withUpcoming([
    {
      ...onTime,
      status: 'requested',
      can_cancel: false,
      can_reschedule: false,
      request: request({ id: 'srq_b', kind: 'booking' }),
    },
  ]),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(
      await canvas.findByText('Waiting for Muster GmbH to confirm your booking.'),
    ).toBeVisible()
    await expect(canvas.getAllByText('Waiting for confirmation')[0]).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Withdraw request' })).toBeVisible()
  },
}

/** Booking off: no Book button. */
export const BookingOff: Story = {
  parameters: withUpcoming(
    upcomingSessions,
    http.get(`${S}/booking`, () =>
      HttpResponse.json({ mode: 'staff', confirmation: 'auto', policy_text: '', event_types: [] }),
    ),
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await canvas.findByText('Strategy call')
    await expect(canvas.queryByRole('link', { name: 'Book a session' })).toBeNull()
  },
}

export const Empty: Story = {
  parameters: withUpcoming([]),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(await canvas.findByText('No upcoming sessions')).toBeVisible()
    // The past list is its own request: wait for it too.
    await expect(await canvas.findByText('No past sessions in the last 12 months.')).toBeVisible()
  },
}

export const Loading: Story = {
  parameters: {
    ...meta.parameters,
    msw: {
      handlers: [
        http.get(`${S}/occurrences`, async () => {
          await delay('infinite')
          return HttpResponse.json({ data: [] })
        }),
        ...handlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    await waitFor(() =>
      expect(
        within(canvasElement).getAllByRole('status', { name: 'Loading sessions' }),
      ).toHaveLength(2),
    )
  },
}

export const ErrorState: Story = {
  parameters: {
    ...meta.parameters,
    msw: {
      handlers: [
        http.get(`${S}/occurrences`, () =>
          HttpResponse.json({ error: { code: 'internal', message: 'Down.' } }, { status: 500 }),
        ),
        ...handlers,
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const alerts = await within(canvasElement).findAllByRole('alert', {}, { timeout: 10000 })
    await expect(alerts[0]).toHaveTextContent('Your sessions couldn’t be loaded')
  },
}

/** The overview's card: the next session with its join link, or nothing at all. */
export const NextSession: Story = {
  render: () => <NextSessionCard />,
  play: async ({ canvasElement }) => {
    const card = await within(canvasElement).findByRole('region', { name: 'Next session' })
    await expect(within(card).getByText('Strategy call')).toBeVisible()
    await expect(within(card).getByRole('link', { name: 'Join' })).toHaveAttribute(
      'href',
      soon.meeting_url,
    )
    await expect(within(card).getByRole('link', { name: 'All sessions' })).toHaveAttribute(
      'href',
      '/sessions/',
    )
  },
}

export const NoNextSession: Story = {
  render: () => <NextSessionCard />,
  parameters: withUpcoming([]),
  play: async ({ canvasElement }) => {
    await new Promise((resolve) => setTimeout(resolve, 200))
    await expect(within(canvasElement).queryByRole('region', { name: 'Next session' })).toBeNull()
  },
}
